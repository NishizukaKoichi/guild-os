import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildPostgresRepository, withGuildTransaction } from "@guild-os/postgres";
import { GuildCommunicationService } from "../src/communication-service.js";
import type { GuildEnv } from "../src/config.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(guildId: string, actorIdentityId: string): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorIdentityId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId,
    action: "guild.initialized",
    subjectType: "guild",
    subjectId: guildId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "communication-service-integration-test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 2,
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

function input(spaceId: string, targetRoleId: string, title: string) {
  return {
    spaceId,
    targetRoleId,
    title,
    body: `Operational notice for ${title}.`,
    visibility: "space" as const,
    classification: "internal" as const,
    allowedIdentityIds: [] as string[],
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

integration("Guild communication service authorization boundary", () => {
  it("rechecks scoped Announcement, Inbox, and Chronicle access in the Gatekeeper", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = {
      guild: randomUUID(),
      root: randomUUID(),
      manager: randomUUID(),
      reader: randomUUID(),
      siblingManager: randomUUID(),
      rootSpace: randomUUID(),
      teamSpace: randomUUID(),
      siblingSpace: randomUUID(),
      managerRole: randomUUID(),
      readerRole: randomUUID(),
    };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
        guildId: ids.guild,
        name: "Communication Service Guild",
        purpose: "Verify Gatekeeper communication authorization",
        rootIdentityId: ids.root,
        rootDisplayName: "Human Root",
        rootSpaceId: ids.rootSpace,
        rootSpaceName: "Guild",
        constitution: constitution(ids.guild, ids.root),
        roles: [{
          id: ids.managerRole,
          name: "Communication manager",
          permissions: [
            "guild.read",
            "space.read",
            "announcement.read",
            "announcement.manage",
            "inbox.read",
            "chronicle.read",
          ],
        }, {
          id: ids.readerRole,
          name: "Communication reader",
          permissions: ["guild.read", "space.read", "announcement.read", "inbox.read"],
        }],
        chronicleEvent: event(ids.guild, ids.root),
      });
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $3, $4, 'Team', 'active'), ($2, $3, $4, 'Sibling', 'active')`,
        [ids.teamSpace, ids.siblingSpace, ids.guild, ids.rootSpace],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $4, 'human', 'Team Manager', 'active'),
                ($2, $4, 'human', 'Preboarding Reader', 'active'),
                ($3, $4, 'human', 'Sibling Manager', 'active')`,
        [ids.manager, ids.reader, ids.siblingManager, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'internal', now()),
                ($1, $3, 'preboarding', 'internal', NULL),
                ($1, $4, 'active', 'internal', now())`,
        [ids.guild, ids.manager, ids.reader, ids.siblingManager],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5),
                ($6, $2, $7, $8, $5),
                ($9, $2, $10, $4, $11)`,
        [
          randomUUID(), ids.guild, ids.manager, ids.managerRole, ids.teamSpace,
          randomUUID(), ids.reader, ids.readerRole,
          randomUUID(), ids.siblingManager, ids.siblingSpace,
        ],
      );
    });

    const env = {
      GUILD_ID: ids.guild,
      HYPERDRIVE: { connectionString },
    } as GuildEnv;
    const root = new GuildCommunicationService(env, ids.root);
    const manager = new GuildCommunicationService(env, ids.manager);
    const reader = new GuildCommunicationService(env, ids.reader);
    const siblingManager = new GuildCommunicationService(env, ids.siblingManager);

    const teamId = await root.createAnnouncement(
      input(ids.teamSpace, ids.readerRole, "TEAM_NOTICE_MARKER"),
    );
    const hiddenId = await root.createAnnouncement(
      input(ids.siblingSpace, ids.readerRole, "SIBLING_NOTICE_SECRET_MARKER"),
    );

    const managerDrafts = await manager.getAnnouncementPage();
    expect(managerDrafts.items.map((announcement) => announcement.id)).toEqual([teamId]);
    expect(JSON.stringify(managerDrafts)).not.toContain("SIBLING_NOTICE_SECRET_MARKER");
    await expect(manager.getAnnouncement(hiddenId)).rejects.toThrow();
    await expect(reader.createAnnouncement(
      input(ids.teamSpace, ids.readerRole, "Unauthorized notice"),
    )).rejects.toThrow();

    expect(await root.publishAnnouncement({
      announcementId: teamId,
      expectedVersion: 1,
    })).toEqual({ version: 2, recipientCount: 1 });

    const readerPage = await reader.getAnnouncementPage();
    expect(readerPage.items.map((announcement) => announcement.id)).toEqual([teamId]);
    expect(readerPage.items[0]?.capabilities.publish).toBe(false);

    const inbox = await reader.getInboxPage({ unreadOnly: true });
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0]?.resourceId).toBe(teamId);
    expect(await reader.markInboxRead({
      notificationId: inbox.items[0]!.id,
      read: true,
    })).not.toBeNull();
    expect((await reader.getInboxPage({ unreadOnly: true })).items).toHaveLength(0);

    const chronicle = await manager.getChroniclePage({
      search: "announcement",
      subjectType: "announcement",
    });
    expect(chronicle.items.map((entry) => entry.subjectId)).toContain(teamId);
    expect(chronicle.items.map((entry) => entry.subjectId)).not.toContain(hiddenId);
    expect(JSON.stringify(chronicle)).not.toContain("SIBLING_NOTICE_SECRET_MARKER");
    await expect(reader.getChroniclePage()).rejects.toThrow(
      "Chronicle is available only to active Guild members",
    );
    expect((await siblingManager.getChroniclePage({ subjectType: "announcement" }))
      .items.map((entry) => entry.subjectId)).toContain(hiddenId);

    await withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        "DELETE FROM role_bindings WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, ids.reader],
      ));
    await expect(reader.getInboxPage()).rejects.toThrow();
  });
});
