import type {
  AgentLimits,
  AppLocale,
  Classification,
  IdentityKind,
  IdentityStatus,
  MembershipState,
  Permission,
} from "@guild-os/domain";

export interface UiBootstrapState {
  guildId: string;
  guildName: string;
  guildPurpose: string;
  accountId: string;
  identityExists: boolean;
  membershipState: MembershipState | null;
  rootOwner: boolean;
  rootOwnerIdentityId: string;
  preferredLocale: AppLocale;
  agentDefaults: AgentLimits;
}

export interface UiDirectoryIdentity {
  id: string;
  kind: IdentityKind;
  displayName: string;
  status: IdentityStatus;
  preferredLocale: AppLocale;
  membershipState: MembershipState;
  clearance: Classification;
  joinedAt: string | null;
  departedAt: string | null;
}

export interface UiDirectoryRole {
  id: string;
  name: string;
  system: boolean;
  permissions: readonly Permission[];
}

export interface UiDirectoryRoleBinding {
  id: string;
  identityId: string;
  roleId: string;
  spaceId: string | null;
}

export interface UiAgentProfile {
  identityId: string;
  instructions: string;
  model: string;
  toolIds: readonly string[];
  limits: AgentLimits;
  status: "active" | "stopped";
}

export interface UiCapabilities {
  manageMemberships: boolean;
  manageRoles: boolean;
  manageSpaces: boolean;
  manageIdentities: boolean;
  manageAgents: boolean;
  stopAgents: boolean;
}

export interface UiDirectorySpace {
  id: string;
  parentSpaceId: string | null;
  name: string;
  status: "active" | "archived";
}

export interface UiInvitation {
  id: string;
  inviteeLabel: string;
  roleId: string;
  spaceId: string | null;
  initialMembershipState: "preboarding" | "active";
  state: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdByIdentityId: string;
  acceptedByIdentityId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface UiDirectory {
  identities: readonly UiDirectoryIdentity[];
  roles: readonly UiDirectoryRole[];
  roleBindings: readonly UiDirectoryRoleBinding[];
  agentProfiles: readonly UiAgentProfile[];
  spaces: readonly UiDirectorySpace[];
  invitations: readonly UiInvitation[];
  capabilities: UiCapabilities;
  grantablePermissions: readonly Permission[];
  nextIdentityCursor: string | null;
  nextInvitationCursor: string | null;
}

export interface UiDirectoryRequest {
  identityCursor?: string | null;
  invitationCursor?: string | null;
  includeIdentities?: boolean;
  includeInvitations?: boolean;
}

export interface IssueInvitationInput {
  inviteeLabel: string;
  roleId: string;
  spaceId: string | null;
  initialMembershipState: "preboarding" | "active";
  expiresInDays: number;
}

export interface IssuedInvitation {
  invitation: UiInvitation;
  token: string;
}

export interface ClaimInvitationInput {
  token: string;
  displayName: string;
  preferredLocale: AppLocale;
}

export interface CreateRoleRequest {
  name: string;
  permissions: readonly Permission[];
}

export interface UpdateRoleRequest extends CreateRoleRequest {
  roleId: string;
}

export interface CreateSpaceRequest {
  name: string;
  parentSpaceId: string;
}

export interface AssignRoleRequest {
  identityId: string;
  roleId: string;
  spaceId: string | null;
}

export interface CreateAgentRequest {
  displayName: string;
  clearance: Classification;
  roleId: string;
  spaceId: string | null;
  instructions: string;
  model: string;
  toolIds: readonly string[];
  limits: AgentLimits;
}

export interface CreateServiceRequest {
  displayName: string;
  clearance: Classification;
  roleId: string;
  spaceId: string | null;
}

export interface GuildUiApi {
  getBootstrap(): Promise<UiBootstrapState>;
  claimInvitation(input: ClaimInvitationInput): Promise<UiBootstrapState>;
  getDirectory(request?: UiDirectoryRequest): Promise<UiDirectory>;
  issueInvitation(input: IssueInvitationInput): Promise<IssuedInvitation>;
  revokeInvitation(invitationId: string): Promise<void>;
  changeMembership(
    identityId: string,
    nextState: "preboarding" | "active" | "suspended" | "departed",
  ): Promise<void>;
  createRole(input: CreateRoleRequest): Promise<string>;
  updateRole(input: UpdateRoleRequest): Promise<void>;
  deleteRole(roleId: string): Promise<void>;
  createSpace(input: CreateSpaceRequest): Promise<string>;
  renameSpace(spaceId: string, name: string): Promise<void>;
  archiveSpace(spaceId: string): Promise<void>;
  assignRole(input: AssignRoleRequest): Promise<void>;
  removeRoleBinding(bindingId: string): Promise<void>;
  createAgent(input: CreateAgentRequest): Promise<string>;
  createService(input: CreateServiceRequest): Promise<string>;
  changeMachineMembership(
    identityId: string,
    nextState: "active" | "suspended" | "departed",
  ): Promise<void>;
  setPreferredLocale(locale: AppLocale): Promise<void>;
}
