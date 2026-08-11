import type {
  CLASSIFICATIONS,
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
export type LocalizedText = Partial<Record<AppLocale, string>>;

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

export interface ChronicleEvent {
  id: string;
  guildId: string;
  actorIdentityId: string;
  action: string;
  subjectType: string;
  subjectId: string;
  correlationId: string;
  occurredAt: string;
  details: Readonly<Record<string, string | number | boolean | null>>;
}
