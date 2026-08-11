import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ChronicleEvent,
  Constitution,
  SecuredResource,
} from "@guild-os/domain";
import { GuildAnnouncementRepository } from "./announcement.js";
import { GuildChronicleQueryRepository } from "./chronicle-query.js";
import { GuildInboxRepository } from "./inbox.js";
import { GuildKnowledgeRepository } from "./knowledge.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectId: string,
  resource: SecuredResource,
  subjectType = "announcement",
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: resource.spaceId,
    ownerIdentityId: resource.ownerIdentityId,
    visibility: resource.visibility,
    classification: resource.classification,
    allowedIdentityIds: resource.allowedIdentityIds ?? [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "communication-integration-test" },
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

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    manager: randomUUID(),
    agent: randomUUID(),
    siblingReader: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    siblingSpace: randomUUID(),
    managerRole: randomUUID(),
    readerRole: randomUUID(),
  };
  const recipientIds = Array.from({ length: 25 }, () => randomUUID());
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Communication Guild",
      purpose: "Verify scoped organizational communications",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
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
        name: "Announcement reader",
        permissions: [
          "guild.read",
          "space.read",
          "announcement.read",
          "inbox.read",
          "knowledge.read",
        ],
      }],
      chronicleEvent: {
        id: randomUUID(),
        guildId: ids.guild,
        spaceId: null,
        ownerIdentityId: ids.root,
        visibility: "guild",
        classification: "restricted",
        allowedIdentityIds: [],
        actorIdentityId: ids.root,
        action: "guild.initialized",
        subjectType: "guild",
        subjectId: ids.guild,
        correlationId: randomUUID(),
        occurredAt: new Date().toISOString(),
        details: { source: "communication-integration-test" },
      },
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'), ($4, $2, $3, 'Sibling', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.siblingSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $4, 'human', 'Manager', 'active'),
              ($2, $4, 'agent', 'Announcement Agent', 'active'),
              ($3, $4, 'human', 'Sibling Reader', 'active')`,
      [ids.manager, ids.agent, ids.siblingReader, ids.guild],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status, preferred_locale)
       SELECT recipient_id, $1, 'human', 'Reader ' || ordinal::text, 'active',
              CASE WHEN ordinal % 2 = 0 THEN 'ja' ELSE 'en' END
         FROM unnest($2::uuid[]) WITH ORDINALITY AS recipients(recipient_id, ordinal)`,
      [ids.guild, recipientIds],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now())`,
      [ids.guild, ids.manager, ids.agent, ids.siblingReader],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       SELECT $1, recipient_id,
              CASE WHEN ordinal = 1 THEN 'preboarding' ELSE 'active' END,
              'internal',
              CASE WHEN ordinal = 1 THEN NULL ELSE now() END
         FROM unnest($2::uuid[]) WITH ORDINALITY AS recipients(recipient_id, ordinal)`,
      [ids.guild, recipientIds],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Read announcements only.', 'test/model', '{}',
               '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
               'active')`,
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9)`,
      [
        randomUUID(), ids.guild, ids.manager, ids.managerRole, ids.teamSpace,
        randomUUID(), ids.siblingReader, ids.readerRole, ids.siblingSpace,
      ],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       SELECT binding_id, $1, recipient_id, $2, $3
         FROM unnest($4::uuid[], $5::uuid[]) AS bindings(binding_id, recipient_id)`,
      [
        ids.guild,
        ids.readerRole,
        ids.teamSpace,
        recipientIds.map(() => randomUUID()),
        recipientIds,
      ],
    );
  });
  return { ids, recipientIds };
}

integration("Guild communication repositories", () => {
  it("publishes to a scoped Role, protects Inbox payloads, and filters Chronicle before return", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const { ids, recipientIds } = await fixture();
    const announcementId = randomUUID();
    const hiddenAnnouncementId = randomUUID();
    const archivedDraftId = randomUUID();
    const boundary: SecuredResource = {
      id: announcementId,
      guildId: ids.guild,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.root,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
    };
    const hiddenBoundary: SecuredResource = {
      ...boundary,
      id: hiddenAnnouncementId,
      spaceId: ids.siblingSpace,
    };
    const archivedBoundary: SecuredResource = {
      ...boundary,
      id: archivedDraftId,
    };

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAnnouncementRepository(connection, ids.guild);
      await repository.createAnnouncement({
        id: announcementId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        targetRoleId: ids.readerRole,
        title: "Team review window",
        body: "Submit review notes before Friday.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        expiresAt: "2030-01-01T00:00:00.000Z",
        chronicleEvent: event(ids.guild, ids.root, "announcement.created", announcementId, boundary),
      });
      await repository.createAnnouncement({
        id: hiddenAnnouncementId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.siblingSpace,
        targetRoleId: ids.readerRole,
        title: "Sibling review window",
        body: "This must remain inside the sibling Space.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        expiresAt: "2030-01-01T00:00:00.000Z",
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "announcement.created",
          hiddenAnnouncementId,
          hiddenBoundary,
        ),
      });
      await repository.createAnnouncement({
        id: archivedDraftId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        targetRoleId: ids.readerRole,
        title: "Unpublished draft",
        body: "Archive this without inventing a publication timestamp.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        expiresAt: "2030-01-01T00:00:00.000Z",
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "announcement.created",
          archivedDraftId,
          archivedBoundary,
        ),
      });
      await repository.archive({
        announcementId: archivedDraftId,
        actorIdentityId: ids.root,
        expectedVersion: 1,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "announcement.archived",
          archivedDraftId,
          archivedBoundary,
        ),
      });
    });

    const archivedDraft = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildAnnouncementRepository(connection, ids.guild)
        .getAnnouncement(ids.root, archivedDraftId),
    );
    expect(archivedDraft.status).toBe("archived");
    expect(archivedDraft.publishedAt).toBeNull();

    const draftReaderPage = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildAnnouncementRepository(connection, ids.guild)
        .listAnnouncements(recipientIds[1]!),
    );
    expect(draftReaderPage.items).toHaveLength(0);

    const version = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAnnouncementRepository(connection, ids.guild);
      return repository.saveDraft({
        announcementId,
        actorIdentityId: ids.root,
        expectedVersion: 1,
        spaceId: ids.teamSpace,
        targetRoleId: ids.readerRole,
        title: "Team review window",
        body: "Submit verified review notes before Friday.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        expiresAt: "2030-01-01T00:00:00.000Z",
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "announcement.draft.updated",
          announcementId,
          boundary,
        ),
      });
    });
    expect(version).toBe(2);

    const published = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildAnnouncementRepository(connection, ids.guild).publish({
        announcementId,
        actorIdentityId: ids.root,
        expectedVersion: 2,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "announcement.published",
          announcementId,
          boundary,
        ),
      }));
    expect(published).toEqual({ version: 3, recipientCount: 25 });

    const readerPage = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildAnnouncementRepository(connection, ids.guild)
        .listAnnouncements(recipientIds[0]!),
    );
    expect(readerPage.items.map((announcement) => announcement.id)).toEqual([announcementId]);

    const siblingPage = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildAnnouncementRepository(connection, ids.guild)
        .listAnnouncements(ids.siblingReader),
    );
    expect(siblingPage.items).toHaveLength(0);

    const preboardingInbox = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildInboxRepository(connection, ids.guild)
        .listNotifications(recipientIds[0]!),
    );
    expect(preboardingInbox.unreadCount).toBe(1);
    expect(preboardingInbox.items[0]?.resourceId).toBe(announcementId);

    const readAt = await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildInboxRepository(connection, ids.guild).markRead(
        recipientIds[0]!,
        preboardingInbox.items[0]!.id,
        true,
      ));
    expect(readAt).not.toBeNull();

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        "UPDATE inbox_notifications SET title = 'tampered' WHERE guild_id = $1 AND id = $2",
        [ids.guild, preboardingInbox.items[0]!.id],
      ))).rejects.toThrow("Inbox notification payload is immutable");

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        `UPDATE announcements SET body = 'tampered', version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, announcementId],
      ))).rejects.toThrow("Published Announcement content and audience are immutable");

    const managerChronicle = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildChronicleQueryRepository(connection, ids.guild)
        .listEvents(ids.manager, { subjectType: "announcement" }),
    );
    expect(managerChronicle.items.map((entry) => entry.subjectId)).not.toContain(hiddenAnnouncementId);
    expect(managerChronicle.items.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "announcement.created",
      "announcement.draft.updated",
      "announcement.published",
    ]));

    const searchedChronicle = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildChronicleQueryRepository(connection, ids.guild)
        .listEvents(ids.manager, { search: "published" }),
    );
    expect(searchedChronicle.items.map((entry) => entry.action)).toEqual([
      "announcement.published",
    ]);

    const knowledgeId = randomUUID();
    const knowledgeBoundary: SecuredResource = { ...boundary, id: knowledgeId };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.createKnowledge({
        id: knowledgeId,
        spaceId: ids.teamSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Initial communication procedure.",
        title: { en: "Communication procedure", ja: "連絡手順" },
        summary: { en: "How to publish a notice.", ja: "告知の公開方法です。" },
        body: { en: "Publish to a Role and Space.", ja: "RoleとSpaceへ公開します。" },
        sourceIds: [],
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "knowledge.created",
          knowledgeId,
          knowledgeBoundary,
          "knowledge",
        ),
      });
      await repository.propose({
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "knowledge.proposed",
          knowledgeId,
          knowledgeBoundary,
          "knowledge",
        ),
      });
      await repository.review({
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        reviewId: randomUUID(),
        verdict: "approve",
        reason: "The audience boundary is explicit.",
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "knowledge.canonical",
          knowledgeId,
          knowledgeBoundary,
          "knowledge",
        ),
      });
      const notificationCount = await connection.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM inbox_notifications
          WHERE guild_id = $1 AND kind = 'knowledge_update' AND resource_id = $2`,
        [ids.guild, knowledgeId],
      );
      expect(notificationCount.rows[0]?.count).toBe(25);
    });

    await withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        "DELETE FROM role_bindings WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, recipientIds[0]],
      ));
    const revokedInbox = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => new GuildInboxRepository(connection, ids.guild)
        .listNotifications(recipientIds[0]!),
    );
    expect(revokedInbox.items).toHaveLength(0);

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), ids.guild, ids.agent, ids.managerRole, ids.teamSpace],
      ))).rejects.toThrow("human-only permissions");
  });
});
