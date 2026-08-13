import {
  PERMISSIONS,
  assertConnectionKind,
  assertAgentLimits,
  assertAgentRunPlan,
  assertNonBlank,
  assertUsageWithinLimits,
  type AgentApprovalRequest,
  type AgentApprovalVote,
  type AgentLimits,
  type AgentRun,
  type AgentRunPlan,
  type AgentRunResult,
  type AgentRunUsage,
  type ApprovalStatus,
  type ChronicleEvent,
  type Classification,
  type Connector,
  type ConnectorStatus,
  type JsonObject,
  type Permission,
  type RiskLevel,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_OUTBOX_TOPICS = [
  "agent.workflow.start",
  "agent.workflow.signal",
  "agent.workflow.terminate",
] as const;

type AgentActionKind = AgentRunPlan["action"]["kind"];
export type StoredAgentActionKind =
  | "memory.search"
  | "activity.draft"
  | "agent.delegate"
  | "connection.invoke"
  | "https_webhook.post"
  | "federation.publish";

export const AGENT_RUN_ACTION_POLICIES = {
  memory_search: {
    storedKind: "memory.search",
    riskLevels: [0],
    permissions: ["memory.read"],
    external: false,
  },
  activity_draft: {
    storedKind: "activity.draft",
    riskLevels: [1],
    permissions: ["activity.create"],
    external: false,
  },
  agent_delegate: {
    storedKind: "agent.delegate",
    riskLevels: [1],
    permissions: ["agent.run"],
    external: false,
  },
  connection_invoke: {
    storedKind: "connection.invoke",
    riskLevels: [0, 1, 2, 3],
    permissions: ["connection.execute"],
    external: true,
  },
  https_webhook: {
    storedKind: "https_webhook.post",
    riskLevels: [2],
    permissions: ["integration.execute"],
    external: true,
  },
  federation_publish: {
    storedKind: "federation.publish",
    riskLevels: [2, 3],
    permissions: ["federation.read", "integration.execute"],
    external: true,
  },
} as const satisfies Record<AgentActionKind, {
  storedKind: StoredAgentActionKind;
  riskLevels: readonly RiskLevel[];
  permissions: readonly Permission[];
  external: boolean;
}>;

export function agentRunActionPolicy(kind: AgentActionKind) {
  return AGENT_RUN_ACTION_POLICIES[kind];
}

export type AgentOutboxTopic = (typeof AGENT_OUTBOX_TOPICS)[number];

export interface AgentRunListCursor {
  updatedAt: string;
  id: string;
}

export interface StoredAgentRun extends AgentRun {
  agentDisplayName: string;
  requesterDisplayName: string;
  connectorName: string;
  actionKind: StoredAgentActionKind;
  parentRunId: string | null;
  workflowDefinitionId: string | null;
  externalAttemptedAt: string | null;
  approval: AgentApprovalRequest | null;
  workflowPermissions: readonly Permission[];
  connectorPermissionsSnapshot: readonly Permission[];
}

export interface StoredAgentRunDetail extends StoredAgentRun {
  votes: readonly AgentApprovalVote[];
}

export interface AgentRunListPage {
  items: readonly StoredAgentRun[];
  nextCursor: AgentRunListCursor | null;
}

export interface RunnableAgent {
  identityId: string;
  displayName: string;
  model: string;
  spaceIds: readonly string[];
  limits: AgentLimits;
}

export interface EnsureDeploymentWebhookInput {
  id: string;
  name: string;
  endpointUrl: string;
  rootOwnerIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface CreateAgentRunInput {
  run: AgentRun;
  approval: AgentApprovalRequest | null;
  workflowPermissions?: readonly Permission[];
  parentRunId?: string | null;
  workflowDefinitionId?: string | null;
  chronicleEvent: ChronicleEvent;
}

export interface CreateDelegatedAgentRunInput extends CreateAgentRunInput {
  parentRunId: string;
  fromAgentActorId: string;
  toAgentActorId: string;
  requesterActorId: string;
  objective: string;
  permissionSnapshot: readonly Permission[];
  depth: number;
  delegationChronicleEvent: ChronicleEvent;
}

export interface ExternalAgentActionScope {
  runId: string;
  idempotencyKey: string;
  requestHash: string;
  actionKind: "https_webhook" | "federation_publish";
}

export interface ExternalAgentActionExecutionRecord {
  result: AgentRunResult;
  usage: AgentRunUsage;
}

export type ExternalAgentActionClaim =
  | { state: "execute" }
  | { state: "completed"; record: ExternalAgentActionExecutionRecord };

export interface ReviewAgentRunInput {
  runId: string;
  approvalRequestId: string;
  approverIdentityId: string;
  verdict: "approve" | "reject";
  reason: string;
  reauthenticatedAt: string | null;
  chronicleEvent: ChronicleEvent;
}

export interface AgentApprovalOutcome {
  runStatus: AgentRun["status"];
  approvalStatus: ApprovalStatus;
  approvalCount: number;
  requiredApprovals: number;
  workflowInstanceId: string;
}

export interface AgentWorkflowMessage {
  outboxId: string;
  topic: AgentOutboxTopic;
  payload: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
  attemptCount: number;
}

type ConnectorRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  name: string;
  kind: string;
  status: ConnectorStatus;
  capability_permissions: string[];
  endpoint_url: string | null;
  secret_reference: string | null;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  deployment_managed: boolean;
  description: string;
  provider: string;
  configuration: JsonObject;
  auth_kind: NonNullable<Connector["authKind"]>;
  write_risk_level: RiskLevel;
  health_status: NonNullable<Connector["healthStatus"]>;
  last_checked_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type AgentRunRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  agent_identity_id: string;
  requester_identity_id: string;
  connector_id: string | null;
  quest_id: string | null;
  risk_level: RiskLevel;
  status: AgentRun["status"];
  source: AgentRun["source"];
  plan: unknown;
  result: unknown;
  error_message: string | null;
  limits: unknown;
  usage: unknown;
  workflow_instance_id: string;
  idempotency_key: string;
  request_hash: string;
  action_kind: StoredAgentActionKind;
  parent_run_id: string | null;
  workflow_definition_id: string | null;
  external_attempted_at: string | null;
  estimated_budget_minor: number;
  kill_requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  agent_display_name: string;
  requester_display_name: string;
  connector_name: string;
  approval_id: string | null;
  approval_risk_level: RiskLevel | null;
  approval_action_kind: string | null;
  approval_required_approvals: number | null;
  approval_count: number | null;
  approval_reauthentication_required: boolean | null;
  approval_status: ApprovalStatus | null;
  approval_expires_at: string | null;
  approval_created_at: string | null;
  approval_updated_at: string | null;
  workflow_permissions: string[];
  connector_permissions_snapshot: string[];
};

type ApprovalVoteRow = QueryResultRow & {
  guild_id: string;
  approval_request_id: string;
  approver_identity_id: string;
  verdict: "approve" | "reject";
  reason: string;
  reauthenticated_at: string | null;
  created_at: string;
};

type OutboxRow = QueryResultRow & {
  id: string;
  topic: string;
  payload: unknown;
  idempotency_key: string;
  attempt_count: number;
};

type ExternalActionLedgerRow = QueryResultRow & {
  status: "processing" | "completed" | "failed" | "cancelled" | "pending";
  payload: unknown;
  last_error: string | null;
};

type RunnableAgentRow = QueryResultRow & {
  identity_id: string;
  display_name: string;
  model: string;
  space_ids: string[];
  limits: unknown;
};

const knownPermissions = new Set<string>(PERMISSIONS);

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return timestamp.toISOString();
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function parsePermissions(values: readonly string[]): Permission[] {
  if (!values.every((value) => knownPermissions.has(value))) {
    throw new Error("Database contains an unknown Connector permission.");
  }
  return values as Permission[];
}

function connectorFromRow(row: ConnectorRow): Connector {
  assertConnectionKind(row.kind);
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    name: row.name,
    kind: row.kind,
    status: row.status,
    capabilityPermissions: parsePermissions(row.capability_permissions),
    endpointUrl: row.endpoint_url,
    secretReference: row.secret_reference,
    description: row.description,
    provider: row.provider,
    configuration: row.configuration,
    authKind: row.auth_kind,
    writeRiskLevel: row.write_risk_level,
    healthStatus: row.health_status,
    lastCheckedAt: optionalTimestamp(row.last_checked_at),
    deploymentManaged: row.deployment_managed,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function resultFrom(value: unknown): AgentRunResult | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Database contains an invalid Agent run result.");
  }
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "memory_search":
      if (!Array.isArray(candidate.memoryIds) ||
          candidate.memoryIds.length > 50 ||
          new Set(candidate.memoryIds).size !== candidate.memoryIds.length ||
          !candidate.memoryIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) ||
          typeof candidate.completedAt !== "string") break;
      return {
        kind: "memory_search",
        memoryIds: candidate.memoryIds,
        completedAt: isoTimestamp(candidate.completedAt),
      };
    case "activity_draft":
      if (typeof candidate.activityId !== "string" || !UUID_PATTERN.test(candidate.activityId) ||
          typeof candidate.completedAt !== "string") break;
      return {
        kind: "activity_draft",
        activityId: candidate.activityId,
        completedAt: isoTimestamp(candidate.completedAt),
      };
    case "agent_delegate":
      if (typeof candidate.childRunId !== "string" || !UUID_PATTERN.test(candidate.childRunId) ||
          typeof candidate.completedAt !== "string") break;
      return {
        kind: "agent_delegate",
        childRunId: candidate.childRunId,
        completedAt: isoTimestamp(candidate.completedAt),
      };
    case "https_webhook":
      if (!Number.isSafeInteger(candidate.statusCode) ||
          (candidate.statusCode as number) < 200 || (candidate.statusCode as number) >= 300 ||
          typeof candidate.deliveredAt !== "string") break;
      return {
        kind: "https_webhook",
        statusCode: candidate.statusCode as number,
        deliveredAt: isoTimestamp(candidate.deliveredAt),
      };
    case "federation_publish":
      if (typeof candidate.deliveryId !== "string" || !UUID_PATTERN.test(candidate.deliveryId) ||
          typeof candidate.completedAt !== "string") break;
      return {
        kind: "federation_publish",
        deliveryId: candidate.deliveryId,
        completedAt: isoTimestamp(candidate.completedAt),
      };
  }
  throw new Error("Database contains an invalid Agent run result.");
}

function usageFrom(value: unknown): AgentRunUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Database contains invalid Agent usage.");
  }
  const candidate = value as Record<string, unknown>;
  const usage = {
    budgetMinor: candidate.budgetMinor,
    tokens: candidate.tokens,
    durationSeconds: candidate.durationSeconds,
    steps: candidate.steps,
    retries: candidate.retries,
    delegationDepth: candidate.delegationDepth,
  };
  if (!Object.values(usage).every((item) => typeof item === "number")) {
    throw new Error("Database contains invalid Agent usage fields.");
  }
  return usage as AgentRunUsage;
}

function runFromRow(row: AgentRunRow): StoredAgentRun {
  const plan = row.plan as AgentRun["plan"];
  const limits = row.limits as AgentRun["limits"];
  assertAgentRunPlan(plan);
  assertAgentLimits(limits);
  const usage = usageFrom(row.usage);
  assertUsageWithinLimits(limits, usage);
  const result = resultFrom(row.result);
  const policy = agentRunActionPolicy(plan.action.kind);
  if (policy.storedKind !== row.action_kind ||
      !(policy.riskLevels as readonly RiskLevel[]).includes(row.risk_level)) {
    throw new Error("Database Agent action metadata does not match its plan or risk.");
  }
  if (result !== null && result.kind !== plan.action.kind) {
    throw new Error("Database Agent result does not match its planned action.");
  }
  const approval = row.approval_id === null ? null : {
    id: row.approval_id,
    guildId: row.guild_id,
    agentRunId: row.id,
    riskLevel: row.approval_risk_level!,
    actionKind: row.approval_action_kind!,
    requiredApprovals: row.approval_required_approvals!,
    approvalCount: row.approval_count!,
    reauthenticationRequired: row.approval_reauthentication_required!,
    status: row.approval_status!,
    expiresAt: isoTimestamp(row.approval_expires_at!),
    createdAt: isoTimestamp(row.approval_created_at!),
    updatedAt: isoTimestamp(row.approval_updated_at!),
  } satisfies AgentApprovalRequest;
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    agentIdentityId: row.agent_identity_id,
    requesterIdentityId: row.requester_identity_id,
    connectorId: row.connector_id,
    questId: row.quest_id,
    riskLevel: row.risk_level,
    status: row.status,
    source: row.source,
    plan,
    result,
    errorMessage: row.error_message,
    limits,
    usage,
    workflowInstanceId: row.workflow_instance_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    estimatedBudgetMinor: row.estimated_budget_minor,
    killRequestedAt: optionalTimestamp(row.kill_requested_at),
    startedAt: optionalTimestamp(row.started_at),
    finishedAt: optionalTimestamp(row.finished_at),
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    agentDisplayName: row.agent_display_name,
    requesterDisplayName: row.requester_display_name,
    connectorName: row.connector_name,
    actionKind: row.action_kind,
    parentRunId: row.parent_run_id,
    workflowDefinitionId: row.workflow_definition_id,
    externalAttemptedAt: optionalTimestamp(row.external_attempted_at),
    approval,
    workflowPermissions: parsePermissions(row.workflow_permissions),
    connectorPermissionsSnapshot: parsePermissions(row.connector_permissions_snapshot),
  };
}

function voteFromRow(row: ApprovalVoteRow): AgentApprovalVote {
  return {
    guildId: row.guild_id,
    approvalRequestId: row.approval_request_id,
    approverIdentityId: row.approver_identity_id,
    verdict: row.verdict,
    reason: row.reason,
    reauthenticatedAt: optionalTimestamp(row.reauthenticated_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

function assertPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Agent run page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

function isAgentOutboxTopic(value: string): value is AgentOutboxTopic {
  return (AGENT_OUTBOX_TOPICS as readonly string[]).includes(value);
}

export class GuildAgentRunRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async ensureDeploymentWebhook(input: EnsureDeploymentWebhookInput): Promise<boolean> {
    this.#assertEvent(input.chronicleEvent, input.rootOwnerIdentityId, "connector", input.id);
    assertNonBlank(input.name, "Connector name", 200);
    const existing = (await this.#connection.query<ConnectorRow>(
      `${this.#connectorSelect()} WHERE connector.id = $1 AND connector.guild_id = $2`,
      [input.id, this.#guildId],
    )).rows[0];
    const rootSpace = (await this.#connection.query<{ id: string }>(
      `SELECT id::text FROM spaces
        WHERE guild_id = $1 AND parent_space_id IS NULL AND status = 'active'`,
      [this.#guildId],
    )).rows[0];
    if (!rootSpace) throw new Error("The Guild root Space is missing.");
    if (existing) {
      const connector = connectorFromRow(existing);
      const exact = connector.name === input.name && connector.endpointUrl === input.endpointUrl &&
        connector.ownerIdentityId === input.rootOwnerIdentityId &&
        connector.spaceId === rootSpace.id && connector.deploymentManaged &&
        connector.secretReference === "GUILD_WEBHOOK_SIGNING_SECRET" &&
        connector.capabilityPermissions.length === 1 &&
        connector.capabilityPermissions[0] === "integration.execute";
      if (!exact) {
        throw new Error(
          "The deployment Webhook Connector ID already has different immutable configuration. " +
          "Provision a new Connector ID before changing its endpoint or scope.",
        );
      }
      return false;
    }
    await this.#connection.query(
      `INSERT INTO connectors
         (id, guild_id, space_id, owner_identity_id, name, kind, status,
          capability_permissions, secret_reference, endpoint_url, visibility,
          classification, allowed_identity_ids, deployment_managed, version)
       VALUES ($1, $2, $3, $4, $5, 'https_webhook', 'active',
               ARRAY['integration.execute'], 'GUILD_WEBHOOK_SIGNING_SECRET', $6,
               'space', 'internal', '{}', true, 1)`,
      [
        input.id,
        this.#guildId,
        rootSpace.id,
        input.rootOwnerIdentityId,
        input.name,
        input.endpointUrl,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return true;
  }

  async listConnectors(actorIdentityId: string): Promise<Connector[]> {
    const rows = (await this.#connection.query<ConnectorRow>(
      `WITH RECURSIVE ${this.#authorizationCtes("integration.read", "connector")}
       ${this.#connectorSelect()}
       CROSS JOIN connector_access access
       WHERE connector.guild_id = $1 AND connector.status <> 'revoked'
         AND ${this.#readPredicate("connector", "connector")}
       ORDER BY connector.name, connector.id`,
      [this.#guildId, actorIdentityId],
    )).rows;
    return rows.map(connectorFromRow);
  }

  async listActiveDeploymentConnectors(): Promise<Connector[]> {
    const rows = (await this.#connection.query<ConnectorRow>(
      `${this.#connectorSelect()}
        WHERE connector.guild_id = $1 AND connector.status = 'active'
          AND connector.deployment_managed = true
        ORDER BY connector.name, connector.id`,
      [this.#guildId],
    )).rows;
    return rows.map(connectorFromRow);
  }

  async getConnector(id: string, forUpdate = false): Promise<Connector> {
    const row = (await this.#connection.query<ConnectorRow>(
      `${this.#connectorSelect()}
        WHERE connector.guild_id = $1 AND connector.id = $2
        ${forUpdate ? "FOR UPDATE OF connector" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Connector was not found in this Guild.");
    return connectorFromRow(row);
  }

  async setConnectorStatus(
    connectorId: string,
    expectedVersion: number,
    status: "active" | "disabled",
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<number> {
    this.#assertEvent(chronicleEvent, actorIdentityId, "connector", connectorId);
    const connector = await this.getConnector(connectorId, true);
    if (!connector.deploymentManaged) throw new Error("Only deployment-managed Connectors are supported.");
    if (connector.status === "revoked") throw new Error("A revoked Connector cannot be restored.");
    if (connector.version !== expectedVersion) throw new Error("Connector changed. Reload before continuing.");
    if (connector.status === status) return connector.version;
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE connectors SET status = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, connectorId, status, expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Connector changed. Reload before continuing.");
    await this.#chronicle.appendChronicle(chronicleEvent);
    return version;
  }

  async listRuns(
    actorIdentityId: string,
    cursor: AgentRunListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<AgentRunListPage> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<AgentRunRow>(
      `WITH RECURSIVE ${this.#authorizationCtes("agent.read", "run")}
       ${this.#runSelect()}
       CROSS JOIN run_access access
       WHERE run.guild_id = $1 AND ${this.#readPredicate("run", "run")}
         AND ($3::timestamptz IS NULL OR (run.updated_at, run.id) < ($3::timestamptz, $4::uuid))
       ORDER BY run.updated_at DESC, run.id DESC LIMIT $5`,
      [
        this.#guildId,
        actorIdentityId,
        cursor?.updatedAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(runFromRow),
      nextCursor: rows.length > pageSize && last
        ? { updatedAt: isoTimestamp(last.updated_at), id: last.id }
        : null,
    };
  }

  async listRunnableAgents(spaceIds: readonly string[]): Promise<RunnableAgent[]> {
    if (spaceIds.length === 0) return [];
    if (spaceIds.length > 100 || new Set(spaceIds).size !== spaceIds.length) {
      throw new Error("Runnable Agent discovery accepts at most 100 unique Spaces.");
    }
    const rows = (await this.#connection.query<RunnableAgentRow>(
      `WITH RECURSIVE selected_spaces AS (
         SELECT id, parent_space_id FROM spaces
          WHERE guild_id = $1 AND status = 'active' AND id = ANY($2::uuid[])
       ), ancestors AS (
         SELECT id AS target_space_id, id AS ancestor_id, parent_space_id
           FROM selected_spaces
         UNION ALL
         SELECT ancestor.target_space_id, parent.id, parent.parent_space_id
           FROM ancestors ancestor
           JOIN spaces parent
             ON parent.guild_id = $1 AND parent.id = ancestor.parent_space_id
       ), eligible AS (
         SELECT identity_row.id AS identity_id, selected.id AS space_id
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
           JOIN agent_profiles profile
             ON profile.guild_id = identity_row.guild_id
            AND profile.identity_id = identity_row.id
           CROSS JOIN selected_spaces selected
          WHERE identity_row.guild_id = $1 AND identity_row.kind = 'agent'
            AND identity_row.status = 'active' AND membership_row.state = 'active'
            AND membership_row.clearance IN ('internal', 'confidential', 'restricted')
            AND profile.status = 'active' AND profile.tool_ids @> ARRAY['https_webhook']::text[]
            AND EXISTS (
              SELECT 1 FROM role_bindings binding_row
              JOIN role_permissions permission_row
                ON permission_row.guild_id = binding_row.guild_id
               AND permission_row.role_id = binding_row.role_id
             WHERE binding_row.guild_id = $1
               AND binding_row.identity_id = identity_row.id
               AND permission_row.permission = 'integration.execute'
               AND (binding_row.space_id IS NULL OR EXISTS (
                 SELECT 1 FROM ancestors ancestor
                  WHERE ancestor.target_space_id = selected.id
                    AND ancestor.ancestor_id = binding_row.space_id
               ))
            )
       )
       SELECT identity_row.id::text AS identity_id, identity_row.display_name,
              profile.model, array_agg(eligible.space_id::text ORDER BY eligible.space_id) AS space_ids,
              profile.limits
         FROM eligible
         JOIN identities identity_row
           ON identity_row.guild_id = $1 AND identity_row.id = eligible.identity_id
         JOIN agent_profiles profile
           ON profile.guild_id = identity_row.guild_id AND profile.identity_id = identity_row.id
        GROUP BY identity_row.id, identity_row.display_name, profile.model, profile.limits
        ORDER BY identity_row.display_name, identity_row.id
        LIMIT 100`,
      [this.#guildId, spaceIds],
    )).rows;
    return rows.map((row) => {
      const limits = row.limits as AgentLimits;
      assertAgentLimits(limits);
      return {
        identityId: row.identity_id,
        displayName: row.display_name,
        model: row.model,
        spaceIds: row.space_ids,
        limits,
      };
    });
  }

  async getRun(id: string, forUpdate = false): Promise<StoredAgentRun> {
    const row = (await this.#connection.query<AgentRunRow>(
      `${this.#runSelect()} WHERE run.guild_id = $1 AND run.id = $2
       ${forUpdate ? "FOR UPDATE OF run" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Agent run was not found in this Guild.");
    return runFromRow(row);
  }

  async getRunDetail(id: string): Promise<StoredAgentRunDetail> {
    const run = await this.getRun(id);
    const votes = run.approval === null ? [] : (await this.#connection.query<ApprovalVoteRow>(
      `SELECT guild_id::text, approval_request_id::text, approver_identity_id::text,
              verdict, reason, reauthenticated_at::text, created_at::text
         FROM approval_votes
        WHERE guild_id = $1 AND approval_request_id = $2
        ORDER BY created_at, approver_identity_id`,
      [this.#guildId, run.approval.id],
    )).rows.map(voteFromRow);
    return { ...run, votes };
  }

  async createRun(input: CreateAgentRunInput): Promise<boolean> {
    const { run } = input;
    this.#assertEvent(input.chronicleEvent, input.chronicleEvent.actorIdentityId, "agent_run", run.id);
    if (run.guildId !== this.#guildId || run.ownerIdentityId !== run.requesterIdentityId ||
        run.plan.connectorId !== run.connectorId || run.plan.questId !== run.questId) {
      throw new Error("Agent run crosses its Guild, owner, Connector, or Quest boundary.");
    }
    assertAgentRunPlan(run.plan);
    assertAgentLimits(run.limits);
    assertUsageWithinLimits(run.limits, run.plan.estimatedUsage);
    const policy = agentRunActionPolicy(run.plan.action.kind);
    if (!(policy.riskLevels as readonly RiskLevel[]).includes(run.riskLevel)) {
      throw new Error("Agent action risk does not match its planned action kind.");
    }
    if (policy.external !== (run.connectorId !== null)) {
      throw new Error(policy.external
        ? "External Agent actions require a Connection."
        : "Internal Agent actions cannot inherit a Connection.");
    }
    const workflowPermissions = input.workflowPermissions ?? policy.permissions;
    const workflowPermissionSet = new Set(workflowPermissions);
    if (workflowPermissionSet.size !== workflowPermissions.length ||
        !workflowPermissions.every((permission) => PERMISSIONS.includes(permission)) ||
        !policy.permissions.every((permission) => workflowPermissionSet.has(permission))) {
      throw new Error("Workflow permissions do not authorize every capability required by the Agent action.");
    }
    if (run.status === "awaiting_approval" && input.approval === null) {
      throw new Error("An Agent action awaiting approval requires an approval record.");
    }
    if (run.status !== "awaiting_approval" && input.approval !== null) {
      throw new Error("An Agent approval record requires awaiting-approval status.");
    }
    if (!["planning", "awaiting_approval", "running"].includes(run.status)) {
      throw new Error("A new Agent action must begin in planning, approval, or running state.");
    }
    let connectorPermissions: readonly Permission[] = policy.permissions;
    if (run.connectorId !== null) {
      const connector = await this.getConnector(run.connectorId, true);
      if (connector.status !== "active") throw new Error("Agent action Connection is not active.");
      if (connector.writeRiskLevel !== run.riskLevel) {
        throw new Error("Agent action risk must match the immutable Connection write policy.");
      }
      const capabilities = new Set(connector.capabilityPermissions);
      if (!policy.permissions.every((permission) => capabilities.has(permission))) {
        throw new Error("Agent action Connection does not provide every required capability.");
      }
      connectorPermissions = connector.capabilityPermissions;
    }
    const inserted = await this.#connection.query(
      `INSERT INTO agent_runs
         (id, guild_id, agent_identity_id, requester_identity_id, quest_id, risk_level,
          status, limits, usage, idempotency_key, plan, workflow_instance_id,
          estimated_budget_minor, space_id, owner_identity_id, visibility, classification,
          allowed_identity_ids, connector_id, action_kind, source, request_hash,
          workflow_permissions, connector_permissions_snapshot, parent_run_id,
          workflow_definition_id, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10,
               $11::jsonb, $12, $13, $14, $15, $16, $17, $18::uuid[], $19,
               $20, $21, $22, $23, $24, $25, $26, 1)
       ON CONFLICT (id) DO NOTHING`,
      [
        run.id,
        this.#guildId,
        run.agentIdentityId,
        run.requesterIdentityId,
        run.questId,
        run.riskLevel,
        run.status,
        JSON.stringify(run.limits),
        JSON.stringify(run.usage),
        run.idempotencyKey,
        JSON.stringify(run.plan),
        run.workflowInstanceId,
        run.estimatedBudgetMinor,
        run.spaceId,
        run.ownerIdentityId,
        run.visibility,
        run.classification,
        run.allowedIdentityIds ?? [],
        run.connectorId,
        policy.storedKind,
        run.source,
        run.requestHash,
        workflowPermissions,
        connectorPermissions,
        input.parentRunId ?? null,
        input.workflowDefinitionId ?? null,
      ],
    );
    if (inserted.rowCount === 0) {
      const existing = await this.getRun(run.id, true);
      if (existing.requesterIdentityId !== run.requesterIdentityId ||
          existing.requestHash !== run.requestHash) {
        throw new Error("Agent run request ID was already used for different content.");
      }
      return false;
    }
    if (input.approval) await this.#insertApproval(input.approval, run);
    await this.#enqueue(
      "agent.workflow.start",
      { runId: run.id, workflowInstanceId: run.workflowInstanceId },
      `agent-workflow-start:${run.id}`,
      input.approval?.id ?? null,
    );
    if (input.approval) await this.#notifyEligibleApprovers(run, input.approval);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return true;
  }

  async createDelegatedRun(input: CreateDelegatedAgentRunInput): Promise<string> {
    if (!Number.isSafeInteger(input.depth) || input.depth < 1 || input.depth > 100) {
      throw new Error("Agent delegation depth must be between 1 and 100.");
    }
    if (input.fromAgentActorId === input.toAgentActorId ||
        input.run.agentIdentityId !== input.toAgentActorId ||
        input.run.requesterIdentityId !== input.requesterActorId) {
      throw new Error("Agent delegation crosses its Agent or requester boundary.");
    }
    this.#assertEvent(
      input.delegationChronicleEvent,
      input.fromAgentActorId,
      "agent_run",
      input.parentRunId,
    );
    await this.#connection.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`agent-delegation:${this.#guildId}:${input.parentRunId}`],
    );
    const parent = await this.getRun(input.parentRunId, true);
    const chain = await this.getDelegationChain(input.parentRunId);
    if (chain.includes(input.toAgentActorId)) {
      throw new Error("Agent delegation cycle is forbidden.");
    }
    if (input.depth !== chain.length || input.depth > parent.limits.maxDelegationDepth) {
      throw new Error("Agent delegation exceeds its immutable depth limit.");
    }
    const existing = (await this.#connection.query<{
      child_run_id: string;
      to_agent_actor_id: string;
      requester_actor_id: string;
      objective: string;
      depth: number;
    }>(
      `SELECT child_run_id::text, to_agent_actor_id::text, requester_actor_id::text,
              objective, depth
         FROM agent_delegations
        WHERE guild_id = $1 AND parent_run_id = $2
        ORDER BY created_at, id LIMIT 1
        FOR UPDATE`,
      [this.#guildId, input.parentRunId],
    )).rows[0];
    if (existing) {
      if (existing.to_agent_actor_id !== input.toAgentActorId ||
          existing.requester_actor_id !== input.requesterActorId ||
          existing.objective !== input.objective || existing.depth !== input.depth) {
        throw new Error("This parent Agent run already delegated different work.");
      }
      return existing.child_run_id;
    }
    await this.createRun({
      run: input.run,
      approval: input.approval,
      parentRunId: input.parentRunId,
      workflowDefinitionId: input.workflowDefinitionId ?? null,
      chronicleEvent: input.chronicleEvent,
    });
    await this.#connection.query(
      `INSERT INTO agent_delegations
         (id, guild_id, parent_run_id, child_run_id, from_agent_actor_id,
          to_agent_actor_id, requester_actor_id, objective, permission_snapshot,
          depth, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, 'running')`,
      [
        crypto.randomUUID(), this.#guildId, input.parentRunId, input.run.id,
        input.fromAgentActorId, input.toAgentActorId, input.requesterActorId,
        input.objective, input.permissionSnapshot, input.depth,
      ],
    );
    await this.#chronicle.appendChronicle(input.delegationChronicleEvent);
    return input.run.id;
  }

  async openStagedApproval(
    runId: string,
    approval: AgentApprovalRequest,
    chronicleEvent: ChronicleEvent,
  ): Promise<StoredAgentRun> {
    const run = await this.getRun(runId, true);
    this.#assertEvent(chronicleEvent, chronicleEvent.actorIdentityId, "agent_run", runId);
    if (run.status !== "planning") {
      if (run.approval) return run;
      throw new Error("Only a staged Agent run can enter Guild approval.");
    }
    if (run.riskLevel < 2) {
      throw new Error("Level 0 and Level 1 Agent actions do not enter Human approval.");
    }
    await this.#insertApproval(approval, run);
    await this.#connection.query(
      `UPDATE agent_runs SET status = 'awaiting_approval', version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'planning'`,
      [this.#guildId, runId],
    );
    await this.#enqueue(
      "agent.workflow.signal",
      {
        runId,
        workflowInstanceId: run.workflowInstanceId,
        eventType: "overseer-decision",
        decision: "approved",
      },
      `agent-overseer-approved:${runId}`,
      approval.id,
    );
    await this.#notifyEligibleApprovers(run, approval);
    await this.#chronicle.appendChronicle(chronicleEvent);
    return this.getRun(runId);
  }

  async review(input: ReviewAgentRunInput): Promise<AgentApprovalOutcome> {
    this.#assertEvent(input.chronicleEvent, input.approverIdentityId, "agent_run", input.runId);
    const run = await this.getRun(input.runId, true);
    if (!run.approval || run.approval.id !== input.approvalRequestId) {
      throw new Error("Agent approval request was not found.");
    }
    const existing = (await this.#connection.query<ApprovalVoteRow>(
      `SELECT guild_id::text, approval_request_id::text, approver_identity_id::text,
              verdict, reason, reauthenticated_at::text, created_at::text
         FROM approval_votes
        WHERE guild_id = $1 AND approval_request_id = $2 AND approver_identity_id = $3`,
      [this.#guildId, input.approvalRequestId, input.approverIdentityId],
    )).rows[0];
    if (existing) {
      if (existing.verdict !== input.verdict || existing.reason !== input.reason) {
        throw new Error("This Human already recorded a different approval vote.");
      }
      return {
        runStatus: run.status,
        approvalStatus: run.approval.status,
        approvalCount: run.approval.approvalCount,
        requiredApprovals: run.approval.requiredApprovals,
        workflowInstanceId: run.workflowInstanceId,
      };
    }
    if (run.status !== "awaiting_approval" || run.approval.status !== "pending") {
      throw new Error("Only a pending Agent action can be reviewed.");
    }
    if (new Date(run.approval.expiresAt).valueOf() <= Date.now()) {
      throw new Error("Agent approval request has expired.");
    }
    await this.#connection.query(
      `INSERT INTO approval_votes
         (guild_id, approval_request_id, approver_identity_id, verdict,
          reauthenticated_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.#guildId,
        input.approvalRequestId,
        input.approverIdentityId,
        input.verdict,
        input.reauthenticatedAt,
        input.reason,
      ],
    );
    const counts = (await this.#connection.query<{ approve_count: number }>(
      `SELECT count(*) FILTER (WHERE verdict = 'approve')::integer AS approve_count
         FROM approval_votes WHERE guild_id = $1 AND approval_request_id = $2`,
      [this.#guildId, input.approvalRequestId],
    )).rows[0]?.approve_count ?? 0;
    const approvalStatus: ApprovalStatus = input.verdict === "reject"
      ? "rejected"
      : counts >= run.approval.requiredApprovals ? "approved" : "pending";
    await this.#connection.query(
      `UPDATE approval_requests SET status = $3, approval_count = $4
        WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
      [this.#guildId, input.approvalRequestId, approvalStatus, counts],
    );
    let runStatus: AgentRun["status"] = run.status;
    if (approvalStatus === "rejected") {
      runStatus = "failed";
      await this.#connection.query(
        `UPDATE agent_runs
            SET status = 'failed', error_message = 'Human approval was rejected.',
                finished_at = now(), version = version + 1
          WHERE guild_id = $1 AND id = $2 AND status = 'awaiting_approval'`,
        [this.#guildId, run.id],
      );
    }
    if (approvalStatus !== "pending") {
      await this.#enqueue(
        "agent.workflow.signal",
        {
          runId: run.id,
          workflowInstanceId: run.workflowInstanceId,
          eventType: "approval-decision",
          decision: approvalStatus === "approved" ? "approved" : "rejected",
        },
        `agent-approval-${approvalStatus}:${run.id}`,
        input.approvalRequestId,
      );
      await this.#notifyRequester(run, approvalStatus);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return {
      runStatus,
      approvalStatus,
      approvalCount: counts,
      requiredApprovals: run.approval.requiredApprovals,
      workflowInstanceId: run.workflowInstanceId,
    };
  }

  async rejectStagedRun(
    runId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<string> {
    this.#assertEvent(chronicleEvent, actorIdentityId, "agent_run", runId);
    const run = await this.getRun(runId, true);
    if (run.status === "failed") return run.workflowInstanceId;
    if (run.status !== "planning") throw new Error("Only a staged Agent action can be rejected.");
    await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'failed', error_message = 'Cloudflare OS approval was rejected.',
              finished_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'planning'`,
      [this.#guildId, runId],
    );
    await this.#enqueue(
      "agent.workflow.signal",
      {
        runId,
        workflowInstanceId: run.workflowInstanceId,
        eventType: "overseer-decision",
        decision: "rejected",
      },
      `agent-overseer-rejected:${runId}`,
      null,
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
    return run.workflowInstanceId;
  }

  async killRun(
    runId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<string> {
    this.#assertEvent(chronicleEvent, actorIdentityId, "agent_run", runId);
    const run = await this.getRun(runId, true);
    if (run.status === "killed") return run.workflowInstanceId;
    if (["succeeded", "failed"].includes(run.status)) {
      throw new Error("A completed Agent run cannot be killed.");
    }
    await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'killed', kill_requested_at = now(), finished_at = now(),
              error_message = 'Killed by an authorized Human.', version = version + 1
        WHERE guild_id = $1 AND id = $2
          AND status IN ('planning', 'awaiting_approval', 'running')`,
      [this.#guildId, runId],
    );
    if (run.approval?.status === "pending") {
      await this.#connection.query(
        `UPDATE approval_requests SET status = 'expired'
          WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
        [this.#guildId, run.approval.id],
      );
    }
    await this.#connection.query(
      `UPDATE outbox SET status = 'cancelled', completed_at = now()
        WHERE guild_id = $1 AND status IN ('pending', 'processing')
          AND topic IN ('agent.workflow.start', 'agent.workflow.signal')
          AND payload ->> 'runId' = $2`,
      [this.#guildId, runId],
    );
    await this.#enqueue(
      "agent.workflow.terminate",
      { runId, workflowInstanceId: run.workflowInstanceId },
      `agent-workflow-terminate:${runId}`,
      run.approval?.id ?? null,
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
    return run.workflowInstanceId;
  }

  async claimExecution(runId: string, workflowInstanceId: string): Promise<StoredAgentRunDetail> {
    const run = await this.getRun(runId, true);
    if (run.workflowInstanceId !== workflowInstanceId) {
      throw new Error("Workflow instance does not own this Agent run.");
    }
    if (run.status === "running") {
      throw new Error("Agent run execution was already claimed; duplicate delivery is refused.");
    }
    const automaticReady = run.approval === null && run.status === "planning";
    const approvedReady = run.status === "awaiting_approval" &&
      run.approval?.status === "approved" &&
      new Date(run.approval.expiresAt).valueOf() > Date.now();
    if (!automaticReady && !approvedReady) {
      throw new Error("Agent run is not durably authorized for execution.");
    }
    const updated = await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'running', started_at = COALESCE(started_at, now()),
              external_attempted_at = CASE WHEN connector_id IS NULL
                THEN external_attempted_at ELSE now() END,
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = $3`,
      [this.#guildId, runId, automaticReady ? "planning" : "awaiting_approval"],
    );
    if (updated.rowCount !== 1) throw new Error("Agent run execution claim was lost.");
    return this.getRunDetail(runId);
  }

  async completeExecution(
    runId: string,
    workflowInstanceId: string,
    result: AgentRunResult,
    usage: AgentRunUsage,
    chronicleEvent: ChronicleEvent,
  ): Promise<"succeeded" | "killed"> {
    this.#assertEvent(chronicleEvent, chronicleEvent.actorIdentityId, "agent_run", runId);
    const run = await this.getRun(runId, true);
    const validatedResult = resultFrom(result);
    if (validatedResult === null || validatedResult.kind !== run.plan.action.kind) {
      throw new Error("Agent result does not match its immutable planned action.");
    }
    if (run.workflowInstanceId !== workflowInstanceId) throw new Error("Workflow ownership changed.");
    for (const key of Object.keys(run.usage) as (keyof AgentRunUsage)[]) {
      if (usage[key] < run.usage[key]) {
        throw new Error(`Agent ${key} usage cannot move backwards during completion.`);
      }
    }
    if (run.status === "succeeded") return "succeeded";
    if (run.status === "killed") {
      const alreadyRecorded = (await this.#connection.query(
        `SELECT 1 FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'agent_run' AND subject_id = $2
            AND action = 'agent.run.delivery_after_kill' LIMIT 1`,
        [this.#guildId, runId],
      )).rowCount;
      if (!alreadyRecorded) {
        await this.#chronicle.appendChronicle({
          ...chronicleEvent,
          action: "agent.run.delivery_after_kill",
          details: {
            ...chronicleEvent.details,
            completedAt: "deliveredAt" in result ? result.deliveredAt : result.completedAt,
            killRequestedAt: run.killRequestedAt,
            usageBudgetMinor: usage.budgetMinor,
            usageDurationSeconds: usage.durationSeconds,
            usageSteps: usage.steps,
            usageRetries: usage.retries,
            usageDelegationDepth: usage.delegationDepth,
          },
        });
      }
      return "killed";
    }
    if (run.status !== "running") throw new Error("Agent run is not running.");
    assertUsageWithinLimits(run.limits, usage);
    await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'succeeded', result = $3::jsonb, usage = $4::jsonb,
              finished_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'running'`,
      [this.#guildId, runId, JSON.stringify(result), JSON.stringify(usage)],
    );
    if (run.approval) {
      await this.#connection.query(
        `UPDATE approval_requests SET status = 'applied'
          WHERE guild_id = $1 AND id = $2 AND status = 'approved'`,
        [this.#guildId, run.approval.id],
      );
    }
    if (run.parentRunId) {
      await this.#connection.query(
        `UPDATE agent_delegations SET status = 'completed', updated_at = now()
          WHERE guild_id = $1 AND child_run_id = $2 AND status = 'running'`,
        [this.#guildId, runId],
      );
    }
    await this.#chronicle.appendChronicle(chronicleEvent);
    return "succeeded";
  }

  async failExecution(
    runId: string,
    workflowInstanceId: string,
    errorMessage: string,
    usage: AgentRunUsage,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, chronicleEvent.actorIdentityId, "agent_run", runId);
    const run = await this.getRun(runId, true);
    if (run.workflowInstanceId !== workflowInstanceId) throw new Error("Workflow ownership changed.");
    if (["succeeded", "failed", "killed"].includes(run.status)) return;
    assertUsageWithinLimits(run.limits, usage);
    if (run.approval?.status === "pending") {
      await this.#connection.query(
        `UPDATE approval_requests SET status = 'expired'
          WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
        [this.#guildId, run.approval.id],
      );
    }
    await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'failed', error_message = $3, usage = $4::jsonb,
              finished_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2
          AND status IN ('planning', 'awaiting_approval', 'running')`,
      [this.#guildId, runId, errorMessage, JSON.stringify(usage)],
    );
    if (run.parentRunId) {
      await this.#connection.query(
        `UPDATE agent_delegations SET status = 'rejected', updated_at = now()
          WHERE guild_id = $1 AND child_run_id = $2
            AND status IN ('proposed', 'approved', 'running')`,
        [this.#guildId, runId],
      );
    }
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async isKillRequested(runId: string): Promise<boolean> {
    const row = (await this.#connection.query<{
      status: AgentRun["status"];
      kill_requested_at: string | null;
    }>(
      `SELECT status, kill_requested_at::text
         FROM agent_runs WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, runId],
    )).rows[0];
    if (!row) throw new Error("Agent run was not found in this Guild.");
    return row.status === "killed" || row.kill_requested_at !== null;
  }

  async claimExternalAction(scope: ExternalAgentActionScope): Promise<ExternalAgentActionClaim> {
    const run = await this.getRun(scope.runId, true);
    if (run.idempotencyKey !== scope.idempotencyKey || run.requestHash !== scope.requestHash ||
        run.plan.action.kind !== scope.actionKind || run.status !== "running") {
      throw new Error("External Agent action idempotency scope does not match the running run.");
    }
    const idempotencyKey = this.#externalActionIdempotencyKey(scope);
    const row = (await this.#connection.query<ExternalActionLedgerRow>(
      `SELECT status, payload, last_error FROM outbox
        WHERE guild_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [this.#guildId, idempotencyKey],
    )).rows[0];
    if (row) {
      const payload = row.payload as Record<string, unknown>;
      if (payload.requestHash !== scope.requestHash || payload.actionKind !== scope.actionKind) {
        throw new Error("External Agent action idempotency key was reused with different content.");
      }
      if (row.status === "completed") {
        if (row.last_error === null) {
          throw new Error("Completed external Agent action has no durable result record.");
        }
        return {
          state: "completed",
          record: this.#externalActionRecord(row.last_error),
        };
      }
      throw new Error("External Agent action is already processing or failed without replay data.");
    }
    await this.#connection.query(
      `INSERT INTO outbox
         (id, guild_id, topic, payload, idempotency_key, status, locked_at, attempt_count)
       VALUES ($1, $2, 'agent.action.idempotency', $3::jsonb, $4,
               'processing', now(), 1)`,
      [
        crypto.randomUUID(), this.#guildId,
        JSON.stringify({
          runId: scope.runId,
          requestHash: scope.requestHash,
          actionKind: scope.actionKind,
        }),
        idempotencyKey,
      ],
    );
    return { state: "execute" };
  }

  async completeExternalAction(
    scope: ExternalAgentActionScope,
    record: ExternalAgentActionExecutionRecord,
  ): Promise<void> {
    const updated = await this.#connection.query(
      `UPDATE outbox
          SET status = 'completed', completed_at = now(), locked_at = NULL,
              last_error = $3
        WHERE guild_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [
        this.#guildId,
        this.#externalActionIdempotencyKey(scope),
        JSON.stringify({ result: record.result, usage: record.usage }),
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error("External Agent action completion lost its durable idempotency claim.");
    }
  }

  async failExternalAction(scope: ExternalAgentActionScope, errorMessage: string): Promise<void> {
    await this.#connection.query(
      `UPDATE outbox
          SET status = 'failed', completed_at = now(), locked_at = NULL, last_error = $3
        WHERE guild_id = $1 AND idempotency_key = $2 AND status = 'processing'`,
      [this.#guildId, this.#externalActionIdempotencyKey(scope), errorMessage],
    );
  }

  async getDelegationChain(parentRunId: string): Promise<readonly string[]> {
    const rows = (await this.#connection.query<{ agent_identity_id: string; depth: number }>(
      `WITH RECURSIVE chain AS (
         SELECT run.id, run.parent_run_id, run.agent_identity_id, 0 AS depth
           FROM agent_runs run
          WHERE run.guild_id = $1 AND run.id = $2
         UNION ALL
         SELECT parent.id, parent.parent_run_id, parent.agent_identity_id, chain.depth + 1
           FROM chain
           JOIN agent_runs parent
             ON parent.guild_id = $1 AND parent.id = chain.parent_run_id
          WHERE chain.depth < 100
       )
       SELECT agent_identity_id::text, depth FROM chain ORDER BY depth DESC`,
      [this.#guildId, parentRunId],
    )).rows;
    if (rows.length === 0) throw new Error("Delegation parent run was not found.");
    if (rows.length > 100) throw new Error("Agent delegation chain exceeds its hard limit.");
    const chain = rows.map((row) => row.agent_identity_id);
    if (new Set(chain).size !== chain.length) throw new Error("Agent delegation cycle is forbidden.");
    return chain;
  }

  async expireApproval(
    runId: string,
    workflowInstanceId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, chronicleEvent.actorIdentityId, "agent_run", runId);
    const run = await this.getRun(runId, true);
    if (run.workflowInstanceId !== workflowInstanceId) throw new Error("Workflow ownership changed.");
    if (run.status !== "awaiting_approval" || run.approval?.status !== "pending") return;
    await this.#connection.query(
      `UPDATE approval_requests SET status = 'expired'
        WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
      [this.#guildId, run.approval.id],
    );
    await this.#connection.query(
      `UPDATE agent_runs
          SET status = 'failed', error_message = 'Human approval expired.',
              finished_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'awaiting_approval'`,
      [this.#guildId, runId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async claimWorkflowMessage(): Promise<AgentWorkflowMessage | null> {
    const row = (await this.#connection.query<OutboxRow>(
      `WITH candidate AS (
         SELECT id FROM outbox
          WHERE guild_id = $1
            AND topic = ANY($2::text[])
            AND (status = 'pending' AND available_at <= now()
              OR status = 'processing' AND locked_at < now() - interval '10 minutes')
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE outbox target
          SET status = 'processing', locked_at = now(), attempt_count = attempt_count + 1
         FROM candidate
        WHERE target.guild_id = $1 AND target.id = candidate.id
       RETURNING target.id::text, target.topic, target.payload,
                 target.idempotency_key, target.attempt_count`,
      [this.#guildId, AGENT_OUTBOX_TOPICS],
    )).rows[0];
    if (!row) return null;
    if (!isAgentOutboxTopic(row.topic) || !row.payload || typeof row.payload !== "object" ||
        Array.isArray(row.payload)) {
      throw new Error("Agent workflow Outbox payload is invalid.");
    }
    return {
      outboxId: row.id,
      topic: row.topic,
      payload: row.payload as Readonly<Record<string, unknown>>,
      idempotencyKey: row.idempotency_key,
      attemptCount: row.attempt_count,
    };
  }

  async completeWorkflowMessage(outboxId: string): Promise<void> {
    await this.#connection.query(
      `UPDATE outbox SET status = 'completed', completed_at = now(), locked_at = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'`,
      [this.#guildId, outboxId],
    );
  }

  async retryWorkflowMessage(
    outboxId: string,
    errorMessage: string,
    maximumAttempts = 10,
  ): Promise<boolean> {
    const result = await this.#connection.query<{ status: string }>(
      `UPDATE outbox
          SET status = CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'pending' END,
              available_at = now() + make_interval(secs => LEAST(300, power(2, attempt_count)::integer)),
              locked_at = NULL, last_error = $4
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'
      RETURNING status`,
      [this.#guildId, outboxId, maximumAttempts, errorMessage],
    );
    return result.rows[0]?.status === "failed";
  }

  async #insertApproval(approval: AgentApprovalRequest, run: AgentRun): Promise<void> {
    const policy = agentRunActionPolicy(run.plan.action.kind);
    if (approval.guildId !== this.#guildId || approval.agentRunId !== run.id ||
        approval.riskLevel !== run.riskLevel || approval.actionKind !== policy.storedKind) {
      throw new Error("Approval request crosses its Agent run boundary.");
    }
    await this.#connection.query(
      `INSERT INTO approval_requests
         (id, guild_id, agent_run_id, risk_level, action_kind, action_payload,
          required_approvals, approval_count, reauthentication_required, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, $8, 'pending', $9)`,
      [
        approval.id,
        this.#guildId,
        run.id,
        approval.riskLevel,
        approval.actionKind,
        JSON.stringify({
          objective: run.plan.objective,
          expectedOutcome: run.plan.expectedOutcome,
          steps: run.plan.steps,
          connectorId: run.connectorId,
          action: run.plan.action,
          estimatedUsage: run.plan.estimatedUsage,
        }),
        approval.requiredApprovals,
        approval.reauthenticationRequired,
        approval.expiresAt,
      ],
    );
  }

  #externalActionIdempotencyKey(scope: ExternalAgentActionScope): string {
    return `agent-action-result:${scope.runId}:${scope.idempotencyKey}`;
  }

  #externalActionRecord(serialized: string): ExternalAgentActionExecutionRecord {
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new Error("Completed external Agent action has an invalid durable result record.");
    }
    const result = resultFrom(payload.result);
    if (result === null) throw new Error("Completed external Agent action has no durable result.");
    return { result, usage: usageFrom(payload.usage) };
  }

  async #notifyEligibleApprovers(
    run: AgentRun,
    approval: AgentApprovalRequest,
  ): Promise<void> {
    await this.#connection.query(
      `WITH ${this.#eligibleApproversCte()}
       INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id,
          space_id, owner_identity_id, visibility, classification, allowed_identity_ids,
          deduplication_key)
       SELECT gen_random_uuid(), $1, approver.id, 'approval', $7, '', 'agent_run', $8,
              $2, $5, $4, $3, $6::uuid[], $9
         FROM eligible_approvers approver
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        this.#guildId,
        run.spaceId,
        run.classification,
        run.visibility,
        run.ownerIdentityId,
        run.allowedIdentityIds ?? [],
        run.plan.objective,
        run.id,
        `agent-approval:${approval.id}`,
      ],
    );
  }

  async #notifyRequester(run: AgentRun, status: ApprovalStatus): Promise<void> {
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id,
          space_id, owner_identity_id, visibility, classification, allowed_identity_ids,
          deduplication_key)
       VALUES ($1, $2, $3, 'approval', $4, '', 'agent_run', $5,
               $6, $7, $8, $9, $10::uuid[], $11)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        run.requesterIdentityId,
        run.plan.objective,
        run.id,
        run.spaceId,
        run.ownerIdentityId,
        run.visibility,
        run.classification,
        run.allowedIdentityIds ?? [],
        `agent-approval-outcome:${run.id}:${status}`,
      ],
    );
  }

  #eligibleApproversCte(): string {
    return `eligible_approvers AS (
      SELECT DISTINCT identity_row.id
        FROM identities identity_row
        JOIN memberships membership_row
          ON membership_row.guild_id = identity_row.guild_id
         AND membership_row.identity_id = identity_row.id
        JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
       WHERE identity_row.guild_id = $1
         AND identity_row.kind = 'human'
         AND identity_row.status = 'active'
         AND membership_row.state = 'active'
         AND CASE $3::text
               WHEN 'public' THEN 0 WHEN 'internal' THEN 1
               WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
             END <= CASE membership_row.clearance
               WHEN 'public' THEN 0 WHEN 'internal' THEN 1
               WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
             END
         AND ($4::text NOT IN ('private', 'restricted')
           OR identity_row.id = $5 OR identity_row.id = ANY($6::uuid[]))
         AND (guild_row.root_owner_identity_id = identity_row.id OR EXISTS (
           SELECT 1 FROM role_bindings binding_row
           JOIN role_permissions permission_row
             ON permission_row.guild_id = binding_row.guild_id
            AND permission_row.role_id = binding_row.role_id
          WHERE binding_row.guild_id = identity_row.guild_id
            AND binding_row.identity_id = identity_row.id
            AND permission_row.permission = 'agent.approve'
            AND (binding_row.space_id IS NULL
              OR $2::uuid IS NOT NULL
                 AND guild_runtime.space_contains($1, binding_row.space_id, $2::uuid))
         ))
    )`;
  }

  async #enqueue(
    topic: AgentOutboxTopic,
    payload: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
    approvalRequestId: string | null,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO outbox
         (id, guild_id, approval_request_id, topic, payload, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending')
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        approvalRequestId,
        topic,
        JSON.stringify(payload),
        idempotencyKey,
      ],
    );
  }

  #connectorSelect(): string {
    return `SELECT connector.id::text, connector.guild_id::text, connector.space_id::text,
                   connector.owner_identity_id::text, connector.name, connector.kind,
                   connector.status, connector.capability_permissions, connector.endpoint_url,
                   connector.secret_reference, connector.visibility, connector.classification,
                   connector.allowed_identity_ids::text[], connector.deployment_managed,
                   connector.description, connector.provider, connector.configuration,
                   connector.auth_kind, connector.write_risk_level, connector.health_status,
                   connector.last_checked_at::text,
                   connector.version, connector.created_at::text, connector.updated_at::text
              FROM connectors connector`;
  }

  #runSelect(): string {
    return `SELECT run.id::text, run.guild_id::text, run.space_id::text,
                   run.owner_identity_id::text, run.visibility, run.classification,
                   run.allowed_identity_ids::text[], run.agent_identity_id::text,
                   run.requester_identity_id::text, run.connector_id::text, run.quest_id::text,
                   run.risk_level, run.status, run.source, run.plan, run.result,
                   run.error_message, run.limits, run.usage, run.workflow_instance_id,
                   run.idempotency_key, run.request_hash, run.estimated_budget_minor,
                   run.action_kind, run.parent_run_id::text, run.workflow_definition_id::text,
                   run.external_attempted_at::text,
                   run.kill_requested_at::text, run.started_at::text, run.finished_at::text,
                   run.version, run.created_at::text, run.updated_at::text,
                   agent.display_name AS agent_display_name,
                   requester.display_name AS requester_display_name,
                   COALESCE(connector.name, 'Internal Guild capability') AS connector_name,
                   approval.id::text AS approval_id,
                   approval.risk_level AS approval_risk_level,
                   approval.action_kind AS approval_action_kind,
                   approval.required_approvals AS approval_required_approvals,
                   approval.approval_count, approval.reauthentication_required
                     AS approval_reauthentication_required,
                   approval.status AS approval_status,
                   approval.expires_at::text AS approval_expires_at,
                   approval.created_at::text AS approval_created_at,
                   approval.updated_at::text AS approval_updated_at,
                   run.workflow_permissions,
                   run.connector_permissions_snapshot
              FROM agent_runs run
              JOIN identities agent
                ON agent.guild_id = run.guild_id AND agent.id = run.agent_identity_id
              JOIN identities requester
                ON requester.guild_id = run.guild_id AND requester.id = run.requester_identity_id
              LEFT JOIN connectors connector
                ON connector.guild_id = run.guild_id AND connector.id = run.connector_id
              LEFT JOIN approval_requests approval
                ON approval.guild_id = run.guild_id AND approval.agent_run_id = run.id`;
  }

  #authorizationCtes(permission: Permission, prefix: string): string {
    return `${prefix}_actor AS (
      SELECT identity_row.id, membership_row.clearance,
             guild_row.root_owner_identity_id = identity_row.id AS is_root
        FROM identities identity_row
        JOIN memberships membership_row
          ON membership_row.guild_id = identity_row.guild_id
         AND membership_row.identity_id = identity_row.id
        JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
       WHERE identity_row.guild_id = $1 AND identity_row.id = $2
         AND identity_row.status = 'active' AND membership_row.state = 'active'
    ), ${prefix}_grants AS (
      SELECT binding_row.space_id
        FROM role_bindings binding_row
        JOIN role_permissions permission_row
          ON permission_row.guild_id = binding_row.guild_id
         AND permission_row.role_id = binding_row.role_id
       WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
         AND permission_row.permission = '${permission}'
    ), ${prefix}_spaces AS (
      SELECT space_row.id FROM spaces space_row
        JOIN ${prefix}_grants grant_row ON grant_row.space_id = space_row.id
       WHERE space_row.guild_id = $1 AND space_row.status = 'active'
      UNION
      SELECT child.id FROM spaces child
        JOIN ${prefix}_spaces parent ON child.parent_space_id = parent.id
       WHERE child.guild_id = $1 AND child.status = 'active'
    ), ${prefix}_access AS (
      SELECT ${prefix}_actor.*,
             EXISTS (SELECT 1 FROM ${prefix}_grants WHERE space_id IS NULL) AS has_global_grant
        FROM ${prefix}_actor
    )`;
  }

  #readPredicate(alias: string, prefix: string): string {
    return `(access.is_root OR access.has_global_grant OR (
      ${alias}.space_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM ${prefix}_spaces permitted WHERE permitted.id = ${alias}.space_id
      )
    ))
    AND CASE ${alias}.classification
          WHEN 'public' THEN 0 WHEN 'internal' THEN 1
          WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
        END <= CASE access.clearance
          WHEN 'public' THEN 0 WHEN 'internal' THEN 1
          WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
        END
    AND (${alias}.visibility NOT IN ('private', 'restricted')
      OR ${alias}.owner_identity_id = $2 OR $2::uuid = ANY(${alias}.allowed_identity_ids))`;
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    subjectType: string,
    subjectId: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.subjectType !== subjectType || event.subjectId !== subjectId) {
      throw new Error("Agent event crosses the active Guild, actor, or subject boundary.");
    }
  }
}
