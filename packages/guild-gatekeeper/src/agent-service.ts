import {
  CLASSIFICATIONS,
  VISIBILITIES,
  approvalRequirement,
  assertAgentLimits,
  assertAgentRunPlan,
  assertNonBlank,
  assertUsageWithinLimits,
  authorize,
  authorizeAgent,
  intersectAgentLimits,
  isAuthorized,
  type AgentApprovalVote,
  type AgentApprovalRequest,
  type AgentLimits,
  type AgentRun,
  type AgentRunPlan,
  type AgentRunResult,
  type AgentRunUsage,
  type AuthorizationSnapshot,
  type JsonValue,
  type Permission,
  type RiskLevel,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  loadAgentAuthorizationSnapshot,
  withGuildTransaction,
  type AgentRunListCursor,
  type GuildTransactionConnection,
  type StoredAgentRun,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { assertRecentReauthentication as assertVerifiedReauthentication } from "./reauthentication.js";
import type {
  CreateAgentWebhookRunRequest,
  ReviewAgentRunRequest,
  UiAgentRun,
  UiAgentRunDetail,
  UiAgentRunPage,
  UiAgentRunPageRequest,
} from "./management-types.js";
import type { GuildAgentExecutionContext } from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_PAGE_SIZE = 30;
const MAX_ALLOWED_IDENTITIES = 100;
const APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const WORKFLOW_PERMISSIONS = new Set<Permission>(["integration.execute"]);
const WEBHOOK_TOOL_ID = "https_webhook";
const DEFAULT_KILL_POLL_INTERVAL_MS = 250;
const MIN_KILL_POLL_INTERVAL_MS = 10;
const MAX_KILL_POLL_INTERVAL_MS = 1_000;
const ZERO_USAGE: AgentRunUsage = {
  budgetMinor: 0,
  tokens: 0,
  durationSeconds: 0,
  steps: 0,
  retries: 0,
  delegationDepth: 0,
};

type AgentAction = AgentRunPlan["action"];
type AgentActionKind = AgentAction["kind"];
type AgentActionOf<Kind extends AgentActionKind> = Extract<AgentAction, { kind: Kind }>;
type AgentResultOf<Kind extends AgentActionKind> = Extract<AgentRunResult, { kind: Kind }>;
type ExternalAgentActionKind = "connection_invoke" | "https_webhook" | "federation_publish";

const AGENT_ACTION_POLICY = {
  memory_search: {
    actionKind: "memory.search",
    riskLevels: [0],
    permissions: ["memory.read"],
    toolId: "memory_search",
    external: false,
  },
  activity_draft: {
    actionKind: "activity.draft",
    riskLevels: [1],
    permissions: ["activity.create"],
    toolId: "activity_draft",
    external: false,
  },
  agent_delegate: {
    actionKind: "agent.delegate",
    riskLevels: [1],
    permissions: ["agent.run"],
    toolId: "agent_delegate",
    external: false,
  },
  connection_invoke: {
    actionKind: "connection.invoke",
    riskLevels: [0, 1, 2, 3],
    permissions: ["connection.execute"],
    toolId: "connection_invoke",
    external: true,
  },
  https_webhook: {
    actionKind: "https_webhook.post",
    riskLevels: [2],
    permissions: ["integration.execute"],
    toolId: WEBHOOK_TOOL_ID,
    external: true,
  },
  federation_publish: {
    actionKind: "federation.publish",
    riskLevels: [2, 3],
    permissions: ["federation.read", "integration.execute"],
    toolId: "federation_publish",
    external: true,
  },
} as const satisfies Record<AgentActionKind, {
  actionKind: string;
  riskLevels: readonly RiskLevel[];
  permissions: readonly Permission[];
  toolId: string;
  external: boolean;
}>;

type RunSource = AgentRun["source"];

export interface AgentExecutionClaim {
  runId: string;
  guildId: string;
  agentIdentityId: string;
  requesterIdentityId: string;
  eventType: string;
  payloadJson: string;
  idempotencyKey: string;
  plannedSteps: number;
  endpointUrl: string;
  effectiveLimits: AgentLimits;
}

export interface AgentWorkflowState {
  status: AgentRun["status"];
  workflowInstanceId: string;
  approvalStatus: AgentApprovalRequest["status"] | null;
}

export interface GuildAgentActionHandlerContext {
  runId: string;
  guildId: string;
  spaceId: string | null;
  agentIdentityId: string;
  requesterIdentityId: string;
  idempotencyKey: string;
  requestHash: string;
  effectiveLimits: AgentLimits;
  signal: AbortSignal;
}

export interface GuildAgentActionExecutionRecord {
  result: AgentRunResult;
  usage: AgentRunUsage;
  authorizedResources?: readonly SecuredResource[];
}

type GuildAgentActionHandlerRecord<Kind extends AgentActionKind> = {
  result: AgentResultOf<Kind>;
  usage: AgentRunUsage;
} & (Kind extends "memory_search"
  ? { authorizedResources: readonly SecuredResource[] }
  : { authorizedResources?: never });

type GuildAgentActionHandler<Kind extends AgentActionKind> = (
  action: AgentActionOf<Kind>,
  context: GuildAgentActionHandlerContext,
) => Promise<GuildAgentActionHandlerRecord<Kind>>;

export interface GuildAgentActionHandlers {
  memory_search?: GuildAgentActionHandler<"memory_search">;
  activity_draft?: GuildAgentActionHandler<"activity_draft">;
  agent_delegate?: GuildAgentActionHandler<"agent_delegate">;
  connection_invoke?: GuildAgentActionHandler<"connection_invoke">;
  https_webhook?: GuildAgentActionHandler<"https_webhook">;
  federation_publish?: GuildAgentActionHandler<"federation_publish">;
}

export interface GuildAgentExternalWriteScope {
  guildId: string;
  runId: string;
  idempotencyKey: string;
  requestHash: string;
  actionKind: ExternalAgentActionKind;
}

export interface GuildAgentExternalWriteIdempotency {
  /** This operation must atomically claim the key and replay its durable completed result. */
  runOnce(
    scope: GuildAgentExternalWriteScope,
    operation: () => Promise<GuildAgentActionExecutionRecord>,
  ): Promise<GuildAgentActionExecutionRecord>;
}

export interface GuildAgentKillSwitch {
  /** Must read the durable run state; process-local flags are not sufficient. */
  isKillRequested(runId: string): Promise<boolean>;
}

export interface ExecuteGuildAgentActionInput {
  run: AgentRun;
  snapshot: AuthorizationSnapshot;
  workflowPermissions: ReadonlySet<Permission>;
  /** Current Connector permissions for external actions, or local tool capabilities internally. */
  connectorPermissions: ReadonlySet<Permission>;
  /** Current Connector write policy; null is required for internal actions. */
  connectorWriteRiskLevel: RiskLevel | null;
  approval: AgentApprovalRequest | null;
  approvalVotes: readonly AgentApprovalVote[];
  handlers: GuildAgentActionHandlers;
  killSwitch: GuildAgentKillSwitch;
  externalWriteIdempotency?: GuildAgentExternalWriteIdempotency;
  delegationChainAgentIdentityIds?: readonly string[];
  now?: string;
  killPollIntervalMs?: number;
}

export interface ExecuteGuildAgentActionOutcome {
  result: AgentRunResult;
  usage: AgentRunUsage;
  effectiveLimits: AgentLimits;
  completedAfterKill: boolean;
}

export interface CreateGovernedAgentRunInput {
  requestId: string;
  agentIdentityId: string;
  spaceId: string | null;
  plan: AgentRunPlan;
  riskLevel: RiskLevel;
  visibility: AgentRun["visibility"];
  classification: AgentRun["classification"];
  allowedIdentityIds: readonly string[];
  workflowPermissions: readonly Permission[];
  workflowDefinitionId: string | null;
  origin: "plan" | "automation" | "delegation";
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertVisibilityAndClassification(input: Pick<
  CreateAgentWebhookRunRequest,
  "visibility" | "classification" | "allowedIdentityIds"
>): void {
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Agent run visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Agent run classification is invalid.");
  }
  if (!Array.isArray(input.allowedIdentityIds) ||
      input.allowedIdentityIds.length > MAX_ALLOWED_IDENTITIES ||
      new Set(input.allowedIdentityIds).size !== input.allowedIdentityIds.length) {
    throw new Error(
      `Agent run access list must contain at most ${MAX_ALLOWED_IDENTITIES} unique Identities.`,
    );
  }
  for (const identityId of input.allowedIdentityIds) {
    assertUuid(identityId, "Allowed Identity ID");
  }
  if (!["private", "restricted"].includes(input.visibility) &&
      input.allowedIdentityIds.length > 0) {
    throw new Error("Explicit Identity access is valid only for private or restricted Agent runs.");
  }
}

function assertInput(input: CreateAgentWebhookRunRequest): void {
  assertUuid(input.requestId, "Agent request ID");
  assertUuid(input.agentIdentityId, "Agent Identity ID");
  assertUuid(input.connectorId, "Connector ID");
  assertUuid(input.spaceId, "Space ID");
  if (input.questId !== null) assertUuid(input.questId, "Quest ID");
  assertVisibilityAndClassification(input);
  assertAgentRunPlan({
    objective: input.objective,
    expectedOutcome: input.expectedOutcome,
    steps: input.steps,
    connectorId: input.connectorId,
    questId: input.questId,
    action: {
      kind: "https_webhook",
      eventType: input.eventType,
      payload: input.payload,
    },
    estimatedUsage: input.estimatedUsage,
  });
  if (input.estimatedUsage.budgetMinor !== 0 || input.estimatedUsage.tokens !== 0 ||
      input.estimatedUsage.retries !== 0 ||
      input.estimatedUsage.delegationDepth !== 0) {
    throw new Error(
      "The v1 Webhook action requires zero budget, tokens, retries, and delegation depth.",
    );
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

async function requestHash(
  input: CreateAgentWebhookRunRequest,
  source: RunSource,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({
    ...input,
    source,
    steps: [...input.steps],
    allowedIdentityIds: [...input.allowedIdentityIds].sort(),
  } as unknown as JsonValue));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function governedRequestHash(input: CreateGovernedAgentRunInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({
    ...input,
    allowedIdentityIds: [...input.allowedIdentityIds].sort(),
    workflowPermissions: [...input.workflowPermissions].sort(),
  } as unknown as JsonValue));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(cursor: AgentRunListCursor | null): string | null {
  return cursor === null ? null : bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(cursor)),
  );
}

function decodeCursor(value: string | null | undefined): AgentRunListCursor | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Agent run cursor is malformed.");
  try {
    const candidate: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!candidate || typeof candidate !== "object") throw new Error("invalid cursor");
    const cursor = candidate as Readonly<Record<string, unknown>>;
    if (typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" ||
        Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error("invalid cursor");
    assertUuid(cursor.id, "Agent run cursor ID");
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new Error("Agent run cursor is malformed.");
  }
}

function runResource(run: AgentRun): SecuredResource {
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

function actionPolicy(kind: AgentActionKind) {
  return AGENT_ACTION_POLICY[kind];
}

function assertActionBoundary(run: AgentRun, snapshot: AuthorizationSnapshot): void {
  assertAgentRunPlan(run.plan);
  if (run.guildId !== snapshot.guild.id || run.ownerIdentityId !== run.requesterIdentityId) {
    throw new Error("Agent action crosses its Guild or requester ownership boundary.");
  }
  if (run.plan.connectorId !== run.connectorId || run.plan.questId !== run.questId) {
    throw new Error("Agent action crosses its Connector or Quest boundary.");
  }
  if (run.status !== "running" || run.result !== null || run.finishedAt !== null) {
    throw new Error("Only an unfinished running Agent action can execute.");
  }
  if (run.killRequestedAt !== null) throw new Error("Agent action was killed before execution.");
  assertNonBlank(run.idempotencyKey, "Agent action idempotency key", 500);
  assertNonBlank(run.requestHash, "Agent action request hash", 500);

  const policy = actionPolicy(run.plan.action.kind);
  if (!(policy.riskLevels as readonly RiskLevel[]).includes(run.riskLevel)) {
    throw new Error(
      `${policy.actionKind} cannot execute at Agent risk Level ${run.riskLevel}.`,
    );
  }
  if (policy.external !== (run.connectorId !== null)) {
    throw new Error(
      policy.external
        ? "External Agent actions require a Connector."
        : "Internal Agent actions cannot inherit external Connector authority.",
    );
  }
}

function assertConnectorRiskBoundary(input: ExecuteGuildAgentActionInput): void {
  const policy = actionPolicy(input.run.plan.action.kind);
  if (!policy.external) {
    if (input.connectorWriteRiskLevel !== null) {
      throw new Error("Internal Agent actions cannot inherit a Connector risk policy.");
    }
    return;
  }
  if (input.connectorWriteRiskLevel === null ||
      !(policy.riskLevels as readonly RiskLevel[]).includes(input.connectorWriteRiskLevel)) {
    throw new Error("External Agent action risk is incompatible with its Connection policy.");
  }
  if (input.connectorWriteRiskLevel !== input.run.riskLevel) {
    throw new Error("Agent action cannot weaken or override its Connector risk policy.");
  }
}

function currentAgentLimitsForAction(
  snapshot: AuthorizationSnapshot,
  agentIdentityId: string,
  kind: AgentActionKind,
): AgentLimits {
  const profile = snapshot.agents.find((candidate) => candidate.identityId === agentIdentityId);
  if (!profile || profile.status !== "active") throw new Error("Agent is stopped.");
  const requiredToolId = actionPolicy(kind).toolId;
  if (!profile.toolIds.includes(requiredToolId)) {
    throw new Error(`Agent is not allowed to use the ${requiredToolId} tool.`);
  }
  assertAgentLimits(profile.limits);
  assertAgentLimits(snapshot.constitution.agentDefaults);
  return intersectAgentLimits(profile.limits, snapshot.constitution.agentDefaults);
}

function authorizeActionIntersection(
  snapshot: AuthorizationSnapshot,
  run: AgentRun,
  workflowPermissions: ReadonlySet<Permission>,
  connectorPermissions: ReadonlySet<Permission>,
): void {
  const resource = runResource(run);
  authorize(snapshot, {
    actorIdentityId: run.requesterIdentityId,
    permission: "agent.run",
    resource,
  });
  for (const permission of actionPolicy(run.plan.action.kind).permissions) {
    authorizeAgent(snapshot, {
      agentIdentityId: run.agentIdentityId,
      requesterIdentityId: run.requesterIdentityId,
      permission,
      workflowPermissions,
      connectorPermissions,
      resource,
    });
  }
}

function assertRecentReauthentication(value: string | null, now: number): void {
  assertVerifiedReauthentication(value, {
    now,
    missingMessage: "This Agent approval requires recent reauthentication.",
    expiredMessage: "This Agent approval requires reauthentication within the last five minutes.",
  });
}

function assertApprovalEvidence(
  snapshot: AuthorizationSnapshot,
  run: AgentRun,
  approval: AgentApprovalRequest | null,
  votes: readonly AgentApprovalVote[],
  now: number,
): void {
  const policy = actionPolicy(run.plan.action.kind);
  const requirement = approvalRequirement(snapshot.constitution, run.riskLevel);
  const requiredApprovals = run.riskLevel === 3
    ? Math.max(2, requirement.approvals)
    : requirement.approvals;
  if (requiredApprovals === 0) {
    if (approval && ["rejected", "expired"].includes(approval.status)) {
      throw new Error("Agent approval was rejected or expired.");
    }
    return;
  }
  if (!approval || approval.status !== "approved") {
    throw new Error("Agent action does not have a current durable Human approval.");
  }
  if (approval.guildId !== run.guildId || approval.agentRunId !== run.id ||
      approval.riskLevel !== run.riskLevel || approval.actionKind !== policy.actionKind) {
    throw new Error("Agent approval crosses its action boundary.");
  }
  if (Date.parse(approval.expiresAt) <= now || Number.isNaN(Date.parse(approval.expiresAt))) {
    throw new Error("Agent approval has expired.");
  }
  if (approval.requiredApprovals < requiredApprovals ||
      requirement.reauthenticationRequired && !approval.reauthenticationRequired) {
    throw new Error("Agent approval weakens the Constitution policy.");
  }
  const relevantVotes = votes.filter((vote) => vote.approvalRequestId === approval.id);
  if (relevantVotes.some((vote) => vote.guildId !== run.guildId)) {
    throw new Error("Agent approval vote crosses its Guild boundary.");
  }
  if (relevantVotes.some((vote) => vote.verdict === "reject")) {
    throw new Error("Agent action has a rejecting Human approval vote.");
  }
  const approvingVotes = relevantVotes.filter((vote) => vote.verdict === "approve");
  const approverIds = new Set(approvingVotes.map((vote) => vote.approverIdentityId));
  if (approverIds.size !== approvingVotes.length) {
    throw new Error("Agent approval quorum must contain unique Humans.");
  }
  for (const vote of approvingVotes) {
    const identity = snapshot.identities.find(
      (candidate) => candidate.id === vote.approverIdentityId,
    );
    if (!identity || identity.kind !== "human") {
      throw new Error("Agent approval quorum can contain only active Humans.");
    }
    authorize(snapshot, {
      actorIdentityId: vote.approverIdentityId,
      permission: "agent.approve",
      resource: runResource(run),
    });
    if (requirement.reauthenticationRequired) {
      assertRecentReauthentication(vote.reauthenticatedAt, now);
    }
  }
  if (approval.approvalCount !== approvingVotes.length ||
      approvingVotes.length < requiredApprovals) {
    throw new Error(`Agent action requires ${requiredApprovals} authorized Human approvals.`);
  }
}

function assertDelegationBoundary(
  input: ExecuteGuildAgentActionInput,
  effectiveLimits: AgentLimits,
): number {
  if (input.run.plan.action.kind !== "agent_delegate") return 0;
  const chain = input.delegationChainAgentIdentityIds?.length
    ? [...input.delegationChainAgentIdentityIds]
    : [input.run.agentIdentityId];
  if (chain.length > 50 || chain.at(-1) !== input.run.agentIdentityId ||
      new Set(chain).size !== chain.length) {
    throw new Error("Agent delegation chain is malformed or cyclic.");
  }
  const targetId = input.run.plan.action.targetAgentActorId;
  if (chain.includes(targetId)) throw new Error("Agent delegation cycle is forbidden.");
  const nextDepth = chain.length;
  if (nextDepth > effectiveLimits.maxDelegationDepth ||
      input.run.plan.estimatedUsage.delegationDepth < nextDepth) {
    throw new Error("Agent delegation depth exceeds its hard limit or planned usage.");
  }
  const target = input.snapshot.identities.find((identity) => identity.id === targetId);
  const targetProfile = input.snapshot.agents.find((profile) => profile.identityId === targetId);
  if (!target || target.kind !== "agent" || target.status !== "active" ||
      !targetProfile || targetProfile.status !== "active") {
    throw new Error("Delegated target must be an active Agent.");
  }
  authorizeAgent(input.snapshot, {
    agentIdentityId: targetId,
    requesterIdentityId: input.run.requesterIdentityId,
    permission: "agent.run",
    workflowPermissions: input.workflowPermissions,
    connectorPermissions: input.connectorPermissions,
    resource: runResource(input.run),
  });
  return nextDepth;
}

function assertActualUsage(usage: AgentRunUsage): void {
  for (const [name, value] of Object.entries(usage)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Agent ${name} usage must be a non-negative safe integer.`);
    }
  }
}

function assertTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp.`);
}

function assertActionResult(action: AgentAction, result: AgentRunResult): void {
  if (action.kind !== result.kind) {
    throw new Error(`Agent ${action.kind} adapter returned a mismatched result.`);
  }
  switch (result.kind) {
    case "memory_search":
      if (result.memoryIds.length > 50 ||
          new Set(result.memoryIds).size !== result.memoryIds.length) {
        throw new Error("Memory search returned too many or duplicate results.");
      }
      for (const id of result.memoryIds) assertUuid(id, "Memory result ID");
      assertTimestamp(result.completedAt, "Memory search completion");
      break;
    case "activity_draft":
      assertUuid(result.activityId, "Activity draft ID");
      assertTimestamp(result.completedAt, "Activity draft completion");
      break;
    case "agent_delegate":
      assertUuid(result.childRunId, "Delegated Agent run ID");
      assertTimestamp(result.completedAt, "Agent delegation completion");
      break;
    case "https_webhook":
      if (!Number.isSafeInteger(result.statusCode) ||
          result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error("Webhook adapter did not return a successful HTTP status.");
      }
      assertTimestamp(result.deliveredAt, "Webhook delivery");
      break;
    case "federation_publish":
      assertUuid(result.deliveryId, "Federation delivery ID");
      assertTimestamp(result.completedAt, "Federation publication completion");
      break;
  }
}

function assertReturnedResourceAuthorization(
  input: ExecuteGuildAgentActionInput,
  record: GuildAgentActionExecutionRecord,
): void {
  if (record.result.kind !== "memory_search") {
    if ((record.authorizedResources?.length ?? 0) > 0) {
      throw new Error("Only memory_search may return authorized resource evidence.");
    }
    return;
  }
  const resources = record.authorizedResources;
  if (!resources || resources.length !== record.result.memoryIds.length) {
    throw new Error("Memory search must return authorization evidence for every result.");
  }
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  if (byId.size !== resources.length ||
      record.result.memoryIds.some((memoryId) => !byId.has(memoryId))) {
    throw new Error("Memory search authorization evidence does not match its result IDs.");
  }
  for (const resource of resources) {
    authorizeAgent(input.snapshot, {
      agentIdentityId: input.run.agentIdentityId,
      requesterIdentityId: input.run.requesterIdentityId,
      permission: "memory.read",
      workflowPermissions: input.workflowPermissions,
      connectorPermissions: input.connectorPermissions,
      resource,
    });
  }
}

async function dispatchInternalAgentAction(
  action: Exclude<AgentAction, { kind: ExternalAgentActionKind }>,
  handlers: GuildAgentActionHandlers,
  context: GuildAgentActionHandlerContext,
): Promise<GuildAgentActionExecutionRecord> {
  switch (action.kind) {
    case "memory_search": {
      const handler = handlers.memory_search;
      if (!handler) throw new Error("No execution adapter is registered for memory_search.");
      return handler(action, context);
    }
    case "activity_draft": {
      const handler = handlers.activity_draft;
      if (!handler) throw new Error("No execution adapter is registered for activity_draft.");
      return handler(action, context);
    }
    case "agent_delegate": {
      const handler = handlers.agent_delegate;
      if (!handler) throw new Error("No execution adapter is registered for agent_delegate.");
      return handler(action, context);
    }
  }
}

async function dispatchExternalAgentAction(
  action: Extract<AgentAction, { kind: ExternalAgentActionKind }>,
  handlers: GuildAgentActionHandlers,
  context: GuildAgentActionHandlerContext,
): Promise<GuildAgentActionExecutionRecord> {
  switch (action.kind) {
    case "https_webhook": {
      const handler = handlers.https_webhook;
      if (!handler) throw new Error("No execution adapter is registered for https_webhook.");
      return handler(action, context);
    }
    case "connection_invoke": {
      const handler = handlers.connection_invoke;
      if (!handler) throw new Error("No execution adapter is registered for connection_invoke.");
      return handler(action, context);
    }
    case "federation_publish": {
      const handler = handlers.federation_publish;
      if (!handler) throw new Error("No execution adapter is registered for federation_publish.");
      return handler(action, context);
    }
  }
}

async function executeWithRuntimeGuards(
  input: ExecuteGuildAgentActionInput,
  effectiveLimits: AgentLimits,
  operation: (signal: AbortSignal) => Promise<GuildAgentActionExecutionRecord>,
): Promise<{
  record: GuildAgentActionExecutionRecord;
  elapsedSeconds: number;
  completedAfterKill: boolean;
}> {
  if (await input.killSwitch.isKillRequested(input.run.id)) {
    throw new Error("Agent action was stopped by the Kill Switch before execution.");
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  if (input.killPollIntervalMs !== undefined &&
      (!Number.isSafeInteger(input.killPollIntervalMs) || input.killPollIntervalMs <= 0)) {
    throw new Error("Agent Kill Switch polling interval must be a positive safe integer.");
  }
  const pollInterval = Math.max(
    MIN_KILL_POLL_INTERVAL_MS,
    Math.min(MAX_KILL_POLL_INTERVAL_MS, input.killPollIntervalMs ?? DEFAULT_KILL_POLL_INTERVAL_MS),
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let pollHandle: ReturnType<typeof setInterval> | undefined;
  let guardFinished = false;
  let pollPending = false;
  let rejectGuard: (error: Error) => void = () => undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    rejectGuard = reject;
  });
  const stop = (message: string): void => {
    if (guardFinished) return;
    controller.abort();
    rejectGuard(new Error(message));
  };

  timeoutHandle = setTimeout(() => {
    stop("Agent action exceeded its hard duration limit.");
  }, Math.min(2_147_483_647, effectiveLimits.maxDurationSeconds * 1_000));
  pollHandle = setInterval(() => {
    if (guardFinished || pollPending) return;
    pollPending = true;
    void input.killSwitch.isKillRequested(input.run.id).then((killed) => {
      if (killed) stop("Agent action was stopped by the Kill Switch during execution.");
    }).catch(() => {
      stop("Agent Kill Switch state could not be verified; execution failed closed.");
    }).finally(() => {
      pollPending = false;
    });
  }, pollInterval);

  try {
    const record = await Promise.race([operation(controller.signal), guard]);
    const completedAfterKill = await input.killSwitch.isKillRequested(input.run.id);
    return {
      record,
      elapsedSeconds: Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
      completedAfterKill,
    };
  } finally {
    guardFinished = true;
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (pollHandle !== undefined) clearInterval(pollHandle);
  }
}

/**
 * Executes one already-planned and already-claimed Agent action through injected,
 * deployment-owned adapters. No adapter means no execution; this helper never
 * substitutes a simulated success for a missing database, Connector, or Workflow.
 */
export async function executeGuildAgentAction(
  input: ExecuteGuildAgentActionInput,
): Promise<ExecuteGuildAgentActionOutcome> {
  assertActionBoundary(input.run, input.snapshot);
  assertConnectorRiskBoundary(input);
  const now = input.now === undefined ? Date.now() : Date.parse(input.now);
  if (Number.isNaN(now)) throw new Error("Agent execution time is invalid.");

  authorizeActionIntersection(
    input.snapshot,
    input.run,
    input.workflowPermissions,
    input.connectorPermissions,
  );
  const currentLimits = currentAgentLimitsForAction(
    input.snapshot,
    input.run.agentIdentityId,
    input.run.plan.action.kind,
  );
  assertAgentLimits(input.run.limits);
  const effectiveLimits = intersectAgentLimits(input.run.limits, currentLimits);
  assertActualUsage(input.run.usage);
  assertUsageWithinLimits(effectiveLimits, input.run.usage);
  assertUsageWithinLimits(effectiveLimits, input.run.plan.estimatedUsage);
  assertApprovalEvidence(
    input.snapshot,
    input.run,
    input.approval,
    input.approvalVotes,
    now,
  );
  const delegationDepth = assertDelegationBoundary(input, effectiveLimits);
  const action = input.run.plan.action;
  const contextFor = (signal: AbortSignal): GuildAgentActionHandlerContext => ({
    runId: input.run.id,
    guildId: input.run.guildId,
    spaceId: input.run.spaceId,
    agentIdentityId: input.run.agentIdentityId,
    requesterIdentityId: input.run.requesterIdentityId,
    idempotencyKey: input.run.idempotencyKey,
    requestHash: input.run.requestHash,
    effectiveLimits,
    signal,
  });

  let operation: (signal: AbortSignal) => Promise<GuildAgentActionExecutionRecord>;
  if (action.kind === "connection_invoke" || action.kind === "https_webhook" ||
      action.kind === "federation_publish") {
    const idempotency = input.externalWriteIdempotency;
    if (!idempotency) {
      throw new Error("External Agent actions require a durable idempotency adapter.");
    }
    operation = (signal) => idempotency.runOnce(
      {
        guildId: input.run.guildId,
        runId: input.run.id,
        idempotencyKey: input.run.idempotencyKey,
        requestHash: input.run.requestHash,
        actionKind: action.kind,
      },
      () => dispatchExternalAgentAction(action, input.handlers, contextFor(signal)),
    );
  } else {
    operation = (signal) => dispatchInternalAgentAction(
      action,
      input.handlers,
      contextFor(signal),
    );
  }

  const execution = await executeWithRuntimeGuards(input, effectiveLimits, operation);
  assertActionResult(action, execution.record.result);
  assertReturnedResourceAuthorization(input, execution.record);
  if (action.kind === "agent_delegate" &&
      execution.record.result.kind === "agent_delegate" &&
      execution.record.result.childRunId === input.run.id) {
    throw new Error("An Agent delegation cannot create itself as its child run.");
  }
  assertActualUsage(execution.record.usage);
  const usage: AgentRunUsage = {
    ...execution.record.usage,
    durationSeconds: Math.max(
      execution.record.usage.durationSeconds,
      execution.elapsedSeconds,
    ),
    delegationDepth: Math.max(
      execution.record.usage.delegationDepth,
      delegationDepth,
    ),
  };
  for (const key of Object.keys(input.run.usage) as (keyof AgentRunUsage)[]) {
    if (usage[key] < input.run.usage[key]) {
      throw new Error(`Agent ${key} usage cannot move backwards during execution.`);
    }
  }
  assertUsageWithinLimits(effectiveLimits, usage);
  return {
    result: execution.record.result,
    usage,
    effectiveLimits,
    completedAfterKill: execution.completedAfterKill,
  };
}

function capabilities(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  run: StoredAgentRun,
) {
  const resource = runResource(run);
  return {
    review: run.status === "awaiting_approval" && run.approval?.status === "pending" &&
      isAuthorized(snapshot, {
        actorIdentityId,
        permission: "agent.approve",
        resource,
      }),
    stop: ["planning", "awaiting_approval", "running"].includes(run.status) &&
      isAuthorized(snapshot, {
        actorIdentityId,
        permission: "agent.stop",
        resource,
      }),
  };
}

function runForUi(
  run: StoredAgentRun,
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
): UiAgentRun {
  const {
    guildId: _guildId,
    workflowPermissions: _workflowPermissions,
    connectorPermissionsSnapshot: _connectorPermissionsSnapshot,
    ...value
  } = run;
  return { ...value, capabilities: capabilities(snapshot, actorIdentityId, run) };
}

function approvalForAction(
  guildId: string,
  runId: string,
  snapshot: AuthorizationSnapshot,
  riskLevel: RiskLevel,
  kind: AgentActionKind,
): AgentApprovalRequest {
  const now = new Date();
  const requirement = approvalRequirement(snapshot.constitution, riskLevel);
  return {
    id: crypto.randomUUID(),
    guildId,
    agentRunId: runId,
    riskLevel,
    actionKind: actionPolicy(kind).actionKind,
    requiredApprovals: requirement.approvals,
    approvalCount: 0,
    reauthenticationRequired: requirement.reauthenticationRequired,
    status: "pending",
    expiresAt: new Date(now.valueOf() + APPROVAL_LIFETIME_MS).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function assertDeploymentConnector(env: GuildEnv, connector: Awaited<
  ReturnType<GuildAgentRunRepository["getConnector"]>
>): void {
  if (connector.id !== env.GUILD_WEBHOOK_CONNECTOR_ID ||
      connector.endpointUrl !== env.GUILD_WEBHOOK_URL ||
      connector.secretReference !== "GUILD_WEBHOOK_SIGNING_SECRET" ||
      !connector.deploymentManaged || connector.kind !== "https_webhook") {
    throw new Error("Webhook Connector does not match this immutable deployment configuration.");
  }
  if (connector.status !== "active") throw new Error("Webhook Connector is not active.");
}

function currentAgentLimits(snapshot: AuthorizationSnapshot, agentIdentityId: string): AgentLimits {
  return currentAgentLimitsForAction(snapshot, agentIdentityId, "https_webhook");
}

function authorizeExecution(
  snapshot: AuthorizationSnapshot,
  run: StoredAgentRun,
  connectorPermissions: ReadonlySet<Permission>,
): AgentLimits {
  authorizeActionIntersection(
    snapshot,
    run,
    new Set(run.workflowPermissions),
    connectorPermissions,
  );
  const current = currentAgentLimits(snapshot, run.agentIdentityId);
  const effective = intersectAgentLimits(run.limits, current);
  assertUsageWithinLimits(effective, run.plan.estimatedUsage);
  return effective;
}

export class GuildAgentService {
  readonly #env: GuildEnv;
  readonly #accountId: string;
  readonly #verifiedAuthenticatedAt: string | null;

  constructor(env: GuildEnv, accountId: string, verifiedAuthenticatedAt: string | null = null) {
    this.#env = env;
    this.#accountId = accountId;
    this.#verifiedAuthenticatedAt = verifiedAuthenticatedAt;
  }

  async getExecutionContext(): Promise<GuildAgentExecutionContext> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const runSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "agent.run",
        );
        const readConnectorSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.read",
        );
        const executeSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.execute",
        );
        const readable = new Set(readConnectorSpaces.map((space) => space.id));
        const executable = new Set(executeSpaces.map((space) => space.id));
        const spaces = runSpaces
          .filter((space) => readable.has(space.id) && executable.has(space.id))
          .slice(0, 100);
        const agents = await repository.listRunnableAgents(spaces.map((space) => space.id));
        const connectors = spaces.length === 0 || agents.length === 0
          ? []
          : (await repository.listActiveDeploymentConnectors()).filter(
            (connector) => connector.kind === "https_webhook",
          );
        return {
          spaces: spaces.map((space) => ({
            id: space.id,
            name: space.name,
            parentSpaceId: space.parentSpaceId,
          })),
          agents: agents.map((agent) => ({
            identityId: agent.identityId,
            displayName: agent.displayName,
            model: agent.model,
            spaceIds: [...agent.spaceIds],
            limits: agent.limits,
          })),
          connectors: connectors.map((connector) => ({
            id: connector.id,
            name: connector.name,
            kind: "https_webhook" as const,
          })),
        };
      },
    );
  }

  async getPage(request: UiAgentRunPageRequest = {}): Promise<UiAgentRunPage> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const page = await repository.listRuns(
          this.#accountId,
          decodeCursor(request.cursor),
          AGENT_PAGE_SIZE,
        );
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const items: UiAgentRun[] = [];
        for (const run of page.items) {
          const key = run.spaceId ?? "global";
          let snapshot = snapshots.get(key);
          if (!snapshot) {
            snapshot = loadActorAuthorizationSnapshot(
              connection,
              this.#env.GUILD_ID,
              this.#accountId,
              run.spaceId,
            );
            snapshots.set(key, snapshot);
          }
          const resolved = await snapshot;
          authorize(resolved, {
            actorIdentityId: this.#accountId,
            permission: "agent.read",
            resource: runResource(run),
          });
          items.push(runForUi(run, resolved, this.#accountId));
        }

        const runSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "agent.run",
        );
        const readConnectorSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.read",
        );
        const executeSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.execute",
        );
        const readIds = new Set(readConnectorSpaces.map((space) => space.id));
        const executeIds = new Set(executeSpaces.map((space) => space.id));
        const runnableSpaceIds = runSpaces
          .map((space) => space.id)
          .filter((spaceId) => readIds.has(spaceId) && executeIds.has(spaceId));
        const runnableAgents = await repository.listRunnableAgents(runnableSpaceIds);
        const connectors = runnableSpaceIds.length === 0 || runnableAgents.length === 0
          ? []
          : (await repository.listActiveDeploymentConnectors())
            .filter((connector) => connector.kind === "https_webhook")
            .map((connector) => ({
            id: connector.id,
            name: connector.name,
            kind: "https_webhook" as const,
            status: connector.status,
            version: connector.version,
          }));
        return {
          items,
          connectors,
          runnableAgents: runnableAgents.map((agent) => ({
            identityId: agent.identityId,
            displayName: agent.displayName,
            model: agent.model,
            spaceIds: [...agent.spaceIds],
            limits: agent.limits,
          })),
          runnableSpaceIds,
          nextCursor: encodeCursor(page.nextCursor),
        };
      },
    );
  }

  async getRun(runId: string): Promise<UiAgentRunDetail> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const run = await new GuildAgentRunRepository(
          connection,
          this.#env.GUILD_ID,
        ).getRunDetail(runId);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.read",
          resource: runResource(run),
        });
        return { ...runForUi(run, snapshot, this.#accountId), votes: run.votes };
      },
    );
  }

  createRun(input: CreateAgentWebhookRunRequest): Promise<string> {
    return this.#createRun(input, "guild-ui");
  }

  stageCloudflareOsRun(input: CreateAgentWebhookRunRequest): Promise<string> {
    return this.#createRun(input, "cloudflare-os");
  }

  async createGovernedRun(input: CreateGovernedAgentRunInput): Promise<string> {
    assertUuid(input.requestId, "Agent request ID");
    assertUuid(input.agentIdentityId, "Agent Identity ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Agent run Space ID");
    if (input.workflowDefinitionId !== null) {
      assertUuid(input.workflowDefinitionId, "Workflow definition ID");
    }
    assertVisibilityAndClassification(input);
    assertAgentRunPlan(input.plan);
    const policy = actionPolicy(input.plan.action.kind);
    if (!(policy.riskLevels as readonly RiskLevel[]).includes(input.riskLevel)) {
      throw new Error("Agent action risk does not match its governed plan.");
    }
    if (policy.external !== (input.plan.connectorId !== null)) {
      throw new Error(policy.external
        ? "External Agent actions require a Connection."
        : "Internal Agent actions cannot inherit a Connection.");
    }
    if (input.plan.connectorId !== null) assertUuid(input.plan.connectorId, "Connection ID");
    if (input.plan.questId !== null) assertUuid(input.plan.questId, "Quest ID");
    if (new Set(input.workflowPermissions).size !== input.workflowPermissions.length ||
        !policy.permissions.every((permission) => input.workflowPermissions.includes(permission))) {
      throw new Error("Workflow permissions do not authorize the planned Agent action.");
    }
    const hash = await governedRequestHash(input);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const connector = input.plan.connectorId === null
          ? null
          : await repository.getConnector(input.plan.connectorId);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.agentIdentityId,
          this.#accountId,
          input.spaceId,
        );
        const workflowPermissionSet = new Set(input.workflowPermissions);
        const connectorPermissions = new Set(
          connector?.capabilityPermissions ?? policy.permissions,
        );
        const limits = currentAgentLimitsForAction(
          snapshot,
          input.agentIdentityId,
          input.plan.action.kind,
        );
        assertUsageWithinLimits(limits, input.plan.estimatedUsage);
        const requirement = approvalRequirement(snapshot.constitution, input.riskLevel);
        const approvalRequired = requirement.approvals > 0;
        if (connector !== null) {
          if (connector.status !== "active") throw new Error("Agent action Connection is not active.");
          if (connector.writeRiskLevel !== input.riskLevel) {
            throw new Error("Agent action risk must match the immutable Connection policy.");
          }
        }
        const now = new Date().toISOString();
        const run: AgentRun = {
          id: input.requestId,
          guildId: this.#env.GUILD_ID,
          spaceId: input.spaceId,
          ownerIdentityId: this.#accountId,
          visibility: input.visibility,
          classification: input.classification,
          allowedIdentityIds: input.allowedIdentityIds,
          agentIdentityId: input.agentIdentityId,
          requesterIdentityId: this.#accountId,
          connectorId: input.plan.connectorId,
          questId: input.plan.questId,
          riskLevel: input.riskLevel,
          status: approvalRequired ? "awaiting_approval" : "planning",
          source: "guild-ui",
          plan: input.plan,
          result: null,
          errorMessage: null,
          limits,
          usage: ZERO_USAGE,
          workflowInstanceId: `agent-run-${input.requestId}`,
          idempotencyKey: `agent-action:${this.#accountId}:${input.requestId}`,
          requestHash: hash,
          estimatedBudgetMinor: input.plan.estimatedUsage.budgetMinor,
          killRequestedAt: null,
          startedAt: null,
          finishedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        authorizeActionIntersection(
          snapshot,
          run,
          workflowPermissionSet,
          connectorPermissions,
        );
        if (connector !== null) {
          const connectorResource: SecuredResource = {
            id: connector.id,
            guildId: connector.guildId,
            spaceId: connector.spaceId,
            ownerIdentityId: connector.ownerIdentityId,
            visibility: connector.visibility,
            classification: connector.classification,
            allowedIdentityIds: connector.allowedIdentityIds,
          };
          for (const permission of policy.permissions) {
            authorizeAgent(snapshot, {
              agentIdentityId: input.agentIdentityId,
              requesterIdentityId: this.#accountId,
              permission,
              workflowPermissions: workflowPermissionSet,
              connectorPermissions,
              resource: connectorResource,
            });
          }
        }
        await this.#assertQuestBoundary(connection, snapshot, run);
        await repository.createRun({
          run,
          approval: approvalRequired
            ? approvalForAction(
              this.#env.GUILD_ID,
              run.id,
              snapshot,
              input.riskLevel,
              input.plan.action.kind,
            )
            : null,
          workflowPermissions: input.workflowPermissions,
          workflowDefinitionId: input.workflowDefinitionId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.planned",
            "agent_run",
            run.id,
            {
              actionKind: policy.actionKind,
              riskLevel: input.riskLevel,
              origin: input.origin,
            },
            runResource(run),
          ),
        });
      },
    );
    return input.requestId;
  }

  async approveStagedCloudflareOsRun(runId: string): Promise<void> {
    assertUuid(runId, "Agent run ID");
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const staged = await repository.getRun(runId, true);
        if (staged.source !== "cloudflare-os" ||
            staged.requesterIdentityId !== this.#accountId) {
          throw new Error("Cloudflare OS action does not belong to this Guild session.");
        }
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          staged.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.run",
          resource: runResource(staged),
        });
        const opened = await repository.openStagedApproval(
          runId,
          approvalForAction(this.#env.GUILD_ID, runId, snapshot, 2, "https_webhook"),
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.overseer_approved",
            "agent_run",
            runId,
            { source: "cloudflare-os" },
            runResource(staged),
          ),
        );
        if (opened.approval && opened.approval.status === "pending" &&
            isAuthorized(snapshot, {
              actorIdentityId: this.#accountId,
              permission: "agent.approve",
              resource: runResource(opened),
            })) {
          await repository.review({
            runId,
            approvalRequestId: opened.approval.id,
            approverIdentityId: this.#accountId,
            verdict: "approve",
            reason: "Approved through the Cloudflare OS action queue.",
            reauthenticatedAt: null,
            chronicleEvent: makeChronicleEvent(
              this.#env.GUILD_ID,
              this.#accountId,
              "agent.run.approved",
              "agent_run",
              runId,
              { source: "cloudflare-os" },
              runResource(opened),
            ),
          });
        }
      },
    );
  }

  async rejectStagedCloudflareOsRun(runId: string, reason = "rejected"): Promise<void> {
    assertUuid(runId, "Agent run ID");
    assertNonBlank(reason, "Agent rejection reason", 500);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId, true);
        if (run.source !== "cloudflare-os" || run.requesterIdentityId !== this.#accountId) {
          throw new Error("Cloudflare OS action does not belong to this Guild session.");
        }
        await repository.rejectStagedRun(
          runId,
          this.#accountId,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.overseer_rejected",
            "agent_run",
            runId,
            { reason, source: "cloudflare-os" },
            runResource(run),
          ),
        );
      },
    );
  }

  async review(input: ReviewAgentRunRequest): Promise<void> {
    assertUuid(input.runId, "Agent run ID");
    assertUuid(input.approvalRequestId, "Agent approval request ID");
    assertNonBlank(input.reason, "Agent approval reason", 5_000);
    if (!["approve", "reject"].includes(input.verdict)) {
      throw new Error("Agent approval verdict is invalid.");
    }
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(input.runId, true);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.approve",
          resource: runResource(run),
        });
        await repository.review({
          runId: input.runId,
          approvalRequestId: input.approvalRequestId,
          verdict: input.verdict,
          reason: input.reason,
          reauthenticatedAt: this.#verifiedAuthenticatedAt,
          approverIdentityId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            input.verdict === "approve" ? "agent.run.approved" : "agent.run.rejected",
            "agent_run",
            input.runId,
            { source: "guild-ui" },
            runResource(run),
          ),
        });
      },
    );
  }

  async kill(runId: string): Promise<void> {
    assertUuid(runId, "Agent run ID");
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId, true);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.stop",
          resource: runResource(run),
        });
        await repository.killRun(
          runId,
          this.#accountId,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.killed",
            "agent_run",
            runId,
            { source: "guild-ui" },
            runResource(run),
          ),
        );
      },
    );
  }

  async claimExecution(runId: string, workflowInstanceId: string): Promise<AgentExecutionClaim> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        if (run.workflowInstanceId !== workflowInstanceId) {
          throw new Error("Workflow instance does not own this Agent run.");
        }
        if (run.connectorId === null || run.plan.action.kind !== "https_webhook") {
          throw new Error("This execution path requires an HTTPS Webhook action.");
        }
        const connector = await repository.getConnector(run.connectorId);
        assertDeploymentConnector(this.#env, connector);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          run.agentIdentityId,
          run.requesterIdentityId,
          run.spaceId,
        );
        const currentConnectorPermissions = new Set(connector.capabilityPermissions.filter(
          (permission) => run.connectorPermissionsSnapshot.includes(permission),
        ));
        const effectiveLimits = authorizeExecution(snapshot, run, currentConnectorPermissions);
        if (!run.approval || run.approval.status !== "approved" ||
            new Date(run.approval.expiresAt).valueOf() <= Date.now()) {
          throw new Error("Agent run does not have a current durable Human approval.");
        }
        const claimed = await repository.claimExecution(runId, workflowInstanceId);
        return {
          runId: claimed.id,
          guildId: claimed.guildId,
          agentIdentityId: claimed.agentIdentityId,
          requesterIdentityId: claimed.requesterIdentityId,
          eventType: run.plan.action.eventType,
          payloadJson: JSON.stringify(run.plan.action.payload),
          idempotencyKey: claimed.idempotencyKey,
          plannedSteps: claimed.plan.steps.length,
          endpointUrl: connector.endpointUrl!,
          effectiveLimits,
        };
      },
    );
  }

  async completeExecution(
    runId: string,
    workflowInstanceId: string,
    result: AgentRunResult,
    usage: AgentRunUsage,
  ): Promise<"succeeded" | "killed"> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        return repository.completeExecution(
          runId,
          workflowInstanceId,
          result,
          usage,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            run.agentIdentityId,
            "agent.run.succeeded",
            "agent_run",
            runId,
            {
              resultKind: result.kind,
              statusCode: result.kind === "https_webhook" ? result.statusCode : null,
              source: "agent-workflow",
            },
            runResource(run),
          ),
        );
      },
    );
  }

  async failExecution(
    runId: string,
    workflowInstanceId: string,
    errorMessage: string,
    usage: AgentRunUsage,
  ): Promise<void> {
    assertNonBlank(errorMessage, "Agent failure", 2_000);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        await repository.failExecution(
          runId,
          workflowInstanceId,
          errorMessage,
          usage,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            run.agentIdentityId,
            "agent.run.failed",
            "agent_run",
            runId,
            { reason: errorMessage, source: "agent-workflow" },
            runResource(run),
          ),
        );
      },
    );
  }

  async getWorkflowState(runId: string): Promise<AgentWorkflowState> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const run = await new GuildAgentRunRepository(
          connection,
          this.#env.GUILD_ID,
        ).getRun(runId);
        return {
          status: run.status,
          workflowInstanceId: run.workflowInstanceId,
          approvalStatus: run.approval?.status ?? null,
        };
      },
    );
  }

  async #createRun(
    input: CreateAgentWebhookRunRequest,
    source: RunSource,
  ): Promise<string> {
    assertInput(input);
    const hash = await requestHash(input, source);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const connector = await repository.getConnector(input.connectorId);
        assertDeploymentConnector(this.#env, connector);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.agentIdentityId,
          this.#accountId,
          input.spaceId,
        );
        const now = new Date().toISOString();
        const plan = {
          objective: input.objective,
          expectedOutcome: input.expectedOutcome,
          steps: input.steps,
          connectorId: input.connectorId,
          questId: input.questId,
          action: {
            kind: "https_webhook" as const,
            eventType: input.eventType,
            payload: input.payload,
          },
          estimatedUsage: input.estimatedUsage,
        };
        const limits = currentAgentLimits(snapshot, input.agentIdentityId);
        assertUsageWithinLimits(limits, plan.estimatedUsage);
        const run: AgentRun = {
          id: input.requestId,
          guildId: this.#env.GUILD_ID,
          spaceId: input.spaceId,
          ownerIdentityId: this.#accountId,
          visibility: input.visibility,
          classification: input.classification,
          allowedIdentityIds: input.allowedIdentityIds,
          agentIdentityId: input.agentIdentityId,
          requesterIdentityId: this.#accountId,
          connectorId: input.connectorId,
          questId: input.questId,
          riskLevel: 2,
          status: source === "cloudflare-os" ? "planning" : "awaiting_approval",
          source,
          plan,
          result: null,
          errorMessage: null,
          limits,
          usage: {
            budgetMinor: 0,
            tokens: 0,
            durationSeconds: 0,
            steps: 0,
            retries: 0,
            delegationDepth: 0,
          },
          workflowInstanceId: `agent-run-${input.requestId}`,
          idempotencyKey: `agent-action:${this.#accountId}:${input.requestId}`,
          requestHash: hash,
          estimatedBudgetMinor: input.estimatedUsage.budgetMinor,
          killRequestedAt: null,
          startedAt: null,
          finishedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.run",
          resource: runResource(run),
        });
        authorizeAgent(snapshot, {
          agentIdentityId: input.agentIdentityId,
          requesterIdentityId: this.#accountId,
          permission: "integration.execute",
          workflowPermissions: WORKFLOW_PERMISSIONS,
          connectorPermissions: new Set(connector.capabilityPermissions),
          resource: runResource(run),
        });
        await this.#assertQuestBoundary(connection, snapshot, run);
        await repository.createRun({
          run,
          approval: source === "guild-ui"
            ? approvalForAction(
              this.#env.GUILD_ID,
              run.id,
              snapshot,
              2,
              "https_webhook",
            )
            : null,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.planned",
            "agent_run",
            run.id,
            { eventType: input.eventType, riskLevel: 2, source },
            runResource(run),
          ),
        });
      },
    );
    return input.requestId;
  }

  async #assertQuestBoundary(
    connection: GuildTransactionConnection,
    snapshot: AuthorizationSnapshot,
    run: AgentRun,
  ): Promise<void> {
    if (run.questId === null) return;
    const row = (await connection.query<{
      id: string;
      space_id: string | null;
      owner_identity_id: string;
      visibility: AgentRun["visibility"];
      classification: AgentRun["classification"];
      allowed_identity_ids: string[];
      assignee_identity_id: string | null;
      status: string;
    }>(
      `SELECT id::text, space_id::text, owner_identity_id::text, visibility,
              classification, allowed_identity_ids::text[], assignee_identity_id::text, status
         FROM quests WHERE guild_id = $1 AND id = $2`,
      [this.#env.GUILD_ID, run.questId],
    )).rows[0];
    if (!row) throw new Error("Agent Quest was not found in this Guild.");
    if (row.space_id !== run.spaceId || row.assignee_identity_id !== run.agentIdentityId ||
        ["completed", "cancelled"].includes(row.status)) {
      throw new Error("Agent Quest must be active, in the same Space, and assigned to this Agent.");
    }
    const quest: SecuredResource = {
      id: row.id,
      guildId: this.#env.GUILD_ID,
      spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id,
      visibility: row.visibility,
      classification: row.classification,
      allowedIdentityIds: row.allowed_identity_ids,
    };
    authorize(snapshot, {
      actorIdentityId: run.requesterIdentityId,
      permission: "work.read",
      resource: quest,
    });
    authorize(snapshot, {
      actorIdentityId: run.agentIdentityId,
      permission: "work.read",
      resource: quest,
    });
  }
}
