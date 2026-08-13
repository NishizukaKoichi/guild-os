import type {
  ANNOUNCEMENT_STATUSES,
  AGENT_RUN_STATUSES,
  ACTIVITY_STATUSES,
  ACTIVITY_TYPES,
  ACTOR_KINDS,
  ACTOR_MEMBERSHIP_STATES,
  APPROVAL_STATUSES,
  CLASSIFICATIONS,
  CONVERSATION_MESSAGE_STATES,
  CONVERSATION_STATUSES,
  CONVERSATION_SUBJECT_TYPES,
  CONNECTOR_STATUSES,
  CONNECTION_KINDS,
  COLLECTIVE_TEMPLATE_KEYS,
  DATA_CUSTODIES,
  DECISION_METHODS,
  DECISION_STATUSES,
  GOAL_STATUSES,
  IDENTITY_KINDS,
  IDENTITY_STATUSES,
  KNOWLEDGE_STATES,
  MEMORY_STATUSES,
  MEMORY_LAYERS,
  MEMORY_REVIEW_SIGNAL_KINDS,
  MEMORY_REVIEW_SIGNAL_STATUSES,
  MEMORY_TYPES,
  MEMORY_WORKFLOWS,
  MEMBERSHIP_STATES,
  RELATION_STATUSES,
  AUTOMATION_TRIGGER_KINDS,
  FEDERATION_DIRECTIONS,
  PERMISSIONS,
  PROJECT_STATUSES,
  QUEST_STATUSES,
  STEP_STATUSES,
  SUPPORTED_LOCALES,
  VISIBILITIES,
} from "./constants.js";

export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export type ActorKind = (typeof ACTOR_KINDS)[number];
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];
export type ActorMembershipState = (typeof ACTOR_MEMBERSHIP_STATES)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type Capability = Permission;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryType = (typeof MEMORY_TYPES)[number] | `custom:${string}`;
export type MemoryWorkflow = (typeof MEMORY_WORKFLOWS)[number] | null;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];
export type DataCustody = (typeof DATA_CUSTODIES)[number];
export type RelationStatus = (typeof RELATION_STATUSES)[number];
export type MemoryReviewSignalKind = (typeof MEMORY_REVIEW_SIGNAL_KINDS)[number];
export type MemoryReviewSignalStatus = (typeof MEMORY_REVIEW_SIGNAL_STATUSES)[number];
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number];
export type FederationDirection = (typeof FEDERATION_DIRECTIONS)[number];
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number] | `custom:${string}`;
export type CollectiveTemplateKey = (typeof COLLECTIVE_TEMPLATE_KEYS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type RiskLevel = 0 | 1 | 2 | 3;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export type StepStatus = (typeof STEP_STATUSES)[number];
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export type DecisionMethod = (typeof DECISION_METHODS)[number];
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

export interface Actor {
  id: string;
  kind: ActorKind;
  displayName: string;
  status: IdentityStatus;
  preferredLocale: AppLocale;
  createdAt: string;
  updatedAt: string;
}

export interface ActorMembership {
  guildId: string;
  actorId: string;
  state: ActorMembershipState;
  clearance: Classification;
  operational: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  updatedAt: string;
}

export interface ActorRoleBinding {
  id: string;
  guildId: string;
  actorId: string;
  roleId: string;
  spaceId: string | null;
  createdAt: string;
}

export interface HumanProfile {
  actorId: string;
  biography: string;
}

export interface ServiceProfile {
  actorId: string;
  guildId: string;
  serviceType: string;
  description: string;
}

export interface GuildActorProfile {
  actorId: string;
  guildId: string;
  representedGuildId: string | null;
  description: string;
}

export interface Constitution {
  guildId: string;
  version: number;
  level2ApprovalQuorum: number;
  level3ApprovalQuorum: number;
  dataRetentionDays: number;
  agentDefaults: AgentLimits;
  /** Always present in schema 0030+; optional only for serialized pre-0030 fixtures. */
  principles?: string;
  publicScope?: string;
  membershipPolicy?: ConstitutionMembershipPolicy;
  dataPolicy?: ConstitutionDataPolicy;
  agentPolicy?: ConstitutionAgentPolicy;
  externalSharingPolicy?: ConstitutionExternalSharingPolicy;
  updatedByIdentityId: string;
  updatedAt: string;
}

export interface ConstitutionMembershipPolicy {
  preboardingRequired: boolean;
  departureMode: "revoke_then_handover";
}

export interface ConstitutionDataPolicy {
  defaultVisibility: Visibility;
  defaultClassification: Classification;
  personalDataOnDeparture: "retain_by_policy" | "archive" | "delete_after_retention";
  crossGuildSharing: "explicit_only";
}

export interface ConstitutionAgentPolicy {
  level0Automatic: boolean;
  level1Automatic: boolean;
  level2HumanApproval: true;
  level3MultiHumanApproval: true;
}

export interface ConstitutionExternalSharingPolicy {
  enabled: boolean;
  requireHumanApproval: true;
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

export interface ActorSecuredResource {
  id: string;
  guildId: string;
  spaceId: string | null;
  ownerActorId: string;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
}

export interface MemoryRecord extends ActorSecuredResource {
  type: MemoryType;
  status: MemoryStatus;
  workflow: MemoryWorkflow;
  governanceState: KnowledgeState | null;
  layer: MemoryLayer;
  title: LocalizedText;
  summary: LocalizedText;
  currentVersion: number;
  confidence: number | null;
  provenance: JsonObject;
  lastVerifiedAt: string | null;
  sourceIds: readonly string[];
  createdByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryVersion {
  guildId: string;
  memoryId: string;
  version: number;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
  createdByActorId: string;
  createdAt: string;
}

export interface Activity extends ActorSecuredResource {
  parentActivityId: string | null;
  type: ActivityType;
  title: string;
  description: string;
  status: ActivityStatus;
  creatorActorId: string;
  assigneeActorId: string | null;
  sourceIds: readonly string[];
  startsAt: string | null;
  dueAt: string | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDependency {
  id: string;
  guildId: string;
  activityId: string;
  dependsOnActivityId: string;
  kind: "blocks" | "relates_to" | "follows";
  status: "active" | "revoked";
  version: number;
  createdByActorId: string;
  updatedByActorId: string;
  revokedByActorId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityOutcome {
  guildId: string;
  activityId: string;
  version: number;
  activityVersion: number;
  summary: string;
  evidenceSourceIds: readonly string[];
  completedByActorId: string;
  completedAt: string;
}

export interface CollectiveTemplateLabels {
  members: string;
  member: string;
  human: string;
  agent: string;
  service: string;
  guildActor: string;
  memory: string;
  memoryItem: string;
  remember: string;
  activity: string;
  activityItem: string;
  startActivity: string;
  decisions: string;
  decision: string;
  history: string;
  join: string;
  leave: string;
  participant: string;
  coordinator: string;
}

export type VocabularyProfile = CollectiveTemplateLabels;

export interface CollectiveWorkflowPreset {
  key: string;
  name: string;
  activityType: ActivityType | null;
  memoryType: MemoryType | null;
  decisionMethod: DecisionMethod | null;
}

export interface CollectiveTemplateRole {
  name: string;
  capabilities: readonly Capability[];
}

export interface CollectiveTemplate {
  key: CollectiveTemplateKey;
  name: string;
  description: string;
  labels: CollectiveTemplateLabels;
  roles: readonly CollectiveTemplateRole[];
  activityTypes: readonly ActivityType[];
  memoryTypes: readonly MemoryType[];
  decisionMethods: readonly DecisionMethod[];
  dashboardIntents: readonly ("ask" | "remember" | "start" | "review" | "members")[];
  workflows: readonly CollectiveWorkflowPreset[];
  suggestedAgent: string | null;
}

export interface CollectiveOnboardingAnswers {
  purpose: string;
  participants: string;
  memoryIntent: string;
  activityIntent: string;
  decisionStyle: string;
}

export interface CollectiveSettings {
  guildId: string;
  templateKey: CollectiveTemplateKey;
  templateVersion: number;
  vocabularyOverrides: Partial<CollectiveTemplateLabels>;
  onboardingAnswers: Partial<CollectiveOnboardingAnswers>;
  updatedByActorId: string | null;
  updatedAt: string;
}

export interface SpaceVocabularyAssignment {
  spaceId: string;
  vocabularyProfileKey: string | null;
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
  method: DecisionMethod;
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
  maxTokens: number;
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
  /** Always present in schema 0032+; optional only for pre-0032 fixtures. */
  skillIds?: readonly string[];
  limits: AgentLimits;
  status: "active" | "stopped";
}

export interface AgentRunUsage {
  budgetMinor: number;
  tokens: number;
  durationSeconds: number;
  steps: number;
  retries: number;
  delegationDepth: number;
}

export interface AgentRunPlan {
  objective: string;
  expectedOutcome: string;
  steps: readonly string[];
  connectorId: string | null;
  questId: string | null;
  action:
    | { kind: "memory_search"; query: string; locale: AppLocale }
    | { kind: "activity_draft"; title: string; description: string; activityType: ActivityType }
    | { kind: "agent_delegate"; targetAgentActorId: string; objective: string }
    | { kind: "connection_invoke"; capabilityId: string; input: JsonObject }
    | { kind: "https_webhook"; eventType: string; payload: JsonObject }
    | { kind: "federation_publish"; federationLinkId: string; grantIds: readonly string[] };
  estimatedUsage: AgentRunUsage;
}

export type AgentRunResult =
  | { kind: "memory_search"; memoryIds: readonly string[]; completedAt: string }
  | { kind: "activity_draft"; activityId: string; completedAt: string }
  | { kind: "agent_delegate"; childRunId: string; completedAt: string }
  | {
      kind: "connection_invoke";
      capabilityId: string;
      statusCode: number;
      output: JsonValue;
      completedAt: string;
    }
  | { kind: "https_webhook"; statusCode: number; deliveredAt: string }
  | { kind: "federation_publish"; deliveryId: string; completedAt: string };

export interface AgentRun extends SecuredResource {
  agentIdentityId: string;
  requesterIdentityId: string;
  connectorId: string | null;
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
  kind: ConnectionKind;
  status: ConnectorStatus;
  capabilityPermissions: readonly Permission[];
  endpointUrl: string | null;
  secretReference: string | null;
  description?: string;
  provider?: string;
  configuration?: JsonObject;
  authKind?: "none" | "secret_reference" | "oauth" | "service_binding" | "access_token";
  writeRiskLevel?: RiskLevel;
  healthStatus?: "unknown" | "healthy" | "degraded" | "unreachable";
  lastCheckedAt?: string | null;
  deploymentManaged: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContextRelation extends ActorSecuredResource {
  fromType: string;
  fromId: string;
  relationType: string;
  toType: string;
  toId: string;
  status: RelationStatus;
  properties: JsonObject;
  rationale: string;
  createdByActorId: string;
  revokedByActorId: string | null;
  revokedAt: string | null;
  version: number;
  createdAt: string;
}

export interface ResourceCustody {
  guildId: string;
  resourceType: "memory" | "activity" | "decision" | "conversation" | "file" | "agent_run";
  resourceId: string;
  custody: DataCustody;
  personalOwnerActorId: string | null;
  sharedByActorId: string | null;
  sharedAt: string | null;
  retentionUntil: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryReviewSignal {
  id: string;
  guildId: string;
  memoryId: string;
  comparedMemoryId: string | null;
  kind: MemoryReviewSignalKind;
  status: MemoryReviewSignalStatus;
  evidence: string;
  detectedByActorId: string | null;
  resolvedByActorId: string | null;
  resolution: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  version: number;
}

export interface PrivateThread {
  id: string;
  guildId: string;
  spaceId: string | null;
  createdByActorId: string;
  subject: string;
  classification: Classification;
  status: "open" | "closed";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateThreadParticipant {
  guildId: string;
  threadId: string;
  actorId: string;
  state: "active" | "left";
  joinedAt: string;
  leftAt: string | null;
}

export interface PrivateMessage {
  id: string;
  guildId: string;
  threadId: string;
  authorActorId: string;
  body: string;
  state: "active" | "redacted";
  redactedByActorId: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  version: number;
  createdAt: string;
}

export interface EmergencyPrivateAccessGrant {
  id: string;
  guildId: string;
  threadId: string;
  grantedToActorId: string;
  grantedByActorId: string;
  reason: string;
  intendedAccess: string;
  viewedInformation: string;
  changesMade: string;
  status: "active" | "closed" | "expired";
  expiresAt: string;
  closedAt: string | null;
  version: number;
  createdAt: string;
}

export interface OnboardingPath {
  id: string;
  guildId: string;
  spaceId: string | null;
  templateKey: CollectiveTemplateKey | null;
  applicableRoleIds?: readonly string[];
  name: string;
  description: string;
  status: "active" | "archived";
  createdByActorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingRequirement {
  id: string;
  guildId: string;
  pathId: string;
  kind: "memory" | "activity" | "acknowledgement" | "checklist";
  resourceId: string | null;
  title: string;
  instructions: string;
  required: boolean;
  position: number;
  createdAt: string;
}

export interface OnboardingAssignment {
  id: string;
  guildId: string;
  actorId: string;
  pathId: string;
  managerActorId: string;
  status: "assigned" | "in_progress" | "ready" | "completed" | "cancelled";
  dueAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoverCase {
  id: string;
  guildId: string;
  departingActorId: string;
  successorActorId: string | null;
  initiatedByActorId: string;
  reason: string;
  status: "open" | "completed" | "cancelled";
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoverItem {
  id: string;
  guildId: string;
  caseId: string;
  resourceType: "memory" | "activity" | "knowledge" | "file" | "decision" | "connection" | "schedule";
  resourceId: string;
  title: string;
  disposition: "transfer" | "retain" | "archive";
  status: "pending" | "completed" | "failed";
  note: string;
  completedAt: string | null;
  createdAt: string;
}

export interface ContributionCorrectionRequest {
  id: string;
  guildId: string;
  subjectActorId: string;
  requestedByActorId: string;
  chronicleEventId: string;
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

export interface WorkflowDefinition extends ActorSecuredResource {
  name: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  nodes: readonly JsonObject[];
  edges: readonly JsonObject[];
  allowedActionKinds: readonly AgentRunPlan["action"]["kind"][];
  capabilityPermissions: readonly Permission[];
  maxConcurrentRuns: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRule {
  id: string;
  guildId: string;
  workflowId: string;
  agentActorId: string;
  createdByActorId: string;
  name: string;
  triggerKind: AutomationTriggerKind;
  triggerExpression: string;
  timezone: string;
  inputTemplate: JsonObject;
  status: "active" | "paused" | "archived";
  nextRunAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FederationLink {
  id: string;
  guildId: string;
  remoteGuildId: string;
  remoteName: string;
  endpointUrl: string;
  secretReference: string;
  direction: FederationDirection;
  status: "pending" | "active" | "revoked";
  allowedResourceTypes: readonly string[];
  createdByActorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface FederationGrant {
  id: string;
  guildId: string;
  federationLinkId: string;
  resourceType: "memory" | "activity" | "decision" | "agent";
  resourceId: string;
  permission: "read" | "participate";
  status: "active" | "revoked";
  grantedByActorId: string;
  revokedByActorId: string | null;
  revokedAt: string | null;
  version: number;
  createdAt: string;
}

export interface ModelProvider {
  id: string;
  guildId: string;
  name: string;
  kind: "workers_ai" | "cloudflare_ai_gateway" | "openai_compatible";
  endpointUrl: string | null;
  secretReference: string | null;
  allowedModels: readonly string[];
  status: "active" | "disabled" | "revoked";
  deploymentManaged: boolean;
  createdByActorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoute {
  id: string;
  guildId: string;
  purpose: "ask" | "plan" | "act" | "embedding" | "review";
  providerId: string;
  primaryModel: string;
  fallbackModel: string | null;
  maxTokens: number;
  dailyBudgetMinor: number;
  cacheEnabled: boolean;
  status: "active" | "disabled";
  updatedByActorId: string;
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
