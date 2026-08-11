import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildGovernanceRepository } from "./governance.js";
import {
  GuildRecoveryRepository,
  type BreakGlassCodeHash,
} from "./recovery.js";
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

function recoveryCodes(generation: number): { raw: string; stored: BreakGlassCodeHash }[] {
  return Array.from({ length: 10 }, (_, index) => {
    const suffix = `${generation}-${index}`.padEnd(32, String(index));
    const raw = `gbr_${suffix}`;
    return {
      raw,
      stored: {
        id: randomUUID(),
        hash: createHash("sha256").update(raw).digest("hex"),
        hint: Buffer.from(`${generation}${index}seed`).toString("base64url").slice(0, 6),
      },
    };
  });
}

async function bootstrapFixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    target: randomUUID(),
    suspended: randomUUID(),
    rootSpace: randomUUID(),
    memberRole: randomUUID(),
    outgoingRole: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    const repository = new GuildPostgresRepository(connection, ids.guild);
    await repository.bootstrapGuild({
      guildId: ids.guild,
      name: "Recovery Guild",
      purpose: "Verify independent emergency ownership recovery",
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
        { source: "recovery-integration-test" },
      ),
    });
    await connection.query(
      "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, 'Steward', false)",
      [ids.outgoingRole, ids.guild],
    );
    await connection.query(
      "INSERT INTO role_permissions (guild_id, role_id, permission) VALUES ($1, $2, 'guild.read')",
      [ids.guild, ids.outgoingRole],
    );
    for (const [id, name, state, status] of [
      [ids.member, "Active Member", "active", "active"],
      [ids.target, "Transfer Target", "active", "active"],
      [ids.suspended, "Suspended Member", "suspended", "disabled"],
    ] as const) {
      await connection.query(
        `INSERT INTO identities
           (id, guild_id, kind, display_name, status, preferred_locale, access_subject)
         VALUES ($1, $2, 'human', $3, $4, 'en', $5)`,
        [id, ids.guild, name, status, `cloudflare-os-account:${id}`],
      );
      await connection.query(
        `INSERT INTO memberships
           (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, $3, 'restricted', now())`,
        [ids.guild, id, state],
      );
    }
  });
  return ids;
}

async function rotate(
  ids: Awaited<ReturnType<typeof bootstrapFixture>>,
  generation: number,
  expectedVersion: number,
) {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const codeSetId = randomUUID();
  const codes = recoveryCodes(generation);
  const reason = `Rotate recovery generation ${generation}.`;
  const status = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
    new GuildRecoveryRepository(connection, ids.guild).rotateBreakGlassCodes({
      codeSetId,
      expectedVersion,
      outgoingRoleId: ids.outgoingRole,
      reason,
      expiresInDays: 30,
      actorIdentityId: ids.root,
      codes: codes.map((code) => code.stored),
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "break_glass.codes.rotated",
        "break_glass_code_set",
        codeSetId,
        { reason },
      ),
    }));
  return { codeSetId, codes, status };
}

function recoveryEvent(
  guildId: string,
  actorId: string,
  recoveryId: string,
  reason: string,
  viewedInformation: string,
  changesMade: string,
): ChronicleEvent {
  return event(
    guildId,
    actorId,
    "break_glass.used",
    "break_glass_recovery",
    recoveryId,
    { reason, viewedInformation, changesMade },
  );
}

integration("Break Glass recovery", () => {
  it("rotates only hashed one-time codes under current Root authority", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const first = await rotate(ids, 1, 0);
    expect(first.status).toMatchObject({
      available: true,
      version: 1,
      currentCodeSetId: first.codeSetId,
      generation: 1,
      outgoingRoleId: ids.outgoingRole,
      outgoingRoleName: "Steward",
      remainingCodeCount: 10,
    });

    const stored = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ code_hash: string; code_hint: string }>(
        `SELECT code_hash, code_hint FROM break_glass_codes
          WHERE guild_id = $1 AND code_set_id = $2 ORDER BY id`,
        [ids.guild, first.codeSetId],
      ));
    expect(stored.rows).toHaveLength(10);
    expect(stored.rows.every((row) => /^[a-f0-9]{64}$/.test(row.code_hash))).toBe(true);
    expect(JSON.stringify(stored.rows)).not.toContain(first.codes[0]!.raw);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const codeSetId = randomUUID();
      return new GuildRecoveryRepository(connection, ids.guild).rotateBreakGlassCodes({
        codeSetId,
        expectedVersion: 1,
        outgoingRoleId: ids.outgoingRole,
        reason: "A member must not rotate recovery credentials.",
        expiresInDays: 30,
        actorIdentityId: ids.member,
        codes: recoveryCodes(2).map((code) => code.stored),
        chronicleEvent: event(
          ids.guild,
          ids.member,
          "break_glass.codes.rotated",
          "break_glass_code_set",
          codeSetId,
          { reason: "A member must not rotate recovery credentials." },
        ),
      });
    })).rejects.toThrow("Only the active human Root Owner");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE roles SET name = 'Mutated' WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.outgoingRole],
      );
    })).rejects.toThrow("active ownership or recovery ceremony is immutable");

    const second = await rotate(ids, 2, 1);
    expect(second.status).toMatchObject({ version: 2, generation: 2, remainingCodeCount: 10 });
    const oldRecoveryId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId: oldRecoveryId,
        codeHash: first.codes[0]!.stored.hash,
        accountIdentityId: ids.member,
        displayName: "Active Member",
        preferredLocale: "en",
        reason: "Old generations must remain invalid.",
        viewedInformation: "Current Root identity and recovery policy.",
        changesMade: "No changes because the credential is stale.",
        chronicleEvent: recoveryEvent(
          ids.guild,
          ids.member,
          oldRecoveryId,
          "Old generations must remain invalid.",
          "Current Root identity and recovery policy.",
          "No changes because the credential is stale.",
        ),
      }))).rejects.toThrow("invalid or unavailable");
  });

  it("recovers to an active Human atomically and supersedes a pending transfer", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const generated = await rotate(ids, 1, 0);
    const transferId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildGovernanceRepository(connection, ids.guild).proposeRootOwnershipTransfer({
        id: transferId,
        toIdentityId: ids.target,
        outgoingRoleId: ids.outgoingRole,
        reason: "A normal handover remains pending.",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          transferId,
          { reason: "A normal handover remains pending." },
        ),
      }));
    const recoveryId = randomUUID();
    const reason = "The current Root is unavailable and continuity has been verified offline.";
    const viewedInformation = "Guild name, current Root identity, and selected outgoing Role.";
    const changesMade = "Transferred Root ownership, invalidated the generation, and retained the old Root as Steward.";
    const recovered = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId,
        codeHash: generated.codes[0]!.stored.hash,
        accountIdentityId: ids.member,
        displayName: "Ignored replacement name",
        preferredLocale: "ja",
        reason,
        viewedInformation,
        changesMade,
        chronicleEvent: recoveryEvent(
          ids.guild,
          ids.member,
          recoveryId,
          reason,
          viewedInformation,
          changesMade,
        ),
      }));
    expect(recovered).toMatchObject({
      id: recoveryId,
      previousRootIdentityId: ids.root,
      newRootIdentityId: ids.member,
      outgoingRoleId: ids.outgoingRole,
      actorWasExistingIdentity: true,
      state: "completed",
    });

    const persisted = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const guild = await connection.query<{ root_owner_identity_id: string }>(
        "SELECT root_owner_identity_id::text FROM guilds WHERE id = $1",
        [ids.guild],
      );
      const configuration = await connection.query<{
        current_code_set_id: string | null;
        version: number;
      }>(
        `SELECT current_code_set_id::text, version FROM break_glass_configurations
          WHERE guild_id = $1`,
        [ids.guild],
      );
      const transfer = await connection.query<{ state: string }>(
        "SELECT state FROM root_ownership_transfers WHERE guild_id = $1 AND id = $2",
        [ids.guild, transferId],
      );
      const oldRootRole = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM role_bindings
          WHERE guild_id = $1 AND identity_id = $2 AND role_id = $3 AND space_id IS NULL`,
        [ids.guild, ids.root, ids.outgoingRole],
      );
      const actions = await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND action IN ('break_glass.used', 'root_ownership.transfer.superseded')
          ORDER BY sequence`,
        [ids.guild],
      );
      const codeState = await connection.query<{
        consumed: string;
        unused: string;
      }>(
        `SELECT count(*) FILTER (WHERE consumed_at IS NOT NULL)::text AS consumed,
                count(*) FILTER (WHERE consumed_at IS NULL)::text AS unused
           FROM break_glass_codes WHERE guild_id = $1 AND code_set_id = $2`,
        [ids.guild, generated.codeSetId],
      );
      return { guild, configuration, transfer, oldRootRole, actions, codeState };
    });
    expect(persisted.guild.rows[0]?.root_owner_identity_id).toBe(ids.member);
    expect(persisted.configuration.rows[0]).toEqual({ current_code_set_id: null, version: 2 });
    expect(persisted.transfer.rows[0]?.state).toBe("superseded");
    expect(persisted.oldRootRole.rows[0]?.count).toBe("1");
    expect(persisted.actions.rows.map((row) => row.action)).toEqual([
      "root_ownership.transfer.superseded",
      "break_glass.used",
    ]);
    expect(persisted.codeState.rows[0]).toEqual({ consumed: "1", unused: "9" });

    const reusedId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId: reusedId,
        codeHash: generated.codes[1]!.stored.hash,
        accountIdentityId: ids.target,
        displayName: "Transfer Target",
        preferredLocale: "en",
        reason: "The rest of a used generation must be invalid.",
        viewedInformation: "No protected information was disclosed.",
        changesMade: "No changes were made.",
        chronicleEvent: recoveryEvent(
          ids.guild,
          ids.target,
          reusedId,
          "The rest of a used generation must be invalid.",
          "No protected information was disclosed.",
          "No changes were made.",
        ),
      }))).rejects.toThrow("invalid or unavailable");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE break_glass_recoveries SET reason = 'tampered' WHERE guild_id = $1 AND id = $2",
        [ids.guild, recoveryId],
      );
    })).rejects.toThrow("Invalid Break Glass recovery transition");
  });

  it("invalidates the previous Root recovery generation during a normal handover", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const generated = await rotate(ids, 1, 0);
    const transferId = randomUUID();
    const proposalReason = "Transfer stewardship through the normal two-Human ceremony.";
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
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

    const acceptanceReason = "Accept ownership and establish new recovery custody.";
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.target]);
      await connection.query("SELECT set_config('app.root_transfer_id', $1, true)", [transferId]);
      await connection.query(
        "UPDATE guilds SET root_owner_identity_id = $2 WHERE id = $1",
        [ids.guild, ids.target],
      );
      await connection.query(
        `UPDATE root_ownership_transfers
            SET state = 'accepted', version = version + 1, resolved_at = now()
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, transferId],
      );
      await new GuildPostgresRepository(connection, ids.guild).appendChronicle(event(
        ids.guild,
        ids.target,
        "root_ownership.transfer.accepted",
        "root_ownership_transfer",
        transferId,
        { reason: acceptanceReason },
      ));
    })).rejects.toThrow("must invalidate existing Break Glass codes");

    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
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

    const persisted = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const guild = await connection.query<{ root_owner_identity_id: string }>(
        "SELECT root_owner_identity_id::text FROM guilds WHERE id = $1",
        [ids.guild],
      );
      const configuration = await connection.query<{
        current_code_set_id: string | null;
        version: number;
      }>(
        `SELECT current_code_set_id::text, version
           FROM break_glass_configurations WHERE guild_id = $1`,
        [ids.guild],
      );
      const actions = await connection.query<{ action: string; actor_identity_id: string }>(
        `SELECT action, actor_identity_id::text
           FROM chronicle_events
          WHERE guild_id = $1
            AND action IN ('root_ownership.transfer.accepted', 'break_glass.codes.revoked')
          ORDER BY sequence`,
        [ids.guild],
      );
      return { guild, configuration, actions };
    });
    expect(persisted.guild.rows[0]?.root_owner_identity_id).toBe(ids.target);
    expect(persisted.configuration.rows[0]).toEqual({ current_code_set_id: null, version: 2 });
    expect(persisted.actions.rows).toEqual([
      { action: "root_ownership.transfer.accepted", actor_identity_id: ids.target },
      { action: "break_glass.codes.revoked", actor_identity_id: ids.target },
    ]);

    const recoveryId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId,
        codeHash: generated.codes[0]!.stored.hash,
        accountIdentityId: ids.member,
        displayName: "Active Member",
        preferredLocale: "en",
        reason: "A code retained across handover must not recover ownership.",
        viewedInformation: "No protected information was disclosed.",
        changesMade: "No changes were made.",
        chronicleEvent: recoveryEvent(
          ids.guild,
          ids.member,
          recoveryId,
          "A code retained across handover must not recover ownership.",
          "No protected information was disclosed.",
          "No changes were made.",
        ),
      }))).rejects.toThrow("invalid or unavailable");
  });

  it("creates an independent active Human for an authenticated unknown account", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const generated = await rotate(ids, 1, 0);
    const unknown = randomUUID();
    const recoveryId = randomUUID();
    const reason = "Use the offline credential after loss of every enrolled administrator.";
    const viewedInformation = "Guild name and emergency recovery policy.";
    const changesMade = "Created a restricted Human membership and transferred Root ownership.";
    const recovered = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId,
        codeHash: generated.codes[0]!.stored.hash,
        accountIdentityId: unknown,
        displayName: "Recovery Custodian",
        preferredLocale: "ja",
        reason,
        viewedInformation,
        changesMade,
        chronicleEvent: recoveryEvent(
          ids.guild,
          unknown,
          recoveryId,
          reason,
          viewedInformation,
          changesMade,
        ),
      }));
    expect(recovered.actorWasExistingIdentity).toBe(false);

    const identity = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{
        display_name: string;
        preferred_locale: string;
        access_subject: string;
        state: string;
        clearance: string;
      }>(
        `SELECT identity_row.display_name, identity_row.preferred_locale,
                identity_row.access_subject, membership_row.state, membership_row.clearance
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
          WHERE identity_row.guild_id = $1 AND identity_row.id = $2`,
        [ids.guild, unknown],
      ));
    expect(identity.rows[0]).toEqual({
      display_name: "Recovery Custodian",
      preferred_locale: "ja",
      access_subject: `cloudflare-os-account:${unknown}`,
      state: "active",
      clearance: "restricted",
    });
  });

  it("rejects inactive Humans and requires an atomic audit for configuration changes", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const generated = await rotate(ids, 1, 0);
    const recoveryId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).recoverRootOwnership({
        recoveryId,
        codeHash: generated.codes[0]!.stored.hash,
        accountIdentityId: ids.suspended,
        displayName: "Suspended Member",
        preferredLocale: "en",
        reason: "A suspended identity must not recover ownership.",
        viewedInformation: "No protected information was disclosed.",
        changesMade: "No changes were made.",
        chronicleEvent: recoveryEvent(
          ids.guild,
          ids.suspended,
          recoveryId,
          "A suspended identity must not recover ownership.",
          "No protected information was disclosed.",
          "No changes were made.",
        ),
      }))).rejects.toThrow("invalid or unavailable");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query(
        `UPDATE break_glass_configurations
            SET current_code_set_id = NULL, version = version + 1,
                updated_by_identity_id = $2
          WHERE guild_id = $1`,
        [ids.guild, ids.root],
      );
    })).rejects.toThrow("requires an atomic Chronicle event");

    const revoked = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildRecoveryRepository(connection, ids.guild).revokeBreakGlassCodes({
        expectedVersion: 1,
        reason: "Replace the offline custody group.",
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "break_glass.codes.revoked",
          "break_glass_code_set",
          generated.codeSetId,
          { reason: "Replace the offline custody group." },
        ),
      }));
    expect(revoked).toMatchObject({ available: false, version: 2, currentCodeSetId: null });
  });
});
