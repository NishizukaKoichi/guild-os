import { describe, expect, it } from "vitest";
import { GuildDomainError } from "./errors.js";
import {
  approvalRequirement,
  assertAgentIdentity,
  assertAgentCannotBecomeRoot,
  assertIdentityStatusTransition,
  assertMembershipTransition,
  assertRootOwnerIntegrity,
  assertRootOwnershipTransfer,
  assertRunWithinLimits,
  assertRoleAssignableToIdentity,
  validateRolePermissions,
  validateConstitution,
} from "./governance.js";
import { makeSnapshot } from "./test-fixtures.js";

describe("Guild governance", () => {
  it("requires an active human Root Owner", () => {
    const snapshot = makeSnapshot();
    expect(() => assertRootOwnerIntegrity(snapshot)).not.toThrow();
    const invalid = {
      ...snapshot,
      guild: { ...snapshot.guild, rootOwnerIdentityId: "research-agent" },
    };
    expect(() => assertRootOwnerIntegrity(invalid))
      .toThrowError(expect.objectContaining({ code: "ROOT_OWNER_REQUIRED" }));
  });

  it("protects Root ownership and permits transfer only to an active human", () => {
    const snapshot = makeSnapshot();
    expect(() => assertMembershipTransition(snapshot, "owner", "suspended"))
      .toThrowError(expect.objectContaining({ code: "ROOT_OWNER_PROTECTED" }));
    expect(() => assertMembershipTransition(snapshot, "owner", "preboarding"))
      .toThrowError(expect.objectContaining({ code: "ROOT_OWNER_PROTECTED" }));
    expect(() => assertIdentityStatusTransition(snapshot, "owner", "disabled"))
      .toThrowError(expect.objectContaining({ code: "ROOT_OWNER_PROTECTED" }));
    expect(() => assertRootOwnershipTransfer(snapshot, "manager", "staff"))
      .toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => assertRootOwnershipTransfer(snapshot, "owner", "staff")).not.toThrow();
    expect(() => assertAgentCannotBecomeRoot(snapshot.identities[5]!))
      .toThrowError(expect.objectContaining({ code: "AGENT_ROOT_FORBIDDEN" }));
  });

  it("enforces the membership lifecycle and makes departure terminal", () => {
    const snapshot = makeSnapshot();
    expect(() => assertMembershipTransition(snapshot, "newcomer", "active")).not.toThrow();
    expect(() => assertMembershipTransition(snapshot, "staff", "suspended")).not.toThrow();
    expect(() => assertMembershipTransition(snapshot, "staff", "preboarding"))
      .toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));

    const departed = {
      ...snapshot,
      memberships: snapshot.memberships.map((membership) =>
        membership.identityId === "staff" ? { ...membership, state: "departed" as const } : membership),
    };
    expect(() => assertMembershipTransition(departed, "staff", "active"))
      .toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => assertMembershipTransition(snapshot, "missing", "active"))
      .toThrowError(expect.objectContaining({ code: "IDENTITY_NOT_FOUND" }));
  });

  it("requires reauthentication and quorum for Level 3 actions", () => {
    const snapshot = makeSnapshot();
    expect(approvalRequirement(snapshot.constitution, 0)).toMatchObject({
      approvals: 0,
      reauthenticationRequired: false,
    });
    expect(approvalRequirement(snapshot.constitution, 2)).toMatchObject({
      approvals: 1,
      reauthenticationRequired: false,
    });
    expect(approvalRequirement(snapshot.constitution, 3)).toMatchObject({
      approvals: 2,
      reauthenticationRequired: true,
    });
  });

  it("keeps Break Glass out of Roles and human-only authority away from machines", () => {
    const snapshot = makeSnapshot();
    expect(() => validateRolePermissions(["guild.read", "space.read"])).not.toThrow();
    expect(() => validateRolePermissions([]))
      .toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => validateRolePermissions(["guild.read", "guild.read"]))
      .toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => validateRolePermissions(["break-glass.use"]))
      .toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => validateRolePermissions(["constitution.update"]))
      .toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => assertRoleAssignableToIdentity(snapshot.roles[2]!, snapshot.identities[5]!))
      .not.toThrow();
    expect(() => assertRoleAssignableToIdentity({
      ...snapshot.roles[2]!,
      permissions: ["knowledge.approve"],
    }, snapshot.identities[5]!)).toThrowError(
      expect.objectContaining({ code: "PERMISSION_DENIED" }),
    );
  });

  it("validates bounded Constitution changes", () => {
    const constitution = makeSnapshot().constitution;
    expect(() => validateConstitution(constitution)).not.toThrow();
    expect(() => validateConstitution({
      ...constitution,
      level2ApprovalQuorum: 3,
      level3ApprovalQuorum: 2,
    })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => validateConstitution({
      ...constitution,
      dataRetentionDays: 36_501,
    })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("enforces every agent run hard limit", () => {
    const profile = makeSnapshot().agents[0]!;
    expect(() => assertRunWithinLimits(profile, {
      budgetMinor: 100,
      tokens: 0,
      durationSeconds: 60,
      steps: 4,
      retries: 1,
      delegationDepth: 0,
    })).not.toThrow();
    expect(() => assertRunWithinLimits(profile, {
      budgetMinor: 100,
      tokens: 0,
      durationSeconds: 60,
      steps: 11,
      retries: 1,
      delegationDepth: 0,
    })).toThrowError(GuildDomainError);
    expect(() => assertRunWithinLimits(profile, {
      budgetMinor: 100,
      tokens: profile.limits.maxTokens + 1,
      durationSeconds: 60,
      steps: 4,
      retries: 1,
      delegationDepth: 0,
    })).toThrowError(expect.objectContaining({ code: "AGENT_LIMIT_EXCEEDED" }));
    expect(() => assertAgentIdentity(makeSnapshot().identities[5]!, {
      ...profile,
      limits: { ...profile.limits, currency: "usd" },
    })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(() => assertAgentIdentity(makeSnapshot().identities[5]!, {
      ...profile,
      toolIds: ["knowledge-search", "knowledge-search"],
    })).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
