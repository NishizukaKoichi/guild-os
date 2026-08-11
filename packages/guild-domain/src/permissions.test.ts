import { describe, expect, it } from "vitest";
import { GuildDomainError } from "./errors.js";
import {
  authorize,
  authorizeAgent,
  assertCanDelegatePermissions,
  effectiveAgentPermissions,
  filterAgentAuthorizedResources,
  filterAuthorizedResources,
} from "./permissions.js";
import { makeResource, makeSnapshot } from "./test-fixtures.js";

describe("Guild authorization", () => {
  it("inherits a Space-scoped role into descendants but not siblings", () => {
    const snapshot = makeSnapshot();
    expect(() => authorize(snapshot, {
      actorIdentityId: "staff",
      permission: "knowledge.read",
      resource: makeResource({ spaceId: "lab" }),
    })).not.toThrow();

    expect(() => authorize(snapshot, {
      actorIdentityId: "staff",
      permission: "knowledge.read",
      resource: makeResource({ spaceId: "finance" }),
    })).toThrowError(GuildDomainError);
  });

  it("does not let Root ownership bypass private data boundaries", () => {
    const snapshot = makeSnapshot();
    expect(() => authorize(snapshot, {
      actorIdentityId: "owner",
      permission: "knowledge.read",
      resource: makeResource({ visibility: "private", ownerIdentityId: "staff" }),
    })).toThrowError(expect.objectContaining({ code: "PRIVATE_RESOURCE" }));
  });

  it("rejects disabled identities and mutating preboarding permissions", () => {
    const snapshot = makeSnapshot();
    expect(() => authorize(snapshot, {
      actorIdentityId: "disabled",
      permission: "knowledge.read",
      resource: makeResource(),
    })).toThrowError(expect.objectContaining({ code: "IDENTITY_DISABLED" }));
    expect(() => authorize(snapshot, {
      actorIdentityId: "newcomer",
      permission: "knowledge.create",
      resource: makeResource({ ownerIdentityId: "newcomer" }),
    })).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });

  it("filters records before they can become model context", () => {
    const snapshot = makeSnapshot();
    const records = [
      makeResource({ id: "allowed", spaceId: "lab" }),
      makeResource({ id: "wrong-space", spaceId: "finance" }),
      makeResource({ id: "too-secret", classification: "confidential" }),
      makeResource({ id: "private", visibility: "private", ownerIdentityId: "manager" }),
    ];
    expect(filterAuthorizedResources(snapshot, "staff", "knowledge.read", records)
      .map((record) => record.id)).toEqual(["allowed"]);
  });

  it("intersects agent, requester, workflow, and connector authority", () => {
    const snapshot = makeSnapshot();
    const resource = makeResource();
    const allowed = new Set(["knowledge.read", "knowledge.create"] as const);
    expect(() => authorizeAgent(snapshot, {
      agentIdentityId: "research-agent",
      requesterIdentityId: "staff",
      permission: "knowledge.read",
      workflowPermissions: allowed,
      connectorPermissions: allowed,
      resource,
    })).not.toThrow();

    expect(() => authorizeAgent(snapshot, {
      agentIdentityId: "research-agent",
      requesterIdentityId: "staff",
      permission: "knowledge.create",
      workflowPermissions: allowed,
      connectorPermissions: allowed,
      resource,
    })).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));

    expect(effectiveAgentPermissions(
      snapshot,
      "research-agent",
      "staff",
      allowed,
      allowed,
      resource,
    )).toEqual(new Set(["knowledge.read"]));

    const records = [
      makeResource({ id: "allowed" }),
      makeResource({ id: "finance", spaceId: "finance" }),
    ];
    expect(filterAgentAuthorizedResources(snapshot, {
      agentIdentityId: "research-agent",
      requesterIdentityId: "staff",
      permission: "knowledge.read",
      workflowPermissions: allowed,
      connectorPermissions: allowed,
    }, records).map((record) => record.id)).toEqual(["allowed"]);
  });

  it("keeps constitutional and permission operations human-only", () => {
    const base = makeSnapshot();
    const snapshot = {
      ...base,
      roles: [...base.roles, {
        id: "misconfigured-agent-admin",
        guildId: "guild-1",
        name: "Misconfigured agent admin",
        permissions: [
          "constitution.update",
          "identity.manage",
          "role.manage",
          "agent.manage",
          "integration.manage",
          "break-glass.use",
        ] as const,
        system: false,
      }],
      roleBindings: [...base.roleBindings, {
        guildId: "guild-1",
        identityId: "research-agent",
        roleId: "misconfigured-agent-admin",
        spaceId: null,
      }],
    };
    expect(() => authorize(snapshot, {
      actorIdentityId: "research-agent",
      permission: "constitution.update",
    })).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    for (const permission of [
      "identity.manage",
      "role.manage",
      "agent.manage",
      "integration.manage",
    ] as const) {
      expect(() => authorize(snapshot, {
        actorIdentityId: "research-agent",
        permission,
      })).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    }
  });

  it("prevents Role and invitation delegation above the actor's global authority", () => {
    const base = makeSnapshot();
    expect(() => assertCanDelegatePermissions(base, "owner", [
      "knowledge.read",
      "identity.manage",
    ])).not.toThrow();
    expect(() => assertCanDelegatePermissions(base, "manager", ["knowledge.read"]))
      .toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));

    const globalManager = {
      ...base,
      roleBindings: base.roleBindings.map((binding) => binding.identityId === "manager"
        ? { ...binding, spaceId: null }
        : binding),
    };
    expect(() => assertCanDelegatePermissions(globalManager, "manager", ["knowledge.read"]))
      .not.toThrow();
    expect(() => assertCanDelegatePermissions(globalManager, "manager", ["identity.manage"]))
      .toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });
});
