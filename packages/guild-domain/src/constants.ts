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
  "work.read",
  "work.create",
  "work.assign",
  "decision.read",
  "decision.propose",
  "decision.approve",
  "agent.read",
  "agent.manage",
  "agent.run",
  "agent.stop",
  "inbox.read",
  "chronicle.read",
  "integration.read",
  "integration.manage",
  "break-glass.use",
] as const;

export const PREBOARDING_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "guild.read",
  "constitution.read",
  "space.read",
  "knowledge.read",
  "work.read",
  "inbox.read",
]);

export const HUMAN_ONLY_PERMISSIONS = new Set<(typeof PERMISSIONS)[number]>([
  "guild.manage",
  "constitution.update",
  "membership.manage",
  "role.manage",
  "break-glass.use",
]);

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
