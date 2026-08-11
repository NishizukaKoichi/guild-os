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
    target: randomUUID(),
    rootSpace: randomUUID(),
    memberRole: randomUUID(),
    outgoingRole: randomUUID(),
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
    await connection.query(
      `INSERT INTO identities
         (id, guild_id, kind, display_name, status, preferred_locale, access_subject)
       VALUES ($1, $2, 'human', 'Successor', 'active', 'en', $3)`,
      [ids.target, ids.guild, `cloudflare-os-account:${ids.target}`],
    );
    await connection.query(
      `INSERT INTO memberships
         (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now())`,
      [ids.guild, ids.target],
    );
    await connection.query(
      "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Steward', false)",
      [ids.outgoingRole, ids.guild],
    );
    await connection.query(
      "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'guild.read')",
      [ids.guild, ids.outgoingRole],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, NULL)`,
      [randomUUID(), ids.guild, ids.target, ids.memberRole],
    );
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

  it("transfers Root ownership only after the designated Human accepts and preserves an audit trail", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const transferId = randomUUID();
    const proposalReason = "Move final stewardship to the incoming Guild lead.";

    const proposed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).proposeRootOwnershipTransfer({
        id: transferId,
        toIdentityId: ids.target,
        outgoingRoleId: ids.outgoingRole,
        reason: proposalReason,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          transferId,
          { reason: proposalReason },
        ),
      }));
    expect(proposed).toMatchObject({
      id: transferId,
      fromIdentityId: ids.root,
      toIdentityId: ids.target,
      outgoingRoleId: ids.outgoingRole,
      state: "pending",
      version: 1,
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).acceptRootOwnershipTransfer({
        transferId,
        expectedVersion: 1,
        reason: "The current Root cannot accept on the successor's behalf.",
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.accepted",
          "root_ownership_transfer",
          transferId,
          { reason: "The current Root cannot accept on the successor's behalf." },
        ),
      }))).rejects.toThrow("designated active Human");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE guilds SET root_owner_identity_id = $2 WHERE id = $1",
        [ids.guild, ids.target],
      );
    })).rejects.toThrow("accepted two-party transfer");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE roles SET name = 'Changed Steward' WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.outgoingRole],
      );
    })).rejects.toThrow("pending Root ownership transfer is immutable");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "DELETE FROM role_permissions WHERE guild_id = $1 AND role_id = $2",
        [ids.guild, ids.outgoingRole],
      );
    })).rejects.toThrow("Permissions for a Role in a pending Root ownership transfer are immutable");

    const acceptanceReason = "I accept responsibility for this Guild.";
    const accepted = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).acceptRootOwnershipTransfer({
        transferId,
        expectedVersion: 1,
        reason: acceptanceReason,
        actorIdentityId: ids.target,
        chronicleEvent: event(
          ids.guild,
          ids.target,
          "root_ownership.transfer.accepted",
          "root_ownership_transfer",
          transferId,
          { reason: acceptanceReason },
        ),
      }));
    expect(accepted).toMatchObject({ state: "accepted", version: 2 });

    const persisted = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const guild = await connection.query<{ root_owner_identity_id: string }>(
        "SELECT root_owner_identity_id::text FROM guilds WHERE id = $1",
        [ids.guild],
      );
      const outgoingBinding = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM role_bindings
          WHERE guild_id = $1 AND identity_id = $2 AND role_id = $3 AND space_id IS NULL`,
        [ids.guild, ids.root, ids.outgoingRole],
      );
      const audit = await connection.query<{
        action: string;
        actor_identity_id: string;
        outgoing_role_name: string | null;
      }>(
        `SELECT action, actor_identity_id::text,
                details ->> 'outgoingRoleName' AS outgoing_role_name
           FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'root_ownership_transfer'
            AND subject_id = $2
          ORDER BY sequence`,
        [ids.guild, transferId],
      );
      const notifications = await connection.query<{ recipient_identity_id: string }>(
        `SELECT recipient_identity_id::text FROM inbox_notifications
          WHERE guild_id = $1 AND resource_type = 'root_ownership_transfer'
            AND resource_id = $2 ORDER BY created_at`,
        [ids.guild, transferId],
      );
      return { guild, outgoingBinding, audit, notifications };
    });
    expect(persisted.guild.rows[0]?.root_owner_identity_id).toBe(ids.target);
    expect(persisted.outgoingBinding.rows[0]?.count).toBe("1");
    expect(persisted.audit.rows).toEqual([
      {
        action: "root_ownership.transfer.proposed",
        actor_identity_id: ids.root,
        outgoing_role_name: "Steward",
      },
      {
        action: "root_ownership.transfer.accepted",
        actor_identity_id: ids.target,
        outgoing_role_name: null,
      },
    ]);
    expect(persisted.notifications.rows.map((row) => row.recipient_identity_id)).toEqual([
      ids.target,
      ids.root,
    ]);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).updateConstitution({
        expectedVersion: 1,
        level2ApprovalQuorum: 1,
        level3ApprovalQuorum: 2,
        dataRetentionDays: 365,
        agentDefaults: constitution(ids.guild, ids.root).agentDefaults,
        reason: "The previous Root no longer has Root authority.",
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "constitution.updated",
          "constitution",
          ids.guild,
          { reason: "The previous Root no longer has Root authority." },
        ),
      }))).rejects.toThrow("Only the active human Root Owner");
  });

  it("supports cancellation, rejects unaudited proposals, and expires stale proposals before replacement", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query(
        `INSERT INTO root_ownership_transfers
           (id, guild_id, from_identity_id, to_identity_id, outgoing_role_id, reason, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'Unaudited direct proposal', now() + interval '1 day')`,
        [randomUUID(), ids.guild, ids.root, ids.target, ids.outgoingRole],
      );
    })).rejects.toThrow("requires an atomic Chronicle event");

    const cancelledId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).proposeRootOwnershipTransfer({
        id: cancelledId,
        toIdentityId: ids.target,
        outgoingRoleId: ids.outgoingRole,
        reason: "Test explicit cancellation.",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          cancelledId,
          { reason: "Test explicit cancellation." },
        ),
      }));
    const cancelled = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).cancelRootOwnershipTransfer({
        transferId: cancelledId,
        expectedVersion: 1,
        reason: "The handover plan changed.",
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.cancelled",
          "root_ownership_transfer",
          cancelledId,
          { reason: "The handover plan changed." },
        ),
      }));
    expect(cancelled).toMatchObject({ state: "cancelled", version: 2 });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "DELETE FROM root_ownership_transfers WHERE guild_id = $1 AND id = $2",
        [ids.guild, cancelledId],
      );
    })).rejects.toThrow("history is append-only");

    const staleId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).proposeRootOwnershipTransfer({
        id: staleId,
        toIdentityId: ids.target,
        outgoingRoleId: ids.outgoingRole,
        reason: "Allow this proposal to expire.",
        expiresAt: new Date(Date.now() + 700).toISOString(),
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          staleId,
          { reason: "Allow this proposal to expire." },
        ),
      }));
    await new Promise((resolve) => setTimeout(resolve, 850));
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).acceptRootOwnershipTransfer({
        transferId: staleId,
        expectedVersion: 1,
        reason: "Too late.",
        actorIdentityId: ids.target,
        chronicleEvent: event(
          ids.guild,
          ids.target,
          "root_ownership.transfer.accepted",
          "root_ownership_transfer",
          staleId,
          { reason: "Too late." },
        ),
      }))).rejects.toThrow("expired");

    const replacementId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).proposeRootOwnershipTransfer({
        id: replacementId,
        toIdentityId: ids.target,
        outgoingRoleId: ids.outgoingRole,
        reason: "Create a fresh proposal after expiry.",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          replacementId,
          { reason: "Create a fresh proposal after expiry." },
        ),
      }));
    const expiry = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ state: string; action: string }>(
        `SELECT transfer.state, event.action
           FROM root_ownership_transfers transfer
           JOIN chronicle_events event
             ON event.guild_id = transfer.guild_id
            AND event.subject_type = 'root_ownership_transfer'
            AND event.subject_id = transfer.id
            AND event.action = 'root_ownership.transfer.expired'
          WHERE transfer.guild_id = $1 AND transfer.id = $2`,
        [ids.guild, staleId],
      ));
    expect(expiry.rows[0]).toEqual({ state: "expired", action: "root_ownership.transfer.expired" });
  });
});
