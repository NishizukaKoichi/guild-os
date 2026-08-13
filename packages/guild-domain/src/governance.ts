import { GuildDomainError } from "./errors.js";
import {
  HUMAN_ONLY_PERMISSIONS,
  MEMBERSHIP_TRANSITIONS,
  ROOT_ONLY_PERMISSIONS,
} from "./constants.js";
import type {
  AgentProfile,
  AgentRunUsage,
  ApprovalRequirement,
  AuthorizationSnapshot,
  Constitution,
  Identity,
  IdentityStatus,
  MembershipState,
  Permission,
  Role,
  RiskLevel,
} from "./types.js";
import { assertAgentLimits, assertNonBlank, assertPositiveInteger } from "./validation.js";
import { assertUsageWithinLimits } from "./agent.js";

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
  assertNonBlank(profile.instructions, "Agent instructions", 20_000);
  assertNonBlank(profile.model, "Agent model");
  if (profile.toolIds.length > 50 || new Set(profile.toolIds).size !== profile.toolIds.length) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Agent tools must contain at most 50 unique IDs.",
    );
  }
  for (const toolId of profile.toolIds) assertNonBlank(toolId, "Agent tool ID");
  const skillIds = profile.skillIds ?? [];
  if (skillIds.length > 100 || new Set(skillIds).size !== skillIds.length) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Agent skills must contain at most 100 unique IDs.",
    );
  }
  for (const skillId of skillIds) assertNonBlank(skillId, "Agent skill ID", 200);
  assertAgentLimits(profile.limits);
}

export function assertAgentCannotBecomeRoot(identity: Identity): void {
  if (identity.kind !== "human") {
    throw new GuildDomainError("AGENT_ROOT_FORBIDDEN", "Only a human can become Root Owner.");
  }
}

export function validateRolePermissions(permissions: readonly Permission[]): void {
  if (permissions.length === 0 || new Set(permissions).size !== permissions.length) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "A Role requires at least one unique permission.",
    );
  }
  if (permissions.some((permission) => ROOT_ONLY_PERMISSIONS.has(permission))) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      "Constitution and Break Glass authority belong only to the current human Root Owner.",
    );
  }
}

export function assertRoleAssignableToIdentity(role: Role, identity: Identity): void {
  if (role.guildId !== identity.guildId) {
    throw new GuildDomainError("INVALID_INPUT", "Role and Identity belong to different Guilds.");
  }
  if (identity.kind !== "human" && role.permissions.some((permission) =>
    HUMAN_ONLY_PERMISSIONS.has(permission))) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      "Agent and Service identities cannot receive a Role with human-only permissions.",
    );
  }
}

export function assertRunWithinLimits(profile: AgentProfile, usage: AgentRunUsage): void {
  assertUsageWithinLimits(profile.limits, usage);
}

export function validateConstitution(constitution: Constitution): void {
  assertPositiveInteger(constitution.version, "Constitution version");
  assertPositiveInteger(constitution.level2ApprovalQuorum, "Level 2 approval quorum");
  assertPositiveInteger(constitution.level3ApprovalQuorum, "Level 3 approval quorum");
  assertPositiveInteger(constitution.dataRetentionDays, "Data retention period");
  if (constitution.level3ApprovalQuorum < constitution.level2ApprovalQuorum) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Level 3 approval quorum cannot be lower than Level 2 approval quorum.",
    );
  }
  if (constitution.level2ApprovalQuorum > 100 || constitution.level3ApprovalQuorum > 100) {
    throw new GuildDomainError("INVALID_INPUT", "Approval quorum cannot exceed 100 Humans.");
  }
  if (constitution.dataRetentionDays > 36_500) {
    throw new GuildDomainError("INVALID_INPUT", "Data retention cannot exceed 36,500 days.");
  }
  assertAgentLimits(constitution.agentDefaults);
  if ((constitution.principles?.length ?? 0) > 20_000 ||
      (constitution.publicScope?.length ?? 0) > 10_000) {
    throw new GuildDomainError("INVALID_INPUT", "Constitution text exceeds its safe limit.");
  }
  if (constitution.membershipPolicy &&
      constitution.membershipPolicy.departureMode !== "revoke_then_handover") {
    throw new GuildDomainError("INVALID_INPUT", "Constitution departure policy is invalid.");
  }
  if (constitution.dataPolicy && constitution.dataPolicy.crossGuildSharing !== "explicit_only") {
    throw new GuildDomainError("INVALID_INPUT", "Cross-Guild sharing must remain explicit.");
  }
  if (constitution.agentPolicy &&
      (!constitution.agentPolicy.level2HumanApproval ||
       !constitution.agentPolicy.level3MultiHumanApproval)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Level 2 and Level 3 Agent actions must retain Human approval.",
    );
  }
}

export function approvalRequirement(
  constitution: Constitution,
  riskLevel: RiskLevel,
): ApprovalRequirement {
  switch (riskLevel) {
    case 0:
      return {
        approvals: constitution.agentPolicy?.level0Automatic === false ? 1 : 0,
        reauthenticationRequired: false,
        reason: "Read-only operation",
      };
    case 1:
      return {
        approvals: constitution.agentPolicy?.level1Automatic === true ? 0 : 1,
        reauthenticationRequired: false,
        reason: "Reversible internal draft",
      };
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
