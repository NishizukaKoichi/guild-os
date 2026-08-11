import { describe, expect, it } from "vitest";
import { GuildDomainError } from "./errors.js";
import {
  approvalRequirement,
  assertAgentCannotBecomeRoot,
  assertIdentityStatusTransition,
  assertMembershipTransition,
  assertRootOwnerIntegrity,
  assertRootOwnershipTransfer,
  assertRunWithinLimits,
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

  it("enforces every agent run hard limit", () => {
    const profile = makeSnapshot().agents[0]!;
    expect(() => assertRunWithinLimits(profile, {
      budgetMinor: 100,
      durationSeconds: 60,
      steps: 4,
      retries: 1,
      delegationDepth: 0,
    })).not.toThrow();
    expect(() => assertRunWithinLimits(profile, {
      budgetMinor: 100,
      durationSeconds: 60,
      steps: 11,
      retries: 1,
      delegationDepth: 0,
    })).toThrowError(GuildDomainError);
  });
});
