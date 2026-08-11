import type {
  ANNOUNCEMENT_STATUSES,
  AGENT_RUN_STATUSES,
  APPROVAL_STATUSES,
  CLASSIFICATIONS,
  CONVERSATION_MESSAGE_STATES,
  CONVERSATION_STATUSES,
  CONVERSATION_SUBJECT_TYPES,
  CONNECTOR_STATUSES,
  DECISION_STATUSES,
  GOAL_STATUSES,
  IDENTITY_KINDS,
  IDENTITY_STATUSES,
  KNOWLEDGE_STATES,
  MEMBERSHIP_STATES,
  PERMISSIONS,
  PROJECT_STATUSES,
  QUEST_STATUSES,
  STEP_STATUSES,
  SUPPORTED_LOCALES,
  VISIBILITIES,
} from "./constants.js";

export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type RiskLevel = 0 | 1 | 2 | 3;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type ConversationMessageState = (typeof CONVERSATION_MESSAGE_STATES)[number];
export type LocalizedText = Partial<Record<AppLocale, string>>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Guild {
  id: string;
  name: string;
  purpose: string;
  rootOwnerIdentityId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Constitution {
  guildId: string;
  version: number;
  level2ApprovalQuorum: number;
  level3ApprovalQuorum: number;
  dataRetentionDays: number;
  agentDefaults: AgentLimits;
  updatedByIdentityId: string;
  updatedAt: string;
}

export interface RootOwnershipTransfer {
  id: string;
  guildId: string;
  fromIdentityId: string;
  toIdentityId: string;
  outgoingRoleId: string;
  state: "pending" | "accepted" | "cancelled" | "expired" | "superseded";
  reason: string;
  version: number;
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BreakGlassConfiguration {
  guildId: string;
  currentCodeSetId: string | null;
  version: number;
  updatedByIdentityId: string;
  updatedAt: string;
}

export interface BreakGlassCodeSet {
  id: string;
  guildId: string;
  generation: number;
  createdByIdentityId: string;
  outgoingRoleId: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
}

export interface BreakGlassRecovery {
  id: string;
  guildId: string;
  codeSetId: string;
  codeId: string;
  previousRootIdentityId: string;
  newRootIdentityId: string;
  outgoingRoleId: string;
  reason: string;
  actorWasExistingIdentity: boolean;
  viewedInformation: string;
  changesMade: string;
  state: "pending" | "completed";
  completedAt: string | null;
  createdAt: string;
}

export interface Space {
  id: string;
  guildId: string;
  parentSpaceId: string | null;
  name: string;
  status: "active" | "archived";
}

export interface Identity {
  id: string;
  guildId: string;
  kind: IdentityKind;
  displayName: string;
  status: IdentityStatus;
}

export interface Membership {
  guildId: string;
  identityId: string;
  state: MembershipState;
  clearance: Classification;
  joinedAt: string | null;
  departedAt: string | null;
}

export interface Role {
  id: string;
  guildId: string;
  name: string;
  permissions: readonly Permission[];
  system: boolean;
}

export interface RoleBinding {
  guildId: string;
  identityId: string;
  roleId: string;
  spaceId: string | null;
}

export interface SecuredResource {
  id: string;
  guildId: string;
  spaceId: string | null;
  ownerIdentityId: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds?: readonly string[];
}

export interface KnowledgeRecord extends SecuredResource {
  state: KnowledgeState;
  title: LocalizedText;
  summary: LocalizedText;
  currentVersion: number;
  canonicalVersion: number | null;
  sourceIds: readonly string[];
}

export interface KnowledgeVersion {
  guildId: string;
  knowledgeId: string;
  version: number;
  state: KnowledgeState;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
  createdByIdentityId: string;
  createdAt: string;
}

export type KnowledgeReviewVerdict = "approve" | "request_changes";

export interface KnowledgeReview {
  id: string;
  guildId: string;
  knowledgeId: string;
  version: number;
  reviewerIdentityId: string;
  verdict: KnowledgeReviewVerdict;
  reason: string;
  createdAt: string;
}

export interface Goal extends SecuredResource {
  title: string;
  description: string;
  status: GoalStatus;
  creatorIdentityId: string;
  sourceIds: readonly string[];
  targetAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends SecuredResource {
  goalId: string;
  title: string;
  description: string;
  status: ProjectStatus;
  creatorIdentityId: string;
  sourceIds: readonly string[];
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Quest extends SecuredResource {
  projectId: string;
  assigneeIdentityId: string | null;
  title: string;
  description: string;
  status: QuestStatus;
  creatorIdentityId: string;
  sourceIds: readonly string[];
  dueAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Step {
  id: string;
  guildId: string;
  questId: string;
  assigneeIdentityId: string | null;
  creatorIdentityId: string;
  title: string;
  description: string;
  status: StepStatus;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Decision extends SecuredResource {
  proposerIdentityId: string;
  title: string;
  description: string;
  rationale: string;
  status: DecisionStatus;
  sourceIds: readonly string[];
  requiredApprovals: number;
  approvalCount: number;
  selectedOptionId: string | null;
  reviewAt: string | null;
  decidedAt: string | null;
  supersededByDecisionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionOption {
  id: string;
  guildId: string;
  decisionId: string;
  label: string;
  description: string;
  position: number;
  selected: boolean;
}

export interface DecisionApproval {
  guildId: string;
  decisionId: string;
  approverIdentityId: string;
  verdict: "approve" | "reject";
  selectedOptionId: string | null;
  reason: string;
  createdAt: string;
}

export interface Announcement extends SecuredResource {
  targetRoleId: string | null;
  creatorIdentityId: string;
  title: string;
  body: string;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends SecuredResource {
  subjectType: ConversationSubjectType;
  subjectId: string;
  status: ConversationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  guildId: string;
  conversationId: string;
  authorIdentityId: string;
  body: string;
  mentionedIdentityIds: readonly string[];
  state: ConversationMessageState;
  version: number;
  redactedByIdentityId: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  createdAt: string;
}

export type InboxNotificationKind =
  | "announcement"
  | "mention"
  | "quest"
  | "approval"
  | "knowledge_update"
  | "agent_question"
  | "system";

export interface InboxNotification extends SecuredResource {
  recipientIdentityId: string;
  kind: InboxNotificationKind;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AgentLimits {
  currency: string;
  maxBudgetMinor: number;
  maxDurationSeconds: number;
  maxSteps: number;
  maxRetries: number;
  maxDelegationDepth: number;
}

export interface AgentProfile {
  identityId: string;
  guildId: string;
  instructions: string;
  model: string;
  toolIds: readonly string[];
  limits: AgentLimits;
  status: "active" | "stopped";
}

export interface AgentRunUsage {
  budgetMinor: number;
  durationSeconds: number;
  steps: number;
  retries: number;
  delegationDepth: number;
}

export interface AgentRunPlan {
  objective: string;
  expectedOutcome: string;
  steps: readonly string[];
  connectorId: string;
  questId: string | null;
  action: {
    kind: "https_webhook";
    eventType: string;
    payload: JsonObject;
  };
  estimatedUsage: AgentRunUsage;
}

export interface AgentRunResult {
  kind: "https_webhook";
  statusCode: number;
  deliveredAt: string;
}

export interface AgentRun extends SecuredResource {
  agentIdentityId: string;
  requesterIdentityId: string;
  connectorId: string;
  questId: string | null;
  riskLevel: RiskLevel;
  status: AgentRunStatus;
  source: "guild-ui" | "cloudflare-os";
  plan: AgentRunPlan;
  result: AgentRunResult | null;
  errorMessage: string | null;
  limits: AgentLimits;
  usage: AgentRunUsage;
  workflowInstanceId: string;
  idempotencyKey: string;
  requestHash: string;
  estimatedBudgetMinor: number;
  killRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentApprovalRequest {
  id: string;
  guildId: string;
  agentRunId: string;
  riskLevel: RiskLevel;
  actionKind: string;
  requiredApprovals: number;
  approvalCount: number;
  reauthenticationRequired: boolean;
  status: ApprovalStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentApprovalVote {
  guildId: string;
  approvalRequestId: string;
  approverIdentityId: string;
  verdict: "approve" | "reject";
  reason: string;
  reauthenticatedAt: string | null;
  createdAt: string;
}

export interface Connector extends SecuredResource {
  name: string;
  kind: "https_webhook";
  status: ConnectorStatus;
  capabilityPermissions: readonly Permission[];
  endpointUrl: string;
  secretReference: string;
  deploymentManaged: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizationSnapshot {
  guild: Guild;
  constitution: Constitution;
  spaces: readonly Space[];
  identities: readonly Identity[];
  memberships: readonly Membership[];
  roles: readonly Role[];
  roleBindings: readonly RoleBinding[];
  agents: readonly AgentProfile[];
}

export interface AuthorizationRequest {
  actorIdentityId: string;
  permission: Permission;
  resource?: SecuredResource;
}

export interface AgentAuthorizationRequest {
  agentIdentityId: string;
  requesterIdentityId: string;
  permission: Permission;
  workflowPermissions: ReadonlySet<Permission>;
  connectorPermissions: ReadonlySet<Permission>;
  resource?: SecuredResource;
}

export interface ApprovalRequirement {
  approvals: number;
  reauthenticationRequired: boolean;
  reason: string;
}

export interface ChronicleEvent extends SecuredResource {
  actorIdentityId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  correlationId: string;
  occurredAt: string;
  details: Readonly<Record<string, string | number | boolean | null>>;
}
