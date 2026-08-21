import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution, Permission } from "@guild-os/domain";
import { GuildFabricRepository } from "./fabric.js";
import {
  GuildFabricGovernanceRepository,
  type AuditStamp,
  type PrivateMessagePromotionDestination,
  type PromotePrivateMessageInput,
} from "./fabric-governance.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction, type GuildTransactionConnection } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

const PARTICIPANT_PERMISSIONS: readonly Permission[] = [
  "guild.read",
  "space.read",
  "message.read",
  "message.create",
  "memory.read",
  "memory.create",
  "activity.read",
  "activity.create",
  "decision.read",
  "decision.propose",
  "contribution.read",
  "contribution.correct",
  "event.read",
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...PARTICIPANT_PERMISSIONS,
  "actor.manage",
  "lifecycle.manage",
];

const MESSAGE_ONLY_PERMISSIONS: readonly Permission[] = [
  "guild.read",
  "space.read",
  "message.read",
  "message.create",
];

interface FixtureIds {
  guild: string;
  root: string;
  participant: string;
  manager: string;
  peer: string;
  messageOnly: string;
  outsider: string;
  successor: string;
  rootSpace: string;
  thread: string;
  message: string;
  participantEvidence: string;
  participantEvidenceTwo: string;
  managerEvidence: string;
  body: string;
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
      maxTokens: 100_000,
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
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: ChronicleEvent["details"] = { source: "fabric-governance-test" },
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details,
  };
}

function audit(): AuditStamp {
  return {
    id: randomUUID(),
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
}

async function asActor<T>(
  ids: Pick<FixtureIds, "guild">,
  actorId: string,
  operation: (connection: GuildTransactionConnection) => Promise<T>,
): Promise<T> {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  return withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [actorId]);
    return operation(connection);
  });
}

async function fixture(label: string): Promise<FixtureIds> {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids: FixtureIds = {
    guild: randomUUID(),
    root: randomUUID(),
    participant: randomUUID(),
    manager: randomUUID(),
    peer: randomUUID(),
    messageOnly: randomUUID(),
    outsider: randomUUID(),
    successor: randomUUID(),
    rootSpace: randomUUID(),
    thread: randomUUID(),
    message: randomUUID(),
    participantEvidence: randomUUID(),
    participantEvidenceTwo: randomUUID(),
    managerEvidence: randomUUID(),
    body: "Private selection Alpha. Private selection Beta. Private selection Gamma.",
  };
  const participantRole = randomUUID();
  const managerRole = randomUUID();
  const messageOnlyRole = randomUUID();

  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: `${label} Guild`,
      purpose: "Verify explicit private promotion and contribution correction governance.",
      rootIdentityId: ids.root,
      rootDisplayName: `${label} Root`,
      rootSpaceId: ids.rootSpace,
      rootSpaceName: `${label} Root Space`,
      constitution: constitution(ids.guild, ids.root),
      roles: [
        { id: participantRole, name: "Participant", permissions: PARTICIPANT_PERMISSIONS },
        { id: managerRole, name: "Manager", permissions: MANAGER_PERMISSIONS },
        { id: messageOnlyRole, name: "Message only", permissions: MESSAGE_ONLY_PERMISSIONS },
      ],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES
         ($1, $7, 'human', 'Participant', 'active'),
         ($2, $7, 'human', 'Manager', 'active'),
         ($3, $7, 'human', 'Peer', 'active'),
         ($4, $7, 'human', 'Message only', 'active'),
         ($5, $7, 'human', 'Outsider', 'active'),
         ($6, $7, 'human', 'Successor', 'active')`,
      [
        ids.participant,
        ids.manager,
        ids.peer,
        ids.messageOnly,
        ids.outsider,
        ids.successor,
        ids.guild,
      ],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       SELECT $1, candidate.identity_id, 'active', 'restricted', now()
         FROM unnest($2::uuid[]) AS candidate(identity_id)`,
      [
        ids.guild,
        [
          ids.participant,
          ids.manager,
          ids.peer,
          ids.messageOnly,
          ids.outsider,
          ids.successor,
        ],
      ],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       SELECT gen_random_uuid(), $1, candidate.identity_id, candidate.role_id, NULL
         FROM unnest($2::uuid[], $3::uuid[]) AS candidate(identity_id, role_id)`,
      [
        ids.guild,
        [
          ids.participant,
          ids.manager,
          ids.peer,
          ids.messageOnly,
          ids.outsider,
          ids.successor,
        ],
        [
          participantRole,
          managerRole,
          participantRole,
          messageOnlyRole,
          participantRole,
          participantRole,
        ],
      ],
    );
  });

  await asActor(ids, ids.participant, async (connection) => {
    await new GuildFabricRepository(connection, ids.guild).createPrivateThread({
      id: ids.thread,
      actorId: ids.participant,
      participantActorIds: [ids.manager, ids.peer, ids.messageOnly],
      spaceId: null,
      subject: "Private governed promotion fixture",
      classification: "restricted",
      initialMessageId: ids.message,
      initialBody: ids.body,
      chronicleEvent: event(
        ids.guild,
        ids.participant,
        "private_thread.created",
        "private_thread",
        ids.thread,
        { messageId: ids.message, plaintextRecorded: false },
      ),
    });
    const chronicle = new GuildPostgresRepository(connection, ids.guild);
    await chronicle.appendChronicle({
      ...event(
        ids.guild,
        ids.participant,
        "activity.outcome.recorded",
        "activity",
        randomUUID(),
        { outcome: "Participant evidence" },
      ),
      id: ids.participantEvidence,
    });
    await chronicle.appendChronicle({
      ...event(
        ids.guild,
        ids.participant,
        "knowledge.improved",
        "memory",
        randomUUID(),
        { outcome: "Second participant evidence" },
      ),
      id: ids.participantEvidenceTwo,
    });
  });

  await asActor(ids, ids.manager, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).appendChronicle({
      ...event(
        ids.guild,
        ids.manager,
        "decision.reviewed",
        "decision",
        randomUUID(),
        { outcome: "Manager evidence" },
      ),
      id: ids.managerEvidence,
    });
  });
  return ids;
}

function promotionInput(
  ids: FixtureIds,
  actorId: string,
  destination: PrivateMessagePromotionDestination,
  idempotencyKey: string,
): PromotePrivateMessageInput {
  return {
    id: randomUUID(),
    actorId,
    threadId: ids.thread,
    sourceMessageId: ids.message,
    selectionStart: 0,
    selectionLength: [...ids.body].length,
    idempotencyKey,
    destination,
    audit: audit(),
  };
}

function boundary(ids: FixtureIds) {
  return {
    spaceId: null,
    visibility: "guild" as const,
    classification: "internal" as const,
    allowedActorIds: [] as const,
  };
}

integration("private promotion and Contribution correction governance", () => {
  it("creates all four governed destination drafts without mutating or indexing the private thread", async () => {
    const ids = await fixture("Destinations");
    const before = await asActor(ids, ids.participant, async (connection) =>
      (await connection.query<{ version: number; updated_at: string; message_count: string }>(
        `SELECT thread.version, thread.updated_at::text,
                (SELECT count(*)::text FROM private_messages message
                  WHERE message.guild_id = thread.guild_id AND message.thread_id = thread.id)
                  AS message_count
           FROM private_threads thread WHERE thread.guild_id = $1 AND thread.id = $2`,
        [ids.guild, ids.thread],
      )).rows[0]);

    const memoryId = randomUUID();
    const memoryPromotion = promotionInput(ids, ids.participant, {
      kind: "memory",
      draftId: memoryId,
      ...boundary(ids),
      locale: "en",
      memoryType: "conversation",
      title: "Governed private selection",
      summary: "An explicitly promoted working-memory candidate.",
    }, "promotion-memory-0001");
    await asActor(ids, ids.participant, async (connection) => {
      await new GuildFabricGovernanceRepository(connection, ids.guild)
        .promotePrivateMessage(memoryPromotion);
    });

    const activityId = randomUUID();
    await asActor(ids, ids.manager, async (connection) => {
      await new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.manager, {
          kind: "activity",
          draftId: activityId,
          ...boundary(ids),
          activityType: "task",
          title: "Review promoted private context",
          assigneeActorId: ids.manager,
        }, "promotion-activity-0001"),
      );
    });

    const decisionId = randomUUID();
    await asActor(ids, ids.manager, async (connection) => {
      await new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.manager, {
          kind: "decision",
          draftId: decisionId,
          ...boundary(ids),
          method: "review",
          title: "Review the promoted proposal",
          rationale: "Formal review is required before this becomes a Guild decision.",
        }, "promotion-decision-0001"),
      );
    });

    const handoverId = randomUUID();
    await asActor(ids, ids.manager, async (connection) => {
      await new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.manager, {
          kind: "handover",
          draftId: handoverId,
          departingActorId: ids.outsider,
          successorActorId: ids.successor,
        }, "promotion-handover-0001"),
      );
    });

    const state = await asActor(ids, ids.participant, async (connection) => {
      const after = (await connection.query<{
        version: number;
        updated_at: string;
        message_count: string;
      }>(
        `SELECT thread.version, thread.updated_at::text,
                (SELECT count(*)::text FROM private_messages message
                  WHERE message.guild_id = thread.guild_id AND message.thread_id = thread.id)
                  AS message_count
           FROM private_threads thread WHERE thread.guild_id = $1 AND thread.id = $2`,
        [ids.guild, ids.thread],
      )).rows[0];
      const promotions = await new GuildFabricGovernanceRepository(connection, ids.guild)
        .listPrivateMessagePromotions(ids.participant, ids.thread);
      const promotionHistory = (await connection.query<{ value: string }>(
        `SELECT string_agg(to_jsonb(promotion)::text, E'\\n') AS value
           FROM private_message_promotions promotion WHERE guild_id = $1 AND thread_id = $2`,
        [ids.guild, ids.thread],
      )).rows[0]?.value ?? "";
      const chronicleHistory = (await connection.query<{ value: string }>(
        `SELECT string_agg(event.details::text, E'\\n') AS value
           FROM chronicle_events event
          WHERE event.guild_id = $1 AND event.action = 'private_message.promoted'`,
        [ids.guild],
      )).rows[0]?.value ?? "";
      const memory = (await connection.query<{ body: Record<string, string>; governance_state: string }>(
        `SELECT version_row.body, memory.governance_state
           FROM memories memory JOIN memory_versions version_row
             ON version_row.guild_id = memory.guild_id
            AND version_row.memory_id = memory.id AND version_row.version = 1
          WHERE memory.guild_id = $1 AND memory.id = $2`,
        [ids.guild, memoryId],
      )).rows[0];
      const activity = (await connection.query<{ description: string; status: string }>(
        "SELECT description, status FROM activities WHERE guild_id = $1 AND id = $2",
        [ids.guild, activityId],
      )).rows[0];
      const decision = (await connection.query<{ description: string; status: string }>(
        "SELECT description, status FROM decisions WHERE guild_id = $1 AND id = $2",
        [ids.guild, decisionId],
      )).rows[0];
      const handover = (await connection.query<{ reason: string; status: string }>(
        "SELECT reason, status FROM handover_cases WHERE guild_id = $1 AND id = $2",
        [ids.guild, handoverId],
      )).rows[0];
      const accidentalIndex = (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM memory_embedding_jobs
          WHERE guild_id = $1 AND memory_id = $2`,
        [ids.guild, ids.message],
      )).rows[0]?.count;
      return {
        after,
        promotions,
        promotionHistory,
        chronicleHistory,
        memory,
        activity,
        decision,
        handover,
        accidentalIndex,
      };
    });

    expect(state.after).toEqual(before);
    expect(state.promotions).toHaveLength(4);
    expect(new Set(state.promotions.map((item) => item.destinationKind))).toEqual(
      new Set(["memory", "activity", "decision", "handover"]),
    );
    expect(state.promotionHistory).not.toContain(ids.body);
    expect(state.chronicleHistory).not.toContain(ids.body);
    expect(state.chronicleHistory).toContain('"plaintextRecorded": false');
    expect(state.memory).toEqual({ body: { en: ids.body }, governance_state: "draft" });
    expect(state.activity).toEqual({ description: ids.body, status: "proposed" });
    expect(state.decision).toEqual({ description: ids.body, status: "draft" });
    expect(state.handover).toEqual({ reason: ids.body, status: "open" });
    expect(state.accidentalIndex).toBe("0");
    expect(state.promotions.every((item) => /^[a-f0-9]{64}$/.test(item.sourceSha256))).toBe(true);

    const protectedPromotionId = state.promotions[0]?.id;
    expect(protectedPromotionId).toBeDefined();
    const mutationResults = await asActor(ids, ids.participant, async (connection) => ({
      updated: await connection.query(
        "UPDATE private_message_promotions SET source_sha256 = repeat('0', 64) WHERE guild_id = $1 AND id = $2",
        [ids.guild, protectedPromotionId],
      ),
      deleted: await connection.query(
        "DELETE FROM private_message_promotions WHERE guild_id = $1 AND id = $2",
        [ids.guild, protectedPromotionId],
      ),
    }));
    expect(mutationResults.updated.rowCount).toBe(0);
    expect(mutationResults.deleted.rowCount).toBe(0);
  });

  it("rejects nonparticipants, Break Glass viewers, missing destination permission, and revoked members", async () => {
    const ids = await fixture("Boundaries");
    await asActor(ids, ids.root, async (connection) => {
      await connection.query(
        `INSERT INTO emergency_private_access_grants
           (id, guild_id, thread_id, granted_to_actor_id, granted_by_actor_id,
            reason, intended_access, expires_at)
         VALUES ($1, $2, $3, $4, $4,
                 'Verified continuity emergency for read-only inspection.',
                 'Inspect the private message without promoting it.',
                 now() + interval '15 minutes')`,
        [randomUUID(), ids.guild, ids.thread, ids.root],
      );
      const visible = await connection.query<{ body: string }>(
        "SELECT body FROM private_messages WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.message],
      );
      expect(visible.rows[0]?.body).toBe(ids.body);
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.root, {
          kind: "memory",
          draftId: randomUUID(),
          ...boundary(ids),
          locale: "en",
          memoryType: "conversation",
          title: "Forbidden emergency promotion",
          summary: "Break Glass must not grant promotion authority.",
        }, "emergency-promotion-0001"),
      )).rejects.toThrow("unavailable to the current participant");
    });

    await asActor(ids, ids.outsider, async (connection) => {
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.outsider, {
          kind: "activity",
          draftId: randomUUID(),
          ...boundary(ids),
          activityType: "task",
          title: "Forbidden outsider promotion",
          assigneeActorId: null,
        }, "outsider-promotion-0001"),
      )).rejects.toThrow("unavailable to the current participant");
    });

    await asActor(ids, ids.messageOnly, async (connection) => {
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.messageOnly, {
          kind: "memory",
          draftId: randomUUID(),
          ...boundary(ids),
          locale: "en",
          memoryType: "conversation",
          title: "Forbidden capability promotion",
          summary: "Message access alone cannot create Memory.",
        }, "missing-capability-0001"),
      )).rejects.toThrow("lacks memory.create");
    });

    await expect(asActor(ids, ids.messageOnly, async (connection) => {
      const destinationId = randomUUID();
      const digest = (await connection.query<{ digest: string }>(
        "SELECT guild_runtime.private_message_selection_sha256($1, $2, 0, $3) AS digest",
        [ids.guild, ids.message, [...ids.body].length],
      )).rows[0]?.digest;
      await connection.query(
        `INSERT INTO activities
           (id, guild_id, space_id, owner_actor_id, creator_actor_id, type,
            title, description, status, visibility, classification)
         VALUES ($1, $2, NULL, $3, $3, 'task', 'Direct bypass attempt', $4,
                 'proposed', 'guild', 'internal')`,
        [destinationId, ids.guild, ids.messageOnly, ids.body],
      );
      await connection.query(
        `INSERT INTO private_message_promotions
           (id, guild_id, thread_id, source_message_id, promoted_by_actor_id,
            selection_start, selection_length, source_sha256, destination_kind,
            destination_draft_id, idempotency_key, chronicle_event_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'activity', $8, $9, $10)`,
        [
          randomUUID(),
          ids.guild,
          ids.thread,
          ids.message,
          ids.messageOnly,
          [...ids.body].length,
          digest,
          destinationId,
          "direct-bypass-permission-0001",
          randomUUID(),
        ],
      );
    })).rejects.toThrow("lacks permission");

    await expect(asActor(ids, ids.participant, async (connection) => {
      const destinationId = randomUUID();
      const digest = (await connection.query<{ digest: string }>(
        "SELECT guild_runtime.private_message_selection_sha256($1, $2, 0, $3) AS digest",
        [ids.guild, ids.message, [...ids.body].length],
      )).rows[0]?.digest;
      await connection.query(
        `INSERT INTO activities
           (id, guild_id, space_id, owner_actor_id, creator_actor_id, type,
            title, description, status, visibility, classification)
         VALUES ($1, $2, NULL, $3, $3, 'task', 'Content substitution attempt',
                 'Unrelated content', 'proposed', 'guild', 'internal')`,
        [destinationId, ids.guild, ids.participant],
      );
      await connection.query(
        `INSERT INTO private_message_promotions
           (id, guild_id, thread_id, source_message_id, promoted_by_actor_id,
            selection_start, selection_length, source_sha256, destination_kind,
            destination_draft_id, idempotency_key, chronicle_event_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'activity', $8, $9, $10)`,
        [
          randomUUID(),
          ids.guild,
          ids.thread,
          ids.message,
          ids.participant,
          [...ids.body].length,
          digest,
          destinationId,
          "direct-bypass-content-0001",
          randomUUID(),
        ],
      );
    })).rejects.toThrow("does not contain the selected message content");

    await asActor(ids, ids.root, async (connection) => {
      await connection.query(
        `UPDATE identities SET status = 'disabled', updated_at = now()
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, ids.peer],
      );
      await connection.query(
        `UPDATE memberships SET state = 'suspended', updated_at = now()
          WHERE guild_id = $1 AND identity_id = $2`,
        [ids.guild, ids.peer],
      );
    });
    await asActor(ids, ids.peer, async (connection) => {
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.peer, {
          kind: "activity",
          draftId: randomUUID(),
          ...boundary(ids),
          activityType: "task",
          title: "Forbidden revoked promotion",
          assigneeActorId: null,
        }, "revoked-promotion-0001"),
      )).rejects.toThrow("unavailable to the current participant");
    });
  });

  it("makes promotion retries idempotent and rejects duplicate or cross-Guild promotion", async () => {
    const ids = await fixture("Idempotency");
    const foreign = await fixture("Foreign");
    const destinationId = randomUUID();
    const first = promotionInput(ids, ids.participant, {
      kind: "activity",
      draftId: destinationId,
      ...boundary(ids),
      activityType: "task",
      title: "Idempotent Activity",
      assigneeActorId: null,
    }, "idempotent-promotion-0001");

    const created = await asActor(ids, ids.participant, async (connection) =>
      new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(first));
    const replayed = await asActor(ids, ids.participant, async (connection) =>
      new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage({
        ...first,
        id: randomUUID(),
        audit: audit(),
      }));
    expect(created.idempotentReplay).toBe(false);
    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.id).toBe(created.id);

    const duplicateDestination = randomUUID();
    await expect(asActor(ids, ids.participant, async (connection) =>
      new GuildFabricGovernanceRepository(connection, ids.guild).promotePrivateMessage(
        promotionInput(ids, ids.participant, {
          kind: "activity",
          draftId: duplicateDestination,
          ...boundary(ids),
          activityType: "task",
          title: "Duplicate Activity",
          assigneeActorId: null,
        }, "idempotent-promotion-0002"),
      ))).rejects.toThrow();
    const counts = await asActor(ids, ids.participant, async (connection) => ({
      promotions: (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM private_message_promotions WHERE guild_id = $1",
        [ids.guild],
      )).rows[0]?.count,
      destinations: (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM activities WHERE guild_id = $1 AND id = ANY($2::uuid[])",
        [ids.guild, [destinationId, duplicateDestination]],
      )).rows[0]?.count,
    }));
    expect(counts).toEqual({ promotions: "1", destinations: "1" });

    await asActor(ids, ids.participant, async (connection) => {
      const repository = new GuildFabricGovernanceRepository(connection, ids.guild);
      await expect(repository.promotePrivateMessage({
        ...promotionInput(ids, ids.participant, {
          kind: "memory",
          draftId: randomUUID(),
          ...boundary(ids),
          locale: "en",
          memoryType: "conversation",
          title: "Cross-Guild Memory",
          summary: "A foreign private message must stay invisible.",
        }, "cross-guild-promotion-0001"),
        threadId: foreign.thread,
        sourceMessageId: foreign.message,
      })).rejects.toThrow("unavailable to the current participant");
    });
  });

  it("uses pending manager review, forbids self-review, and appends targeted correction events", async () => {
    const ids = await fixture("Corrections");
    const requestId = randomUUID();
    const originalBefore = await asActor(ids, ids.participant, async (connection) =>
      (await connection.query<{ value: string }>(
        "SELECT to_jsonb(event)::text AS value FROM chronicle_events event WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.participantEvidence],
      )).rows[0]?.value);

    const requested = await asActor(ids, ids.participant, async (connection) => {
      const repository = new GuildFabricGovernanceRepository(connection, ids.guild);
      const result = await repository.requestContributionCorrection({
        id: requestId,
        actorId: ids.participant,
        evidenceEventId: ids.participantEvidence,
        reason: "The evidence needs a precise attribution note.",
        audit: audit(),
      });
      expect(await repository.listOwnContributionCorrections(ids.participant)).toEqual([result]);
      expect("score" in result).toBe(false);
      await expect(repository.reviewContributionCorrection({
        requestId,
        reviewerActorId: ids.participant,
        expectedVersion: 1,
        outcome: "accepted",
        reason: "Self-review must never be accepted.",
        audit: audit(),
      })).rejects.toThrow();
      return result;
    });
    expect(requested.status).toBe("pending");

    await asActor(ids, ids.peer, async (connection) => {
      const visible = await connection.query(
        "SELECT id FROM contribution_correction_requests WHERE guild_id = $1",
        [ids.guild],
      );
      expect(visible.rows).toEqual([]);
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild)
        .reviewContributionCorrection({
          requestId,
          reviewerActorId: ids.peer,
          expectedVersion: 1,
          outcome: "accepted",
          reason: "A non-manager cannot review another Actor.",
          audit: audit(),
        })).rejects.toThrow("not found or is not reviewable");
    });

    const reviewed = await asActor(ids, ids.manager, async (connection) => {
      const repository = new GuildFabricGovernanceRepository(connection, ids.guild);
      expect((await repository.listPendingContributionCorrections(ids.manager))
        .map((item) => item.id)).toContain(requestId);
      return repository.reviewContributionCorrection({
        requestId,
        reviewerActorId: ids.manager,
        expectedVersion: 1,
        outcome: "accepted",
        reason: "The correction is supported by the linked immutable evidence.",
        audit: audit(),
      });
    });
    expect(reviewed).toMatchObject({
      status: "accepted",
      reviewedByActorId: ids.manager,
      version: 2,
    });

    const originalAfter = await asActor(ids, ids.manager, async (connection) => {
      const original = (await connection.query<{ value: string }>(
        "SELECT to_jsonb(event)::text AS value FROM chronicle_events event WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.participantEvidence],
      )).rows[0]?.value;
      const correctionEvent = (await connection.query<{
        action: string;
        subject_id: string;
        details: Record<string, string | boolean>;
      }>(
        `SELECT action, subject_id::text, details
           FROM chronicle_events WHERE guild_id = $1 AND id = $2`,
        [ids.guild, reviewed.resolutionChronicleEventId],
      )).rows[0];
      expect(correctionEvent).toMatchObject({
        action: "contribution.correction.accepted",
        subject_id: requestId,
        details: {
          evidenceEventId: ids.participantEvidence,
          outcome: "accepted",
          originalEventPreserved: true,
        },
      });
      await expect(connection.query(
        "UPDATE chronicle_events SET action = 'rewritten' WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.participantEvidence],
      )).rejects.toThrow("append-only");
      return original;
    });
    expect(originalAfter).toBe(originalBefore);

    await expect(asActor(ids, ids.manager, async (connection) => {
      await connection.query(
        `UPDATE contribution_correction_requests
            SET chronicle_event_id = $3
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, requestId, ids.participantEvidenceTwo],
      );
    })).rejects.toThrow("immutable");

    const managerRequestId = randomUUID();
    await asActor(ids, ids.manager, async (connection) => {
      const repository = new GuildFabricGovernanceRepository(connection, ids.guild);
      await repository.requestContributionCorrection({
        id: managerRequestId,
        actorId: ids.manager,
        evidenceEventId: ids.managerEvidence,
        reason: "Manager-owned evidence also requires independent review.",
        audit: audit(),
      });
      await expect(repository.reviewContributionCorrection({
        requestId: managerRequestId,
        reviewerActorId: ids.manager,
        expectedVersion: 1,
        outcome: "rejected",
        reason: "A manager cannot approve or reject their own correction.",
        audit: audit(),
      })).rejects.toThrow("cannot be self-reviewed");
    });

    const rejectionRequestId = randomUUID();
    await asActor(ids, ids.participant, async (connection) => {
      const repository = new GuildFabricGovernanceRepository(connection, ids.guild);
      await repository.requestContributionCorrection({
        id: rejectionRequestId,
        actorId: ids.participant,
        evidenceEventId: ids.participantEvidenceTwo,
        reason: "This second request exercises the rejected terminal path.",
        audit: audit(),
      });
    });
    await expect(asActor(ids, ids.participant, async (connection) =>
      new GuildFabricGovernanceRepository(connection, ids.guild).requestContributionCorrection({
        id: randomUUID(),
        actorId: ids.participant,
        evidenceEventId: ids.participantEvidenceTwo,
        reason: "A duplicate pending request for the same evidence is forbidden.",
        audit: audit(),
      }))).rejects.toThrow();
    const rejected = await asActor(ids, ids.manager, async (connection) =>
      new GuildFabricGovernanceRepository(connection, ids.guild)
        .reviewContributionCorrection({
          requestId: rejectionRequestId,
          reviewerActorId: ids.manager,
          expectedVersion: 1,
          outcome: "rejected",
          reason: "The requested attribution change is not supported by the evidence.",
          audit: audit(),
        }));
    expect(rejected.status).toBe("rejected");
  });

  it("rejects cross-Guild evidence and rolls back correction rows without matching Chronicle", async () => {
    const ids = await fixture("Audit atomicity");
    const foreign = await fixture("Foreign evidence");
    await asActor(ids, ids.participant, async (connection) => {
      await expect(new GuildFabricGovernanceRepository(connection, ids.guild)
        .requestContributionCorrection({
          id: randomUUID(),
          actorId: ids.participant,
          evidenceEventId: foreign.participantEvidence,
          reason: "Foreign Guild evidence must remain invisible.",
          audit: audit(),
        })).rejects.toThrow("not found for the subject Actor");
    });

    const orphanRequestId = randomUUID();
    await expect(asActor(ids, ids.participant, async (connection) => {
      const digest = (await connection.query<{ digest: string }>(
        "SELECT guild_runtime.chronicle_event_sha256($1, $2) AS digest",
        [ids.guild, ids.participantEvidence],
      )).rows[0]?.digest;
      await connection.query(
        `INSERT INTO contribution_correction_requests
           (id, guild_id, subject_actor_id, requested_by_actor_id,
            chronicle_event_id, evidence_sha256, reason, status, version,
            request_chronicle_event_id)
         VALUES ($1, $2, $3, $3, $4, $5,
                 'This row must roll back without its required Chronicle event.',
                 'pending', 1, $6)`,
        [
          orphanRequestId,
          ids.guild,
          ids.participant,
          ids.participantEvidence,
          digest,
          randomUUID(),
        ],
      );
    })).rejects.toThrow();

    const count = await asActor(ids, ids.participant, async (connection) =>
      (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM contribution_correction_requests WHERE guild_id = $1 AND id = $2",
        [ids.guild, orphanRequestId],
      )).rows[0]?.count);
    expect(count).toBe("0");
  });

  it("evaluates contribution RLS with the empty search path used by pg_dump", async () => {
    const ids = await fixture("Backup search path");
    const requestId = randomUUID();

    await asActor(ids, ids.participant, async (connection) => {
      await new GuildFabricGovernanceRepository(connection, ids.guild)
        .requestContributionCorrection({
          id: requestId,
          actorId: ids.participant,
          evidenceEventId: ids.participantEvidence,
          reason: "Verify that forced-RLS backup remains available with a cleared search path.",
          audit: audit(),
        });
    });

    await asActor(ids, ids.manager, async (connection) => {
      await connection.query("SELECT set_config('search_path', 'pg_catalog', true)");
      const functionResult = await connection.query<{ allowed: boolean }>(
        "SELECT guild_runtime.is_contribution_correction_manager($1, $2, $3) AS allowed",
        [ids.guild, ids.manager, ids.participantEvidence],
      );
      expect(functionResult.rows).toEqual([{ allowed: true }]);

      const visible = await connection.query<{ id: string }>(
        "SELECT id::text FROM public.contribution_correction_requests WHERE guild_id = $1 AND id = $2",
        [ids.guild, requestId],
      );
      expect(visible.rows).toEqual([{ id: requestId }]);
    });
  });
});
