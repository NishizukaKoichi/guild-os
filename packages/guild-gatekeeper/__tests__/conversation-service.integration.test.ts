import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution, SecuredResource } from "@guild-os/domain";
import {
  GuildKnowledgeRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import { GuildConversationService } from "../src/conversation-service.js";
import type { GuildEnv } from "../src/config.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

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

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  boundary: SecuredResource,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: boundary.spaceId,
    ownerIdentityId: boundary.ownerIdentityId,
    visibility: boundary.visibility,
    classification: boundary.classification,
    allowedIdentityIds: boundary.allowedIdentityIds ?? [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "conversation-service-integration-test" },
  };
}

integration("Guild Conversation service authorization boundary", () => {
  it("rechecks context access and emits metadata-only Chronicle events", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = {
      guild: randomUUID(),
      root: randomUUID(),
      manager: randomUUID(),
      reader: randomUUID(),
      sibling: randomUUID(),
      rootSpace: randomUUID(),
      teamSpace: randomUUID(),
      siblingSpace: randomUUID(),
      managerRole: randomUUID(),
      contributorRole: randomUUID(),
      knowledge: randomUUID(),
    };
    const boundary: SecuredResource = {
      id: ids.knowledge,
      guildId: ids.guild,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.root,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
    };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
        guildId: ids.guild,
        name: "Conversation Service Guild",
        purpose: "Verify Gatekeeper Conversation authorization",
        rootIdentityId: ids.root,
        rootDisplayName: "Root",
        rootSpaceId: ids.rootSpace,
        rootSpaceName: "Guild",
        constitution: constitution(ids.guild, ids.root),
        roles: [{
          id: ids.managerRole,
          name: "Conversation manager",
          permissions: [
            "guild.read",
            "space.read",
            "knowledge.read",
            "conversation.read",
            "conversation.create",
            "conversation.moderate",
            "inbox.read",
          ],
        }, {
          id: ids.contributorRole,
          name: "Conversation contributor",
          permissions: [
            "guild.read",
            "space.read",
            "knowledge.read",
            "conversation.read",
            "conversation.create",
            "inbox.read",
          ],
        }],
        chronicleEvent: {
          ...event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild, {
            ...boundary,
            id: ids.guild,
            spaceId: null,
            visibility: "guild",
            classification: "restricted",
          }),
        },
      });
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $3, $4, 'Team', 'active'), ($2, $3, $4, 'Sibling', 'active')`,
        [ids.teamSpace, ids.siblingSpace, ids.guild, ids.rootSpace],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $4, 'human', 'Manager', 'active'),
                ($2, $4, 'human', 'Reader', 'active'),
                ($3, $4, 'human', 'Sibling', 'active')`,
        [ids.manager, ids.reader, ids.sibling, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'internal', now()),
                ($1, $3, 'active', 'internal', now()),
                ($1, $4, 'active', 'internal', now())`,
        [ids.guild, ids.manager, ids.reader, ids.sibling],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5),
                ($6, $2, $7, $8, $5),
                ($9, $2, $10, $8, $11)`,
        [
          randomUUID(), ids.guild, ids.manager, ids.managerRole, ids.teamSpace,
          randomUUID(), ids.reader, ids.contributorRole,
          randomUUID(), ids.sibling, ids.siblingSpace,
        ],
      );
      await new GuildKnowledgeRepository(connection, ids.guild).createKnowledge({
        id: ids.knowledge,
        spaceId: ids.teamSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Create a Conversation service fixture.",
        title: { en: "Incident response" },
        summary: { en: "Respond consistently." },
        body: { en: "Escalate to the response lead." },
        sourceIds: [],
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "knowledge.created",
          "knowledge",
          ids.knowledge,
          boundary,
        ),
      });
    });

    const env = {
      GUILD_ID: ids.guild,
      HYPERDRIVE: { connectionString },
    } as GuildEnv;
    const manager = new GuildConversationService(env, ids.manager);
    const reader = new GuildConversationService(env, ids.reader);
    const sibling = new GuildConversationService(env, ids.sibling);
    const subject = { subjectType: "knowledge" as const, subjectId: ids.knowledge };

    const empty = await manager.getThread(subject);
    expect(empty.conversation).toBeNull();
    expect(empty.capabilities).toEqual({ post: true, moderate: true });
    expect(await manager.searchMentions({ ...subject, search: "Read" })).toEqual([
      { id: ids.reader, displayName: "Reader" },
    ]);

    const body = "Confirm the incident owner before publishing the procedure.";
    const posted = await manager.post({
      ...subject,
      body,
      mentionedIdentityIds: [ids.reader],
    });
    expect(posted.opened).toBe(true);
    expect(posted.notificationCount).toBe(1);

    const readerThread = await reader.getThread(subject);
    expect(readerThread.messages[0]?.body).toBe(body);
    expect(readerThread.capabilities).toEqual({ post: true, moderate: false });
    await expect(sibling.getThread(subject)).rejects.toThrow();

    const audit = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM chronicle_events
          WHERE guild_id = $1 AND action = 'conversation.message.posted'
            AND subject_id = $2`,
        [ids.guild, posted.message.id],
      )).rows[0]?.details);
    expect(audit?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(audit?.mentionCount).toBe(1);
    expect(JSON.stringify(audit)).not.toContain(body);

    const locked = await manager.moderate({
      ...subject,
      conversationId: posted.conversation.id,
      expectedVersion: 1,
      nextStatus: "locked",
      reason: "Pause discussion during review.",
    });
    await expect(reader.post({
      ...subject,
      body: "This must not be accepted while locked.",
      mentionedIdentityIds: [],
    })).rejects.toThrow("locked");
    const reopened = await manager.moderate({
      ...subject,
      conversationId: posted.conversation.id,
      expectedVersion: locked.version,
      nextStatus: "open",
      reason: "Review is complete.",
    });
    expect(reopened.status).toBe("open");
    expect(await manager.redact({
      ...subject,
      conversationId: posted.conversation.id,
      messageId: posted.message.id,
      expectedVersion: 1,
      reason: "Remove operational detail from the visible thread.",
    })).toBe(2);

    const redactedReaderView = await reader.getThread(subject);
    expect(redactedReaderView.messages[0]).toMatchObject({
      body: null,
      state: "redacted",
      redactedByIdentityId: null,
      redactionReason: null,
    });
    const redactedManagerView = await manager.getThread(subject);
    expect(redactedManagerView.messages[0]?.redactionReason).toBe(
      "Remove operational detail from the visible thread.",
    );
    await expect(manager.getThread({ ...subject, cursor: "malformed" })).rejects.toThrow(
      "cursor is malformed",
    );
  });
});
