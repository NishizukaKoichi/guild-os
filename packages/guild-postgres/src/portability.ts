import { randomUUID } from "node:crypto";
import type { ChronicleEvent } from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export const EXPORT_CATEGORIES = [
  "guild",
  "actors",
  "spaces",
  "roles",
  "memories",
  "activities",
  "decisions",
  "conversations",
  "files",
  "agent_runs",
  "chronicle",
  "operations",
] as const;

export const RETENTION_CATEGORIES = [
  "memories",
  "activities",
  "decisions",
  "conversations",
  "files",
  "agent_runs",
  "chronicle",
] as const;

export type ExportCategory = (typeof EXPORT_CATEGORIES)[number];
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];
export type ExportJobStatus = "queued" | "processing" | "completed" | "failed" | "expired";
export type RetentionRunStatus = "queued" | "processing" | "completed" | "failed";
export type RetentionActionKind = "retain" | "archive" | "purge";
export type RetentionActionStatus = "pending" | "processing" | "completed" | "failed";

export interface DataExportJob {
  id: string;
  guildId: string;
  requesterActorId: string;
  formatVersion: number;
  requestedCategories: readonly ExportCategory[];
  includeRequesterPersonal: boolean;
  status: ExportJobStatus;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  availableAt: string;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  r2ObjectKey: string | null;
  sha256: string | null;
  byteCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  completedAt: string | null;
  expiresAt: string | null;
  errorSummary: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExportJobInput {
  id: string;
  requesterActorId: string;
  formatVersion: number;
  requestedCategories: readonly ExportCategory[];
  includeRequesterPersonal: boolean;
  idempotencyKey: string;
  maxAttempts?: number;
  availableAt?: string;
  chronicleEvent: ChronicleEvent;
}

export interface ClaimJobInput {
  workerId: string;
  now: string;
  leaseSeconds: number;
  leaseToken?: string;
}

export interface LeaseMutationInput {
  id: string;
  expectedVersion: number;
  leaseToken: string;
}

export interface HeartbeatInput extends LeaseMutationInput {
  now: string;
  leaseSeconds: number;
}

export interface CompleteExportJobInput extends LeaseMutationInput {
  actorId: string;
  r2ObjectKey: string;
  sha256: string;
  byteCount: number;
  rowCount: number;
  fileCount: number;
  expiresAt: string;
  chronicleEvent: ChronicleEvent;
}

export interface FailExportJobInput extends LeaseMutationInput {
  actorId: string;
  errorSummary: string;
  retryable: boolean;
  chronicleEvent: ChronicleEvent;
}

export interface RetryExportJobInput {
  id: string;
  expectedVersion: number;
  actorId: string;
  availableAt: string;
  chronicleEvent: ChronicleEvent;
}

export interface ExpireExportJobInput {
  id: string;
  expectedVersion: number;
  actorId: string;
  now: string;
  chronicleEvent: ChronicleEvent;
}

export interface SnapshotRecord {
  sortKey: string;
  data: Record<string, unknown>;
}

export interface SnapshotPage {
  category: ExportCategory;
  records: readonly SnapshotRecord[];
  nextCursor: string | null;
}

export interface ReadSnapshotPageInput {
  exportJobId: string;
  category: ExportCategory;
  cursor?: string | null;
  limit?: number;
}

export interface ServerAuthorizationEvidence {
  id: string;
  guildId: string;
  subjectHumanActorId: string;
  verifiedByServiceActorId: string;
  purpose: "retention.purge";
  verificationMethod: string;
  verifierAssertionSha256: string;
  chronicleEventId: string;
  verifiedAt: string;
  expiresAt: string;
  consumedByRetentionRunId: string | null;
  consumedAt: string | null;
  createdAt: string;
}

export interface RetentionAction {
  guildId: string;
  retentionRunId: string;
  category: RetentionCategory;
  action: RetentionActionKind;
  cutoffAt: string;
  status: RetentionActionStatus;
  checkpointCursor: string | null;
  candidateCount: number;
  affectedCount: number;
  errorSummary: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionRun {
  id: string;
  guildId: string;
  requestedByActorId: string;
  dryRun: boolean;
  policyVersion: number;
  categories: readonly RetentionCategory[];
  cutoffAt: string;
  authorizationEvidenceId: string | null;
  plannedChronicleEventId: string;
  terminalChronicleEventId: string | null;
  status: RetentionRunStatus;
  idempotencyKey: string;
  attemptCount: number;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  resultSummary: Record<string, unknown> | null;
  errorSummary: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionRunDetail {
  run: RetentionRun;
  actions: readonly RetentionAction[];
}

export interface RetentionActionPlan {
  category: RetentionCategory;
  action: RetentionActionKind;
}

export interface PlanRetentionRunInput {
  id: string;
  requestedByActorId: string;
  dryRun: boolean;
  policyVersion: number;
  cutoffAt: string;
  actions: readonly RetentionActionPlan[];
  authorizationEvidenceId: string | null;
  idempotencyKey: string;
  chronicleEvent: ChronicleEvent;
}

export interface SaveRetentionCheckpointInput extends LeaseMutationInput {
  category: RetentionCategory;
  expectedActionVersion: number;
  checkpointCursor: string | null;
  candidateCount: number;
  affectedCount: number;
  completed: boolean;
}

export interface FailRetentionActionInput extends LeaseMutationInput {
  category: RetentionCategory;
  expectedActionVersion: number;
  checkpointCursor: string | null;
  candidateCount: number;
  affectedCount: number;
  errorSummary: string;
}

export interface CompleteRetentionRunInput extends LeaseMutationInput {
  resultSummary: Record<string, unknown>;
  chronicleEvent: ChronicleEvent;
}

export interface FailRetentionRunInput extends LeaseMutationInput {
  errorSummary: string;
  chronicleEvent: ChronicleEvent;
}

export interface PortabilityIdempotentResult<T> {
  value: T;
  created: boolean;
}

interface ExportJobRow extends QueryResultRow {
  id: string;
  guild_id: string;
  requester_actor_id: string;
  format_version: number;
  requested_categories: ExportCategory[];
  include_requester_personal: boolean;
  status: ExportJobStatus;
  idempotency_key: string;
  attempt_count: number;
  max_attempts: number;
  retryable: boolean;
  available_at: string;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  r2_object_key: string | null;
  sha256: string | null;
  byte_count: string | null;
  row_count: string | null;
  file_count: string | null;
  completed_at: string | null;
  expires_at: string | null;
  error_summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RetentionRunRow extends QueryResultRow {
  id: string;
  guild_id: string;
  requested_by_actor_id: string;
  dry_run: boolean;
  policy_version: number;
  categories: RetentionCategory[];
  cutoff_at: string;
  authorization_evidence_id: string | null;
  planned_chronicle_event_id: string;
  terminal_chronicle_event_id: string | null;
  status: RetentionRunStatus;
  idempotency_key: string;
  attempt_count: number;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  result_summary: Record<string, unknown> | null;
  error_summary: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RetentionActionRow extends QueryResultRow {
  guild_id: string;
  retention_run_id: string;
  category: RetentionCategory;
  action: RetentionActionKind;
  cutoff_at: string;
  status: RetentionActionStatus;
  checkpoint_cursor: string | null;
  candidate_count: string;
  affected_count: string;
  error_summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow extends QueryResultRow {
  sort_key: string;
  data: Record<string, unknown>;
}

const EXPORT_COLUMNS = `
  id::text, guild_id::text, requester_actor_id::text, format_version,
  requested_categories, include_requester_personal, status, idempotency_key,
  attempt_count, max_attempts, retryable, available_at::text,
  lease_token::text, lease_owner, lease_expires_at::text, heartbeat_at::text,
  r2_object_key, sha256, byte_count::text, row_count::text, file_count::text,
  completed_at::text, expires_at::text, error_summary, version,
  created_at::text, updated_at::text`;

const EXPORT_RETURNING_COLUMNS = `
  job.id::text, job.guild_id::text, job.requester_actor_id::text,
  job.format_version, job.requested_categories, job.include_requester_personal,
  job.status, job.idempotency_key, job.attempt_count, job.max_attempts,
  job.retryable, job.available_at::text, job.lease_token::text, job.lease_owner,
  job.lease_expires_at::text, job.heartbeat_at::text, job.r2_object_key,
  job.sha256, job.byte_count::text, job.row_count::text, job.file_count::text,
  job.completed_at::text, job.expires_at::text, job.error_summary, job.version,
  job.created_at::text, job.updated_at::text`;

const RETENTION_RUN_COLUMNS = `
  id::text, guild_id::text, requested_by_actor_id::text, dry_run, policy_version,
  categories, cutoff_at::text, authorization_evidence_id::text,
  planned_chronicle_event_id::text, terminal_chronicle_event_id::text,
  status, idempotency_key, attempt_count, lease_token::text, lease_owner,
  lease_expires_at::text, heartbeat_at::text, result_summary, error_summary,
  completed_at::text, version, created_at::text, updated_at::text`;

const RETENTION_RUN_RETURNING_COLUMNS = `
  run.id::text, run.guild_id::text, run.requested_by_actor_id::text,
  run.dry_run, run.policy_version, run.categories, run.cutoff_at::text,
  run.authorization_evidence_id::text, run.planned_chronicle_event_id::text,
  run.terminal_chronicle_event_id::text, run.status, run.idempotency_key,
  run.attempt_count, run.lease_token::text, run.lease_owner,
  run.lease_expires_at::text, run.heartbeat_at::text, run.result_summary,
  run.error_summary, run.completed_at::text, run.version,
  run.created_at::text, run.updated_at::text`;

const RETENTION_ACTION_COLUMNS = `
  guild_id::text, retention_run_id::text, category, action, cutoff_at::text,
  status, checkpoint_cursor, candidate_count::text, affected_count::text,
  error_summary, version, created_at::text, updated_at::text`;

const RETENTION_ACTION_RETURNING_COLUMNS = `
  action.guild_id::text, action.retention_run_id::text, action.category,
  action.action, action.cutoff_at::text, action.status, action.checkpoint_cursor,
  action.candidate_count::text, action.affected_count::text, action.error_summary,
  action.version, action.created_at::text, action.updated_at::text`;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function assertNonBlank(value: string, label: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  }
}

function assertDate(value: string, label: string): void {
  if (!Number.isFinite(new Date(value).valueOf())) throw new Error(`${label} must be an ISO date.`);
}

function assertPositiveInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum}.`);
  }
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertLimit(limit: number): void {
  assertPositiveInteger(limit, "Page limit", MAX_LIMIT);
}

function assertCategories<T extends string>(
  values: readonly T[],
  allowed: readonly string[],
  label: string,
): void {
  if (values.length === 0 || values.length > allowed.length || new Set(values).size !== values.length ||
      values.some((value) => !allowed.includes(value))) {
    throw new Error(`${label} must be a non-empty unique supported category list.`);
  }
}

function requiredCount(value: string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} exceeds the JavaScript safe integer range.`);
  }
  return parsed;
}

function requiredTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function dataExportJobFromRow(row: ExportJobRow): DataExportJob {
  return {
    id: row.id,
    guildId: row.guild_id,
    requesterActorId: row.requester_actor_id,
    formatVersion: row.format_version,
    requestedCategories: row.requested_categories,
    includeRequesterPersonal: row.include_requester_personal,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    retryable: row.retryable,
    availableAt: new Date(row.available_at).toISOString(),
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: requiredTimestamp(row.lease_expires_at),
    heartbeatAt: requiredTimestamp(row.heartbeat_at),
    r2ObjectKey: row.r2_object_key,
    sha256: row.sha256,
    byteCount: requiredCount(row.byte_count, "Export byte count"),
    rowCount: requiredCount(row.row_count, "Export row count"),
    fileCount: requiredCount(row.file_count, "Export file count"),
    completedAt: requiredTimestamp(row.completed_at),
    expiresAt: requiredTimestamp(row.expires_at),
    errorSummary: row.error_summary,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function retentionRunFromRow(row: RetentionRunRow): RetentionRun {
  return {
    id: row.id,
    guildId: row.guild_id,
    requestedByActorId: row.requested_by_actor_id,
    dryRun: row.dry_run,
    policyVersion: row.policy_version,
    categories: row.categories,
    cutoffAt: new Date(row.cutoff_at).toISOString(),
    authorizationEvidenceId: row.authorization_evidence_id,
    plannedChronicleEventId: row.planned_chronicle_event_id,
    terminalChronicleEventId: row.terminal_chronicle_event_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    leaseToken: row.lease_token,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: requiredTimestamp(row.lease_expires_at),
    heartbeatAt: requiredTimestamp(row.heartbeat_at),
    resultSummary: row.result_summary,
    errorSummary: row.error_summary,
    completedAt: requiredTimestamp(row.completed_at),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function retentionActionFromRow(row: RetentionActionRow): RetentionAction {
  return {
    guildId: row.guild_id,
    retentionRunId: row.retention_run_id,
    category: row.category,
    action: row.action,
    cutoffAt: new Date(row.cutoff_at).toISOString(),
    status: row.status,
    checkpointCursor: row.checkpoint_cursor,
    candidateCount: requiredCount(row.candidate_count, "Retention candidate count")!,
    affectedCount: requiredCount(row.affected_count, "Retention affected count")!,
    errorSummary: row.error_summary,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: Record<string, unknown> | null, right: Record<string, unknown>): boolean {
  if (left === null) return false;
  const normalize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${normalize(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return normalize(left) === normalize(right);
}

function leaseExpiry(now: string, seconds: number): string {
  assertDate(now, "Lease time");
  assertPositiveInteger(seconds, "Lease duration", 3_600);
  if (seconds < 15) throw new Error("Lease duration must be at least 15 seconds.");
  return new Date(new Date(now).valueOf() + seconds * 1_000).toISOString();
}

export class GuildPortabilityRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async createExportJob(input: CreateExportJobInput): Promise<PortabilityIdempotentResult<DataExportJob>> {
    assertPositiveInteger(input.formatVersion, "Export format version", 1_000_000);
    assertCategories(input.requestedCategories, EXPORT_CATEGORIES, "Export categories");
    assertNonBlank(input.idempotencyKey, "Export idempotency key", 500);
    const maxAttempts = input.maxAttempts ?? 3;
    assertPositiveInteger(maxAttempts, "Export max attempts", 20);
    const availableAt = input.availableAt ?? new Date().toISOString();
    assertDate(availableAt, "Export availability");
    this.#assertEvent(input.chronicleEvent, input.requesterActorId, "data_export.requested", "data_export_job", input.id);

    const row = (await this.#connection.query<ExportJobRow>(
      `INSERT INTO data_export_jobs
         (id, guild_id, requester_actor_id, format_version, requested_categories,
          include_requester_personal, idempotency_key, max_attempts, available_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING ${EXPORT_COLUMNS}`,
      [
        input.id, this.#guildId, input.requesterActorId, input.formatVersion,
        input.requestedCategories, input.includeRequesterPersonal, input.idempotencyKey,
        maxAttempts, availableAt,
      ],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return { value: dataExportJobFromRow(row), created: true };
    }
    const existing = await this.#getExportJobByIdempotencyKey(input.idempotencyKey);
    if (existing.requesterActorId !== input.requesterActorId ||
        existing.formatVersion !== input.formatVersion ||
        !sameStrings(existing.requestedCategories, input.requestedCategories) ||
        existing.includeRequesterPersonal !== input.includeRequesterPersonal ||
        existing.maxAttempts !== maxAttempts) {
      throw new Error("Export idempotency key was reused with a different request.");
    }
    return { value: existing, created: false };
  }

  async listExportJobs(limit = DEFAULT_LIMIT): Promise<readonly DataExportJob[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<ExportJobRow>(
      `SELECT ${EXPORT_COLUMNS} FROM data_export_jobs
        WHERE guild_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    return rows.map(dataExportJobFromRow);
  }

  async getExportJob(id: string): Promise<DataExportJob> {
    const row = (await this.#connection.query<ExportJobRow>(
      `SELECT ${EXPORT_COLUMNS} FROM data_export_jobs WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Data export job was not found in this Guild.");
    return dataExportJobFromRow(row);
  }

  async claimNextExportJob(input: ClaimJobInput): Promise<DataExportJob | null> {
    assertNonBlank(input.workerId, "Export worker ID", 200);
    const token = input.leaseToken ?? randomUUID();
    const expiresAt = leaseExpiry(input.now, input.leaseSeconds);
    const row = (await this.#connection.query<ExportJobRow>(
      `WITH candidate AS (
         SELECT job.id
           FROM data_export_jobs job
          WHERE job.guild_id = $1 AND job.attempt_count < job.max_attempts
            AND (
              (job.status = 'queued' AND job.available_at <= $2)
              OR (job.status = 'processing' AND job.lease_expires_at <= $2)
            )
          ORDER BY COALESCE(job.lease_expires_at, job.available_at), job.created_at, job.id
          FOR UPDATE OF job SKIP LOCKED LIMIT 1
       )
       UPDATE data_export_jobs job
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_token = $3, lease_owner = $4, lease_expires_at = $5,
              heartbeat_at = $2, retryable = false, error_summary = NULL,
              version = version + 1, updated_at = now()
        FROM candidate
        WHERE job.guild_id = $1 AND job.id = candidate.id
       RETURNING ${EXPORT_RETURNING_COLUMNS}`,
      [this.#guildId, input.now, token, input.workerId, expiresAt],
    )).rows[0];
    return row ? dataExportJobFromRow(row) : null;
  }

  async heartbeatExportJob(input: HeartbeatInput): Promise<DataExportJob> {
    const expiresAt = leaseExpiry(input.now, input.leaseSeconds);
    const row = (await this.#connection.query<ExportJobRow>(
      `UPDATE data_export_jobs
          SET heartbeat_at = $5, lease_expires_at = $6,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'processing' AND lease_token = $4
          AND lease_expires_at > $5
       RETURNING ${EXPORT_COLUMNS}`,
      [this.#guildId, input.id, input.expectedVersion, input.leaseToken, input.now, expiresAt],
    )).rows[0];
    if (!row) throw new Error("Data export lease is stale or no longer owned by this worker.");
    return dataExportJobFromRow(row);
  }

  async completeExportJob(input: CompleteExportJobInput): Promise<DataExportJob> {
    assertNonBlank(input.r2ObjectKey, "Export R2 object key", 1_024);
    if (!SHA256_PATTERN.test(input.sha256)) throw new Error("Export checksum must be lowercase SHA-256.");
    assertCount(input.byteCount, "Export byte count");
    assertCount(input.rowCount, "Export row count");
    assertCount(input.fileCount, "Export file count");
    assertDate(input.expiresAt, "Export expiry");
    this.#assertEvent(input.chronicleEvent, input.actorId, "data_export.completed", "data_export_job", input.id);
    const row = (await this.#connection.query<ExportJobRow>(
      `UPDATE data_export_jobs
          SET status = 'completed', lease_token = NULL, lease_owner = NULL,
              lease_expires_at = NULL, heartbeat_at = NULL,
              r2_object_key = $5, sha256 = $6, byte_count = $7,
              row_count = $8, file_count = $9, completed_at = now(),
              expires_at = $10, retryable = false, error_summary = NULL,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > now()
       RETURNING ${EXPORT_COLUMNS}`,
      [
        this.#guildId, input.id, input.expectedVersion, input.leaseToken,
        input.r2ObjectKey, input.sha256, input.byteCount, input.rowCount,
        input.fileCount, input.expiresAt,
      ],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return dataExportJobFromRow(row);
    }
    const existing = await this.getExportJob(input.id);
    if ((existing.status === "completed" || existing.status === "expired") &&
        existing.r2ObjectKey === input.r2ObjectKey && existing.sha256 === input.sha256 &&
        existing.byteCount === input.byteCount && existing.rowCount === input.rowCount &&
        existing.fileCount === input.fileCount &&
        existing.expiresAt === new Date(input.expiresAt).toISOString()) {
      return existing;
    }
    throw new Error("Data export completion is stale or its immutable manifest differs.");
  }

  async failExportJob(input: FailExportJobInput): Promise<DataExportJob> {
    assertNonBlank(input.errorSummary, "Export error", 2_000);
    this.#assertEvent(input.chronicleEvent, input.actorId, "data_export.failed", "data_export_job", input.id);
    const row = (await this.#connection.query<ExportJobRow>(
      `UPDATE data_export_jobs
          SET status = 'failed', lease_token = NULL, lease_owner = NULL,
              lease_expires_at = NULL, heartbeat_at = NULL,
              error_summary = $5, retryable = $6 AND attempt_count < max_attempts,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'processing' AND lease_token = $4
       RETURNING ${EXPORT_COLUMNS}`,
      [this.#guildId, input.id, input.expectedVersion, input.leaseToken, input.errorSummary, input.retryable],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return dataExportJobFromRow(row);
    }
    const existing = await this.getExportJob(input.id);
    if (existing.status === "failed" && existing.errorSummary === input.errorSummary &&
        existing.retryable === (input.retryable && existing.attemptCount < existing.maxAttempts)) {
      return existing;
    }
    throw new Error("Data export failure is stale or belongs to another lease.");
  }

  async retryExportJob(input: RetryExportJobInput): Promise<DataExportJob> {
    assertDate(input.availableAt, "Export retry availability");
    this.#assertEvent(input.chronicleEvent, input.actorId, "data_export.retried", "data_export_job", input.id);
    const row = (await this.#connection.query<ExportJobRow>(
      `UPDATE data_export_jobs
          SET status = 'queued', retryable = false, error_summary = NULL,
              available_at = $4, version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'failed' AND retryable = true AND attempt_count < max_attempts
       RETURNING ${EXPORT_COLUMNS}`,
      [this.#guildId, input.id, input.expectedVersion, input.availableAt],
    )).rows[0];
    if (!row) throw new Error("Only a retryable failed export with attempts remaining can be retried.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return dataExportJobFromRow(row);
  }

  async expireExportJob(input: ExpireExportJobInput): Promise<DataExportJob> {
    assertDate(input.now, "Export expiry time");
    this.#assertEvent(input.chronicleEvent, input.actorId, "data_export.expired", "data_export_job", input.id);
    const row = (await this.#connection.query<ExportJobRow>(
      `UPDATE data_export_jobs
          SET status = 'expired', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'completed' AND expires_at <= $4
       RETURNING ${EXPORT_COLUMNS}`,
      [this.#guildId, input.id, input.expectedVersion, input.now],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return dataExportJobFromRow(row);
    }
    const existing = await this.getExportJob(input.id);
    if (existing.status === "expired") return existing;
    throw new Error("Data export is not completed, due, or at the expected version.");
  }

  async readExportSnapshotPage(input: ReadSnapshotPageInput): Promise<SnapshotPage> {
    if (!EXPORT_CATEGORIES.includes(input.category)) throw new Error("Unsupported export category.");
    const limit = input.limit ?? DEFAULT_LIMIT;
    assertLimit(limit);
    const cursor = input.cursor ?? "";
    if (cursor.length > 2_000) throw new Error("Export cursor is too long.");
    const job = await this.getExportJob(input.exportJobId);
    if (!job.requestedCategories.includes(input.category)) {
      throw new Error("Export category was not requested by this job.");
    }
    if (!(["queued", "processing", "completed"] as const).includes(
      job.status as "queued" | "processing" | "completed",
    )) {
      throw new Error("Export snapshots cannot be read for failed or expired jobs.");
    }
    const fragment = snapshotFragment(input.category);
    const rows = (await this.#connection.query<SnapshotRow>(
      `WITH snapshot_rows AS (${fragment})
       SELECT sort_key, data FROM snapshot_rows
        WHERE sort_key > $4 AND $2::uuid IS NOT NULL AND $3::boolean IS NOT NULL
        ORDER BY sort_key LIMIT $5`,
      [this.#guildId, job.requesterActorId, job.includeRequesterPersonal, cursor, limit + 1],
    )).rows;
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    return {
      category: input.category,
      records: selected.map((row) => ({ sortKey: row.sort_key, data: row.data })),
      nextCursor: hasMore ? selected[selected.length - 1]!.sort_key : null,
    };
  }

  async planRetentionRun(input: PlanRetentionRunInput): Promise<PortabilityIdempotentResult<RetentionRunDetail>> {
    assertPositiveInteger(input.policyVersion, "Retention policy version", 1_000_000);
    assertDate(input.cutoffAt, "Retention cutoff");
    assertNonBlank(input.idempotencyKey, "Retention idempotency key", 500);
    const categories = input.actions.map((action) => action.category);
    assertCategories(categories, RETENTION_CATEGORIES, "Retention categories");
    for (const action of input.actions) {
      if (!(action.action === "retain" || action.action === "archive" || action.action === "purge")) {
        throw new Error("Unsupported retention action.");
      }
    }
    const irreversible = input.actions.some((action) => action.action === "purge") && !input.dryRun;
    if (irreversible !== (input.authorizationEvidenceId !== null)) {
      throw new Error("Only an irreversible purge plan requires server authorization evidence.");
    }
    this.#assertEvent(input.chronicleEvent, input.requestedByActorId, "retention.planned", "retention_run", input.id);
    const row = (await this.#connection.query<RetentionRunRow>(
      `INSERT INTO retention_runs
         (id, guild_id, requested_by_actor_id, dry_run, policy_version, categories,
          cutoff_at, authorization_evidence_id, planned_chronicle_event_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING
       RETURNING ${RETENTION_RUN_COLUMNS}`,
      [
        input.id, this.#guildId, input.requestedByActorId, input.dryRun,
        input.policyVersion, categories, input.cutoffAt, input.authorizationEvidenceId,
        input.chronicleEvent.id, input.idempotencyKey,
      ],
    )).rows[0];
    if (!row) {
      const existing = await this.#getRetentionRunByIdempotencyKey(input.idempotencyKey);
      const actions = await this.#listRetentionActions(existing.id);
      if (existing.requestedByActorId !== input.requestedByActorId ||
          existing.dryRun !== input.dryRun || existing.policyVersion !== input.policyVersion ||
          existing.cutoffAt !== new Date(input.cutoffAt).toISOString() ||
          existing.authorizationEvidenceId !== input.authorizationEvidenceId ||
          !sameStrings(existing.categories, categories) || actions.length !== input.actions.length ||
          actions.some((action, index) => action.action !== input.actions[index]?.action ||
            action.category !== input.actions[index]?.category)) {
        throw new Error("Retention idempotency key was reused with a different plan.");
      }
      return { value: { run: existing, actions }, created: false };
    }

    for (const action of input.actions) {
      await this.#connection.query(
        `INSERT INTO retention_actions
           (guild_id, retention_run_id, category, action, cutoff_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [this.#guildId, input.id, action.category, action.action, input.cutoffAt],
      );
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    if (irreversible) {
      const evidence = (await this.#connection.query<QueryResultRow>(
        `UPDATE server_authorization_evidence
            SET consumed_by_retention_run_id = $3, consumed_at = now()
          WHERE guild_id = $1 AND id = $2 AND purpose = 'retention.purge'
            AND subject_human_actor_id = $4 AND consumed_by_retention_run_id IS NULL
            AND expires_at > now()
         RETURNING id`,
        [this.#guildId, input.authorizationEvidenceId, input.id, input.requestedByActorId],
      )).rows[0];
      if (!evidence) throw new Error("Server authorization evidence is missing, expired, or already consumed.");
    }
    return {
      value: { run: retentionRunFromRow(row), actions: await this.#listRetentionActions(input.id) },
      created: true,
    };
  }

  async listRetentionRuns(limit = DEFAULT_LIMIT): Promise<readonly RetentionRun[]> {
    assertLimit(limit);
    const rows = (await this.#connection.query<RetentionRunRow>(
      `SELECT ${RETENTION_RUN_COLUMNS} FROM retention_runs
        WHERE guild_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    return rows.map(retentionRunFromRow);
  }

  async listRetentionRunDetails(limit = DEFAULT_LIMIT): Promise<readonly RetentionRunDetail[]> {
    assertLimit(limit);
    const runs = await this.listRetentionRuns(limit);
    if (runs.length === 0) return [];
    const actions = (await this.#connection.query<RetentionActionRow>(
      `SELECT ${RETENTION_ACTION_COLUMNS} FROM retention_actions
        WHERE guild_id = $1 AND retention_run_id = ANY($2::uuid[])
        ORDER BY retention_run_id, created_at, category`,
      [this.#guildId, runs.map((run) => run.id)],
    )).rows.map(retentionActionFromRow);
    const actionsByRun = new Map<string, RetentionAction[]>();
    for (const action of actions) {
      const existing = actionsByRun.get(action.retentionRunId);
      if (existing) existing.push(action);
      else actionsByRun.set(action.retentionRunId, [action]);
    }
    return runs.map((run) => ({
      run,
      actions: actionsByRun.get(run.id) ?? [],
    }));
  }

  async getRetentionRun(id: string): Promise<RetentionRunDetail> {
    const row = (await this.#connection.query<RetentionRunRow>(
      `SELECT ${RETENTION_RUN_COLUMNS} FROM retention_runs WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Retention run was not found in this Guild.");
    return { run: retentionRunFromRow(row), actions: await this.#listRetentionActions(id) };
  }

  async claimNextRetentionRun(input: ClaimJobInput): Promise<RetentionRunDetail | null> {
    assertNonBlank(input.workerId, "Retention worker ID", 200);
    const token = input.leaseToken ?? randomUUID();
    const expiresAt = leaseExpiry(input.now, input.leaseSeconds);
    const row = (await this.#connection.query<RetentionRunRow>(
      `WITH candidate AS (
         SELECT run.id FROM retention_runs run
          WHERE run.guild_id = $1 AND run.attempt_count < 20
            AND (run.status = 'queued'
              OR (run.status = 'processing' AND run.lease_expires_at <= $2))
          ORDER BY COALESCE(run.lease_expires_at, run.created_at), run.created_at, run.id
          FOR UPDATE OF run SKIP LOCKED LIMIT 1
       )
       UPDATE retention_runs run
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_token = $3, lease_owner = $4, lease_expires_at = $5,
              heartbeat_at = $2, version = version + 1, updated_at = now()
         FROM candidate
        WHERE run.guild_id = $1 AND run.id = candidate.id
       RETURNING ${RETENTION_RUN_RETURNING_COLUMNS}`,
      [this.#guildId, input.now, token, input.workerId, expiresAt],
    )).rows[0];
    if (!row) return null;
    return { run: retentionRunFromRow(row), actions: await this.#listRetentionActions(row.id) };
  }

  async heartbeatRetentionRun(input: HeartbeatInput): Promise<RetentionRun> {
    const expiresAt = leaseExpiry(input.now, input.leaseSeconds);
    const row = (await this.#connection.query<RetentionRunRow>(
      `UPDATE retention_runs
          SET heartbeat_at = $5, lease_expires_at = $6,
              version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'processing' AND lease_token = $4 AND lease_expires_at > $5
       RETURNING ${RETENTION_RUN_COLUMNS}`,
      [this.#guildId, input.id, input.expectedVersion, input.leaseToken, input.now, expiresAt],
    )).rows[0];
    if (!row) throw new Error("Retention lease is stale or no longer owned by this worker.");
    return retentionRunFromRow(row);
  }

  async saveRetentionCheckpoint(input: SaveRetentionCheckpointInput): Promise<RetentionAction> {
    assertCount(input.candidateCount, "Retention candidate count");
    assertCount(input.affectedCount, "Retention affected count");
    if (input.checkpointCursor !== null && input.checkpointCursor.length > 1_000) {
      throw new Error("Retention checkpoint cursor is too long.");
    }
    const status: RetentionActionStatus = input.completed ? "completed" : "processing";
    const row = (await this.#connection.query<RetentionActionRow>(
      `UPDATE retention_actions action
          SET status = $7, checkpoint_cursor = $8, candidate_count = $9,
              affected_count = $10, error_summary = NULL,
              version = action.version + 1, updated_at = now()
         FROM retention_runs run
        WHERE action.guild_id = $1 AND action.retention_run_id = $2
          AND action.category = $3 AND action.version = $4
          AND run.guild_id = action.guild_id AND run.id = action.retention_run_id
          AND run.version = $5 AND run.status = 'processing'
          AND run.lease_token = $6 AND run.lease_expires_at > now()
       RETURNING ${RETENTION_ACTION_RETURNING_COLUMNS}`,
      [
        this.#guildId, input.id, input.category, input.expectedActionVersion,
        input.expectedVersion, input.leaseToken, status, input.checkpointCursor,
        input.candidateCount, input.affectedCount,
      ],
    )).rows[0];
    if (row) return retentionActionFromRow(row);
    const existing = (await this.#listRetentionActions(input.id)).find(
      (action) => action.category === input.category,
    );
    if (existing && existing.status === status && existing.checkpointCursor === input.checkpointCursor &&
        existing.candidateCount === input.candidateCount && existing.affectedCount === input.affectedCount) {
      return existing;
    }
    throw new Error("Retention checkpoint is stale or belongs to another lease.");
  }

  async failRetentionAction(input: FailRetentionActionInput): Promise<RetentionAction> {
    assertCount(input.candidateCount, "Retention candidate count");
    assertCount(input.affectedCount, "Retention affected count");
    assertNonBlank(input.errorSummary, "Retention action error", 2_000);
    const row = (await this.#connection.query<RetentionActionRow>(
      `UPDATE retention_actions action
          SET status = 'failed', checkpoint_cursor = $7, candidate_count = $8,
              affected_count = $9, error_summary = $10,
              version = action.version + 1, updated_at = now()
         FROM retention_runs run
        WHERE action.guild_id = $1 AND action.retention_run_id = $2
          AND action.category = $3 AND action.version = $4
          AND run.guild_id = action.guild_id AND run.id = action.retention_run_id
          AND run.version = $5 AND run.status = 'processing'
          AND run.lease_token = $6 AND run.lease_expires_at > now()
       RETURNING ${RETENTION_ACTION_RETURNING_COLUMNS}`,
      [
        this.#guildId, input.id, input.category, input.expectedActionVersion,
        input.expectedVersion, input.leaseToken, input.checkpointCursor,
        input.candidateCount, input.affectedCount, input.errorSummary,
      ],
    )).rows[0];
    if (row) return retentionActionFromRow(row);
    const existing = (await this.#listRetentionActions(input.id)).find(
      (action) => action.category === input.category,
    );
    if (existing?.status === "failed" && existing.errorSummary === input.errorSummary) return existing;
    throw new Error("Retention action failure is stale or belongs to another lease.");
  }

  async completeRetentionRun(input: CompleteRetentionRunInput): Promise<RetentionRun> {
    const detail = await this.getRetentionRun(input.id);
    this.#assertEvent(
      input.chronicleEvent, detail.run.requestedByActorId,
      "retention.completed", "retention_run", input.id,
    );
    const row = (await this.#connection.query<RetentionRunRow>(
      `UPDATE retention_runs run
          SET status = 'completed', result_summary = $5::jsonb,
              terminal_chronicle_event_id = $6, completed_at = now(),
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, version = version + 1, updated_at = now()
        WHERE run.guild_id = $1 AND run.id = $2 AND run.version = $3
          AND run.status = 'processing' AND run.lease_token = $4
          AND run.lease_expires_at > now()
          AND NOT EXISTS (
            SELECT 1 FROM retention_actions action
             WHERE action.guild_id = run.guild_id AND action.retention_run_id = run.id
               AND action.status <> 'completed'
          )
       RETURNING ${RETENTION_RUN_COLUMNS}`,
      [
        this.#guildId, input.id, input.expectedVersion, input.leaseToken,
        JSON.stringify(input.resultSummary), input.chronicleEvent.id,
      ],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return retentionRunFromRow(row);
    }
    const existing = (await this.getRetentionRun(input.id)).run;
    if (existing.status === "completed" && sameJson(existing.resultSummary, input.resultSummary)) return existing;
    throw new Error("Retention run cannot complete until every action is complete under its live lease.");
  }

  async failRetentionRun(input: FailRetentionRunInput): Promise<RetentionRun> {
    assertNonBlank(input.errorSummary, "Retention run error", 2_000);
    const detail = await this.getRetentionRun(input.id);
    this.#assertEvent(
      input.chronicleEvent, detail.run.requestedByActorId,
      "retention.failed", "retention_run", input.id,
    );
    const row = (await this.#connection.query<RetentionRunRow>(
      `UPDATE retention_runs
          SET status = 'failed', error_summary = $5,
              terminal_chronicle_event_id = $6, completed_at = now(),
              lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
              heartbeat_at = NULL, version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status = 'processing' AND lease_token = $4
       RETURNING ${RETENTION_RUN_COLUMNS}`,
      [
        this.#guildId, input.id, input.expectedVersion, input.leaseToken,
        input.errorSummary, input.chronicleEvent.id,
      ],
    )).rows[0];
    if (row) {
      await this.#chronicle.appendChronicle(input.chronicleEvent);
      return retentionRunFromRow(row);
    }
    const existing = (await this.getRetentionRun(input.id)).run;
    if (existing.status === "failed" && existing.errorSummary === input.errorSummary) return existing;
    throw new Error("Retention run failure is stale or belongs to another lease.");
  }

  async #getExportJobByIdempotencyKey(idempotencyKey: string): Promise<DataExportJob> {
    const row = (await this.#connection.query<ExportJobRow>(
      `SELECT ${EXPORT_COLUMNS} FROM data_export_jobs
        WHERE guild_id = $1 AND idempotency_key = $2`,
      [this.#guildId, idempotencyKey],
    )).rows[0];
    if (!row) throw new Error("Data export idempotency conflict could not be resolved.");
    return dataExportJobFromRow(row);
  }

  async #getRetentionRunByIdempotencyKey(idempotencyKey: string): Promise<RetentionRun> {
    const row = (await this.#connection.query<RetentionRunRow>(
      `SELECT ${RETENTION_RUN_COLUMNS} FROM retention_runs
        WHERE guild_id = $1 AND idempotency_key = $2`,
      [this.#guildId, idempotencyKey],
    )).rows[0];
    if (!row) throw new Error("Retention idempotency conflict could not be resolved.");
    return retentionRunFromRow(row);
  }

  async #listRetentionActions(runId: string): Promise<readonly RetentionAction[]> {
    const rows = (await this.#connection.query<RetentionActionRow>(
      `SELECT ${RETENTION_ACTION_COLUMNS} FROM retention_actions
        WHERE guild_id = $1 AND retention_run_id = $2 ORDER BY category`,
      [this.#guildId, runId],
    )).rows;
    return rows.map(retentionActionFromRow);
  }

  #assertEvent(
    event: ChronicleEvent,
    actorId: string,
    action: string,
    subjectType: string,
    subjectId: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorId ||
        event.action !== action || event.subjectType !== subjectType || event.subjectId !== subjectId) {
      throw new Error("Chronicle event does not match the portability operation.");
    }
  }
}

function snapshotFragment(category: ExportCategory): string {
  const custody = (alias: string, resourceType: string): string => `
    JOIN resource_custody custody
      ON custody.guild_id = ${alias}.guild_id
     AND custody.resource_type = '${resourceType}' AND custody.resource_id = ${alias}.id
     AND (custody.custody <> 'personal'
       OR ($3::boolean AND custody.personal_owner_actor_id = $2::uuid))`;
  switch (category) {
    case "guild":
      return `
        SELECT 'guild/guild/' || guild.id::text AS sort_key,
               jsonb_build_object('table', 'guilds', 'row', to_jsonb(guild)) AS data
          FROM guilds guild WHERE guild.id = $1
        UNION ALL
        SELECT 'guild/constitution/' || lpad(constitution.version::text, 10, '0'),
               jsonb_build_object('table', 'constitutions', 'row', to_jsonb(constitution))
          FROM constitutions constitution WHERE constitution.guild_id = $1
        UNION ALL
        SELECT 'guild/template/' || template.key,
               jsonb_build_object('table', 'collective_templates', 'row', to_jsonb(template))
          FROM collective_templates template WHERE template.guild_id = $1`;
    case "actors":
      return `
        SELECT 'actors/actor/' || actor.id::text AS sort_key,
               jsonb_build_object('table', 'actors', 'row', to_jsonb(actor)) AS data
          FROM actors actor JOIN actor_memberships membership
            ON membership.actor_id = actor.id AND membership.guild_id = $1
        UNION ALL
        SELECT 'actors/membership/' || membership.actor_id::text,
               jsonb_build_object('table', 'actor_memberships', 'row', to_jsonb(membership))
          FROM actor_memberships membership WHERE membership.guild_id = $1
        UNION ALL
        SELECT 'actors/role-binding/' || binding.id::text,
               jsonb_build_object('table', 'actor_role_bindings', 'row', to_jsonb(binding))
          FROM actor_role_bindings binding WHERE binding.guild_id = $1`;
    case "spaces":
      return `
        SELECT 'spaces/space/' || space.id::text AS sort_key,
               jsonb_build_object('table', 'spaces', 'row', to_jsonb(space)) AS data
          FROM spaces space WHERE space.guild_id = $1
        UNION ALL
        SELECT 'spaces/vocabulary/' || profile.key,
               jsonb_build_object('table', 'vocabulary_profiles', 'row', to_jsonb(profile))
          FROM vocabulary_profiles profile WHERE profile.guild_id = $1`;
    case "roles":
      return `
        SELECT 'roles/role/' || role.id::text AS sort_key,
               jsonb_build_object('table', 'roles', 'row', to_jsonb(role)) AS data
          FROM roles role WHERE role.guild_id = $1
        UNION ALL
        SELECT 'roles/permission/' || permission.role_id::text || '/' || permission.permission,
               jsonb_build_object('table', 'role_permissions', 'row', to_jsonb(permission))
          FROM role_permissions permission WHERE permission.guild_id = $1`;
    case "memories":
      return `
        SELECT 'memories/memory/' || memory.id::text AS sort_key,
               jsonb_build_object('table', 'memories', 'row', to_jsonb(memory),
                                  'custody', to_jsonb(custody)) AS data
          FROM memories memory ${custody("memory", "memory")} WHERE memory.guild_id = $1
        UNION ALL
        SELECT 'memories/version/' || memory_version.memory_id::text || '/' || lpad(memory_version.version::text, 10, '0'),
               jsonb_build_object('table', 'memory_versions', 'row', to_jsonb(memory_version))
          FROM memory_versions memory_version JOIN memories memory
            ON memory.guild_id = memory_version.guild_id AND memory.id = memory_version.memory_id
          ${custody("memory", "memory")} WHERE memory_version.guild_id = $1`;
    case "activities":
      return `
        SELECT 'activities/activity/' || activity.id::text AS sort_key,
               jsonb_build_object('table', 'activities', 'row', to_jsonb(activity),
                                  'custody', to_jsonb(custody)) AS data
          FROM activities activity ${custody("activity", "activity")} WHERE activity.guild_id = $1
        UNION ALL
        SELECT 'activities/outcome/' || outcome.activity_id::text || '/' || lpad(outcome.version::text, 10, '0'),
               jsonb_build_object('table', 'activity_outcomes', 'row', to_jsonb(outcome))
          FROM activity_outcomes outcome JOIN activities activity
            ON activity.guild_id = outcome.guild_id AND activity.id = outcome.activity_id
          ${custody("activity", "activity")} WHERE outcome.guild_id = $1`;
    case "decisions":
      return `
        SELECT 'decisions/decision/' || decision.id::text AS sort_key,
               jsonb_build_object('table', 'decisions', 'row', to_jsonb(decision),
                                  'custody', to_jsonb(custody)) AS data
          FROM decisions decision ${custody("decision", "decision")} WHERE decision.guild_id = $1
        UNION ALL
        SELECT 'decisions/option/' || option.id::text,
               jsonb_build_object('table', 'decision_options', 'row', to_jsonb(option))
          FROM decision_options option JOIN decisions decision
            ON decision.guild_id = option.guild_id AND decision.id = option.decision_id
          ${custody("decision", "decision")} WHERE option.guild_id = $1`;
    case "conversations":
      return `
        SELECT 'conversations/conversation/' || conversation.id::text AS sort_key,
               jsonb_build_object('table', 'conversations', 'row', to_jsonb(conversation),
                                  'custody', to_jsonb(custody)) AS data
          FROM conversations conversation ${custody("conversation", "conversation")}
         WHERE conversation.guild_id = $1
        UNION ALL
        SELECT 'conversations/message/' || message.id::text,
               jsonb_build_object('table', 'conversation_messages', 'row', to_jsonb(message))
          FROM conversation_messages message JOIN conversations conversation
            ON conversation.guild_id = message.guild_id AND conversation.id = message.conversation_id
          ${custody("conversation", "conversation")} WHERE message.guild_id = $1`;
    case "files":
      return `
        SELECT 'files/file/' || file_row.id::text AS sort_key,
               jsonb_build_object('table', 'files', 'row', to_jsonb(file_row),
                                  'custody', to_jsonb(custody),
                                  'contentIncluded', false) AS data
          FROM files file_row ${custody("file_row", "file")} WHERE file_row.guild_id = $1`;
    case "agent_runs":
      return `
        SELECT 'agent-runs/run/' || run.id::text AS sort_key,
               jsonb_build_object('table', 'agent_runs', 'row', to_jsonb(run),
                                  'custody', to_jsonb(custody)) AS data
          FROM agent_runs run ${custody("run", "agent_run")} WHERE run.guild_id = $1
        UNION ALL
        SELECT 'agent-runs/approval/' || approval.id::text,
               jsonb_build_object('table', 'approval_requests', 'row', to_jsonb(approval))
          FROM approval_requests approval JOIN agent_runs run
            ON run.guild_id = approval.guild_id AND run.id = approval.agent_run_id
          ${custody("run", "agent_run")} WHERE approval.guild_id = $1`;
    case "chronicle":
      return `
        SELECT 'chronicle/event/' || lpad(event.sequence::text, 20, '0') || '/' || event.id::text AS sort_key,
               jsonb_build_object('table', 'chronicle_events', 'row', to_jsonb(event)) AS data
          FROM chronicle_events event WHERE event.guild_id = $1`;
    case "operations":
      return `
        SELECT 'operations/connector/' || connector.id::text AS sort_key,
               jsonb_build_object('table', 'connectors', 'row', to_jsonb(connector)) AS data
          FROM connectors connector WHERE connector.guild_id = $1
        UNION ALL
        SELECT 'operations/workflow/' || workflow.id::text,
               jsonb_build_object('table', 'workflow_definitions', 'row', to_jsonb(workflow))
          FROM workflow_definitions workflow WHERE workflow.guild_id = $1
        UNION ALL
        SELECT 'operations/automation/' || rule.id::text,
               jsonb_build_object('table', 'automation_rules', 'row', to_jsonb(rule))
          FROM automation_rules rule WHERE rule.guild_id = $1
        UNION ALL
        SELECT 'operations/federation/' || link.id::text,
               jsonb_build_object('table', 'federation_links', 'row', to_jsonb(link))
          FROM federation_links link WHERE link.guild_id = $1
        UNION ALL
        SELECT 'operations/model-provider/' || provider.id::text,
               jsonb_build_object('table', 'model_providers', 'row', to_jsonb(provider))
          FROM model_providers provider WHERE provider.guild_id = $1
        UNION ALL
        SELECT 'operations/model-route/' || route.id::text,
               jsonb_build_object('table', 'model_routes', 'row', to_jsonb(route))
          FROM model_routes route WHERE route.guild_id = $1`;
  }
}
