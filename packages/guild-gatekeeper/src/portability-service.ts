import { createHash } from "node:crypto";
import {
  authorize,
  type AuthorizationSnapshot,
} from "@guild-os/domain";
import {
  EXPORT_CATEGORIES,
  GuildPortabilityRepository,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type DataExportJob,
  type ExportCategory,
  type GuildTransactionConnection,
  type SnapshotRecord,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";

const EXPORT_FORMAT_VERSION = 1;
const EXPORT_LEASE_SECONDS = 300;
const EXPORT_EXPIRY_DAYS = 7;
const EXPORT_PAGE_SIZE = 200;
const MAX_EXPORT_BATCH = 5;
const EXPORT_PREFIX = "guild-data-exports";

export interface UiDataExportJob {
  id: string;
  requestedCategories: readonly ExportCategory[];
  includeRequesterPersonal: boolean;
  status: DataExportJob["status"];
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  sha256: string | null;
  byteCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  completedAt: string | null;
  expiresAt: string | null;
  errorSummary: string | null;
  version: number;
  createdAt: string;
}

export interface RequestDataExportInput {
  includeRequesterPersonal: boolean;
  idempotencyKey: string;
}

export interface RetryDataExportInput {
  id: string;
  expectedVersion: number;
}

interface ExportCounters {
  bytes: number;
  rows: number;
  files: number;
}

function forUi(job: DataExportJob): UiDataExportJob {
  return {
    id: job.id,
    requestedCategories: job.requestedCategories,
    includeRequesterPersonal: job.includeRequesterPersonal,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    retryable: job.retryable,
    sha256: job.sha256,
    byteCount: job.byteCount,
    rowCount: job.rowCount,
    fileCount: job.fileCount,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    errorSummary: job.errorSummary,
    version: job.version,
    createdAt: job.createdAt,
  };
}

function assertIdempotencyKey(value: string): void {
  if (value.trim().length < 8 || value.length > 500) {
    throw new Error("Export request ID must contain between 8 and 500 characters.");
  }
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : "UnknownError";
}

function manifestKey(guildId: string, jobId: string): string {
  return `${EXPORT_PREFIX}/${guildId}/${jobId}/manifest.ndjson`;
}

function exportFileKey(guildId: string, jobId: string, fileId: string): string {
  return `${EXPORT_PREFIX}/${guildId}/${jobId}/files/${fileId}`;
}

function encodeLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function objectRow(record: SnapshotRecord): Record<string, unknown> | null {
  const data = record.data;
  const row = data.row;
  return row !== null && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

async function copyExportFile(
  env: GuildEnv,
  job: DataExportJob,
  record: SnapshotRecord,
): Promise<SnapshotRecord> {
  const row = objectRow(record);
  if (!row || typeof row.id !== "string" || typeof row.r2_key !== "string") return record;
  if (row.status !== "ready") return record;
  const source = await env.KNOWLEDGE_FILES.get(row.r2_key);
  if (!source) throw new Error("A file included by the export is missing from purchaser-owned R2.");
  const expectedSize = Number(row.byte_size);
  if (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && source.size !== expectedSize) {
    throw new Error("A file included by the export does not match its database metadata.");
  }
  const targetKey = exportFileKey(env.GUILD_ID, job.id, row.id);
  const copied = await env.KNOWLEDGE_FILES.put(targetKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: {
      guildId: env.GUILD_ID,
      exportJobId: job.id,
      sourceFileId: row.id,
      sourceSha256: typeof row.sha256 === "string" ? row.sha256 : "",
    },
  });
  if (!copied) throw new Error("R2 rejected an exported file.");
  return {
    ...record,
    data: {
      ...record.data,
      contentIncluded: true,
      exportObjectKey: targetKey,
    },
  };
}

async function writeExportManifest(
  env: GuildEnv,
  connection: GuildTransactionConnection,
  job: DataExportJob,
): Promise<{ sha256: string; counters: ExportCounters; objectKey: string }> {
  const repository = new GuildPortabilityRepository(connection, env.GUILD_ID);
  const hash = createHash("sha256");
  const counters: ExportCounters = { bytes: 0, rows: 0, files: 0 };
  let categoryIndex = -1;
  let cursor: string | null = null;
  let pageRecords: readonly SnapshotRecord[] = [];
  let recordIndex = 0;
  let headerSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        const bytes = encodeLine({
          recordType: "guild_export_manifest",
          formatVersion: job.formatVersion,
          guildId: env.GUILD_ID,
          exportJobId: job.id,
          requestedAt: job.createdAt,
          requestedCategories: [...job.requestedCategories],
          includesRequesterPersonalData: job.includeRequesterPersonal,
        });
        counters.bytes += bytes.byteLength;
        hash.update(bytes);
        controller.enqueue(bytes);
        return;
      }

      while (recordIndex >= pageRecords.length) {
        if (categoryIndex >= job.requestedCategories.length) {
          controller.close();
          return;
        }
        if (categoryIndex < 0 || cursor === null) categoryIndex += 1;
        if (categoryIndex >= job.requestedCategories.length) {
          controller.close();
          return;
        }
        const category = job.requestedCategories[categoryIndex]!;
        const page = await repository.readExportSnapshotPage({
          exportJobId: job.id,
          category,
          cursor,
          limit: EXPORT_PAGE_SIZE,
        });
        pageRecords = page.records;
        recordIndex = 0;
        cursor = page.nextCursor;
        if (pageRecords.length === 0 && cursor === null) continue;
        break;
      }

      const category = job.requestedCategories[categoryIndex]!;
      let record = pageRecords[recordIndex++]!;
      if (category === "files") {
        record = await copyExportFile(env, job, record);
        if (record.data.contentIncluded === true) counters.files += 1;
      }
      const bytes = encodeLine({
        recordType: "guild_export_record",
        category,
        sortKey: record.sortKey,
        data: record.data,
      });
      counters.bytes += bytes.byteLength;
      counters.rows += 1;
      hash.update(bytes);
      controller.enqueue(bytes);
    },
  });

  const objectKey = manifestKey(env.GUILD_ID, job.id);
  const object = await env.KNOWLEDGE_FILES.put(objectKey, stream, {
    httpMetadata: {
      contentType: "application/x-ndjson; charset=utf-8",
      contentDisposition: `attachment; filename="guild-export-${job.id}.ndjson"`,
    },
    customMetadata: {
      guildId: env.GUILD_ID,
      exportJobId: job.id,
      formatVersion: String(job.formatVersion),
    },
  });
  if (!object) throw new Error("R2 rejected the data export manifest.");
  return { sha256: hash.digest("hex"), counters, objectKey };
}

async function deleteExportObjects(env: GuildEnv, jobId: string): Promise<number> {
  const prefix = `${EXPORT_PREFIX}/${env.GUILD_ID}/${jobId}/`;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.KNOWLEDGE_FILES.list({ prefix, cursor, limit: 1_000 });
    if (page.objects.length > 0) {
      await env.KNOWLEDGE_FILES.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function drainDataExportJobs(
  env: GuildEnv,
  limit = 1,
): Promise<{ processed: number; completed: number; failed: number; expired: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EXPORT_BATCH) {
    throw new Error(`Export batch limit must be between 1 and ${MAX_EXPORT_BATCH}.`);
  }
  const counts = { processed: 0, completed: 0, failed: 0, expired: 0 };
  const workerId = `guild-export:${crypto.randomUUID()}`;

  for (let index = 0; index < limit; index += 1) {
    const claimed = await withGuildTransaction(
      env.HYPERDRIVE.connectionString,
      env.GUILD_ID,
      (connection) => new GuildPortabilityRepository(connection, env.GUILD_ID)
        .claimNextExportJob({
          workerId,
          now: new Date().toISOString(),
          leaseSeconds: EXPORT_LEASE_SECONDS,
        }),
    );
    if (!claimed) break;
    counts.processed += 1;
    try {
      const result = await withGuildTransaction(
        env.HYPERDRIVE.connectionString,
        env.GUILD_ID,
        (connection) => writeExportManifest(env, connection, claimed),
        undefined,
        "repeatable read",
      );
      await withGuildTransaction(
        env.HYPERDRIVE.connectionString,
        env.GUILD_ID,
        (connection) => new GuildPortabilityRepository(connection, env.GUILD_ID)
          .completeExportJob({
            id: claimed.id,
            expectedVersion: claimed.version,
            leaseToken: claimed.leaseToken!,
            actorId: claimed.requesterActorId,
            r2ObjectKey: result.objectKey,
            sha256: result.sha256,
            byteCount: result.counters.bytes,
            rowCount: result.counters.rows,
            fileCount: result.counters.files,
            expiresAt: new Date(Date.now() + EXPORT_EXPIRY_DAYS * 86_400_000).toISOString(),
            chronicleEvent: makeChronicleEvent(
              env.GUILD_ID,
              claimed.requesterActorId,
              "data_export.completed",
              "data_export_job",
              claimed.id,
              {
                formatVersion: claimed.formatVersion,
                rowCount: result.counters.rows,
                fileCount: result.counters.files,
                sha256: result.sha256,
                source: "guild-maintenance",
              },
            ),
          }),
      );
      counts.completed += 1;
    } catch (error) {
      await deleteExportObjects(env, claimed.id).catch(() => 0);
      await withGuildTransaction(
        env.HYPERDRIVE.connectionString,
        env.GUILD_ID,
        (connection) => new GuildPortabilityRepository(connection, env.GUILD_ID)
          .failExportJob({
            id: claimed.id,
            expectedVersion: claimed.version,
            leaseToken: claimed.leaseToken!,
            actorId: claimed.requesterActorId,
            errorSummary: `Export processing failed (${safeErrorType(error)}).`,
            retryable: true,
            chronicleEvent: makeChronicleEvent(
              env.GUILD_ID,
              claimed.requesterActorId,
              "data_export.failed",
              "data_export_job",
              claimed.id,
              { errorType: safeErrorType(error), source: "guild-maintenance" },
            ),
          }),
      );
      counts.failed += 1;
    }
  }

  const due = await withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    (connection) => new GuildPortabilityRepository(connection, env.GUILD_ID).listExportJobs(100),
  );
  for (const job of due) {
    if (job.status !== "completed" || !job.expiresAt || new Date(job.expiresAt) > new Date()) continue;
    await deleteExportObjects(env, job.id);
    await withGuildTransaction(
      env.HYPERDRIVE.connectionString,
      env.GUILD_ID,
      (connection) => new GuildPortabilityRepository(connection, env.GUILD_ID).expireExportJob({
        id: job.id,
        expectedVersion: job.version,
        actorId: job.requesterActorId,
        now: new Date().toISOString(),
        chronicleEvent: makeChronicleEvent(
          env.GUILD_ID,
          job.requesterActorId,
          "data_export.expired",
          "data_export_job",
          job.id,
          { source: "guild-maintenance" },
        ),
      }),
    );
    counts.expired += 1;
  }
  return counts;
}

export class GuildPortabilityService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async listExports(): Promise<readonly UiDataExportJob[]> {
    return this.#authorized("data.read", async (connection) =>
      (await new GuildPortabilityRepository(connection, this.#env.GUILD_ID)
        .listExportJobs()).map(forUi));
  }

  async requestExport(input: RequestDataExportInput): Promise<string> {
    assertIdempotencyKey(input.idempotencyKey);
    const id = crypto.randomUUID();
    const result = await this.#authorized("data.manage", (connection) =>
      new GuildPortabilityRepository(connection, this.#env.GUILD_ID).createExportJob({
        id,
        requesterActorId: this.#accountId,
        formatVersion: EXPORT_FORMAT_VERSION,
        requestedCategories: EXPORT_CATEGORIES,
        includeRequesterPersonal: input.includeRequesterPersonal,
        idempotencyKey: input.idempotencyKey,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "data_export.requested",
          "data_export_job",
          id,
          {
            categories: EXPORT_CATEGORIES.join(","),
            includeRequesterPersonal: input.includeRequesterPersonal,
            source: "guild-ui",
          },
        ),
      }));
    return result.value.id;
  }

  async retryExport(input: RetryDataExportInput): Promise<void> {
    await this.#authorized("data.manage", async (connection) => {
      const repository = new GuildPortabilityRepository(connection, this.#env.GUILD_ID);
      const job = await repository.getExportJob(input.id);
      if (job.requesterActorId !== this.#accountId) {
        throw new Error("Only the Human who requested this export can retry it.");
      }
      await repository.retryExportJob({
        id: input.id,
        expectedVersion: input.expectedVersion,
        actorId: this.#accountId,
        availableAt: new Date().toISOString(),
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "data_export.retried",
          "data_export_job",
          input.id,
          { source: "guild-ui" },
        ),
      });
    });
  }

  async downloadExport(id: string): Promise<Blob> {
    const job = await this.#authorized("data.read", async (connection) => {
      const found = await new GuildPortabilityRepository(connection, this.#env.GUILD_ID)
        .getExportJob(id);
      if (found.requesterActorId !== this.#accountId) {
        throw new Error("Only the Human who requested this export can download it.");
      }
      if (found.status !== "completed" || !found.r2ObjectKey || !found.sha256) {
        throw new Error("This export is not ready to download.");
      }
      if (found.expiresAt && new Date(found.expiresAt) <= new Date()) {
        throw new Error("This export has expired.");
      }
      return found;
    });
    const object = await this.#env.KNOWLEDGE_FILES.get(job.r2ObjectKey!);
    if (!object) throw new Error("The export manifest is missing from purchaser-owned R2.");
    const bytes = await object.arrayBuffer();
    if (job.byteCount !== bytes.byteLength ||
        createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== job.sha256) {
      throw new Error("The export failed checksum verification.");
    }
    return new Blob([bytes], { type: "application/x-ndjson" });
  }

  async #authorized<T>(
    permission: "data.read" | "data.manage",
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        authorize(snapshot, { actorIdentityId: this.#accountId, permission });
        return operation(connection, snapshot);
      },
    );
  }
}
