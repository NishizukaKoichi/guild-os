import { GuildDomainError } from "./errors.js";
import type { AgentLimits, AuthorizationSnapshot } from "./types.js";

export function assertNonBlank(value: string, field: string, maxLength = 200): void {
  if (value.trim().length === 0 || value !== value.trim() || value.length > maxLength) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `${field} must be non-blank, unpadded, and at most ${maxLength} characters.`,
    );
  }
}

export function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GuildDomainError("INVALID_INPUT", `${field} must be a positive safe integer.`);
  }
}

export function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GuildDomainError("INVALID_INPUT", `${field} must be a non-negative safe integer.`);
  }
}

export function assertAgentLimits(limits: AgentLimits): void {
  assertNonBlank(limits.currency, "Agent currency", 3);
  if (!/^[A-Z]{3}$/.test(limits.currency)) {
    throw new GuildDomainError("INVALID_INPUT", "Agent currency must be a three-letter ISO code.");
  }
  assertNonNegativeInteger(limits.maxBudgetMinor, "Agent budget");
  assertPositiveInteger(limits.maxTokens, "Agent token limit");
  assertPositiveInteger(limits.maxDurationSeconds, "Agent duration");
  assertPositiveInteger(limits.maxSteps, "Agent step limit");
  assertNonNegativeInteger(limits.maxRetries, "Agent retry limit");
  assertNonNegativeInteger(limits.maxDelegationDepth, "Agent delegation depth");
}

export function assertSnapshotIntegrity(snapshot: AuthorizationSnapshot): void {
  const guildId = snapshot.guild.id;
  const collections = [
    snapshot.spaces,
    snapshot.identities,
    snapshot.memberships,
    snapshot.roles,
    snapshot.roleBindings,
    snapshot.agents,
  ];
  if (collections.some((items) => items.some((item) => item.guildId !== guildId))) {
    throw new GuildDomainError("INVALID_INPUT", "Authorization snapshot crosses Guild boundaries.");
  }

  const identities = new Set(snapshot.identities.map((identity) => identity.id));
  const roles = new Set(snapshot.roles.map((role) => role.id));
  const spaces = new Set(snapshot.spaces.map((space) => space.id));
  if (!identities.has(snapshot.guild.rootOwnerIdentityId)) {
    throw new GuildDomainError("ROOT_OWNER_REQUIRED", "The Root Owner identity is missing.");
  }
  for (const binding of snapshot.roleBindings) {
    if (!identities.has(binding.identityId) || !roles.has(binding.roleId) ||
        binding.spaceId !== null && !spaces.has(binding.spaceId)) {
      throw new GuildDomainError("INVALID_INPUT", "A role binding references a missing entity.");
    }
  }
}
