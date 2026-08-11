import type {
  AgentLimits,
  AgentRun,
  AgentRunUsage,
  AgentApprovalRequest,
  AgentApprovalVote,
  Announcement,
  AppLocale,
  Classification,
  Decision,
  DecisionApproval,
  DecisionOption,
  Goal,
  GoalStatus,
  IdentityKind,
  IdentityStatus,
  InboxNotification,
  InboxNotificationKind,
  KnowledgeReviewVerdict,
  KnowledgeState,
  LocalizedText,
  MembershipState,
  Permission,
  Project,
  ProjectStatus,
  Quest,
  QuestStatus,
  Step,
  StepStatus,
  Visibility,
  ChronicleEvent,
  Constitution,
  ConnectorStatus,
  JsonObject,
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
  constitution: UiConstitution;
  agentDefaults: AgentLimits;
}

export type UiConstitution = Omit<Constitution, "guildId">;

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

export interface UpdateConstitutionRequest {
  expectedVersion: number;
  level2ApprovalQuorum: number;
  level3ApprovalQuorum: number;
  dataRetentionDays: number;
  agentDefaults: AgentLimits;
  reason: string;
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

export interface UiWorkCapabilities {
  changeStatus: boolean;
  assign: boolean;
  addChild: boolean;
}

export interface UiGoal extends Omit<Goal, "guildId"> {
  capabilities: UiWorkCapabilities;
}

export interface UiProject extends Omit<Project, "guildId"> {
  capabilities: UiWorkCapabilities;
}

export interface UiQuest extends Omit<Quest, "guildId"> {
  capabilities: UiWorkCapabilities;
}

export interface UiStep extends Omit<Step, "guildId"> {
  capabilities: UiWorkCapabilities;
}

export interface UiWorkPage {
  goals: readonly UiGoal[];
  projects: readonly UiProject[];
  quests: readonly UiQuest[];
  nextGoalCursor: string | null;
  nextProjectCursor: string | null;
  nextQuestCursor: string | null;
  canCreate: boolean;
}

export interface UiWorkPageRequest {
  goalCursor?: string | null;
  projectCursor?: string | null;
  questCursor?: string | null;
  projectId?: string | null;
  assigneeIdentityId?: string | null;
  questStatuses?: readonly QuestStatus[];
}

export interface UiQuestDetail {
  quest: UiQuest;
  steps: readonly UiStep[];
}

export interface WorkResourceInput {
  spaceId: string | null;
  title: string;
  description: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  sourceIds: readonly string[];
}

export interface CreateGoalRequest extends WorkResourceInput {
  targetAt: string | null;
}

export interface CreateProjectRequest extends WorkResourceInput {
  goalId: string;
  dueAt: string | null;
}

export interface CreateQuestRequest extends WorkResourceInput {
  projectId: string;
  assigneeIdentityId: string | null;
  dueAt: string | null;
}

export interface CreateStepRequest {
  questId: string;
  assigneeIdentityId: string | null;
  title: string;
  description: string;
}

export interface WorkStatusRequest {
  kind: "goal" | "project" | "quest" | "step";
  id: string;
  expectedVersion: number;
  status: GoalStatus | ProjectStatus | QuestStatus | StepStatus;
}

export interface WorkAssignmentRequest {
  kind: "quest" | "step";
  id: string;
  expectedVersion: number;
  assigneeIdentityId: string | null;
}

export interface UiDecisionCapabilities {
  edit: boolean;
  propose: boolean;
  review: boolean;
  supersede: boolean;
}

export interface UiDecisionSummary extends Omit<Decision, "guildId"> {
  capabilities: UiDecisionCapabilities;
}

export type UiDecisionOption = Omit<DecisionOption, "guildId" | "decisionId">;
export type UiDecisionApproval = Omit<DecisionApproval, "guildId" | "decisionId">;

export interface UiDecisionDetail {
  decision: UiDecisionSummary;
  options: readonly UiDecisionOption[];
  approvals: readonly UiDecisionApproval[];
}

export interface UiDecisionPage {
  items: readonly UiDecisionSummary[];
  nextCursor: string | null;
  canCreate: boolean;
}

export interface UiDecisionPageRequest {
  cursor?: string | null;
}

export interface DecisionOptionRequest {
  label: string;
  description: string;
}

export interface DecisionResourceRequest {
  spaceId: string | null;
  title: string;
  description: string;
  rationale: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  sourceIds: readonly string[];
  reviewAt: string | null;
  options: readonly DecisionOptionRequest[];
}

export type CreateDecisionRequest = DecisionResourceRequest;

export interface SaveDecisionDraftRequest extends DecisionResourceRequest {
  decisionId: string;
  expectedVersion: number;
}

export interface DecisionTransitionRequest {
  decisionId: string;
  expectedVersion: number;
}

export interface ReviewDecisionRequest extends DecisionTransitionRequest {
  verdict: "approve" | "reject";
  selectedOptionId: string | null;
  reason: string;
}

export interface ReviewDecisionResponse {
  version: number;
  status: "proposed" | "approved" | "rejected";
  approvalCount: number;
}

export interface SupersedeDecisionRequest extends DecisionTransitionRequest {
  replacementDecisionId: string;
}

export interface UiAnnouncementCapabilities {
  edit: boolean;
  publish: boolean;
  archive: boolean;
}

export interface UiAnnouncement extends Omit<Announcement, "guildId"> {
  capabilities: UiAnnouncementCapabilities;
}

export interface UiAnnouncementPage {
  items: readonly UiAnnouncement[];
  nextCursor: string | null;
  manageableSpaceIds: readonly string[];
  canCreateGuildWide: boolean;
}

export interface UiAnnouncementPageRequest {
  cursor?: string | null;
}

export interface AnnouncementResourceRequest {
  spaceId: string | null;
  targetRoleId: string | null;
  title: string;
  body: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  expiresAt: string | null;
}

export type CreateAnnouncementRequest = AnnouncementResourceRequest;

export interface SaveAnnouncementDraftRequest extends AnnouncementResourceRequest {
  announcementId: string;
  expectedVersion: number;
}

export interface AnnouncementTransitionRequest {
  announcementId: string;
  expectedVersion: number;
}

export interface PublishAnnouncementResponse {
  version: number;
  recipientCount: number;
}

export type UiInboxNotification = Omit<InboxNotification, "guildId">;

export interface UiInboxPage {
  items: readonly UiInboxNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface UiInboxPageRequest {
  cursor?: string | null;
  kind?: InboxNotificationKind | null;
  unreadOnly?: boolean;
}

export interface MarkInboxReadRequest {
  notificationId: string;
  read: boolean;
}

export interface UiChronicleEvent extends Omit<ChronicleEvent, "guildId"> {
  sequence: string;
  actorDisplayName: string;
}

export interface UiChroniclePage {
  items: readonly UiChronicleEvent[];
  nextCursor: string | null;
}

export interface UiChroniclePageRequest {
  cursor?: string | null;
  search?: string | null;
  actorIdentityId?: string | null;
  subjectType?: string | null;
  occurredFrom?: string | null;
  occurredTo?: string | null;
}

export interface UiAgentConnector {
  id: string;
  name: string;
  kind: "https_webhook";
  status: ConnectorStatus;
  version: number;
}

export interface UiRunnableAgent {
  identityId: string;
  displayName: string;
  model: string;
  spaceIds: readonly string[];
  limits: AgentLimits;
}

export interface UiAgentRunCapabilities {
  review: boolean;
  stop: boolean;
}

export interface UiAgentRun extends Omit<AgentRun, "guildId"> {
  agentDisplayName: string;
  requesterDisplayName: string;
  connectorName: string;
  approval: AgentApprovalRequest | null;
  capabilities: UiAgentRunCapabilities;
}

export interface UiAgentRunDetail extends UiAgentRun {
  votes: readonly AgentApprovalVote[];
}

export interface UiAgentRunPage {
  items: readonly UiAgentRun[];
  connectors: readonly UiAgentConnector[];
  runnableAgents: readonly UiRunnableAgent[];
  runnableSpaceIds: readonly string[];
  nextCursor: string | null;
}

export interface UiAgentRunPageRequest {
  cursor?: string | null;
}

export interface CreateAgentWebhookRunRequest {
  requestId: string;
  agentIdentityId: string;
  connectorId: string;
  questId: string | null;
  spaceId: string;
  objective: string;
  expectedOutcome: string;
  steps: readonly string[];
  eventType: string;
  payload: JsonObject;
  estimatedUsage: AgentRunUsage;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
}

export interface ReviewAgentRunRequest {
  runId: string;
  approvalRequestId: string;
  verdict: "approve" | "reject";
  reason: string;
  reauthenticatedAt: string | null;
}

export interface GuildUiApi {
  getBootstrap(): Promise<UiBootstrapState>;
  claimInvitation(input: ClaimInvitationInput): Promise<UiBootstrapState>;
  updateConstitution(input: UpdateConstitutionRequest): Promise<UiConstitution>;
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
  getWorkPage(request?: UiWorkPageRequest): Promise<UiWorkPage>;
  getQuestDetail(questId: string): Promise<UiQuestDetail>;
  createGoal(input: CreateGoalRequest): Promise<string>;
  createProject(input: CreateProjectRequest): Promise<string>;
  createQuest(input: CreateQuestRequest): Promise<string>;
  createStep(input: CreateStepRequest): Promise<string>;
  changeWorkStatus(input: WorkStatusRequest): Promise<number>;
  assignWork(input: WorkAssignmentRequest): Promise<number>;
  getDecisionPage(request?: UiDecisionPageRequest): Promise<UiDecisionPage>;
  getDecision(decisionId: string): Promise<UiDecisionDetail>;
  createDecision(input: CreateDecisionRequest): Promise<string>;
  saveDecisionDraft(input: SaveDecisionDraftRequest): Promise<number>;
  proposeDecision(input: DecisionTransitionRequest): Promise<number>;
  reviewDecision(input: ReviewDecisionRequest): Promise<ReviewDecisionResponse>;
  supersedeDecision(input: SupersedeDecisionRequest): Promise<number>;
  getAnnouncementPage(request?: UiAnnouncementPageRequest): Promise<UiAnnouncementPage>;
  getAnnouncement(announcementId: string): Promise<UiAnnouncement>;
  createAnnouncement(input: CreateAnnouncementRequest): Promise<string>;
  saveAnnouncementDraft(input: SaveAnnouncementDraftRequest): Promise<number>;
  publishAnnouncement(input: AnnouncementTransitionRequest): Promise<PublishAnnouncementResponse>;
  archiveAnnouncement(input: AnnouncementTransitionRequest): Promise<number>;
  getInboxPage(request?: UiInboxPageRequest): Promise<UiInboxPage>;
  markInboxRead(input: MarkInboxReadRequest): Promise<string | null>;
  markAllInboxRead(): Promise<number>;
  getChroniclePage(request?: UiChroniclePageRequest): Promise<UiChroniclePage>;
  getAgentRunPage(request?: UiAgentRunPageRequest): Promise<UiAgentRunPage>;
  getAgentRun(runId: string): Promise<UiAgentRunDetail>;
  createAgentWebhookRun(input: CreateAgentWebhookRunRequest): Promise<string>;
  reviewAgentRun(input: ReviewAgentRunRequest): Promise<void>;
  killAgentRun(runId: string): Promise<void>;
  setPreferredLocale(locale: AppLocale): Promise<void>;
}
