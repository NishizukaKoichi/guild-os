import type {
  AgentLimits,
  AppLocale,
  Classification,
  IdentityKind,
  IdentityStatus,
  KnowledgeReviewVerdict,
  KnowledgeState,
  LocalizedText,
  MembershipState,
  Permission,
  Visibility,
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

export interface UiKnowledgeCapabilities {
  edit: boolean;
  propose: boolean;
  review: boolean;
  startRevision: boolean;
  archive: boolean;
  deprecate: boolean;
  uploadFile: boolean;
  deleteFile: boolean;
}

export interface UiKnowledgeSummary {
  id: string;
  spaceId: string | null;
  ownerIdentityId: string;
  state: KnowledgeState;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  currentVersion: number;
  canonicalVersion: number | null;
  title: LocalizedText;
  summary: LocalizedText;
  sourceIds: readonly string[];
  createdByIdentityId: string;
  reviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: UiKnowledgeCapabilities;
}

export interface UiKnowledgeVersion {
  version: number;
  state: KnowledgeState;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
  createdByIdentityId: string;
  createdAt: string;
}

export interface UiKnowledgeReview {
  id: string;
  version: number;
  reviewerIdentityId: string;
  verdict: KnowledgeReviewVerdict;
  reason: string;
  createdAt: string;
}

export interface UiKnowledgeFile {
  id: string;
  knowledgeVersion: number;
  ownerIdentityId: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  status: "pending" | "ready" | "failed" | "deleted";
  position: number;
  createdAt: string;
}

export interface UiKnowledgeDetail extends UiKnowledgeSummary {
  acknowledged: boolean;
  versions: readonly UiKnowledgeVersion[];
  reviews: readonly UiKnowledgeReview[];
  files: readonly UiKnowledgeFile[];
}

export interface UiKnowledgePage {
  items: readonly UiKnowledgeSummary[];
  nextCursor: string | null;
  canCreate: boolean;
}

export interface UiKnowledgePageRequest {
  cursor?: string | null;
}

export interface KnowledgeContentRequest {
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
}

export interface KnowledgeMetadataRequest {
  spaceId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  reviewDueAt: string | null;
}

export interface CreateKnowledgeRequest extends KnowledgeContentRequest, KnowledgeMetadataRequest {
  changeNote: string;
}

export interface SaveKnowledgeDraftRequest extends KnowledgeContentRequest, KnowledgeMetadataRequest {
  knowledgeId: string;
  expectedVersion: number;
  changeNote: string;
}

export interface KnowledgeTransitionRequest {
  knowledgeId: string;
  expectedVersion: number;
}

export interface ReviewKnowledgeRequest extends KnowledgeTransitionRequest {
  verdict: KnowledgeReviewVerdict;
  reason: string;
}

export interface UploadKnowledgeFileRequest extends KnowledgeTransitionRequest {
  originalName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface AskGuildRequest {
  question: string;
  locale: AppLocale;
}

export interface AskGuildCitation {
  knowledgeId: string;
  version: number;
  title: string;
  summary: string;
  spaceId: string | null;
}

export interface AskGuildResponse {
  answer: string;
  citations: readonly AskGuildCitation[];
  inferred: boolean;
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
  getKnowledgePage(request?: UiKnowledgePageRequest): Promise<UiKnowledgePage>;
  getKnowledge(knowledgeId: string): Promise<UiKnowledgeDetail>;
  createKnowledge(input: CreateKnowledgeRequest): Promise<string>;
  saveKnowledgeDraft(input: SaveKnowledgeDraftRequest): Promise<number>;
  startKnowledgeRevision(input: KnowledgeTransitionRequest): Promise<number>;
  proposeKnowledge(input: KnowledgeTransitionRequest): Promise<void>;
  reviewKnowledge(input: ReviewKnowledgeRequest): Promise<void>;
  archiveKnowledge(input: KnowledgeTransitionRequest): Promise<void>;
  deprecateKnowledge(input: KnowledgeTransitionRequest): Promise<void>;
  acknowledgeKnowledge(input: KnowledgeTransitionRequest): Promise<void>;
  uploadKnowledgeFile(input: UploadKnowledgeFileRequest): Promise<UiKnowledgeFile>;
  downloadKnowledgeFile(fileId: string): Promise<Blob>;
  deleteKnowledgeFile(input: KnowledgeTransitionRequest & { fileId: string }): Promise<void>;
  askGuild(input: AskGuildRequest): Promise<AskGuildResponse>;
  setPreferredLocale(locale: AppLocale): Promise<void>;
}
