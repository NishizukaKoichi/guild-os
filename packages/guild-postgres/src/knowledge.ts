import {
  GuildDomainError,
  assertKnowledgeContent,
  assertKnowledgeReview,
  assertKnowledgeTransition,
  assertNonBlank,
  type AppLocale,
  type ChronicleEvent,
  type Classification,
  type KnowledgeReview,
  type KnowledgeReviewVerdict,
  type KnowledgeState,
  type KnowledgeVersion,
  type LocalizedText,
  type SecuredResource,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface KnowledgeListCursor {
  updatedAt: string;
  id: string;
}

export interface KnowledgeSummary extends SecuredResource {
  allowedIdentityIds: readonly string[];
  state: KnowledgeState;
  currentVersion: number;
  canonicalVersion: number | null;
  title: LocalizedText;
  summary: LocalizedText;
  sourceIds: readonly string[];
  createdByIdentityId: string;
  reviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFile extends SecuredResource {
  id: string;
  guildId: string;
  spaceId: string | null;
  knowledgeId: string;
  knowledgeVersion: number;
  ownerIdentityId: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  originalName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  r2Key: string;
  status: "pending" | "ready" | "failed" | "deleted";
  position: number;
  createdAt: string;
}

export interface KnowledgeDetail extends KnowledgeSummary {
  versions: readonly KnowledgeVersion[];
  reviews: readonly KnowledgeReview[];
  files: readonly KnowledgeFile[];
}

export interface KnowledgeSearchCandidate extends KnowledgeSummary {
  body: LocalizedText;
  rank: number;
}

export interface KnowledgeListPage {
  items: readonly KnowledgeSummary[];
  nextCursor: KnowledgeListCursor | null;
}

export interface KnowledgeContentInput {
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
}

export interface CreateKnowledgeInput extends KnowledgeContentInput {
  id: string;
  spaceId: string | null;
  ownerIdentityId: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  reviewDueAt: string | null;
  changeNote: string;
  chronicleEvent: ChronicleEvent;
}

export interface SaveKnowledgeDraftInput extends KnowledgeContentInput {
  knowledgeId: string;
  expectedVersion: number;
  actorIdentityId: string;
  spaceId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  reviewDueAt: string | null;
  changeNote: string;
  chronicleEvent: ChronicleEvent;
}

export interface KnowledgeFileDeletion {
  outboxId: string;
  fileId: string;
  r2Key: string;
  attemptCount: number;
}

export interface KnowledgeTransitionInput {
  knowledgeId: string;
  expectedVersion: number;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ReviewKnowledgeInput extends KnowledgeTransitionInput {
  reviewId: string;
  verdict: KnowledgeReviewVerdict;
  reason: string;
}

export interface BeginKnowledgeFileInput {
  fileId: string;
  knowledgeId: string;
  expectedVersion: number;
  actorIdentityId: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  r2Key: string;
  uploadExpiresAt: string;
  chronicleEvent: ChronicleEvent;
}

type KnowledgeRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  state: KnowledgeState;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  current_version: number;
  canonical_version: number | null;
  review_due_at: string | null;
  created_at: string;
  updated_at: string;
  title: LocalizedText;
  summary: LocalizedText;
  source_ids: string[];
  created_by_identity_id: string;
};

type KnowledgeVersionRow = QueryResultRow & {
  guild_id: string;
  knowledge_id: string;
  version: number;
  state: KnowledgeState;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  source_ids: string[];
  created_by_identity_id: string;
  created_at: string;
};

type KnowledgeReviewRow = QueryResultRow & {
  id: string;
  guild_id: string;
  knowledge_id: string;
  knowledge_version: number;
  reviewer_identity_id: string;
  verdict: KnowledgeReviewVerdict;
  reason: string;
  created_at: string;
};

type KnowledgeFileRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  knowledge_id: string;
  knowledge_version: number;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  original_name: string;
  media_type: string;
  byte_size: string;
  sha256: string;
  r2_key: string;
  status: KnowledgeFile["status"];
  position: number;
  created_at: string;
};

type SearchRow = KnowledgeRow & { body: LocalizedText; rank: number };

type KnowledgeFileDeletionRow = QueryResultRow & {
  id: string;
  payload: unknown;
  attempt_count: number;
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_VERSION_HISTORY = 100;
const MAX_REVIEW_HISTORY = 100;
const MAX_FILES_PER_VERSION = 50;
const MAX_FILE_DELETE_ATTEMPTS = 10;

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return parsed.toISOString();
}

function sameIdentitySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

function fileDeletionFromRow(row: KnowledgeFileDeletionRow): KnowledgeFileDeletion {
  if (!row.payload || typeof row.payload !== "object") {
    throw new Error("Knowledge file deletion payload is malformed.");
  }
  const payload = row.payload as Readonly<Record<string, unknown>>;
  if (typeof payload.fileId !== "string" || typeof payload.r2Key !== "string" ||
      !payload.fileId || !payload.r2Key || !Number.isSafeInteger(row.attempt_count)) {
    throw new Error("Knowledge file deletion payload is malformed.");
  }
  return {
    outboxId: row.id,
    fileId: payload.fileId,
    r2Key: payload.r2Key,
    attemptCount: row.attempt_count,
  };
}

function summaryFromRow(row: KnowledgeRow): KnowledgeSummary {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    state: row.state,
    currentVersion: row.current_version,
    canonicalVersion: row.canonical_version,
    title: row.title,
    summary: row.summary,
    sourceIds: row.source_ids,
    createdByIdentityId: row.created_by_identity_id,
    reviewDueAt: row.review_due_at === null ? null : isoTimestamp(row.review_due_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function versionFromRow(row: KnowledgeVersionRow): KnowledgeVersion {
  return {
    guildId: row.guild_id,
    knowledgeId: row.knowledge_id,
    version: row.version,
    state: row.state,
    title: row.title,
    summary: row.summary,
    body: row.body,
    sourceIds: row.source_ids,
    createdByIdentityId: row.created_by_identity_id,
    createdAt: isoTimestamp(row.created_at),
  };
}

function reviewFromRow(row: KnowledgeReviewRow): KnowledgeReview {
  return {
    id: row.id,
    guildId: row.guild_id,
    knowledgeId: row.knowledge_id,
    version: row.knowledge_version,
    reviewerIdentityId: row.reviewer_identity_id,
    verdict: row.verdict,
    reason: row.reason,
    createdAt: isoTimestamp(row.created_at),
  };
}

function fileFromRow(row: KnowledgeFileRow): KnowledgeFile {
  const byteSize = Number(row.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("Database contains an invalid Knowledge file size.");
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    knowledgeId: row.knowledge_id,
    knowledgeVersion: row.knowledge_version,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize,
    sha256: row.sha256,
    r2Key: row.r2_key,
    status: row.status,
    position: row.position,
    createdAt: isoTimestamp(row.created_at),
  };
}

export class GuildKnowledgeRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listKnowledge(
    cursor: KnowledgeListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<KnowledgeListPage> {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Knowledge page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    const result = await this.#connection.query<KnowledgeRow>(
      `${this.#summarySelect()}
        WHERE k.guild_id = $1
          AND ($2::timestamptz IS NULL OR (k.updated_at, k.id) < ($2::timestamptz, $3::uuid))
        ORDER BY k.updated_at DESC, k.id DESC
        LIMIT $4`,
      [this.#guildId, cursor?.updatedAt ?? null, cursor?.id ?? null, pageSize + 1],
    );
    const rows = result.rows.slice(0, pageSize);
    const last = rows.at(-1);
    return {
      items: rows.map(summaryFromRow),
      nextCursor: result.rows.length > pageSize && last
        ? { updatedAt: last.updated_at, id: last.id }
        : null,
    };
  }

  async listAuthorizedKnowledge(
    actorIdentityId: string,
    cursor: KnowledgeListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<KnowledgeListPage> {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Knowledge page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    const result = await this.#connection.query<KnowledgeRow>(
      `WITH RECURSIVE ${this.#knowledgeAuthorizationCtes()}
       ${this.#summarySelect()}
       CROSS JOIN knowledge_access access
        WHERE k.guild_id = $1
          AND ${this.#knowledgeReadPredicate()}
          AND ($3::timestamptz IS NULL OR (k.updated_at, k.id) < ($3::timestamptz, $4::uuid))
        ORDER BY k.updated_at DESC, k.id DESC
        LIMIT $5`,
      [this.#guildId, actorIdentityId, cursor?.updatedAt ?? null, cursor?.id ?? null, pageSize + 1],
    );
    const rows = result.rows.slice(0, pageSize);
    const last = rows.at(-1);
    return {
      items: rows.map(summaryFromRow),
      nextCursor: result.rows.length > pageSize && last
        ? { updatedAt: last.updated_at, id: last.id }
        : null,
    };
  }

  async getKnowledge(knowledgeId: string): Promise<KnowledgeDetail> {
    const row = await this.#loadKnowledgeRow(knowledgeId);
    const versions = (await this.#connection.query<KnowledgeVersionRow>(
      `SELECT guild_id::text, knowledge_id::text, version, state, title, summary, body,
              source_ids::text[], created_by_identity_id::text, created_at::text
         FROM knowledge_versions
        WHERE guild_id = $1 AND knowledge_id = $2
        ORDER BY version DESC LIMIT $3`,
      [this.#guildId, knowledgeId, MAX_VERSION_HISTORY],
    )).rows.map(versionFromRow);
    const reviews = (await this.#connection.query<KnowledgeReviewRow>(
      `SELECT id::text, guild_id::text, knowledge_id::text, knowledge_version,
              reviewer_identity_id::text, verdict, reason, created_at::text
         FROM knowledge_reviews
        WHERE guild_id = $1 AND knowledge_id = $2
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [this.#guildId, knowledgeId, MAX_REVIEW_HISTORY],
    )).rows.map(reviewFromRow);
    const files = await this.listFiles(knowledgeId, row.current_version);
    return { ...summaryFromRow(row), versions, reviews, files };
  }

  async listFiles(knowledgeId: string, version: number): Promise<KnowledgeFile[]> {
    return (await this.#connection.query<KnowledgeFileRow>(
      `SELECT f.id::text, f.guild_id::text, f.space_id::text,
              link.knowledge_id::text, link.knowledge_version,
              f.owner_identity_id::text, f.visibility, f.classification,
              f.allowed_identity_ids::text[], f.original_name, f.media_type,
              f.byte_size::text, f.sha256, f.r2_key, f.status,
              link.position, f.created_at::text
         FROM knowledge_version_files link
         JOIN files f ON f.guild_id = link.guild_id AND f.id = link.file_id
        WHERE link.guild_id = $1 AND link.knowledge_id = $2
          AND link.knowledge_version = $3 AND f.status <> 'deleted'
        ORDER BY link.position, f.id`,
      [this.#guildId, knowledgeId, version],
    )).rows.map(fileFromRow);
  }

  async createKnowledge(input: CreateKnowledgeInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.ownerIdentityId);
    this.#assertContent(input);
    await this.#connection.query(
      `INSERT INTO knowledge
         (id, guild_id, space_id, owner_identity_id, state, visibility, classification,
          allowed_identity_ids, current_version, canonical_version, review_due_at)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7::uuid[], 1, NULL, $8)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.ownerIdentityId,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.reviewDueAt,
      ],
    );
    await this.#insertVersion(input.id, 1, "draft", input, input.ownerIdentityId, input.changeNote);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async saveDraft(input: SaveKnowledgeDraftInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    this.#assertContent(input);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "draft") throw new Error("Only a draft Knowledge version can be edited.");
    if (row.canonical_version !== null && (
      row.space_id !== input.spaceId || row.visibility !== input.visibility ||
      row.classification !== input.classification ||
      !sameIdentitySet(row.allowed_identity_ids, input.allowedIdentityIds)
    )) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Published Knowledge security boundaries are immutable. Create a new Knowledge record.",
      );
    }
    await this.#assertNoPendingFiles(input.knowledgeId, row.current_version);
    const nextVersion = await this.#nextVersion(input.knowledgeId);
    await this.#connection.query(
      `UPDATE knowledge_versions SET state = 'archived'
        WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3 AND state = 'draft'`,
      [this.#guildId, input.knowledgeId, row.current_version],
    );
    await this.#insertVersion(
      input.knowledgeId,
      nextVersion,
      "draft",
      input,
      input.actorIdentityId,
      input.changeNote,
    );
    await this.#copyVersionFiles(input.knowledgeId, row.current_version, nextVersion);
    await this.#connection.query(
      `UPDATE knowledge
          SET current_version = $3, state = 'draft', space_id = $4,
              visibility = $5, classification = $6,
              allowed_identity_ids = $7::uuid[], review_due_at = $8
        WHERE guild_id = $1 AND id = $2`,
      [
        this.#guildId,
        input.knowledgeId,
        nextVersion,
        input.spaceId,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.reviewDueAt,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return nextVersion;
  }

  async startRevision(input: KnowledgeTransitionInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "canonical" || row.canonical_version !== row.current_version) {
      throw new Error("Only the current Canonical Knowledge can start a revision.");
    }
    const current = await this.#loadVersion(input.knowledgeId, row.current_version);
    const nextVersion = await this.#nextVersion(input.knowledgeId);
    await this.#insertVersion(
      input.knowledgeId,
      nextVersion,
      "draft",
      current,
      input.actorIdentityId,
      "Start revision from the current Canonical version.",
    );
    await this.#copyVersionFiles(input.knowledgeId, row.current_version, nextVersion);
    await this.#connection.query(
      `UPDATE knowledge SET current_version = $3, state = 'draft'
        WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, input.knowledgeId, nextVersion],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return nextVersion;
  }

  async propose(input: KnowledgeTransitionInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    await this.#assertNoPendingFiles(input.knowledgeId, row.current_version);
    assertKnowledgeTransition(row.state, "proposed");
    await this.#setCurrentState(row, "proposed");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async review(input: ReviewKnowledgeInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    assertKnowledgeReview(input.verdict, input.reason);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "proposed") throw new Error("Only proposed Knowledge can be reviewed.");
    await this.#connection.query(
      `INSERT INTO knowledge_reviews
         (id, guild_id, knowledge_id, knowledge_version, reviewer_identity_id, verdict, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.reviewId,
        this.#guildId,
        input.knowledgeId,
        input.expectedVersion,
        input.actorIdentityId,
        input.verdict,
        input.reason,
      ],
    );
    if (input.verdict === "request_changes") {
      assertKnowledgeTransition(row.state, "draft");
      await this.#setCurrentState(row, "draft");
    } else {
      assertKnowledgeTransition(row.state, "canonical");
      if (row.canonical_version !== null) {
        await this.#connection.query(
          `UPDATE knowledge_versions SET state = 'deprecated'
            WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3 AND state = 'canonical'`,
          [this.#guildId, input.knowledgeId, row.canonical_version],
        );
      }
      await this.#connection.query(
        `UPDATE knowledge_versions SET state = 'canonical'
          WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3 AND state = 'proposed'`,
        [this.#guildId, input.knowledgeId, row.current_version],
      );
      await this.#connection.query(
        `UPDATE knowledge SET state = 'canonical', canonical_version = current_version
          WHERE guild_id = $1 AND id = $2`,
        [this.#guildId, input.knowledgeId],
      );
      await this.#notifyCanonicalReaders(row, input.actorIdentityId);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async archiveWorkingVersion(input: KnowledgeTransitionInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "draft" && row.state !== "proposed") {
      throw new Error("Only draft or proposed Knowledge can be archived from this operation.");
    }
    const pending = await this.#connection.query<QueryResultRow>(
      `SELECT 1
         FROM knowledge_version_files link
         JOIN files f ON f.guild_id = link.guild_id AND f.id = link.file_id
        WHERE link.guild_id = $1 AND link.knowledge_id = $2
          AND link.knowledge_version = $3 AND f.status = 'pending' LIMIT 1`,
      [this.#guildId, input.knowledgeId, row.current_version],
    );
    if (pending.rows.length > 0) throw new Error("Finish or remove pending file uploads first.");
    assertKnowledgeTransition(row.state, "archived");
    await this.#connection.query(
      `UPDATE knowledge_versions SET state = 'archived'
        WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3`,
      [this.#guildId, input.knowledgeId, row.current_version],
    );
    if (row.canonical_version === null) {
      await this.#connection.query(
        "UPDATE knowledge SET state = 'archived' WHERE guild_id = $1 AND id = $2",
        [this.#guildId, input.knowledgeId],
      );
    } else {
      await this.#connection.query(
        `UPDATE knowledge SET current_version = canonical_version, state = 'canonical'
          WHERE guild_id = $1 AND id = $2`,
        [this.#guildId, input.knowledgeId],
      );
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async deprecate(input: KnowledgeTransitionInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "canonical" || row.canonical_version !== row.current_version) {
      throw new Error("Only current Canonical Knowledge can be deprecated.");
    }
    assertKnowledgeTransition(row.state, "deprecated");
    await this.#setCurrentState(row, "deprecated");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async archiveDeprecated(input: KnowledgeTransitionInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    assertKnowledgeTransition(row.state, "archived");
    await this.#setCurrentState(row, "archived");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async acknowledge(
    knowledgeId: string,
    version: number,
    identityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<boolean> {
    this.#assertEvent(chronicleEvent, identityId);
    const result = await this.#connection.query(
      `INSERT INTO knowledge_acknowledgements
         (guild_id, knowledge_id, knowledge_version, identity_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [this.#guildId, knowledgeId, version, identityId],
    );
    if (result.rowCount === 1) await this.#chronicle.appendChronicle(chronicleEvent);
    return result.rowCount === 1;
  }

  async hasAcknowledged(
    knowledgeId: string,
    version: number,
    identityId: string,
  ): Promise<boolean> {
    const result = await this.#connection.query<{ acknowledged: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM knowledge_acknowledgements
          WHERE guild_id = $1 AND knowledge_id = $2
            AND knowledge_version = $3 AND identity_id = $4
       ) AS acknowledged`,
      [this.#guildId, knowledgeId, version, identityId],
    );
    return result.rows[0]?.acknowledged ?? false;
  }

  async beginFileUpload(input: BeginKnowledgeFileInput): Promise<KnowledgeFile> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    assertNonBlank(input.originalName, "File name", 255);
    assertNonBlank(input.mediaType, "Media type", 200);
    if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("File SHA-256 is invalid.");
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
      throw new Error("File size must be a positive safe integer.");
    }
    const row = await this.#loadKnowledgeRow(input.knowledgeId, true);
    this.#assertExpectedVersion(row, input.expectedVersion);
    if (row.state !== "draft") throw new Error("Files can be uploaded only to a draft.");
    const positionResult = await this.#connection.query<QueryResultRow & { next_position: number }>(
      `SELECT COALESCE(max(position) + 1, 0)::integer AS next_position
         FROM knowledge_version_files
        WHERE guild_id = $1 AND knowledge_id = $2 AND knowledge_version = $3`,
      [this.#guildId, input.knowledgeId, row.current_version],
    );
    const position = positionResult.rows[0]?.next_position ?? 0;
    if (position >= MAX_FILES_PER_VERSION) {
      throw new Error(`A Knowledge version supports at most ${MAX_FILES_PER_VERSION} files.`);
    }
    await this.#connection.query(
      `INSERT INTO files
         (id, guild_id, space_id, owner_identity_id, r2_key, sha256, media_type,
          byte_size, visibility, classification, allowed_identity_ids, original_name,
          status, upload_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[], $12, 'pending', $13)`,
      [
        input.fileId,
        this.#guildId,
        row.space_id,
        input.actorIdentityId,
        input.r2Key,
        input.sha256,
        input.mediaType,
        input.byteSize,
        row.visibility,
        row.classification,
        row.allowed_identity_ids,
        input.originalName,
        input.uploadExpiresAt,
      ],
    );
    await this.#connection.query(
      `INSERT INTO knowledge_version_files
         (guild_id, knowledge_id, knowledge_version, file_id, position)
       VALUES ($1, $2, $3, $4, $5)`,
      [this.#guildId, input.knowledgeId, row.current_version, input.fileId, position],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return {
      id: input.fileId,
      guildId: this.#guildId,
      spaceId: row.space_id,
      knowledgeId: input.knowledgeId,
      knowledgeVersion: row.current_version,
      ownerIdentityId: input.actorIdentityId,
      visibility: row.visibility,
      classification: row.classification,
      allowedIdentityIds: row.allowed_identity_ids,
      originalName: input.originalName,
      mediaType: input.mediaType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      r2Key: input.r2Key,
      status: "pending",
      position,
      createdAt: input.chronicleEvent.occurredAt,
    };
  }

  async finalizeFileUpload(
    fileId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const result = await this.#connection.query(
      `UPDATE files SET status = 'ready', upload_expires_at = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
      [this.#guildId, fileId],
    );
    if (result.rowCount !== 1) throw new Error("Pending Knowledge file was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async failFileUpload(
    fileId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<KnowledgeFileDeletion | null> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    await this.#connection.query(
      "DELETE FROM knowledge_version_files WHERE guild_id = $1 AND file_id = $2",
      [this.#guildId, fileId],
    );
    const result = await this.#connection.query<QueryResultRow & { r2_key: string }>(
      `UPDATE files SET status = 'failed', upload_expires_at = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
      [this.#guildId, fileId],
    );
    if (result.rowCount !== 1) return null;
    await this.#chronicle.appendChronicle(chronicleEvent);
    const file = (await this.#connection.query<QueryResultRow & { r2_key: string }>(
      "SELECT r2_key FROM files WHERE guild_id = $1 AND id = $2",
      [this.#guildId, fileId],
    )).rows[0];
    return file ? this.#enqueueFileDeletion(fileId, file.r2_key) : null;
  }

  async removeFileFromDraft(
    knowledgeId: string,
    expectedVersion: number,
    fileId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<KnowledgeFileDeletion | null> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const row = await this.#loadKnowledgeRow(knowledgeId, true);
    this.#assertExpectedVersion(row, expectedVersion);
    if (row.state !== "draft") throw new Error("Files can be removed only from a draft.");
    const file = await this.#connection.query<QueryResultRow & { r2_key: string }>(
      `SELECT f.r2_key
         FROM knowledge_version_files link
         JOIN files f ON f.guild_id = link.guild_id AND f.id = link.file_id
        WHERE link.guild_id = $1 AND link.knowledge_id = $2
          AND link.knowledge_version = $3 AND link.file_id = $4
        FOR UPDATE OF f`,
      [this.#guildId, knowledgeId, expectedVersion, fileId],
    );
    const r2Key = file.rows[0]?.r2_key;
    if (!r2Key) throw new Error("Knowledge file was not found on the current draft.");
    await this.#connection.query(
      `DELETE FROM knowledge_version_files
        WHERE guild_id = $1 AND knowledge_id = $2
          AND knowledge_version = $3 AND file_id = $4`,
      [this.#guildId, knowledgeId, expectedVersion, fileId],
    );
    const stillReferenced = (await this.#connection.query<QueryResultRow>(
      "SELECT 1 FROM knowledge_version_files WHERE guild_id = $1 AND file_id = $2 LIMIT 1",
      [this.#guildId, fileId],
    )).rows.length > 0;
    if (!stillReferenced) {
      await this.#connection.query(
        `UPDATE files SET status = 'deleted', upload_expires_at = NULL
          WHERE guild_id = $1 AND id = $2 AND status <> 'deleted'`,
        [this.#guildId, fileId],
      );
    }
    await this.#chronicle.appendChronicle(chronicleEvent);
    return stillReferenced ? null : this.#enqueueFileDeletion(fileId, r2Key);
  }

  async queueExpiredFileDeletions(limit = 50): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Expired Knowledge file cleanup limit must be between 1 and 100.");
    }
    const expired = (await this.#connection.query<QueryResultRow & {
      id: string;
      r2_key: string;
    }>(
      `SELECT id::text, r2_key
         FROM files
        WHERE guild_id = $1 AND status = 'pending' AND upload_expires_at <= now()
        ORDER BY upload_expires_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    for (const file of expired) {
      await this.#connection.query(
        "DELETE FROM knowledge_version_files WHERE guild_id = $1 AND file_id = $2",
        [this.#guildId, file.id],
      );
      await this.#connection.query(
        `UPDATE files SET status = 'deleted', upload_expires_at = NULL
          WHERE guild_id = $1 AND id = $2 AND status = 'pending'`,
        [this.#guildId, file.id],
      );
      await this.#enqueueFileDeletion(file.id, file.r2_key);
    }
    await this.#connection.query(
      `INSERT INTO outbox
         (id, guild_id, topic, payload, idempotency_key, status)
       SELECT gen_random_uuid(), f.guild_id, 'knowledge.file.delete',
              jsonb_build_object('fileId', f.id::text, 'r2Key', f.r2_key),
              'knowledge-file-delete:' || f.id::text, 'pending'
         FROM files f
        WHERE f.guild_id = $1 AND f.status IN ('failed', 'deleted')
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING`,
      [this.#guildId],
    );
    return expired.length;
  }

  async claimFileDeletion(outboxId: string): Promise<KnowledgeFileDeletion | null> {
    const row = (await this.#connection.query<KnowledgeFileDeletionRow>(
      `UPDATE outbox
          SET status = 'processing', attempt_count = attempt_count + 1, locked_at = now()
        WHERE guild_id = $1 AND id = $2 AND topic = 'knowledge.file.delete'
          AND status = 'pending' AND available_at <= now()
      RETURNING id::text, payload, attempt_count`,
      [this.#guildId, outboxId],
    )).rows[0];
    return row ? fileDeletionFromRow(row) : null;
  }

  async claimFileDeletions(limit = 25): Promise<KnowledgeFileDeletion[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Knowledge file deletion limit must be between 1 and 100.");
    }
    await this.#connection.query(
      `UPDATE outbox SET status = 'pending', locked_at = NULL, available_at = now()
        WHERE guild_id = $1 AND topic = 'knowledge.file.delete' AND status = 'processing'
          AND locked_at < now() - interval '10 minutes'`,
      [this.#guildId],
    );
    const rows = (await this.#connection.query<KnowledgeFileDeletionRow>(
      `WITH selected AS (
         SELECT id
           FROM outbox
          WHERE guild_id = $1 AND topic = 'knowledge.file.delete'
            AND status = 'pending' AND available_at <= now()
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE outbox target
          SET status = 'processing', attempt_count = target.attempt_count + 1, locked_at = now()
         FROM selected
        WHERE target.guild_id = $1 AND target.id = selected.id
      RETURNING target.id::text, target.payload, target.attempt_count`,
      [this.#guildId, limit],
    )).rows;
    return rows.map(fileDeletionFromRow);
  }

  async completeFileDeletion(outboxId: string): Promise<void> {
    const result = await this.#connection.query(
      `UPDATE outbox
          SET status = 'completed', completed_at = now(), locked_at = NULL, last_error = NULL
        WHERE guild_id = $1 AND id = $2 AND topic = 'knowledge.file.delete'
          AND status = 'processing'`,
      [this.#guildId, outboxId],
    );
    if (result.rowCount !== 1) throw new Error("Claimed Knowledge file deletion was not found.");
  }

  async retryFileDeletion(outboxId: string, errorMessage: string): Promise<void> {
    assertNonBlank(errorMessage, "Knowledge file deletion error", 2_000);
    const result = await this.#connection.query(
      `UPDATE outbox
          SET status = CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'pending' END,
              available_at = now() + make_interval(secs => LEAST(3600, 30 * attempt_count)),
              locked_at = NULL, last_error = $4
        WHERE guild_id = $1 AND id = $2 AND topic = 'knowledge.file.delete'
          AND status = 'processing'`,
      [this.#guildId, outboxId, MAX_FILE_DELETE_ATTEMPTS, errorMessage],
    );
    if (result.rowCount !== 1) throw new Error("Claimed Knowledge file deletion was not found.");
  }

  async getFile(fileId: string): Promise<KnowledgeFile> {
    const row = (await this.#connection.query<KnowledgeFileRow>(
      `SELECT f.id::text, f.guild_id::text, f.space_id::text,
              link.knowledge_id::text, link.knowledge_version,
              f.owner_identity_id::text, f.visibility, f.classification,
              f.allowed_identity_ids::text[], f.original_name, f.media_type,
              f.byte_size::text, f.sha256, f.r2_key, f.status,
              link.position, f.created_at::text
         FROM files f
         JOIN knowledge_version_files link
           ON link.guild_id = f.guild_id AND link.file_id = f.id
         JOIN knowledge k
           ON k.guild_id = link.guild_id AND k.id = link.knowledge_id
        WHERE f.guild_id = $1 AND f.id = $2 AND f.status = 'ready'
        ORDER BY (link.knowledge_version = k.canonical_version) DESC,
                 (link.knowledge_version = k.current_version) DESC,
                 link.knowledge_version DESC
        LIMIT 1`,
      [this.#guildId, fileId],
    )).rows[0];
    if (!row) throw new Error("Ready Knowledge file was not found.");
    return fileFromRow(row);
  }

  async searchCanonical(query: string, limit = 24): Promise<KnowledgeSearchCandidate[]> {
    assertNonBlank(query, "Knowledge search query", 500);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Knowledge search limit must be between 1 and 50.");
    }
    const result = await this.#connection.query<SearchRow>(
      `WITH search AS (SELECT websearch_to_tsquery('simple', $2) AS terms)
       SELECT k.id::text, k.guild_id::text, k.space_id::text, k.owner_identity_id::text,
              k.state, k.visibility, k.classification, k.allowed_identity_ids::text[],
              k.current_version, k.canonical_version, k.review_due_at::text,
              k.created_at::text, k.updated_at::text,
              kv.title, kv.summary, kv.body, kv.source_ids::text[],
              kv.created_by_identity_id::text,
              ts_rank(
                to_tsvector('simple', kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text),
                search.terms
              )::float8 AS rank
         FROM knowledge k
         JOIN knowledge_versions kv
           ON kv.guild_id = k.guild_id AND kv.knowledge_id = k.id
          AND kv.version = k.canonical_version AND kv.state = 'canonical'
         CROSS JOIN search
        WHERE k.guild_id = $1
          AND (
            numnode(search.terms) > 0
              AND to_tsvector('simple', kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text)
                    @@ search.terms
            OR lower(kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text)
                 LIKE '%' || lower($2) || '%'
          )
        ORDER BY
          CASE WHEN lower(kv.title::text) LIKE '%' || lower($2) || '%' THEN 1 ELSE 0 END DESC,
          rank DESC, k.updated_at DESC, k.id
        LIMIT $3`,
      [this.#guildId, query, limit],
    );
    return result.rows.map((row) => ({ ...summaryFromRow(row), body: row.body, rank: row.rank }));
  }

  async searchAuthorizedCanonical(
    actorIdentityId: string,
    query: string,
    locale: AppLocale = "en",
    limit = 24,
  ): Promise<KnowledgeSearchCandidate[]> {
    assertNonBlank(query, "Knowledge search query", 500);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Knowledge search limit must be between 1 and 50.");
    }
    const result = await this.#connection.query<SearchRow>(
      `WITH RECURSIVE ${this.#knowledgeAuthorizationCtes()},
       search AS (
         SELECT CASE WHEN $4::text = 'en'
                THEN 'english'::regconfig ELSE 'simple'::regconfig END AS config
       ), search_terms AS (
         SELECT search.config, websearch_to_tsquery(search.config, $3) AS terms
           FROM search
       )
       SELECT k.id::text, k.guild_id::text, k.space_id::text, k.owner_identity_id::text,
              k.state, k.visibility, k.classification, k.allowed_identity_ids::text[],
              k.current_version, k.canonical_version, k.review_due_at::text,
              k.created_at::text, k.updated_at::text,
              kv.title, kv.summary, kv.body, kv.source_ids::text[],
              kv.created_by_identity_id::text,
              ts_rank(
                to_tsvector(search_terms.config, kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text),
                search_terms.terms
              )::float8 AS rank
         FROM knowledge k
         JOIN knowledge_versions kv
           ON kv.guild_id = k.guild_id AND kv.knowledge_id = k.id
          AND kv.version = k.canonical_version AND kv.state = 'canonical'
         CROSS JOIN knowledge_access access
         CROSS JOIN search_terms
        WHERE k.guild_id = $1
          AND ${this.#knowledgeReadPredicate()}
          AND (
            numnode(search_terms.terms) > 0
              AND to_tsvector(search_terms.config, kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text)
                    @@ search_terms.terms
            OR lower(kv.title::text || ' ' || kv.summary::text || ' ' || kv.body::text)
                 LIKE '%' || lower($3) || '%'
          )
        ORDER BY
          CASE WHEN lower(kv.title::text) LIKE '%' || lower($3) || '%' THEN 1 ELSE 0 END DESC,
          rank DESC, k.updated_at DESC, k.id
        LIMIT $5`,
      [this.#guildId, actorIdentityId, query, locale, limit],
    );
    return result.rows.map((row) => ({ ...summaryFromRow(row), body: row.body, rank: row.rank }));
  }

  async #loadKnowledgeRow(knowledgeId: string, forUpdate = false): Promise<KnowledgeRow> {
    const result = await this.#connection.query<KnowledgeRow>(
      `${this.#summarySelect()} WHERE k.guild_id = $1 AND k.id = $2${forUpdate ? " FOR UPDATE OF k" : ""}`,
      [this.#guildId, knowledgeId],
    );
    const row = result.rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Knowledge was not found.");
    return row;
  }

  async #notifyCanonicalReaders(row: KnowledgeRow, actorIdentityId: string): Promise<void> {
    await this.#connection.query(
      `WITH eligible_recipients AS (
         SELECT DISTINCT identity_row.id, identity_row.preferred_locale
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
           JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
          WHERE identity_row.guild_id = $1
            AND identity_row.id <> $8
            AND identity_row.kind = 'human'
            AND identity_row.status = 'active'
            AND membership_row.state IN ('preboarding', 'active')
            AND CASE $3::text
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END <= CASE membership_row.clearance
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END
            AND ($4::text NOT IN ('private', 'restricted')
              OR identity_row.id = $5 OR identity_row.id = ANY($6::uuid[]))
            AND (guild_row.root_owner_identity_id = identity_row.id OR EXISTS (
              SELECT 1 FROM role_bindings binding_row
              JOIN role_permissions permission_row
                ON permission_row.guild_id = binding_row.guild_id
               AND permission_row.role_id = binding_row.role_id
             WHERE binding_row.guild_id = identity_row.guild_id
               AND binding_row.identity_id = identity_row.id
               AND permission_row.permission = 'knowledge.read'
               AND (binding_row.space_id IS NULL
                 OR $2::uuid IS NOT NULL
                    AND guild_runtime.space_contains($1, binding_row.space_id, $2::uuid))
            ))
       )
       INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body,
          resource_type, resource_id, space_id, owner_identity_id, visibility,
          classification, allowed_identity_ids, deduplication_key)
       SELECT gen_random_uuid(), $1, recipient.id, 'knowledge_update',
              COALESCE($7::jsonb ->> recipient.preferred_locale, $7::jsonb ->> 'ja',
                       $7::jsonb ->> 'en', $7::jsonb ->> 'zh-CN', 'Knowledge updated'),
              '', 'knowledge', $9, $2, $5, $4, $3, $6::uuid[], $10
         FROM eligible_recipients recipient
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        this.#guildId,
        row.space_id,
        row.classification,
        row.visibility,
        row.owner_identity_id,
        row.allowed_identity_ids,
        JSON.stringify(row.title),
        actorIdentityId,
        row.id,
        `knowledge:${row.id}:v${row.current_version}`,
      ],
    );
  }

  async #loadVersion(knowledgeId: string, version: number): Promise<KnowledgeVersion> {
    const row = (await this.#connection.query<KnowledgeVersionRow>(
      `SELECT guild_id::text, knowledge_id::text, version, state, title, summary, body,
              source_ids::text[], created_by_identity_id::text, created_at::text
         FROM knowledge_versions
        WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3`,
      [this.#guildId, knowledgeId, version],
    )).rows[0];
    if (!row) throw new Error("Knowledge version was not found.");
    return versionFromRow(row);
  }

  async #insertVersion(
    knowledgeId: string,
    version: number,
    state: KnowledgeState,
    content: KnowledgeContentInput,
    actorIdentityId: string,
    changeNote: string,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO knowledge_versions
         (guild_id, knowledge_id, version, state, title, summary, body, source_ids,
          created_by_identity_id, change_note)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::uuid[], $9, $10)`,
      [
        this.#guildId,
        knowledgeId,
        version,
        state,
        JSON.stringify(content.title),
        JSON.stringify(content.summary),
        JSON.stringify(content.body),
        content.sourceIds,
        actorIdentityId,
        changeNote,
      ],
    );
  }

  async #copyVersionFiles(knowledgeId: string, fromVersion: number, toVersion: number): Promise<void> {
    await this.#connection.query(
      `INSERT INTO knowledge_version_files
         (guild_id, knowledge_id, knowledge_version, file_id, position)
       SELECT guild_id, knowledge_id, $4, file_id, position
         FROM knowledge_version_files
        WHERE guild_id = $1 AND knowledge_id = $2 AND knowledge_version = $3`,
      [this.#guildId, knowledgeId, fromVersion, toVersion],
    );
  }

  async #assertNoPendingFiles(knowledgeId: string, version: number): Promise<void> {
    const pending = await this.#connection.query<QueryResultRow>(
      `SELECT 1
         FROM knowledge_version_files link
         JOIN files f ON f.guild_id = link.guild_id AND f.id = link.file_id
        WHERE link.guild_id = $1 AND link.knowledge_id = $2
          AND link.knowledge_version = $3 AND f.status = 'pending'
        LIMIT 1`,
      [this.#guildId, knowledgeId, version],
    );
    if (pending.rows.length > 0) throw new Error("Finish or remove pending file uploads first.");
  }

  async #enqueueFileDeletion(
    fileId: string,
    r2Key: string,
  ): Promise<KnowledgeFileDeletion | null> {
    const outboxId = crypto.randomUUID();
    await this.#connection.query(
      `INSERT INTO outbox
         (id, guild_id, topic, payload, idempotency_key, status)
       VALUES ($1, $2, 'knowledge.file.delete', $3::jsonb, $4, 'pending')
       ON CONFLICT (guild_id, idempotency_key) DO NOTHING`,
      [
        outboxId,
        this.#guildId,
        JSON.stringify({ fileId, r2Key }),
        `knowledge-file-delete:${fileId}`,
      ],
    );
    const row = (await this.#connection.query<KnowledgeFileDeletionRow>(
      `SELECT id::text, payload, attempt_count
         FROM outbox
        WHERE guild_id = $1 AND idempotency_key = $2 AND status = 'pending'`,
      [this.#guildId, `knowledge-file-delete:${fileId}`],
    )).rows[0];
    return row ? fileDeletionFromRow(row) : null;
  }

  async #nextVersion(knowledgeId: string): Promise<number> {
    const result = await this.#connection.query<QueryResultRow & { next_version: number }>(
      `SELECT (COALESCE(max(version), 0) + 1)::integer AS next_version
         FROM knowledge_versions
        WHERE guild_id = $1 AND knowledge_id = $2`,
      [this.#guildId, knowledgeId],
    );
    const nextVersion = result.rows[0]?.next_version;
    if (!nextVersion || !Number.isSafeInteger(nextVersion)) {
      throw new Error("Could not allocate the next Knowledge version.");
    }
    return nextVersion;
  }

  async #setCurrentState(row: KnowledgeRow, nextState: KnowledgeState): Promise<void> {
    await this.#connection.query(
      `UPDATE knowledge_versions SET state = $4
        WHERE guild_id = $1 AND knowledge_id = $2 AND version = $3`,
      [this.#guildId, row.id, row.current_version, nextState],
    );
    await this.#connection.query(
      "UPDATE knowledge SET state = $3 WHERE guild_id = $1 AND id = $2",
      [this.#guildId, row.id, nextState],
    );
  }

  #summarySelect(): string {
    return `SELECT k.id::text, k.guild_id::text, k.space_id::text,
                   k.owner_identity_id::text, k.state, k.visibility, k.classification,
                   k.allowed_identity_ids::text[], k.current_version, k.canonical_version,
                   k.review_due_at::text, k.created_at::text, k.updated_at::text,
                   kv.title, kv.summary, kv.source_ids::text[],
                   kv.created_by_identity_id::text
              FROM knowledge k
              JOIN knowledge_versions kv
                ON kv.guild_id = k.guild_id AND kv.knowledge_id = k.id
               AND kv.version = k.current_version`;
  }

  #knowledgeAuthorizationCtes(): string {
    return `knowledge_actor AS (
              SELECT m.clearance,
                     g.root_owner_identity_id = i.id AS is_root
                FROM identities i
                JOIN memberships m
                  ON m.guild_id = i.guild_id AND m.identity_id = i.id
                JOIN guilds g ON g.id = i.guild_id
               WHERE i.guild_id = $1 AND i.id = $2 AND i.status = 'active'
                 AND m.state IN ('preboarding', 'active')
            ),
            knowledge_grants AS (
              SELECT rb.space_id
                FROM role_bindings rb
                JOIN role_permissions rp
                  ON rp.guild_id = rb.guild_id AND rp.role_id = rb.role_id
                CROSS JOIN knowledge_actor
               WHERE rb.guild_id = $1 AND rb.identity_id = $2
                 AND rp.permission = 'knowledge.read'
            ),
            knowledge_spaces AS (
              SELECT s.id
                FROM spaces s
                JOIN knowledge_grants grant_row ON grant_row.space_id = s.id
               WHERE s.guild_id = $1 AND s.status = 'active'
              UNION
              SELECT child.id
                FROM spaces child
                JOIN knowledge_spaces parent ON child.parent_space_id = parent.id
               WHERE child.guild_id = $1 AND child.status = 'active'
            ),
            knowledge_access AS (
              SELECT knowledge_actor.*,
                     EXISTS (
                       SELECT 1 FROM knowledge_grants WHERE space_id IS NULL
                     ) AS has_global_grant
                FROM knowledge_actor
            )`;
  }

  #knowledgeReadPredicate(): string {
    return `(access.is_root OR access.has_global_grant OR (
              k.space_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM knowledge_spaces permitted WHERE permitted.id = k.space_id
              )
            ))
            AND CASE k.classification
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END <= CASE access.clearance
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END
            AND (k.visibility NOT IN ('private', 'restricted')
              OR k.owner_identity_id = $2 OR $2::uuid = ANY(k.allowed_identity_ids))`;
  }

  #assertContent(input: KnowledgeContentInput & { changeNote: string }): void {
    assertKnowledgeContent(input.title, input.summary, input.body);
    assertNonBlank(input.changeNote, "Knowledge change note", 2_000);
    if (!Array.isArray(input.sourceIds) || new Set(input.sourceIds).size !== input.sourceIds.length) {
      throw new GuildDomainError("INVALID_INPUT", "Knowledge sources must contain unique IDs.");
    }
  }

  #assertExpectedVersion(row: KnowledgeRow, expectedVersion: number): void {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
        row.current_version !== expectedVersion) {
      throw new Error("Knowledge changed since it was loaded. Reload before continuing.");
    }
  }

  #assertEvent(event: ChronicleEvent, actorIdentityId: string): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId) {
      throw new Error("Knowledge event crosses the active Guild or actor boundary.");
    }
  }
}
