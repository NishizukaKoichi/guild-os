import type { ChronicleEvent } from "@guild-os/domain";
import {
  GuildPortabilityRepository,
  GuildPostgresRepository,
  withGuildTransaction,
  type GuildTransactionConnection,
  type QueryResultRow,
  type RetentionAction,
  type RetentionActionKind,
  type RetentionCategory,
  type RetentionRun,
  type RetentionRunDetail,
  type SqlConnectionFactory,
} from "@guild-os/postgres";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_LEASE_SECONDS = 120;
const DEFAULT_BATCH_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 25;
const MAX_BATCH_SIZE = 500;
const MAX_LEASE_SECONDS = 3_600;
const MAX_BATCH_RETRIES = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RetentionRuntimeErrorCode =
  | "authorization_evidence_missing"
  | "invalid_claim"
  | "invalid_checkpoint"
  | "lease_lost"
  | "no_progress"
  | "policy_changed"
  | "repository_failure"
  | "repository_transient"
  | "unsupported_action";

export class RetentionRuntimeError extends Error {
  readonly code: RetentionRuntimeErrorCode;
  readonly retryable: boolean;

  constructor(
    code: RetentionRuntimeErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "RetentionRuntimeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface RetentionSqlPlan {
  readonly mode: "count" | "transition" | "delete";
  readonly countSql: string;
  readonly mutationSql: string | null;
  readonly reversibleArchive: boolean;
  readonly queuesR2Deletion: boolean;
  readonly requiresServerAuthorization: boolean;
}

export type RetentionSqlAllowlist = {
  readonly [Category in RetentionCategory]: Readonly<
    Partial<Record<RetentionActionKind, RetentionSqlPlan>>
  >;
};

const MEMORIES_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM memories memory_row
    JOIN resource_custody custody
      ON custody.guild_id = memory_row.guild_id
     AND custody.resource_type = 'memory'
     AND custody.resource_id = memory_row.id
   WHERE memory_row.guild_id = $1
     AND memory_row.updated_at <= $2::timestamptz`;

const MEMORIES_ARCHIVE_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM memories memory_row
    JOIN resource_custody custody
      ON custody.guild_id = memory_row.guild_id
     AND custody.resource_type = 'memory'
     AND custody.resource_id = memory_row.id
    JOIN constitutions constitution ON constitution.guild_id = memory_row.guild_id
    LEFT JOIN actor_memberships personal_owner
      ON personal_owner.guild_id = custody.guild_id
     AND personal_owner.actor_id = custody.personal_owner_actor_id
   WHERE memory_row.guild_id = $1
     AND memory_row.status = 'active'
     AND memory_row.updated_at <= $2::timestamptz
     AND (
       custody.custody IN ('guild', 'shared')
       OR (
         custody.custody = 'personal'
         AND personal_owner.state = 'left'
         AND personal_owner.operational = false
         AND constitution.data_policy ->> 'personalDataOnDeparture'
           IN ('archive', 'delete_after_retention')
       )
     )`;

const MEMORIES_ARCHIVE_BATCH_SQL = `
  WITH eligible AS MATERIALIZED (
    SELECT memory_row.id
      FROM memories memory_row
      JOIN resource_custody custody
        ON custody.guild_id = memory_row.guild_id
       AND custody.resource_type = 'memory'
       AND custody.resource_id = memory_row.id
      JOIN constitutions constitution ON constitution.guild_id = memory_row.guild_id
      LEFT JOIN actor_memberships personal_owner
        ON personal_owner.guild_id = custody.guild_id
       AND personal_owner.actor_id = custody.personal_owner_actor_id
     WHERE memory_row.guild_id = $1
       AND memory_row.status = 'active'
       AND memory_row.updated_at <= $2::timestamptz
       AND ($3::uuid IS NULL OR memory_row.id > $3::uuid)
       AND (
         custody.custody IN ('guild', 'shared')
         OR (
           custody.custody = 'personal'
           AND personal_owner.state = 'left'
           AND personal_owner.operational = false
           AND constitution.data_policy ->> 'personalDataOnDeparture'
             IN ('archive', 'delete_after_retention')
         )
       )
     ORDER BY memory_row.id
     FOR UPDATE OF memory_row
     LIMIT $4
  ), archived AS (
    UPDATE memories memory_row
       SET status = 'archived', updated_at = now()
      FROM eligible
     WHERE memory_row.guild_id = $1 AND memory_row.id = eligible.id
       AND memory_row.status = 'active'
    RETURNING memory_row.id
  )
  SELECT id::text AS cursor FROM archived ORDER BY id`;

const ACTIVITIES_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM activities activity
    JOIN resource_custody custody
      ON custody.guild_id = activity.guild_id
     AND custody.resource_type = 'activity'
     AND custody.resource_id = activity.id
   WHERE activity.guild_id = $1
     AND activity.updated_at <= $2::timestamptz`;

const ACTIVITIES_ARCHIVE_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM activities activity
    JOIN resource_custody custody
      ON custody.guild_id = activity.guild_id
     AND custody.resource_type = 'activity'
     AND custody.resource_id = activity.id
    JOIN constitutions constitution ON constitution.guild_id = activity.guild_id
    LEFT JOIN actor_memberships personal_owner
      ON personal_owner.guild_id = custody.guild_id
     AND personal_owner.actor_id = custody.personal_owner_actor_id
   WHERE activity.guild_id = $1
     AND activity.status = 'completed'
     AND activity.updated_at <= $2::timestamptz
     AND (
       custody.custody IN ('guild', 'shared')
       OR (
         custody.custody = 'personal'
         AND personal_owner.state = 'left'
         AND personal_owner.operational = false
         AND constitution.data_policy ->> 'personalDataOnDeparture'
           IN ('archive', 'delete_after_retention')
       )
     )`;

const ACTIVITIES_ARCHIVE_BATCH_SQL = `
  WITH eligible AS MATERIALIZED (
    SELECT activity.id
      FROM activities activity
      JOIN resource_custody custody
        ON custody.guild_id = activity.guild_id
       AND custody.resource_type = 'activity'
       AND custody.resource_id = activity.id
      JOIN constitutions constitution ON constitution.guild_id = activity.guild_id
      LEFT JOIN actor_memberships personal_owner
        ON personal_owner.guild_id = custody.guild_id
       AND personal_owner.actor_id = custody.personal_owner_actor_id
     WHERE activity.guild_id = $1
       AND activity.status = 'completed'
       AND activity.updated_at <= $2::timestamptz
       AND ($3::uuid IS NULL OR activity.id > $3::uuid)
       AND (
         custody.custody IN ('guild', 'shared')
         OR (
           custody.custody = 'personal'
           AND personal_owner.state = 'left'
           AND personal_owner.operational = false
           AND constitution.data_policy ->> 'personalDataOnDeparture'
             IN ('archive', 'delete_after_retention')
         )
       )
     ORDER BY activity.id
     FOR UPDATE OF activity
     LIMIT $4
  ), archived AS (
    UPDATE activities activity
       SET status = 'archived', version = version + 1, updated_at = now()
      FROM eligible
     WHERE activity.guild_id = $1 AND activity.id = eligible.id
       AND activity.status = 'completed'
    RETURNING activity.id
  )
  SELECT id::text AS cursor FROM archived ORDER BY id`;

const DECISIONS_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM decisions decision_row
    JOIN resource_custody custody
      ON custody.guild_id = decision_row.guild_id
     AND custody.resource_type = 'decision'
     AND custody.resource_id = decision_row.id
   WHERE decision_row.guild_id = $1
     AND decision_row.updated_at <= $2::timestamptz`;

const CONVERSATIONS_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM conversations conversation
    JOIN resource_custody custody
      ON custody.guild_id = conversation.guild_id
     AND custody.resource_type = 'conversation'
     AND custody.resource_id = conversation.id
   WHERE conversation.guild_id = $1
     AND conversation.updated_at <= $2::timestamptz`;

const FILES_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM files file_row
    JOIN resource_custody custody
      ON custody.guild_id = file_row.guild_id
     AND custody.resource_type = 'file'
     AND custody.resource_id = file_row.id
   WHERE file_row.guild_id = $1
     AND file_row.updated_at <= $2::timestamptz`;

const FILES_PURGE_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM files file_row
    JOIN resource_custody custody
      ON custody.guild_id = file_row.guild_id
     AND custody.resource_type = 'file'
     AND custody.resource_id = file_row.id
    JOIN constitutions constitution ON constitution.guild_id = file_row.guild_id
    LEFT JOIN actor_memberships personal_owner
      ON personal_owner.guild_id = custody.guild_id
     AND personal_owner.actor_id = custody.personal_owner_actor_id
   WHERE file_row.guild_id = $1
     AND file_row.status = 'deleted'
     AND file_row.updated_at <= $2::timestamptz
     AND custody.retention_until IS NOT NULL
     AND custody.retention_until <= $2::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM knowledge_version_files link
        WHERE link.guild_id = file_row.guild_id AND link.file_id = file_row.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM memory_version_files link
        WHERE link.guild_id = file_row.guild_id AND link.file_id = file_row.id
     )
     AND (
       custody.custody IN ('guild', 'shared')
       OR (
         custody.custody = 'personal'
         AND personal_owner.state = 'left'
         AND personal_owner.operational = false
         AND constitution.data_policy ->> 'personalDataOnDeparture'
           = 'delete_after_retention'
       )
     )`;

const FILES_PURGE_BATCH_SQL = `
  WITH authorized AS MATERIALIZED (
    SELECT run.id
      FROM retention_runs run
      JOIN server_authorization_evidence evidence
        ON evidence.guild_id = run.guild_id
       AND evidence.id = run.authorization_evidence_id
       AND evidence.subject_human_actor_id = run.requested_by_actor_id
       AND evidence.purpose = 'retention.purge'
       AND evidence.consumed_by_retention_run_id = run.id
       AND evidence.consumed_at IS NOT NULL
     WHERE run.guild_id = $1 AND run.id = $5
       AND run.dry_run = false AND run.status = 'processing'
  ), eligible AS MATERIALIZED (
    SELECT file_row.id, file_row.r2_key
      FROM files file_row
      JOIN resource_custody custody
        ON custody.guild_id = file_row.guild_id
       AND custody.resource_type = 'file'
       AND custody.resource_id = file_row.id
      JOIN constitutions constitution ON constitution.guild_id = file_row.guild_id
      LEFT JOIN actor_memberships personal_owner
        ON personal_owner.guild_id = custody.guild_id
       AND personal_owner.actor_id = custody.personal_owner_actor_id
      CROSS JOIN authorized
     WHERE file_row.guild_id = $1
       AND file_row.status = 'deleted'
       AND file_row.updated_at <= $2::timestamptz
       AND custody.retention_until IS NOT NULL
       AND custody.retention_until <= $2::timestamptz
       AND ($3::uuid IS NULL OR file_row.id > $3::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM knowledge_version_files link
          WHERE link.guild_id = file_row.guild_id AND link.file_id = file_row.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM memory_version_files link
          WHERE link.guild_id = file_row.guild_id AND link.file_id = file_row.id
       )
       AND (
         custody.custody IN ('guild', 'shared')
         OR (
           custody.custody = 'personal'
           AND personal_owner.state = 'left'
           AND personal_owner.operational = false
           AND constitution.data_policy ->> 'personalDataOnDeparture'
             = 'delete_after_retention'
         )
       )
     ORDER BY file_row.id
     FOR UPDATE OF file_row, custody
     LIMIT $4
  ), queued AS (
    INSERT INTO outbox (
      id, guild_id, topic, payload, idempotency_key, status, available_at
    )
    SELECT gen_random_uuid(), $1, 'knowledge.file.delete',
           jsonb_build_object('fileId', eligible.id::text, 'r2Key', eligible.r2_key),
           'retention-r2-delete:' || eligible.id::text, 'pending', now()
      FROM eligible
    ON CONFLICT (guild_id, idempotency_key) DO UPDATE
      SET status = CASE
            WHEN outbox.status IN ('failed', 'cancelled') THEN 'pending'
            ELSE outbox.status
          END,
          available_at = CASE
            WHEN outbox.status IN ('failed', 'cancelled') THEN now()
            ELSE outbox.available_at
          END,
          locked_at = CASE
            WHEN outbox.status IN ('failed', 'cancelled') THEN NULL
            ELSE outbox.locked_at
          END,
          last_error = CASE
            WHEN outbox.status IN ('failed', 'cancelled') THEN NULL
            ELSE outbox.last_error
          END
      WHERE outbox.topic = 'knowledge.file.delete'
        AND outbox.payload ->> 'fileId' = EXCLUDED.payload ->> 'fileId'
        AND outbox.payload ->> 'r2Key' = EXCLUDED.payload ->> 'r2Key'
    RETURNING (payload ->> 'fileId')::uuid AS file_id
  ), custody_deleted AS (
    DELETE FROM resource_custody custody
     USING queued
     WHERE custody.guild_id = $1
       AND custody.resource_type = 'file'
       AND custody.resource_id = queued.file_id
    RETURNING custody.resource_id
  ), deleted AS (
    DELETE FROM files file_row
     USING custody_deleted
     WHERE file_row.guild_id = $1
       AND file_row.id = custody_deleted.resource_id
       AND file_row.status = 'deleted'
    RETURNING file_row.id
  )
  SELECT id::text AS cursor FROM deleted ORDER BY id`;

const AGENT_RUNS_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM agent_runs run
    JOIN resource_custody custody
      ON custody.guild_id = run.guild_id
     AND custody.resource_type = 'agent_run'
     AND custody.resource_id = run.id
   WHERE run.guild_id = $1
     AND run.updated_at <= $2::timestamptz`;

const CHRONICLE_RETAIN_COUNT_SQL = `
  SELECT count(*)::text AS candidate_count
    FROM chronicle_events event
   WHERE event.guild_id = $1
     AND event.occurred_at <= $2::timestamptz`;

/**
 * This is the complete destructive SQL allowlist. No caller-provided table,
 * column, predicate, or SQL fragment is ever interpolated into execution.
 * Unsupported category/action pairs fail closed.
 */
export const RETENTION_SQL_ALLOWLIST = {
  memories: {
    retain: {
      mode: "count",
      countSql: MEMORIES_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
    archive: {
      mode: "transition",
      countSql: MEMORIES_ARCHIVE_COUNT_SQL,
      mutationSql: MEMORIES_ARCHIVE_BATCH_SQL,
      reversibleArchive: true,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
  activities: {
    retain: {
      mode: "count",
      countSql: ACTIVITIES_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
    archive: {
      mode: "transition",
      countSql: ACTIVITIES_ARCHIVE_COUNT_SQL,
      mutationSql: ACTIVITIES_ARCHIVE_BATCH_SQL,
      reversibleArchive: true,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
  decisions: {
    retain: {
      mode: "count",
      countSql: DECISIONS_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
  conversations: {
    retain: {
      mode: "count",
      countSql: CONVERSATIONS_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
  files: {
    retain: {
      mode: "count",
      countSql: FILES_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
    purge: {
      mode: "delete",
      countSql: FILES_PURGE_COUNT_SQL,
      mutationSql: FILES_PURGE_BATCH_SQL,
      reversibleArchive: false,
      queuesR2Deletion: true,
      requiresServerAuthorization: true,
    },
  },
  agent_runs: {
    retain: {
      mode: "count",
      countSql: AGENT_RUNS_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
  chronicle: {
    retain: {
      mode: "count",
      countSql: CHRONICLE_RETAIN_COUNT_SQL,
      mutationSql: null,
      reversibleArchive: false,
      queuesR2Deletion: false,
      requiresServerAuthorization: false,
    },
  },
} as const satisfies RetentionSqlAllowlist;

const EXECUTION_GUARD_SQL = `
  SELECT constitution.version AS policy_version,
         constitution.data_policy ->> 'personalDataOnDeparture'
           AS personal_data_on_departure,
         EXISTS (
           SELECT 1
             FROM server_authorization_evidence evidence
             JOIN actors verifier
               ON verifier.id = evidence.verified_by_service_actor_id
              AND verifier.kind = 'service' AND verifier.status = 'active'
             JOIN actor_memberships verifier_membership
               ON verifier_membership.guild_id = evidence.guild_id
              AND verifier_membership.actor_id = verifier.id
              AND verifier_membership.state IN ('joined', 'active')
              AND verifier_membership.operational = true
            WHERE evidence.guild_id = run.guild_id
              AND evidence.id = run.authorization_evidence_id
              AND evidence.subject_human_actor_id = run.requested_by_actor_id
              AND evidence.purpose = 'retention.purge'
              AND evidence.consumed_by_retention_run_id = run.id
              AND evidence.consumed_at IS NOT NULL
         ) AS authorization_valid
    FROM retention_runs run
    JOIN constitutions constitution ON constitution.guild_id = run.guild_id
   WHERE run.guild_id = $1 AND run.id = $2`;

interface RetentionExecutionGuardRow extends QueryResultRow {
  policy_version: number;
  personal_data_on_departure: string;
  authorization_valid: boolean;
}

interface RetentionCountRow extends QueryResultRow {
  candidate_count: string;
}

interface RetentionCursorRow extends QueryResultRow {
  cursor: string;
}

export interface RetentionBatchInput {
  runId: string;
  category: RetentionCategory;
  leaseToken: string;
  now: string;
  leaseSeconds: number;
  batchSize: number;
}

export interface RetentionBatchCommit {
  detail: RetentionRunDetail;
  category: RetentionCategory;
  action: RetentionActionKind;
  batchCandidateCount: number;
  batchAffectedCount: number;
  r2DeletionQueueCount: number;
  completed: boolean;
}

export interface RetentionFailureInput {
  runId: string;
  category: RetentionCategory;
  leaseToken: string;
  errorCode: RetentionRuntimeErrorCode;
  now: string;
}

export interface RetentionCompletionInput {
  runId: string;
  leaseToken: string;
  now: string;
}

export interface RetentionClaimInput {
  workerId: string;
  now: string;
  leaseSeconds: number;
}

export interface RetentionRuntimeRepository {
  claimNext(input: RetentionClaimInput): Promise<RetentionRunDetail | null>;
  /** Mutation, R2 outbox enqueue, checkpoint, heartbeat, and batch Chronicle are one transaction. */
  processCategoryBatch(input: RetentionBatchInput): Promise<RetentionBatchCommit>;
  /** Action failure, run failure, and terminal Chronicle are one transaction. */
  failRun(input: RetentionFailureInput): Promise<RetentionRun>;
  /** Completion and terminal Chronicle are one transaction. */
  completeRun(input: RetentionCompletionInput): Promise<RetentionRun>;
}

export interface PostgresRetentionRuntimeRepositoryOptions {
  connectionString: string;
  guildId: string;
  connectionFactory?: SqlConnectionFactory;
  idFactory?: () => string;
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} is required.`);
}

function assertIsoDate(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid.`);
}

function assertPositiveInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum}.`);
  }
}

function parseCount(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RetentionRuntimeError(
      "repository_failure",
      "Retention count exceeded the supported integer range.",
    );
  }
  return count;
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RetentionRuntimeError(
      "repository_failure",
      "Retention aggregate exceeded the supported integer range.",
    );
  }
  return total;
}

function actionFor(
  detail: RetentionRunDetail,
  category: RetentionCategory,
): RetentionAction {
  const action = detail.actions.find((candidate) => candidate.category === category);
  if (!action) {
    throw new RetentionRuntimeError(
      "invalid_claim",
      "The claimed retention run is missing a planned category action.",
    );
  }
  return action;
}

function sqlPlanFor(
  category: RetentionCategory,
  action: RetentionActionKind,
): RetentionSqlPlan {
  const categoryPlans: Readonly<Partial<Record<RetentionActionKind, RetentionSqlPlan>>> =
    RETENTION_SQL_ALLOWLIST[category];
  const plan = categoryPlans[action];
  if (!plan) {
    throw new RetentionRuntimeError(
      "unsupported_action",
      `Retention action ${action} is not safely supported for category ${category}.`,
    );
  }
  return plan;
}

function assertLiveLease(run: RetentionRun, leaseToken: string, now: string): void {
  if (run.status !== "processing" || run.leaseToken !== leaseToken ||
      run.leaseExpiresAt === null || Date.parse(run.leaseExpiresAt) <= Date.parse(now)) {
    throw new RetentionRuntimeError(
      "lease_lost",
      "The retention lease is no longer owned by this worker.",
    );
  }
}

function assertCursor(cursor: string | null): void {
  if (cursor !== null && !UUID_PATTERN.test(cursor)) {
    throw new RetentionRuntimeError(
      "invalid_checkpoint",
      "The retention checkpoint is not a supported UUID cursor.",
    );
  }
}

function isDeparturePolicy(value: string): boolean {
  return value === "retain_by_policy" || value === "archive" ||
    value === "delete_after_retention";
}

function makeEvent(
  idFactory: () => string,
  run: RetentionRun,
  action: string,
  now: string,
  details: ChronicleEvent["details"],
): ChronicleEvent {
  return {
    id: idFactory(),
    guildId: run.guildId,
    spaceId: null,
    ownerIdentityId: run.requestedByActorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: run.requestedByActorId,
    action,
    subjectType: "retention_run",
    subjectId: run.id,
    correlationId: idFactory(),
    occurredAt: now,
    details,
  };
}

function summarize(detail: RetentionRunDetail): Record<string, unknown> {
  const categories: Record<string, unknown> = {};
  let candidateCount = 0;
  let affectedCount = 0;
  for (const action of detail.actions) {
    categories[action.category] = {
      action: action.action,
      candidateCount: action.candidateCount,
      affectedCount: action.affectedCount,
    };
    candidateCount = safeAdd(candidateCount, action.candidateCount);
    affectedCount = safeAdd(affectedCount, action.affectedCount);
  }
  return {
    dryRun: detail.run.dryRun,
    policyVersion: detail.run.policyVersion,
    candidateCount,
    affectedCount,
    categories,
  };
}

function replaceAction(
  detail: RetentionRunDetail,
  updatedRun: RetentionRun,
  updatedAction: RetentionAction,
): RetentionRunDetail {
  return {
    run: updatedRun,
    actions: detail.actions.map((action) =>
      action.category === updatedAction.category ? updatedAction : action),
  };
}

export class PostgresRetentionRuntimeRepository implements RetentionRuntimeRepository {
  readonly #connectionString: string;
  readonly #guildId: string;
  readonly #connectionFactory: SqlConnectionFactory | null;
  readonly #idFactory: () => string;

  constructor(options: PostgresRetentionRuntimeRepositoryOptions) {
    assertNonBlank(options.connectionString, "Postgres connection string");
    if (!UUID_PATTERN.test(options.guildId)) throw new Error("Guild ID must be a UUID.");
    this.#connectionString = options.connectionString;
    this.#guildId = options.guildId;
    this.#connectionFactory = options.connectionFactory ?? null;
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  #transact<T>(work: (connection: GuildTransactionConnection) => Promise<T>): Promise<T> {
    if (this.#connectionFactory !== null) {
      return withGuildTransaction(
        this.#connectionString,
        this.#guildId,
        work,
        this.#connectionFactory,
        "serializable",
      );
    }
    return withGuildTransaction(
      this.#connectionString,
      this.#guildId,
      work,
      undefined,
      "serializable",
    );
  }

  async claimNext(input: RetentionClaimInput): Promise<RetentionRunDetail | null> {
    assertNonBlank(input.workerId, "Retention worker ID");
    assertIsoDate(input.now, "Retention claim time");
    assertPositiveInteger(input.leaseSeconds, "Retention lease seconds", MAX_LEASE_SECONDS);
    const detail = await this.#transact((connection) =>
      new GuildPortabilityRepository(connection, this.#guildId).claimNextRetentionRun({
        workerId: input.workerId,
        now: input.now,
        leaseSeconds: input.leaseSeconds,
      }));
    if (detail !== null) this.#assertDetail(detail);
    return detail;
  }

  async processCategoryBatch(input: RetentionBatchInput): Promise<RetentionBatchCommit> {
    assertIsoDate(input.now, "Retention heartbeat time");
    assertPositiveInteger(input.leaseSeconds, "Retention lease seconds", MAX_LEASE_SECONDS);
    assertPositiveInteger(input.batchSize, "Retention batch size", MAX_BATCH_SIZE);
    return this.#transact(async (connection) => {
      const portability = new GuildPortabilityRepository(connection, this.#guildId);
      const chronicle = new GuildPostgresRepository(connection, this.#guildId);
      const detail = await portability.getRetentionRun(input.runId);
      this.#assertDetail(detail);
      assertLiveLease(detail.run, input.leaseToken, input.now);
      const action = actionFor(detail, input.category);
      if (action.status === "completed") {
        return {
          detail,
          category: action.category,
          action: action.action,
          batchCandidateCount: 0,
          batchAffectedCount: 0,
          r2DeletionQueueCount: 0,
          completed: true,
        };
      }
      if (action.status === "failed") {
        throw new RetentionRuntimeError(
          "invalid_claim",
          "A failed retention category cannot be resumed.",
        );
      }

      const plan = sqlPlanFor(action.category, action.action);
      if (plan.mode === "transition" && !plan.reversibleArchive) {
        throw new RetentionRuntimeError(
          "unsupported_action",
          "An archive operation must be represented by a reversible state transition.",
        );
      }
      await this.#assertExecutionGuard(connection, detail.run, plan);
      const heartbeat = await portability.heartbeatRetentionRun({
        id: detail.run.id,
        expectedVersion: detail.run.version,
        leaseToken: input.leaseToken,
        now: input.now,
        leaseSeconds: input.leaseSeconds,
      });

      const batch = await this.#executeBatch(
        connection,
        detail.run,
        action,
        plan,
        input.batchSize,
      );
      const candidateCount = detail.run.dryRun || plan.mode === "count"
        ? batch.candidateCount
        : safeAdd(action.candidateCount, batch.candidateCount);
      const affectedCount = detail.run.dryRun
        ? 0
        : safeAdd(action.affectedCount, batch.affectedCount);
      const updatedAction = await portability.saveRetentionCheckpoint({
        id: detail.run.id,
        expectedVersion: heartbeat.version,
        leaseToken: input.leaseToken,
        category: action.category,
        expectedActionVersion: action.version,
        checkpointCursor: batch.checkpointCursor,
        candidateCount,
        affectedCount,
        completed: batch.completed,
      });
      await chronicle.appendChronicle(makeEvent(
        this.#idFactory,
        heartbeat,
        "retention.category.checkpointed",
        input.now,
        {
          source: "retention-runtime",
          category: action.category,
          retentionAction: action.action,
          dryRun: detail.run.dryRun,
          batchCandidateCount: batch.candidateCount,
          batchAffectedCount: batch.affectedCount,
          totalCandidateCount: candidateCount,
          totalAffectedCount: affectedCount,
          r2DeletionQueueCount: batch.r2DeletionQueueCount,
          categoryCompleted: batch.completed,
        },
      ));
      return {
        detail: replaceAction(detail, heartbeat, updatedAction),
        category: action.category,
        action: action.action,
        batchCandidateCount: batch.candidateCount,
        batchAffectedCount: batch.affectedCount,
        r2DeletionQueueCount: batch.r2DeletionQueueCount,
        completed: batch.completed,
      };
    });
  }

  async failRun(input: RetentionFailureInput): Promise<RetentionRun> {
    assertIsoDate(input.now, "Retention failure time");
    return this.#transact(async (connection) => {
      const repository = new GuildPortabilityRepository(connection, this.#guildId);
      const detail = await repository.getRetentionRun(input.runId);
      this.#assertDetail(detail);
      if (detail.run.status === "failed") return detail.run;
      assertLiveLease(detail.run, input.leaseToken, input.now);
      const action = actionFor(detail, input.category);
      const errorSummary = `retention_runtime:${input.errorCode}`;
      if (action.status === "pending" || action.status === "processing") {
        await repository.failRetentionAction({
          id: detail.run.id,
          expectedVersion: detail.run.version,
          leaseToken: input.leaseToken,
          category: action.category,
          expectedActionVersion: action.version,
          checkpointCursor: action.checkpointCursor,
          candidateCount: action.candidateCount,
          affectedCount: action.affectedCount,
          errorSummary,
        });
      }
      return repository.failRetentionRun({
        id: detail.run.id,
        expectedVersion: detail.run.version,
        leaseToken: input.leaseToken,
        errorSummary,
        chronicleEvent: makeEvent(
          this.#idFactory,
          detail.run,
          "retention.failed",
          input.now,
          {
            source: "retention-runtime",
            failedCategory: action.category,
            retentionAction: action.action,
            errorCode: input.errorCode,
          },
        ),
      });
    });
  }

  async completeRun(input: RetentionCompletionInput): Promise<RetentionRun> {
    assertIsoDate(input.now, "Retention completion time");
    return this.#transact(async (connection) => {
      const repository = new GuildPortabilityRepository(connection, this.#guildId);
      const detail = await repository.getRetentionRun(input.runId);
      this.#assertDetail(detail);
      if (detail.run.status === "completed") return detail.run;
      assertLiveLease(detail.run, input.leaseToken, input.now);
      const resultSummary = summarize(detail);
      return repository.completeRetentionRun({
        id: detail.run.id,
        expectedVersion: detail.run.version,
        leaseToken: input.leaseToken,
        resultSummary,
        chronicleEvent: makeEvent(
          this.#idFactory,
          detail.run,
          "retention.completed",
          input.now,
          {
            source: "retention-runtime",
            dryRun: detail.run.dryRun,
            categoryCount: detail.actions.length,
            candidateCount: resultSummary.candidateCount as number,
            affectedCount: resultSummary.affectedCount as number,
          },
        ),
      });
    });
  }

  #assertDetail(detail: RetentionRunDetail): void {
    if (detail.run.guildId !== this.#guildId ||
        detail.actions.some((action) => action.guildId !== this.#guildId ||
          action.retentionRunId !== detail.run.id) ||
        detail.actions.length !== detail.run.categories.length ||
        detail.run.categories.some((category) =>
          !detail.actions.some((action) => action.category === category))) {
      throw new RetentionRuntimeError(
        "invalid_claim",
        "Retention state crossed its Guild or immutable plan boundary.",
      );
    }
  }

  async #assertExecutionGuard(
    connection: GuildTransactionConnection,
    run: RetentionRun,
    plan: RetentionSqlPlan,
  ): Promise<void> {
    const guard = (await connection.query<RetentionExecutionGuardRow>(
      EXECUTION_GUARD_SQL,
      [this.#guildId, run.id],
    )).rows[0];
    if (!guard || guard.policy_version !== run.policyVersion ||
        !isDeparturePolicy(guard.personal_data_on_departure)) {
      throw new RetentionRuntimeError(
        "policy_changed",
        "The Constitution retention policy changed after this run was planned.",
      );
    }
    if (!run.dryRun && plan.requiresServerAuthorization &&
        (run.authorizationEvidenceId === null || !guard.authorization_valid)) {
      throw new RetentionRuntimeError(
        "authorization_evidence_missing",
        "Current server authorization evidence is required for retention purge.",
      );
    }
  }

  async #executeBatch(
    connection: GuildTransactionConnection,
    run: RetentionRun,
    action: RetentionAction,
    plan: RetentionSqlPlan,
    batchSize: number,
  ): Promise<{
    candidateCount: number;
    affectedCount: number;
    r2DeletionQueueCount: number;
    checkpointCursor: string | null;
    completed: boolean;
  }> {
    if (run.dryRun || plan.mode === "count") {
      const row = (await connection.query<RetentionCountRow>(
        plan.countSql,
        [this.#guildId, action.cutoffAt],
      )).rows[0];
      if (!row) {
        throw new RetentionRuntimeError(
          "repository_failure",
          "Retention count query returned no aggregate.",
        );
      }
      return {
        candidateCount: parseCount(row.candidate_count),
        affectedCount: 0,
        r2DeletionQueueCount: 0,
        checkpointCursor: null,
        completed: true,
      };
    }

    if (plan.mutationSql === null) {
      throw new RetentionRuntimeError(
        "unsupported_action",
        "Retention mutation SQL is not allowlisted.",
      );
    }
    assertCursor(action.checkpointCursor);
    const values: readonly unknown[] = plan.requiresServerAuthorization
      ? [this.#guildId, action.cutoffAt, action.checkpointCursor, batchSize, run.id]
      : [this.#guildId, action.cutoffAt, action.checkpointCursor, batchSize];
    const rows = (await connection.query<RetentionCursorRow>(plan.mutationSql, values)).rows;
    const checkpointCursor = rows.at(-1)?.cursor ?? action.checkpointCursor;
    if (rows.length > 0 &&
        (checkpointCursor === null || !UUID_PATTERN.test(checkpointCursor) ||
          action.checkpointCursor !== null && checkpointCursor <= action.checkpointCursor)) {
      throw new RetentionRuntimeError(
        "no_progress",
        "Retention mutation did not advance its stable checkpoint.",
      );
    }
    return {
      candidateCount: rows.length,
      affectedCount: rows.length,
      r2DeletionQueueCount: plan.queuesR2Deletion ? rows.length : 0,
      checkpointCursor,
      completed: rows.length < batchSize,
    };
  }
}

export interface GuildRetentionRuntimeOptions {
  batchSize?: number;
  leaseSeconds?: number;
  maxBatchRetries?: number;
  retryDelayMs?: number;
  now?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
}

export type RetentionRuntimeResult =
  | { status: "idle" }
  | {
      status: "completed";
      runId: string;
      dryRun: boolean;
      candidateCount: number;
      affectedCount: number;
    }
  | {
      status: "failed";
      runId: string;
      failedCategory: RetentionCategory;
      errorCode: RetentionRuntimeErrorCode;
    }
  | {
      status: "lease_lost";
      runId: string;
      category: RetentionCategory;
    };

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function normalizedRuntimeError(error: unknown): RetentionRuntimeError {
  if (error instanceof RetentionRuntimeError) return error;
  const state = sqlState(error);
  if (state === "40001" || state === "40P01" || state?.startsWith("08") === true ||
      state === "57P01" || state === "57P02" || state === "57P03") {
    return new RetentionRuntimeError(
      "repository_transient",
      "Retention storage is temporarily unavailable.",
      true,
    );
  }
  return new RetentionRuntimeError(
    "repository_failure",
    "Retention storage rejected the operation.",
  );
}

export class GuildRetentionRuntime {
  readonly #repository: RetentionRuntimeRepository;
  readonly #batchSize: number;
  readonly #leaseSeconds: number;
  readonly #maxBatchRetries: number;
  readonly #retryDelayMs: number;
  readonly #now: () => string;
  readonly #sleep: (delayMs: number) => Promise<void>;

  constructor(
    repository: RetentionRuntimeRepository,
    options: GuildRetentionRuntimeOptions = {},
  ) {
    this.#repository = repository;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.#maxBatchRetries = options.maxBatchRetries ?? DEFAULT_BATCH_RETRIES;
    this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.#now = options.now ?? defaultNow;
    this.#sleep = options.sleep ?? defaultSleep;
    assertPositiveInteger(this.#batchSize, "Retention batch size", MAX_BATCH_SIZE);
    assertPositiveInteger(this.#leaseSeconds, "Retention lease seconds", MAX_LEASE_SECONDS);
    if (!Number.isSafeInteger(this.#maxBatchRetries) || this.#maxBatchRetries < 0 ||
        this.#maxBatchRetries > MAX_BATCH_RETRIES) {
      throw new Error(`Retention batch retries must be between 0 and ${MAX_BATCH_RETRIES}.`);
    }
    if (!Number.isSafeInteger(this.#retryDelayMs) || this.#retryDelayMs < 0 ||
        this.#retryDelayMs > 60_000) {
      throw new Error("Retention retry delay must be between 0 and 60000 milliseconds.");
    }
  }

  async runNext(workerId: string): Promise<RetentionRuntimeResult> {
    assertNonBlank(workerId, "Retention worker ID");
    const claimed = await this.#repository.claimNext({
      workerId,
      now: this.#now(),
      leaseSeconds: this.#leaseSeconds,
    });
    if (claimed === null) return { status: "idle" };
    const leaseToken = claimed.run.leaseToken;
    if (claimed.run.status !== "processing" || leaseToken === null) {
      throw new RetentionRuntimeError(
        "invalid_claim",
        "The repository returned a retention run without a live lease.",
      );
    }

    let detail = claimed;
    while (true) {
      const failedAction = detail.actions.find((action) => action.status === "failed");
      if (failedAction) {
        const failedRun = await this.#repository.failRun({
          runId: detail.run.id,
          category: failedAction.category,
          leaseToken,
          errorCode: "repository_failure",
          now: this.#now(),
        });
        return {
          status: "failed",
          runId: failedRun.id,
          failedCategory: failedAction.category,
          errorCode: "repository_failure",
        };
      }

      const pending = detail.actions.find((action) => action.status !== "completed");
      if (!pending) {
        const completed = await this.#repository.completeRun({
          runId: detail.run.id,
          leaseToken,
          now: this.#now(),
        });
        const summary = summarize(detail);
        return {
          status: "completed",
          runId: completed.id,
          dryRun: detail.run.dryRun,
          candidateCount: summary.candidateCount as number,
          affectedCount: summary.affectedCount as number,
        };
      }

      try {
        const commit = await this.#processWithRetry({
          runId: detail.run.id,
          category: pending.category,
          leaseToken,
          now: this.#now(),
          leaseSeconds: this.#leaseSeconds,
          batchSize: this.#batchSize,
        });
        detail = commit.detail;
      } catch (error) {
        const normalized = normalizedRuntimeError(error);
        if (normalized.code === "lease_lost") {
          return {
            status: "lease_lost",
            runId: detail.run.id,
            category: pending.category,
          };
        }
        try {
          const failed = await this.#repository.failRun({
            runId: detail.run.id,
            category: pending.category,
            leaseToken,
            errorCode: normalized.code,
            now: this.#now(),
          });
          return {
            status: "failed",
            runId: failed.id,
            failedCategory: pending.category,
            errorCode: normalized.code,
          };
        } catch (failureError) {
          const normalizedFailure = normalizedRuntimeError(failureError);
          if (normalizedFailure.code === "lease_lost") {
            return {
              status: "lease_lost",
              runId: detail.run.id,
              category: pending.category,
            };
          }
          throw normalizedFailure;
        }
      }
    }
  }

  async #processWithRetry(input: RetentionBatchInput): Promise<RetentionBatchCommit> {
    let attempt = 0;
    while (true) {
      try {
        return await this.#repository.processCategoryBatch({
          ...input,
          now: this.#now(),
        });
      } catch (error) {
        const normalized = normalizedRuntimeError(error);
        if (!normalized.retryable || attempt >= this.#maxBatchRetries) throw normalized;
        const delay = this.#retryDelayMs * 2 ** attempt;
        attempt += 1;
        await this.#sleep(delay);
      }
    }
  }
}
