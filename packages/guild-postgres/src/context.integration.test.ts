import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildCollectiveRepository } from "./collective.js";
import { GuildContextRepository } from "./context.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "context-integration-test" },
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

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    hiddenSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Context Boundary Test Guild",
      purpose: "Verify Context Graph, custody, and Chronicle invariants",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Team participant",
        permissions: [
          "guild.read",
          "space.read",
          "memory.read",
          "memory.create",
          "memory.govern",
          "relation.read",
          "relation.manage",
        ],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'),
              ($4, $2, $3, 'Hidden team', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.hiddenSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $2, 'human', 'Team member', 'active')`,
      [ids.member, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now())`,
      [ids.guild, ids.member],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), ids.guild, ids.member, ids.role, ids.teamSpace],
    );
  });
  return ids;
}

function memoryContent(title: string, revision: string) {
  return {
    title: { en: title },
    summary: { en: `${title} summary ${revision}` },
    body: { en: `${title} body ${revision}` },
    sourceIds: [] as string[],
  };
}

integration("Guild Context repository", () => {
  it("does not expose a relation when either endpoint is outside the actor's authorized boundary", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const visibleMemoryId = randomUUID();
    const hiddenMemoryId = randomUUID();
    const relationId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      await repository.createMemory({
        id: visibleMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "Visible endpoint.",
        ...memoryContent("Visible team finding", "v1"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", visibleMemoryId),
      });
      await repository.createMemory({
        id: hiddenMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.hiddenSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "Hidden endpoint.",
        ...memoryContent("Hidden team finding", "v1"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", hiddenMemoryId),
      });
    });

    const relationWasStored = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => {
        await connection.query("SAVEPOINT cross_space_relation");
        try {
          await new GuildContextRepository(connection, ids.guild).createRelation({
            id: relationId,
            actorId: ids.root,
            fromType: "memory",
            fromId: visibleMemoryId,
            relationType: "supports",
            toType: "memory",
            toId: hiddenMemoryId,
            spaceId: ids.teamSpace,
            visibility: "space",
            classification: "internal",
            allowedActorIds: [],
            properties: {},
            rationale: "A deliberately malformed cross-Space edge must never leak its target.",
            chronicleEvent: event(
              ids.guild,
              ids.root,
              "relation.created",
              "relation",
              relationId,
            ),
          });
          await connection.query("RELEASE SAVEPOINT cross_space_relation");
          return true;
        } catch {
          await connection.query("ROLLBACK TO SAVEPOINT cross_space_relation");
          await connection.query("RELEASE SAVEPOINT cross_space_relation");
          return false;
        }
      },
    );

    const memberView = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.member]);
      const memories = await new GuildCollectiveRepository(connection, ids.guild).listMemories(ids.member);
      const relations = await new GuildContextRepository(connection, ids.guild).listRelations(ids.member);
      return { memories, relations };
    });
    expect(memberView.memories.items.map((memory) => memory.id)).toContain(visibleMemoryId);
    expect(memberView.memories.items.map((memory) => memory.id)).not.toContain(hiddenMemoryId);
    if (relationWasStored) {
      expect(memberView.relations.items.map((relation) => relation.id)).not.toContain(relationId);
      expect(memberView.relations.items.flatMap((relation) => [relation.fromId, relation.toId]))
        .not.toContain(hiddenMemoryId);
    } else {
      expect(relationWasStored).toBe(false);
    }
  });

  it("keeps Personal Memory out of indexing, authorized search, and contradiction candidates until explicit sharing", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const personalMemoryId = randomUUID();
    const privateGuildMemoryId = randomUUID();
    const guildMemoryOneId = randomUUID();
    const guildMemoryTwoId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      await repository.createMemory({
        id: personalMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "private",
        classification: "confidential",
        allowedActorIds: [],
        confidence: 0.7,
        custody: "personal",
        changeNote: "Private working note.",
        ...memoryContent("Lighthouse private notebook", "v1"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", personalMemoryId),
      });
      await repository.createMemory({
        id: privateGuildMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "private",
        classification: "confidential",
        allowedActorIds: [],
        confidence: 0.8,
        changeNote: "Official confidential Guild record.",
        ...memoryContent("Lighthouse official restricted record", "guild-private"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", privateGuildMemoryId),
      });
      await repository.saveMemory({
        memoryId: personalMemoryId,
        actorId: ids.root,
        expectedVersion: 1,
        changeNote: "Private note revision.",
        ...memoryContent("Lighthouse private notebook", "v2 current"),
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "memory.version.created",
          "memory",
          personalMemoryId,
        ),
      });
      await repository.createMemory({
        id: guildMemoryOneId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "Guild comparison note one.",
        ...memoryContent("Lighthouse operating finding", "guild one"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", guildMemoryOneId),
      });
      await repository.createMemory({
        id: guildMemoryTwoId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "Guild comparison note two.",
        ...memoryContent("Lighthouse operating finding", "guild two"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", guildMemoryTwoId),
      });
    });

    const beforeShare = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      const context = new GuildContextRepository(connection, ids.guild);
      const search = await new GuildCollectiveRepository(connection, ids.guild)
        .searchAuthorizedMemories(ids.root, "lighthouse", "en");
      const candidates = await context.listMemoryComparisonCandidates(50);
      const jobs = await connection.query<{ memory_version: number }>(
        `SELECT memory_version FROM memory_embedding_jobs
          WHERE guild_id = $1 AND memory_id = $2 ORDER BY memory_version`,
        [ids.guild, personalMemoryId],
      );
      return {
        custody: await context.getCustody("memory", personalMemoryId),
        privateGuildCustody: await context.getCustody("memory", privateGuildMemoryId),
        search,
        candidates,
        jobs: jobs.rows,
      };
    });
    expect(beforeShare.custody).toMatchObject({
      custody: "personal",
      personalOwnerActorId: ids.root,
      version: 1,
    });
    expect(beforeShare.privateGuildCustody).toMatchObject({
      custody: "guild",
      personalOwnerActorId: null,
      version: 1,
    });
    expect(beforeShare.jobs).toEqual([]);
    expect(beforeShare.search.map((memory) => memory.id)).toEqual(expect.arrayContaining([
      guildMemoryOneId,
      guildMemoryTwoId,
    ]));
    expect(beforeShare.search.map((memory) => memory.id)).not.toContain(personalMemoryId);
    expect(beforeShare.candidates.length).toBeGreaterThan(0);
    expect(beforeShare.candidates.flatMap((candidate) => [
      candidate.memoryId,
      candidate.comparedMemoryId,
    ])).not.toContain(personalMemoryId);

    const shared = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      return new GuildContextRepository(connection, ids.guild).sharePersonalData(
        "memory",
        personalMemoryId,
        1,
        ids.root,
        event(ids.guild, ids.root, "memory.personal.shared", "memory", personalMemoryId),
      );
    });
    expect(shared).toMatchObject({
      custody: "shared",
      personalOwnerActorId: ids.root,
      sharedByActorId: ids.root,
      version: 2,
    });

    const afterShare = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const search = await new GuildCollectiveRepository(connection, ids.guild)
        .searchAuthorizedMemories(ids.root, "lighthouse private notebook", "en");
      const jobs = await connection.query<{
        memory_version: number;
        locale: string;
        job_count: number;
      }>(
        `SELECT memory_version, locale, count(*)::integer AS job_count
           FROM memory_embedding_jobs
          WHERE guild_id = $1 AND memory_id = $2
          GROUP BY memory_version, locale
          ORDER BY memory_version, locale`,
        [ids.guild, personalMemoryId],
      );
      return { search, jobs: jobs.rows };
    });
    expect(afterShare.search.map((memory) => memory.id)).toContain(personalMemoryId);
    expect(afterShare.jobs).toEqual([{ memory_version: 2, locale: "en", job_count: 1 }]);
  });

  it("makes relation revocation and review-signal resolution one-way, versioned, and Chronicle-backed", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const firstMemoryId = randomUUID();
    const secondMemoryId = randomUUID();
    const relationId = randomUUID();
    const relationCreateEvent = event(
      ids.guild,
      ids.root,
      "relation.created",
      "relation",
      relationId,
    );
    const relationRevokeEvent = event(
      ids.guild,
      ids.root,
      "relation.revoked",
      "relation",
      relationId,
    );

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const collective = new GuildCollectiveRepository(connection, ids.guild);
      await collective.createMemory({
        id: firstMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "First evidence record.",
        ...memoryContent("Conflicting operating finding", "first"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", firstMemoryId),
      });
      await collective.createMemory({
        id: secondMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.9,
        changeNote: "Second evidence record.",
        ...memoryContent("Conflicting operating finding", "second"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", secondMemoryId),
      });
      const context = new GuildContextRepository(connection, ids.guild);
      await context.createRelation({
        id: relationId,
        actorId: ids.root,
        fromType: "memory",
        fromId: firstMemoryId,
        relationType: "contradicts",
        toType: "memory",
        toId: secondMemoryId,
        spaceId: ids.teamSpace,
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        properties: { confidence: "review-required" },
        rationale: "The two findings require governed review.",
        chronicleEvent: relationCreateEvent,
      });
      expect(await context.addContradictionSignal(
        firstMemoryId,
        secondMemoryId,
        "The findings prescribe incompatible operating states.",
        ids.root,
      )).toBe(true);
    });

    const signal = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const signals = await new GuildContextRepository(connection, ids.guild).listReviewSignals("open");
      const match = signals.find((item) =>
        item.memoryId === firstMemoryId && item.comparedMemoryId === secondMemoryId);
      if (!match) throw new Error("Expected contradiction signal was not created.");
      return match;
    });
    expect(signal.version).toBe(1);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE relations SET rationale = 'Tampered rationale'
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, relationId],
      );
    })).rejects.toThrow("immutable");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE memory_review_signals SET evidence = 'Tampered evidence'
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, signal.id],
      );
    })).rejects.toThrow(/immutable|only be resolved or dismissed once/);

    const reviewResolveEvent = event(
      ids.guild,
      ids.root,
      "memory.review_signal.resolved",
      "memory_review_signal",
      signal.id,
    );
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const context = new GuildContextRepository(connection, ids.guild);
      expect(await context.revokeRelation(
        relationId,
        1,
        ids.root,
        relationRevokeEvent,
      )).toBe(2);
      expect(await context.resolveReviewSignal(
        signal.id,
        1,
        "resolved",
        "The second finding supersedes the first after human review.",
        ids.root,
        reviewResolveEvent,
      )).toBe(2);
    });

    const finalState = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const context = new GuildContextRepository(connection, ids.guild);
      const relation = await context.getRelation(relationId);
      const resolvedSignal = (await context.listReviewSignals("resolved"))
        .find((item) => item.id === signal.id);
      const chronicle = await connection.query<{
        id: string;
        action: string;
        subject_type: string;
        subject_id: string;
      }>(
        `SELECT id::text, action, subject_type, subject_id::text
           FROM chronicle_events
          WHERE guild_id = $1 AND id = ANY($2::uuid[])
          ORDER BY sequence`,
        [ids.guild, [relationCreateEvent.id, relationRevokeEvent.id, reviewResolveEvent.id]],
      );
      return { relation, resolvedSignal, chronicle: chronicle.rows };
    });
    expect(finalState.relation).toMatchObject({
      status: "revoked",
      version: 2,
      rationale: "The two findings require governed review.",
      revokedByActorId: ids.root,
    });
    expect(finalState.resolvedSignal).toMatchObject({
      status: "resolved",
      version: 2,
      evidence: "The findings prescribe incompatible operating states.",
      resolvedByActorId: ids.root,
      resolution: "The second finding supersedes the first after human review.",
    });
    expect(finalState.chronicle).toEqual([
      {
        id: relationCreateEvent.id,
        action: "relation.created",
        subject_type: "relation",
        subject_id: relationId,
      },
      {
        id: relationRevokeEvent.id,
        action: "relation.revoked",
        subject_type: "relation",
        subject_id: relationId,
      },
      {
        id: reviewResolveEvent.id,
        action: "memory.review_signal.resolved",
        subject_type: "memory_review_signal",
        subject_id: signal.id,
      },
    ]);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildContextRepository(connection, ids.guild).revokeRelation(
        relationId,
        2,
        ids.root,
        event(ids.guild, ids.root, "relation.revoked_again", "relation", relationId),
      ))).rejects.toThrow("changed");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildContextRepository(connection, ids.guild).resolveReviewSignal(
        signal.id,
        2,
        "dismissed",
        "A resolved signal cannot be changed to dismissed.",
        ids.root,
        event(
          ids.guild,
          ids.root,
          "memory.review_signal.dismissed_again",
          "memory_review_signal",
          signal.id,
        ),
      ))).rejects.toThrow("changed");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE chronicle_events SET details = details || '{"tampered":true}'::jsonb
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, reviewResolveEvent.id],
      );
    })).rejects.toThrow("append-only");

    const deletionAttempts = await Promise.allSettled([
      withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await connection.query("DELETE FROM relations WHERE guild_id = $1 AND id = $2", [
          ids.guild,
          relationId,
        ]);
      }),
      withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await connection.query(
          "DELETE FROM memory_review_signals WHERE guild_id = $1 AND id = $2",
          [ids.guild, signal.id],
        );
      }),
    ]);
    expect(deletionAttempts.map((attempt) => attempt.status)).toEqual(["rejected", "rejected"]);
  });
});
