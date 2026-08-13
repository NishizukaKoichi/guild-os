import { randomUUID } from "node:crypto";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import {
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import { describe, expect, it } from "vitest";
import type { GuildEnv } from "../src/config.js";
import {
  GuildRetentionRuntime,
  PostgresRetentionRuntimeRepository,
} from "../src/retention-runtime.js";
import { GuildRetentionService } from "../src/retention-service.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const DAY_MS = 86_400_000;

interface FixtureIds {
  readonly guild: string;
  readonly root: string;
  readonly member: string;
  readonly verifier: string;
  readonly rootSpace: string;
  readonly operatorRole: string;
  readonly memory: string;
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 30,
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
  ids: Pick<FixtureIds, "guild" | "root">,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId: ids.guild,
    spaceId: null,
    ownerIdentityId: ids.root,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: ids.root,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "retention-service-integration-fixture" },
  };
}

function guildEnv(guildId: string): GuildEnv {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  return {
    GUILD_ID: guildId,
    HYPERDRIVE: { connectionString },
  } as GuildEnv;
}

function runtime(ids: FixtureIds): GuildRetentionRuntime {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  return new GuildRetentionRuntime(new PostgresRetentionRuntimeRepository({
    connectionString,
    guildId: ids.guild,
  }), { batchSize: 10 });
}

async function fixture(): Promise<{ ids: FixtureIds; env: GuildEnv; cutoffAt: string }> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids: FixtureIds = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    verifier: randomUUID(),
    rootSpace: randomUUID(),
    operatorRole: randomUUID(),
    memory: randomUUID(),
  };
  const oldAt = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const cutoffAt = new Date(Date.now() - 45 * DAY_MS).toISOString();

  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Retention Service Integration Guild",
      purpose: "Verify retention authorization, execution, and audit boundaries.",
      rootIdentityId: ids.root,
      rootDisplayName: "Retention Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.operatorRole,
        name: "Retention operator",
        permissions: ["data.read", "data.manage"],
      }],
      chronicleEvent: event(ids, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $3, 'human', 'Retention operator', 'active'),
              ($2, $3, 'service', 'Cloudflare Access verifier', 'active')`,
      [ids.member, ids.verifier, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now()),
              ($1, $3, 'active', 'restricted', now())`,
      [ids.guild, ids.member, ids.verifier],
    );
    await connection.query(
      `UPDATE service_profiles
          SET service_type = 'access-verifier',
              description = 'Purchaser-owned Cloudflare Access identity verifier.'
        WHERE guild_id = $1 AND actor_id = $2`,
      [ids.guild, ids.verifier],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, NULL)`,
      [randomUUID(), ids.guild, ids.member, ids.operatorRole],
    );
    await connection.query(
      `INSERT INTO memories
         (id, guild_id, space_id, owner_actor_id, creator_actor_id, type, status,
          workflow, governance_state, visibility, classification, current_version,
          canonical_version, confidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4, 'manual', 'active', NULL, NULL, 'guild',
               'internal', 1, NULL, 1, $5, $5)`,
      [ids.memory, ids.guild, ids.rootSpace, ids.root, oldAt],
    );
    await connection.query(
      `INSERT INTO memory_versions
         (guild_id, memory_id, version, title, summary, body, change_note,
          created_by_actor_id, created_at)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb,
               'Create an old retention fixture', $6, $7)`,
      [
        ids.guild,
        ids.memory,
        JSON.stringify({ en: "Historical operating manual" }),
        JSON.stringify({ en: "A retention candidate." }),
        JSON.stringify({ en: "Archived only after a completed preview." }),
        ids.root,
        oldAt,
      ],
    );
  });
  return { ids, env: guildEnv(ids.guild), cutoffAt };
}

integration("GuildRetentionService with PostgreSQL and RLS", () => {
  it("completes a dry-run preview, rejects a non-root mutation, and applies the matching archive as Root", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env, cutoffAt } = await fixture();
    const actions = [{ category: "memories", action: "archive" }] as const;
    const root = new GuildRetentionService(env, ids.root);
    const previewId = await root.plan({
      dryRun: true,
      cutoffAt,
      actions,
      previewRunId: null,
      confirmation: "",
      idempotencyKey: `retention-preview:${randomUUID()}`,
    });

    await expect(runtime(ids).runNext(`retention-preview-worker:${randomUUID()}`))
      .resolves.toEqual({
        status: "completed",
        runId: previewId,
        dryRun: true,
        candidateCount: 1,
        affectedCount: 0,
      });
    await expect(new GuildRetentionService(env, ids.member).plan({
      dryRun: false,
      cutoffAt,
      actions,
      previewRunId: previewId,
      confirmation: "APPLY",
      idempotencyKey: `retention-member-apply:${randomUUID()}`,
    })).rejects.toThrow("Only the active Human Root Owner");

    const applyId = await root.plan({
      dryRun: false,
      cutoffAt,
      actions,
      previewRunId: previewId,
      confirmation: "APPLY",
      idempotencyKey: `retention-root-apply:${randomUUID()}`,
    });
    await expect(runtime(ids).runNext(`retention-archive-worker:${randomUUID()}`))
      .resolves.toEqual({
        status: "completed",
        runId: applyId,
        dryRun: false,
        candidateCount: 1,
        affectedCount: 1,
      });

    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => ({
      memoryStatus: (await connection.query<{ status: string }>(
        "SELECT status FROM memories WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.memory],
      )).rows[0]?.status,
      preview: (await connection.query<{
        status: string;
        candidate_count: string;
        affected_count: string;
      }>(
        `SELECT run.status, action.candidate_count::text, action.affected_count::text
           FROM retention_runs run
           JOIN retention_actions action
             ON action.guild_id = run.guild_id AND action.retention_run_id = run.id
          WHERE run.guild_id = $1 AND run.id = $2`,
        [ids.guild, previewId],
      )).rows[0],
    }));
    expect(evidence).toEqual({
      memoryStatus: "archived",
      preview: { status: "completed", candidate_count: "1", affected_count: "0" },
    });
  });

  it("requires fresh Access evidence for purge and consumes an audited hash without Chronicle plaintext", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env, cutoffAt } = await fixture();
    const actions = [{ category: "files", action: "purge" }] as const;
    const previewService = new GuildRetentionService(env, ids.root);
    const previewId = await previewService.plan({
      dryRun: true,
      cutoffAt,
      actions,
      previewRunId: null,
      confirmation: "",
      idempotencyKey: `retention-purge-preview:${randomUUID()}`,
    });
    await expect(runtime(ids).runNext(`retention-purge-preview-worker:${randomUUID()}`))
      .resolves.toMatchObject({ status: "completed", runId: previewId, dryRun: true });

    const apply = {
      dryRun: false,
      cutoffAt,
      actions,
      previewRunId: previewId,
      confirmation: "PURGE",
    } as const;
    await expect(new GuildRetentionService(env, ids.root).plan({
      ...apply,
      idempotencyKey: `retention-purge-missing-evidence:${randomUUID()}`,
    })).rejects.toThrow("recent identity-provider reauthentication");
    await expect(new GuildRetentionService(
      env,
      ids.root,
      new Date(Date.now() - 6 * 60_000).toISOString(),
    ).plan({
      ...apply,
      idempotencyKey: `retention-purge-expired-evidence:${randomUUID()}`,
    })).rejects.toThrow("within the last five minutes");

    const privatePlaintext = `private-idempotency-${randomUUID()}`;
    const verifiedAt = new Date().toISOString();
    const purgeId = await new GuildRetentionService(env, ids.root, verifiedAt).plan({
      ...apply,
      idempotencyKey: privatePlaintext,
    });
    await expect(runtime(ids).runNext(`retention-purge-worker:${randomUUID()}`))
      .resolves.toMatchObject({
        status: "completed",
        runId: purgeId,
        dryRun: false,
        candidateCount: 0,
        affectedCount: 0,
      });

    const audit = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const evidenceRow = (await connection.query<{
        id: string;
        consumed_by_retention_run_id: string;
        consumed_at: string;
        verification_method: string;
        verifier_assertion_sha256: string;
        verifier_service_type: string;
      }>(
        `SELECT evidence.id::text,
                evidence.consumed_by_retention_run_id::text,
                evidence.consumed_at::text,
                evidence.verification_method,
                evidence.verifier_assertion_sha256,
                verifier.service_type AS verifier_service_type
           FROM retention_runs run
           JOIN server_authorization_evidence evidence
             ON evidence.guild_id = run.guild_id
            AND evidence.id = run.authorization_evidence_id
           JOIN service_profiles verifier
             ON verifier.guild_id = evidence.guild_id
            AND verifier.actor_id = evidence.verified_by_service_actor_id
          WHERE run.guild_id = $1 AND run.id = $2`,
        [ids.guild, purgeId],
      )).rows[0];
      const chronicleRows = (await connection.query<{
        action: string;
        details: string;
      }>(
        `SELECT action, details::text
           FROM chronicle_events
          WHERE guild_id = $1
            AND (
              (subject_type = 'retention_run' AND subject_id = $2)
              OR subject_type = 'server_authorization_evidence'
            )
          ORDER BY sequence`,
        [ids.guild, purgeId],
      )).rows;
      return { evidenceRow, chronicleRows };
    });

    expect(audit.evidenceRow).toMatchObject({
      consumed_by_retention_run_id: purgeId,
      verification_method: "cloudflare-access-login-iat",
      verifier_service_type: "access-verifier",
    });
    expect(audit.evidenceRow?.consumed_at).toBeTruthy();
    expect(audit.evidenceRow?.verifier_assertion_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.chronicleRows.map((row) => row.action)).toEqual(expect.arrayContaining([
      "authorization.verified",
      "retention.planned",
      "retention.completed",
    ]));
    const chronicleDetails = audit.chronicleRows.map((row) => row.details).join("\n");
    expect(chronicleDetails).not.toContain(privatePlaintext);
    expect(chronicleDetails).not.toContain(verifiedAt);
    expect(chronicleDetails).not.toContain(audit.evidenceRow?.verifier_assertion_sha256);
    expect(chronicleDetails).not.toContain("idempotencyKey");
    expect(chronicleDetails).not.toContain("confirmation");
  });
});
