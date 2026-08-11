import type {
  CLASSIFICATIONS,
  IDENTITY_KINDS,
  IDENTITY_STATUSES,
  KNOWLEDGE_STATES,
  MEMBERSHIP_STATES,
  PERMISSIONS,
  VISIBILITIES,
} from "./constants.js";

export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type RiskLevel = 0 | 1 | 2 | 3;

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
  title: string;
  summary: string;
  version: number;
  sourceIds: readonly string[];
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
