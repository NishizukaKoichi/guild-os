import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildGovernanceRepository } from "./governance.js";
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
  details: ChronicleEvent["details"],
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
    details,
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
      maxBudgetMinor: 1_000,
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
    member: randomUUID(),
    rootSpace: randomUUID(),
    memberRole: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    const repository = new GuildPostgresRepository(connection, ids.guild);
    await repository.bootstrapGuild({
      guildId: ids.guild,
      name: "Constitution Governance Guild",
      purpose: "Verify Root-only Constitution governance",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{ id: ids.memberRole, name: "Member", permissions: ["guild.read"] }],
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "guild.initialized",
        "guild",
        ids.guild,
        { source: "governance-integration-test" },
      ),
    });
    await repository.enrollPreboardingMember({
      identityId: ids.member,
      displayName: "Member",
      chronicleEvent: event(
        ids.guild,
        ids.member,
        "membership.enrolled",
        "identity",
        ids.member,
        { source: "governance-integration-test" },
      ),
    });
  });
  return ids;
}

integration("Guild Constitution governance", () => {
  it("allows only the active human Root Owner to make a versioned, audited update", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const reason = "Require two approvals for externally visible actions.";
    const updated = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildGovernanceRepository(
        connection,
        ids.guild,
      ).updateConstitution({
        expectedVersion: 1,
        level2ApprovalQuorum: 2,
        level3ApprovalQuorum: 3,
        dataRetentionDays: 730,
        agentDefaults: {
          currency: "AUD",
          maxBudgetMinor: 2_500,
          maxDurationSeconds: 1_200,
          maxSteps: 24,
          maxRetries: 1,
          maxDelegationDepth: 0,
        },
        reason,
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "constitution.updated",
          "constitution",
          ids.guild,
          { previousVersion: 1, nextVersion: 2, reason },
        ),
      }),
    );

    expect(updated).toMatchObject({
      guildId: ids.guild,
      version: 2,
      level2ApprovalQuorum: 2,
      level3ApprovalQuorum: 3,
      dataRetentionDays: 730,
      updatedByIdentityId: ids.root,
    });
    expect(updated.agentDefaults.currency).toBe("AUD");

    const audit = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ action: string; reason: string }>(
        `SELECT action, details ->> 'reason' AS reason
           FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'constitution'
          ORDER BY sequence DESC
          LIMIT 1`,
        [ids.guild],
      ));
    expect(audit.rows[0]).toEqual({ action: "constitution.updated", reason });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).updateConstitution({
        expectedVersion: 1,
        level2ApprovalQuorum: 2,
        level3ApprovalQuorum: 3,
        dataRetentionDays: 730,
        agentDefaults: updated.agentDefaults,
        reason: "Attempt a stale update.",
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "constitution.updated",
          "constitution",
          ids.guild,
          { reason: "Attempt a stale update." },
        ),
      }))).rejects.toThrow("changed since it was loaded");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).updateConstitution({
        expectedVersion: 2,
        level2ApprovalQuorum: 2,
        level3ApprovalQuorum: 3,
        dataRetentionDays: 730,
        agentDefaults: updated.agentDefaults,
        reason: "Attempt a non-Root update.",
        actorIdentityId: ids.member,
        chronicleEvent: event(
          ids.guild,
          ids.member,
          "constitution.updated",
          "constitution",
          ids.guild,
          { reason: "Attempt a non-Root update." },
        ),
      }))).rejects.toThrow("Only the active human Root Owner");
  });

  it("rejects delegated Root authority and bypass attempts at the SQL boundary", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const customRole = randomUUID();

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Forbidden Root', false)",
        [customRole, ids.guild],
      );
      await connection.query(
        "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'constitution.update')",
        [ids.guild, customRole],
      );
    })).rejects.toThrow(/role_permissions_no_root_authority|check constraint/i);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.member]);
      await connection.query(
        `UPDATE constitutions
            SET version = version + 1, updated_by_identity_id = $2
          WHERE guild_id = $1`,
        [ids.guild, ids.root],
      );
    })).rejects.toThrow("Only the active human Root Owner");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query("DELETE FROM constitutions WHERE guild_id = $1", [ids.guild]);
    })).rejects.toThrow("A Guild Constitution cannot be deleted");
  });
});
