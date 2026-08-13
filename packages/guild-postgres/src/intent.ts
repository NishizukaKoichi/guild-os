import {
  PERMISSIONS,
  type AppLocale,
  type ChronicleEvent,
  type JsonObject,
  type JsonValue,
  type Permission,
  type RiskLevel,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUPPORTED_LOCALES = new Set<AppLocale>(["en", "ja", "zh-CN"]);
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_ACTION_COUNT = 20;
const MAX_ACTION_ATTEMPTS = 20;
const MAX_OBJECTIVE_LENGTH = 5_000;
const MAX_ERROR_LENGTH = 2_000;
const MAX_JSON_DEPTH = 20;
const MAX_ACTION_JSON_BYTES = 64 * 1024;
const MAX_SNAPSHOT_JSON_BYTES = 128 * 1024;
const MAX_EVIDENCE_JSON_BYTES = 128 * 1024;
const MAX_EVIDENCE_COUNT = 100;
const MAX_LEASE_SECONDS = 15 * 60;
const MAX_EXPIRY_DAYS = 30;

export type IntentProposalStatus =
  | "ready"
  | "executing"
  | "completed"
  | "rejected"
  | "failed"
  | "expired";

export type IntentActionStatus =
  | "pending"
  | "processing"
  | "staged"
  | "succeeded"
  | "failed"
  | "cancelled";

export type IntentActionKind =
  | "memory.propose"
  | "activity.create"
  | "activity.assign"
  | "decision.propose"
  | "agent.run";

export type IntentResourceType = "memory" | "activity" | "decision" | "agent_run";

export interface IntentEvidence {
  sourceType: string;
  sourceId: string;
  label: string;
  metadata: JsonObject;
}

export interface IntentAuthorizationSnapshot {
  actorId: string;
  permissions: readonly Permission[];
  spaceIds: readonly string[];
  constitutionVersion: number;
  capturedAt: string;
}

export interface MemoryProposeIntent {
  memoryId: string;
  spaceId: string | null;
  request: JsonObject;
}

export interface ActivityCreateIntent {
  activityId: string;
  spaceId: string | null;
  request: JsonObject;
}

export interface ActivityAssignIntent {
  activityId: string;
  assigneeActorId: string | null;
  expectedVersion: number;
}

export interface DecisionProposeIntent {
  decisionId: string;
  spaceId: string | null;
  request: JsonObject;
}

export interface AgentRunIntent {
  agentRunId: string;
  agentActorId: string;
  spaceId: string | null;
  request: JsonObject;
}

export type IntentActionInput =
  | { kind: "memory.propose"; riskLevel: RiskLevel; action: MemoryProposeIntent }
  | { kind: "activity.create"; riskLevel: RiskLevel; action: ActivityCreateIntent }
  | { kind: "activity.assign"; riskLevel: RiskLevel; action: ActivityAssignIntent }
  | { kind: "decision.propose"; riskLevel: RiskLevel; action: DecisionProposeIntent }
  | { kind: "agent.run"; riskLevel: RiskLevel; action: AgentRunIntent };

interface StoredIntentActionBase {
  guildId: string;
  proposalId: string;
  position: number;
  riskLevel: RiskLevel;
  status: IntentActionStatus;
  attemptCount: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  resourceType: IntentResourceType | null;
  resourceId: string | null;
  agentRunId: string | null;
  result: JsonObject | null;
  errorSummary: string | null;
  version: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StoredIntentAction =
  | (StoredIntentActionBase & { kind: "memory.propose"; action: MemoryProposeIntent })
  | (StoredIntentActionBase & { kind: "activity.create"; action: ActivityCreateIntent })
  | (StoredIntentActionBase & { kind: "activity.assign"; action: ActivityAssignIntent })
  | (StoredIntentActionBase & { kind: "decision.propose"; action: DecisionProposeIntent })
  | (StoredIntentActionBase & { kind: "agent.run"; action: AgentRunIntent });

export interface IntentProposalSummary {
  id: string;
  guildId: string;
  spaceId: string | null;
  createdByActorId: string;
  locale: AppLocale;
  objective: string;
  status: IntentProposalStatus;
  actionCount: number;
  evidence: readonly IntentEvidence[];
  maximumRiskLevel: RiskLevel;
  authorizationSnapshot: IntentAuthorizationSnapshot;
  requestHash: string;
  expiresAt: string;
  completedAt: string | null;
  errorSummary: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntentProposalDetail extends IntentProposalSummary {
  actions: readonly StoredIntentAction[];
}

export interface IntentProposalCursor {
  createdAt: string;
  id: string;
}

export interface IntentProposalPage {
  items: readonly IntentProposalSummary[];
  nextCursor: IntentProposalCursor | null;
}

export type IntentProposalAccess =
  | { actorId: string; scope?: "creator" }
  | { actorId: string; scope: "guild"; assertedPermission: "guild.manage" };

export interface CreateIntentProposalInput {
  id: string;
  createdByActorId: string;
  spaceId: string | null;
  locale: AppLocale;
  objective: string;
  evidence: readonly IntentEvidence[];
  authorizationSnapshot: IntentAuthorizationSnapshot;
  requestHash: string;
  expiresAt: string;
  actions: readonly IntentActionInput[];
  chronicleEvent: ChronicleEvent;
}

export interface CreateIntentProposalResult {
  created: boolean;
  proposal: IntentProposalDetail;
}

export interface ClaimIntentActionInput {
  access: IntentProposalAccess;
  proposalId: string;
  leaseToken: string;
  leaseSeconds: number;
  chronicleEvent: ChronicleEvent;
}

export type ClaimIntentActionResult =
  | { state: "claimed"; proposal: IntentProposalSummary; action: StoredIntentAction }
  | { state: "expired"; proposal: IntentProposalDetail }
  | { state: "empty"; proposal: IntentProposalSummary };

interface LeasedIntentActionInput {
  access: IntentProposalAccess;
  proposalId: string;
  position: number;
  leaseToken: string;
  chronicleEvent: ChronicleEvent;
}

export interface RequeueIntentActionInput extends LeasedIntentActionInput {
  errorSummary: string;
}

export interface CompleteIntentActionInput extends LeasedIntentActionInput {
  resourceType: IntentResourceType | null;
  resourceId: string | null;
  result: JsonObject;
}

export interface FailIntentActionInput extends LeasedIntentActionInput {
  errorSummary: string;
}

export interface StageAgentIntentActionInput extends LeasedIntentActionInput {
  agentRunId: string;
}

export interface ReconcileAgentIntentActionInput {
  access: IntentProposalAccess;
  proposalId: string;
  position: number;
  chronicleEvent: ChronicleEvent;
}

export type ReconcileAgentIntentActionResult =
  | { state: "pending"; proposal: IntentProposalSummary; action: StoredIntentAction }
  | { state: "succeeded"; proposal: IntentProposalSummary; action: StoredIntentAction }
  | { state: "failed"; proposal: IntentProposalSummary; action: StoredIntentAction };

export interface RejectIntentProposalInput {
  access: IntentProposalAccess;
  proposalId: string;
  reason: string;
  chronicleEvent: ChronicleEvent;
}

type ProposalRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  created_by_actor_id: string;
  locale: string;
  objective: string;
  status: IntentProposalStatus;
  action_count: number;
  evidence: unknown;
  maximum_risk_level: number;
  authorization_snapshot: unknown;
  request_hash: string;
  expires_at: string;
  completed_at: string | null;
  error_summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type ActionRow = QueryResultRow & {
  guild_id: string;
  proposal_id: string;
  position: number;
  kind: string;
  action: unknown;
  risk_level: number;
  status: IntentActionStatus;
  attempt_count: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  resource_type: string | null;
  resource_id: string | null;
  agent_run_id: string | null;
  result: unknown;
  error_summary: string | null;
  version: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type AccessRow = QueryResultRow & {
  active: boolean;
  can_manage_all: boolean;
};

type AgentRunStateRow = QueryResultRow & {
  id: string;
  agent_identity_id: string;
  requester_identity_id: string;
  space_id: string | null;
  status: "planning" | "awaiting_approval" | "running" | "succeeded" | "failed" | "killed";
  result: unknown;
  error_message: string | null;
};

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertBoundedText(value: string, label: string, maximum: number): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  }
}

function assertRiskLevel(value: number, label: string): asserts value is RiskLevel {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new Error(`${label} must be an integer between 0 and 3.`);
  }
}

function assertPositiveVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`${label} must be a positive 32-bit integer.`);
  }
}

function isoTimestamp(value: string, label: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) throw new Error(`${label} must be a valid timestamp.`);
  return timestamp.toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : isoTimestamp(value, label);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function assertJsonValue(
  value: unknown,
  label: string,
  depth = 0,
  ancestors: ReadonlySet<object> = new Set<object>(),
): asserts value is JsonValue {
  if (depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${label} must contain JSON values only.`);
  if (ancestors.has(value)) throw new Error(`${label} cannot contain a cycle.`);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error(`${label} contains too many array entries.`);
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, depth + 1, nextAncestors));
    return;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain JSON object.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 1_000) throw new Error(`${label} contains too many object fields.`);
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > 200) throw new Error(`${label} contains an invalid field name.`);
    assertJsonValue(entry, `${label}.${key}`, depth + 1, nextAncestors);
  }
}

function assertJsonObject(value: unknown, label: string, maximumBytes: number): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  assertJsonValue(value, label);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximumBytes) {
    throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
  }
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordFromUnknown(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nullableUuidFrom(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a UUID or null.`);
  assertUuid(value, label);
  return value;
}

function stringFrom(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  assertBoundedText(value, label, maximum);
  return value;
}

function jsonObjectFrom(value: unknown, label: string, maximumBytes: number): JsonObject {
  assertJsonObject(value, label, maximumBytes);
  return value;
}

function evidenceFrom(value: unknown): IntentEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_COUNT) {
    throw new Error(`Plan evidence must be an array with at most ${MAX_EVIDENCE_COUNT} entries.`);
  }
  assertJsonValue(value, "Plan evidence");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_EVIDENCE_JSON_BYTES) {
    throw new Error("Plan evidence exceeds its storage limit.");
  }
  return value.map((entry, index) => {
    const record = recordFromUnknown(entry, `Plan evidence ${index}`);
    assertExactKeys(record, ["sourceType", "sourceId", "label", "metadata"], `Plan evidence ${index}`);
    return {
      sourceType: stringFrom(record.sourceType, `Plan evidence ${index} source type`, 100),
      sourceId: stringFrom(record.sourceId, `Plan evidence ${index} source ID`, 2_000),
      label: stringFrom(record.label, `Plan evidence ${index} label`, 500),
      metadata: jsonObjectFrom(record.metadata, `Plan evidence ${index} metadata`, 16 * 1024),
    };
  });
}

function authorizationSnapshotFrom(value: unknown): IntentAuthorizationSnapshot {
  assertJsonObject(value, "Plan authorization snapshot", MAX_SNAPSHOT_JSON_BYTES);
  const record = value as Record<string, unknown>;
  assertExactKeys(
    record,
    ["actorId", "permissions", "spaceIds", "constitutionVersion", "capturedAt"],
    "Plan authorization snapshot",
  );
  const actorId = stringFrom(record.actorId, "Authorization actor ID");
  assertUuid(actorId, "Authorization actor ID");
  if (!Array.isArray(record.permissions) || record.permissions.length > PERMISSIONS.length ||
      !record.permissions.every((permission) => typeof permission === "string" && KNOWN_PERMISSIONS.has(permission)) ||
      new Set(record.permissions).size !== record.permissions.length) {
    throw new Error("Authorization permissions must be unique known permissions.");
  }
  if (!Array.isArray(record.spaceIds) || record.spaceIds.length > 100 ||
      !record.spaceIds.every((spaceId) => typeof spaceId === "string" && UUID_PATTERN.test(spaceId)) ||
      new Set(record.spaceIds).size !== record.spaceIds.length) {
    throw new Error("Authorization Spaces must be at most 100 unique UUIDs.");
  }
  if (!Number.isSafeInteger(record.constitutionVersion) ||
      (record.constitutionVersion as number) < 1 ||
      (record.constitutionVersion as number) > 2_147_483_647) {
    throw new Error("Authorization Constitution version must be a positive 32-bit integer.");
  }
  return {
    actorId,
    permissions: record.permissions as Permission[],
    spaceIds: record.spaceIds as string[],
    constitutionVersion: record.constitutionVersion as number,
    capturedAt: isoTimestamp(stringFrom(record.capturedAt, "Authorization capture time"), "Authorization capture time"),
  };
}

function actionPayloadFrom(kind: IntentActionKind, value: unknown): IntentActionInput["action"] {
  const record = recordFromUnknown(value, `${kind} action`);
  switch (kind) {
    case "memory.propose": {
      assertExactKeys(record, ["memoryId", "spaceId", "request"], kind);
      const memoryId = stringFrom(record.memoryId, "Memory ID");
      assertUuid(memoryId, "Memory ID");
      return {
        memoryId,
        spaceId: nullableUuidFrom(record.spaceId, "Memory Space ID"),
        request: jsonObjectFrom(record.request, "Memory proposal request", MAX_ACTION_JSON_BYTES),
      };
    }
    case "activity.create": {
      assertExactKeys(record, ["activityId", "spaceId", "request"], kind);
      const activityId = stringFrom(record.activityId, "Activity ID");
      assertUuid(activityId, "Activity ID");
      return {
        activityId,
        spaceId: nullableUuidFrom(record.spaceId, "Activity Space ID"),
        request: jsonObjectFrom(record.request, "Activity creation request", MAX_ACTION_JSON_BYTES),
      };
    }
    case "activity.assign": {
      assertExactKeys(record, ["activityId", "assigneeActorId", "expectedVersion"], kind);
      const activityId = stringFrom(record.activityId, "Activity ID");
      assertUuid(activityId, "Activity ID");
      if (typeof record.expectedVersion !== "number") {
        throw new Error("Activity expected version must be a number.");
      }
      assertPositiveVersion(record.expectedVersion, "Activity expected version");
      return {
        activityId,
        assigneeActorId: nullableUuidFrom(record.assigneeActorId, "Activity assignee Actor ID"),
        expectedVersion: record.expectedVersion,
      };
    }
    case "decision.propose": {
      assertExactKeys(record, ["decisionId", "spaceId", "request"], kind);
      const decisionId = stringFrom(record.decisionId, "Decision ID");
      assertUuid(decisionId, "Decision ID");
      return {
        decisionId,
        spaceId: nullableUuidFrom(record.spaceId, "Decision Space ID"),
        request: jsonObjectFrom(record.request, "Decision proposal request", MAX_ACTION_JSON_BYTES),
      };
    }
    case "agent.run": {
      assertExactKeys(record, ["agentRunId", "agentActorId", "spaceId", "request"], kind);
      const agentRunId = stringFrom(record.agentRunId, "Agent run ID");
      const agentActorId = stringFrom(record.agentActorId, "Agent Actor ID");
      assertUuid(agentRunId, "Agent run ID");
      assertUuid(agentActorId, "Agent Actor ID");
      return {
        agentRunId,
        agentActorId,
        spaceId: nullableUuidFrom(record.spaceId, "Agent run Space ID"),
        request: jsonObjectFrom(record.request, "Agent run request", MAX_ACTION_JSON_BYTES),
      };
    }
  }
}

function assertActionInput(input: IntentActionInput, index: number): void {
  if (!["memory.propose", "activity.create", "activity.assign", "decision.propose", "agent.run"].includes(input.kind)) {
    throw new Error(`Plan action ${index} has an unsupported kind.`);
  }
  assertRiskLevel(input.riskLevel, `Plan action ${index} risk level`);
  const parsed = actionPayloadFrom(input.kind, input.action);
  if (canonicalJson(parsed as unknown as JsonValue) !== canonicalJson(input.action as unknown as JsonValue)) {
    throw new Error(`Plan action ${index} contains non-canonical content.`);
  }
}

function assertResource(resourceType: IntentResourceType | null, resourceId: string | null): void {
  if ((resourceType === null) !== (resourceId === null)) {
    throw new Error("Action resource type and ID must both be present or both be null.");
  }
  if (resourceType !== null && !["memory", "activity", "decision", "agent_run"].includes(resourceType)) {
    throw new Error("Action resource type is not supported.");
  }
  if (resourceId !== null) assertUuid(resourceId, "Action resource ID");
}

function summaryFromRow(row: ProposalRow): IntentProposalSummary {
  if (!SUPPORTED_LOCALES.has(row.locale as AppLocale)) throw new Error("Database contains an invalid Plan locale.");
  assertRiskLevel(row.maximum_risk_level, "Database Plan maximum risk level");
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    createdByActorId: row.created_by_actor_id,
    locale: row.locale as AppLocale,
    objective: row.objective,
    status: row.status,
    actionCount: row.action_count,
    evidence: evidenceFrom(row.evidence),
    maximumRiskLevel: row.maximum_risk_level,
    authorizationSnapshot: authorizationSnapshotFrom(row.authorization_snapshot),
    requestHash: row.request_hash,
    expiresAt: isoTimestamp(row.expires_at, "Database Plan expiry"),
    completedAt: optionalTimestamp(row.completed_at, "Database Plan completion time"),
    errorSummary: row.error_summary,
    version: row.version,
    createdAt: isoTimestamp(row.created_at, "Database Plan creation time"),
    updatedAt: isoTimestamp(row.updated_at, "Database Plan update time"),
  };
}

function actionFromRow(row: ActionRow): StoredIntentAction {
  if (!["memory.propose", "activity.create", "activity.assign", "decision.propose", "agent.run"].includes(row.kind)) {
    throw new Error("Database contains an unknown Plan action kind.");
  }
  assertRiskLevel(row.risk_level, "Database Plan action risk level");
  if (row.resource_type !== null && !["memory", "activity", "decision", "agent_run"].includes(row.resource_type)) {
    throw new Error("Database contains an unknown Plan resource type.");
  }
  const result = row.result === null
    ? null
    : jsonObjectFrom(row.result, "Database Plan action result", MAX_ACTION_JSON_BYTES);
  const common: StoredIntentActionBase = {
    guildId: row.guild_id,
    proposalId: row.proposal_id,
    position: row.position,
    riskLevel: row.risk_level,
    status: row.status,
    attemptCount: row.attempt_count,
    leaseToken: row.lease_token,
    leaseExpiresAt: optionalTimestamp(row.lease_expires_at, "Database Plan action lease expiry"),
    resourceType: row.resource_type as IntentResourceType | null,
    resourceId: row.resource_id,
    agentRunId: row.agent_run_id,
    result,
    errorSummary: row.error_summary,
    version: row.version,
    startedAt: optionalTimestamp(row.started_at, "Database Plan action start time"),
    finishedAt: optionalTimestamp(row.finished_at, "Database Plan action finish time"),
    createdAt: isoTimestamp(row.created_at, "Database Plan action creation time"),
    updatedAt: isoTimestamp(row.updated_at, "Database Plan action update time"),
  };
  const kind = row.kind as IntentActionKind;
  const action = actionPayloadFrom(kind, row.action);
  switch (kind) {
    case "memory.propose": return { ...common, kind, action: action as MemoryProposeIntent };
    case "activity.create": return { ...common, kind, action: action as ActivityCreateIntent };
    case "activity.assign": return { ...common, kind, action: action as ActivityAssignIntent };
    case "decision.propose": return { ...common, kind, action: action as DecisionProposeIntent };
    case "agent.run": return { ...common, kind, action: action as AgentRunIntent };
  }
}

function proposalRowsSelect(alias = "proposal"): string {
  return `SELECT ${alias}.id::text, ${alias}.guild_id::text, ${alias}.space_id::text,
                 ${alias}.created_by_actor_id::text, ${alias}.locale, ${alias}.objective,
                 ${alias}.status, ${alias}.action_count, ${alias}.evidence,
                 ${alias}.maximum_risk_level, ${alias}.authorization_snapshot,
                 ${alias}.request_hash, ${alias}.expires_at::text,
                 ${alias}.completed_at::text, ${alias}.error_summary, ${alias}.version,
                 ${alias}.created_at::text, ${alias}.updated_at::text
            FROM intent_proposals ${alias}`;
}

function actionRowsSelect(alias = "action_row"): string {
  return `SELECT ${alias}.guild_id::text, ${alias}.proposal_id::text, ${alias}.position,
                 ${alias}.kind, ${alias}.action, ${alias}.risk_level, ${alias}.status,
                 ${alias}.attempt_count, ${alias}.lease_token::text,
                 ${alias}.lease_expires_at::text, ${alias}.resource_type,
                 ${alias}.resource_id::text, ${alias}.agent_run_id::text, ${alias}.result,
                 ${alias}.error_summary, ${alias}.version, ${alias}.started_at::text,
                 ${alias}.finished_at::text, ${alias}.created_at::text, ${alias}.updated_at::text
            FROM intent_proposal_actions ${alias}`;
}

export class GuildIntentRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    assertUuid(guildId, "Guild ID");
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async createProposal(input: CreateIntentProposalInput): Promise<CreateIntentProposalResult> {
    this.#assertCreateInput(input);
    await this.#assertActorAccess({ actorId: input.createdByActorId });
    await this.#connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `intent-proposal:${this.#guildId}:${input.createdByActorId}:${input.requestHash}`,
    ]);
    const existingByRequest = (await this.#connection.query<ProposalRow>(
      `${proposalRowsSelect()} WHERE proposal.guild_id = $1
        AND proposal.created_by_actor_id = $2 AND proposal.request_hash = $3
        FOR UPDATE OF proposal`,
      [this.#guildId, input.createdByActorId, input.requestHash],
    )).rows[0];
    if (existingByRequest) {
      const existing = await this.#detailFromRow(existingByRequest);
      if (!this.#matchesCreateInput(existing, input)) {
        throw new Error("Plan request hash was already used for different immutable content.");
      }
      return { created: false, proposal: existing };
    }
    const existingById = (await this.#connection.query<{ id: string }>(
      "SELECT id::text FROM intent_proposals WHERE guild_id = $1 AND id = $2 FOR UPDATE",
      [this.#guildId, input.id],
    )).rows[0];
    if (existingById) throw new Error("Plan proposal ID was already used by another request.");

    const maximumRiskLevel = Math.max(...input.actions.map((action) => action.riskLevel)) as RiskLevel;
    await this.#connection.query(
      `INSERT INTO intent_proposals
         (id, guild_id, space_id, created_by_actor_id, locale, objective, status,
          action_count, evidence, maximum_risk_level, authorization_snapshot,
          request_hash, expires_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $8::jsonb, $9, $10::jsonb, $11, $12, 1)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.createdByActorId,
        input.locale,
        input.objective,
        input.actions.length,
        JSON.stringify(input.evidence),
        maximumRiskLevel,
        JSON.stringify(input.authorizationSnapshot),
        input.requestHash,
        isoTimestamp(input.expiresAt, "Plan expiry"),
      ],
    );
    for (const [position, action] of input.actions.entries()) {
      await this.#connection.query(
        `INSERT INTO intent_proposal_actions
           (guild_id, proposal_id, position, kind, action, risk_level, status,
            attempt_count, version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending', 0, 1)`,
        [this.#guildId, input.id, position, action.kind, JSON.stringify(action.action), action.riskLevel],
      );
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { created: true, proposal: await this.#getDetailUnscoped(input.id) };
  }

  async listProposals(
    access: IntentProposalAccess,
    cursor: IntentProposalCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<IntentProposalPage> {
    const canManage = await this.#assertActorAccess(access);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Plan page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (cursor) {
      assertUuid(cursor.id, "Plan cursor ID");
      isoTimestamp(cursor.createdAt, "Plan cursor time");
    }
    const rows = (await this.#connection.query<ProposalRow>(
      `${proposalRowsSelect()}
       WHERE proposal.guild_id = $1 AND ($3::boolean OR proposal.created_by_actor_id = $2)
         AND ($4::timestamptz IS NULL
           OR (proposal.created_at, proposal.id) < ($4::timestamptz, $5::uuid))
       ORDER BY proposal.created_at DESC, proposal.id DESC LIMIT $6`,
      [
        this.#guildId,
        access.actorId,
        canManage,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(summaryFromRow),
      nextCursor: rows.length > pageSize && last
        ? { createdAt: isoTimestamp(last.created_at, "Plan cursor time"), id: last.id }
        : null,
    };
  }

  async getProposal(proposalId: string, access: IntentProposalAccess): Promise<IntentProposalDetail> {
    assertUuid(proposalId, "Plan proposal ID");
    const canManage = await this.#assertActorAccess(access);
    const row = await this.#getAuthorizedProposalRow(proposalId, access.actorId, canManage, false);
    return this.#detailFromRow(row);
  }

  async claimNextAction(input: ClaimIntentActionInput): Promise<ClaimIntentActionResult> {
    assertUuid(input.proposalId, "Plan proposal ID");
    assertUuid(input.leaseToken, "Plan action lease token");
    if (!Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 1 ||
        input.leaseSeconds > MAX_LEASE_SECONDS) {
      throw new Error(`Plan action lease must be between 1 and ${MAX_LEASE_SECONDS} seconds.`);
    }
    const canManage = await this.#assertActorAccess(input.access);
    let proposal = summaryFromRow(await this.#getAuthorizedProposalRow(
      input.proposalId,
      input.access.actorId,
      canManage,
      false,
    ));
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    if (["completed", "rejected", "failed", "expired"].includes(proposal.status)) {
      return { state: "empty", proposal };
    }
    if (new Date(proposal.expiresAt).valueOf() <= Date.now()) {
      if (await this.#expireProposal(proposal.id, input.chronicleEvent)) {
        return { state: "expired", proposal: await this.#getDetailUnscoped(proposal.id) };
      }
    }
    const row = (await this.#connection.query<ActionRow>(
      `WITH candidate AS (
         SELECT action_row.guild_id, action_row.proposal_id, action_row.position
           FROM intent_proposal_actions action_row
           JOIN intent_proposals proposal
             ON proposal.guild_id = action_row.guild_id
            AND proposal.id = action_row.proposal_id
          WHERE action_row.guild_id = $1 AND action_row.proposal_id = $2
            AND proposal.status IN ('ready', 'executing') AND proposal.expires_at > now()
            AND action_row.attempt_count < ${MAX_ACTION_ATTEMPTS}
            AND (action_row.status = 'pending'
              OR action_row.status = 'processing' AND action_row.lease_expires_at <= now())
            AND NOT EXISTS (
              SELECT 1 FROM intent_proposal_actions prior
               WHERE prior.guild_id = action_row.guild_id
                 AND prior.proposal_id = action_row.proposal_id
                 AND prior.position < action_row.position
                 AND prior.status <> 'succeeded'
            )
          ORDER BY action_row.position
          FOR UPDATE OF action_row SKIP LOCKED LIMIT 1
       )
       UPDATE intent_proposal_actions target
          SET status = 'processing', attempt_count = target.attempt_count + 1,
              lease_token = $3, lease_expires_at = now() + make_interval(secs => $4),
              started_at = COALESCE(target.started_at, now()), error_summary = NULL,
              version = target.version + 1, updated_at = now()
         FROM candidate
        WHERE target.guild_id = candidate.guild_id
          AND target.proposal_id = candidate.proposal_id
          AND target.position = candidate.position
       RETURNING target.guild_id::text, target.proposal_id::text, target.position,
                 target.kind, target.action, target.risk_level, target.status,
                 target.attempt_count, target.lease_token::text,
                 target.lease_expires_at::text, target.resource_type,
                 target.resource_id::text, target.agent_run_id::text, target.result,
                 target.error_summary, target.version, target.started_at::text,
                 target.finished_at::text, target.created_at::text, target.updated_at::text`,
      [this.#guildId, input.proposalId, input.leaseToken, input.leaseSeconds],
    )).rows[0];
    if (!row) {
      if (await this.#expireProposal(proposal.id, input.chronicleEvent)) {
        return { state: "expired", proposal: await this.#getDetailUnscoped(proposal.id) };
      }
      return { state: "empty", proposal };
    }
    await this.#connection.query(
      `UPDATE intent_proposals
          SET status = 'executing', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status = 'ready'`,
      [this.#guildId, input.proposalId],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    proposal = summaryFromRow(await this.#getProposalRowUnscoped(input.proposalId));
    return { state: "claimed", proposal, action: actionFromRow(row) };
  }

  async requeueAction(input: RequeueIntentActionInput): Promise<StoredIntentAction> {
    assertBoundedText(input.errorSummary, "Plan action retry reason", MAX_ERROR_LENGTH);
    const { proposal, action } = await this.#getLeasedAction(input);
    const exhausted = action.attemptCount >= MAX_ACTION_ATTEMPTS;
    const row = (await this.#connection.query<ActionRow>(
      `${this.#updateActionReturning()}
          SET status = CASE WHEN $6::boolean THEN 'failed' ELSE 'pending' END,
              lease_token = NULL, lease_expires_at = NULL, error_summary = $5,
              finished_at = CASE WHEN $6::boolean THEN now() ELSE NULL END,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2 AND position = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${this.#actionReturningColumns()}`,
      [
        this.#guildId,
        input.proposalId,
        input.position,
        input.leaseToken,
        exhausted ? `Retry limit reached: ${input.errorSummary}`.slice(0, MAX_ERROR_LENGTH) : input.errorSummary,
        exhausted,
      ],
    )).rows[0];
    if (!row) throw new Error("Plan action lease is no longer owned by this worker.");
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    if (exhausted) {
      await this.#cancelOpenActions(input.proposalId);
      await this.#refreshAggregate(input.proposalId);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return actionFromRow({ ...row, action: action.action, kind: action.kind });
  }

  async succeedAction(input: CompleteIntentActionInput): Promise<IntentProposalDetail> {
    assertResource(input.resourceType, input.resourceId);
    assertJsonObject(input.result, "Plan action result", MAX_ACTION_JSON_BYTES);
    const { proposal, action } = await this.#getLeasedAction(input);
    if (action.kind === "agent.run") {
      throw new Error("Agent actions must be staged and reconciled with their durable Agent run.");
    }
    const updated = await this.#connection.query(
      `UPDATE intent_proposal_actions
          SET status = 'succeeded', lease_token = NULL, lease_expires_at = NULL,
              resource_type = $5, resource_id = $6, result = $7::jsonb,
              error_summary = NULL, finished_at = now(), version = version + 1,
              updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2 AND position = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > now()`,
      [
        this.#guildId,
        input.proposalId,
        input.position,
        input.leaseToken,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.result),
      ],
    );
    if (updated.rowCount !== 1) throw new Error("Plan action lease is no longer owned by this worker.");
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    await this.#refreshAggregate(input.proposalId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return this.#getDetailUnscoped(input.proposalId);
  }

  async failAction(input: FailIntentActionInput): Promise<IntentProposalDetail> {
    assertBoundedText(input.errorSummary, "Plan action failure", MAX_ERROR_LENGTH);
    const { proposal } = await this.#getLeasedAction(input);
    const updated = await this.#connection.query(
      `UPDATE intent_proposal_actions
          SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
              error_summary = $5, finished_at = now(), version = version + 1,
              updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2 AND position = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > now()`,
      [this.#guildId, input.proposalId, input.position, input.leaseToken, input.errorSummary],
    );
    if (updated.rowCount !== 1) throw new Error("Plan action lease is no longer owned by this worker.");
    await this.#cancelOpenActions(input.proposalId);
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    await this.#refreshAggregate(input.proposalId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return this.#getDetailUnscoped(input.proposalId);
  }

  async stageAgentAction(input: StageAgentIntentActionInput): Promise<StoredIntentAction> {
    assertUuid(input.agentRunId, "Agent run ID");
    const { proposal, action } = await this.#getLeasedAction(input);
    if (action.kind !== "agent.run" || action.action.agentRunId !== input.agentRunId) {
      throw new Error("Only the immutable Agent run named by this Plan action can be staged.");
    }
    await this.#connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `intent-agent-run:${this.#guildId}:${input.agentRunId}`,
    ]);
    const existingLink = (await this.#connection.query<{
      proposal_id: string;
      position: number;
    }>(
      `SELECT proposal_id::text, position FROM intent_proposal_actions
        WHERE guild_id = $1 AND agent_run_id = $2
          AND NOT (proposal_id = $3 AND position = $4)
        LIMIT 1`,
      [this.#guildId, input.agentRunId, input.proposalId, input.position],
    )).rows[0];
    if (existingLink) throw new Error("Agent run is already linked to another Plan action.");
    const run = (await this.#connection.query<AgentRunStateRow>(
      `SELECT id::text, agent_identity_id::text, requester_identity_id::text,
              space_id::text, status, result, error_message
         FROM agent_runs WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [this.#guildId, input.agentRunId],
    )).rows[0];
    if (!run || run.agent_identity_id !== action.action.agentActorId ||
        run.requester_identity_id !== proposal.createdByActorId ||
        run.space_id !== action.action.spaceId) {
      throw new Error("Agent run crosses the immutable Plan actor, Agent, or Space boundary.");
    }
    const row = (await this.#connection.query<ActionRow>(
      `UPDATE intent_proposal_actions
          SET status = 'staged', lease_token = NULL, lease_expires_at = NULL,
              resource_type = 'agent_run', resource_id = $5, agent_run_id = $5,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2 AND position = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${this.#actionReturningColumns()}`,
      [this.#guildId, input.proposalId, input.position, input.leaseToken, input.agentRunId],
    )).rows[0];
    if (!row) throw new Error("Plan action lease is no longer owned by this worker.");
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return actionFromRow(row);
  }

  async reconcileStagedAgentRun(
    input: ReconcileAgentIntentActionInput,
  ): Promise<ReconcileAgentIntentActionResult> {
    assertUuid(input.proposalId, "Plan proposal ID");
    if (!Number.isSafeInteger(input.position) || input.position < 0 || input.position >= MAX_ACTION_COUNT) {
      throw new Error("Plan action position is outside the supported range.");
    }
    const canManage = await this.#assertActorAccess(input.access);
    const proposal = summaryFromRow(await this.#getAuthorizedProposalRow(
      input.proposalId,
      input.access.actorId,
      canManage,
      false,
    ));
    const actionRow = (await this.#connection.query<ActionRow>(
      `${actionRowsSelect()} WHERE action_row.guild_id = $1
        AND action_row.proposal_id = $2 AND action_row.position = $3
        FOR UPDATE OF action_row`,
      [this.#guildId, input.proposalId, input.position],
    )).rows[0];
    if (!actionRow) throw new Error("Plan action was not found.");
    let action = actionFromRow(actionRow);
    if (action.kind !== "agent.run" || action.agentRunId === null) {
      throw new Error("Plan action is not linked to a durable Agent run.");
    }
    if (["succeeded", "failed"].includes(action.status)) {
      return {
        state: action.status === "succeeded" ? "succeeded" : "failed",
        proposal,
        action,
      };
    }
    if (action.status !== "staged") throw new Error("Agent Plan action is not staged.");
    const run = (await this.#connection.query<AgentRunStateRow>(
      `SELECT id::text, agent_identity_id::text, requester_identity_id::text,
              space_id::text, status, result, error_message
         FROM agent_runs WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [this.#guildId, action.agentRunId],
    )).rows[0];
    if (!run) throw new Error("Staged Agent run was not found in this Guild.");
    if (!["succeeded", "failed", "killed"].includes(run.status)) {
      return { state: "pending", proposal, action };
    }
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    if (run.status === "succeeded") {
      const result: JsonObject = { agentRunId: run.id, runStatus: "succeeded" };
      if (run.result !== null) {
        assertJsonObject(run.result, "Agent run result", MAX_ACTION_JSON_BYTES);
        result.output = run.result;
      }
      assertJsonObject(result, "Reconciled Agent action result", MAX_ACTION_JSON_BYTES);
      const updated = (await this.#connection.query<ActionRow>(
        `UPDATE intent_proposal_actions
            SET status = 'succeeded', result = $4::jsonb, error_summary = NULL,
                finished_at = now(), version = version + 1, updated_at = now()
          WHERE guild_id = $1 AND proposal_id = $2 AND position = $3 AND status = 'staged'
         RETURNING ${this.#actionReturningColumns()}`,
        [this.#guildId, input.proposalId, input.position, JSON.stringify(result)],
      )).rows[0];
      if (!updated) throw new Error("Staged Agent action changed before reconciliation.");
      action = actionFromRow(updated);
      await this.#refreshAggregate(input.proposalId);
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return {
        state: "succeeded",
        proposal: summaryFromRow(await this.#getProposalRowUnscoped(input.proposalId)),
        action,
      };
    }
    const errorSummary = (run.error_message ?? `Agent run ended ${run.status}.`).slice(0, MAX_ERROR_LENGTH);
    const updated = (await this.#connection.query<ActionRow>(
      `UPDATE intent_proposal_actions
          SET status = 'failed', error_summary = $4, finished_at = now(),
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2 AND position = $3 AND status = 'staged'
       RETURNING ${this.#actionReturningColumns()}`,
      [this.#guildId, input.proposalId, input.position, errorSummary],
    )).rows[0];
    if (!updated) throw new Error("Staged Agent action changed before reconciliation.");
    action = actionFromRow(updated);
    await this.#cancelOpenActions(input.proposalId);
    await this.#refreshAggregate(input.proposalId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return {
      state: "failed",
      proposal: summaryFromRow(await this.#getProposalRowUnscoped(input.proposalId)),
      action,
    };
  }

  async rejectProposal(input: RejectIntentProposalInput): Promise<IntentProposalDetail> {
    assertUuid(input.proposalId, "Plan proposal ID");
    assertBoundedText(input.reason, "Plan rejection reason", MAX_ERROR_LENGTH);
    const canManage = await this.#assertActorAccess(input.access);
    const proposal = summaryFromRow(await this.#getAuthorizedProposalRow(
      input.proposalId,
      input.access.actorId,
      canManage,
      true,
    ));
    this.#assertEvent(input.chronicleEvent, input.access.actorId, proposal);
    if (proposal.status === "rejected") return this.#getDetailUnscoped(input.proposalId);
    if (proposal.status !== "ready") throw new Error("Only a ready Plan proposal can be rejected.");
    await this.#cancelOpenActions(input.proposalId);
    await this.#connection.query(
      `UPDATE intent_proposals
          SET status = 'rejected', completed_at = now(), error_summary = $3,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status = 'ready'`,
      [this.#guildId, input.proposalId, input.reason],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return this.#getDetailUnscoped(input.proposalId);
  }

  async #assertActorAccess(access: IntentProposalAccess): Promise<boolean> {
    assertUuid(access.actorId, "Plan actor ID");
    const requestedManage = access.scope === "guild";
    if (requestedManage && access.assertedPermission !== "guild.manage") {
      throw new Error("Broad Plan access requires an explicit guild.manage assertion.");
    }
    const row = (await this.#connection.query<AccessRow>(
      `SELECT true AS active,
              (guild_row.root_owner_identity_id = membership.actor_id OR EXISTS (
                SELECT 1 FROM actor_role_bindings binding_row
                JOIN role_permissions permission_row
                  ON permission_row.guild_id = binding_row.guild_id
                 AND permission_row.role_id = binding_row.role_id
               WHERE binding_row.guild_id = membership.guild_id
                 AND binding_row.actor_id = membership.actor_id
                 AND binding_row.space_id IS NULL
                 AND permission_row.permission = 'guild.manage'
              )) AS can_manage_all
         FROM actor_memberships membership
         JOIN actors actor_row ON actor_row.id = membership.actor_id
         JOIN guilds guild_row ON guild_row.id = membership.guild_id
        WHERE membership.guild_id = $1 AND membership.actor_id = $2
          AND membership.state IN ('joined', 'active') AND membership.operational = true
          AND actor_row.status = 'active'`,
      [this.#guildId, access.actorId],
    )).rows[0];
    if (!row?.active) throw new Error("Plan actor is not an active operational Guild member.");
    if (requestedManage && !row.can_manage_all) {
      throw new Error("The asserted guild.manage authority is not currently granted.");
    }
    return requestedManage && row.can_manage_all;
  }

  async #getAuthorizedProposalRow(
    proposalId: string,
    actorId: string,
    canManage: boolean,
    forUpdate: boolean,
  ): Promise<ProposalRow> {
    const row = (await this.#connection.query<ProposalRow>(
      `${proposalRowsSelect()} WHERE proposal.guild_id = $1 AND proposal.id = $2
        AND ($4::boolean OR proposal.created_by_actor_id = $3)
        ${forUpdate ? "FOR UPDATE OF proposal" : ""}`,
      [this.#guildId, proposalId, actorId, canManage],
    )).rows[0];
    if (!row) throw new Error("Plan proposal was not found for the current Actor.");
    return row;
  }

  async #getProposalRowUnscoped(proposalId: string): Promise<ProposalRow> {
    const row = (await this.#connection.query<ProposalRow>(
      `${proposalRowsSelect()} WHERE proposal.guild_id = $1 AND proposal.id = $2`,
      [this.#guildId, proposalId],
    )).rows[0];
    if (!row) throw new Error("Plan proposal was not found in this Guild.");
    return row;
  }

  async #getDetailUnscoped(proposalId: string): Promise<IntentProposalDetail> {
    return this.#detailFromRow(await this.#getProposalRowUnscoped(proposalId));
  }

  async #detailFromRow(row: ProposalRow): Promise<IntentProposalDetail> {
    const actions = (await this.#connection.query<ActionRow>(
      `${actionRowsSelect()} WHERE action_row.guild_id = $1 AND action_row.proposal_id = $2
       ORDER BY action_row.position`,
      [this.#guildId, row.id],
    )).rows.map(actionFromRow);
    if (actions.length !== row.action_count || actions.some((action, index) => action.position !== index)) {
      throw new Error("Plan proposal actions are incomplete or out of order.");
    }
    return { ...summaryFromRow(row), actions };
  }

  async #getLeasedAction(
    input: LeasedIntentActionInput,
  ): Promise<{ proposal: IntentProposalSummary; action: StoredIntentAction }> {
    assertUuid(input.proposalId, "Plan proposal ID");
    assertUuid(input.leaseToken, "Plan action lease token");
    if (!Number.isSafeInteger(input.position) || input.position < 0 || input.position >= MAX_ACTION_COUNT) {
      throw new Error("Plan action position is outside the supported range.");
    }
    const canManage = await this.#assertActorAccess(input.access);
    const proposal = summaryFromRow(await this.#getAuthorizedProposalRow(
      input.proposalId,
      input.access.actorId,
      canManage,
      false,
    ));
    const row = (await this.#connection.query<ActionRow>(
      `${actionRowsSelect()} WHERE action_row.guild_id = $1
        AND action_row.proposal_id = $2 AND action_row.position = $3
        FOR UPDATE OF action_row`,
      [this.#guildId, input.proposalId, input.position],
    )).rows[0];
    if (!row) throw new Error("Plan action was not found.");
    const action = actionFromRow(row);
    if (action.status !== "processing" || action.leaseToken !== input.leaseToken ||
        action.leaseExpiresAt === null || new Date(action.leaseExpiresAt).valueOf() <= Date.now()) {
      throw new Error("Plan action lease is no longer owned by this worker.");
    }
    return { proposal, action };
  }

  async #cancelOpenActions(proposalId: string): Promise<void> {
    await this.#connection.query(
      `UPDATE intent_proposal_actions
          SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
              finished_at = now(), version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND proposal_id = $2
          AND status IN ('pending', 'processing', 'staged')`,
      [this.#guildId, proposalId],
    );
  }

  async #expireProposal(proposalId: string, event: ChronicleEvent): Promise<boolean> {
    const updated = await this.#connection.query(
      `UPDATE intent_proposals
          SET status = 'expired', completed_at = now(), error_summary = NULL,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status IN ('ready', 'executing')
          AND expires_at <= now()`,
      [this.#guildId, proposalId],
    );
    if (updated.rowCount === 1) {
      await this.#cancelOpenActions(proposalId);
      await this.#chronicle.appendChronicle(event);
      return true;
    }
    return false;
  }

  async #refreshAggregate(proposalId: string): Promise<void> {
    const aggregate = (await this.#connection.query<{
      open_count: number;
      failure_count: number;
      cancellation_count: number;
      first_error: string | null;
    }>(
      `SELECT count(*) FILTER (
                WHERE status IN ('pending', 'processing', 'staged'))::integer AS open_count,
              count(*) FILTER (WHERE status = 'failed')::integer AS failure_count,
              count(*) FILTER (WHERE status = 'cancelled')::integer AS cancellation_count,
              min(error_summary) FILTER (WHERE status = 'failed') AS first_error
         FROM intent_proposal_actions WHERE guild_id = $1 AND proposal_id = $2`,
      [this.#guildId, proposalId],
    )).rows[0];
    if (!aggregate || aggregate.open_count > 0) return;
    const failed = aggregate.failure_count > 0 || aggregate.cancellation_count > 0;
    await this.#connection.query(
      `UPDATE intent_proposals
          SET status = $3, completed_at = now(),
              error_summary = CASE WHEN $3 = 'failed'
                THEN COALESCE($4, 'A Plan action was cancelled.') ELSE NULL END,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status = 'executing'`,
      [this.#guildId, proposalId, failed ? "failed" : "completed", aggregate.first_error],
    );
  }

  #assertCreateInput(input: CreateIntentProposalInput): void {
    assertUuid(input.id, "Plan proposal ID");
    assertUuid(input.createdByActorId, "Plan creator Actor ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Plan Space ID");
    if (!SUPPORTED_LOCALES.has(input.locale)) throw new Error("Plan locale is not supported.");
    assertBoundedText(input.objective, "Plan objective", MAX_OBJECTIVE_LENGTH);
    if (!SHA256_PATTERN.test(input.requestHash)) {
      throw new Error("Plan request hash must be a lowercase SHA-256 digest.");
    }
    const expiresAt = new Date(isoTimestamp(input.expiresAt, "Plan expiry")).valueOf();
    const now = Date.now();
    if (expiresAt <= now || expiresAt > now + MAX_EXPIRY_DAYS * 86_400_000) {
      throw new Error(`Plan expiry must be in the future and within ${MAX_EXPIRY_DAYS} days.`);
    }
    if (!Array.isArray(input.actions) || input.actions.length < 1 ||
        input.actions.length > MAX_ACTION_COUNT) {
      throw new Error(`A Plan must contain between 1 and ${MAX_ACTION_COUNT} actions.`);
    }
    input.actions.forEach(assertActionInput);
    const evidence = evidenceFrom(input.evidence);
    const snapshot = authorizationSnapshotFrom(input.authorizationSnapshot);
    if (snapshot.actorId !== input.createdByActorId) {
      throw new Error("Plan authorization snapshot belongs to a different Actor.");
    }
    if (canonicalJson(snapshot as unknown as JsonValue) !==
        canonicalJson(input.authorizationSnapshot as unknown as JsonValue)) {
      throw new Error("Plan authorization snapshot contains non-canonical content.");
    }
    if (canonicalJson(evidence as unknown as JsonValue) !==
        canonicalJson(input.evidence as unknown as JsonValue)) {
      throw new Error("Plan evidence contains non-canonical content.");
    }
    this.#assertEvent(input.chronicleEvent, input.createdByActorId, {
      id: input.id,
      spaceId: input.spaceId,
    });
  }

  #matchesCreateInput(existing: IntentProposalDetail, input: CreateIntentProposalInput): boolean {
    const expiresAt = isoTimestamp(input.expiresAt, "Plan expiry");
    const maximumRiskLevel = Math.max(...input.actions.map((action) => action.riskLevel));
    return existing.spaceId === input.spaceId &&
      existing.createdByActorId === input.createdByActorId &&
      existing.locale === input.locale && existing.objective === input.objective &&
      existing.requestHash === input.requestHash && existing.expiresAt === expiresAt &&
      existing.maximumRiskLevel === maximumRiskLevel &&
      canonicalJson(existing.evidence as unknown as JsonValue) ===
        canonicalJson(input.evidence as unknown as JsonValue) &&
      canonicalJson(existing.authorizationSnapshot as unknown as JsonValue) ===
        canonicalJson(input.authorizationSnapshot as unknown as JsonValue) &&
      existing.actions.length === input.actions.length && existing.actions.every((action, index) => {
        const candidate = input.actions[index];
        return candidate !== undefined && action.kind === candidate.kind &&
          action.riskLevel === candidate.riskLevel &&
          canonicalJson(action.action as unknown as JsonValue) ===
            canonicalJson(candidate.action as unknown as JsonValue);
      });
  }

  #assertEvent(
    event: ChronicleEvent,
    actorId: string,
    proposal: Pick<IntentProposalSummary, "id" | "spaceId">,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorId ||
        event.ownerIdentityId !== actorId || event.subjectType !== "intent_proposal" ||
        event.subjectId !== proposal.id || event.spaceId !== proposal.spaceId) {
      throw new Error("Plan Chronicle event crosses its Guild, Actor, Space, or subject boundary.");
    }
    assertUuid(event.id, "Plan Chronicle event ID");
    assertUuid(event.correlationId, "Plan Chronicle correlation ID");
    isoTimestamp(event.occurredAt, "Plan Chronicle event time");
    assertBoundedText(event.action, "Plan Chronicle action", 200);
    assertJsonObject(event.details, "Plan Chronicle details", 16 * 1024);
  }

  #updateActionReturning(): string {
    return "UPDATE intent_proposal_actions";
  }

  #actionReturningColumns(): string {
    return `guild_id::text, proposal_id::text, position, kind, action, risk_level,
            status, attempt_count, lease_token::text, lease_expires_at::text,
            resource_type, resource_id::text, agent_run_id::text, result,
            error_summary, version, started_at::text, finished_at::text,
            created_at::text, updated_at::text`;
  }
}
