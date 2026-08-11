import {
  GuildDomainError,
  assertDecisionContent,
  assertDecisionOptions,
  assertDecisionTransition,
  type ChronicleEvent,
  type Classification,
  type Decision,
  type DecisionApproval,
  type DecisionOption,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface DecisionListCursor {
  updatedAt: string;
  id: string;
}

export interface DecisionListPage {
  items: readonly Decision[];
  nextCursor: DecisionListCursor | null;
}

export interface DecisionOptionWrite {
  id: string;
  label: string;
  description: string;
  position: number;
}

interface DecisionContentInput {
  spaceId: string | null;
  title: string;
  description: string;
  rationale: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  sourceIds: readonly string[];
  reviewAt: string | null;
  options: readonly DecisionOptionWrite[];
}

export interface CreateDecisionInput extends DecisionContentInput {
  id: string;
  actorIdentityId: string;
  ownerIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface SaveDecisionDraftInput extends DecisionContentInput {
  id: string;
  expectedVersion: number;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ProposeDecisionInput {
  id: string;
  expectedVersion: number;
  actorIdentityId: string;
  requiredApprovals: number;
  chronicleEvent: ChronicleEvent;
}

export interface ReviewDecisionInput {
  id: string;
  expectedVersion: number;
  actorIdentityId: string;
  verdict: "approve" | "reject";
  selectedOptionId: string | null;
  reason: string;
  chronicleEvent: ChronicleEvent;
}

export interface ReviewDecisionResult {
  version: number;
  status: "proposed" | "approved" | "rejected";
  approvalCount: number;
}

export interface SupersedeDecisionInput {
  id: string;
  replacementDecisionId: string;
  expectedVersion: number;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface DecisionDetail {
  decision: Decision;
  options: readonly DecisionOption[];
  approvals: readonly DecisionApproval[];
}

type DecisionRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  proposer_identity_id: string;
  owner_identity_id: string;
  title: string;
  description: string;
  rationale: string;
  status: Decision["status"];
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  source_ids: string[];
  required_approvals: number;
  approval_count: number;
  selected_option_id: string | null;
  review_at: string | null;
  decided_at: string | null;
  superseded_by_decision_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type DecisionOptionRow = QueryResultRow & {
  id: string;
  guild_id: string;
  decision_id: string;
  label: string;
  description: string;
  position: number;
};

type DecisionApprovalRow = QueryResultRow & {
  guild_id: string;
  decision_id: string;
  approver_identity_id: string;
  verdict: "approve" | "reject";
  selected_option_id: string | null;
  reason: string;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Database contains an invalid Decision timestamp.");
  return parsed.toISOString();
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function decisionFromRow(row: DecisionRow): Decision {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    proposerIdentityId: row.proposer_identity_id,
    ownerIdentityId: row.owner_identity_id,
    title: row.title,
    description: row.description,
    rationale: row.rationale,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    sourceIds: row.source_ids,
    requiredApprovals: row.required_approvals,
    approvalCount: row.approval_count,
    selectedOptionId: row.selected_option_id,
    reviewAt: optionalTimestamp(row.review_at),
    decidedAt: optionalTimestamp(row.decided_at),
    supersededByDecisionId: row.superseded_by_decision_id,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function approvalFromRow(row: DecisionApprovalRow): DecisionApproval {
  return {
    guildId: row.guild_id,
    decisionId: row.decision_id,
    approverIdentityId: row.approver_identity_id,
    verdict: row.verdict,
    selectedOptionId: row.selected_option_id,
    reason: row.reason,
    createdAt: isoTimestamp(row.created_at),
  };
}

function assertPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Decision page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

export class GuildDecisionRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listDecisions(
    actorIdentityId: string,
    cursor: DecisionListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<DecisionListPage> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<DecisionRow>(
      `WITH RECURSIVE ${this.#authorizationCtes()}
       ${this.#decisionSelect()}
       CROSS JOIN decision_access access
       WHERE d.guild_id = $1 AND ${this.#readPredicate("d")}
         AND ($3::timestamptz IS NULL OR (d.updated_at, d.id) < ($3::timestamptz, $4::uuid))
       ORDER BY d.updated_at DESC, d.id DESC LIMIT $5`,
      [this.#guildId, actorIdentityId, cursor?.updatedAt ?? null, cursor?.id ?? null, pageSize + 1],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(decisionFromRow),
      nextCursor: rows.length > pageSize && last
        ? { updatedAt: isoTimestamp(last.updated_at), id: last.id }
        : null,
    };
  }

  async getDecision(id: string, forUpdate = false): Promise<Decision> {
    const row = (await this.#connection.query<DecisionRow>(
      `${this.#decisionSelect()} WHERE d.guild_id = $1 AND d.id = $2${forUpdate ? " FOR UPDATE OF d" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Decision was not found.");
    return decisionFromRow(row);
  }

  async getDetail(id: string): Promise<DecisionDetail> {
    const decision = await this.getDecision(id);
    const options = (await this.#connection.query<DecisionOptionRow>(
      `SELECT id::text, guild_id::text, decision_id::text, label, description, position
         FROM decision_options
        WHERE guild_id = $1 AND decision_id = $2
        ORDER BY position, id`,
      [this.#guildId, id],
    )).rows.map((row): DecisionOption => ({
      id: row.id,
      guildId: row.guild_id,
      decisionId: row.decision_id,
      label: row.label,
      description: row.description,
      position: row.position,
      selected: row.id === decision.selectedOptionId,
    }));
    const approvals = (await this.#connection.query<DecisionApprovalRow>(
      `SELECT guild_id::text, decision_id::text, approver_identity_id::text,
              verdict, selected_option_id::text, reason, created_at::text
         FROM decision_approvals
        WHERE guild_id = $1 AND decision_id = $2
        ORDER BY created_at, approver_identity_id`,
      [this.#guildId, id],
    )).rows.map(approvalFromRow);
    return { decision, options, approvals };
  }

  async createDecision(input: CreateDecisionInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id);
    this.#assertContent(input);
    await this.#connection.query(
      `INSERT INTO decisions
         (id, guild_id, space_id, proposer_identity_id, owner_identity_id,
          title, description, status, rationale, review_at, visibility,
          classification, allowed_identity_ids, source_ids, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11,
               $12::uuid[], $13::uuid[], 1)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.actorIdentityId,
        input.ownerIdentityId,
        input.title,
        input.description,
        input.rationale,
        input.reviewAt,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.sourceIds,
      ],
    );
    await this.#replaceOptions(input.id, input.options);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async saveDraft(input: SaveDecisionDraftInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id);
    this.#assertContent(input);
    const decision = await this.getDecision(input.id, true);
    this.#assertExpectedVersion(decision.version, input.expectedVersion);
    if (decision.status !== "draft") throw new Error("Only a draft Decision can be edited.");
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET space_id = $3, title = $4, description = $5, rationale = $6,
              review_at = $7, visibility = $8, classification = $9,
              allowed_identity_ids = $10::uuid[], source_ids = $11::uuid[],
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $12
        RETURNING version`,
      [
        this.#guildId,
        input.id,
        input.spaceId,
        input.title,
        input.description,
        input.rationale,
        input.reviewAt,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.sourceIds,
        input.expectedVersion,
      ],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    await this.#connection.query(
      "DELETE FROM decision_options WHERE guild_id = $1 AND decision_id = $2",
      [this.#guildId, input.id],
    );
    await this.#replaceOptions(input.id, input.options);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async propose(input: ProposeDecisionInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id);
    const decision = await this.getDecision(input.id, true);
    this.#assertExpectedVersion(decision.version, input.expectedVersion);
    assertDecisionTransition(decision.status, "proposed");
    if (!Number.isSafeInteger(input.requiredApprovals) || input.requiredApprovals < 1) {
      throw new Error("Decision approval quorum is invalid.");
    }
    const approverCount = await this.#countEligibleApprovers(decision);
    if (approverCount < input.requiredApprovals) {
      throw new Error("Decision approval quorum exceeds the number of eligible Human approvers.");
    }
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET status = 'proposed', required_approvals = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4
        RETURNING version`,
      [this.#guildId, input.id, input.requiredApprovals, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    await this.#notifyEligibleApprovers(decision);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async review(input: ReviewDecisionInput): Promise<ReviewDecisionResult> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id);
    const decision = await this.getDecision(input.id, true);
    this.#assertExpectedVersion(decision.version, input.expectedVersion);
    if (decision.status !== "proposed") throw new Error("Only a proposed Decision can be reviewed.");
    await this.#connection.query(
      `INSERT INTO decision_approvals
         (guild_id, decision_id, approver_identity_id, verdict, selected_option_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.#guildId,
        input.id,
        input.actorIdentityId,
        input.verdict,
        input.selectedOptionId,
        input.reason,
      ],
    );
    const counts = (await this.#connection.query<{
      approval_count: number;
      matching_count: number;
    }>(
      `SELECT count(*) FILTER (WHERE verdict = 'approve')::integer AS approval_count,
              count(*) FILTER (
                WHERE verdict = 'approve' AND selected_option_id = $3
              )::integer AS matching_count
         FROM decision_approvals
        WHERE guild_id = $1 AND decision_id = $2`,
      [this.#guildId, input.id, input.selectedOptionId],
    )).rows[0];
    const approvalCount = counts?.approval_count ?? 0;
    const approved = input.verdict === "approve" &&
      (counts?.matching_count ?? 0) >= decision.requiredApprovals;
    const rejected = input.verdict === "reject";
    const status = rejected ? "rejected" as const : approved ? "approved" as const : "proposed" as const;
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET status = $3,
              approval_count = $4,
              selected_option_id = CASE WHEN $3 = 'approved' THEN $5::uuid ELSE NULL END,
              decided_at = CASE WHEN $3 IN ('approved', 'rejected') THEN now() ELSE NULL END,
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $6
        RETURNING version`,
      [
        this.#guildId,
        input.id,
        status,
        approvalCount,
        input.selectedOptionId,
        input.expectedVersion,
      ],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    if (status !== "proposed") {
      await this.#notify(decision.proposerIdentityId, "approval", decision.title, "decision", decision.id);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { version, status, approvalCount };
  }

  async supersede(input: SupersedeDecisionInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id);
    const rows = (await this.#connection.query<DecisionRow>(
      `${this.#decisionSelect()}
        WHERE d.guild_id = $1 AND d.id = ANY($2::uuid[])
        ORDER BY d.id FOR UPDATE OF d`,
      [this.#guildId, [input.id, input.replacementDecisionId]],
    )).rows.map(decisionFromRow);
    const decision = rows.find((row) => row.id === input.id);
    const replacement = rows.find((row) => row.id === input.replacementDecisionId);
    if (!decision || !replacement) throw new Error("Both Decisions must exist in this Guild.");
    this.#assertExpectedVersion(decision.version, input.expectedVersion);
    assertDecisionTransition(decision.status, "superseded");
    if (replacement.status !== "approved") throw new Error("Replacement Decision must be approved.");
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET status = 'superseded', superseded_by_decision_id = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, input.id, input.replacementDecisionId, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async #replaceOptions(decisionId: string, options: readonly DecisionOptionWrite[]): Promise<void> {
    for (const option of options) {
      await this.#connection.query(
        `INSERT INTO decision_options
           (id, guild_id, decision_id, label, description, position, selected)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [option.id, this.#guildId, decisionId, option.label, option.description, option.position],
      );
    }
  }

  #assertContent(input: DecisionContentInput): void {
    assertDecisionContent(input.title, input.description, input.rationale);
    assertDecisionOptions(input.options);
    if (input.options.some((option, index) => option.position !== index)) {
      throw new Error("Decision option positions must be contiguous from zero.");
    }
  }

  async #countEligibleApprovers(decision: Decision): Promise<number> {
    const result = await this.#connection.query<{ count: number }>(
      `WITH ${this.#eligibleApproversCte()}
       SELECT count(*)::integer AS count FROM eligible_approvers`,
      this.#eligibleApproverParameters(decision),
    );
    return result.rows[0]?.count ?? 0;
  }

  async #notifyEligibleApprovers(decision: Decision): Promise<void> {
    await this.#connection.query(
      `WITH ${this.#eligibleApproversCte()}
       INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id)
       SELECT gen_random_uuid(), $1, approver.id, 'approval', $7, '', 'decision', $8
         FROM eligible_approvers approver`,
      [...this.#eligibleApproverParameters(decision), decision.title, decision.id],
    );
  }

  #eligibleApproversCte(): string {
    return `eligible_approvers AS (
       SELECT DISTINCT identity_row.id
         FROM identities identity_row
         JOIN memberships membership_row
           ON membership_row.guild_id = identity_row.guild_id
          AND membership_row.identity_id = identity_row.id
         JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
        WHERE identity_row.guild_id = $1
          AND identity_row.kind = 'human'
          AND identity_row.status = 'active'
          AND membership_row.state = 'active'
          AND CASE $3::text
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
              END <= CASE membership_row.clearance
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
              END
          AND ($4::text NOT IN ('private', 'restricted')
            OR identity_row.id = $5 OR identity_row.id = ANY($6::uuid[]))
          AND (
            guild_row.root_owner_identity_id = identity_row.id
            OR EXISTS (
              SELECT 1 FROM role_bindings binding_row
              JOIN role_permissions permission_row
                ON permission_row.guild_id = binding_row.guild_id
               AND permission_row.role_id = binding_row.role_id
             WHERE binding_row.guild_id = identity_row.guild_id
               AND binding_row.identity_id = identity_row.id
               AND permission_row.permission = 'decision.approve'
               AND (binding_row.space_id IS NULL
                 OR $2::uuid IS NOT NULL
                    AND guild_runtime.space_contains($1, binding_row.space_id, $2::uuid))
            )
          )
    )`;
  }

  #eligibleApproverParameters(decision: Decision): readonly unknown[] {
    return [
      this.#guildId,
      decision.spaceId,
      decision.classification,
      decision.visibility,
      decision.ownerIdentityId,
      decision.allowedIdentityIds ?? [],
    ];
  }

  async #notify(
    recipientIdentityId: string,
    kind: "approval" | "system",
    title: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, $5, '', $6, $7)`,
      [crypto.randomUUID(), this.#guildId, recipientIdentityId, kind, title, resourceType, resourceId],
    );
  }

  #decisionSelect(): string {
    return `SELECT d.id::text, d.guild_id::text, d.space_id::text,
                   d.proposer_identity_id::text, d.owner_identity_id::text,
                   d.title, d.description, d.rationale, d.status, d.visibility,
                   d.classification, d.allowed_identity_ids::text[], d.source_ids::text[],
                   d.required_approvals, d.approval_count, d.selected_option_id::text,
                   d.review_at::text, d.decided_at::text,
                   d.superseded_by_decision_id::text, d.version,
                   d.created_at::text, d.updated_at::text
              FROM decisions d`;
  }

  #authorizationCtes(): string {
    return `decision_actor AS (
              SELECT membership_row.clearance,
                     guild_row.root_owner_identity_id = identity_row.id AS is_root
                FROM identities identity_row
                JOIN memberships membership_row
                  ON membership_row.guild_id = identity_row.guild_id
                 AND membership_row.identity_id = identity_row.id
                JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
               WHERE identity_row.guild_id = $1 AND identity_row.id = $2
                 AND identity_row.status = 'active'
                 AND membership_row.state = 'active'
            ),
            decision_grants AS (
              SELECT binding_row.space_id
                FROM role_bindings binding_row
                JOIN role_permissions permission_row
                  ON permission_row.guild_id = binding_row.guild_id
                 AND permission_row.role_id = binding_row.role_id
                CROSS JOIN decision_actor
               WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
                 AND permission_row.permission = 'decision.read'
            ),
            decision_spaces AS (
              SELECT space_row.id FROM spaces space_row
                JOIN decision_grants grant_row ON grant_row.space_id = space_row.id
               WHERE space_row.guild_id = $1 AND space_row.status = 'active'
              UNION
              SELECT child.id FROM spaces child
                JOIN decision_spaces parent ON child.parent_space_id = parent.id
               WHERE child.guild_id = $1 AND child.status = 'active'
            ),
            decision_access AS (
              SELECT decision_actor.*,
                     EXISTS (SELECT 1 FROM decision_grants WHERE space_id IS NULL) AS has_global_grant
                FROM decision_actor
            )`;
  }

  #readPredicate(alias: string): string {
    return `(access.is_root OR access.has_global_grant OR (
              ${alias}.space_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM decision_spaces permitted WHERE permitted.id = ${alias}.space_id
              )
            ))
            AND CASE ${alias}.classification
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END <= CASE access.clearance
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END
            AND (${alias}.visibility NOT IN ('private', 'restricted')
              OR ${alias}.owner_identity_id = $2 OR $2::uuid = ANY(${alias}.allowed_identity_ids))`;
  }

  #assertExpectedVersion(current: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
      throw new Error("Decision changed since it was loaded. Reload before continuing.");
    }
  }

  #assertEvent(event: ChronicleEvent, actorIdentityId: string, subjectId: string): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.subjectType !== "decision" || event.subjectId !== subjectId) {
      throw new Error("Decision event crosses the active Guild, actor, or subject boundary.");
    }
  }
}
