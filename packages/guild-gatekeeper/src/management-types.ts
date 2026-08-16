import type {
  AgentLimits,
  AgentRun,
  AgentRunPlan,
  AgentRunUsage,
  AgentApprovalRequest,
  AgentApprovalVote,
  ActivityDependency,
  ActivityOutcome,
  ActivityStatus,
  ActivityType,
  Announcement,
  AppLocale,
  AutomationRule,
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
  MemoryLayer,
  MemoryReviewSignal,
  Permission,
  Project,
  ProjectStatus,
  Quest,
  QuestStatus,
  RiskLevel,
  Step,
  StepStatus,
  Visibility,
  ChronicleEvent,
  Connector,
  Constitution,
  ContextRelation,
  Conversation,
  ConversationMessageState,
  ConversationStatus,
  ConversationSubjectType,
  ConnectorStatus,
  ContributionCorrectionRequest,
  EmergencyPrivateAccessGrant,
  FederationGrant,
  FederationLink,
  HandoverCase,
  HandoverItem,
  Guild,
  JsonObject,
  OnboardingAssignment,
  OnboardingPath,
  OnboardingRequirement,
  PrivateMessage,
  PrivateThread,
  ModelProvider,
  ModelRoute,
  ResourceCustody,
  RootOwnershipTransfer,
  WorkflowDefinition,
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
  rootOwnershipAccepted: boolean;
  templateKey: CollectiveTemplateKey;
  purpose: string;
  participants: string;
  memoryIntent: string;
  activityIntent: string;
  decisionStyle: string;
  vocabularyOverrides?: Partial<CollectiveTemplateLabels>;
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
  layer: MemoryLayer;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  currentVersion: number;
  confidence: number | null;
  provenance: JsonObject;
  lastVerifiedAt: string | null;
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
  custody: "guild" | "personal";
  layer: MemoryLayer;
  provenance: JsonObject;
  lastVerifiedAt: string | null;
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
  manageDependencies: boolean;
  recordOutcome: boolean;
}

export interface UiActivityDependency {
  id: string;
  activityId: string;
  dependsOnActivityId: string;
  kind: ActivityDependency["kind"];
  version: number;
  createdByActorId: string;
  createdAt: string;
  activity: {
    id: string;
    title: string;
    status: ActivityStatus;
  };
  dependsOnActivity: {
    id: string;
    title: string;
    status: ActivityStatus;
  };
}

export type UiActivityOutcome = Omit<ActivityOutcome, "guildId">;

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
  dependencies: readonly UiActivityDependency[];
  dependents: readonly UiActivityDependency[];
  outcome: UiActivityOutcome | null;
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

export interface AddActivityDependencyRequest {
  activityId: string;
  expectedVersion: number;
  dependsOnActivityId: string;
  kind: ActivityDependency["kind"];
}

export interface RemoveActivityDependencyRequest {
  activityId: string;
  expectedVersion: number;
  dependencyId: string;
  expectedDependencyVersion: number;
}

export interface CompleteActivityRequest {
  activityId: string;
  expectedVersion: number;
  summary: string;
  evidenceSourceIds: readonly string[];
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
  principles: string;
  publicScope: string;
  membershipPolicy: NonNullable<Constitution["membershipPolicy"]>;
  dataPolicy: NonNullable<Constitution["dataPolicy"]>;
  agentPolicy: NonNullable<Constitution["agentPolicy"]>;
  externalSharingPolicy: NonNullable<Constitution["externalSharingPolicy"]>;
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
  resourceType: "memory" | "actor" | "decision";
  resourceId: string;
  memoryId: string | null;
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

export interface CreateIntentPlanRequest {
  requestId: string;
  question: string;
  objective: string;
  locale: AppLocale;
  spaceId: string | null;
}

export type UiIntentProposalStatus =
  | "ready"
  | "executing"
  | "completed"
  | "rejected"
  | "failed"
  | "expired";

export type UiIntentActionStatus =
  | "pending"
  | "processing"
  | "staged"
  | "succeeded"
  | "failed"
  | "cancelled";

export type UiIntentActionKind =
  | "memory.propose"
  | "activity.create"
  | "activity.assign"
  | "decision.propose"
  | "agent.run";

export interface UiIntentEvidence {
  sourceType: string;
  sourceId: string;
  label: string;
  metadata: JsonObject;
}

export interface UiIntentAction {
  position: number;
  kind: UiIntentActionKind;
  riskLevel: RiskLevel;
  status: UiIntentActionStatus;
  attemptCount: number;
  requiredPermission: Permission;
  explicitConfirmationRequired: true;
  durableHumanApprovals: number;
  reauthenticationRequired: boolean;
  resourceType: "memory" | "activity" | "decision" | "agent_run";
  resourceId: string;
  resourceLabel: string;
  agentActorId: string | null;
  agentName: string | null;
  result: JsonObject | null;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface UiIntentProposal {
  id: string;
  objective: string;
  locale: AppLocale;
  spaceId: string | null;
  status: UiIntentProposalStatus;
  maximumRiskLevel: RiskLevel;
  evidence: readonly UiIntentEvidence[];
  actions: readonly UiIntentAction[];
  nextActionPosition: number | null;
  canAct: boolean;
  expiresAt: string;
  completedAt: string | null;
  errorSummary: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntentPlanResponse {
  created: boolean;
  source: "model" | "deterministic_fallback" | "existing";
  proposal: UiIntentProposal;
}

export interface ActIntentRequest {
  proposalId: string;
  confirmation: true;
}

export interface ActIntentResponse {
  outcome:
    | "busy"
    | "expired"
    | "completed"
    | "failed"
    | "retry_scheduled"
    | "action_succeeded"
    | "agent_staged"
    | "agent_waiting";
  position: number | null;
  errorCode: string | null;
  proposal: UiIntentProposal;
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
}

export interface UiActorReference {
  id: string;
  displayName: string;
  kind: IdentityKind;
  membershipState: MembershipState;
}

export interface UiPrivateThread extends Omit<PrivateThread, "guildId"> {
  participantActorIds: readonly string[];
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface UiPrivateThreadDetail {
  thread: UiPrivateThread;
  messages: readonly Omit<PrivateMessage, "guildId">[];
  emergencyGrant: Omit<EmergencyPrivateAccessGrant, "guildId"> | null;
  promotions: readonly UiPrivateMessagePromotion[];
  promotionKinds: readonly PrivateMessagePromotionKind[];
}

export type PrivateMessagePromotionKind = "memory" | "activity" | "decision" | "handover";

export interface UiPrivateMessagePromotion {
  id: string;
  threadId: string;
  sourceMessageId: string;
  promotedByActorId: string;
  selectionStart: number;
  selectionLength: number;
  sourceSha256: string;
  destinationKind: PrivateMessagePromotionKind;
  destinationDraftId: string;
  chronicleEventId: string;
  createdAt: string;
}

interface PrivateMessagePromotionBoundary {
  spaceId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
}

export type PrivateMessagePromotionDestination =
  | (PrivateMessagePromotionBoundary & {
    kind: "memory";
    locale: AppLocale;
    memoryType: MemoryType;
    title: string;
    summary: string;
  })
  | (PrivateMessagePromotionBoundary & {
    kind: "activity";
    activityType: ActivityType;
    title: string;
    assigneeActorId: string | null;
  })
  | (PrivateMessagePromotionBoundary & {
    kind: "decision";
    method: DecisionMethod;
    title: string;
    rationale: string;
  })
  | {
    kind: "handover";
    departingActorId: string;
    successorActorId: string | null;
  };

export interface PromotePrivateMessageRequest {
  threadId: string;
  sourceMessageId: string;
  selectionStart: number;
  selectionLength: number;
  idempotencyKey: string;
  destination: PrivateMessagePromotionDestination;
}

export interface UiPrivatePage {
  threads: readonly UiPrivateThread[];
  eligibleActors: readonly UiActorReference[];
  availableSpaces: readonly Pick<UiDirectorySpace, "id" | "name">[];
  emergencyCandidates: readonly {
    id: string;
    classification: Classification;
    createdAt: string;
  }[];
  canCreate: boolean;
  canCreateGuildWide: boolean;
  canUseEmergencyAccess: boolean;
}

export interface CreatePrivateThreadRequest {
  participantActorIds: readonly string[];
  spaceId: string | null;
  subject: string;
  classification: Classification;
  body: string;
}

export interface PostPrivateMessageRequest {
  threadId: string;
  body: string;
}

export interface BeginEmergencyPrivateAccessRequest {
  threadId: string;
  reason: string;
  intendedAccess: string;
  durationMinutes: number;
  confirmation: string;
}

export interface CloseEmergencyPrivateAccessRequest {
  grantId: string;
  viewedInformation: string;
  changesMade: string;
}

export interface UiOnboardingPath extends Omit<OnboardingPath, "guildId"> {
  requirements: readonly Omit<OnboardingRequirement, "guildId">[];
}

export interface UiOnboardingAssignment extends Omit<OnboardingAssignment, "guildId"> {
  actorDisplayName: string;
  pathName: string;
  completedRequirementCount: number;
  totalRequirementCount: number;
}

export interface UiOnboardingAssignmentDetail {
  assignment: Omit<OnboardingAssignment, "guildId">;
  path: Omit<OnboardingPath, "guildId">;
  requirements: readonly (Omit<OnboardingRequirement, "guildId"> & {
    completedAt: string | null;
    evidence: string;
  })[];
}

export interface UiHandover extends Omit<HandoverCase, "guildId"> {
  items: readonly Omit<HandoverItem, "guildId">[];
}

export interface UiLifecyclePage {
  paths: readonly UiOnboardingPath[];
  assignments: readonly UiOnboardingAssignment[];
  myAssignments: readonly UiOnboardingAssignmentDetail[];
  handovers: readonly UiHandover[];
  preboardingActors: readonly UiActorReference[];
  successorActors: readonly UiActorReference[];
  canManage: boolean;
}

export interface CreateOnboardingPathRequest {
  name: string;
  description: string;
  spaceId: string | null;
  roleIds: readonly string[];
  requirements: readonly {
    kind: OnboardingRequirement["kind"];
    resourceId: string | null;
    title: string;
    instructions: string;
    required: boolean;
  }[];
}

export interface AssignOnboardingRequest {
  actorId: string;
  pathId: string;
  dueAt: string | null;
}

export interface CompleteOnboardingRequirementRequest {
  assignmentId: string;
  requirementId: string;
  evidence: string;
}

export interface OffboardActorRequest {
  actorId: string;
  successorActorId: string | null;
  reason: string;
}

export interface CompleteHandoverItemRequest {
  caseId: string;
  itemId: string;
  disposition: HandoverItem["disposition"];
  note: string;
}

export interface UiContributionFacet {
  facet: "knowledge" | "activity" | "decision" | "support" | "agent_supervision" | "governance";
  count: number;
}

export interface UiContributionEvidence {
  eventId: string;
  sequence: string;
  action: string;
  subjectType: string;
  subjectId: string;
  occurredAt: string;
  facet: UiContributionFacet["facet"];
}

export interface UiContributionProfile {
  actorId: string;
  actorDisplayName: string;
  facets: readonly UiContributionFacet[];
  evidence: readonly UiContributionEvidence[];
  corrections: readonly Omit<ContributionCorrectionRequest, "guildId">[];
  pendingCorrections: readonly UiGovernedContributionCorrection[];
  canRequestCorrection: boolean;
}

export interface UiGovernedContributionCorrection {
  id: string;
  subjectActorId: string;
  requestedByActorId: string;
  evidenceEventId: string;
  evidenceSha256: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  reviewedByActorId: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  version: number;
  requestChronicleEventId: string;
  resolutionChronicleEventId: string | null;
  createdAt: string;
}

export interface RequestContributionCorrectionInput {
  chronicleEventId: string;
  reason: string;
}

export interface ReviewContributionCorrectionRequest {
  requestId: string;
  expectedVersion: number;
  outcome: "accepted" | "rejected";
  reason: string;
}

export interface UiContextRelation extends Omit<ContextRelation, "guildId"> {}

export interface UiContextNode {
  type: string;
  id: string;
  label: string;
}

export interface UiContextPage {
  relations: readonly UiContextRelation[];
  nodes: readonly UiContextNode[];
  reviewSignals: readonly Omit<MemoryReviewSignal, "guildId">[];
  personalCustody: readonly Omit<ResourceCustody, "guildId">[];
  custodyCounts: Readonly<Record<ResourceCustody["custody"], number>> | null;
  canManageRelations: boolean;
  canReviewMemory: boolean;
}

export interface CreateContextRelationRequest {
  fromType: string;
  fromId: string;
  relationType: string;
  toType: string;
  toId: string;
  rationale: string;
}

export interface RevokeContextRelationRequest {
  relationId: string;
  expectedVersion: number;
}

export interface ResolveMemoryReviewSignalRequest {
  signalId: string;
  expectedVersion: number;
  status: "resolved" | "dismissed";
  resolution: string;
}

export interface SharePersonalDataRequest {
  resourceType: ResourceCustody["resourceType"];
  resourceId: string;
  expectedVersion: number;
}

export interface UiConnection extends Omit<Connector, "guildId" | "secretReference"> {
  secretConfigured: boolean;
}

export interface UiConnectionHealthResult {
  readonly status: "healthy" | "unhealthy";
  readonly code: string;
  readonly message: string;
  readonly checkedAt: string;
}

export interface UiDiscoveredConnectionCapability {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>> | null;
  readonly source: "mcp_tool" | "gatekeeper_action" | "webhook" | "service_action";
}

export interface UiConnectionDiscoveryResult {
  readonly capabilities: readonly UiDiscoveredConnectionCapability[];
  readonly oauth: {
    readonly issuer: string;
    readonly authorizationEndpoint: string;
    readonly tokenEndpoint: string;
    readonly jwksUri: string | null;
    readonly registrationEndpoint: string | null;
    readonly revocationEndpoint: string | null;
    readonly introspectionEndpoint: string | null;
    readonly scopesSupported: readonly string[];
    readonly responseTypesSupported: readonly string[];
    readonly grantTypesSupported: readonly string[];
    readonly codeChallengeMethodsSupported: readonly string[];
  } | null;
}

export type UiWorkflowDefinition = Omit<WorkflowDefinition, "guildId">;
export type UiAutomationRule = Omit<AutomationRule, "guildId">;

export interface UiFederationLink extends Omit<FederationLink, "guildId" | "secretReference"> {
  secretConfigured: boolean;
}

export type UiFederationGrant = Omit<FederationGrant, "guildId">;

export interface UiModelProvider extends Omit<ModelProvider, "guildId" | "secretReference"> {
  secretConfigured: boolean;
}

export type UiModelRoute = Omit<ModelRoute, "guildId">;

export interface UiWorkflowRunRequest {
  id: string;
  workflowId: string;
  automationRuleId: string | null;
  requestedByActorId: string;
  agentActorId: string;
  triggerKind: "schedule" | "event" | "manual" | "delegation";
  triggerEventId: string | null;
  input: JsonObject;
  status: "queued" | "planning" | "running" | "succeeded" | "failed" | "cancelled";
  output: JsonObject | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiGuildExportInventory {
  guild: Pick<Guild, "id" | "name" | "purpose" | "createdAt">;
  generatedAt: string;
  totalRows: string;
  tables: readonly { tableName: string; rowCount: string }[];
  files: readonly {
    id: string;
    r2Key: string;
    sha256: string;
    mediaType: string;
    byteSize: string;
    createdAt: string;
  }[];
  schemaMigrations: readonly { name: string; checksum: string; appliedAt: string }[];
}

export interface UiDataExportJob {
  id: string;
  requestedCategories: readonly string[];
  includeRequesterPersonal: boolean;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  sha256: string | null;
  byteCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  completedAt: string | null;
  expiresAt: string | null;
  errorSummary: string | null;
  version: number;
  createdAt: string;
}

export type UiRetentionCategory =
  | "memories"
  | "activities"
  | "decisions"
  | "conversations"
  | "files"
  | "agent_runs"
  | "chronicle";

export type UiRetentionActionKind = "retain" | "archive" | "purge";

export interface UiRetentionAction {
  readonly category: UiRetentionCategory;
  readonly action: UiRetentionActionKind;
  readonly status: "pending" | "processing" | "completed" | "failed";
  readonly candidateCount: number;
  readonly affectedCount: number;
  readonly errorSummary: string | null;
}

export interface UiRetentionRun {
  readonly id: string;
  readonly dryRun: boolean;
  readonly policyVersion: number;
  readonly cutoffAt: string;
  readonly status: "queued" | "processing" | "completed" | "failed";
  readonly irreversibleAuthorizationRecorded: boolean;
  readonly resultSummary: Readonly<Record<string, unknown>> | null;
  readonly errorSummary: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly actions: readonly UiRetentionAction[];
}

export interface PlanRetentionRequest {
  readonly dryRun: boolean;
  readonly cutoffAt: string;
  readonly actions: readonly {
    readonly category: UiRetentionCategory;
    readonly action: UiRetentionActionKind;
  }[];
  readonly previewRunId: string | null;
  readonly confirmation: string;
  readonly idempotencyKey: string;
}

export interface UiOperationsPage {
  connections: readonly UiConnection[];
  workflows: readonly UiWorkflowDefinition[];
  automationRules: readonly UiAutomationRule[];
  workflowRuns: readonly UiWorkflowRunRequest[];
  federationLinks: readonly UiFederationLink[];
  federationGrants: readonly UiFederationGrant[];
  modelProviders: readonly UiModelProvider[];
  modelRoutes: readonly UiModelRoute[];
  exportInventory: UiGuildExportInventory | null;
  dataExports: readonly UiDataExportJob[];
  retentionRuns: readonly UiRetentionRun[];
  dataRetentionDays: number;
  constitutionVersion: number;
  agents: readonly UiActorReference[];
  capabilities: {
    readConnections: boolean;
    manageConnections: boolean;
    readAutomation: boolean;
    manageAutomation: boolean;
    readFederation: boolean;
    manageFederation: boolean;
    readData: boolean;
    manageData: boolean;
    applyRetention: boolean;
  };
}

export interface CreateConnectionRequest {
  spaceId: string | null;
  name: string;
  kind: Connector["kind"];
  capabilityPermissions: readonly Permission[];
  endpointUrl: string | null;
  secretReference: string | null;
  visibility: Visibility;
  classification: Classification;
  description: string;
  provider: string;
  configuration: JsonObject;
  authKind: NonNullable<Connector["authKind"]>;
  writeRiskLevel: NonNullable<Connector["writeRiskLevel"]>;
}

export interface CreateWorkflowRequest {
  spaceId: string | null;
  name: string;
  description: string;
  nodes: readonly JsonObject[];
  edges: readonly JsonObject[];
  allowedActionKinds: readonly AgentRunPlan["action"]["kind"][];
  capabilityPermissions: readonly Permission[];
  visibility: Visibility;
  classification: Classification;
  maxConcurrentRuns: number;
}

export interface SetVersionedStatusRequest<TStatus extends string> {
  id: string;
  expectedVersion: number;
  status: TStatus;
}

export interface CreateAutomationRuleRequest {
  workflowId: string;
  agentActorId: string;
  name: string;
  triggerKind: AutomationRule["triggerKind"];
  triggerExpression: string;
  timezone: string;
  inputTemplate: JsonObject;
  nextRunAt: string | null;
}

export interface RunWorkflowRequest {
  workflowId: string;
  agentActorId: string;
  input: JsonObject;
  idempotencyKey: string;
}

export interface CreateFederationLinkRequest {
  remoteGuildId: string;
  remoteName: string;
  endpointUrl: string;
  secretReference: string;
  direction: FederationLink["direction"];
  allowedResourceTypes: readonly FederationGrant["resourceType"][];
}

export interface CreateFederationGrantRequest {
  federationLinkId: string;
  resourceType: FederationGrant["resourceType"];
  resourceId: string;
  permission: FederationGrant["permission"];
}

export interface CreateModelProviderRequest {
  name: string;
  kind: ModelProvider["kind"];
  endpointUrl: string | null;
  secretReference: string | null;
  allowedModels: readonly string[];
}

export interface SetModelRouteRequest {
  purpose: ModelRoute["purpose"];
  providerId: string;
  primaryModel: string;
  fallbackModel: string | null;
  maxTokens: number;
  dailyBudgetMinor: number;
  cacheEnabled: boolean;
  status: ModelRoute["status"];
  expectedVersion: number | null;
}

export interface RequestDataExportRequest {
  includeRequesterPersonal: boolean;
  idempotencyKey: string;
}

export interface RetryDataExportRequest {
  id: string;
  expectedVersion: number;
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
  offboardActor(input: OffboardActorRequest): Promise<UiHandover>;
  getPrivatePage(): Promise<UiPrivatePage>;
  getPrivateThread(threadId: string): Promise<UiPrivateThreadDetail>;
  createPrivateThread(input: CreatePrivateThreadRequest): Promise<string>;
  postPrivateMessage(input: PostPrivateMessageRequest): Promise<void>;
  promotePrivateMessage(input: PromotePrivateMessageRequest): Promise<UiPrivateMessagePromotion>;
  beginEmergencyPrivateAccess(input: BeginEmergencyPrivateAccessRequest): Promise<string>;
  closeEmergencyPrivateAccess(input: CloseEmergencyPrivateAccessRequest): Promise<void>;
  getLifecyclePage(): Promise<UiLifecyclePage>;
  createOnboardingPath(input: CreateOnboardingPathRequest): Promise<string>;
  assignOnboarding(input: AssignOnboardingRequest): Promise<string>;
  completeOnboardingRequirement(input: CompleteOnboardingRequirementRequest): Promise<void>;
  completeHandoverItem(input: CompleteHandoverItemRequest): Promise<void>;
  getContributionProfile(actorId?: string | null): Promise<UiContributionProfile>;
  requestContributionCorrection(input: RequestContributionCorrectionInput): Promise<string>;
  reviewContributionCorrection(
    input: ReviewContributionCorrectionRequest,
  ): Promise<UiGovernedContributionCorrection>;
  getContextPage(): Promise<UiContextPage>;
  createContextRelation(input: CreateContextRelationRequest): Promise<string>;
  revokeContextRelation(input: RevokeContextRelationRequest): Promise<number>;
  resolveMemoryReviewSignal(input: ResolveMemoryReviewSignalRequest): Promise<number>;
  sharePersonalData(input: SharePersonalDataRequest): Promise<void>;
  getOperationsPage(): Promise<UiOperationsPage>;
  createConnection(input: CreateConnectionRequest): Promise<string>;
  checkConnectionHealth(connectionId: string): Promise<UiConnectionHealthResult>;
  discoverConnection(connectionId: string): Promise<UiConnectionDiscoveryResult>;
  revokeConnection(input: SetVersionedStatusRequest<"revoked">): Promise<void>;
  createWorkflow(input: CreateWorkflowRequest): Promise<string>;
  setWorkflowStatus(
    input: SetVersionedStatusRequest<UiWorkflowDefinition["status"]>,
  ): Promise<void>;
  createAutomationRule(input: CreateAutomationRuleRequest): Promise<string>;
  setAutomationRuleStatus(
    input: SetVersionedStatusRequest<UiAutomationRule["status"]>,
  ): Promise<void>;
  runWorkflow(input: RunWorkflowRequest): Promise<string>;
  createFederationLink(input: CreateFederationLinkRequest): Promise<string>;
  activateFederationLink(input: SetVersionedStatusRequest<"active">): Promise<void>;
  revokeFederationLink(input: SetVersionedStatusRequest<"revoked">): Promise<void>;
  createFederationGrant(input: CreateFederationGrantRequest): Promise<string>;
  revokeFederationGrant(input: SetVersionedStatusRequest<"revoked">): Promise<void>;
  createModelProvider(input: CreateModelProviderRequest): Promise<string>;
  revokeModelProvider(input: SetVersionedStatusRequest<"revoked">): Promise<void>;
  setModelRoute(input: SetModelRouteRequest): Promise<string>;
  requestDataExport(input: RequestDataExportRequest): Promise<string>;
  retryDataExport(input: RetryDataExportRequest): Promise<void>;
  downloadDataExport(id: string): Promise<Blob>;
  planRetention(input: PlanRetentionRequest): Promise<string>;
  getMemoryPage(request?: UiMemoryPageRequest): Promise<UiMemoryPage>;
  createMemory(input: CreateMemoryRequest): Promise<string>;
  saveMemory(input: SaveMemoryRequest): Promise<number>;
  archiveMemory(input: ArchiveMemoryRequest): Promise<number>;
  getActivityPage(request?: UiActivityPageRequest): Promise<UiActivityPage>;
  createActivity(input: CreateActivityRequest): Promise<string>;
  changeActivityStatus(input: ChangeActivityStatusRequest): Promise<number>;
  assignActivity(input: AssignActivityRequest): Promise<number>;
  addActivityDependency(input: AddActivityDependencyRequest): Promise<number>;
  removeActivityDependency(input: RemoveActivityDependencyRequest): Promise<number>;
  completeActivity(input: CompleteActivityRequest): Promise<number>;
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
  createIntentPlan(input: CreateIntentPlanRequest): Promise<CreateIntentPlanResponse>;
  listIntentProposals(): Promise<readonly UiIntentProposal[]>;
  getIntentProposal(proposalId: string): Promise<UiIntentProposal>;
  actIntent(input: ActIntentRequest): Promise<ActIntentResponse>;
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
