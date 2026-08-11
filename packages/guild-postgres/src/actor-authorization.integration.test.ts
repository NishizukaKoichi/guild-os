import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import {
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
} from "./actor-authorization.js";
import { withGuildTransaction } from "./transaction.js";
import { GuildDirectoryRepository } from "./directory.js";
import { GuildPostgresRepository } from "./repository.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorIdentityId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "integration-test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

integration("bounded PostgreSQL authorization", () => {
  it("inherits Space grants, excludes unrelated identities, and revokes access immediately", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");

    const guildId = randomUUID();
    const rootId = randomUUID();
    const memberId = randomUUID();
    const unrelatedId = randomUUID();
    const roleId = randomUUID();
    const rootSpaceId = randomUUID();
    const departmentSpaceId = randomUUID();
    const childSpaceId = randomUUID();
    const siblingSpaceId = randomUUID();

    await withGuildTransaction(connectionString, guildId, async (connection) => {
      await connection.query(
        "INSERT INTO guilds (id, name, purpose, root_owner_identity_id) VALUES ($1, 'Authorization Guild', 'Verify bounded authorization', $2)",
        [guildId, rootId],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $4, 'human', 'Root', 'active'),
                ($2, $4, 'human', 'Scoped member', 'active'),
                ($3, $4, 'human', 'Unrelated member', 'active')`,
        [rootId, memberId, unrelatedId, guildId],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'restricted', now()),
                ($1, $3, 'active', 'internal', now()),
                ($1, $4, 'active', 'internal', now())`,
        [guildId, rootId, memberId, unrelatedId],
      );
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [rootId]);
      await connection.query(
        `INSERT INTO constitutions
           (guild_id, version, level2_approval_quorum, level3_approval_quorum,
            data_retention_days, agent_defaults, updated_by_identity_id)
         VALUES ($1, 1, 1, 2, 365, $2::jsonb, $3)`,
        [
          guildId,
          JSON.stringify({
            currency: "USD",
            maxBudgetMinor: 1000,
            maxDurationSeconds: 900,
            maxSteps: 20,
            maxRetries: 2,
            maxDelegationDepth: 1,
          }),
          rootId,
        ],
      );
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $5, NULL, 'Guild', 'active'),
                ($2, $5, $1, 'Research', 'active'),
                ($3, $5, $2, 'Laboratory', 'active'),
                ($4, $5, $1, 'Finance', 'active')`,
        [rootSpaceId, departmentSpaceId, childSpaceId, siblingSpaceId, guildId],
      );
      await connection.query(
        "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Scoped reader', false)",
        [roleId, guildId],
      );
      await connection.query(
        "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'space.read')",
        [guildId, roleId],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), guildId, memberId, roleId, departmentSpaceId],
      );
    });

    const rootSpaces = await withGuildTransaction(
      connectionString,
      guildId,
      (connection) => listAuthorizedSpaces(connection, guildId, rootId, "space.read"),
    );
    expect(new Set(rootSpaces.map((space) => space.id))).toEqual(new Set([
      rootSpaceId,
      departmentSpaceId,
      childSpaceId,
      siblingSpaceId,
    ]));

    const memberSpaces = await withGuildTransaction(
      connectionString,
      guildId,
      (connection) => listAuthorizedSpaces(connection, guildId, memberId, "space.read"),
    );
    expect(new Set(memberSpaces.map((space) => space.id))).toEqual(new Set([
      departmentSpaceId,
      childSpaceId,
    ]));

    const snapshot = await withGuildTransaction(
      connectionString,
      guildId,
      (connection) => loadActorAuthorizationSnapshot(
        connection,
        guildId,
        memberId,
        childSpaceId,
      ),
    );
    expect(new Set(snapshot.spaces.map((space) => space.id))).toEqual(new Set([
      rootSpaceId,
      departmentSpaceId,
      childSpaceId,
    ]));
    expect(snapshot.identities.map((identity) => identity.id).sort()).toEqual(
      [memberId, rootId].sort(),
    );
    expect(snapshot.identities.some((identity) => identity.id === unrelatedId)).toBe(false);

    await withGuildTransaction(connectionString, guildId, async (connection) => {
      await connection.query("UPDATE identities SET status = 'disabled' WHERE id = $1", [memberId]);
      await connection.query(
        "UPDATE memberships SET state = 'suspended' WHERE identity_id = $1",
        [memberId],
      );
    });
    const revokedSpaces = await withGuildTransaction(
      connectionString,
      guildId,
      (connection) => listAuthorizedSpaces(connection, guildId, memberId, "space.read"),
    );
    expect(revokedSpaces).toEqual([]);
  });

  it("claims a one-time invitation and enforces the complete membership lifecycle", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");

    const guildId = randomUUID();
    const rootId = randomUUID();
    const memberId = randomUUID();
    const rootSpaceId = randomUUID();
    const roleId = randomUUID();
    const invitationId = randomUUID();
    const tokenHash = "a".repeat(64);

    await withGuildTransaction(connectionString, guildId, async (connection) => {
      const repository = new GuildPostgresRepository(connection, guildId);
      await repository.bootstrapGuild({
        guildId,
        name: "Invitation Guild",
        purpose: "Verify invitation and offboarding",
        rootIdentityId: rootId,
        rootDisplayName: "Root",
        rootSpaceId,
        rootSpaceName: "Guild",
        constitution: constitution(guildId, rootId),
        roles: [{ id: roleId, name: "Member", permissions: ["guild.read", "space.read"] }],
        chronicleEvent: event(guildId, rootId, "guild.initialized", "guild", guildId),
      });
    });

    await withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      await directory.createInvitation({
        id: invitationId,
        tokenHash,
        inviteeLabel: "New researcher",
        roleId,
        spaceId: rootSpaceId,
        initialMembershipState: "preboarding",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdByIdentityId: rootId,
        chronicleEvent: event(
          guildId,
          rootId,
          "membership.invitation.created",
          "invitation",
          invitationId,
        ),
      });
    });

    const accepted = await withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      return directory.claimInvitation({
        tokenHash,
        identityId: memberId,
        displayName: "New Researcher",
        preferredLocale: "ja",
        chronicleEvent: event(
          guildId,
          memberId,
          "membership.invitation.accepted",
          "invitation",
          invitationId,
        ),
      });
    });
    expect(accepted).toMatchObject({
      id: invitationId,
      state: "accepted",
      acceptedByIdentityId: memberId,
      initialMembershipState: "preboarding",
    });

    const replayIdentityId = randomUUID();
    await expect(withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      return directory.claimInvitation({
        tokenHash,
        identityId: replayIdentityId,
        displayName: "Replay",
        preferredLocale: "en",
        chronicleEvent: event(
          guildId,
          replayIdentityId,
          "membership.invitation.accepted",
          "invitation",
          invitationId,
        ),
      });
    })).rejects.toThrow("invalid, expired, or already used");

    const listed = await withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      return directory.listDirectory();
    });
    expect(listed.identities.find((identity) => identity.id === memberId)).toMatchObject({
      displayName: "New Researcher",
      preferredLocale: "ja",
      membershipState: "preboarding",
      status: "active",
    });
    expect(listed.roleBindings).toContainEqual(expect.objectContaining({
      identityId: memberId,
      roleId,
      spaceId: rootSpaceId,
    }));

    for (const nextState of ["active", "suspended", "active", "departed"] as const) {
      await withGuildTransaction(connectionString, guildId, async (connection) => {
        const directory = new GuildDirectoryRepository(connection, guildId);
        await directory.changeMembership({
          actorIdentityId: rootId,
          identityId: memberId,
          nextState,
          chronicleEvent: event(
            guildId,
            rootId,
            `membership.${nextState}`,
            "identity",
            memberId,
          ),
        });
      });
    }

    const revokedSpaces = await withGuildTransaction(
      connectionString,
      guildId,
      (connection) => listAuthorizedSpaces(connection, guildId, memberId, "space.read"),
    );
    expect(revokedSpaces).toEqual([]);

    await expect(withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      await directory.changeMembership({
        actorIdentityId: rootId,
        identityId: memberId,
        nextState: "active",
        chronicleEvent: event(
          guildId,
          rootId,
          "membership.active",
          "identity",
          memberId,
        ),
      });
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(withGuildTransaction(connectionString, guildId, async (connection) => {
      const directory = new GuildDirectoryRepository(connection, guildId);
      await directory.changeMembership({
        actorIdentityId: rootId,
        identityId: rootId,
        nextState: "suspended",
        chronicleEvent: event(
          guildId,
          rootId,
          "membership.suspended",
          "identity",
          rootId,
        ),
      });
    })).rejects.toMatchObject({ code: "ROOT_OWNER_PROTECTED" });

    const actions = await withGuildTransaction(connectionString, guildId, async (connection) => {
      const result = await connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 ORDER BY sequence",
        [guildId],
      );
      return result.rows.map((row) => row.action);
    });
    expect(actions).toEqual([
      "guild.initialized",
      "membership.invitation.created",
      "membership.invitation.accepted",
      "membership.active",
      "membership.suspended",
      "membership.active",
      "membership.departed",
    ]);
  });

  it("paginates large directories and loads bindings only for the visible identity page", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");

    const guildId = randomUUID();
    const rootId = randomUUID();
    const rootSpaceId = randomUUID();
    const roleId = randomUUID();
    const memberIds = Array.from({ length: 55 }, () => randomUUID());
    const memberNames = memberIds.map((_, index) => `Member ${String(index).padStart(3, "0")}`);
    const bindingIds = memberIds.map(() => randomUUID());

    await withGuildTransaction(connectionString, guildId, async (connection) => {
      const repository = new GuildPostgresRepository(connection, guildId);
      await repository.bootstrapGuild({
        guildId,
        name: "Large Directory Guild",
        purpose: "Verify cursor pagination",
        rootIdentityId: rootId,
        rootDisplayName: "Root",
        rootSpaceId,
        rootSpaceName: "Guild",
        constitution: constitution(guildId, rootId),
        roles: [{ id: roleId, name: "Member", permissions: ["guild.read", "space.read"] }],
        chronicleEvent: event(guildId, rootId, "guild.initialized", "guild", guildId),
      });
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         SELECT member_id, $1, 'human', display_name, 'active'
           FROM unnest($2::uuid[], $3::text[]) AS members(member_id, display_name)`,
        [guildId, memberIds, memberNames],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         SELECT $1, member_id, 'active', 'internal', now()
           FROM unnest($2::uuid[]) AS members(member_id)`,
        [guildId, memberIds],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         SELECT binding_id, $1, member_id, $2, $3
           FROM unnest($4::uuid[], $5::uuid[]) AS bindings(binding_id, member_id)`,
        [guildId, roleId, rootSpaceId, bindingIds, memberIds],
      );
    });

    const first = await withGuildTransaction(connectionString, guildId, async (connection) =>
      new GuildDirectoryRepository(connection, guildId).listDirectory({
        includeInvitations: false,
      }));
    expect(first.identities).toHaveLength(50);
    expect(first.roleBindings).toHaveLength(50);
    expect(first.nextIdentityCursor).not.toBeNull();
    expect(first.invitations).toEqual([]);

    const second = await withGuildTransaction(connectionString, guildId, async (connection) =>
      new GuildDirectoryRepository(connection, guildId).listDirectory({
        identityCursor: first.nextIdentityCursor,
        includeInvitations: false,
      }));
    expect(second.identities).toHaveLength(6);
    expect(second.roleBindings).toHaveLength(5);
    expect(second.nextIdentityCursor).toBeNull();
    const allIds = [...first.identities, ...second.identities].map((identity) => identity.id);
    expect(new Set(allIds).size).toBe(56);
  });
});
