export const IDENTITY_KINDS = ["human", "agent", "service"] as const;
export const IDENTITY_STATUSES = ["active", "disabled"] as const;
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
export const VISIBILITIES = ["guild", "space", "restricted", "private"] as const;
export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export const SUPPORTED_LOCALES = ["en", "ja", "zh-CN"] as const;
export const GOAL_STATUSES = ["draft", "active", "completed", "cancelled"] as const;
export const PROJECT_STATUSES = ["planned", "active", "blocked", "completed", "cancelled"] as const;
export const QUEST_STATUSES = ["backlog", "ready", "in_progress", "blocked", "completed", "cancelled"] as const;
export const STEP_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export const DECISION_STATUSES = ["draft", "proposed", "approved", "rejected", "superseded"] as const;
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
  "guild.manage",
  "constitution.update",
  "space.manage",
  "identity.manage",
  "membership.manage",
  "role.manage",
  "knowledge.approve",
  "decision.approve",
  "announcement.manage",
  "agent.manage",
  "agent.approve",
  "agent.stop",
  "integration.manage",
  "break-glass.use",
]);

export const ROOT_ONLY_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "constitution.update",
  "break-glass.use",
]);

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
