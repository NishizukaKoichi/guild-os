import { GuildDomainError } from "./errors.js";
import { MEMBERSHIP_TRANSITIONS } from "./constants.js";
import type {
  AgentProfile,
  AgentRunUsage,
  ApprovalRequirement,
  AuthorizationSnapshot,
  Constitution,
  Identity,
  IdentityStatus,
  MembershipState,
  RiskLevel,
} from "./types.js";
import { assertAgentLimits, assertPositiveInteger } from "./validation.js";

export function assertRootOwnerIntegrity(snapshot: AuthorizationSnapshot): void {
  const rootOwner = snapshot.identities.find(
    (identity) => identity.id === snapshot.guild.rootOwnerIdentityId,
  );
  const membership = snapshot.memberships.find(
    (candidate) => candidate.identityId === snapshot.guild.rootOwnerIdentityId,
  );
  if (!rootOwner || rootOwner.kind !== "human" || rootOwner.status !== "active" ||
      membership?.state !== "active") {
    throw new GuildDomainError(
      "ROOT_OWNER_REQUIRED",
      "A Guild requires an active human Root Owner.",
    );
  }
}

export function assertMembershipTransition(
  snapshot: AuthorizationSnapshot,
  identityId: string,
  nextState: MembershipState,
): void {
  if (identityId === snapshot.guild.rootOwnerIdentityId && nextState !== "active") {
    throw new GuildDomainError(
      "ROOT_OWNER_PROTECTED",
      "Transfer Root ownership before suspending or departing the current Root Owner.",
    );
  }
  const membership = snapshot.memberships.find((candidate) => candidate.identityId === identityId);
  if (!membership) {
    throw new GuildDomainError("IDENTITY_NOT_FOUND", `Identity ${identityId} has no membership.`);
  }
  const allowed = MEMBERSHIP_TRANSITIONS[membership.state] as readonly MembershipState[];
  if (!allowed.includes(nextState)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `Membership cannot transition from ${membership.state} to ${nextState}.`,
    );
  }
}

export function assertIdentityStatusTransition(
  snapshot: AuthorizationSnapshot,
  identityId: string,
  nextStatus: IdentityStatus,
): void {
  if (identityId === snapshot.guild.rootOwnerIdentityId && nextStatus !== "active") {
    throw new GuildDomainError(
      "ROOT_OWNER_PROTECTED",
      "Transfer Root ownership before disabling the current Root Owner.",
    );
  }
}

export function assertRootOwnershipTransfer(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  nextOwnerIdentityId: string,
): void {
  if (actorIdentityId !== snapshot.guild.rootOwnerIdentityId) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      "Only the current Root Owner can transfer Root ownership.",
    );
  }
  const nextOwner = snapshot.identities.find((identity) => identity.id === nextOwnerIdentityId);
  const membership = snapshot.memberships.find(
    (candidate) => candidate.identityId === nextOwnerIdentityId,
  );
  if (!nextOwner || nextOwner.kind !== "human" || nextOwner.status !== "active" ||
      membership?.state !== "active") {
    throw new GuildDomainError(
      "ROOT_OWNER_REQUIRED",
      "Root ownership can be transferred only to an active human member.",
    );
  }
}

export function assertAgentIdentity(identity: Identity, profile: AgentProfile): void {
  if (identity.kind !== "agent" || identity.id !== profile.identityId ||
      identity.guildId !== profile.guildId) {
    throw new GuildDomainError("INVALID_INPUT", "Agent profile does not match its identity.");
  }
  assertAgentLimits(profile.limits);
}

export function assertAgentCannotBecomeRoot(identity: Identity): void {
  if (identity.kind !== "human") {
    throw new GuildDomainError("AGENT_ROOT_FORBIDDEN", "Only a human can become Root Owner.");
  }
}

export function assertRunWithinLimits(profile: AgentProfile, usage: AgentRunUsage): void {
  const checks: readonly [number, number, string][] = [
    [usage.budgetMinor, profile.limits.maxBudgetMinor, "budget"],
    [usage.durationSeconds, profile.limits.maxDurationSeconds, "duration"],
    [usage.steps, profile.limits.maxSteps, "steps"],
    [usage.retries, profile.limits.maxRetries, "retries"],
    [usage.delegationDepth, profile.limits.maxDelegationDepth, "delegation depth"],
  ];
  const exceeded = checks.find(([actual, maximum]) => actual > maximum);
  if (exceeded) {
    throw new GuildDomainError(
      "AGENT_LIMIT_EXCEEDED",
      `Agent ${exceeded[2]} limit exceeded (${exceeded[0]} > ${exceeded[1]}).`,
    );
  }
}

export function validateConstitution(constitution: Constitution): void {
  assertPositiveInteger(constitution.version, "Constitution version");
  assertPositiveInteger(constitution.level2ApprovalQuorum, "Level 2 approval quorum");
  assertPositiveInteger(constitution.level3ApprovalQuorum, "Level 3 approval quorum");
  assertPositiveInteger(constitution.dataRetentionDays, "Data retention period");
  assertAgentLimits(constitution.agentDefaults);
}

export function approvalRequirement(
  constitution: Constitution,
  riskLevel: RiskLevel,
): ApprovalRequirement {
  switch (riskLevel) {
    case 0:
      return { approvals: 0, reauthenticationRequired: false, reason: "Read-only operation" };
    case 1:
      return { approvals: 0, reauthenticationRequired: false, reason: "Reversible internal draft" };
    case 2:
      return {
        approvals: constitution.level2ApprovalQuorum,
        reauthenticationRequired: false,
        reason: "External or consequential write",
      };
    case 3:
      return {
        approvals: constitution.level3ApprovalQuorum,
        reauthenticationRequired: true,
        reason: "Critical, destructive, financial, legal, permission, or production operation",
      };
  }
}
