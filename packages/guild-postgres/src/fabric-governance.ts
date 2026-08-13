import {
  assertActivityType,
  assertDecisionMethod,
  assertMemoryType,
  assertNonBlank,
  authorize,
  type ActivityType,
  type AppLocale,
  type ChronicleEvent,
  type Classification,
  type DecisionMethod,
  type MemoryType,
  type Permission,
  type SecuredResource,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { loadActorAuthorizationSnapshot } from "./actor-authorization.js";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export interface AuditStamp {
  id: string;
  correlationId: string;
  occurredAt: string;
}

interface DestinationBoundary {
  draftId: string;
  spaceId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
}

export interface MemoryPromotionDestination extends DestinationBoundary {
  kind: "memory";
  locale: AppLocale;
  memoryType: MemoryType;
  title: string;
  summary: string;
}

export interface ActivityPromotionDestination extends DestinationBoundary {
  kind: "activity";
  activityType: ActivityType;
  title: string;
  assigneeActorId: string | null;
}

export interface DecisionPromotionDestination extends DestinationBoundary {
  kind: "decision";
  method: DecisionMethod;
  title: string;
  rationale: string;
}

export interface HandoverPromotionDestination {
  kind: "handover";
  draftId: string;
  departingActorId: string;
  successorActorId: string | null;
}

export type PrivateMessagePromotionDestination =
  | MemoryPromotionDestination
  | ActivityPromotionDestination
  | DecisionPromotionDestination
  | HandoverPromotionDestination;

export interface PromotePrivateMessageInput {
  id: string;
  actorId: string;
  threadId: string;
  sourceMessageId: string;
  selectionStart: number;
  selectionLength: number;
  idempotencyKey: string;
  destination: PrivateMessagePromotionDestination;
  audit: AuditStamp;
}

export interface PrivateMessagePromotion {
  id: string;
  guildId: string;
  threadId: string;
  sourceMessageId: string;
  promotedByActorId: string;
  selectionStart: number;
  selectionLength: number;
  sourceSha256: string;
  destinationKind: PrivateMessagePromotionDestination["kind"];
  destinationDraftId: string;
  idempotencyKey: string;
  chronicleEventId: string;
  createdAt: string;
  idempotentReplay: boolean;
}

export interface RequestContributionCorrectionInput {
  id: string;
  actorId: string;
  evidenceEventId: string;
  reason: string;
  audit: AuditStamp;
}

export interface ReviewContributionCorrectionInput {
  requestId: string;
  reviewerActorId: string;
  expectedVersion: number;
  outcome: "accepted" | "rejected";
  reason: string;
  audit: AuditStamp;
}

export interface GovernedContributionCorrection {
  id: string;
  guildId: string;
  subjectActorId: string;
  requestedByActorId: string;
  evidenceEventId: string;
  evidenceSha256: string;
  reason: string;
  status: "pending" | "accepted" | "rejected";
  reviewedByActorId: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  version: number;
  requestChronicleEventId: string;
  resolutionChronicleEventId: string | null;
  createdAt: string;
}

type PromotionRow = QueryResultRow & {
  id: string;
  guild_id: string;
  thread_id: string;
  source_message_id: string;
  promoted_by_actor_id: string;
  selection_start: number;
  selection_length: number;
  source_sha256: string;
  destination_kind: PrivateMessagePromotionDestination["kind"];
  destination_draft_id: string;
  idempotency_key: string;
  request_sha256: string | null;
  chronicle_event_id: string;
  created_at: string;
};

type SourceSelectionRow = QueryResultRow & {
  thread_space_id: string | null;
  thread_owner_actor_id: string;
  classification: Classification;
  participant_actor_ids: string[];
  selected_content: string;
  source_sha256: string;
};

type EvidenceRow = QueryResultRow & {
  id: string;
  actor_identity_id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  evidence_sha256: string;
};

type CorrectionRow = QueryResultRow & {
  id: string;
  guild_id: string;
  subject_actor_id: string;
  requested_by_actor_id: string;
  chronicle_event_id: string;
  evidence_sha256: string;
  reason: string;
  status: GovernedContributionCorrection["status"];
  reviewed_by_actor_id: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  version: number;
  request_chronicle_event_id: string;
  resolution_chronicle_event_id: string | null;
  created_at: string;
};

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertAudit(audit: AuditStamp): void {
  assertUuid(audit.id, "Audit event ID");
  assertUuid(audit.correlationId, "Audit correlation ID");
  if (Number.isNaN(new Date(audit.occurredAt).valueOf())) {
    throw new Error("Audit occurrence time is invalid.");
  }
}

function assertSecurityBoundary(boundary: DestinationBoundary): void {
  assertUuid(boundary.draftId, "Destination draft ID");
  if (boundary.spaceId !== null) assertUuid(boundary.spaceId, "Destination Space ID");
  if (boundary.allowedActorIds.length > 100 ||
      new Set(boundary.allowedActorIds).size !== boundary.allowedActorIds.length) {
    throw new Error("Destination Actor grants must contain at most 100 unique IDs.");
  }
  for (const actorId of boundary.allowedActorIds) assertUuid(actorId, "Allowed Actor ID");
}

function iso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return parsed.toISOString();
}

function optionalIso(value: string | null): string | null {
  return value === null ? null : iso(value);
}

async function requestSha256(input: PromotePrivateMessageInput): Promise<string> {
  const destination = input.destination.kind === "memory"
    ? {
        kind: input.destination.kind,
        spaceId: input.destination.spaceId,
        visibility: input.destination.visibility,
        classification: input.destination.classification,
        allowedActorIds: [...input.destination.allowedActorIds].sort(),
        locale: input.destination.locale,
        memoryType: input.destination.memoryType,
        title: input.destination.title,
        summary: input.destination.summary,
      }
    : input.destination.kind === "activity"
      ? {
          kind: input.destination.kind,
          spaceId: input.destination.spaceId,
          visibility: input.destination.visibility,
          classification: input.destination.classification,
          allowedActorIds: [...input.destination.allowedActorIds].sort(),
          activityType: input.destination.activityType,
          title: input.destination.title,
          assigneeActorId: input.destination.assigneeActorId,
        }
      : input.destination.kind === "decision"
        ? {
            kind: input.destination.kind,
            spaceId: input.destination.spaceId,
            visibility: input.destination.visibility,
            classification: input.destination.classification,
            allowedActorIds: [...input.destination.allowedActorIds].sort(),
            method: input.destination.method,
            title: input.destination.title,
            rationale: input.destination.rationale,
          }
        : {
            kind: input.destination.kind,
            departingActorId: input.destination.departingActorId,
            successorActorId: input.destination.successorActorId,
          };
  const canonical = JSON.stringify({
    threadId: input.threadId,
    sourceMessageId: input.sourceMessageId,
    selectionStart: input.selectionStart,
    selectionLength: input.selectionLength,
    destination,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function promotionFrom(row: PromotionRow, idempotentReplay: boolean): PrivateMessagePromotion {
  return {
    id: row.id,
    guildId: row.guild_id,
    threadId: row.thread_id,
    sourceMessageId: row.source_message_id,
    promotedByActorId: row.promoted_by_actor_id,
    selectionStart: row.selection_start,
    selectionLength: row.selection_length,
    sourceSha256: row.source_sha256,
    destinationKind: row.destination_kind,
    destinationDraftId: row.destination_draft_id,
    idempotencyKey: row.idempotency_key,
    chronicleEventId: row.chronicle_event_id,
    createdAt: iso(row.created_at),
    idempotentReplay,
  };
}

function correctionFrom(row: CorrectionRow): GovernedContributionCorrection {
  return {
    id: row.id,
    guildId: row.guild_id,
    subjectActorId: row.subject_actor_id,
    requestedByActorId: row.requested_by_actor_id,
    evidenceEventId: row.chronicle_event_id,
    evidenceSha256: row.evidence_sha256,
    reason: row.reason,
    status: row.status,
    reviewedByActorId: row.reviewed_by_actor_id,
    reviewReason: row.review_reason,
    reviewedAt: optionalIso(row.reviewed_at),
    version: row.version,
    requestChronicleEventId: row.request_chronicle_event_id,
    resolutionChronicleEventId: row.resolution_chronicle_event_id,
    createdAt: iso(row.created_at),
  };
}

export class GuildFabricGovernanceRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    assertUuid(guildId, "Guild ID");
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async promotePrivateMessage(input: PromotePrivateMessageInput): Promise<PrivateMessagePromotion> {
    this.#assertPromotionInput(input);
    await this.#assertCurrentActor(input.actorId);
    await this.#connection.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`private-message-promotion:${this.#guildId}:${input.actorId}:${input.idempotencyKey}`],
    );

    const [source, requestFingerprint] = await Promise.all([
      this.#loadSourceSelection(input),
      requestSha256(input),
    ]);
    await this.#authorizeSource(input.actorId, input.threadId, source);
    await this.#authorizeDestination(input.actorId, input.destination);

    const existing = (await this.#connection.query<PromotionRow>(
      `${this.#promotionSelect()}
        WHERE promotion.guild_id = $1
          AND promotion.promoted_by_actor_id = $2
          AND promotion.idempotency_key = $3`,
      [this.#guildId, input.actorId, input.idempotencyKey],
    )).rows[0];
    if (existing) {
      if (existing.thread_id !== input.threadId ||
          existing.source_message_id !== input.sourceMessageId ||
          existing.selection_start !== input.selectionStart ||
          existing.selection_length !== input.selectionLength ||
          existing.destination_kind !== input.destination.kind ||
          existing.request_sha256 !== null && existing.request_sha256 !== requestFingerprint) {
        throw new Error("The idempotency key is already bound to another private-message promotion.");
      }
      return promotionFrom(existing, true);
    }

    await this.#createDestination(input.actorId, input.sourceMessageId, source, input.destination);
    const row = (await this.#connection.query<PromotionRow>(
      `INSERT INTO private_message_promotions
         (id, guild_id, thread_id, source_message_id, promoted_by_actor_id,
          selection_start, selection_length, source_sha256, destination_kind,
          destination_draft_id, idempotency_key, request_sha256, chronicle_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id::text, guild_id::text, thread_id::text, source_message_id::text,
                 promoted_by_actor_id::text, selection_start, selection_length,
                 source_sha256, destination_kind, destination_draft_id::text,
                 idempotency_key, request_sha256, chronicle_event_id::text, created_at::text`,
      [
        input.id,
        this.#guildId,
        input.threadId,
        input.sourceMessageId,
        input.actorId,
        input.selectionStart,
        input.selectionLength,
        source.source_sha256,
        input.destination.kind,
        input.destination.draftId,
        input.idempotencyKey,
        requestFingerprint,
        input.audit.id,
      ],
    )).rows[0];
    if (!row) throw new Error("Private-message promotion was not created.");

    await this.#chronicle.appendChronicle(this.#promotionEvent(input, source));
    return promotionFrom(row, false);
  }

  async listPrivateMessagePromotions(
    actorId: string,
    threadId: string,
  ): Promise<readonly PrivateMessagePromotion[]> {
    assertUuid(actorId, "Actor ID");
    assertUuid(threadId, "Private thread ID");
    await this.#assertCurrentActor(actorId);
    return (await this.#connection.query<PromotionRow>(
      `${this.#promotionSelect()}
        WHERE promotion.guild_id = $1 AND promotion.thread_id = $2
        ORDER BY promotion.created_at, promotion.id`,
      [this.#guildId, threadId],
    )).rows.map((row) => promotionFrom(row, false));
  }

  async requestContributionCorrection(
    input: RequestContributionCorrectionInput,
  ): Promise<GovernedContributionCorrection> {
    assertUuid(input.id, "Contribution correction ID");
    assertUuid(input.actorId, "Actor ID");
    assertUuid(input.evidenceEventId, "Evidence event ID");
    assertNonBlank(input.reason, "Correction reason", 5_000);
    assertAudit(input.audit);
    await this.#assertCurrentActor(input.actorId);

    const evidence = await this.#loadEvidence(input.evidenceEventId, input.actorId);
    await this.#authorizeContribution(input.actorId, "contribution.correct", evidence);

    const row = (await this.#connection.query<CorrectionRow>(
      `INSERT INTO contribution_correction_requests
         (id, guild_id, subject_actor_id, requested_by_actor_id,
          chronicle_event_id, evidence_sha256, reason, status, version,
          request_chronicle_event_id)
       VALUES ($1, $2, $3, $3, $4, $5, $6, 'pending', 1, $7)
       RETURNING ${this.#correctionColumns()}`,
      [
        input.id,
        this.#guildId,
        input.actorId,
        input.evidenceEventId,
        evidence.evidence_sha256,
        input.reason,
        input.audit.id,
      ],
    )).rows[0];
    if (!row) throw new Error("Contribution correction request was not created.");

    await this.#chronicle.appendChronicle(this.#correctionEvent(
      input.audit,
      input.actorId,
      input.id,
      "contribution.correction.requested",
      evidence,
      {
        evidenceEventId: input.evidenceEventId,
        evidenceDigest: evidence.evidence_sha256,
        originalEventPreserved: true,
      },
    ));
    return correctionFrom(row);
  }

  async listOwnContributionCorrections(
    actorId: string,
  ): Promise<readonly GovernedContributionCorrection[]> {
    assertUuid(actorId, "Actor ID");
    await this.#assertCurrentActor(actorId);
    return (await this.#connection.query<CorrectionRow>(
      `SELECT ${this.#correctionColumns()}
         FROM contribution_correction_requests
        WHERE guild_id = $1 AND requested_by_actor_id = $2
        ORDER BY created_at DESC, id DESC`,
      [this.#guildId, actorId],
    )).rows.map(correctionFrom);
  }

  async listPendingContributionCorrections(
    managerActorId: string,
  ): Promise<readonly GovernedContributionCorrection[]> {
    assertUuid(managerActorId, "Manager Actor ID");
    await this.#assertCurrentActor(managerActorId);
    return (await this.#connection.query<CorrectionRow>(
      `SELECT ${this.#correctionColumns()}
         FROM contribution_correction_requests
        WHERE guild_id = $1 AND status = 'pending'
        ORDER BY created_at, id`,
      [this.#guildId],
    )).rows.map(correctionFrom);
  }

  async reviewContributionCorrection(
    input: ReviewContributionCorrectionInput,
  ): Promise<GovernedContributionCorrection> {
    assertUuid(input.requestId, "Contribution correction ID");
    assertUuid(input.reviewerActorId, "Reviewer Actor ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Expected Contribution correction version is invalid.");
    }
    assertNonBlank(input.reason, "Review reason", 5_000);
    assertAudit(input.audit);
    await this.#assertCurrentActor(input.reviewerActorId);

    const existing = (await this.#connection.query<CorrectionRow>(
      `SELECT ${this.#correctionColumns()}
         FROM contribution_correction_requests
        WHERE guild_id = $1 AND id = $2
        FOR UPDATE`,
      [this.#guildId, input.requestId],
    )).rows[0];
    if (!existing) throw new Error("Contribution correction was not found or is not reviewable.");
    if (existing.status !== "pending") throw new Error("Contribution correction was already reviewed.");
    if (existing.version !== input.expectedVersion) {
      throw new Error("Contribution correction changed since it was loaded.");
    }

    const evidence = await this.#loadEvidence(existing.chronicle_event_id, existing.subject_actor_id);
    await this.#authorizeContribution(
      input.reviewerActorId,
      "contribution.correct",
      evidence,
      false,
    );
    await this.#authorizeContribution(input.reviewerActorId, "actor.manage", evidence, false);

    const row = (await this.#connection.query<CorrectionRow>(
      `UPDATE contribution_correction_requests
          SET status = $3, reviewed_by_actor_id = $4, review_reason = $5,
              reviewed_at = statement_timestamp(), version = version + 1,
              resolution_chronicle_event_id = $6
        WHERE guild_id = $1 AND id = $2 AND status = 'pending' AND version = $7
        RETURNING ${this.#correctionColumns()}`,
      [
        this.#guildId,
        input.requestId,
        input.outcome,
        input.reviewerActorId,
        input.reason,
        input.audit.id,
        input.expectedVersion,
      ],
    )).rows[0];
    if (!row) throw new Error("Contribution correction changed before review was saved.");

    await this.#chronicle.appendChronicle(this.#correctionEvent(
      input.audit,
      input.reviewerActorId,
      input.requestId,
      `contribution.correction.${input.outcome}`,
      evidence,
      {
        evidenceEventId: existing.chronicle_event_id,
        evidenceDigest: existing.evidence_sha256,
        outcome: input.outcome,
        originalEventPreserved: true,
      },
    ));
    return correctionFrom(row);
  }

  async #loadSourceSelection(input: PromotePrivateMessageInput): Promise<SourceSelectionRow> {
    const row = (await this.#connection.query<SourceSelectionRow>(
      `SELECT thread.space_id::text AS thread_space_id,
              thread.created_by_actor_id::text AS thread_owner_actor_id,
              thread.classification,
              ARRAY(
                SELECT participant.actor_id::text
                  FROM private_thread_participants participant
                 WHERE participant.guild_id = thread.guild_id
                   AND participant.thread_id = thread.id
                   AND participant.state = 'active'
                 ORDER BY participant.actor_id
              ) AS participant_actor_ids,
              substring(message.body FROM $5 + 1 FOR $6) AS selected_content,
              guild_runtime.private_message_selection_sha256($1, message.id, $5, $6)
                AS source_sha256
         FROM private_messages message
         JOIN private_threads thread
           ON thread.guild_id = message.guild_id AND thread.id = message.thread_id
         JOIN private_thread_participants participant
           ON participant.guild_id = message.guild_id
          AND participant.thread_id = message.thread_id
          AND participant.actor_id = $4
          AND participant.state = 'active'
         JOIN actor_memberships membership
           ON membership.guild_id = participant.guild_id
          AND membership.actor_id = participant.actor_id
          AND membership.state = 'active'
          AND membership.operational = true
        WHERE message.guild_id = $1
          AND message.thread_id = $2
          AND message.id = $3
          AND message.state = 'active'
          AND $5 >= 0 AND $6 > 0
          AND $5 + $6 <= char_length(message.body)`,
      [
        this.#guildId,
        input.threadId,
        input.sourceMessageId,
        input.actorId,
        input.selectionStart,
        input.selectionLength,
      ],
    )).rows[0];
    if (!row) {
      throw new Error("Private message selection is unavailable to the current participant.");
    }
    assertNonBlank(row.selected_content, "Selected private-message content", 20_000);
    return row;
  }

  async #loadEvidence(eventId: string, subjectActorId: string): Promise<EvidenceRow> {
    const row = (await this.#connection.query<EvidenceRow>(
      `SELECT event.id::text, event.actor_identity_id::text,
              event.space_id::text, event.owner_identity_id::text,
              event.visibility, event.classification, event.allowed_identity_ids,
              guild_runtime.chronicle_event_sha256(event.guild_id, event.id) AS evidence_sha256
         FROM chronicle_events event
        WHERE event.guild_id = $1 AND event.id = $2
          AND event.actor_identity_id = $3`,
      [this.#guildId, eventId, subjectActorId],
    )).rows[0];
    if (!row) throw new Error("Contribution evidence was not found for the subject Actor.");
    return row;
  }

  async #authorizeSource(
    actorId: string,
    threadId: string,
    source: SourceSelectionRow,
  ): Promise<void> {
    const snapshot = await loadActorAuthorizationSnapshot(
      this.#connection,
      this.#guildId,
      actorId,
      source.thread_space_id,
    );
    authorize(snapshot, {
      actorIdentityId: actorId,
      permission: "message.read",
      resource: {
        id: threadId,
        guildId: this.#guildId,
        spaceId: source.thread_space_id,
        ownerIdentityId: source.thread_owner_actor_id,
        visibility: "private",
        classification: source.classification,
        allowedIdentityIds: source.participant_actor_ids,
      },
    });
  }

  async #authorizeDestination(
    actorId: string,
    destination: PrivateMessagePromotionDestination,
  ): Promise<void> {
    const permission = this.#destinationPermission(destination.kind);
    const spaceId = destination.kind === "handover" ? null : destination.spaceId;
    const snapshot = await loadActorAuthorizationSnapshot(
      this.#connection,
      this.#guildId,
      actorId,
      spaceId,
    );
    const resource = destination.kind === "handover" ? undefined : {
      id: destination.draftId,
      guildId: this.#guildId,
      spaceId: destination.spaceId,
      ownerIdentityId: actorId,
      visibility: destination.visibility,
      classification: destination.classification,
      allowedIdentityIds: destination.allowedActorIds,
    } satisfies SecuredResource;
    authorize(snapshot, {
      actorIdentityId: actorId,
      permission,
      ...(resource ? { resource } : {}),
    });
  }

  async #authorizeContribution(
    actorId: string,
    permission: "contribution.correct" | "actor.manage",
    evidence: EvidenceRow,
    enforceEvidenceVisibility = true,
  ): Promise<void> {
    const snapshot = await loadActorAuthorizationSnapshot(
      this.#connection,
      this.#guildId,
      actorId,
      evidence.space_id,
    );
    authorize(snapshot, {
      actorIdentityId: actorId,
      permission,
      resource: {
        id: evidence.id,
        guildId: this.#guildId,
        spaceId: evidence.space_id,
        ownerIdentityId: evidence.owner_identity_id,
        // A manager reviews the correction record and its digest, not the private evidence body.
        visibility: enforceEvidenceVisibility ? evidence.visibility : "space",
        classification: evidence.classification,
        allowedIdentityIds: enforceEvidenceVisibility ? evidence.allowed_identity_ids : [],
      },
    });
  }

  async #createDestination(
    actorId: string,
    sourceMessageId: string,
    source: SourceSelectionRow,
    destination: PrivateMessagePromotionDestination,
  ): Promise<void> {
    if (destination.kind === "memory") {
      const title = { [destination.locale]: destination.title };
      const summary = { [destination.locale]: destination.summary };
      const body = { [destination.locale]: source.selected_content };
      await this.#connection.query(
        `INSERT INTO memories
           (id, guild_id, space_id, owner_actor_id, creator_actor_id, type, status,
            workflow, governance_state, visibility, classification, allowed_actor_ids,
            current_version, source_ids, provenance)
         VALUES ($1, $2, $3, $4, $4, $5, 'active', 'canonical', 'draft',
                 $6, $7, $8::uuid[], 1, ARRAY[$9::uuid],
                 jsonb_build_object('origin', 'private-message-promotion',
                                    'sourceDigest', $10::text))`,
        [
          destination.draftId,
          this.#guildId,
          destination.spaceId,
          actorId,
          destination.memoryType,
          destination.visibility,
          destination.classification,
          destination.allowedActorIds,
          sourceMessageId,
          source.source_sha256,
        ],
      );
      await this.#connection.query(
        `INSERT INTO memory_versions
           (guild_id, memory_id, version, title, summary, body, source_ids,
            change_note, created_by_actor_id)
         VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb, ARRAY[$6::uuid],
                 'Promoted explicitly from a private message selection.', $7)`,
        [
          this.#guildId,
          destination.draftId,
          JSON.stringify(title),
          JSON.stringify(summary),
          JSON.stringify(body),
          sourceMessageId,
          actorId,
        ],
      );
      return;
    }

    if (destination.kind === "activity") {
      if (source.selected_content.length > 10_000) {
        throw new Error("An Activity promotion selection cannot exceed 10,000 characters.");
      }
      await this.#connection.query(
        `INSERT INTO activities
           (id, guild_id, parent_activity_id, space_id, owner_actor_id,
            creator_actor_id, assignee_actor_id, type, title, description, status,
            visibility, classification, allowed_actor_ids, source_ids, position, version)
         VALUES ($1, $2, NULL, $3, $4, $4, $5, $6, $7, $8, 'proposed',
                 $9, $10, $11::uuid[], ARRAY[$12::uuid], 0, 1)`,
        [
          destination.draftId,
          this.#guildId,
          destination.spaceId,
          actorId,
          destination.assigneeActorId,
          destination.activityType,
          destination.title,
          source.selected_content,
          destination.visibility,
          destination.classification,
          destination.allowedActorIds,
          sourceMessageId,
        ],
      );
      return;
    }

    if (destination.kind === "decision") {
      if (source.selected_content.length > 10_000) {
        throw new Error("A Decision promotion selection cannot exceed 10,000 characters.");
      }
      await this.#connection.query(
        `INSERT INTO decisions
           (id, guild_id, space_id, proposer_identity_id, owner_identity_id,
            method, title, description, status, rationale, visibility,
            classification, allowed_identity_ids, source_ids, version)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 'draft', $8, $9, $10,
                 $11::uuid[], ARRAY[$12::uuid], 1)`,
        [
          destination.draftId,
          this.#guildId,
          destination.spaceId,
          actorId,
          destination.method,
          destination.title,
          source.selected_content,
          destination.rationale,
          destination.visibility,
          destination.classification,
          destination.allowedActorIds,
          sourceMessageId,
        ],
      );
      return;
    }

    if (source.selected_content.length > 5_000) {
      throw new Error("A Handover promotion selection cannot exceed 5,000 characters.");
    }
    await this.#connection.query(
      `INSERT INTO handover_cases
         (id, guild_id, departing_actor_id, successor_actor_id,
          initiated_by_actor_id, reason, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 1)`,
      [
        destination.draftId,
        this.#guildId,
        destination.departingActorId,
        destination.successorActorId,
        actorId,
        source.selected_content,
      ],
    );
  }

  #promotionEvent(
    input: PromotePrivateMessageInput,
    source: SourceSelectionRow,
  ): ChronicleEvent {
    return {
      id: input.audit.id,
      guildId: this.#guildId,
      spaceId: source.thread_space_id,
      ownerIdentityId: input.actorId,
      visibility: "restricted",
      classification: source.classification,
      allowedIdentityIds: source.participant_actor_ids,
      actorIdentityId: input.actorId,
      action: "private_message.promoted",
      subjectType: "private_message_promotion",
      subjectId: input.id,
      correlationId: input.audit.correlationId,
      occurredAt: input.audit.occurredAt,
      details: {
        sourceDigest: source.source_sha256,
        destinationKind: input.destination.kind,
        destinationDraftId: input.destination.draftId,
        plaintextRecorded: false,
      },
    };
  }

  #correctionEvent(
    audit: AuditStamp,
    actorId: string,
    requestId: string,
    action: string,
    evidence: EvidenceRow,
    details: ChronicleEvent["details"],
  ): ChronicleEvent {
    return {
      id: audit.id,
      guildId: this.#guildId,
      spaceId: evidence.space_id,
      ownerIdentityId: evidence.owner_identity_id,
      visibility: evidence.visibility,
      classification: evidence.classification,
      allowedIdentityIds: evidence.allowed_identity_ids,
      actorIdentityId: actorId,
      action,
      subjectType: "contribution_correction",
      subjectId: requestId,
      correlationId: audit.correlationId,
      occurredAt: audit.occurredAt,
      details,
    };
  }

  #assertPromotionInput(input: PromotePrivateMessageInput): void {
    assertUuid(input.id, "Private-message promotion ID");
    assertUuid(input.actorId, "Actor ID");
    assertUuid(input.threadId, "Private thread ID");
    assertUuid(input.sourceMessageId, "Private message ID");
    if (!Number.isSafeInteger(input.selectionStart) || input.selectionStart < 0 ||
        !Number.isSafeInteger(input.selectionLength) ||
        input.selectionLength < 1 || input.selectionLength > 20_000) {
      throw new Error("Private-message selection range is invalid.");
    }
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
      throw new Error("Private-message promotion idempotency key is invalid.");
    }
    assertAudit(input.audit);

    if (input.destination.kind === "handover") {
      assertUuid(input.destination.draftId, "Handover draft ID");
      assertUuid(input.destination.departingActorId, "Departing Actor ID");
      if (input.destination.successorActorId !== null) {
        assertUuid(input.destination.successorActorId, "Successor Actor ID");
      }
      return;
    }

    assertSecurityBoundary(input.destination);
    assertNonBlank(input.destination.title, "Destination title", 200);
    if (input.destination.kind === "memory") {
      assertMemoryType(input.destination.memoryType);
      assertNonBlank(input.destination.summary, "Memory summary", 2_000);
    } else if (input.destination.kind === "activity") {
      assertActivityType(input.destination.activityType);
      if (input.destination.assigneeActorId !== null) {
        assertUuid(input.destination.assigneeActorId, "Activity assignee Actor ID");
      }
    } else {
      assertDecisionMethod(input.destination.method);
      if (input.destination.rationale.length > 10_000) {
        throw new Error("Decision rationale cannot exceed 10,000 characters.");
      }
    }
  }

  async #assertCurrentActor(actorId: string): Promise<void> {
    const row = (await this.#connection.query<QueryResultRow & { actor_id: string | null }>(
      "SELECT guild_runtime.current_actor_id()::text AS actor_id",
    )).rows[0];
    if (row?.actor_id !== actorId) {
      throw new Error("Repository Actor does not match the authenticated transaction Actor.");
    }
  }

  #destinationPermission(kind: PrivateMessagePromotionDestination["kind"]): Permission {
    switch (kind) {
      case "memory": return "memory.create";
      case "activity": return "activity.create";
      case "decision": return "decision.propose";
      case "handover": return "lifecycle.manage";
    }
  }

  #promotionSelect(): string {
    return `SELECT promotion.id::text, promotion.guild_id::text,
                   promotion.thread_id::text, promotion.source_message_id::text,
                   promotion.promoted_by_actor_id::text, promotion.selection_start,
                   promotion.selection_length, promotion.source_sha256,
                   promotion.destination_kind, promotion.destination_draft_id::text,
            promotion.idempotency_key, promotion.request_sha256,
            promotion.chronicle_event_id::text,
                   promotion.created_at::text
              FROM private_message_promotions promotion`;
  }

  #correctionColumns(): string {
    return `id::text, guild_id::text, subject_actor_id::text,
            requested_by_actor_id::text, chronicle_event_id::text,
            evidence_sha256, reason, status, reviewed_by_actor_id::text,
            review_reason, reviewed_at::text, version,
            request_chronicle_event_id::text,
            resolution_chronicle_event_id::text, created_at::text`;
  }
}
