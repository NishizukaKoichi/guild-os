import { randomUUID } from "node:crypto";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { describe, expect, it } from "vitest";
import { GuildCollectiveRepository } from "./collective.js";
import {
  EXPORT_CATEGORIES,
  GuildPortabilityRepository,
  type DataExportJob,
  type RetentionRunDetail,
} from "./portability.js";
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
  details: ChronicleEvent["details"] = { source: "portability-integration-test" },
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

interface FixtureIds {
  guild: string;
  root: string;
  member: string;
  verifier: string;
  rootSpace: string;
}

async function fixture(label: string): Promise<FixtureIds> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids: FixtureIds = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    verifier: randomUUID(),
    rootSpace: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: `${label} Guild`,
      purpose: "Verify purchaser-owned portability and retention boundaries",
      rootIdentityId: ids.root,
      rootDisplayName: `${label} Root`,
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $3, 'human', $2, 'active'), ($4, $3, 'service', 'Access Verifier', 'active')`,
      [ids.member, `${label} Member`, ids.guild, ids.verifier],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now()),
              ($1, $3, 'active', 'restricted', now())`,
      [ids.guild, ids.member, ids.verifier],
    );
  });
  return ids;
}

async function requestExport(
  ids: FixtureIds,
  requesterActorId = ids.root,
  includeRequesterPersonal = false,
  maxAttempts = 3,
): Promise<DataExportJob> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const id = randomUUID();
  return withGuildTransaction(connectionString, ids.guild, async (connection) => (
    await new GuildPortabilityRepository(connection, ids.guild).createExportJob({
      id,
      requesterActorId,
      formatVersion: 1,
      requestedCategories: ["memories", "files"],
      includeRequesterPersonal,
      idempotencyKey: `export:${id}`,
      maxAttempts,
      chronicleEvent: event(
        ids.guild,
        requesterActorId,
        "data_export.requested",
        "data_export_job",
        id,
      ),
    })
  ).value);
}

async function createMemory(
  ids: FixtureIds,
  ownerActorId: string,
  custody: "guild" | "personal",
  visibility: "guild" | "private",
  title: string,
): Promise<string> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const id = randomUUID();
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildCollectiveRepository(connection, ids.guild).createMemory({
      id,
      actorId: ownerActorId,
      ownerActorId,
      spaceId: null,
      type: "document",
      title: { en: title },
      summary: { en: `${title} summary` },
      body: { en: `${title} body` },
      visibility,
      classification: "restricted",
      allowedActorIds: visibility === "private" ? [ownerActorId] : [],
      sourceIds: [],
      confidence: 1,
      custody,
      changeNote: "Create portability fixture",
      chronicleEvent: event(ids.guild, ownerActorId, "memory.created", "memory", id),
    });
  });
  return id;
}

async function createAuthorizationEvidence(ids: FixtureIds): Promise<string> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const evidenceId = randomUUID();
  const verificationEvent = event(
    ids.guild,
    ids.verifier,
    "authorization.verified",
    "server_authorization_evidence",
    evidenceId,
    { purpose: "retention.purge", source: "test-access-verifier" },
  );
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).appendChronicle(verificationEvent);
    await connection.query(
      `INSERT INTO server_authorization_evidence
         (id, guild_id, subject_human_actor_id, verified_by_service_actor_id,
          purpose, verification_method, verifier_assertion_sha256,
          chronicle_event_id, expires_at)
       VALUES ($1, $2, $3, $4, 'retention.purge', 'cloudflare-access', $5, $6,
               now() + interval '5 minutes')`,
      [evidenceId, ids.guild, ids.root, ids.verifier, "a".repeat(64), verificationEvent.id],
    );
  });
  return evidenceId;
}

async function planRetention(
  ids: FixtureIds,
  options: {
    dryRun: boolean;
    action: "retain" | "archive" | "purge";
    authorizationEvidenceId: string | null;
  },
): Promise<RetentionRunDetail> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const id = randomUUID();
  return withGuildTransaction(connectionString, ids.guild, async (connection) => (
    await new GuildPortabilityRepository(connection, ids.guild).planRetentionRun({
      id,
      requestedByActorId: ids.root,
      dryRun: options.dryRun,
      policyVersion: 1,
      cutoffAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1_000).toISOString(),
      actions: [{ category: "memories", action: options.action }],
      authorizationEvidenceId: options.authorizationEvidenceId,
      idempotencyKey: `retention:${id}`,
      chronicleEvent: event(ids.guild, ids.root, "retention.planned", "retention_run", id),
    })
  ).value);
}

integration("Guild portability and retention", () => {
  it("enforces app-role RLS and never exposes a job across Guilds", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const alpha = await fixture("Portability Alpha");
    const beta = await fixture("Portability Beta");
    const job = await requestExport(alpha);

    const visibleFromBeta = await withGuildTransaction(connectionString, beta.guild, async (connection) => (
      await connection.query<{ id: string }>(
        "SELECT id::text FROM data_export_jobs WHERE id = $1",
        [job.id],
      )
    ).rows);
    expect(visibleFromBeta).toEqual([]);

    await expect(withGuildTransaction(connectionString, beta.guild, async (connection) => {
      await connection.query(
        `INSERT INTO data_export_jobs
           (id, guild_id, requester_actor_id, format_version, requested_categories, idempotency_key)
         VALUES ($1, $2, $3, 1, ARRAY['memories'], $4)`,
        [randomUUID(), alpha.guild, alpha.root, randomUUID()],
      );
    })).rejects.toThrow();
  });

  it("pages every supported export category with a stable opaque cursor", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Category Export");
    const exportId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildPortabilityRepository(connection, ids.guild);
      await repository.createExportJob({
        id: exportId,
        requesterActorId: ids.root,
        formatVersion: 1,
        requestedCategories: EXPORT_CATEGORIES,
        includeRequesterPersonal: false,
        idempotencyKey: `export:${exportId}`,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "data_export.requested",
          "data_export_job",
          exportId,
        ),
      });
      for (const category of EXPORT_CATEGORIES) {
        const first = await repository.readExportSnapshotPage({
          exportJobId: exportId,
          category,
          limit: 1,
        });
        expect(first.category).toBe(category);
        const cursor = first.nextCursor;
        if (cursor !== null) {
          const second = await repository.readExportSnapshotPage({
            exportJobId: exportId,
            category,
            cursor,
            limit: 1,
          });
          expect(second.records[0]).toBeDefined();
          expect(second.records[0]!.sortKey > cursor).toBe(true);
        }
      }
    });
  });

  it("claims an export once under concurrency and freezes its completed manifest", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Concurrent Export");
    const job = await requestExport(ids);
    const now = new Date().toISOString();
    const claims = await Promise.all([
      withGuildTransaction(connectionString, ids.guild, async (connection) =>
        new GuildPortabilityRepository(connection, ids.guild).claimNextExportJob({
          workerId: "worker-a", now, leaseSeconds: 120,
        })),
      withGuildTransaction(connectionString, ids.guild, async (connection) =>
        new GuildPortabilityRepository(connection, ids.guild).claimNextExportJob({
          workerId: "worker-b", now, leaseSeconds: 120,
        })),
    ]);
    const claimed = claims.filter((candidate): candidate is DataExportJob => candidate !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(job.id);

    const completed = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildPortabilityRepository(connection, ids.guild);
      const input = {
        id: job.id,
        expectedVersion: claimed[0]!.version,
        leaseToken: claimed[0]!.leaseToken!,
        actorId: ids.root,
        r2ObjectKey: `exports/${ids.guild}/${job.id}.jsonl.gz`,
        sha256: "b".repeat(64),
        byteCount: 1_024,
        rowCount: 17,
        fileCount: 2,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        chronicleEvent: event(ids.guild, ids.root, "data_export.completed", "data_export_job", job.id),
      } as const;
      const first = await repository.completeExportJob(input);
      const replay = await repository.completeExportJob(input);
      expect(replay).toEqual(first);
      return first;
    });
    expect(completed.status).toBe("completed");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE data_export_jobs SET r2_object_key = $3, version = version + 1 WHERE guild_id = $1 AND id = $2",
        [ids.guild, job.id, "exports/tampered.jsonl.gz"],
      );
    })).rejects.toThrow(/manifest is immutable/);
  });

  it("uses explicit custody for snapshot pages and only includes the requester's Personal Memory", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Custody Export");
    const guildPrivate = await createMemory(ids, ids.root, "guild", "private", "Guild private policy");
    const rootPersonal = await createMemory(ids, ids.root, "personal", "guild", "Root personal note");
    const memberPersonal = await createMemory(ids, ids.member, "personal", "guild", "Member personal note");

    const withoutPersonal = await requestExport(ids, ids.root, false);
    const rootOptIn = await requestExport(ids, ids.root, true);
    const memberOptIn = await requestExport(ids, ids.member, true);

    const readIds = async (job: DataExportJob): Promise<string[]> =>
      withGuildTransaction(connectionString, ids.guild, async (connection) => {
        const page = await new GuildPortabilityRepository(connection, ids.guild).readExportSnapshotPage({
          exportJobId: job.id,
          category: "memories",
          limit: 100,
        });
        return page.records
          .filter((record) => record.sortKey.startsWith("memories/memory/"))
          .map((record) => (record.data.row as { id: string }).id);
      });

    expect(await readIds(withoutPersonal)).toEqual([guildPrivate]);
    expect(await readIds(rootOptIn)).toEqual(expect.arrayContaining([guildPrivate, rootPersonal]));
    expect(await readIds(rootOptIn)).not.toContain(memberPersonal);
    expect(await readIds(memberOptIn)).toEqual(expect.arrayContaining([guildPrivate, memberPersonal]));
    expect(await readIds(memberOptIn)).not.toContain(rootPersonal);
  });

  it("retries only retryable exports, caps attempts, and expires completed jobs idempotently", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Retry Export");
    const job = await requestExport(ids, ids.root, false, 2);
    const claim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextExportJob({
        workerId: "retry-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    expect(claim).not.toBeNull();

    const failed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).failExportJob({
        id: job.id,
        expectedVersion: claim!.version,
        leaseToken: claim!.leaseToken!,
        actorId: ids.root,
        errorSummary: "Temporary R2 outage",
        retryable: true,
        chronicleEvent: event(ids.guild, ids.root, "data_export.failed", "data_export_job", job.id),
      }));
    expect(failed.retryable).toBe(true);

    const retried = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).retryExportJob({
        id: job.id,
        expectedVersion: failed.version,
        actorId: ids.root,
        availableAt: new Date(Date.now() - 1_000).toISOString(),
        chronicleEvent: event(ids.guild, ids.root, "data_export.retried", "data_export_job", job.id),
      }));
    const secondClaim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextExportJob({
        workerId: "retry-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    expect(secondClaim?.id).toBe(retried.id);

    const terminalFailure = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).failExportJob({
        id: job.id,
        expectedVersion: secondClaim!.version,
        leaseToken: secondClaim!.leaseToken!,
        actorId: ids.root,
        errorSummary: "Second R2 outage",
        retryable: true,
        chronicleEvent: event(ids.guild, ids.root, "data_export.failed", "data_export_job", job.id),
      }));
    expect(terminalFailure.retryable).toBe(false);
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).retryExportJob({
        id: job.id,
        expectedVersion: terminalFailure.version,
        actorId: ids.root,
        availableAt: new Date().toISOString(),
        chronicleEvent: event(ids.guild, ids.root, "data_export.retried", "data_export_job", job.id),
      }))).rejects.toThrow(/retryable failed export/);

    const expiryJob = await requestExport(ids);
    const expiryClaim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextExportJob({
        workerId: "expiry-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    const dueAt = new Date(Date.now() + 5_000).toISOString();
    const complete = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).completeExportJob({
        id: expiryJob.id,
        expectedVersion: expiryClaim!.version,
        leaseToken: expiryClaim!.leaseToken!,
        actorId: ids.root,
        r2ObjectKey: `exports/${expiryJob.id}.jsonl.gz`,
        sha256: "c".repeat(64),
        byteCount: 1,
        rowCount: 1,
        fileCount: 0,
        expiresAt: dueAt,
        chronicleEvent: event(ids.guild, ids.root, "data_export.completed", "data_export_job", expiryJob.id),
      }));
    const expireInput = {
      id: expiryJob.id,
      expectedVersion: complete.version,
      actorId: ids.root,
      now: new Date(new Date(dueAt).valueOf() + 1_000).toISOString(),
      chronicleEvent: event(ids.guild, ids.root, "data_export.expired", "data_export_job", expiryJob.id),
    } as const;
    const expired = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).expireExportJob(expireInput));
    expect(expired.status).toBe("expired");
    const replay = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).expireExportJob(expireInput));
    expect(replay).toEqual(expired);
  });

  it("keeps dry runs non-destructive and gates purge execution on one-use server evidence", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Retention Evidence");
    const dry = await planRetention(ids, {
      dryRun: true,
      action: "purge",
      authorizationEvidenceId: null,
    });
    expect(dry.run.dryRun).toBe(true);

    await expect(planRetention(ids, {
      dryRun: false,
      action: "purge",
      authorizationEvidenceId: null,
    })).rejects.toThrow(/requires server authorization evidence/);

    const evidenceId = await createAuthorizationEvidence(ids);
    const authorized = await planRetention(ids, {
      dryRun: false,
      action: "purge",
      authorizationEvidenceId: evidenceId,
    });
    expect(authorized.run.authorizationEvidenceId).toBe(evidenceId);

    const consumed = await withGuildTransaction(connectionString, ids.guild, async (connection) => (
      await connection.query<{ consumed_by_retention_run_id: string }>(
        `SELECT consumed_by_retention_run_id::text FROM server_authorization_evidence
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, evidenceId],
      )
    ).rows[0]);
    expect(consumed?.consumed_by_retention_run_id).toBe(authorized.run.id);

    const dryClaim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextRetentionRun({
        workerId: "retention-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    expect(dryClaim?.run.id).toBe(dry.run.id);
    const dryAction = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).saveRetentionCheckpoint({
        id: dry.run.id,
        expectedVersion: dryClaim!.run.version,
        leaseToken: dryClaim!.run.leaseToken!,
        category: "memories",
        expectedActionVersion: dryClaim!.actions[0]!.version,
        checkpointCursor: "memories/end",
        candidateCount: 7,
        affectedCount: 0,
        completed: true,
      }));
    expect(dryAction.affectedCount).toBe(0);
    const dryCompleted = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).completeRetentionRun({
        id: dry.run.id,
        expectedVersion: dryClaim!.run.version,
        leaseToken: dryClaim!.run.leaseToken!,
        resultSummary: { candidates: 7, affected: 0, dryRun: true },
        chronicleEvent: event(ids.guild, ids.root, "retention.completed", "retention_run", dry.run.id),
      }));
    expect(dryCompleted.status).toBe("completed");

    const authorizedClaim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextRetentionRun({
        workerId: "retention-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    expect(authorizedClaim?.run.id).toBe(authorized.run.id);
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).saveRetentionCheckpoint({
        id: authorized.run.id,
        expectedVersion: authorizedClaim!.run.version,
        leaseToken: authorizedClaim!.run.leaseToken!,
        category: "memories",
        expectedActionVersion: authorizedClaim!.actions[0]!.version,
        checkpointCursor: "memories/partial",
        candidateCount: 2,
        affectedCount: 2,
        completed: true,
      }))).resolves.toMatchObject({ status: "completed", affectedCount: 2 });

    await expect(planRetention(ids, {
      dryRun: false,
      action: "purge",
      authorizationEvidenceId: evidenceId,
    })).rejects.toThrow();
  });

  it("records failed retention work without allowing a false completion", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Retention Failure");
    const planned = await planRetention(ids, {
      dryRun: false,
      action: "archive",
      authorizationEvidenceId: null,
    });
    const claimed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).claimNextRetentionRun({
        workerId: "failure-worker", now: new Date().toISOString(), leaseSeconds: 120,
      }));
    expect(claimed?.run.id).toBe(planned.run.id);
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).failRetentionAction({
        id: planned.run.id,
        expectedVersion: claimed!.run.version,
        leaseToken: claimed!.run.leaseToken!,
        category: "memories",
        expectedActionVersion: claimed!.actions[0]!.version,
        checkpointCursor: null,
        candidateCount: 1,
        affectedCount: 0,
        errorSummary: "Archive storage unavailable",
      }));
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).completeRetentionRun({
        id: planned.run.id,
        expectedVersion: claimed!.run.version,
        leaseToken: claimed!.run.leaseToken!,
        resultSummary: { affected: 0 },
        chronicleEvent: event(ids.guild, ids.root, "retention.completed", "retention_run", planned.run.id),
      }))).rejects.toThrow(/every action is complete/);
    const failed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildPortabilityRepository(connection, ids.guild).failRetentionRun({
        id: planned.run.id,
        expectedVersion: claimed!.run.version,
        leaseToken: claimed!.run.leaseToken!,
        errorSummary: "Archive storage unavailable",
        chronicleEvent: event(ids.guild, ids.root, "retention.failed", "retention_run", planned.run.id),
      }));
    expect(failed.status).toBe("failed");
  });
});
