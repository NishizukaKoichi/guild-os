import type { AuthorizationSnapshot, Permission, SecuredResource } from "./types.js";

export function makeSnapshot(): AuthorizationSnapshot {
  const staffPermissions: Permission[] = [
    "guild.read",
    "space.read",
    "knowledge.read",
    "work.read",
    "inbox.read",
  ];
  return {
    guild: {
      id: "guild-1",
      name: "Example Guild",
      purpose: "Coordinate people and agents",
      rootOwnerIdentityId: "owner",
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
    constitution: {
      guildId: "guild-1",
      version: 1,
      level2ApprovalQuorum: 1,
      level3ApprovalQuorum: 2,
      dataRetentionDays: 2555,
      agentDefaults: {
        currency: "AUD",
        maxBudgetMinor: 1_000,
        maxDurationSeconds: 900,
        maxSteps: 20,
        maxRetries: 2,
        maxDelegationDepth: 1,
      },
      updatedByIdentityId: "owner",
      updatedAt: "2026-08-12T00:00:00.000Z",
    },
    spaces: [
      { id: "company", guildId: "guild-1", parentSpaceId: null, name: "Company", status: "active" },
      { id: "research", guildId: "guild-1", parentSpaceId: "company", name: "Research", status: "active" },
      { id: "lab", guildId: "guild-1", parentSpaceId: "research", name: "Lab", status: "active" },
      { id: "finance", guildId: "guild-1", parentSpaceId: "company", name: "Finance", status: "active" },
    ],
    identities: [
      { id: "owner", guildId: "guild-1", kind: "human", displayName: "Owner", status: "active" },
      { id: "manager", guildId: "guild-1", kind: "human", displayName: "Manager", status: "active" },
      { id: "staff", guildId: "guild-1", kind: "human", displayName: "Staff", status: "active" },
      { id: "newcomer", guildId: "guild-1", kind: "human", displayName: "Newcomer", status: "active" },
      { id: "disabled", guildId: "guild-1", kind: "human", displayName: "Disabled", status: "disabled" },
      { id: "research-agent", guildId: "guild-1", kind: "agent", displayName: "Research Agent", status: "active" },
    ],
    memberships: [
      { guildId: "guild-1", identityId: "owner", state: "active", clearance: "restricted", joinedAt: "2026-08-12T00:00:00.000Z", departedAt: null },
      { guildId: "guild-1", identityId: "manager", state: "active", clearance: "confidential", joinedAt: "2026-08-12T00:00:00.000Z", departedAt: null },
      { guildId: "guild-1", identityId: "staff", state: "active", clearance: "internal", joinedAt: "2026-08-12T00:00:00.000Z", departedAt: null },
      { guildId: "guild-1", identityId: "newcomer", state: "preboarding", clearance: "internal", joinedAt: null, departedAt: null },
      { guildId: "guild-1", identityId: "disabled", state: "active", clearance: "internal", joinedAt: "2026-08-12T00:00:00.000Z", departedAt: null },
      { guildId: "guild-1", identityId: "research-agent", state: "active", clearance: "confidential", joinedAt: "2026-08-12T00:00:00.000Z", departedAt: null },
    ],
    roles: [
      { id: "manager-role", guildId: "guild-1", name: "Manager", permissions: ["knowledge.read", "knowledge.create", "knowledge.propose", "knowledge.approve", "work.read", "work.create", "work.assign", "decision.read", "decision.propose", "decision.approve", "agent.read", "agent.run", "membership.read"], system: false },
      { id: "staff-role", guildId: "guild-1", name: "Staff", permissions: staffPermissions, system: false },
      { id: "agent-role", guildId: "guild-1", name: "Research Agent", permissions: ["knowledge.read", "knowledge.create", "knowledge.propose", "work.read", "work.create"], system: false },
    ],
    roleBindings: [
      { guildId: "guild-1", identityId: "manager", roleId: "manager-role", spaceId: "research" },
      { guildId: "guild-1", identityId: "staff", roleId: "staff-role", spaceId: "research" },
      { guildId: "guild-1", identityId: "newcomer", roleId: "staff-role", spaceId: "research" },
      { guildId: "guild-1", identityId: "disabled", roleId: "staff-role", spaceId: "research" },
      { guildId: "guild-1", identityId: "research-agent", roleId: "agent-role", spaceId: "research" },
    ],
    agents: [{
      identityId: "research-agent",
      guildId: "guild-1",
      instructions: "Research only within the assigned Space.",
      model: "provider/model",
      toolIds: ["knowledge"],
      limits: {
        currency: "AUD",
        maxBudgetMinor: 500,
        maxDurationSeconds: 600,
        maxSteps: 10,
        maxRetries: 1,
        maxDelegationDepth: 0,
      },
      status: "active",
    }],
  };
}

export function makeResource(overrides: Partial<SecuredResource> = {}): SecuredResource {
  return {
    id: "knowledge-1",
    guildId: "guild-1",
    spaceId: "lab",
    ownerIdentityId: "manager",
    visibility: "space",
    classification: "internal",
    ...overrides,
  };
}
