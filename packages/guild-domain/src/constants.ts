export const ACTOR_KINDS = ["human", "agent", "service", "guild"] as const;
/** @deprecated Use ACTOR_KINDS. Kept for the v1 compatibility API. */
export const IDENTITY_KINDS = ACTOR_KINDS;
export const IDENTITY_STATUSES = ["active", "disabled"] as const;
export const ACTOR_MEMBERSHIP_STATES = [
  "invited",
  "joined",
  "active",
  "paused",
  "left",
  "blocked",
] as const;
export const MEMBERSHIP_STATES = [
  "invited",
  "preboarding",
  "active",
  "suspended",
  "departed",
] as const;
export const KNOWLEDGE_STATES = [
  "draft",
  "proposed",
  "canonical",
  "deprecated",
  "archived",
] as const;
export const MEMORY_STATUSES = ["active", "archived"] as const;
export const MEMORY_WORKFLOWS = ["canonical"] as const;
export const MEMORY_LAYERS = ["canonical", "working", "external"] as const;
export const DATA_CUSTODIES = ["guild", "personal", "shared"] as const;
export const RELATION_STATUSES = ["active", "revoked"] as const;
export const MEMORY_REVIEW_SIGNAL_KINDS = [
  "stale",
  "possible_contradiction",
  "missing_source",
  "low_confidence",
] as const;
export const MEMORY_REVIEW_SIGNAL_STATUSES = ["open", "resolved", "dismissed"] as const;
export const CONNECTION_KINDS = [
  "https_webhook",
  "mcp",
  "oauth",
  "webhook",
  "api",
  "cloudflare_gatekeeper",
  "cloudflare_service",
  "email",
  "calendar",
  "file_storage",
  "git_repository",
  "external_api",
  "model_provider",
  "database",
  "storage",
] as const;
export const AUTOMATION_TRIGGER_KINDS = ["schedule", "event", "manual"] as const;
export const FEDERATION_DIRECTIONS = ["inbound", "outbound", "bidirectional"] as const;
export const MEMORY_TYPES = [
  "fact",
  "document",
  "conversation",
  "event",
  "experience",
  "rule",
  "decision",
  "artifact",
  "research",
  "data",
  "manual",
  "failure",
  "learning",
  "external",
  "external_source",
  "agent_output",
  "knowledge",
] as const;
export const VISIBILITIES = ["guild", "space", "restricted", "private"] as const;
export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export const SUPPORTED_LOCALES = ["en", "ja", "zh-CN"] as const;
export const GOAL_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export const PROJECT_STATUSES = ["planned", "active", "blocked", "completed", "cancelled"] as const;
export const QUEST_STATUSES = ["backlog", "ready", "in_progress", "blocked", "completed", "cancelled"] as const;
export const STEP_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export const ACTIVITY_STATUSES = [
  "proposed",
  "planned",
  "ready",
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "archived",
] as const;
export const ACTIVITY_TYPES = [
  "task",
  "project",
  "quest",
  "event",
  "discussion",
  "experiment",
  "study",
  "campaign",
  "ritual",
  "session",
  "creation",
  "maintenance",
  "investigation",
  "mission",
  "goal",
  "step",
] as const;
export const COLLECTIVE_TEMPLATE_KEYS = [
  "personal",
  "blank",
  "company",
  "community",
  "research",
  "creator",
  "open-source",
  "agent-collective",
] as const;
export const DECISION_STATUSES = ["draft", "proposed", "approved", "rejected", "superseded"] as const;
export const DECISION_METHODS = [
  "custodian",
  "consent",
  "vote",
  "review",
  "editorial",
  "policy",
  "hybrid",
  "quorum_vote",
  "council",
  "agent_proposal_human_approval",
  "custom",
] as const;
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export const AGENT_RUN_STATUSES = [
  "planning",
  "awaiting_approval",
  "running",
  "succeeded",
  "failed",
  "killed",
] as const;
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "applied",
] as const;
export const CONNECTOR_STATUSES = ["active", "disabled", "revoked"] as const;

export const PERMISSIONS = [
  "actor.read",
  "actor.manage",
  "memory.read",
  "memory.create",
  "memory.govern",
  "activity.read",
  "activity.create",
  "activity.assign",
  "connection.read",
  "connection.execute",
  "connection.manage",
  "run.read",
  "run.create",
  "run.approve",
  "run.stop",
  "event.read",
  "template.read",
  "template.manage",
  "stewardship.manage",
  "stewardship.recover",
  "relation.read",
  "relation.manage",
  "lifecycle.read",
  "lifecycle.manage",
  "message.read",
  "message.create",
  "contribution.read",
  "contribution.correct",
  "automation.read",
  "automation.manage",
  "federation.read",
  "federation.manage",
  "data.read",
  "data.manage",
  "guild.read",
  "guild.manage",
  "constitution.read",
  "constitution.update",
  "space.read",
  "space.manage",
  "identity.read",
  "identity.manage",
  "membership.read",
  "membership.manage",
  "role.read",
  "role.manage",
  "knowledge.read",
  "knowledge.create",
  "knowledge.propose",
  "knowledge.approve",
  "file.read",
  "file.create",
  "file.delete",
  "work.read",
  "work.create",
  "work.assign",
  "decision.read",
  "decision.propose",
  "decision.approve",
  "conversation.read",
  "conversation.create",
  "conversation.moderate",
  "announcement.read",
  "announcement.manage",
  "agent.read",
  "agent.manage",
  "agent.run",
  "agent.approve",
  "agent.stop",
  "inbox.read",
  "chronicle.read",
  "integration.read",
  "integration.execute",
  "integration.manage",
  "break-glass.use",
] as const;

export const PREBOARDING_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "actor.read",
  "memory.read",
  "activity.read",
  "connection.read",
  "run.read",
  "event.read",
  "template.read",
  "relation.read",
  "lifecycle.read",
  "message.read",
  "message.create",
  "contribution.read",
  "automation.read",
  "federation.read",
  "data.read",
  "guild.read",
  "constitution.read",
  "space.read",
  "knowledge.read",
  "file.read",
  "work.read",
  "conversation.read",
  "conversation.create",
  "announcement.read",
  "inbox.read",
]);

export const HUMAN_ONLY_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "actor.manage",
  "memory.govern",
  "connection.manage",
  "run.approve",
  "run.stop",
  "template.manage",
  "lifecycle.manage",
  "contribution.correct",
  "automation.manage",
  "federation.manage",
  "data.manage",
  "stewardship.manage",
  "stewardship.recover",
  "guild.manage",
  "constitution.update",
  "space.manage",
  "identity.manage",
  "membership.manage",
  "role.manage",
  "knowledge.approve",
  "decision.approve",
  "conversation.moderate",
  "announcement.manage",
  "agent.manage",
  "agent.approve",
  "agent.stop",
  "integration.manage",
  "break-glass.use",
]);

export const CONVERSATION_SUBJECT_TYPES = [
  "knowledge",
  "goal",
  "project",
  "quest",
  "step",
  "decision",
  "announcement",
  "agent_run",
] as const;

export const CONVERSATION_STATUSES = ["open", "locked"] as const;
export const CONVERSATION_MESSAGE_STATES = ["active", "redacted"] as const;

export const ROOT_ONLY_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "stewardship.manage",
  "stewardship.recover",
  "constitution.update",
  "break-glass.use",
]);

export const ACTOR_MEMBERSHIP_TRANSITIONS = {
  invited: ["joined", "active", "left", "blocked"],
  joined: ["active", "paused", "left", "blocked"],
  active: ["paused", "left", "blocked"],
  paused: ["active", "left", "blocked"],
  left: [],
  blocked: ["paused"],
} as const satisfies Record<
  (typeof ACTOR_MEMBERSHIP_STATES)[number],
  readonly (typeof ACTOR_MEMBERSHIP_STATES)[number][]
>;

export const ACTIVITY_TRANSITIONS = {
  proposed: ["planned", "ready", "active", "cancelled", "archived"],
  planned: ["ready", "active", "paused", "cancelled", "archived"],
  ready: ["active", "paused", "blocked", "cancelled", "archived"],
  active: ["paused", "blocked", "completed", "cancelled", "archived"],
  paused: ["ready", "active", "blocked", "cancelled", "archived"],
  blocked: ["ready", "active", "paused", "cancelled", "archived"],
  completed: ["active", "archived"],
  cancelled: ["planned", "archived"],
  archived: [],
} as const satisfies Record<
  (typeof ACTIVITY_STATUSES)[number],
  readonly (typeof ACTIVITY_STATUSES)[number][]
>;

export const MEMBERSHIP_TRANSITIONS = {
  invited: ["preboarding", "active", "departed"],
  preboarding: ["active", "suspended", "departed"],
  active: ["suspended", "departed"],
  suspended: ["active", "departed"],
  departed: [],
} as const satisfies Record<
  (typeof MEMBERSHIP_STATES)[number],
  readonly (typeof MEMBERSHIP_STATES)[number][]
>;

export const CLASSIFICATION_RANK = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
} as const;

export const KNOWLEDGE_TRANSITIONS = {
  draft: ["proposed", "archived"],
  proposed: ["draft", "canonical", "archived"],
  canonical: ["deprecated"],
  deprecated: ["archived"],
  archived: [],
} as const satisfies Record<
  (typeof KNOWLEDGE_STATES)[number],
  readonly (typeof KNOWLEDGE_STATES)[number][]
>;

export const GOAL_TRANSITIONS = {
  draft: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: ["active"],
  cancelled: ["draft"],
} as const satisfies Record<
  (typeof GOAL_STATUSES)[number],
  readonly (typeof GOAL_STATUSES)[number][]
>;

export const PROJECT_TRANSITIONS = {
  planned: ["active", "cancelled"],
  active: ["blocked", "completed", "cancelled"],
  blocked: ["active", "cancelled"],
  completed: ["active"],
  cancelled: ["planned"],
} as const satisfies Record<
  (typeof PROJECT_STATUSES)[number],
  readonly (typeof PROJECT_STATUSES)[number][]
>;

export const QUEST_TRANSITIONS = {
  backlog: ["ready", "in_progress", "cancelled"],
  ready: ["backlog", "in_progress", "cancelled"],
  in_progress: ["ready", "blocked", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["backlog"],
} as const satisfies Record<
  (typeof QUEST_STATUSES)[number],
  readonly (typeof QUEST_STATUSES)[number][]
>;

export const STEP_TRANSITIONS = {
  pending: ["in_progress", "completed", "skipped"],
  in_progress: ["pending", "completed", "skipped"],
  completed: ["in_progress"],
  skipped: ["pending"],
} as const satisfies Record<
  (typeof STEP_STATUSES)[number],
  readonly (typeof STEP_STATUSES)[number][]
>;

export const DECISION_TRANSITIONS = {
  draft: ["proposed"],
  proposed: ["approved", "rejected"],
  approved: ["superseded"],
  rejected: [],
  superseded: [],
} as const satisfies Record<
  (typeof DECISION_STATUSES)[number],
  readonly (typeof DECISION_STATUSES)[number][]
>;

export const ANNOUNCEMENT_TRANSITIONS = {
  draft: ["published", "archived"],
  published: ["archived"],
  archived: [],
} as const satisfies Record<
  (typeof ANNOUNCEMENT_STATUSES)[number],
  readonly (typeof ANNOUNCEMENT_STATUSES)[number][]
>;
