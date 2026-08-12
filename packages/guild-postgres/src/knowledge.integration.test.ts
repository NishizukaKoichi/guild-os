import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildKnowledgeRepository } from "./knowledge.js";
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
    details: { source: "knowledge-integration-test" },
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

async function bootstrapFixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    rootSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Knowledge Guild",
      purpose: "Verify governed organizational memory",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Knowledge editor",
        permissions: [
          "guild.read",
          "space.read",
          "knowledge.read",
          "knowledge.create",
          "knowledge.propose",
          "knowledge.approve",
          "file.read",
          "file.create",
          "file.delete",
        ],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
  });
  return ids;
}

function content(revision: string) {
  return {
    title: { en: "Opening procedure", ja: "開店手順" },
    summary: { en: `Daily checklist ${revision}`, ja: `日次チェック ${revision}` },
    body: {
      en: `Open the register and verify the safety log. ${revision}`,
      ja: `レジを起動して安全記録を確認します。${revision}`,
    },
    sourceIds: [] as string[],
  };
}

integration("Guild Knowledge repository", () => {
  it("runs immutable drafts through review, publication, revision, search, and retirement", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const knowledgeId = randomUUID();
    const fileId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.createKnowledge({
        id: knowledgeId,
        spaceId: ids.rootSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Initial operational procedure.",
        ...content("v1"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.created", "knowledge", knowledgeId),
      });
      await repository.beginFileUpload({
        fileId,
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        originalName: "opening-checklist.pdf",
        mediaType: "application/pdf",
        byteSize: 128,
        sha256: "a".repeat(64),
        r2Key: `${ids.guild}/knowledge/${knowledgeId}/${fileId}`,
        uploadExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        chronicleEvent: event(ids.guild, ids.root, "file.upload.started", "file", fileId),
      });
      await repository.finalizeFileUpload(
        fileId,
        ids.root,
        event(ids.guild, ids.root, "file.upload.completed", "file", fileId),
      );
    });

    const version2 = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildKnowledgeRepository(connection, ids.guild).saveDraft({
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        spaceId: ids.rootSpace,
        visibility: "restricted",
        classification: "internal",
        allowedIdentityIds: [ids.root],
        reviewDueAt: "2030-01-01T00:00:00.000Z",
        changeNote: "Clarify the safety check.",
        ...content("v2"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.version.created", "knowledge", knowledgeId),
      }));
    expect(version2).toBe(2);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.propose({
        knowledgeId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.proposed", "knowledge", knowledgeId),
      });
      await repository.review({
        knowledgeId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        reviewId: randomUUID(),
        verdict: "request_changes",
        reason: "Add an explicit register check.",
        chronicleEvent: event(ids.guild, ids.root, "knowledge.changes_requested", "knowledge", knowledgeId),
      });
    });

    const version3 = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      const version = await repository.saveDraft({
        knowledgeId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        spaceId: ids.rootSpace,
        visibility: "restricted",
        classification: "internal",
        allowedIdentityIds: [ids.root],
        reviewDueAt: "2030-01-01T00:00:00.000Z",
        changeNote: "Address the review.",
        ...content("v3 approved"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.version.created", "knowledge", knowledgeId),
      });
      await repository.propose({
        knowledgeId,
        expectedVersion: version,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.proposed", "knowledge", knowledgeId),
      });
      await repository.review({
        knowledgeId,
        expectedVersion: version,
        actorIdentityId: ids.root,
        reviewId: randomUUID(),
        verdict: "approve",
        reason: "Procedure verified against the current opening policy.",
        chronicleEvent: event(ids.guild, ids.root, "knowledge.canonical", "knowledge", knowledgeId),
      });
      await repository.acknowledge(
        knowledgeId,
        version,
        ids.root,
        event(ids.guild, ids.root, "knowledge.acknowledged", "knowledge", knowledgeId),
      );
      return version;
    });
    expect(version3).toBe(3);

    const published = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      return {
        detail: await repository.getKnowledge(knowledgeId),
        acknowledged: await repository.hasAcknowledged(knowledgeId, version3, ids.root),
        search: await repository.searchCanonical("register safety"),
        file: await repository.getFile(fileId),
      };
    });
    expect(published.detail).toMatchObject({
      state: "canonical",
      currentVersion: 3,
      canonicalVersion: 3,
      visibility: "restricted",
      allowedIdentityIds: [ids.root],
      reviewDueAt: "2030-01-01T00:00:00.000Z",
    });
    expect(published.detail.versions.map((version) => version.state)).toEqual([
      "canonical",
      "archived",
      "archived",
    ]);
    expect(published.detail.reviews.map((review) => review.verdict)).toEqual([
      "approve",
      "request_changes",
    ]);
    expect(published.detail.files).toHaveLength(1);
    expect(published.acknowledged).toBe(true);
    expect(published.search.map((item) => item.id)).toContain(knowledgeId);
    expect(published.file.originalName).toBe("opening-checklist.pdf");
    expect(published.file.visibility).toBe("space");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE knowledge SET visibility = 'guild' WHERE guild_id = $1 AND id = $2",
        [ids.guild, knowledgeId],
      );
    })).rejects.toThrow("security boundary is immutable");

    const version4 = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      const version = await repository.startRevision({
        knowledgeId,
        expectedVersion: 3,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.revision.started", "knowledge", knowledgeId),
      });
      expect((await repository.getKnowledge(knowledgeId)).files).toHaveLength(1);
      expect((await repository.getFile(fileId)).knowledgeVersion).toBe(3);
      await expect(repository.saveDraft({
        knowledgeId,
        expectedVersion: version,
        actorIdentityId: ids.root,
        spaceId: ids.rootSpace,
        visibility: "guild",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Attempt unsafe policy mutation.",
        ...content("unsafe"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.version.created", "knowledge", knowledgeId),
      })).rejects.toThrow("security boundaries are immutable");
      await repository.archiveWorkingVersion({
        knowledgeId,
        expectedVersion: version,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.revision.discarded", "knowledge", knowledgeId),
      });
      return version;
    });
    expect(version4).toBe(4);

    const version5 = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      const version = await repository.startRevision({
        knowledgeId,
        expectedVersion: 3,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.revision.started", "knowledge", knowledgeId),
      });
      expect(await repository.removeFileFromDraft(
        knowledgeId,
        version,
        fileId,
        ids.root,
        event(ids.guild, ids.root, "file.unlinked", "file", fileId),
      )).toBeNull();
      await repository.archiveWorkingVersion({
        knowledgeId,
        expectedVersion: version,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.revision.discarded", "knowledge", knowledgeId),
      });
      return version;
    });
    expect(version5).toBe(5);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.deprecate({
        knowledgeId,
        expectedVersion: 3,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.deprecated", "knowledge", knowledgeId),
      });
      await repository.archiveDeprecated({
        knowledgeId,
        expectedVersion: 3,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.archived", "knowledge", knowledgeId),
      });
      expect(await repository.searchCanonical("register safety")).toEqual([]);
    });

    const chronicle = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 ORDER BY sequence",
        [ids.guild],
      )).rows.map((row) => row.action));
    expect(chronicle).toContain("knowledge.canonical");
    expect(chronicle).toContain("knowledge.acknowledged");
    expect(chronicle).toContain("knowledge.archived");
  });

  it("rejects stale writes and direct mutation of version and review history", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const knowledgeId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildKnowledgeRepository(connection, ids.guild).createKnowledge({
        id: knowledgeId,
        spaceId: ids.rootSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Initial version.",
        ...content("immutable"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.created", "knowledge", knowledgeId),
      });
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildKnowledgeRepository(connection, ids.guild).saveDraft({
        knowledgeId,
        expectedVersion: 99,
        actorIdentityId: ids.root,
        spaceId: ids.rootSpace,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Stale edit.",
        ...content("stale"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.version.created", "knowledge", knowledgeId),
      });
    })).rejects.toThrow("changed since it was loaded");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE knowledge_versions SET title = '{"en":"Tampered"}'::jsonb
          WHERE guild_id = $1 AND knowledge_id = $2 AND version = 1`,
        [ids.guild, knowledgeId],
      );
    })).rejects.toThrow("immutable");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO knowledge_versions
           (guild_id, knowledge_id, version, state, title, summary, body, source_ids,
            created_by_identity_id, change_note)
         VALUES ($1, $2, 2, 'draft', '{"en":"Title"}'::jsonb,
                 '{"ja":"概要"}'::jsonb, '{"en":"Body"}'::jsonb, '{}', $3, 'invalid')`,
        [ids.guild, knowledgeId, ids.root],
      );
    })).rejects.toThrow("knowledge_versions_languages_check");
  });

  it("queues interrupted uploads for idempotent R2 cleanup and retries failures", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await bootstrapFixture();
    const knowledgeId = randomUUID();
    const fileId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.createKnowledge({
        id: knowledgeId,
        spaceId: ids.rootSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Create cleanup fixture.",
        ...content("cleanup"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.created", "knowledge", knowledgeId),
      });
      await repository.beginFileUpload({
        fileId,
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        originalName: "interrupted.txt",
        mediaType: "text/plain",
        byteSize: 12,
        sha256: "b".repeat(64),
        r2Key: `${ids.guild}/knowledge/${knowledgeId}/${fileId}`,
        uploadExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        chronicleEvent: event(ids.guild, ids.root, "file.upload.started", "file", fileId),
      });
      await expect(repository.propose({
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "knowledge.proposed", "knowledge", knowledgeId),
      })).rejects.toThrow("pending file uploads");
      await expect(repository.saveDraft({
        knowledgeId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        spaceId: ids.rootSpace,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Must wait for upload.",
        ...content("blocked"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.version.created", "knowledge", knowledgeId),
      })).rejects.toThrow("pending file uploads");
    });

    const claimed = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      expect(await repository.queueExpiredFileDeletions()).toBe(1);
      return repository.claimFileDeletions();
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ fileId, attemptCount: 1 });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.retryFileDeletion(claimed[0]!.outboxId, "Synthetic R2 outage");
      const deferred = await connection.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM outbox WHERE guild_id = $1 AND id = $2",
        [ids.guild, claimed[0]!.outboxId],
      );
      expect(deferred.rows[0]).toEqual({ status: "pending", attempt_count: 1 });
      await connection.query(
        "UPDATE outbox SET available_at = now() WHERE guild_id = $1 AND id = $2",
        [ids.guild, claimed[0]!.outboxId],
      );
    });

    const reclaimed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildKnowledgeRepository(connection, ids.guild).claimFileDeletions());
    expect(reclaimed[0]).toMatchObject({ fileId, attemptCount: 2 });
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      await repository.completeFileDeletion(reclaimed[0]!.outboxId);
      const result = await connection.query<{ outbox_status: string; file_status: string; links: string }>(
        `SELECT o.status AS outbox_status, f.status AS file_status,
                count(link.file_id)::text AS links
           FROM outbox o
           JOIN files f ON f.guild_id = o.guild_id AND f.id = $3
           LEFT JOIN knowledge_version_files link
             ON link.guild_id = f.guild_id AND link.file_id = f.id
          WHERE o.guild_id = $1 AND o.id = $2
          GROUP BY o.status, f.status`,
        [ids.guild, reclaimed[0]!.outboxId, fileId],
      );
      expect(result.rows[0]).toEqual({
        outbox_status: "completed",
        file_status: "deleted",
        links: "0",
      });
    });
  });
});
