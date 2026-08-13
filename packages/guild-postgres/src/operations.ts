import { createHash, randomUUID } from "node:crypto";
import {
  PERMISSIONS,
  assertAutomationTriggerKind,
  assertConnectionKind,
  assertFederationDirection,
  assertIdentifierList,
  assertNonBlank,
  assertScheduleExpression,
  assertWorkflowGraph,
  type AutomationRule,
  type AgentRunPlan,
  type ChronicleEvent,
  type Classification,
  type Connector,
  type FederationGrant,
  type FederationLink,
  type Guild,
  type JsonObject,
  type JsonValue,
  type ModelProvider,
  type ModelRoute,
  type Permission,
  type RiskLevel,
  type Visibility,
  type WorkflowDefinition,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const FEDERATED_RESOURCE_TYPES = ["memory", "activity", "decision", "agent"] as const;
const MODEL_PURPOSES = ["ask", "plan", "act", "embedding", "review"] as const;
const SAFE_TABLE_NAME = /^[a-z][a-z0-9_]*$/;

type FederationResourceType = FederationGrant["resourceType"];
type ModelPurpose = ModelRoute["purpose"];
type ModelProviderKind = ModelProvider["kind"];
type ConnectionAuthKind = NonNullable<Connector["authKind"]>;
type ConnectionHealth = NonNullable<Connector["healthStatus"]>;

export interface AuditedMutation {
  actorId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ConnectionDraft {
  id: string;
  spaceId: string | null;
  ownerIdentityId: string;
  name: string;
  kind: Connector["kind"];
  status?: Exclude<Connector["status"], "revoked">;
  capabilityPermissions: readonly Permission[];
  endpointUrl: string | null;
  secretReference: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds?: readonly string[];
  deploymentManaged?: boolean;
  description?: string;
  provider?: string;
  configuration?: JsonObject;
  authKind?: ConnectionAuthKind;
  writeRiskLevel?: RiskLevel;
}

export type CreateConnectionInput = ConnectionDraft & AuditedMutation;

export interface ReplaceConnectionInput extends AuditedMutation {
  currentId: string;
  expectedVersion: number;
  replacement: ConnectionDraft;
}

export interface RevokeVersionedInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
}

export interface SetConnectionHealthInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
  healthStatus: ConnectionHealth;
  checkedAt: string;
}

export interface WorkflowDefinitionDraft {
  id: string;
  spaceId: string | null;
  ownerActorId: string;
  name: string;
  description?: string;
  status?: Exclude<WorkflowDefinition["status"], "archived">;
  nodes: readonly JsonObject[];
  edges: readonly JsonObject[];
  allowedActionKinds: readonly AgentRunPlan["action"]["kind"][];
  capabilityPermissions: readonly Permission[];
  visibility: Visibility;
  classification: Classification;
  allowedActorIds?: readonly string[];
  maxConcurrentRuns?: number;
}

export type CreateWorkflowDefinitionInput = WorkflowDefinitionDraft & AuditedMutation;

export interface ReplaceWorkflowDefinitionInput extends AuditedMutation {
  currentId: string;
  expectedVersion: number;
  replacement: WorkflowDefinitionDraft;
}

export interface SetWorkflowStatusInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
  status: WorkflowDefinition["status"];
}

export interface AutomationRuleDraft {
  id: string;
  workflowId: string;
  agentActorId: string;
  createdByActorId: string;
  name: string;
  triggerKind: AutomationRule["triggerKind"];
  triggerExpression: string;
  timezone?: string;
  inputTemplate?: JsonObject;
  status?: Exclude<AutomationRule["status"], "archived">;
  nextRunAt: string | null;
}

export type CreateAutomationRuleInput = AutomationRuleDraft & AuditedMutation;

export interface ReplaceAutomationRuleInput extends AuditedMutation {
  currentId: string;
  expectedVersion: number;
  replacement: AutomationRuleDraft;
}

export interface SetAutomationRuleStatusInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
  status: AutomationRule["status"];
  nextRunAt?: string | null;
}

export interface AutomationEventRecord {
  id: string;
  guildId: string;
  eventType: string;
  sourceActorId: string;
  payload: JsonObject;
  idempotencyKey: string;
  status: "pending" | "processing" | "completed" | "failed";
  processedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface RecordAutomationEventInput extends AuditedMutation {
  id: string;
  eventType: string;
  sourceActorId: string;
  payload: JsonObject;
  idempotencyKey: string;
}

export interface IdempotentResult<T> {
  value: T;
  created: boolean;
}

export interface WorkflowRunRequest {
  id: string;
  guildId: string;
  workflowId: string;
  automationRuleId: string | null;
  requestedByActorId: string;
  agentActorId: string;
  triggerKind: "schedule" | "event" | "manual" | "delegation";
  triggerEventId: string | null;
  input: JsonObject;
  status: "queued" | "planning" | "running" | "succeeded" | "failed" | "cancelled";
  idempotencyKey: string;
  output: JsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimDueScheduleInput {
  now: string;
  nextRunAt: string;
}

export interface DueScheduleClaim {
  rule: AutomationRule;
  request: WorkflowRunRequest;
  requestCreated: boolean;
}

export interface AutomationEventClaim {
  event: AutomationEventRecord;
  requests: readonly WorkflowRunRequest[];
  createdRequestCount: number;
}

export interface EnqueueManualRunInput extends AuditedMutation {
  id: string;
  workflowId: string;
  requestedByActorId: string;
  agentActorId: string;
  input: JsonObject;
  idempotencyKey: string;
}

export interface FinishWorkflowRunRequestInput extends AuditedMutation {
  id: string;
  status: "succeeded" | "failed" | "cancelled";
  output: JsonObject | null;
  errorMessage: string | null;
}

export interface FederationLinkDraft {
  id: string;
  remoteGuildId: string;
  remoteName: string;
  endpointUrl: string;
  secretReference: string;
  direction: FederationLink["direction"];
  status?: Exclude<FederationLink["status"], "revoked">;
  allowedResourceTypes: readonly FederationResourceType[];
  createdByActorId: string;
}

export type CreateFederationLinkInput = FederationLinkDraft & AuditedMutation;

export interface ActivateFederationLinkInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
}

export interface CreateFederationGrantInput extends AuditedMutation {
  id: string;
  federationLinkId: string;
  resourceType: FederationResourceType;
  resourceId: string;
  permission: FederationGrant["permission"];
  grantedByActorId: string;
}

export interface RevokeFederationGrantInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
  revokedByActorId: string;
}

export interface FederatedResourceReference {
  grant: FederationGrant;
  remoteGuildId: string;
  direction: FederationLink["direction"];
}

export interface FederationDelivery {
  id: string;
  guildId: string;
  federationLinkId: string;
  direction: "inbound" | "outbound";
  eventType: string;
  payload: JsonObject;
  payloadHash: string;
  idempotencyKey: string;
  status: "pending" | "processing" | "completed" | "failed" | "rejected";
  attemptCount: number;
  availableAt: string;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface EnqueueFederationDeliveryInput extends AuditedMutation {
  id: string;
  federationLinkId: string;
  federationGrantId: string;
  eventType: string;
  payload: JsonObject;
  idempotencyKey: string;
  availableAt?: string;
}

export interface RecordInboundFederationDeliveryInput extends AuditedMutation {
  id: string;
  federationLinkId: string;
  eventType: string;
  payload: JsonObject;
  idempotencyKey: string;
}

export interface FinishFederationDeliveryInput extends AuditedMutation {
  id: string;
  succeeded: boolean;
  errorMessage: string | null;
  retryAt?: string;
}

export interface ModelProviderDraft {
  id: string;
  name: string;
  kind: ModelProviderKind;
  endpointUrl: string | null;
  secretReference: string | null;
  allowedModels: readonly string[];
  status?: Exclude<ModelProvider["status"], "revoked">;
  deploymentManaged?: boolean;
  createdByActorId: string;
}

export type CreateModelProviderInput = ModelProviderDraft & AuditedMutation;

export interface ReplaceModelProviderInput extends AuditedMutation {
  currentId: string;
  expectedVersion: number;
  replacement: ModelProviderDraft;
}

export interface ModelProviderReplacement {
  previous: ModelProvider;
  replacement: ModelProvider;
  routes: readonly ModelRoute[];
}

export interface ModelRouteDraft {
  id: string;
  purpose: ModelPurpose;
  providerId: string;
  primaryModel: string;
  fallbackModel: string | null;
  maxTokens: number;
  dailyBudgetMinor?: number;
  cacheEnabled?: boolean;
  status?: ModelRoute["status"];
  updatedByActorId: string;
}

export type CreateModelRouteInput = ModelRouteDraft & AuditedMutation;

export interface ReplaceModelRouteInput extends AuditedMutation {
  id: string;
  expectedVersion: number;
  replacement: Omit<ModelRouteDraft, "id" | "purpose">;
}

export interface ResolvedModelRoute {
  route: ModelRoute;
  provider: ModelProvider;
}

export interface GuildExportTableInventory {
  tableName: string;
  rowCount: string;
}

export interface GuildExportFileObject {
  id: string;
  r2Key: string;
  sha256: string;
  mediaType: string;
  byteSize: string;
  createdAt: string;
}

export interface GuildSchemaMigrationInventory {
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface GuildDataExportInventory {
  guild: Guild;
  generatedAt: string;
  totalRows: string;
  tables: readonly GuildExportTableInventory[];
  files: readonly GuildExportFileObject[];
  schemaMigrations: readonly GuildSchemaMigrationInventory[];
}

type ConnectionRow = QueryResultRow & {
  id: string; guild_id: string; space_id: string | null; owner_identity_id: string;
  name: string; kind: Connector["kind"]; status: Connector["status"];
  capability_permissions: Permission[]; endpoint_url: string | null; secret_reference: string | null;
  visibility: Visibility; classification: Classification; allowed_identity_ids: string[];
  deployment_managed: boolean; version: number; description: string; provider: string;
  configuration: JsonObject; auth_kind: ConnectionAuthKind; write_risk_level: RiskLevel;
  health_status: ConnectionHealth; last_checked_at: string | null; created_at: string; updated_at: string;
};

type WorkflowRow = QueryResultRow & {
  id: string; guild_id: string; space_id: string | null; owner_actor_id: string;
  name: string; description: string; status: WorkflowDefinition["status"];
  nodes: JsonObject[]; edges: JsonObject[]; visibility: Visibility; classification: Classification;
  allowed_actor_ids: string[]; allowed_action_kinds: AgentRunPlan["action"]["kind"][];
  capability_permissions: Permission[]; max_concurrent_runs: number; version: number;
  created_at: string; updated_at: string;
};

type AutomationRuleRow = QueryResultRow & {
  id: string; guild_id: string; workflow_id: string; agent_actor_id: string;
  created_by_actor_id: string; name: string; trigger_kind: AutomationRule["triggerKind"];
  trigger_expression: string; timezone: string; input_template: JsonObject;
  status: AutomationRule["status"]; next_run_at: string | null; last_run_at: string | null;
  consecutive_failures: number; version: number; created_at: string; updated_at: string;
};

type AutomationEventRow = QueryResultRow & {
  id: string; guild_id: string; event_type: string; source_actor_id: string; payload: JsonObject;
  idempotency_key: string; status: AutomationEventRecord["status"]; processed_at: string | null;
  last_error: string | null; created_at: string;
};

type WorkflowRunRequestRow = QueryResultRow & {
  id: string; guild_id: string; workflow_id: string; automation_rule_id: string | null;
  requested_by_actor_id: string; agent_actor_id: string; trigger_kind: WorkflowRunRequest["triggerKind"];
  trigger_event_id: string | null; input: JsonObject; status: WorkflowRunRequest["status"];
  idempotency_key: string; output: JsonObject | null; error_message: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
};

type FederationLinkRow = QueryResultRow & {
  id: string; guild_id: string; remote_guild_id: string; remote_name: string; endpoint_url: string;
  secret_reference: string; direction: FederationLink["direction"]; status: FederationLink["status"];
  allowed_resource_types: string[]; created_by_actor_id: string; version: number;
  created_at: string; updated_at: string;
};

type FederationGrantRow = QueryResultRow & {
  id: string; guild_id: string; federation_link_id: string; resource_type: FederationResourceType;
  resource_id: string; permission: FederationGrant["permission"]; status: FederationGrant["status"];
  granted_by_actor_id: string; revoked_by_actor_id: string | null; revoked_at: string | null;
  version: number; created_at: string;
};

type FederationDeliveryRow = QueryResultRow & {
  id: string; guild_id: string; federation_link_id: string; direction: FederationDelivery["direction"];
  event_type: string; payload: JsonObject; payload_hash: string; idempotency_key: string;
  status: FederationDelivery["status"]; attempt_count: number; available_at: string;
  completed_at: string | null; last_error: string | null; created_at: string;
};

type ModelProviderRow = QueryResultRow & {
  id: string; guild_id: string; name: string; kind: ModelProviderKind; endpoint_url: string | null;
  secret_reference: string | null; allowed_models: string[]; status: ModelProvider["status"];
  deployment_managed: boolean; created_by_actor_id: string; version: number;
  created_at: string; updated_at: string;
};

type ModelRouteRow = QueryResultRow & {
  id: string; guild_id: string; purpose: ModelPurpose; provider_id: string;
  primary_model: string; fallback_model: string | null; max_tokens: number;
  daily_budget_minor: number | string; cache_enabled: boolean; status: ModelRoute["status"];
  updated_by_actor_id: string; version: number; created_at: string; updated_at: string;
};

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return date.toISOString();
}

function optionalIso(value: string | null): string | null {
  return value === null ? null : iso(value);
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`List limit must be between 1 and ${MAX_LIMIT}.`);
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Expected version must be a positive integer.");
  }
}

function assertDate(value: string, label: string): void {
  if (Number.isNaN(new Date(value).valueOf())) throw new Error(`${label} must be an ISO timestamp.`);
}

function assertFederationResourceType(value: string): asserts value is FederationResourceType {
  if (!(FEDERATED_RESOURCE_TYPES as readonly string[]).includes(value)) {
    throw new Error("Federation resource type is invalid.");
  }
}

function assertModelPurpose(value: string): asserts value is ModelPurpose {
  if (!(MODEL_PURPOSES as readonly string[]).includes(value)) {
    throw new Error("Model route purpose is invalid.");
  }
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`).join(",")}}`;
}

function payloadHash(payload: JsonObject): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function connectionFromRow(row: ConnectionRow): Connector {
  return {
    id: row.id, guildId: row.guild_id, spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id, name: row.name, kind: row.kind, status: row.status,
    capabilityPermissions: row.capability_permissions, endpointUrl: row.endpoint_url,
    secretReference: row.secret_reference, visibility: row.visibility, classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids, description: row.description, provider: row.provider,
    configuration: row.configuration, authKind: row.auth_kind, writeRiskLevel: row.write_risk_level,
    healthStatus: row.health_status, lastCheckedAt: optionalIso(row.last_checked_at),
    deploymentManaged: row.deployment_managed, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function workflowFromRow(row: WorkflowRow): WorkflowDefinition {
  return {
    id: row.id, guildId: row.guild_id, spaceId: row.space_id, ownerActorId: row.owner_actor_id,
    name: row.name, description: row.description, status: row.status, nodes: row.nodes, edges: row.edges,
    visibility: row.visibility, classification: row.classification, allowedActorIds: row.allowed_actor_ids,
    allowedActionKinds: row.allowed_action_kinds,
    capabilityPermissions: row.capability_permissions,
    maxConcurrentRuns: row.max_concurrent_runs, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function automationRuleFromRow(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id, guildId: row.guild_id, workflowId: row.workflow_id,
    agentActorId: row.agent_actor_id, createdByActorId: row.created_by_actor_id,
    name: row.name, triggerKind: row.trigger_kind, triggerExpression: row.trigger_expression,
    timezone: row.timezone, inputTemplate: row.input_template, status: row.status,
    nextRunAt: optionalIso(row.next_run_at), lastRunAt: optionalIso(row.last_run_at),
    consecutiveFailures: row.consecutive_failures, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function automationEventFromRow(row: AutomationEventRow): AutomationEventRecord {
  return {
    id: row.id, guildId: row.guild_id, eventType: row.event_type,
    sourceActorId: row.source_actor_id, payload: row.payload, idempotencyKey: row.idempotency_key,
    status: row.status, processedAt: optionalIso(row.processed_at), lastError: row.last_error,
    createdAt: iso(row.created_at),
  };
}

function workflowRunRequestFromRow(row: WorkflowRunRequestRow): WorkflowRunRequest {
  return {
    id: row.id, guildId: row.guild_id, workflowId: row.workflow_id,
    automationRuleId: row.automation_rule_id, requestedByActorId: row.requested_by_actor_id,
    agentActorId: row.agent_actor_id, triggerKind: row.trigger_kind,
    triggerEventId: row.trigger_event_id, input: row.input, status: row.status,
    idempotencyKey: row.idempotency_key, output: row.output, errorMessage: row.error_message,
    startedAt: optionalIso(row.started_at), finishedAt: optionalIso(row.finished_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function federationLinkFromRow(row: FederationLinkRow): FederationLink {
  return {
    id: row.id, guildId: row.guild_id, remoteGuildId: row.remote_guild_id,
    remoteName: row.remote_name, endpointUrl: row.endpoint_url, secretReference: row.secret_reference,
    direction: row.direction, status: row.status, allowedResourceTypes: row.allowed_resource_types,
    createdByActorId: row.created_by_actor_id, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function federationGrantFromRow(row: FederationGrantRow): FederationGrant {
  return {
    id: row.id, guildId: row.guild_id, federationLinkId: row.federation_link_id,
    resourceType: row.resource_type, resourceId: row.resource_id, permission: row.permission,
    status: row.status, grantedByActorId: row.granted_by_actor_id,
    revokedByActorId: row.revoked_by_actor_id, revokedAt: optionalIso(row.revoked_at),
    version: row.version, createdAt: iso(row.created_at),
  };
}

function federationDeliveryFromRow(row: FederationDeliveryRow): FederationDelivery {
  return {
    id: row.id, guildId: row.guild_id, federationLinkId: row.federation_link_id,
    direction: row.direction, eventType: row.event_type, payload: row.payload,
    payloadHash: row.payload_hash, idempotencyKey: row.idempotency_key, status: row.status,
    attemptCount: row.attempt_count, availableAt: iso(row.available_at),
    completedAt: optionalIso(row.completed_at), lastError: row.last_error, createdAt: iso(row.created_at),
  };
}

function modelProviderFromRow(row: ModelProviderRow): ModelProvider {
  return {
    id: row.id, guildId: row.guild_id, name: row.name, kind: row.kind,
    endpointUrl: row.endpoint_url, secretReference: row.secret_reference,
    allowedModels: row.allowed_models, status: row.status, deploymentManaged: row.deployment_managed,
    createdByActorId: row.created_by_actor_id, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function modelRouteFromRow(row: ModelRouteRow): ModelRoute {
  const dailyBudgetMinor = Number(row.daily_budget_minor);
  if (!Number.isSafeInteger(dailyBudgetMinor)) throw new Error("Model route budget exceeds JavaScript safety.");
  return {
    id: row.id, guildId: row.guild_id, purpose: row.purpose, providerId: row.provider_id,
    primaryModel: row.primary_model, fallbackModel: row.fallback_model, maxTokens: row.max_tokens,
    dailyBudgetMinor, cacheEnabled: row.cache_enabled, status: row.status,
    updatedByActorId: row.updated_by_actor_id, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class GuildOperationsRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listConnections(includeRevoked = false, limit = DEFAULT_LIMIT): Promise<Connector[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<ConnectionRow>(
      `SELECT id::text, guild_id::text, space_id::text, owner_identity_id::text,
              name, kind, status, capability_permissions, endpoint_url, secret_reference,
              visibility, classification, allowed_identity_ids::text[], deployment_managed,
              version, description, provider, configuration, auth_kind, write_risk_level,
              health_status, last_checked_at::text, created_at::text, updated_at::text
         FROM connectors
        WHERE guild_id = $1 AND ($2::boolean OR status <> 'revoked')
        ORDER BY name, id LIMIT $3`,
      [this.#guildId, includeRevoked, limit],
    )).rows;
    return rows.map(connectionFromRow);
  }

  async getConnection(id: string, forUpdate = false): Promise<Connector> {
    const row = (await this.#connection.query<ConnectionRow>(
      `SELECT id::text, guild_id::text, space_id::text, owner_identity_id::text,
              name, kind, status, capability_permissions, endpoint_url, secret_reference,
              visibility, classification, allowed_identity_ids::text[], deployment_managed,
              version, description, provider, configuration, auth_kind, write_risk_level,
              health_status, last_checked_at::text, created_at::text, updated_at::text
         FROM connectors WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Connection was not found in this Guild.");
    return connectionFromRow(row);
  }

  async createConnection(input: CreateConnectionInput): Promise<Connector> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "connector", input.id);
    const connection = await this.#insertConnection(input);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return connection;
  }

  async replaceConnection(input: ReplaceConnectionInput): Promise<{
    previous: Connector;
    replacement: Connector;
  }> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "connector", input.replacement.id);
    if (input.currentId === input.replacement.id) {
      throw new Error("A Connection replacement requires a new ID.");
    }
    const current = await this.getConnection(input.currentId, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Connection");
    if (current.status === "revoked") throw new Error("A revoked Connection cannot be replaced.");
    const replacement = await this.#insertConnection(input.replacement);
    const row = (await this.#connection.query<ConnectionRow>(
      `UPDATE connectors SET status = 'revoked', version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, space_id::text, owner_identity_id::text,
                name, kind, status, capability_permissions, endpoint_url, secret_reference,
                visibility, classification, allowed_identity_ids::text[], deployment_managed,
                version, description, provider, configuration, auth_kind, write_risk_level,
                health_status, last_checked_at::text, created_at::text, updated_at::text`,
      [this.#guildId, input.currentId, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Connection changed. Reload before replacing it.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { previous: connectionFromRow(row), replacement };
  }

  async revokeConnection(input: RevokeVersionedInput): Promise<Connector> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "connector", input.id);
    const row = (await this.#connection.query<ConnectionRow>(
      `UPDATE connectors SET status = 'revoked', version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, space_id::text, owner_identity_id::text,
                name, kind, status, capability_permissions, endpoint_url, secret_reference,
                visibility, classification, allowed_identity_ids::text[], deployment_managed,
                version, description, provider, configuration, auth_kind, write_risk_level,
                health_status, last_checked_at::text, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Connection changed, was revoked, or does not exist in this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return connectionFromRow(row);
  }

  async setConnectionHealth(input: SetConnectionHealthInput): Promise<Connector> {
    assertVersion(input.expectedVersion);
    assertDate(input.checkedAt, "Connection health check time");
    this.#assertEvent(input.chronicleEvent, input.actorId, "connector", input.id);
    const row = (await this.#connection.query<ConnectionRow>(
      `UPDATE connectors
          SET health_status = $4, last_checked_at = $5, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, space_id::text, owner_identity_id::text,
                name, kind, status, capability_permissions, endpoint_url, secret_reference,
                visibility, classification, allowed_identity_ids::text[], deployment_managed,
                version, description, provider, configuration, auth_kind, write_risk_level,
                health_status, last_checked_at::text, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion, input.healthStatus, input.checkedAt],
    )).rows[0];
    if (!row) throw new Error("Connection changed, was revoked, or does not exist in this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return connectionFromRow(row);
  }

  async listWorkflowDefinitions(includeArchived = false, limit = DEFAULT_LIMIT): Promise<WorkflowDefinition[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<WorkflowRow>(
      `SELECT id::text, guild_id::text, space_id::text, owner_actor_id::text,
              name, description, status, nodes, edges, visibility, classification,
              allowed_actor_ids::text[], allowed_action_kinds, capability_permissions,
              max_concurrent_runs, version,
              created_at::text, updated_at::text
         FROM workflow_definitions
        WHERE guild_id = $1 AND ($2::boolean OR status <> 'archived')
        ORDER BY name, id LIMIT $3`,
      [this.#guildId, includeArchived, limit],
    )).rows;
    return rows.map(workflowFromRow);
  }

  async getWorkflowDefinition(id: string, forUpdate = false): Promise<WorkflowDefinition> {
    const row = (await this.#connection.query<WorkflowRow>(
      `SELECT id::text, guild_id::text, space_id::text, owner_actor_id::text,
              name, description, status, nodes, edges, visibility, classification,
              allowed_actor_ids::text[], allowed_action_kinds, capability_permissions,
              max_concurrent_runs, version,
              created_at::text, updated_at::text
         FROM workflow_definitions WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Workflow definition was not found in this Guild.");
    return workflowFromRow(row);
  }

  async createWorkflowDefinition(input: CreateWorkflowDefinitionInput): Promise<WorkflowDefinition> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "workflow_definition", input.id);
    const workflow = await this.#insertWorkflow(input);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return workflow;
  }

  async replaceWorkflowDefinition(input: ReplaceWorkflowDefinitionInput): Promise<{
    previous: WorkflowDefinition;
    replacement: WorkflowDefinition;
  }> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "workflow_definition", input.replacement.id);
    if (input.currentId === input.replacement.id) {
      throw new Error("A Workflow replacement requires a new ID.");
    }
    const current = await this.getWorkflowDefinition(input.currentId, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Workflow definition");
    if (current.status === "archived") throw new Error("An archived Workflow cannot be replaced.");
    const replacement = await this.#insertWorkflow(input.replacement);
    const row = (await this.#connection.query<WorkflowRow>(
      `UPDATE workflow_definitions SET status = 'archived', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'archived'
      RETURNING id::text, guild_id::text, space_id::text, owner_actor_id::text,
                name, description, status, nodes, edges, visibility, classification,
                allowed_actor_ids::text[], allowed_action_kinds, capability_permissions,
                max_concurrent_runs, version,
                created_at::text, updated_at::text`,
      [this.#guildId, input.currentId, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Workflow definition changed. Reload before replacing it.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { previous: workflowFromRow(row), replacement };
  }

  async setWorkflowStatus(input: SetWorkflowStatusInput): Promise<WorkflowDefinition> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "workflow_definition", input.id);
    const current = await this.getWorkflowDefinition(input.id, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Workflow definition");
    if (current.status === "archived" && input.status !== "archived") {
      throw new Error("An archived Workflow cannot be restored; create a replacement.");
    }
    if (current.status === input.status) return current;
    const row = (await this.#connection.query<WorkflowRow>(
      `UPDATE workflow_definitions SET status = $4, version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
      RETURNING id::text, guild_id::text, space_id::text, owner_actor_id::text,
                name, description, status, nodes, edges, visibility, classification,
                allowed_actor_ids::text[], allowed_action_kinds, capability_permissions,
                max_concurrent_runs, version,
                created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion, input.status],
    )).rows[0];
    if (!row) throw new Error("Workflow definition changed. Reload before changing its status.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return workflowFromRow(row);
  }

  async listAutomationRules(includeArchived = false, limit = DEFAULT_LIMIT): Promise<AutomationRule[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<AutomationRuleRow>(
      `SELECT id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
              created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
              input_template, status, next_run_at::text, last_run_at::text,
              consecutive_failures, version, created_at::text, updated_at::text
         FROM automation_rules
        WHERE guild_id = $1 AND ($2::boolean OR status <> 'archived')
        ORDER BY name, id LIMIT $3`,
      [this.#guildId, includeArchived, limit],
    )).rows;
    return rows.map(automationRuleFromRow);
  }

  async getAutomationRule(id: string, forUpdate = false): Promise<AutomationRule> {
    const row = (await this.#connection.query<AutomationRuleRow>(
      `SELECT id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
              created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
              input_template, status, next_run_at::text, last_run_at::text,
              consecutive_failures, version, created_at::text, updated_at::text
         FROM automation_rules WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Automation rule was not found in this Guild.");
    return automationRuleFromRow(row);
  }

  async createAutomationRule(input: CreateAutomationRuleInput): Promise<AutomationRule> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "automation_rule", input.id);
    const rule = await this.#insertAutomationRule(input);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return rule;
  }

  async replaceAutomationRule(input: ReplaceAutomationRuleInput): Promise<{
    previous: AutomationRule;
    replacement: AutomationRule;
  }> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "automation_rule", input.replacement.id);
    if (input.currentId === input.replacement.id) {
      throw new Error("An Automation replacement requires a new ID.");
    }
    const current = await this.getAutomationRule(input.currentId, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Automation rule");
    if (current.status === "archived") throw new Error("An archived Automation rule cannot be replaced.");
    const replacement = await this.#insertAutomationRule(input.replacement);
    const row = (await this.#connection.query<AutomationRuleRow>(
      `UPDATE automation_rules SET status = 'archived', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'archived'
      RETURNING id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
                created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
                input_template, status, next_run_at::text, last_run_at::text,
                consecutive_failures, version, created_at::text, updated_at::text`,
      [this.#guildId, input.currentId, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Automation rule changed. Reload before replacing it.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { previous: automationRuleFromRow(row), replacement };
  }

  async setAutomationRuleStatus(input: SetAutomationRuleStatusInput): Promise<AutomationRule> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "automation_rule", input.id);
    const current = await this.getAutomationRule(input.id, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Automation rule");
    if (current.status === "archived" && input.status !== "archived") {
      throw new Error("An archived Automation rule cannot be restored; create a replacement.");
    }
    const nextRunAt = input.nextRunAt === undefined ? current.nextRunAt : input.nextRunAt;
    if (current.triggerKind === "schedule" && nextRunAt === null) {
      throw new Error("A scheduled Automation rule requires its next run time.");
    }
    if (nextRunAt !== null) assertDate(nextRunAt, "Next Automation run");
    if (current.status === input.status && current.nextRunAt === nextRunAt) return current;
    const row = (await this.#connection.query<AutomationRuleRow>(
      `UPDATE automation_rules
          SET status = $4, next_run_at = $5, version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
      RETURNING id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
                created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
                input_template, status, next_run_at::text, last_run_at::text,
                consecutive_failures, version, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion, input.status, nextRunAt],
    )).rows[0];
    if (!row) throw new Error("Automation rule changed. Reload before changing its status.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return automationRuleFromRow(row);
  }

  async recordAutomationEvent(input: RecordAutomationEventInput): Promise<IdempotentResult<AutomationEventRecord>> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "automation_event", input.id);
    assertNonBlank(input.eventType, "Automation event type", 200);
    assertNonBlank(input.idempotencyKey, "Automation event idempotency key", 500);
    const inserted = (await this.#connection.query<AutomationEventRow>(
      `INSERT INTO automation_events
         (id, guild_id, event_type, source_actor_id, payload, idempotency_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING id::text, guild_id::text, event_type, source_actor_id::text, payload,
                 idempotency_key, status, processed_at::text, last_error, created_at::text`,
      [
        input.id, this.#guildId, input.eventType, input.sourceActorId,
        JSON.stringify(input.payload), input.idempotencyKey,
      ],
    )).rows[0];
    if (inserted) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return { value: automationEventFromRow(inserted), created: true };
    }
    const existing = (await this.#connection.query<AutomationEventRow & { input_matches: boolean }>(
      `SELECT id::text, guild_id::text, event_type, source_actor_id::text, payload,
              idempotency_key, status, processed_at::text, last_error, created_at::text,
              event_type = $3 AND source_actor_id = $4 AND payload = $5::jsonb AS input_matches
         FROM automation_events
        WHERE guild_id = $1 AND idempotency_key = $2`,
      [this.#guildId, input.idempotencyKey, input.eventType, input.sourceActorId, JSON.stringify(input.payload)],
    )).rows[0];
    if (!existing) throw new Error("Automation event idempotency conflict could not be resolved.");
    if (!existing.input_matches) {
      throw new Error("Automation event idempotency key was reused with different input.");
    }
    return { value: automationEventFromRow(existing), created: false };
  }

  async claimDueSchedule(input: ClaimDueScheduleInput): Promise<DueScheduleClaim | null> {
    assertDate(input.now, "Schedule claim time");
    assertDate(input.nextRunAt, "Next schedule time");
    if (new Date(input.nextRunAt).valueOf() <= new Date(input.now).valueOf()) {
      throw new Error("The next schedule time must be later than the claim time.");
    }
    const dueRow = (await this.#connection.query<AutomationRuleRow>(
      `SELECT rule.id::text, rule.guild_id::text, rule.workflow_id::text,
              rule.agent_actor_id::text, rule.created_by_actor_id::text, rule.name,
              rule.trigger_kind, rule.trigger_expression, rule.timezone, rule.input_template,
              rule.status, rule.next_run_at::text, rule.last_run_at::text,
              rule.consecutive_failures, rule.version, rule.created_at::text, rule.updated_at::text
         FROM automation_rules rule
         JOIN workflow_definitions workflow
           ON workflow.guild_id = rule.guild_id AND workflow.id = rule.workflow_id
         JOIN actor_memberships membership
           ON membership.guild_id = rule.guild_id AND membership.actor_id = rule.agent_actor_id
         JOIN actors actor ON actor.id = rule.agent_actor_id
        WHERE rule.guild_id = $1 AND rule.status = 'active' AND rule.trigger_kind = 'schedule'
          AND rule.next_run_at <= $2 AND workflow.status = 'active'
          AND membership.state IN ('joined', 'active') AND membership.operational = true
          AND actor.status = 'active' AND actor.kind = 'agent'
        ORDER BY rule.next_run_at, rule.id
        FOR UPDATE OF rule SKIP LOCKED LIMIT 1`,
      [this.#guildId, input.now],
    )).rows[0];
    if (!dueRow) return null;

    const scheduledFor = optionalIso(dueRow.next_run_at);
    if (!scheduledFor) throw new Error("A due schedule is missing its scheduled time.");
    const idempotencyKey = `schedule:${dueRow.id}:${scheduledFor}`;
    const requestId = randomUUID();
    const inserted = (await this.#connection.query<WorkflowRunRequestRow>(
      `INSERT INTO workflow_run_requests
         (id, guild_id, workflow_id, automation_rule_id, requested_by_actor_id,
          agent_actor_id, trigger_kind, input, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'schedule', $7::jsonb, $8)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
                 requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
                 trigger_event_id::text, input, status, idempotency_key, output,
                 error_message, started_at::text, finished_at::text, created_at::text, updated_at::text`,
      [
        requestId, this.#guildId, dueRow.workflow_id, dueRow.id, dueRow.created_by_actor_id,
        dueRow.agent_actor_id, JSON.stringify(dueRow.input_template), idempotencyKey,
      ],
    )).rows[0];
    const requestRow = inserted ?? (await this.#connection.query<WorkflowRunRequestRow>(
      `SELECT id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
              requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
              trigger_event_id::text, input, status, idempotency_key, output,
              error_message, started_at::text, finished_at::text, created_at::text, updated_at::text
         FROM workflow_run_requests WHERE guild_id = $1 AND idempotency_key = $2`,
      [this.#guildId, idempotencyKey],
    )).rows[0];
    if (!requestRow) throw new Error("Scheduled Workflow request could not be persisted.");
    const updatedRule = (await this.#connection.query<AutomationRuleRow>(
      `UPDATE automation_rules
          SET last_run_at = next_run_at, next_run_at = $3,
              consecutive_failures = 0, version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $4
      RETURNING id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
                created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
                input_template, status, next_run_at::text, last_run_at::text,
                consecutive_failures, version, created_at::text, updated_at::text`,
      [this.#guildId, dueRow.id, input.nextRunAt, dueRow.version],
    )).rows[0];
    if (!updatedRule) throw new Error("Scheduled Automation rule changed while it was claimed.");
    if (inserted) {
      await this.#chronicle.appendChronicle(this.#automaticEvent(
        dueRow.created_by_actor_id,
        "automation.schedule.claimed",
        "workflow_run_request",
        requestRow.id,
        { automationRuleId: dueRow.id, scheduledFor },
      ));
    }
    return {
      rule: automationRuleFromRow(updatedRule),
      request: workflowRunRequestFromRow(requestRow),
      requestCreated: inserted !== undefined,
    };
  }

  async claimNextAutomationEvent(): Promise<AutomationEventClaim | null> {
    const eventRow = (await this.#connection.query<AutomationEventRow>(
      `SELECT id::text, guild_id::text, event_type, source_actor_id::text, payload,
              idempotency_key, status, processed_at::text, last_error, created_at::text
         FROM automation_events
        WHERE guild_id = $1 AND status = 'pending'
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      [this.#guildId],
    )).rows[0];
    if (!eventRow) return null;

    await this.#connection.query(
      `UPDATE automation_events SET status = 'processing', last_error = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
      [this.#guildId, eventRow.id],
    );
    const inserted = (await this.#connection.query<WorkflowRunRequestRow>(
      `INSERT INTO workflow_run_requests
         (id, guild_id, workflow_id, automation_rule_id, requested_by_actor_id,
          agent_actor_id, trigger_kind, trigger_event_id, input, idempotency_key)
       SELECT gen_random_uuid(), rule.guild_id, rule.workflow_id, rule.id, $3::uuid,
              rule.agent_actor_id, 'event', $2::uuid,
              rule.input_template || jsonb_build_object(
                'eventType', $4::text, 'eventId', $2::text, 'event', $5::jsonb
              ),
              'event:' || $2::text || ':rule:' || rule.id::text
         FROM automation_rules rule
         JOIN workflow_definitions workflow
           ON workflow.guild_id = rule.guild_id AND workflow.id = rule.workflow_id
         JOIN actor_memberships membership
           ON membership.guild_id = rule.guild_id AND membership.actor_id = rule.agent_actor_id
         JOIN actors actor ON actor.id = rule.agent_actor_id
        WHERE rule.guild_id = $1 AND rule.status = 'active' AND rule.trigger_kind = 'event'
          AND rule.trigger_expression = $4 AND workflow.status = 'active'
          AND membership.state IN ('joined', 'active') AND membership.operational = true
          AND actor.status = 'active' AND actor.kind = 'agent'
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
                 requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
                 trigger_event_id::text, input, status, idempotency_key, output,
                 error_message, started_at::text, finished_at::text, created_at::text, updated_at::text`,
      [
        this.#guildId, eventRow.id, eventRow.source_actor_id, eventRow.event_type,
        JSON.stringify(eventRow.payload),
      ],
    )).rows;
    const completed = (await this.#connection.query<AutomationEventRow>(
      `UPDATE automation_events
          SET status = 'completed', processed_at = now(), last_error = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'
      RETURNING id::text, guild_id::text, event_type, source_actor_id::text, payload,
                idempotency_key, status, processed_at::text, last_error, created_at::text`,
      [this.#guildId, eventRow.id],
    )).rows[0];
    if (!completed) throw new Error("Automation event changed while it was being claimed.");
    const allRows = (await this.#connection.query<WorkflowRunRequestRow>(
      `SELECT id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
              requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
              trigger_event_id::text, input, status, idempotency_key, output,
              error_message, started_at::text, finished_at::text, created_at::text, updated_at::text
         FROM workflow_run_requests
        WHERE guild_id = $1 AND trigger_event_id = $2
        ORDER BY created_at, id`,
      [this.#guildId, eventRow.id],
    )).rows;
    await this.#chronicle.appendChronicle(this.#automaticEvent(
      eventRow.source_actor_id,
      "automation.event.claimed",
      "automation_event",
      eventRow.id,
      { createdRequestCount: inserted.length, totalRequestCount: allRows.length },
    ));
    return {
      event: automationEventFromRow(completed),
      requests: allRows.map(workflowRunRequestFromRow),
      createdRequestCount: inserted.length,
    };
  }

  async enqueueManualRun(input: EnqueueManualRunInput): Promise<IdempotentResult<WorkflowRunRequest>> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "workflow_run_request", input.id);
    assertNonBlank(input.idempotencyKey, "Workflow request idempotency key", 500);
    await this.#assertRunnableWorkflowAndAgent(input.workflowId, input.agentActorId);
    const inserted = (await this.#connection.query<WorkflowRunRequestRow>(
      `INSERT INTO workflow_run_requests
         (id, guild_id, workflow_id, requested_by_actor_id, agent_actor_id,
          trigger_kind, input, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'manual', $6::jsonb, $7)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
                 requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
                 trigger_event_id::text, input, status, idempotency_key, output,
                 error_message, started_at::text, finished_at::text, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.workflowId, input.requestedByActorId,
        input.agentActorId, JSON.stringify(input.input), input.idempotencyKey,
      ],
    )).rows[0];
    if (inserted) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return { value: workflowRunRequestFromRow(inserted), created: true };
    }
    const existing = (await this.#connection.query<WorkflowRunRequestRow & { input_matches: boolean }>(
      `SELECT id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
              requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
              trigger_event_id::text, input, status, idempotency_key, output,
              error_message, started_at::text, finished_at::text, created_at::text, updated_at::text,
              workflow_id = $3 AND requested_by_actor_id = $4 AND agent_actor_id = $5
                AND trigger_kind = 'manual' AND input = $6::jsonb AS input_matches
         FROM workflow_run_requests WHERE guild_id = $1 AND idempotency_key = $2`,
      [
        this.#guildId, input.idempotencyKey, input.workflowId,
        input.requestedByActorId, input.agentActorId, JSON.stringify(input.input),
      ],
    )).rows[0];
    if (!existing) throw new Error("Workflow request idempotency conflict could not be resolved.");
    if (!existing.input_matches) {
      throw new Error("Workflow request idempotency key was reused with different input.");
    }
    return { value: workflowRunRequestFromRow(existing), created: false };
  }

  async listWorkflowRunRequests(limit = DEFAULT_LIMIT): Promise<WorkflowRunRequest[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<WorkflowRunRequestRow>(
      `SELECT id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
              requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
              trigger_event_id::text, input, status, idempotency_key, output,
              error_message, started_at::text, finished_at::text, created_at::text, updated_at::text
         FROM workflow_run_requests WHERE guild_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    return rows.map(workflowRunRequestFromRow);
  }

  async claimNextWorkflowRunRequest(): Promise<WorkflowRunRequest | null> {
    const row = (await this.#connection.query<WorkflowRunRequestRow>(
      `WITH candidate AS (
         SELECT request.id
           FROM workflow_run_requests request
           JOIN workflow_definitions workflow
             ON workflow.guild_id = request.guild_id AND workflow.id = request.workflow_id
           JOIN actor_memberships membership
             ON membership.guild_id = request.guild_id AND membership.actor_id = request.agent_actor_id
           JOIN actors actor ON actor.id = request.agent_actor_id
          WHERE request.guild_id = $1 AND request.status = 'queued'
            AND workflow.status = 'active'
            AND membership.state IN ('joined', 'active') AND membership.operational = true
            AND actor.status = 'active' AND actor.kind = 'agent'
          ORDER BY request.created_at, request.id
          FOR UPDATE OF request SKIP LOCKED LIMIT 1
       )
       UPDATE workflow_run_requests request
          SET status = 'planning', started_at = COALESCE(started_at, now()), updated_at = now()
         FROM candidate
        WHERE request.guild_id = $1 AND request.id = candidate.id AND request.status = 'queued'
       RETURNING request.id::text, request.guild_id::text, request.workflow_id::text,
                 request.automation_rule_id::text, request.requested_by_actor_id::text,
                 request.agent_actor_id::text, request.trigger_kind, request.trigger_event_id::text,
                 request.input, request.status, request.idempotency_key, request.output,
                 request.error_message, request.started_at::text, request.finished_at::text,
                 request.created_at::text, request.updated_at::text`,
      [this.#guildId],
    )).rows[0];
    return row ? workflowRunRequestFromRow(row) : null;
  }

  async markWorkflowRunRequestRunning(id: string): Promise<WorkflowRunRequest> {
    const row = (await this.#connection.query<WorkflowRunRequestRow>(
      `UPDATE workflow_run_requests SET status = 'running', updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status = 'planning'
      RETURNING id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
                requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
                trigger_event_id::text, input, status, idempotency_key, output,
                error_message, started_at::text, finished_at::text, created_at::text, updated_at::text`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Workflow request is not in planning state in this Guild.");
    return workflowRunRequestFromRow(row);
  }

  async finishWorkflowRunRequest(input: FinishWorkflowRunRequestInput): Promise<WorkflowRunRequest> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "workflow_run_request", input.id);
    if (input.status === "succeeded" && input.output === null) {
      throw new Error("A successful Workflow request requires output.");
    }
    if (input.status === "failed") assertNonBlank(input.errorMessage ?? "", "Workflow error", 2000);
    const row = (await this.#connection.query<WorkflowRunRequestRow>(
      `UPDATE workflow_run_requests
          SET status = $3, output = $4::jsonb, error_message = $5,
              finished_at = now(), updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status IN ('planning', 'running')
      RETURNING id::text, guild_id::text, workflow_id::text, automation_rule_id::text,
                requested_by_actor_id::text, agent_actor_id::text, trigger_kind,
                trigger_event_id::text, input, status, idempotency_key, output,
                error_message, started_at::text, finished_at::text, created_at::text, updated_at::text`,
      [
        this.#guildId, input.id, input.status,
        input.output === null ? null : JSON.stringify(input.output), input.errorMessage,
      ],
    )).rows[0];
    if (!row) throw new Error("Workflow request is not claimable or has already finished.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return workflowRunRequestFromRow(row);
  }

  async listFederationLinks(includeRevoked = false, limit = DEFAULT_LIMIT): Promise<FederationLink[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<FederationLinkRow>(
      `SELECT id::text, guild_id::text, remote_guild_id::text, remote_name, endpoint_url,
              secret_reference, direction, status, allowed_resource_types,
              created_by_actor_id::text, version, created_at::text, updated_at::text
         FROM federation_links
        WHERE guild_id = $1 AND ($2::boolean OR status <> 'revoked')
        ORDER BY remote_name, id LIMIT $3`,
      [this.#guildId, includeRevoked, limit],
    )).rows;
    return rows.map(federationLinkFromRow);
  }

  async getFederationLink(id: string, forUpdate = false): Promise<FederationLink> {
    const row = (await this.#connection.query<FederationLinkRow>(
      `SELECT id::text, guild_id::text, remote_guild_id::text, remote_name, endpoint_url,
              secret_reference, direction, status, allowed_resource_types,
              created_by_actor_id::text, version, created_at::text, updated_at::text
         FROM federation_links WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Federation link was not found in this Guild.");
    return federationLinkFromRow(row);
  }

  async createFederationLink(input: CreateFederationLinkInput): Promise<FederationLink> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_link", input.id);
    assertFederationDirection(input.direction);
    for (const resourceType of input.allowedResourceTypes) assertFederationResourceType(resourceType);
    if (new Set(input.allowedResourceTypes).size !== input.allowedResourceTypes.length) {
      throw new Error("Federation resource types must be unique.");
    }
    const row = (await this.#connection.query<FederationLinkRow>(
      `INSERT INTO federation_links
         (id, guild_id, remote_guild_id, remote_name, endpoint_url, secret_reference,
          direction, status, allowed_resource_types, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10)
       RETURNING id::text, guild_id::text, remote_guild_id::text, remote_name, endpoint_url,
                 secret_reference, direction, status, allowed_resource_types,
                 created_by_actor_id::text, version, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.remoteGuildId, input.remoteName, input.endpointUrl,
        input.secretReference, input.direction, input.status ?? "pending",
        input.allowedResourceTypes, input.createdByActorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Federation link could not be created.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationLinkFromRow(row);
  }

  async activateFederationLink(input: ActivateFederationLinkInput): Promise<FederationLink> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_link", input.id);
    const row = (await this.#connection.query<FederationLinkRow>(
      `UPDATE federation_links SET status = 'active', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status = 'pending'
      RETURNING id::text, guild_id::text, remote_guild_id::text, remote_name, endpoint_url,
                secret_reference, direction, status, allowed_resource_types,
                created_by_actor_id::text, version, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Federation link changed, is not pending, or is outside this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationLinkFromRow(row);
  }

  async revokeFederationLink(input: RevokeVersionedInput): Promise<FederationLink> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_link", input.id);
    const row = (await this.#connection.query<FederationLinkRow>(
      `UPDATE federation_links SET status = 'revoked', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, remote_guild_id::text, remote_name, endpoint_url,
                secret_reference, direction, status, allowed_resource_types,
                created_by_actor_id::text, version, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Federation link changed, was revoked, or is outside this Guild.");
    await this.#connection.query(
      `UPDATE federation_grants
          SET status = 'revoked', revoked_by_actor_id = $3, revoked_at = now(), version = version + 1
        WHERE guild_id = $1 AND federation_link_id = $2 AND status = 'active'`,
      [this.#guildId, input.id, input.actorId],
    );
    await this.#connection.query(
      `UPDATE federation_deliveries
          SET status = 'rejected', completed_at = now(),
              last_error = 'Federation link was revoked.'
        WHERE guild_id = $1 AND federation_link_id = $2
          AND status IN ('pending', 'processing', 'failed')`,
      [this.#guildId, input.id],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationLinkFromRow(row);
  }

  async listFederationGrants(
    federationLinkId: string,
    includeRevoked = false,
    limit = DEFAULT_LIMIT,
  ): Promise<FederationGrant[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<FederationGrantRow>(
      `SELECT grant_record.id::text, grant_record.guild_id::text,
              grant_record.federation_link_id::text, grant_record.resource_type,
              grant_record.resource_id::text, grant_record.permission, grant_record.status,
              grant_record.granted_by_actor_id::text, grant_record.revoked_by_actor_id::text,
              grant_record.revoked_at::text, grant_record.version, grant_record.created_at::text
         FROM federation_grants grant_record
         JOIN federation_links link
           ON link.guild_id = grant_record.guild_id AND link.id = grant_record.federation_link_id
        WHERE grant_record.guild_id = $1 AND grant_record.federation_link_id = $2
          AND ($3::boolean OR grant_record.status = 'active')
        ORDER BY grant_record.created_at, grant_record.id LIMIT $4`,
      [this.#guildId, federationLinkId, includeRevoked, limit],
    )).rows;
    return rows.map(federationGrantFromRow);
  }

  async createFederationGrant(input: CreateFederationGrantInput): Promise<FederationGrant> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_grant", input.id);
    assertFederationResourceType(input.resourceType);
    const link = await this.getFederationLink(input.federationLinkId, true);
    if (link.status !== "active") throw new Error("Federation grants require an active link.");
    if (link.direction !== "outbound" && link.direction !== "bidirectional") {
      throw new Error("This Federation link does not allow outbound resource grants.");
    }
    if (!link.allowedResourceTypes.includes(input.resourceType)) {
      throw new Error("This Federation link does not allow the selected resource type.");
    }
    if (!(await this.#federatedResourceExists(input.resourceType, input.resourceId))) {
      throw new Error("The selected Federation resource does not exist in this Guild.");
    }
    const row = (await this.#connection.query<FederationGrantRow>(
      `INSERT INTO federation_grants
         (id, guild_id, federation_link_id, resource_type, resource_id,
          permission, granted_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text, guild_id::text, federation_link_id::text, resource_type,
                 resource_id::text, permission, status, granted_by_actor_id::text,
                 revoked_by_actor_id::text, revoked_at::text, version, created_at::text`,
      [
        input.id, this.#guildId, input.federationLinkId, input.resourceType,
        input.resourceId, input.permission, input.grantedByActorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Federation grant could not be created.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationGrantFromRow(row);
  }

  async revokeFederationGrant(input: RevokeFederationGrantInput): Promise<FederationGrant> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_grant", input.id);
    const row = (await this.#connection.query<FederationGrantRow>(
      `UPDATE federation_grants
          SET status = 'revoked', revoked_by_actor_id = $4, revoked_at = now(),
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status = 'active'
      RETURNING id::text, guild_id::text, federation_link_id::text, resource_type,
                resource_id::text, permission, status, granted_by_actor_id::text,
                revoked_by_actor_id::text, revoked_at::text, version, created_at::text`,
      [this.#guildId, input.id, input.expectedVersion, input.revokedByActorId],
    )).rows[0];
    if (!row) throw new Error("Federation grant changed, was revoked, or is outside this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationGrantFromRow(row);
  }

  async listFederatedResourceReferences(
    federationLinkId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<FederatedResourceReference[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<FederationGrantRow & {
      remote_guild_id: string;
      direction: FederationLink["direction"];
    }>(
      `SELECT grant_record.id::text, grant_record.guild_id::text,
              grant_record.federation_link_id::text, grant_record.resource_type,
              grant_record.resource_id::text, grant_record.permission, grant_record.status,
              grant_record.granted_by_actor_id::text, grant_record.revoked_by_actor_id::text,
              grant_record.revoked_at::text, grant_record.version, grant_record.created_at::text,
              link.remote_guild_id::text, link.direction
         FROM federation_grants grant_record
         JOIN federation_links link
           ON link.guild_id = grant_record.guild_id AND link.id = grant_record.federation_link_id
        WHERE grant_record.guild_id = $1 AND grant_record.federation_link_id = $2
          AND grant_record.status = 'active' AND link.status = 'active'
          AND link.direction IN ('outbound', 'bidirectional')
          AND grant_record.resource_type = ANY(link.allowed_resource_types)
        ORDER BY grant_record.created_at, grant_record.id LIMIT $3`,
      [this.#guildId, federationLinkId, limit],
    )).rows;
    return rows.map((row) => ({
      grant: federationGrantFromRow(row),
      remoteGuildId: row.remote_guild_id,
      direction: row.direction,
    }));
  }

  async enqueueFederationDelivery(
    input: EnqueueFederationDeliveryInput,
  ): Promise<IdempotentResult<FederationDelivery>> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_delivery", input.id);
    assertNonBlank(input.eventType, "Federation delivery event type", 200);
    assertNonBlank(input.idempotencyKey, "Federation delivery idempotency key", 500);
    if (input.availableAt !== undefined) assertDate(input.availableAt, "Federation delivery availability");
    const authorization = (await this.#connection.query<QueryResultRow>(
      `SELECT 1
         FROM federation_grants grant_record
         JOIN federation_links link
           ON link.guild_id = grant_record.guild_id AND link.id = grant_record.federation_link_id
        WHERE grant_record.guild_id = $1 AND grant_record.id = $2
          AND grant_record.federation_link_id = $3 AND grant_record.status = 'active'
          AND link.status = 'active' AND link.direction IN ('outbound', 'bidirectional')
          AND grant_record.resource_type = ANY(link.allowed_resource_types)
        FOR UPDATE OF grant_record, link`,
      [this.#guildId, input.federationGrantId, input.federationLinkId],
    )).rows[0];
    if (!authorization) {
      throw new Error("Outbound Federation delivery requires an explicit active resource grant.");
    }
    return this.#insertFederationDelivery({
      id: input.id,
      federationLinkId: input.federationLinkId,
      direction: "outbound",
      eventType: input.eventType,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      availableAt: input.availableAt ?? new Date().toISOString(),
      chronicleEvent: input.chronicleEvent,
    });
  }

  async recordInboundFederationDelivery(
    input: RecordInboundFederationDeliveryInput,
  ): Promise<IdempotentResult<FederationDelivery>> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_delivery", input.id);
    assertNonBlank(input.eventType, "Federation delivery event type", 200);
    assertNonBlank(input.idempotencyKey, "Federation delivery idempotency key", 500);
    const link = await this.getFederationLink(input.federationLinkId, true);
    if (link.status !== "active" || (link.direction !== "inbound" && link.direction !== "bidirectional")) {
      throw new Error("This Federation link does not accept inbound deliveries.");
    }
    return this.#insertFederationDelivery({
      id: input.id,
      federationLinkId: input.federationLinkId,
      direction: "inbound",
      eventType: input.eventType,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      availableAt: new Date().toISOString(),
      chronicleEvent: input.chronicleEvent,
    });
  }

  async listFederationDeliveries(federationLinkId: string, limit = DEFAULT_LIMIT): Promise<FederationDelivery[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<FederationDeliveryRow>(
      `SELECT delivery.id::text, delivery.guild_id::text, delivery.federation_link_id::text,
              delivery.direction, delivery.event_type, delivery.payload, delivery.payload_hash,
              delivery.idempotency_key, delivery.status, delivery.attempt_count,
              delivery.available_at::text, delivery.completed_at::text,
              delivery.last_error, delivery.created_at::text
         FROM federation_deliveries delivery
         JOIN federation_links link
           ON link.guild_id = delivery.guild_id AND link.id = delivery.federation_link_id
        WHERE delivery.guild_id = $1 AND delivery.federation_link_id = $2
        ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT $3`,
      [this.#guildId, federationLinkId, limit],
    )).rows;
    return rows.map(federationDeliveryFromRow);
  }

  async claimOutboundFederationDelivery(now: string): Promise<FederationDelivery | null> {
    assertDate(now, "Federation delivery claim time");
    const row = (await this.#connection.query<FederationDeliveryRow>(
      `WITH candidate AS (
         SELECT delivery.id
           FROM federation_deliveries delivery
           JOIN federation_links link
             ON link.guild_id = delivery.guild_id AND link.id = delivery.federation_link_id
          WHERE delivery.guild_id = $1 AND delivery.direction = 'outbound'
            AND delivery.status IN ('pending', 'failed') AND delivery.available_at <= $2
            AND delivery.attempt_count < 20 AND link.status = 'active'
            AND link.direction IN ('outbound', 'bidirectional')
          ORDER BY delivery.available_at, delivery.id
          FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
       )
       UPDATE federation_deliveries delivery
          SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL
         FROM candidate
        WHERE delivery.guild_id = $1 AND delivery.id = candidate.id
       RETURNING delivery.id::text, delivery.guild_id::text,
                 delivery.federation_link_id::text, delivery.direction, delivery.event_type,
                 delivery.payload, delivery.payload_hash, delivery.idempotency_key,
                 delivery.status, delivery.attempt_count, delivery.available_at::text,
                 delivery.completed_at::text, delivery.last_error, delivery.created_at::text`,
      [this.#guildId, now],
    )).rows[0];
    return row ? federationDeliveryFromRow(row) : null;
  }

  async finishFederationDelivery(input: FinishFederationDeliveryInput): Promise<FederationDelivery> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "federation_delivery", input.id);
    if (!input.succeeded) {
      assertNonBlank(input.errorMessage ?? "", "Federation delivery error", 2000);
      if (input.retryAt !== undefined) assertDate(input.retryAt, "Federation retry time");
    }
    const row = (await this.#connection.query<FederationDeliveryRow>(
      `UPDATE federation_deliveries
          SET status = CASE WHEN $3::boolean THEN 'completed'
                            WHEN attempt_count >= 20 THEN 'rejected' ELSE 'failed' END,
              completed_at = CASE WHEN $3::boolean OR attempt_count >= 20 THEN now() ELSE NULL END,
              last_error = $4,
              available_at = CASE WHEN $3::boolean THEN available_at
                                  ELSE COALESCE($5::timestamptz, now() + interval '5 minutes') END
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'
      RETURNING id::text, guild_id::text, federation_link_id::text, direction, event_type,
                payload, payload_hash, idempotency_key, status, attempt_count,
                available_at::text, completed_at::text, last_error, created_at::text`,
      [this.#guildId, input.id, input.succeeded, input.errorMessage, input.retryAt ?? null],
    )).rows[0];
    if (!row) throw new Error("Federation delivery is not processing in this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return federationDeliveryFromRow(row);
  }

  async listModelProviders(includeRevoked = false, limit = DEFAULT_LIMIT): Promise<ModelProvider[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<ModelProviderRow>(
      `SELECT id::text, guild_id::text, name, kind, endpoint_url, secret_reference,
              allowed_models, status, deployment_managed, created_by_actor_id::text,
              version, created_at::text, updated_at::text
         FROM model_providers
        WHERE guild_id = $1 AND ($2::boolean OR status <> 'revoked')
        ORDER BY name, id LIMIT $3`,
      [this.#guildId, includeRevoked, limit],
    )).rows;
    return rows.map(modelProviderFromRow);
  }

  async getModelProvider(id: string, forUpdate = false): Promise<ModelProvider> {
    const row = (await this.#connection.query<ModelProviderRow>(
      `SELECT id::text, guild_id::text, name, kind, endpoint_url, secret_reference,
              allowed_models, status, deployment_managed, created_by_actor_id::text,
              version, created_at::text, updated_at::text
         FROM model_providers WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Model provider was not found in this Guild.");
    return modelProviderFromRow(row);
  }

  async createModelProvider(input: CreateModelProviderInput): Promise<ModelProvider> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "model_provider", input.id);
    const provider = await this.#insertModelProvider(input);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return provider;
  }

  async replaceModelProvider(input: ReplaceModelProviderInput): Promise<ModelProviderReplacement> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "model_provider", input.replacement.id);
    if (input.currentId === input.replacement.id) {
      throw new Error("A Model provider replacement requires a new ID.");
    }
    const current = await this.getModelProvider(input.currentId, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Model provider");
    if (current.status === "revoked") throw new Error("A revoked Model provider cannot be replaced.");

    const currentRoutes = (await this.#connection.query<ModelRouteRow>(
      `SELECT id::text, guild_id::text, purpose, provider_id::text, primary_model,
              fallback_model, max_tokens, daily_budget_minor, cache_enabled, status,
              updated_by_actor_id::text, version, created_at::text, updated_at::text
         FROM model_routes WHERE guild_id = $1 AND provider_id = $2
        ORDER BY purpose FOR UPDATE`,
      [this.#guildId, input.currentId],
    )).rows.map(modelRouteFromRow);
    if (currentRoutes.some((route) => route.status === "active") &&
        (input.replacement.status ?? "active") !== "active") {
      throw new Error("A replacement provider for active Model routes must itself be active.");
    }
    for (const route of currentRoutes) {
      this.#assertModelsAllowed(input.replacement.allowedModels, route.primaryModel, route.fallbackModel);
    }
    const replacement = await this.#insertModelProvider(input.replacement);
    const updatedRoutes = (await this.#connection.query<ModelRouteRow>(
      `UPDATE model_routes
          SET provider_id = $3, updated_by_actor_id = $4,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND provider_id = $2
      RETURNING id::text, guild_id::text, purpose, provider_id::text, primary_model,
                fallback_model, max_tokens, daily_budget_minor, cache_enabled, status,
                updated_by_actor_id::text, version, created_at::text, updated_at::text`,
      [this.#guildId, input.currentId, replacement.id, input.actorId],
    )).rows.map(modelRouteFromRow);
    const previousRow = (await this.#connection.query<ModelProviderRow>(
      `UPDATE model_providers SET status = 'revoked', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, name, kind, endpoint_url, secret_reference,
                allowed_models, status, deployment_managed, created_by_actor_id::text,
                version, created_at::text, updated_at::text`,
      [this.#guildId, input.currentId, input.expectedVersion],
    )).rows[0];
    if (!previousRow) throw new Error("Model provider changed. Reload before replacing it.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return {
      previous: modelProviderFromRow(previousRow),
      replacement,
      routes: updatedRoutes,
    };
  }

  async revokeModelProvider(input: RevokeVersionedInput): Promise<ModelProvider> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "model_provider", input.id);
    const current = await this.getModelProvider(input.id, true);
    this.#assertCurrentVersion(current.version, input.expectedVersion, "Model provider");
    if (current.status === "revoked") throw new Error("A revoked Model provider cannot be revoked again.");
    const activeRoute = (await this.#connection.query<QueryResultRow>(
      `SELECT 1 FROM model_routes
        WHERE guild_id = $1 AND provider_id = $2 AND status = 'active' LIMIT 1`,
      [this.#guildId, input.id],
    )).rows[0];
    if (activeRoute) throw new Error("Move or disable active Model routes before revoking their provider.");
    const row = (await this.#connection.query<ModelProviderRow>(
      `UPDATE model_providers SET status = 'revoked', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status <> 'revoked'
      RETURNING id::text, guild_id::text, name, kind, endpoint_url, secret_reference,
                allowed_models, status, deployment_managed, created_by_actor_id::text,
                version, created_at::text, updated_at::text`,
      [this.#guildId, input.id, input.expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Model provider changed, was revoked, or is outside this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return modelProviderFromRow(row);
  }

  async listModelRoutes(limit = DEFAULT_LIMIT): Promise<ModelRoute[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<ModelRouteRow>(
      `SELECT id::text, guild_id::text, purpose, provider_id::text, primary_model,
              fallback_model, max_tokens, daily_budget_minor, cache_enabled, status,
              updated_by_actor_id::text, version, created_at::text, updated_at::text
         FROM model_routes WHERE guild_id = $1
        ORDER BY purpose, id LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    return rows.map(modelRouteFromRow);
  }

  async createModelRoute(input: CreateModelRouteInput): Promise<ModelRoute> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "model_route", input.id);
    assertModelPurpose(input.purpose);
    await this.#validateModelRoute(input.providerId, input.primaryModel, input.fallbackModel);
    const row = (await this.#connection.query<ModelRouteRow>(
      `INSERT INTO model_routes
         (id, guild_id, purpose, provider_id, primary_model, fallback_model,
          max_tokens, daily_budget_minor, cache_enabled, status, updated_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text, guild_id::text, purpose, provider_id::text, primary_model,
                 fallback_model, max_tokens, daily_budget_minor, cache_enabled, status,
                 updated_by_actor_id::text, version, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.purpose, input.providerId, input.primaryModel,
        input.fallbackModel, input.maxTokens, input.dailyBudgetMinor ?? 0,
        input.cacheEnabled ?? false, input.status ?? "active", input.updatedByActorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Model route could not be created.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return modelRouteFromRow(row);
  }

  async replaceModelRoute(input: ReplaceModelRouteInput): Promise<ModelRoute> {
    assertVersion(input.expectedVersion);
    this.#assertEvent(input.chronicleEvent, input.actorId, "model_route", input.id);
    await this.#validateModelRoute(
      input.replacement.providerId,
      input.replacement.primaryModel,
      input.replacement.fallbackModel,
    );
    const row = (await this.#connection.query<ModelRouteRow>(
      `UPDATE model_routes
          SET provider_id = $4, primary_model = $5, fallback_model = $6,
              max_tokens = $7, daily_budget_minor = $8, cache_enabled = $9,
              status = $10, updated_by_actor_id = $11,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
      RETURNING id::text, guild_id::text, purpose, provider_id::text, primary_model,
                fallback_model, max_tokens, daily_budget_minor, cache_enabled, status,
                updated_by_actor_id::text, version, created_at::text, updated_at::text`,
      [
        this.#guildId, input.id, input.expectedVersion, input.replacement.providerId,
        input.replacement.primaryModel, input.replacement.fallbackModel,
        input.replacement.maxTokens, input.replacement.dailyBudgetMinor ?? 0,
        input.replacement.cacheEnabled ?? false, input.replacement.status ?? "active",
        input.replacement.updatedByActorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Model route changed or does not exist in this Guild.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return modelRouteFromRow(row);
  }

  async resolveModelRoute(purpose: ModelPurpose): Promise<ResolvedModelRoute> {
    assertModelPurpose(purpose);
    const row = (await this.#connection.query<ModelRouteRow & {
      provider_name: string; provider_kind: ModelProviderKind; provider_endpoint_url: string | null;
      provider_secret_reference: string | null; provider_allowed_models: string[];
      provider_status: ModelProvider["status"]; provider_deployment_managed: boolean;
      provider_created_by_actor_id: string; provider_version: number;
      provider_created_at: string; provider_updated_at: string;
    }>(
      `SELECT route.id::text, route.guild_id::text, route.purpose, route.provider_id::text,
              route.primary_model, route.fallback_model, route.max_tokens,
              route.daily_budget_minor, route.cache_enabled, route.status,
              route.updated_by_actor_id::text, route.version,
              route.created_at::text, route.updated_at::text,
              provider.name AS provider_name, provider.kind AS provider_kind,
              provider.endpoint_url AS provider_endpoint_url,
              provider.secret_reference AS provider_secret_reference,
              provider.allowed_models AS provider_allowed_models,
              provider.status AS provider_status,
              provider.deployment_managed AS provider_deployment_managed,
              provider.created_by_actor_id::text AS provider_created_by_actor_id,
              provider.version AS provider_version,
              provider.created_at::text AS provider_created_at,
              provider.updated_at::text AS provider_updated_at
         FROM model_routes route
         JOIN model_providers provider
           ON provider.guild_id = route.guild_id AND provider.id = route.provider_id
        WHERE route.guild_id = $1 AND route.purpose = $2
          AND route.status = 'active' AND provider.status = 'active'`,
      [this.#guildId, purpose],
    )).rows[0];
    if (!row) throw new Error("No active Model route is configured for this purpose.");
    this.#assertModelsAllowed(row.provider_allowed_models, row.primary_model, row.fallback_model);
    return {
      route: modelRouteFromRow(row),
      provider: modelProviderFromRow({
        id: row.provider_id,
        guild_id: row.guild_id,
        name: row.provider_name,
        kind: row.provider_kind,
        endpoint_url: row.provider_endpoint_url,
        secret_reference: row.provider_secret_reference,
        allowed_models: row.provider_allowed_models,
        status: row.provider_status,
        deployment_managed: row.provider_deployment_managed,
        created_by_actor_id: row.provider_created_by_actor_id,
        version: row.provider_version,
        created_at: row.provider_created_at,
        updated_at: row.provider_updated_at,
      }),
    };
  }

  async getGuildDataExportInventory(): Promise<GuildDataExportInventory> {
    const guildRow = (await this.#connection.query<QueryResultRow & {
      id: string; name: string; purpose: string; root_owner_identity_id: string;
      created_at: string; updated_at: string;
    }>(
      `SELECT id::text, name, purpose, root_owner_identity_id::text,
              created_at::text, updated_at::text
         FROM guilds WHERE id = $1`,
      [this.#guildId],
    )).rows[0];
    if (!guildRow) throw new Error("Guild was not found for export inventory.");

    const tableRows = (await this.#connection.query<QueryResultRow & { table_name: string }>(
      `SELECT DISTINCT column_record.table_name
         FROM information_schema.columns column_record
         JOIN information_schema.tables table_record
           ON table_record.table_schema = column_record.table_schema
          AND table_record.table_name = column_record.table_name
        WHERE column_record.table_schema = 'public' AND column_record.column_name = 'guild_id'
          AND table_record.table_type = 'BASE TABLE'
          AND column_record.table_name <> 'guild_schema_migrations'
        ORDER BY column_record.table_name`,
    )).rows;
    const tables: GuildExportTableInventory[] = [{ tableName: "guilds", rowCount: "1" }];
    let totalRows = 1n;
    for (const { table_name: tableName } of tableRows) {
      if (!SAFE_TABLE_NAME.test(tableName)) {
        throw new Error("Database exposed an unsafe table name during export inventory.");
      }
      const count = (await this.#connection.query<QueryResultRow & { row_count: string }>(
        `SELECT count(*)::text AS row_count FROM "${tableName}" WHERE guild_id = $1`,
        [this.#guildId],
      )).rows[0]?.row_count;
      if (count === undefined || !/^\d+$/.test(count)) {
        throw new Error(`Export inventory count failed for ${tableName}.`);
      }
      tables.push({ tableName, rowCount: count });
      totalRows += BigInt(count);
    }

    const files = (await this.#connection.query<QueryResultRow & {
      id: string; r2_key: string; sha256: string; media_type: string;
      byte_size: string; created_at: string;
    }>(
      `SELECT id::text, r2_key, sha256, media_type, byte_size::text, created_at::text
         FROM files WHERE guild_id = $1 ORDER BY r2_key, id`,
      [this.#guildId],
    )).rows.map((row) => ({
      id: row.id,
      r2Key: row.r2_key,
      sha256: row.sha256,
      mediaType: row.media_type,
      byteSize: row.byte_size,
      createdAt: iso(row.created_at),
    }));
    const schemaMigrations = (await this.#connection.query<QueryResultRow & {
      name: string; checksum: string; applied_at: string;
    }>(
      `SELECT name, checksum, applied_at::text
         FROM public.guild_schema_migrations ORDER BY name`,
    )).rows.map((row) => ({
      name: row.name,
      checksum: row.checksum,
      appliedAt: iso(row.applied_at),
    }));
    const generatedAt = (await this.#connection.query<QueryResultRow & { generated_at: string }>(
      "SELECT clock_timestamp()::text AS generated_at",
    )).rows[0]?.generated_at;
    if (!generatedAt) throw new Error("Export inventory timestamp could not be generated.");
    return {
      guild: {
        id: guildRow.id,
        name: guildRow.name,
        purpose: guildRow.purpose,
        rootOwnerIdentityId: guildRow.root_owner_identity_id,
        createdAt: iso(guildRow.created_at),
        updatedAt: iso(guildRow.updated_at),
      },
      generatedAt: iso(generatedAt),
      totalRows: totalRows.toString(),
      tables,
      files,
      schemaMigrations,
    };
  }

  async #insertConnection(input: ConnectionDraft): Promise<Connector> {
    assertConnectionKind(input.kind);
    assertNonBlank(input.name, "Connection name", 200);
    assertNonBlank(input.provider ?? "custom", "Connection provider", 100);
    assertIdentifierList(input.capabilityPermissions, "Connection capabilities");
    const allowedIdentityIds = input.allowedIdentityIds ?? [];
    if (allowedIdentityIds.length > 100 || new Set(allowedIdentityIds).size !== allowedIdentityIds.length) {
      throw new Error("Connection access list must contain at most 100 unique Actors.");
    }
    const row = (await this.#connection.query<ConnectionRow>(
      `INSERT INTO connectors
         (id, guild_id, space_id, owner_identity_id, name, kind, status,
          capability_permissions, endpoint_url, secret_reference, visibility,
          classification, allowed_identity_ids, deployment_managed, description,
          provider, configuration, auth_kind, write_risk_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11,
               $12, $13::uuid[], $14, $15, $16, $17::jsonb, $18, $19)
       RETURNING id::text, guild_id::text, space_id::text, owner_identity_id::text,
                 name, kind, status, capability_permissions, endpoint_url, secret_reference,
                 visibility, classification, allowed_identity_ids::text[], deployment_managed,
                 version, description, provider, configuration, auth_kind, write_risk_level,
                 health_status, last_checked_at::text, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.spaceId, input.ownerIdentityId, input.name,
        input.kind, input.status ?? "active", input.capabilityPermissions,
        input.endpointUrl, input.secretReference, input.visibility, input.classification,
        allowedIdentityIds, input.deploymentManaged ?? false, input.description ?? "",
        input.provider ?? "custom", JSON.stringify(input.configuration ?? {}),
        input.authKind ?? "secret_reference", input.writeRiskLevel ?? 2,
      ],
    )).rows[0];
    if (!row) throw new Error("Connection could not be created.");
    return connectionFromRow(row);
  }

  async #insertWorkflow(input: WorkflowDefinitionDraft): Promise<WorkflowDefinition> {
    assertNonBlank(input.name, "Workflow name", 200);
    assertWorkflowGraph(input.nodes, input.edges);
    const supportedActions = new Set<AgentRunPlan["action"]["kind"]>([
      "memory_search", "activity_draft", "agent_delegate", "connection_invoke",
      "https_webhook", "federation_publish",
    ]);
    if (input.allowedActionKinds.length < 1 || input.allowedActionKinds.length > supportedActions.size ||
        new Set(input.allowedActionKinds).size !== input.allowedActionKinds.length ||
        input.allowedActionKinds.some((kind) => !supportedActions.has(kind))) {
      throw new Error("Workflow actions must contain unique supported Agent action kinds.");
    }
    if (input.capabilityPermissions.length < 1 || input.capabilityPermissions.length > 100 ||
        new Set(input.capabilityPermissions).size !== input.capabilityPermissions.length ||
        input.capabilityPermissions.some((permission) =>
          !(PERMISSIONS as readonly string[]).includes(permission))) {
      throw new Error("Workflow capabilities must contain unique known permissions.");
    }
    const allowedActorIds = input.allowedActorIds ?? [];
    if (allowedActorIds.length > 100 || new Set(allowedActorIds).size !== allowedActorIds.length) {
      throw new Error("Workflow access list must contain at most 100 unique Actors.");
    }
    const maxConcurrentRuns = input.maxConcurrentRuns ?? 1;
    if (!Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 100) {
      throw new Error("Workflow concurrency must be between 1 and 100.");
    }
    const row = (await this.#connection.query<WorkflowRow>(
      `INSERT INTO workflow_definitions
         (id, guild_id, space_id, owner_actor_id, name, description, status,
          nodes, edges, visibility, classification, allowed_actor_ids,
          allowed_action_kinds, capability_permissions, max_concurrent_runs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
               $10, $11, $12::uuid[], $13::text[], $14::text[], $15)
       RETURNING id::text, guild_id::text, space_id::text, owner_actor_id::text,
                 name, description, status, nodes, edges, visibility, classification,
                 allowed_actor_ids::text[], allowed_action_kinds, capability_permissions,
                 max_concurrent_runs, version,
                 created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.spaceId, input.ownerActorId, input.name,
        input.description ?? "", input.status ?? "draft", JSON.stringify(input.nodes),
        JSON.stringify(input.edges), input.visibility, input.classification,
        allowedActorIds, input.allowedActionKinds, input.capabilityPermissions, maxConcurrentRuns,
      ],
    )).rows[0];
    if (!row) throw new Error("Workflow definition could not be created.");
    return workflowFromRow(row);
  }

  async #insertAutomationRule(input: AutomationRuleDraft): Promise<AutomationRule> {
    assertAutomationTriggerKind(input.triggerKind);
    assertNonBlank(input.name, "Automation rule name", 200);
    assertNonBlank(input.triggerExpression, "Automation trigger", 500);
    if (input.triggerKind === "schedule") {
      assertScheduleExpression(input.triggerExpression);
      if (input.nextRunAt === null) throw new Error("A scheduled Automation rule requires a next run time.");
    }
    if (input.nextRunAt !== null) assertDate(input.nextRunAt, "Next Automation run");
    await this.#assertRunnableWorkflowAndAgent(input.workflowId, input.agentActorId);
    const row = (await this.#connection.query<AutomationRuleRow>(
      `INSERT INTO automation_rules
         (id, guild_id, workflow_id, agent_actor_id, created_by_actor_id,
          name, trigger_kind, trigger_expression, timezone, input_template, status, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       RETURNING id::text, guild_id::text, workflow_id::text, agent_actor_id::text,
                 created_by_actor_id::text, name, trigger_kind, trigger_expression, timezone,
                 input_template, status, next_run_at::text, last_run_at::text,
                 consecutive_failures, version, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.workflowId, input.agentActorId,
        input.createdByActorId, input.name, input.triggerKind, input.triggerExpression,
        input.timezone ?? "UTC", JSON.stringify(input.inputTemplate ?? {}),
        input.status ?? "paused", input.nextRunAt,
      ],
    )).rows[0];
    if (!row) throw new Error("Automation rule could not be created.");
    return automationRuleFromRow(row);
  }

  async #assertRunnableWorkflowAndAgent(workflowId: string, agentActorId: string): Promise<void> {
    const result = (await this.#connection.query<QueryResultRow & { allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM workflow_definitions workflow
           JOIN actor_memberships membership ON membership.guild_id = workflow.guild_id
           JOIN actors actor ON actor.id = membership.actor_id
          WHERE workflow.guild_id = $1 AND workflow.id = $2 AND workflow.status = 'active'
            AND membership.actor_id = $3 AND membership.state IN ('joined', 'active')
            AND membership.operational = true AND actor.kind = 'agent' AND actor.status = 'active'
       ) AS allowed`,
      [this.#guildId, workflowId, agentActorId],
    )).rows[0];
    if (!result?.allowed) {
      throw new Error("Automation requires an active Workflow and active operational Agent in this Guild.");
    }
  }

  async #federatedResourceExists(resourceType: FederationResourceType, resourceId: string): Promise<boolean> {
    const queryByType: Record<FederationResourceType, string> = {
      memory: "SELECT 1 FROM memories WHERE guild_id = $1 AND id = $2 AND status <> 'archived' LIMIT 1",
      activity: "SELECT 1 FROM activities WHERE guild_id = $1 AND id = $2 AND status <> 'archived' LIMIT 1",
      decision: "SELECT 1 FROM decisions WHERE guild_id = $1 AND id = $2 LIMIT 1",
      agent: `SELECT 1 FROM actor_memberships membership
               JOIN actors actor ON actor.id = membership.actor_id
              WHERE membership.guild_id = $1 AND membership.actor_id = $2
                AND actor.kind = 'agent' LIMIT 1`,
    };
    return (await this.#connection.query(queryByType[resourceType], [this.#guildId, resourceId])).rows[0] !== undefined;
  }

  async #insertFederationDelivery(input: {
    id: string;
    federationLinkId: string;
    direction: FederationDelivery["direction"];
    eventType: string;
    payload: JsonObject;
    idempotencyKey: string;
    availableAt: string;
    chronicleEvent: ChronicleEvent;
  }): Promise<IdempotentResult<FederationDelivery>> {
    const hash = payloadHash(input.payload);
    const inserted = (await this.#connection.query<FederationDeliveryRow>(
      `INSERT INTO federation_deliveries
         (id, guild_id, federation_link_id, direction, event_type, payload,
          payload_hash, idempotency_key, available_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING id::text, guild_id::text, federation_link_id::text, direction, event_type,
                 payload, payload_hash, idempotency_key, status, attempt_count,
                 available_at::text, completed_at::text, last_error, created_at::text`,
      [
        input.id, this.#guildId, input.federationLinkId, input.direction, input.eventType,
        JSON.stringify(input.payload), hash, input.idempotencyKey, input.availableAt,
      ],
    )).rows[0];
    if (inserted) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return { value: federationDeliveryFromRow(inserted), created: true };
    }
    const existing = (await this.#connection.query<FederationDeliveryRow & { input_matches: boolean }>(
      `SELECT id::text, guild_id::text, federation_link_id::text, direction, event_type,
              payload, payload_hash, idempotency_key, status, attempt_count,
              available_at::text, completed_at::text, last_error, created_at::text,
              federation_link_id = $3 AND direction = $4 AND event_type = $5
                AND payload_hash = $6 AS input_matches
         FROM federation_deliveries WHERE guild_id = $1 AND idempotency_key = $2`,
      [this.#guildId, input.idempotencyKey, input.federationLinkId, input.direction, input.eventType, hash],
    )).rows[0];
    if (!existing) throw new Error("Federation delivery idempotency conflict could not be resolved.");
    if (!existing.input_matches) {
      throw new Error("Federation delivery idempotency key was reused with different input.");
    }
    return { value: federationDeliveryFromRow(existing), created: false };
  }

  async #insertModelProvider(input: ModelProviderDraft): Promise<ModelProvider> {
    assertNonBlank(input.name, "Model provider name", 200);
    if (input.allowedModels.length < 1 || input.allowedModels.length > 100 ||
        new Set(input.allowedModels).size !== input.allowedModels.length) {
      throw new Error("Model provider must allow between 1 and 100 unique models.");
    }
    for (const model of input.allowedModels) assertNonBlank(model, "Allowed model", 200);
    if (input.kind === "workers_ai" && (input.endpointUrl !== null || input.secretReference !== null)) {
      throw new Error("Workers AI uses purchaser bindings and cannot store an endpoint or secret reference.");
    }
    if (input.kind === "cloudflare_ai_gateway" &&
        (input.endpointUrl === null || input.secretReference === null)) {
      throw new Error("Cloudflare AI Gateway requires an HTTPS endpoint and purchaser-owned secret reference.");
    }
    if (input.kind === "openai_compatible" &&
        (input.endpointUrl === null || input.secretReference === null)) {
      throw new Error("OpenAI-compatible providers require an HTTPS endpoint and secret reference.");
    }
    const row = (await this.#connection.query<ModelProviderRow>(
      `INSERT INTO model_providers
         (id, guild_id, name, kind, endpoint_url, secret_reference, allowed_models,
          status, deployment_managed, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10)
       RETURNING id::text, guild_id::text, name, kind, endpoint_url, secret_reference,
                 allowed_models, status, deployment_managed, created_by_actor_id::text,
                 version, created_at::text, updated_at::text`,
      [
        input.id, this.#guildId, input.name, input.kind, input.endpointUrl,
        input.secretReference, input.allowedModels, input.status ?? "active",
        input.deploymentManaged ?? false, input.createdByActorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Model provider could not be created.");
    return modelProviderFromRow(row);
  }

  async #validateModelRoute(
    providerId: string,
    primaryModel: string,
    fallbackModel: string | null,
  ): Promise<ModelProvider> {
    const provider = await this.getModelProvider(providerId, true);
    if (provider.status !== "active") throw new Error("Model routes require an active provider.");
    this.#assertModelsAllowed(provider.allowedModels, primaryModel, fallbackModel);
    return provider;
  }

  #assertModelsAllowed(
    allowedModels: readonly string[],
    primaryModel: string,
    fallbackModel: string | null,
  ): void {
    assertNonBlank(primaryModel, "Primary model", 200);
    if (!allowedModels.includes(primaryModel)) {
      throw new Error("Primary model is not allowed by the selected provider.");
    }
    if (fallbackModel !== null) {
      assertNonBlank(fallbackModel, "Fallback model", 200);
      if (!allowedModels.includes(fallbackModel)) {
        throw new Error("Fallback model is not allowed by the selected provider.");
      }
    }
  }

  #assertEvent(event: ChronicleEvent, actorId: string, subjectType: string, subjectId: string): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorId ||
        event.subjectType !== subjectType || event.subjectId !== subjectId) {
      throw new Error("Chronicle event does not match the active Guild mutation.");
    }
  }

  #assertCurrentVersion(actual: number, expected: number, label: string): void {
    if (actual !== expected) throw new Error(`${label} changed. Reload before continuing.`);
  }

  #automaticEvent(
    actorId: string,
    action: string,
    subjectType: string,
    subjectId: string,
    details: ChronicleEvent["details"],
  ): ChronicleEvent {
    return {
      id: randomUUID(),
      guildId: this.#guildId,
      spaceId: null,
      ownerIdentityId: actorId,
      visibility: "guild",
      classification: "restricted",
      allowedIdentityIds: [],
      actorIdentityId: actorId,
      action,
      subjectType,
      subjectId,
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
      details,
    };
  }
}
