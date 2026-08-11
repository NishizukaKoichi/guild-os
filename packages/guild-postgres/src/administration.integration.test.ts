import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildAdministrationRepository } from "./administration.js";
import { GuildDirectoryRepository } from "./directory.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

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
    details: { source: "administration-integration-test" },
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

async function bootstrapFixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    rootSpace: randomUUID(),
    builtInRole: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Administration Guild",
      purpose: "Verify identity and governance administration",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{ id: ids.builtInRole, name: "Member", permissions: ["guild.read"] }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
  });
  return ids;
}

integration("Guild administration repository", () => {
  it("manages custom Roles, Spaces, Agents, Services, lifecycle, and Chronicle atomically", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const machineRole = randomUUID();
    const childSpace = randomUUID();
    const emptySpace = randomUUID();
    const agent = randomUUID();
    const service = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const administration = new GuildAdministrationRepository(connection, ids.guild);
      await administration.createRole({
        id: machineRole,
        name: "Research operator",
        permissions: ["guild.read", "space.read", "knowledge.read", "agent.run"],
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "role.created", "role", machineRole),
      });
      await administration.createSpace({
        id: childSpace,
        parentSpaceId: ids.rootSpace,
        name: "Research",
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "space.created", "space", childSpace),
      });
      await administration.createSpace({
        id: emptySpace,
        parentSpaceId: ids.rootSpace,
        name: "Temporary",
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "space.created", "space", emptySpace),
      });
      await administration.renameSpace(
        childSpace,
        "Research Lab",
        ids.root,
        event(ids.guild, ids.root, "space.renamed", "space", childSpace),
      );
      await administration.createAgent({
        identityId: agent,
        displayName: "Research Agent",
        clearance: "confidential",
        roleId: machineRole,
        spaceId: childSpace,
        instructions: "Research only within the assigned Space.",
        model: "provider/model",
        toolIds: ["knowledge-search"],
        limits: constitution(ids.guild, ids.root).agentDefaults,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "agent.created", "identity", agent),
      });
      await administration.createService({
        identityId: service,
        displayName: "Webhook Service",
        clearance: "internal",
        roleId: machineRole,
        spaceId: childSpace,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "service.created", "identity", service),
      });
      await administration.archiveSpace(
        emptySpace,
        ids.root,
        event(ids.guild, ids.root, "space.archived", "space", emptySpace),
      );
    });

    const created = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const identities = await connection.query<{ kind: string; display_name: string }>(
        "SELECT kind, display_name FROM identities WHERE id = ANY($1::uuid[]) ORDER BY kind",
        [[agent, service]],
      );
      const profile = await connection.query<{ status: string; model: string }>(
        "SELECT status, model FROM agent_profiles WHERE identity_id = $1",
        [agent],
      );
      const space = await connection.query<{ name: string; status: string }>(
        "SELECT name, status FROM spaces WHERE id = $1",
        [childSpace],
      );
      const archived = await connection.query<{ status: string }>(
        "SELECT status FROM spaces WHERE id = $1",
        [emptySpace],
      );
      return { identities: identities.rows, profile: profile.rows[0], space: space.rows[0], archived: archived.rows[0] };
    });
    expect(created).toEqual({
      identities: [
        { kind: "agent", display_name: "Research Agent" },
        { kind: "service", display_name: "Webhook Service" },
      ],
      profile: { status: "active", model: "provider/model" },
      space: { name: "Research Lab", status: "active" },
      archived: { status: "archived" },
    });

    for (const nextState of ["suspended", "active"] as const) {
      await withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await new GuildDirectoryRepository(connection, ids.guild).changeMembership({
          actorIdentityId: ids.root,
          identityId: agent,
          nextState,
          chronicleEvent: event(ids.guild, ids.root, `agent.${nextState}`, "identity", agent),
        });
      });
      const status = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
        (await connection.query<{ status: string }>(
          "SELECT status FROM agent_profiles WHERE identity_id = $1",
          [agent],
        )).rows[0]?.status);
      expect(status).toBe(nextState === "suspended" ? "stopped" : "active");
    }

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildAdministrationRepository(connection, ids.guild).updateRole({
        roleId: machineRole,
        name: "Machine administrator",
        permissions: ["guild.read", "identity.manage"],
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "role.updated", "role", machineRole),
      });
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildAdministrationRepository(connection, ids.guild).archiveSpace(
        childSpace,
        ids.root,
        event(ids.guild, ids.root, "space.archived", "space", childSpace),
      );
    })).rejects.toThrow("Move or remove");

    const chronicle = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 ORDER BY sequence",
        [ids.guild],
      )).rows.map((row) => row.action));
    expect(chronicle).toEqual([
      "guild.initialized",
      "role.created",
      "space.created",
      "space.created",
      "space.renamed",
      "agent.created",
      "service.created",
      "space.archived",
      "agent.suspended",
      "agent.active",
    ]);
  });

  it("enforces governance invariants for direct SQL writes", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const machine = randomUUID();
    const directAgent = randomUUID();
    const machineRole = randomUUID();
    const child = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'service', 'Service', 'active')",
        [machine, ids.guild],
      );
      await connection.query(
        "INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES ($1, $2, 'active', 'internal', now())",
        [ids.guild, machine],
      );
      await connection.query(
        "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'agent', 'Direct Agent', 'active')",
        [directAgent, ids.guild],
      );
      await connection.query(
        "INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES ($1, $2, 'active', 'internal', now())",
        [ids.guild, directAgent],
      );
      await connection.query(
        `INSERT INTO agent_profiles
           (guild_id, identity_id, instructions, model, tool_ids, limits, status)
         VALUES ($1, $2, 'Operate within policy.', 'provider/model', ARRAY['knowledge-search'], $3::jsonb, 'active')`,
        [ids.guild, directAgent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
      );
      await connection.query(
        "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Machine', false)",
        [machineRole, ids.guild],
      );
      await connection.query(
        "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'guild.read')",
        [ids.guild, machineRole],
      );
      await connection.query(
        "INSERT INTO role_bindings (id, guild_id, identity_id, role_id) VALUES ($1, $2, $3, $4)",
        [randomUUID(), ids.guild, machine, machineRole],
      );
      await connection.query(
        "INSERT INTO spaces (id, guild_id, parent_space_id, name, status) VALUES ($1, $2, $3, 'Child', 'active')",
        [child, ids.guild, ids.rootSpace],
      );
    });

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'identity.manage')",
      [ids.guild, machineRole],
    ))).rejects.toThrow("cannot gain human-only permissions");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "UPDATE spaces SET parent_space_id = $2 WHERE guild_id = $1 AND id = $3",
      [ids.guild, child, ids.rootSpace],
    ))).rejects.toThrow("cannot contain a cycle");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, limits, status)
       VALUES ($1, $2, 'Invalid service profile', 'provider/model', $3::jsonb, 'active')`,
      [ids.guild, machine, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    ))).rejects.toThrow("require an Agent Identity");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Empty Role', false)",
      [randomUUID(), ids.guild],
    ))).rejects.toThrow("requires at least one permission");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'break-glass.use')",
      [ids.guild, machineRole],
    ))).rejects.toThrow();

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const orphanAgent = randomUUID();
      await connection.query(
        "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'agent', 'Orphan Agent', 'active')",
        [orphanAgent, ids.guild],
      );
      await connection.query(
        "INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES ($1, $2, 'active', 'internal', now())",
        [ids.guild, orphanAgent],
      );
    })).rejects.toThrow("requires an Agent profile");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "UPDATE agent_profiles SET tool_ids = ARRAY['duplicate', 'duplicate'] WHERE guild_id = $1 AND identity_id = $2",
      [ids.guild, directAgent],
    ))).rejects.toThrow("must be unique");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE memberships SET state = 'suspended' WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, directAgent],
      );
      await connection.query(
        "UPDATE identities SET status = 'disabled' WHERE guild_id = $1 AND id = $2",
        [ids.guild, directAgent],
      );
    })).rejects.toThrow("requires a stopped Agent profile");
  });
});
