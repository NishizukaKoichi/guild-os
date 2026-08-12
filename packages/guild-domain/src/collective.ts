import {
  ACTIVITY_STATUSES,
  ACTIVITY_TRANSITIONS,
  ACTIVITY_TYPES,
  ACTOR_KINDS,
  ACTOR_MEMBERSHIP_STATES,
  ACTOR_MEMBERSHIP_TRANSITIONS,
  MEMORY_STATUSES,
  MEMORY_TYPES,
} from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  ActivityStatus,
  ActivityType,
  ActorKind,
  ActorMembershipState,
  LocalizedText,
  MemoryStatus,
  MemoryType,
  MembershipState,
} from "./types.js";
import { assertLocalizedText } from "./knowledge.js";
import { assertNonBlank } from "./validation.js";

export function assertActorKind(value: string): asserts value is ActorKind {
  if (!(ACTOR_KINDS as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Actor kind is invalid.");
  }
}

export function assertActorMembershipState(
  value: string,
): asserts value is ActorMembershipState {
  if (!(ACTOR_MEMBERSHIP_STATES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Membership state is invalid.");
  }
}

export function assertActorMembershipTransition(
  current: ActorMembershipState,
  next: ActorMembershipState,
): void {
  if (current === next) return;
  const allowed: readonly ActorMembershipState[] = ACTOR_MEMBERSHIP_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new GuildDomainError(
      "INVALID_MEMBERSHIP_TRANSITION",
      `Membership cannot transition from ${current} to ${next}.`,
    );
  }
}

export function legacyMembershipToActorState(state: MembershipState): ActorMembershipState {
  switch (state) {
    case "preboarding": return "joined";
    case "suspended": return "paused";
    case "departed": return "left";
    default: return state;
  }
}

export function actorMembershipToLegacyState(
  state: ActorMembershipState,
): MembershipState {
  switch (state) {
    case "joined": return "preboarding";
    case "paused":
    case "blocked": return "suspended";
    case "left": return "departed";
    default: return state;
  }
}

function assertExtensibleType(
  value: string,
  known: readonly string[],
  label: string,
): void {
  if (known.includes(value)) return;
  if (!/^custom:[a-z0-9][a-z0-9_-]{1,62}$/.test(value)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `${label} must be a built-in type or a custom: namespace value.`,
    );
  }
}

export function assertMemoryType(value: string): asserts value is MemoryType {
  assertExtensibleType(value, MEMORY_TYPES, "Memory type");
}

export function assertMemoryStatus(value: string): asserts value is MemoryStatus {
  if (!(MEMORY_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Memory status is invalid.");
  }
}

export function assertMemoryContent(
  title: LocalizedText,
  summary: LocalizedText,
  body: LocalizedText,
): void {
  assertLocalizedText(title, "Memory title", 200);
  assertLocalizedText(summary, "Memory summary", 2_000);
  assertLocalizedText(body, "Memory body", 200_000);
  const locales = Object.keys(title);
  if (locales.some((locale) => summary[locale as keyof LocalizedText] === undefined ||
      body[locale as keyof LocalizedText] === undefined) ||
      Object.keys(summary).some((locale) => !locales.includes(locale)) ||
      Object.keys(body).some((locale) => !locales.includes(locale))) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Memory title, summary, and body must contain the same languages.",
    );
  }
}

export function assertActivityType(value: string): asserts value is ActivityType {
  assertExtensibleType(value, ACTIVITY_TYPES, "Activity type");
}

export function assertActivityStatus(value: string): asserts value is ActivityStatus {
  if (!(ACTIVITY_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Activity status is invalid.");
  }
}

export function assertActivityText(title: string, description: string): void {
  assertNonBlank(title, "Activity title", 200);
  if (typeof description !== "string" || description.length > 10_000) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Activity description must be at most 10,000 characters.",
    );
  }
}

export function assertActivityTransition(
  current: ActivityStatus,
  next: ActivityStatus,
): void {
  if (current === next) return;
  const allowed: readonly ActivityStatus[] = ACTIVITY_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new GuildDomainError(
      "INVALID_ACTIVITY_TRANSITION",
      `Activity cannot transition from ${current} to ${next}.`,
    );
  }
}
