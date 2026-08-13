import { createHash } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import {
  PERMISSIONS,
  isAuthorized,
  type AgentLimits,
  type AgentRunPlan,
  type Classification,
  type JsonObject,
  type Permission,
  type Visibility,
} from "@guild-os/domain";
import {
  GuildOperationsRepository,
  GuildPostgresRepository,
  loadAgentAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
  type QueryResultRow,
} from "@guild-os/postgres";
import { GuildAgentService } from "./agent-service.js";
import {
  DurableAutomationRuntime,
  createConfiguredAutomationPlanner,
  type AutomationAgentRunPort,
  type AutomationDispatchAuthority,
  type AutomationRunLease,
  type AutomationRunRequestRecord,
  type AutomationRuntimeRepository,
  type AutomationTickOutcome,
  type ClaimAutomationRunInput,
  type CreateAutomationAgentRunInput,
  type RenewAutomationLeaseInput,
} from "./automation-runtime.js";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";

const AUTOMATION_BATCH_LIMIT = 10;

interface RunRow extends QueryResultRow {
  id: string;
  guild_id: string;
  workflow_id: string;
  automation_rule_id: string | null;
  requested_by_actor_id: string;
  agent_actor_id: string;
  trigger_kind: AutomationRunRequestRecord["triggerKind"];
  trigger_event_id: string | null;
  input: JsonObject;
  idempotency_key: string;
  lease_token: string;
  lease_owner: string;
  lease_expires_at: string;
  attempt_count: number;
  max_attempts: number;
}

interface WorkflowContextRow extends QueryResultRow {
  guild_name: string;
  name: string;
  description: string;
  nodes: JsonObject[];
  space_id: string | null;
  allowed_action_kinds: AgentRunPlan["action"]["kind"][];
  capability_permissions: Permission[];
  visibility: Visibility;
  classification: Classification;
  allowed_actor_ids: string[];
}

function runFromRow(row: RunRow): AutomationRunLease {
  return {
    request: {
      id: row.id,
      guildId: row.guild_id,
      workflowId: row.workflow_id,
      automationRuleId: row.automation_rule_id,
      requestedByActorId: row.requested_by_actor_id,
      agentActorId: row.agent_actor_id,
      triggerKind: row.trigger_kind,
      triggerEventId: row.trigger_event_id,
      input: row.input,
      idempotencyKey: row.idempotency_key,
    },
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
    attempt: row.attempt_count,
    maxAttempts: row.max_attempts,
  };
}

function nextCronOccurrence(expression: string, timezone: string, current: string): string {
  return CronExpressionParser.parse(expression, {
    currentDate: current,
    tz: timezone,
  }).next().toDate().toISOString();
}

async function appendRuntimeEvent(
  connection: GuildTransactionConnection,
  guildId: string,
  lease: AutomationRunLease,
  action: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await new GuildPostgresRepository(connection, guildId).appendChronicle(makeChronicleEvent(
    guildId,
    lease.request.requestedByActorId,
    action,
    "workflow_run_request",
    lease.request.id,
    details,
  ));
}

function permissionsFor(
  snapshot: Awaited<ReturnType<typeof loadAgentAuthorizationSnapshot>>,
  actorId: string,
): Permission[] {
  return PERMISSIONS.filter((permission) => isAuthorized(snapshot, {
    actorIdentityId: actorId,
    permission,
  }));
}

function revisionOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class PostgresAutomationRuntimeRepository implements AutomationRuntimeRepository {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  async claimNext(input: ClaimAutomationRunInput): Promise<AutomationRunLease | null> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const operations = new GuildOperationsRepository(connection, this.#env.GUILD_ID);
        const due = (await connection.query<{
          trigger_expression: string;
          timezone: string;
        }>(
          `SELECT trigger_expression, timezone FROM automation_rules
            WHERE guild_id = $1 AND status = 'active' AND trigger_kind = 'schedule'
              AND next_run_at <= $2
            ORDER BY next_run_at, id LIMIT 1`,
          [this.#env.GUILD_ID, input.now],
        )).rows[0];
        if (due) {
          await operations.claimDueSchedule({
            now: input.now,
            nextRunAt: nextCronOccurrence(due.trigger_expression, due.timezone, input.now),
          });
        }
        await operations.claimNextAutomationEvent();

        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(
          new Date(input.now).valueOf() + input.leaseDurationMs,
        ).toISOString();
        const row = (await connection.query<RunRow>(
          `WITH candidate AS (
             SELECT request.id
               FROM workflow_run_requests request
               JOIN workflow_definitions workflow
                 ON workflow.guild_id = request.guild_id AND workflow.id = request.workflow_id
               JOIN actor_memberships agent_membership
                 ON agent_membership.guild_id = request.guild_id
                AND agent_membership.actor_id = request.agent_actor_id
               JOIN actor_memberships requester_membership
                 ON requester_membership.guild_id = request.guild_id
                AND requester_membership.actor_id = request.requested_by_actor_id
               JOIN actors agent ON agent.id = request.agent_actor_id
               JOIN actors requester ON requester.id = request.requested_by_actor_id
              WHERE request.guild_id = $1 AND request.attempt_count < request.max_attempts
                AND (
                  (request.status = 'queued' AND request.available_at <= $2)
                  OR (request.status = 'planning' AND request.lease_expires_at <= $2)
                )
                AND workflow.status = 'active'
                AND agent.kind = 'agent' AND agent.status = 'active'
                AND requester.status = 'active'
                AND agent_membership.state IN ('joined', 'active')
                AND requester_membership.state IN ('joined', 'active')
                AND agent_membership.operational = true
                AND requester_membership.operational = true
                AND (SELECT count(*) FROM workflow_run_requests active
                      WHERE active.guild_id = request.guild_id
                        AND active.workflow_id = request.workflow_id
                        AND active.status IN ('planning', 'running')) < workflow.max_concurrent_runs
              ORDER BY COALESCE(request.lease_expires_at, request.available_at), request.created_at, request.id
              FOR UPDATE OF request SKIP LOCKED LIMIT 1
           )
           UPDATE workflow_run_requests request
              SET status = 'planning', lease_token = $3, lease_owner = $4,
                  lease_expires_at = $5, attempt_count = attempt_count + 1,
                  max_attempts = LEAST(max_attempts, $6), started_at = COALESCE(started_at, $2),
                  error_code = NULL, error_message = NULL, updated_at = now()
             FROM candidate
            WHERE request.guild_id = $1 AND request.id = candidate.id
           RETURNING request.id::text, request.guild_id::text, request.workflow_id::text,
                     request.automation_rule_id::text, request.requested_by_actor_id::text,
                     request.agent_actor_id::text, request.trigger_kind,
                     request.trigger_event_id::text, request.input, request.idempotency_key,
                     request.lease_token::text, request.lease_owner,
                     request.lease_expires_at::text, request.attempt_count, request.max_attempts`,
          [this.#env.GUILD_ID, input.now, leaseToken, input.workerId, leaseExpiresAt,
            input.defaultMaxAttempts],
        )).rows[0];
        return row ? runFromRow(row) : null;
      },
    );
  }

  async loadPlanningContext(lease: AutomationRunLease) {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const row = (await connection.query<WorkflowContextRow>(
          `SELECT guild.name AS guild_name, workflow.name, workflow.description,
                  workflow.nodes, workflow.space_id::text,
                  workflow.allowed_action_kinds, workflow.capability_permissions,
                  workflow.visibility, workflow.classification,
                  workflow.allowed_actor_ids::text[]
             FROM workflow_run_requests request
             JOIN workflow_definitions workflow
               ON workflow.guild_id = request.guild_id AND workflow.id = request.workflow_id
             JOIN guilds guild ON guild.id = request.guild_id
            WHERE request.guild_id = $1 AND request.id = $2 AND request.status = 'planning'
              AND request.lease_token = $3 AND request.lease_owner = $4
              AND request.lease_expires_at > now()`,
          [this.#env.GUILD_ID, lease.request.id, lease.leaseToken, lease.leaseOwner],
        )).rows[0];
        if (!row) throw new Error("Automation lease no longer owns this Workflow request.");
        const connections = (await connection.query<{
          id: string;
          name: string;
          kind: string;
          write_risk_level: number;
          capability_permissions: string[];
          allowed_capabilities: JsonObject["allowedCapabilities"] | null;
        }>(
          `SELECT id::text, name, kind, write_risk_level, capability_permissions,
                  configuration -> 'allowedCapabilities' AS allowed_capabilities
             FROM connectors
            WHERE guild_id = $1 AND status = 'active'
              AND (space_id IS NULL OR space_id = $2)
              AND capability_permissions && $3::text[]
            ORDER BY name, id LIMIT 50`,
          [this.#env.GUILD_ID, row.space_id, row.capability_permissions],
        )).rows;
        return {
          guildName: row.guild_name,
          workflowName: row.name,
          workflowInstructions: [
            row.description,
            `Workflow graph: ${JSON.stringify(row.nodes)}`,
            `Available Connections: ${JSON.stringify(connections)}`,
          ].join("\n"),
          spaceId: row.space_id,
          allowedActionKinds: row.allowed_action_kinds,
          workflowPermissions: row.capability_permissions,
          visibility: row.visibility,
          classification: row.classification,
          allowedIdentityIds: row.allowed_actor_ids,
        };
      },
    );
  }

  async renewLease(input: RenewAutomationLeaseInput): Promise<AutomationRunLease | null> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const expiresAt = new Date(new Date(input.now).valueOf() + input.leaseDurationMs).toISOString();
        const row = (await connection.query<RunRow>(
          `UPDATE workflow_run_requests request
              SET lease_expires_at = $6, updated_at = now()
            WHERE request.guild_id = $1 AND request.id = $2 AND request.status = 'planning'
              AND request.lease_token = $3 AND request.lease_owner = $4
              AND request.lease_expires_at > $5
           RETURNING request.id::text, request.guild_id::text, request.workflow_id::text,
                     request.automation_rule_id::text, request.requested_by_actor_id::text,
                     request.agent_actor_id::text, request.trigger_kind,
                     request.trigger_event_id::text, request.input, request.idempotency_key,
                     request.lease_token::text, request.lease_owner,
                     request.lease_expires_at::text, request.attempt_count, request.max_attempts`,
          [this.#env.GUILD_ID, input.requestId, input.leaseToken, input.leaseOwner, input.now, expiresAt],
        )).rows[0];
        return row ? runFromRow(row) : null;
      },
    );
  }

  async loadDispatchAuthority(
    lease: AutomationRunLease,
    plan: AgentRunPlan,
  ): Promise<AutomationDispatchAuthority> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const workflow = await new GuildOperationsRepository(connection, this.#env.GUILD_ID)
          .getWorkflowDefinition(lease.request.workflowId);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          lease.request.agentActorId,
          lease.request.requestedByActorId,
          workflow.spaceId,
        );
        const agent = snapshot.agents.find((item) => item.identityId === lease.request.agentActorId);
        const agentIdentity = snapshot.identities.find((item) => item.id === lease.request.agentActorId);
        const requesterIdentity = snapshot.identities.find((item) =>
          item.id === lease.request.requestedByActorId);
        const agentMembership = snapshot.memberships.find((item) =>
          item.identityId === lease.request.agentActorId);
        const requesterMembership = snapshot.memberships.find((item) =>
          item.identityId === lease.request.requestedByActorId);
        if (!agent || !agentIdentity || !requesterIdentity || !agentMembership || !requesterMembership) {
          throw new Error("Automation authority subjects are no longer present.");
        }
        const rule = lease.request.automationRuleId === null ? null :
          (await connection.query<{ status: "active" | "paused" | "archived" }>(
            "SELECT status FROM automation_rules WHERE guild_id = $1 AND id = $2",
            [this.#env.GUILD_ID, lease.request.automationRuleId],
          )).rows[0] ?? null;
        const connector = plan.connectorId === null ? null :
          await new GuildOperationsRepository(connection, this.#env.GUILD_ID)
            .getConnection(plan.connectorId);
        const delegatedOperational = plan.action.kind !== "agent_delegate" ? null : Boolean(
          (await connection.query(
            `SELECT 1 FROM actors actor JOIN actor_memberships membership
               ON membership.guild_id = $1 AND membership.actor_id = actor.id
              WHERE actor.id = $2 AND actor.kind = 'agent' AND actor.status = 'active'
                AND membership.state IN ('joined', 'active') AND membership.operational = true`,
            [this.#env.GUILD_ID, plan.action.targetAgentActorId],
          )).rows[0],
        );
        const existing = (await connection.query<{ kill_requested_at: string | null }>(
          "SELECT kill_requested_at::text FROM agent_runs WHERE guild_id = $1 AND id = $2",
          [this.#env.GUILD_ID, lease.request.id],
        )).rows[0];
        const agentPermissions = permissionsFor(snapshot, lease.request.agentActorId);
        const requesterPermissions = permissionsFor(snapshot, lease.request.requestedByActorId);
        const revision = revisionOf({
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          workflowStatus: workflow.status,
          workflowPermissions: workflow.capabilityPermissions,
          agentStatus: agent.status,
          agentIdentityStatus: agentIdentity.status,
          requesterStatus: requesterIdentity.status,
          agentMembership: agentMembership.state,
          requesterMembership: requesterMembership.state,
          agentPermissions,
          requesterPermissions,
          connectorId: connector?.id ?? null,
          connectorVersion: connector?.version ?? null,
          connectorStatus: connector?.status ?? null,
          constitutionVersion: snapshot.constitution.version,
        });
        return {
          revision,
          guildId: this.#env.GUILD_ID,
          automationRuleStatus: rule?.status ?? null,
          workflowStatus: workflow.status,
          agentStatus: agent.status,
          agentMembershipOperational: ["joined", "active"].includes(agentMembership.state),
          requesterStatus: requesterIdentity.status,
          requesterMembershipOperational: ["joined", "active"].includes(requesterMembership.state),
          killRequested: existing?.kill_requested_at !== null && existing !== undefined,
          agentPermissions,
          requesterPermissions,
          workflowPermissions: workflow.capabilityPermissions,
          agentToolIds: agent.toolIds,
          agentLimits: agent.limits,
          constitutionLimits: snapshot.constitution.agentDefaults,
          connector: connector ? {
            id: connector.id,
            status: connector.status,
            capabilityPermissions: connector.capabilityPermissions,
            writeRiskLevel: connector.writeRiskLevel ?? null,
          } : null,
          delegatedAgentOperational: delegatedOperational,
          visibility: workflow.visibility,
          classification: workflow.classification,
          allowedIdentityIds: workflow.allowedActorIds,
          spaceId: workflow.spaceId,
        };
      },
    );
  }

  async commitDispatched(input: Parameters<AutomationRuntimeRepository["commitDispatched"]>[0]) {
    await this.#finishLease(input.lease, "running", {
      agentRunId: input.agentRunId,
      duplicate: input.duplicate,
      action: input.event.action,
    });
  }

  async releaseForRetry(input: Parameters<AutomationRuntimeRepository["releaseForRetry"]>[0]) {
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const result = await connection.query(
          `UPDATE workflow_run_requests SET status = 'queued', available_at = $5,
                  lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                  error_code = $6, error_message = 'Automation will retry after a transient failure.',
                  updated_at = now()
            WHERE guild_id = $1 AND id = $2 AND status = 'planning'
              AND lease_token = $3 AND lease_owner = $4`,
          [this.#env.GUILD_ID, input.lease.request.id, input.lease.leaseToken,
            input.lease.leaseOwner, input.availableAt, input.errorCode],
        );
        if (result.rowCount !== 1) throw new Error("Automation retry lost its durable lease.");
        await appendRuntimeEvent(connection, this.#env.GUILD_ID, input.lease, input.event.action, {
          errorCode: input.errorCode,
          availableAt: input.availableAt,
          attempt: input.lease.attempt,
        });
      },
    );
  }

  async commitTerminal(input: Parameters<AutomationRuntimeRepository["commitTerminal"]>[0]) {
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const result = await connection.query(
          `UPDATE workflow_run_requests SET status = $5, finished_at = now(),
                  lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                  error_code = $6, error_message = $7, updated_at = now()
            WHERE guild_id = $1 AND id = $2 AND status = 'planning'
              AND lease_token = $3 AND lease_owner = $4`,
          [this.#env.GUILD_ID, input.lease.request.id, input.lease.leaseToken,
            input.lease.leaseOwner, input.outcome, input.errorCode,
            input.outcome === "cancelled"
              ? "Automation was cancelled because its current authority no longer permits it."
              : "Automation failed after its bounded retry policy."],
        );
        if (result.rowCount !== 1) throw new Error("Terminal Automation update lost its durable lease.");
        await appendRuntimeEvent(connection, this.#env.GUILD_ID, input.lease, input.event.action, {
          errorCode: input.errorCode,
          outcome: input.outcome,
          attempt: input.lease.attempt,
        });
      },
    );
  }

  async #finishLease(
    lease: AutomationRunLease,
    status: "running",
    input: { agentRunId: string; duplicate: boolean; action: string },
  ): Promise<void> {
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const result = await connection.query(
          `UPDATE workflow_run_requests SET status = $5, agent_run_id = $6,
                  lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                  output = jsonb_build_object('agentRunId', $6::text), updated_at = now()
            WHERE guild_id = $1 AND id = $2 AND status = 'planning'
              AND lease_token = $3 AND lease_owner = $4`,
          [this.#env.GUILD_ID, lease.request.id, lease.leaseToken, lease.leaseOwner,
            status, input.agentRunId],
        );
        if (result.rowCount !== 1) throw new Error("Automation dispatch lost its durable lease.");
        await appendRuntimeEvent(connection, this.#env.GUILD_ID, lease, input.action, {
          agentRunId: input.agentRunId,
          duplicate: input.duplicate,
          attempt: lease.attempt,
        });
      },
    );
  }
}

export class GuildAutomationAgentRunPort implements AutomationAgentRunPort {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  async createGovernedRun(input: CreateAutomationAgentRunInput) {
    const state = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const request = (await connection.query<{
          status: string;
          lease_token: string | null;
          lease_owner: string | null;
          agent_state: string;
          requester_state: string;
          agent_operational: boolean;
          requester_operational: boolean;
          existing_run_id: string | null;
        }>(
          `SELECT request.status, request.lease_token::text, request.lease_owner,
                  agent_membership.state AS agent_state,
                  requester_membership.state AS requester_state,
                  agent_membership.operational AS agent_operational,
                  requester_membership.operational AS requester_operational,
                  run.id::text AS existing_run_id
             FROM workflow_run_requests request
             JOIN actor_memberships agent_membership
               ON agent_membership.guild_id = request.guild_id
              AND agent_membership.actor_id = request.agent_actor_id
             JOIN actor_memberships requester_membership
               ON requester_membership.guild_id = request.guild_id
              AND requester_membership.actor_id = request.requested_by_actor_id
             LEFT JOIN agent_runs run ON run.guild_id = request.guild_id AND run.id = request.id
            WHERE request.guild_id = $1 AND request.id = $2`,
          [this.#env.GUILD_ID, input.requestId],
        )).rows[0];
        if (!request) return "authority_changed" as const;
        if (request.existing_run_id) return "existing" as const;
        if (request.status !== "planning" || request.lease_token !== input.leaseToken) {
          return "authority_changed" as const;
        }
        if (!request.agent_operational || !["joined", "active"].includes(request.agent_state)) {
          return "offboarded" as const;
        }
        if (!request.requester_operational || !["joined", "active"].includes(request.requester_state)) {
          return "offboarded" as const;
        }
        return "create" as const;
      },
    );
    if (state === "authority_changed" || state === "offboarded") return { status: state };
    if (state === "existing") return { status: "existing" as const, runId: input.requestId };
    const runId = await new GuildAgentService(
      this.#env,
      input.requesterIdentityId,
    ).createGovernedRun({
      requestId: input.requestId,
      agentIdentityId: input.agentIdentityId,
      spaceId: input.spaceId,
      plan: input.plan,
      riskLevel: input.riskLevel,
      visibility: input.visibility,
      classification: input.classification,
      allowedIdentityIds: input.allowedIdentityIds,
      workflowPermissions: input.workflowPermissions,
      workflowDefinitionId: input.workflowDefinitionId,
      origin: "automation",
    });
    return { status: "created" as const, runId };
  }
}

export async function drainAutomationRuns(
  env: GuildEnv,
  limit = AUTOMATION_BATCH_LIMIT,
): Promise<readonly AutomationTickOutcome[]> {
  const runtime = new DurableAutomationRuntime(
    new PostgresAutomationRuntimeRepository(env),
    new GuildAutomationAgentRunPort(env),
    createConfiguredAutomationPlanner(env),
    { workerId: `guild-automation:${crypto.randomUUID()}` },
  );
  const outcomes = await runtime.runBatch(limit);
  await reconcileAutomationRuns(env, limit);
  return outcomes;
}

export async function reconcileAutomationRuns(env: GuildEnv, limit = 100): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Automation reconciliation limit must be between 1 and 500.");
  }
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    async (connection) => {
      const terminal = (await connection.query<{
        id: string;
        requested_by_actor_id: string;
        agent_status: "succeeded" | "failed" | "killed";
      }>(
        `SELECT request.id::text, request.requested_by_actor_id::text,
                run.status AS agent_status
           FROM workflow_run_requests request
           JOIN agent_runs run
             ON run.guild_id = request.guild_id AND run.id = request.agent_run_id
          WHERE request.guild_id = $1 AND request.status = 'running'
            AND run.status IN ('succeeded', 'failed', 'killed')
          ORDER BY request.updated_at, request.id
          FOR UPDATE OF request SKIP LOCKED LIMIT $2`,
        [env.GUILD_ID, limit],
      )).rows;
      for (const item of terminal) {
        const status = item.agent_status === "succeeded"
          ? "succeeded"
          : item.agent_status === "killed" ? "cancelled" : "failed";
        const updated = await connection.query(
          `UPDATE workflow_run_requests request
              SET status = $3, output = CASE WHEN $3 = 'succeeded'
                    THEN jsonb_build_object('agentRunId', request.agent_run_id::text, 'verified', true)
                    ELSE NULL END,
                  error_code = CASE WHEN $3 = 'succeeded' THEN NULL ELSE $4 END,
                  error_message = CASE WHEN $3 = 'succeeded' THEN NULL
                    WHEN $3 = 'cancelled' THEN 'The governed Agent run was stopped.'
                    ELSE 'The governed Agent run failed.' END,
                  finished_at = now(), updated_at = now()
            WHERE request.guild_id = $1 AND request.id = $2 AND request.status = 'running'`,
          [env.GUILD_ID, item.id, status, item.agent_status],
        );
        if (updated.rowCount !== 1) continue;
        await new GuildPostgresRepository(connection, env.GUILD_ID).appendChronicle(
          makeChronicleEvent(
            env.GUILD_ID,
            item.requested_by_actor_id,
            `automation.run.${status}`,
            "workflow_run_request",
            item.id,
            { agentStatus: item.agent_status, source: "guild-maintenance" },
          ),
        );
      }
      return terminal.length;
    },
  );
}
