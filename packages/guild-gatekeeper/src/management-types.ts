import type {
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
  spaces: readonly UiDirectorySpace[];
  invitations: readonly UiInvitation[];
  canManageMemberships: boolean;
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
  setPreferredLocale(locale: AppLocale): Promise<void>;
}
