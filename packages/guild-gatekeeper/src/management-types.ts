import type {
  AgentLimits,
  AgentRun,
  AgentRunUsage,
  AgentApprovalRequest,
  AgentApprovalVote,
  ActivityStatus,
  ActivityType,
  Announcement,
  AppLocale,
  Classification,
  CollectiveOnboardingAnswers,
  CollectiveTemplate,
  CollectiveTemplateKey,
  CollectiveTemplateLabels,
  Decision,
  DecisionApproval,
  DecisionMethod,
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
  MemoryType,
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
  Conversation,
  ConversationMessageState,
  ConversationStatus,
  ConversationSubjectType,
  ConnectorStatus,
  JsonObject,
  RootOwnershipTransfer,
} from "@guild-os/domain";

interface UiBootstrapBase {
  guildId: string;
  guildName: string;
  guildPurpose: string;
  accountId: string;
  preferredLocale: AppLocale;
}

export interface UiInitializationBootstrapState extends UiBootstrapBase {
  screen: "initialize";
  initialized: false;
  canInitialize: boolean;
  identityExists: false;
  membershipState: null;
}

export interface UiAccessBootstrapState extends UiBootstrapBase {
  screen: "access";
  initialized: true;
  canInitialize: false;
  identityExists: boolean;
  membershipState: null | "invited" | "suspended" | "departed";
  breakGlass: UiBreakGlassStatus;
}

export interface UiMemberBootstrapState extends UiBootstrapBase {
  screen: "member";
  initialized: true;
  canInitialize: false;
  identityExists: true;
  membershipState: "preboarding" | "active";
  rootOwner: boolean;
  rootOwnerIdentityId: string;
  rootOwnerDisplayName: string;
  constitution: UiConstitution;
  agentDefaults: AgentLimits;
  rootOwnershipTransfer: UiRootOwnershipTransfer | null;
  breakGlass: UiBreakGlassStatus;
}

export type UiBootstrapState =
  | UiInitializationBootstrapState
  | UiAccessBootstrapState
  | UiMemberBootstrapState;

export interface InitializeGuildRequest {
  displayName: string;
  preferredLocale: AppLocale;
  confirmation: string;
  templateKey: CollectiveTemplateKey;
  purpose: string;
  participants: string;
  memoryIntent: string;
  activityIntent: string;
  decisionStyle: string;
}

export type UiConstitution = Omit<Constitution, "guildId">;

export interface UiRootOwnershipTransfer extends Omit<RootOwnershipTransfer, "guildId"> {
  fromDisplayName: string;
  toDisplayName: string;
  outgoingRoleName: string;
}

export interface UiRootOwnershipCandidate {
  id: string;
  displayName: string;
}

export interface UiBreakGlassStatus {
  available: boolean;
  canRecover: boolean;
  version: number;
  currentCodeSetId: string | null;
  generation: number | null;
  outgoingRoleId: string | null;
  outgoingRoleName: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  remainingCodeCount: number | null;
}

export interface RotateBreakGlassCodesRequest {
  expectedVersion: number;
  outgoingRoleId: string;
  expiresInDays: number;
  reason: string;
  confirmation: string;
}

export interface RotatedBreakGlassCodes {
  status: UiBreakGlassStatus;
  codes: readonly string[];
}

export interface RevokeBreakGlassCodesRequest {
  expectedVersion: number;
  codeSetId: string;
  reason: string;
  confirmation: string;
}

export interface RecoverRootOwnershipRequest {
  code: string;
  displayName: string;
  preferredLocale: AppLocale;
  reason: string;
  confirmation: string;
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

export interface UiCollectiveSpace {
  id: string;
  parentSpaceId: string | null;
  name: string;
  /** Compatibility wire name for the Space's complete Context Profile. */
  vocabularyProfileKey: CollectiveTemplateKey | null;
  labels: CollectiveTemplateLabels;
  canConfigure: boolean;
}

export interface UiCollectiveContext {
  template: CollectiveTemplate;
  templates: readonly CollectiveTemplate[];
  labels: CollectiveTemplateLabels;
  vocabularyOverrides: Partial<CollectiveTemplateLabels>;
  onboardingAnswers: Partial<CollectiveOnboardingAnswers>;
  templateVersion: number;
  spaces: readonly UiCollectiveSpace[];
  canConfigure: boolean;
  canConfigureSpaces: boolean;
}

export interface ConfigureCollectiveRequest {
  templateKey: CollectiveTemplateKey;
  vocabularyOverrides: Partial<CollectiveTemplateLabels>;
  onboardingAnswers: Partial<CollectiveOnboardingAnswers>;
}

export interface SetSpaceVocabularyRequest {
  spaceId: string;
  templateKey: CollectiveTemplateKey | null;
}

export interface UiMemoryCapabilities {
  edit: boolean;
  archive: boolean;
  governed: boolean;
}

export interface UiMemory {
  id: string;
  spaceId: string | null;
  ownerActorId: string;
  createdByActorId: string;
  type: MemoryType;
  status: "active" | "archived";
  workflow: "canonical" | null;
  governanceState: KnowledgeState | null;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  currentVersion: number;
  confidence: number | null;
  sourceIds: readonly string[];
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  createdAt: string;
  updatedAt: string;
  capabilities: UiMemoryCapabilities;
}

export interface UiMemoryPage {
  items: readonly UiMemory[];
  nextCursor: string | null;
  creatableSpaceIds: readonly string[];
}

export interface UiMemoryPageRequest {
  cursor?: string | null;
  type?: MemoryType | null;
  search?: string | null;
  includeArchived?: boolean;
}

export interface CreateMemoryRequest {
  spaceId: string | null;
  type: MemoryType;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  sourceIds: readonly string[];
  confidence: number | null;
  changeNote: string;
}

export interface SaveMemoryRequest {
  memoryId: string;
  expectedVersion: number;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
  changeNote: string;
}

export interface ArchiveMemoryRequest {
  memoryId: string;
  expectedVersion: number;
}

export interface UiActivityCapabilities {
  changeStatus: boolean;
  assign: boolean;
  addChild: boolean;
}

export interface UiActivity {
  id: string;
  parentActivityId: string | null;
  spaceId: string | null;
  ownerActorId: string;
  creatorActorId: string;
  assigneeActorId: string | null;
  type: ActivityType;
  title: string;
  description: string;
  status: ActivityStatus;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  sourceIds: readonly string[];
  startsAt: string | null;
  dueAt: string | null;
  position: number;
  version: number;
  compatibilitySourceType: "goal" | "project" | "quest" | "step" | null;
  createdAt: string;
  updatedAt: string;
  capabilities: UiActivityCapabilities;
}

export interface UiActivityPage {
  items: readonly UiActivity[];
  nextCursor: string | null;
  creatableSpaceIds: readonly string[];
}

export interface UiActivityPageRequest {
  cursor?: string | null;
  parentActivityId?: string | null;
  assigneeActorId?: string | null;
  types?: readonly ActivityType[];
  statuses?: readonly ActivityStatus[];
  search?: string | null;
}

export interface CreateActivityRequest {
  parentActivityId: string | null;
  spaceId: string | null;
  assigneeActorId: string | null;
  type: ActivityType;
  title: string;
  description: string;
  status: ActivityStatus;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  sourceIds: readonly string[];
  startsAt: string | null;
  dueAt: string | null;
  position: number;
}

export interface ChangeActivityStatusRequest {
  activityId: string;
  expectedVersion: number;
  status: ActivityStatus;
}

export interface AssignActivityRequest {
  activityId: string;
  expectedVersion: number;
  assigneeActorId: string | null;
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

export interface ProposeRootOwnershipTransferRequest {
  toIdentityId: string;
  outgoingRoleId: string;
  reason: string;
  confirmation: string;
}

export interface ResolveRootOwnershipTransferRequest {
  transferId: string;
  expectedVersion: number;
  reason: string;
  confirmation: string;
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
  kind?: "service" | "guild";
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
  memoryId: string;
  /** @deprecated Use memoryId. Null for Memory without the Canonical workflow. */
  knowledgeId: string | null;
  governed: boolean;
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
  method?: DecisionMethod;
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

export interface ConversationSubjectRequest {
  subjectType: ConversationSubjectType;
  subjectId: string;
}

export interface UiConversationSubject extends ConversationSubjectRequest {
  spaceId: string | null;
  ownerIdentityId: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  readPermission: Permission;
}

export type UiConversation = Omit<Conversation, "guildId">;

export interface UiConversationMessage {
  id: string;
  conversationId: string;
  authorIdentityId: string;
  authorDisplayName: string;
  body: string | null;
  mentionedIdentityIds: readonly string[];
  state: ConversationMessageState;
  version: number;
  redactedByIdentityId: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  createdAt: string;
}

export interface UiConversationCapabilities {
  post: boolean;
  moderate: boolean;
}

export interface UiConversationThread {
  subject: UiConversationSubject;
  conversation: UiConversation | null;
  messages: readonly UiConversationMessage[];
  nextCursor: string | null;
  capabilities: UiConversationCapabilities;
}

export interface UiConversationThreadRequest extends ConversationSubjectRequest {
  cursor?: string | null;
}

export interface PostConversationMessageRequest extends ConversationSubjectRequest {
  body: string;
  mentionedIdentityIds: readonly string[];
}

export interface PostConversationMessageResponse {
  conversation: UiConversation;
  message: UiConversationMessage;
  opened: boolean;
  notificationCount: number;
}

export interface ModerateConversationRequest extends ConversationSubjectRequest {
  conversationId: string;
  expectedVersion: number;
  nextStatus: ConversationStatus;
  reason: string;
}

export interface RedactConversationMessageRequest extends ConversationSubjectRequest {
  conversationId: string;
  messageId: string;
  expectedVersion: number;
  reason: string;
}

export interface SearchConversationMentionsRequest extends ConversationSubjectRequest {
  search: string;
}

export interface UiConversationMentionCandidate {
  id: string;
  displayName: string;
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
  initializeGuild(input: InitializeGuildRequest): Promise<UiBootstrapState>;
  getCollectiveContext(): Promise<UiCollectiveContext>;
  configureCollective(input: ConfigureCollectiveRequest): Promise<UiCollectiveContext>;
  setSpaceVocabulary(input: SetSpaceVocabularyRequest): Promise<UiCollectiveContext>;
  claimInvitation(input: ClaimInvitationInput): Promise<UiBootstrapState>;
  rotateBreakGlassCodes(
    input: RotateBreakGlassCodesRequest,
  ): Promise<RotatedBreakGlassCodes>;
  revokeBreakGlassCodes(input: RevokeBreakGlassCodesRequest): Promise<UiBreakGlassStatus>;
  recoverRootOwnership(input: RecoverRootOwnershipRequest): Promise<UiBootstrapState>;
  updateConstitution(input: UpdateConstitutionRequest): Promise<UiConstitution>;
  proposeRootOwnershipTransfer(
    input: ProposeRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState>;
  cancelRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState>;
  acceptRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState>;
  searchRootOwnershipCandidates(search: string): Promise<readonly UiRootOwnershipCandidate[]>;
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
  getMemoryPage(request?: UiMemoryPageRequest): Promise<UiMemoryPage>;
  createMemory(input: CreateMemoryRequest): Promise<string>;
  saveMemory(input: SaveMemoryRequest): Promise<number>;
  archiveMemory(input: ArchiveMemoryRequest): Promise<number>;
  getActivityPage(request?: UiActivityPageRequest): Promise<UiActivityPage>;
  createActivity(input: CreateActivityRequest): Promise<string>;
  changeActivityStatus(input: ChangeActivityStatusRequest): Promise<number>;
  assignActivity(input: AssignActivityRequest): Promise<number>;
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
  getConversationThread(request: UiConversationThreadRequest): Promise<UiConversationThread>;
  postConversationMessage(
    input: PostConversationMessageRequest,
  ): Promise<PostConversationMessageResponse>;
  moderateConversation(input: ModerateConversationRequest): Promise<UiConversation>;
  redactConversationMessage(input: RedactConversationMessageRequest): Promise<number>;
  searchConversationMentions(
    input: SearchConversationMentionsRequest,
  ): Promise<readonly UiConversationMentionCandidate[]>;
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
