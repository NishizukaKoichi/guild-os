import {
  authorizeAgent,
  intersectAgentLimits,
  type AgentLimits,
  type AgentRun,
  type AgentRunResult,
  type AgentRunUsage,
  type ApprovalStatus,
  type Permission,
  type JsonValue,
  type RiskLevel,
  type SecuredResource,
} from "@guild-os/domain";
import {
  agentRunActionPolicy,
  GuildAgentRunRepository,
  GuildCollectiveRepository,
  GuildOperationsRepository,
  GuildPostgresRepository,
  withGuildTransaction,
  type ExternalAgentActionExecutionRecord,
  type ExternalAgentActionScope,
  type StoredAgentRunDetail,
} from "@guild-os/postgres";
import {
  executeGuildAgentAction,
  type GuildAgentActionExecutionRecord,
  type GuildAgentExternalWriteIdempotency,
  type GuildAgentExternalWriteScope,
  type GuildAgentKillSwitch,
} from "./agent-service.js";
import { deliverSignedWebhook } from "./agent-webhook.js";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { createConfiguredConnectionAdapter } from "./configured-connection.js";

const ZERO_USAGE: AgentRunUsage = {
  budgetMinor: 0,
  tokens: 0,
  durationSeconds: 0,
  steps: 0,
  retries: 0,
  delegationDepth: 0,
};

export interface GuildAgentRuntimeOutcome {
  status: "succeeded" | "killed";
  result: AgentRunResult;
  usage: AgentRunUsage;
}

export interface GuildAgentRuntimeState {
  status: AgentRun["status"];
  riskLevel: RiskLevel;
  workflowInstanceId: string;
  approvalStatus: ApprovalStatus | null;
}

function resource(run: AgentRun): SecuredResource {
  return {
    id: run.id,
    guildId: run.guildId,
    spaceId: run.spaceId,
    ownerIdentityId: run.ownerIdentityId,
    visibility: run.visibility,
    classification: run.classification,
    allowedIdentityIds: run.allowedIdentityIds,
  };
}

function event(
  run: AgentRun,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
) {
  return makeChronicleEvent(
    run.guildId,
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    details,
    resource(run),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Agent action failure.";
}

function connectionOutput(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Connection returned a non-JSON result.");
  return JSON.parse(encoded) as JsonValue;
}

async function hashHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deterministicUuid(namespace: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(namespace),
  )).slice(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentConnectorPermissions(
  run: StoredAgentRunDetail,
  permissions: readonly Permission[],
): ReadonlySet<Permission> {
  const snapshot = new Set(run.connectorPermissionsSnapshot);
  return new Set(permissions.filter((permission) => snapshot.has(permission)));
}

class PostgresKillSwitch implements GuildAgentKillSwitch {
  readonly #env: GuildEnv;
  readonly #guildId: string;

  constructor(env: GuildEnv, guildId: string) {
    this.#env = env;
    this.#guildId = guildId;
  }

  isKillRequested(runId: string): Promise<boolean> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      (connection) => new GuildAgentRunRepository(connection, this.#guildId)
        .isKillRequested(runId),
    );
  }
}

class PostgresExternalWriteIdempotency implements GuildAgentExternalWriteIdempotency {
  readonly #env: GuildEnv;
  readonly #guildId: string;

  constructor(env: GuildEnv, guildId: string) {
    this.#env = env;
    this.#guildId = guildId;
  }

  async runOnce(
    scope: GuildAgentExternalWriteScope,
    operation: () => Promise<GuildAgentActionExecutionRecord>,
  ): Promise<GuildAgentActionExecutionRecord> {
    const databaseScope = scope as ExternalAgentActionScope;
    const claim = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      (connection) => new GuildAgentRunRepository(connection, this.#guildId)
        .claimExternalAction(databaseScope),
    );
    if (claim.state === "completed") return claim.record;

    try {
      const record = await operation();
      await withGuildTransaction(
        this.#env.HYPERDRIVE.connectionString,
        this.#guildId,
        (connection) => new GuildAgentRunRepository(connection, this.#guildId)
          .completeExternalAction(databaseScope, record as ExternalAgentActionExecutionRecord),
      );
      return record;
    } catch (error) {
      await withGuildTransaction(
        this.#env.HYPERDRIVE.connectionString,
        this.#guildId,
        (connection) => new GuildAgentRunRepository(connection, this.#guildId)
          .failExternalAction(databaseScope, errorText(error)),
      );
      throw error;
    }
  }
}

function boundedFailureUsage(run: StoredAgentRunDetail, startedAt: number): AgentRunUsage {
  return {
    budgetMinor: run.usage.budgetMinor,
    tokens: run.usage.tokens,
    durationSeconds: Math.max(
      run.usage.durationSeconds,
      Math.min(run.limits.maxDurationSeconds, Math.ceil((Date.now() - startedAt) / 1_000)),
    ),
    steps: run.usage.steps,
    retries: run.usage.retries,
    delegationDepth: run.usage.delegationDepth,
  };
}

export class GuildAgentActionRuntime {
  readonly #env: GuildEnv;
  readonly #guildId: string;

  constructor(env: GuildEnv, guildId: string) {
    this.#env = env;
    this.#guildId = guildId;
  }

  async getState(runId: string): Promise<GuildAgentRuntimeState> {
    const run = await this.#getRun(runId);
    return {
      status: run.status,
      riskLevel: run.riskLevel,
      workflowInstanceId: run.workflowInstanceId,
      approvalStatus: run.approval?.status ?? null,
    };
  }

  async execute(runId: string, workflowInstanceId: string): Promise<GuildAgentRuntimeOutcome> {
    const prepared = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#guildId);
        const before = await repository.getRunDetail(runId);
        if (before.workflowInstanceId !== workflowInstanceId) {
          throw new Error("Workflow instance does not own this Agent run.");
        }
        const connector = before.connectorId === null
          ? null
          : await repository.getConnector(before.connectorId);
        const snapshot = await new GuildPostgresRepository(
          connection,
          this.#guildId,
        ).loadAuthorizationSnapshot();
        if (connector) {
          if (connector.status !== "active") {
            throw new Error("Agent action Connection is no longer active.");
          }
          if (connector.writeRiskLevel !== before.riskLevel) {
            throw new Error("Agent action Connection risk policy changed or does not match.");
          }
          const permissions = currentConnectorPermissions(
            before,
            connector.capabilityPermissions,
          );
          if (!connector.deploymentManaged) {
            const connectorResource: SecuredResource = {
              id: connector.id,
              guildId: connector.guildId,
              spaceId: connector.spaceId,
              ownerIdentityId: connector.ownerIdentityId,
              visibility: connector.visibility,
              classification: connector.classification,
              allowedIdentityIds: connector.allowedIdentityIds,
            };
            for (const permission of agentRunActionPolicy(before.plan.action.kind).permissions) {
              authorizeAgent(snapshot, {
                agentIdentityId: before.agentIdentityId,
                requesterIdentityId: before.requesterIdentityId,
                permission,
                workflowPermissions: new Set(before.workflowPermissions),
                connectorPermissions: permissions,
                resource: connectorResource,
              });
            }
          }
        }
        const delegationChain = before.plan.action.kind === "agent_delegate"
          ? await repository.getDelegationChain(before.id)
          : undefined;
        const run = before.status === "running"
          ? before
          : await repository.claimExecution(runId, workflowInstanceId);
        return { run, snapshot, connector, delegationChain };
      },
    );

    const { run, snapshot, connector } = prepared;
    const connectorPermissions = connector === null
      ? new Set(run.connectorPermissionsSnapshot)
      : currentConnectorPermissions(run, connector.capabilityPermissions);
    const outcome = await executeGuildAgentAction({
      run,
      snapshot,
      workflowPermissions: new Set(run.workflowPermissions),
      connectorPermissions,
      connectorWriteRiskLevel: connector?.writeRiskLevel ?? null,
      approval: run.approval,
      approvalVotes: run.votes,
      handlers: this.#handlers(run, connector),
      killSwitch: new PostgresKillSwitch(this.#env, this.#guildId),
      externalWriteIdempotency: new PostgresExternalWriteIdempotency(
        this.#env,
        this.#guildId,
      ),
      ...(prepared.delegationChain === undefined
        ? {}
        : { delegationChainAgentIdentityIds: prepared.delegationChain }),
    });

    const status = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          run.agentIdentityId,
        ]);
        return new GuildAgentRunRepository(connection, this.#guildId).completeExecution(
          run.id,
          workflowInstanceId,
          outcome.result,
          outcome.usage,
          event(run, run.agentIdentityId, "agent.run.succeeded", "agent_run", run.id, {
            resultKind: outcome.result.kind,
            completedAfterKill: outcome.completedAfterKill,
            source: "agent-workflow",
          }),
        );
      },
    );
    return { status, result: outcome.result, usage: outcome.usage };
  }

  async fail(
    runId: string,
    workflowInstanceId: string,
    message: string,
    startedAt: number,
  ): Promise<void> {
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#guildId);
        const run = await repository.getRunDetail(runId);
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          run.agentIdentityId,
        ]);
        await repository.failExecution(
          runId,
          workflowInstanceId,
          message,
          boundedFailureUsage(run, startedAt),
          event(run, run.agentIdentityId, "agent.run.failed", "agent_run", run.id, {
            reason: message,
            source: "agent-workflow",
          }),
        );
      },
    );
  }

  async #getRun(runId: string): Promise<StoredAgentRunDetail> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      (connection) => new GuildAgentRunRepository(connection, this.#guildId)
        .getRunDetail(runId),
    );
  }

  #handlers(
    run: StoredAgentRunDetail,
    connector: Awaited<ReturnType<GuildAgentRunRepository["getConnector"]>> | null,
  ) {
    return {
      memory_search: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "memory_search" }>,
      ) => {
        const memories = await withGuildTransaction(
          this.#env.HYPERDRIVE.connectionString,
          this.#guildId,
          async (connection) => {
            await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
              run.agentIdentityId,
            ]);
            return new GuildCollectiveRepository(connection, this.#guildId)
              .searchAuthorizedMemories(run.agentIdentityId, action.query, action.locale, 24);
          },
        );
        return {
          result: {
            kind: "memory_search" as const,
            memoryIds: memories.map((memory) => memory.id),
            completedAt: new Date().toISOString(),
          },
          authorizedResources: memories.map((memory): SecuredResource => ({
            id: memory.id,
            guildId: memory.guildId,
            spaceId: memory.spaceId,
            ownerIdentityId: memory.ownerActorId,
            visibility: memory.visibility,
            classification: memory.classification,
            allowedIdentityIds: memory.allowedActorIds,
          })),
          usage: { ...ZERO_USAGE, steps: run.plan.steps.length },
        };
      },
      activity_draft: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "activity_draft" }>,
      ) => {
        const activityId = await deterministicUuid(`activity-draft:${run.id}`);
        await withGuildTransaction(
          this.#env.HYPERDRIVE.connectionString,
          this.#guildId,
          async (connection) => {
            await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
              run.agentIdentityId,
            ]);
            const existing = (await connection.query<{
              title: string;
              description: string;
              type: string;
              status: string;
            }>(
              `SELECT title, description, type, status FROM activities
                WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
              [this.#guildId, activityId],
            )).rows[0];
            if (existing) {
              if (existing.title !== action.title || existing.description !== action.description ||
                  existing.type !== action.activityType || existing.status !== "proposed") {
                throw new Error("Activity draft idempotency identity contains different work.");
              }
              return;
            }
            await new GuildCollectiveRepository(connection, this.#guildId).createActivity({
              id: activityId,
              actorId: run.agentIdentityId,
              parentActivityId: null,
              spaceId: run.spaceId,
              ownerActorId: run.requesterIdentityId,
              assigneeActorId: null,
              type: action.activityType,
              title: action.title,
              description: action.description,
              status: "proposed",
              visibility: run.visibility,
              classification: run.classification,
              allowedActorIds: run.allowedIdentityIds ?? [],
              sourceIds: [],
              startsAt: null,
              dueAt: null,
              position: 0,
              chronicleEvent: event(
                run,
                run.agentIdentityId,
                "activity.draft.created",
                "activity",
                activityId,
                { agentRunId: run.id },
              ),
            });
          },
        );
        return {
          result: { kind: "activity_draft" as const, activityId, completedAt: new Date().toISOString() },
          usage: { ...ZERO_USAGE, steps: run.plan.steps.length },
        };
      },
      agent_delegate: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "agent_delegate" }>,
      ) => {
        const childRunId = await deterministicUuid(
          `agent-delegation:${run.id}:${action.targetAgentActorId}`,
        );
        const chain = await withGuildTransaction(
          this.#env.HYPERDRIVE.connectionString,
          this.#guildId,
          (connection) => new GuildAgentRunRepository(connection, this.#guildId)
            .getDelegationChain(run.id),
        );
        const depth = chain.length;
        const childRun = await this.#childRun(run, action.targetAgentActorId, action.objective, childRunId);
        await withGuildTransaction(
          this.#env.HYPERDRIVE.connectionString,
          this.#guildId,
          async (connection) => {
            await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
              run.agentIdentityId,
            ]);
            await new GuildAgentRunRepository(connection, this.#guildId).createDelegatedRun({
              run: childRun,
              approval: null,
              parentRunId: run.id,
              fromAgentActorId: run.agentIdentityId,
              toAgentActorId: action.targetAgentActorId,
              requesterActorId: run.requesterIdentityId,
              objective: action.objective,
              permissionSnapshot: run.workflowPermissions,
              depth,
              chronicleEvent: event(
                childRun,
                run.agentIdentityId,
                "agent.run.planned",
                "agent_run",
                childRunId,
                { parentRunId: run.id, source: "agent-delegation" },
              ),
              delegationChronicleEvent: event(
                run,
                run.agentIdentityId,
                "agent.run.delegated",
                "agent_run",
                run.id,
                { childRunId, targetAgentActorId: action.targetAgentActorId, depth },
              ),
            });
          },
        );
        return {
          result: { kind: "agent_delegate" as const, childRunId, completedAt: new Date().toISOString() },
          usage: { ...ZERO_USAGE, steps: run.plan.steps.length, delegationDepth: depth },
        };
      },
      connection_invoke: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "connection_invoke" }>,
        context: { effectiveLimits: AgentLimits; signal: AbortSignal },
      ) => {
        if (context.signal.aborted) {
          throw new Error("Connection action was stopped before invocation.");
        }
        if (!connector || connector.id !== run.connectorId || connector.deploymentManaged) {
          throw new Error("Connection action requires an active purchaser-configured Connection.");
        }
        const invoked = await createConfiguredConnectionAdapter(this.#env, connector).invoke({
          capabilityId: action.capabilityId,
          input: action.input,
          idempotencyKey: run.idempotencyKey,
        });
        if (context.signal.aborted) {
          throw new Error("Connection action was stopped during invocation.");
        }
        return {
          result: {
            kind: "connection_invoke" as const,
            capabilityId: invoked.capabilityId,
            statusCode: invoked.statusCode,
            output: connectionOutput(invoked.output),
            completedAt: new Date().toISOString(),
          },
          usage: { ...ZERO_USAGE, steps: run.plan.steps.length },
        };
      },
      https_webhook: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "https_webhook" }>,
        context: { effectiveLimits: AgentLimits; signal: AbortSignal },
      ) => {
        if (context.signal.aborted) throw new Error("Webhook action was stopped before delivery.");
        if (!connector || connector.id !== this.#env.GUILD_WEBHOOK_CONNECTOR_ID ||
            connector.kind !== "https_webhook" || !connector.deploymentManaged ||
            connector.endpointUrl !== this.#env.GUILD_WEBHOOK_URL ||
            connector.secretReference !== "GUILD_WEBHOOK_SIGNING_SECRET") {
          throw new Error("Webhook Connection does not match the immutable deployment endpoint.");
        }
        const delivered = await deliverSignedWebhook(
          connector.endpointUrl,
          this.#env.GUILD_WEBHOOK_SIGNING_SECRET,
          {
            runId: run.id,
            guildId: run.guildId,
            agentIdentityId: run.agentIdentityId,
            requesterIdentityId: run.requesterIdentityId,
            eventType: action.eventType,
            payloadJson: JSON.stringify(action.payload),
            idempotencyKey: run.idempotencyKey,
            plannedSteps: run.plan.steps.length,
            endpointUrl: connector.endpointUrl,
            effectiveLimits: context.effectiveLimits,
          },
        );
        return {
          result: {
            kind: "https_webhook" as const,
            statusCode: delivered.statusCode,
            deliveredAt: delivered.deliveredAt,
          },
          usage: {
            ...ZERO_USAGE,
            durationSeconds: delivered.durationSeconds,
            steps: run.plan.steps.length,
          },
        };
      },
      federation_publish: async (
        action: Extract<AgentRun["plan"]["action"], { kind: "federation_publish" }>,
      ) => {
        const deliveryId = await deterministicUuid(`federation-delivery:${run.id}`);
        const delivery = await withGuildTransaction(
          this.#env.HYPERDRIVE.connectionString,
          this.#guildId,
          async (connection) => {
            await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
              run.agentIdentityId,
            ]);
            const operations = new GuildOperationsRepository(connection, this.#guildId);
            const link = await operations.getFederationLink(action.federationLinkId, true);
            if (link.status !== "active" ||
                (link.direction !== "outbound" && link.direction !== "bidirectional")) {
              throw new Error("Federation publication requires an active outbound link.");
            }
            const references = await operations.listFederatedResourceReferences(link.id, 500);
            const byId = new Map(references.map((reference) => [reference.grant.id, reference]));
            if (new Set(action.grantIds).size !== action.grantIds.length ||
                action.grantIds.some((grantId) => !byId.has(grantId))) {
              throw new Error("Federation publication contains an inactive or implicit grant.");
            }
            const firstGrantId = action.grantIds[0];
            if (!firstGrantId) throw new Error("Federation publication requires a grant.");
            return operations.enqueueFederationDelivery({
              id: deliveryId,
              federationLinkId: link.id,
              federationGrantId: firstGrantId,
              eventType: "guild.federation.resources.published",
              payload: {
                sourceGuildId: run.guildId,
                agentRunId: run.id,
                remoteGuildId: link.remoteGuildId,
                grants: action.grantIds.map((grantId) => {
                  const reference = byId.get(grantId)!;
                  return {
                    grantId,
                    resourceType: reference.grant.resourceType,
                    resourceId: reference.grant.resourceId,
                    permission: reference.grant.permission,
                  };
                }),
              },
              idempotencyKey: `agent-federation:${run.id}:${run.requestHash}`,
              actorId: run.agentIdentityId,
              chronicleEvent: event(
                run,
                run.agentIdentityId,
                "federation.delivery.enqueued",
                "federation_delivery",
                deliveryId,
                { agentRunId: run.id, federationLinkId: link.id },
              ),
            });
          },
        );
        return {
          result: {
            kind: "federation_publish" as const,
            deliveryId: delivery.value.id,
            completedAt: new Date().toISOString(),
          },
          usage: { ...ZERO_USAGE, steps: run.plan.steps.length },
        };
      },
    };
  }

  async #childRun(
    parent: StoredAgentRunDetail,
    targetAgentId: string,
    objective: string,
    childRunId: string,
  ): Promise<AgentRun> {
    const target = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#guildId,
      async (connection) => {
        const snapshot = await new GuildPostgresRepository(
          connection,
          this.#guildId,
        ).loadAuthorizationSnapshot();
        const profile = snapshot.agents.find((candidate) => candidate.identityId === targetAgentId);
        if (!profile || profile.status !== "active") throw new Error("Delegated Agent is stopped.");
        return {
          limits: intersectAgentLimits(profile.limits, snapshot.constitution.agentDefaults),
        };
      },
    );
    const now = new Date().toISOString();
    const plan: AgentRun["plan"] = {
      objective,
      expectedOutcome: "Return authorized Guild Memory that helps complete the delegated objective.",
      steps: ["Search authorized Guild Memory for the delegated objective"],
      connectorId: null,
      questId: parent.questId,
      action: { kind: "memory_search", query: objective.slice(0, 500), locale: "en" },
      estimatedUsage: {
        ...ZERO_USAGE,
        durationSeconds: Math.min(60, target.limits.maxDurationSeconds),
        steps: 1,
      },
    };
    return {
      id: childRunId,
      guildId: parent.guildId,
      spaceId: parent.spaceId,
      ownerIdentityId: parent.requesterIdentityId,
      visibility: parent.visibility,
      classification: parent.classification,
      allowedIdentityIds: parent.allowedIdentityIds,
      agentIdentityId: targetAgentId,
      requesterIdentityId: parent.requesterIdentityId,
      connectorId: null,
      questId: parent.questId,
      riskLevel: 0,
      status: "planning",
      source: parent.source,
      plan,
      result: null,
      errorMessage: null,
      limits: target.limits,
      usage: ZERO_USAGE,
      workflowInstanceId: `agent-run-${childRunId}`,
      idempotencyKey: `agent-delegation:${parent.id}:${targetAgentId}`,
      requestHash: await hashHex(JSON.stringify({ parentRunId: parent.id, targetAgentId, plan })),
      estimatedBudgetMinor: 0,
      killRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }
}
