import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution, SecuredResource } from "@guild-os/domain";
import { GuildConversationRepository } from "./conversation.js";
import { GuildKnowledgeRepository } from "./knowledge.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

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
  details: ChronicleEvent["details"] = { source: "conversation-integration-test" },
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
    details,
  };
}

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    moderator: randomUUID(),
    contributor: randomUUID(),
    readOnly: randomUUID(),
    sibling: randomUUID(),
    lowClearance: randomUUID(),
    agent: randomUUID(),
    suspended: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    siblingSpace: randomUUID(),
    moderatorRole: randomUUID(),
    contributorRole: randomUUID(),
    readOnlyRole: randomUUID(),
    knowledge: randomUUID(),
    initialEvent: randomUUID(),
  };
  const allowedIdentityIds = [
    ids.moderator,
    ids.contributor,
    ids.readOnly,
    ids.lowClearance,
    ids.agent,
    ids.suspended,
  ];
  const boundary: SecuredResource = {
    id: ids.knowledge,
    guildId: ids.guild,
    spaceId: ids.teamSpace,
    ownerIdentityId: ids.root,
    visibility: "restricted",
    classification: "internal",
    allowedIdentityIds,
  };

  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Conversation Guild",
      purpose: "Verify context-bound organizational discussion",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.moderatorRole,
        name: "Conversation moderator",
        permissions: [
          "guild.read",
          "space.read",
          "knowledge.read",
          "conversation.read",
          "conversation.create",
          "conversation.moderate",
          "inbox.read",
          "chronicle.read",
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
      }, {
        id: ids.readOnlyRole,
        name: "Conversation reader",
        permissions: [
          "guild.read",
          "space.read",
          "knowledge.read",
          "conversation.read",
          "inbox.read",
        ],
      }],
      chronicleEvent: {
        id: ids.initialEvent,
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
        details: { source: "conversation-integration-test" },
      },
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'), ($4, $2, $3, 'Sibling', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.siblingSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $8, 'human', 'Moderator', 'active'),
              ($2, $8, 'human', 'Contributor', 'active'),
              ($3, $8, 'human', 'Reader', 'active'),
              ($4, $8, 'human', 'Sibling', 'active'),
              ($5, $8, 'human', 'Low clearance', 'active'),
              ($6, $8, 'agent', 'Comment Agent', 'active'),
              ($7, $8, 'human', 'Suspended', 'disabled')`,
      [
        ids.moderator,
        ids.contributor,
        ids.readOnly,
        ids.sibling,
        ids.lowClearance,
        ids.agent,
        ids.suspended,
        ids.guild,
      ],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now()),
              ($1, $5, 'active', 'internal', now()),
              ($1, $6, 'active', 'public', now()),
              ($1, $7, 'active', 'internal', now()),
              ($1, $8, 'suspended', 'internal', now())`,
      [
        ids.guild,
        ids.moderator,
        ids.contributor,
        ids.readOnly,
        ids.sibling,
        ids.lowClearance,
        ids.agent,
        ids.suspended,
      ],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Comment only within assigned Spaces.', 'test/model', '{}',
               '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
               'active')`,
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5),
              ($6, $2, $7, $8, $5),
              ($9, $2, $10, $11, $5),
              ($12, $2, $13, $8, $14),
              ($15, $2, $16, $8, $5),
              ($17, $2, $18, $8, $5)`,
      [
        randomUUID(), ids.guild, ids.moderator, ids.moderatorRole, ids.teamSpace,
        randomUUID(), ids.contributor, ids.contributorRole,
        randomUUID(), ids.readOnly, ids.readOnlyRole,
        randomUUID(), ids.sibling, ids.siblingSpace,
        randomUUID(), ids.lowClearance,
        randomUUID(), ids.agent,
      ],
    );
    await new GuildKnowledgeRepository(connection, ids.guild).createKnowledge({
      id: ids.knowledge,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.root,
      visibility: "restricted",
      classification: "internal",
      allowedIdentityIds,
      reviewDueAt: null,
      changeNote: "Create the Conversation security fixture.",
      title: { en: "Incident response" },
      summary: { en: "Restricted response procedure." },
      body: { en: "Escalate incidents to the assigned response lead." },
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
  return { ids, boundary };
}

async function post(
  ids: Awaited<ReturnType<typeof fixture>>["ids"],
  boundary: SecuredResource,
  actorIdentityId: string,
  body: string,
  mentionedIdentityIds: readonly string[] = [],
) {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const openedEvent = event(
    ids.guild,
    actorIdentityId,
    "conversation.opened",
    "conversation",
    conversationId,
    boundary,
  );
  const postedEvent = event(
    ids.guild,
    actorIdentityId,
    "conversation.message.posted",
    "conversation_message",
    messageId,
    boundary,
    { source: "conversation-integration-test", bodySha256: "a".repeat(64) },
  );
  const result = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
    new GuildConversationRepository(connection, ids.guild).postMessage({
      conversationId,
      messageId,
      actorIdentityId,
      subjectType: "knowledge",
      subjectId: ids.knowledge,
      body,
      mentionedIdentityIds,
      openedEvent,
      postedEvent,
    }));
  return { ...result, openedEvent, postedEvent };
}

integration("Guild Conversation repository", () => {
  it("filters before return and supports contextual posts, mentions, paging, and moderation", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const { ids, boundary } = await fixture();

    const candidates = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).searchMentionCandidates(
        ids.moderator,
        "knowledge",
        ids.knowledge,
        "Con",
        10,
      ));
    expect(candidates).toEqual([{ id: ids.contributor, displayName: "Contributor" }]);

    const first = await post(
      ids,
      boundary,
      ids.moderator,
      "Please confirm the escalation owner.",
      [ids.contributor],
    );
    const second = await post(ids, boundary, ids.agent, "I checked the canonical procedure.");
    const third = await post(ids, boundary, ids.contributor, "The response lead is assigned.");
    expect(first.opened).toBe(true);
    expect(second.opened).toBe(false);
    expect(third.conversation.id).toBe(first.conversation.id);
    expect(first.notificationCount).toBe(1);

    const notification = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ recipient_identity_id: string; resource_type: string; resource_id: string }>(
        `SELECT recipient_identity_id::text, resource_type, resource_id::text
           FROM inbox_notifications
          WHERE guild_id = $1 AND recipient_identity_id = $2 AND kind = 'mention'`,
        [ids.guild, ids.contributor],
      )).rows[0]);
    expect(notification).toEqual({
      recipient_identity_id: ids.contributor,
      resource_type: "knowledge",
      resource_id: ids.knowledge,
    });

    const newest = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.moderator,
        "knowledge",
        ids.knowledge,
        null,
        2,
      ));
    expect(newest.messages).toHaveLength(2);
    expect(newest.nextCursor).not.toBeNull();
    const older = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.moderator,
        "knowledge",
        ids.knowledge,
        newest.nextCursor,
        2,
      ));
    expect(older.messages).toHaveLength(1);
    expect(new Set([...newest.messages, ...older.messages].map((message) => message.id))).toEqual(
      new Set([first.message.id, second.message.id, third.message.id]),
    );

    for (const deniedIdentityId of [ids.sibling, ids.lowClearance, ids.suspended]) {
      await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
        new GuildConversationRepository(connection, ids.guild).getThread(
          deniedIdentityId,
          "knowledge",
          ids.knowledge,
          null,
          10,
        ))).rejects.toThrow("not found or is not readable");
    }
    await expect(post(ids, boundary, ids.readOnly, "This write must be denied.")).rejects.toThrow(
      "operation is not authorized",
    );
    await expect(post(
      ids,
      boundary,
      ids.moderator,
      "An Agent cannot be mentioned as a Human recipient.",
      [ids.agent],
    )).rejects.toThrow("Mentioned Human cannot read");

    const orphan = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $2, 'human', 'No Membership', 'active')`,
        [orphan, ids.guild],
      );
      const messageId = randomUUID();
      const orphanConversationId = randomUUID();
      await new GuildConversationRepository(connection, ids.guild).postMessage({
        conversationId: orphanConversationId,
        messageId,
        actorIdentityId: ids.moderator,
        subjectType: "knowledge",
        subjectId: ids.knowledge,
        body: "Missing Membership must be rejected.",
        mentionedIdentityIds: [orphan],
        openedEvent: event(
          ids.guild,
          ids.moderator,
          "conversation.opened",
          "conversation",
          orphanConversationId,
          boundary,
        ),
        postedEvent: event(
          ids.guild,
          ids.moderator,
          "conversation.message.posted",
          "conversation_message",
          messageId,
          boundary,
        ),
      });
    })).rejects.toThrow("Mentioned Human cannot read");

    const locked = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).setStatus({
        conversationId: first.conversation.id,
        actorIdentityId: ids.moderator,
        expectedVersion: 1,
        nextStatus: "locked",
        reason: "Pause discussion during review.",
        chronicleEvent: event(
          ids.guild,
          ids.moderator,
          "conversation.locked",
          "conversation",
          first.conversation.id,
          boundary,
        ),
      }));
    expect(locked.status).toBe("locked");
    await expect(post(ids, boundary, ids.contributor, "Locked threads reject writes.")).rejects.toThrow(
      "locked",
    );
    const unlocked = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).setStatus({
        conversationId: first.conversation.id,
        actorIdentityId: ids.moderator,
        expectedVersion: locked.version,
        nextStatus: "open",
        reason: "Review completed.",
        chronicleEvent: event(
          ids.guild,
          ids.moderator,
          "conversation.unlocked",
          "conversation",
          first.conversation.id,
          boundary,
        ),
      }));
    expect(unlocked.status).toBe("open");

    const redactedVersion = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildConversationRepository(connection, ids.guild).redactMessage({
        conversationId: first.conversation.id,
        messageId: first.message.id,
        actorIdentityId: ids.moderator,
        expectedVersion: 1,
        reason: "Contains operational detail that should not remain visible.",
        chronicleEvent: event(
          ids.guild,
          ids.moderator,
          "conversation.message.redacted",
          "conversation_message",
          first.message.id,
          boundary,
        ),
      }),
    );
    expect(redactedVersion).toBe(2);
    const redacted = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.contributor,
        "knowledge",
        ids.knowledge,
        null,
        10,
      ));
    expect(redacted.messages.find((message) => message.id === first.message.id)).toMatchObject({
      body: null,
      state: "redacted",
      version: 2,
    });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildKnowledgeRepository(connection, ids.guild).saveDraft({
        knowledgeId: ids.knowledge,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        spaceId: ids.teamSpace,
        visibility: "restricted",
        classification: "internal",
        allowedIdentityIds: [ids.moderator],
        reviewDueAt: null,
        changeNote: "Limit the working document audience.",
        title: { en: "Incident response" },
        summary: { en: "Restricted response procedure." },
        body: { en: "Escalate incidents to the assigned response lead." },
        sourceIds: [],
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "knowledge.version.created",
          "knowledge",
          ids.knowledge,
          { ...boundary, allowedIdentityIds: [ids.moderator] },
        ),
      });
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.contributor,
        "knowledge",
        ids.knowledge,
        null,
        10,
      ))).rejects.toThrow("not found or is not readable");
    const stillVisible = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.moderator,
        "knowledge",
        ids.knowledge,
        null,
        10,
      ));
    expect(stillVisible.subject.allowedIdentityIds).toEqual([ids.moderator]);

    const actions = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND subject_type IN ('conversation', 'conversation_message')
          ORDER BY sequence`,
        [ids.guild],
      )).rows.map((row) => row.action));
    expect(actions.filter((action) => action === "conversation.opened")).toHaveLength(1);
    expect(actions.filter((action) => action === "conversation.message.posted")).toHaveLength(3);
    expect(actions).toContain("conversation.locked");
    expect(actions).toContain("conversation.unlocked");
    expect(actions).toContain("conversation.message.redacted");
  });

  it("rejects direct SQL bypasses, missing audit events, and replayed audit events", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const { ids, boundary } = await fixture();
    const conversationId = randomUUID();

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.sibling]);
      await connection.query(
        `INSERT INTO conversations
           (id, guild_id, space_id, owner_identity_id, subject_type, subject_id,
            visibility, classification, allowed_identity_ids, status, version, last_event_id)
         VALUES ($1, $2, $3, $4, 'knowledge', $5, 'restricted', 'internal',
                 $6::uuid[], 'open', 1, $7)`,
        [
          conversationId,
          ids.guild,
          ids.teamSpace,
          ids.root,
          ids.knowledge,
          boundary.allowedIdentityIds,
          randomUUID(),
        ],
      );
    })).rejects.toThrow("creation is not authorized");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query(
        `INSERT INTO conversations
           (id, guild_id, space_id, owner_identity_id, subject_type, subject_id,
            visibility, classification, allowed_identity_ids, status, version, last_event_id)
         VALUES ($1, $2, $3, $4, 'knowledge', $5, 'restricted', 'internal',
                 $6::uuid[], 'open', 1, $7)`,
        [
          conversationId,
          ids.guild,
          ids.teamSpace,
          ids.root,
          ids.knowledge,
          boundary.allowedIdentityIds,
          ids.initialEvent,
        ],
      );
      await connection.query("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow("atomic Chronicle event");

    const opened = await post(ids, boundary, ids.moderator, "Immutable message body.");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query(
        "UPDATE conversation_messages SET body = 'tampered' WHERE guild_id = $1 AND id = $2",
        [ids.guild, opened.message.id],
      );
    })).rejects.toThrow("Invalid Conversation message redaction");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await connection.query(
        "DELETE FROM conversations WHERE guild_id = $1 AND id = $2",
        [ids.guild, opened.conversation.id],
      );
    })).rejects.toThrow("append-only");

    const lockEvent = event(
      ids.guild,
      ids.moderator,
      "conversation.locked",
      "conversation",
      opened.conversation.id,
      boundary,
    );
    const locked = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).setStatus({
        conversationId: opened.conversation.id,
        actorIdentityId: ids.moderator,
        expectedVersion: 1,
        nextStatus: "locked",
        reason: "Test event order.",
        chronicleEvent: lockEvent,
      }));
    const unlockEvent = event(
      ids.guild,
      ids.moderator,
      "conversation.unlocked",
      "conversation",
      opened.conversation.id,
      boundary,
    );
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).setStatus({
        conversationId: opened.conversation.id,
        actorIdentityId: ids.moderator,
        expectedVersion: locked.version,
        nextStatus: "open",
        reason: "Continue the event-order test.",
        chronicleEvent: unlockEvent,
      }));

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.moderator]);
      await connection.query(
        `UPDATE conversations
            SET status = 'locked', version = version + 1, last_event_id = $3
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, opened.conversation.id, lockEvent.id],
      );
      await connection.query("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow("newer Chronicle event");

    const preserved = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildConversationRepository(connection, ids.guild).getThread(
        ids.moderator,
        "knowledge",
        ids.knowledge,
        null,
        10,
      ));
    expect(preserved.conversation?.status).toBe("open");
    expect(preserved.messages[0]?.body).toBe("Immutable message body.");
  });
});
