import {
  GuildDomainError,
  assertDecisionContent,
  assertDecisionMethod,
  assertDecisionOptions,
  assertDecisionTransition,
  type ChronicleEvent,
  type Classification,
  type Decision,
  type DecisionApproval,
  type DecisionMethod,
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
  method?: DecisionMethod;
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
  method: DecisionMethod;
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

type DecisionConstitutionRow = QueryResultRow & {
  version: number;
  level2_approval_quorum: number;
  level3_approval_quorum: number;
};

type DecisionResolutionRow = QueryResultRow & {
  resolution_status: "proposed" | "approved" | "rejected";
  resolution_option_id: string | null;
  approval_count: number;
  participation_count: number;
  rejection_count: number;
  matching_count: number;
  eligible_count: number;
  policy_gate_passed: boolean;
  resolution_reason: string;
};

interface DecisionMethodCapture {
  constitutionVersion: number;
  requiredParticipation: number;
  eligibleParticipantCount: number;
  policyGatePassed: boolean;
}

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
    method: row.method,
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
          method, title, description, status, rationale, review_at, visibility,
          classification, allowed_identity_ids, source_ids, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12,
               $13::uuid[], $14::uuid[], 1)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.actorIdentityId,
        input.ownerIdentityId,
        input.method ?? "custodian",
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
          SET method = COALESCE($3, method), space_id = $4, title = $5,
              description = $6, rationale = $7, review_at = $8,
              visibility = $9, classification = $10,
              allowed_identity_ids = $11::uuid[], source_ids = $12::uuid[],
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $13
        RETURNING version`,
      [
        this.#guildId,
        input.id,
        input.method ?? null,
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
    const governance = await this.#captureMethodGovernance(decision, input.requiredApprovals);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET status = 'proposed', required_approvals = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4
        RETURNING version`,
      [this.#guildId, input.id, governance.requiredParticipation, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    await this.#notifyEligibleApprovers(decision, version);
    await this.#chronicle.appendChronicle({
      ...input.chronicleEvent,
      details: {
        ...input.chronicleEvent.details,
        decisionMethod: decision.method,
        constitutionVersion: governance.constitutionVersion,
        requiredParticipation: governance.requiredParticipation,
        eligibleParticipantCount: governance.eligibleParticipantCount,
        policyGatePassed: governance.policyGatePassed,
      },
    });
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
    const resolution = (await this.#connection.query<DecisionResolutionRow>(
      `SELECT resolution_status, resolution_option_id::text, approval_count,
              participation_count, rejection_count, matching_count, eligible_count,
              policy_gate_passed, resolution_reason
         FROM guild_runtime.evaluate_decision_resolution($1, $2)`,
      [this.#guildId, input.id],
    )).rows[0];
    if (!resolution) throw new Error("Decision method evaluation did not return a result.");
    const status = resolution.resolution_status;
    const approvalCount = resolution.approval_count;
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE decisions
          SET status = $3,
              approval_count = $4,
              participation_count = $5,
              selected_option_id = CASE WHEN $3 = 'approved' THEN $6::uuid ELSE NULL END,
              decided_at = CASE WHEN $3 IN ('approved', 'rejected') THEN now() ELSE NULL END,
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $7
        RETURNING version`,
      [
        this.#guildId,
        input.id,
        status,
        approvalCount,
        resolution.participation_count,
        resolution.resolution_option_id,
        input.expectedVersion,
      ],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Decision changed since it was loaded.");
    if (status !== "proposed") {
      await this.#notify(decision.proposerIdentityId, decision, version);
    }
    await this.#chronicle.appendChronicle({
      ...input.chronicleEvent,
      details: {
        ...input.chronicleEvent.details,
        decisionMethod: decision.method,
        resolutionStatus: status,
        resolutionReason: resolution.resolution_reason,
        selectedOptionId: resolution.resolution_option_id,
        approvalCount,
        participationCount: resolution.participation_count,
        rejectionCount: resolution.rejection_count,
        matchingCount: resolution.matching_count,
        eligibleParticipantCount: resolution.eligible_count,
        policyGatePassed: resolution.policy_gate_passed,
      },
    });
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
    if (input.method !== undefined) assertDecisionMethod(input.method);
    assertDecisionContent(input.title, input.description, input.rationale);
    assertDecisionOptions(input.options);
    if (input.options.some((option, index) => option.position !== index)) {
      throw new Error("Decision option positions must be contiguous from zero.");
    }
  }

  async #captureMethodGovernance(
    decision: Decision,
    requestedApprovals: number,
  ): Promise<DecisionMethodCapture> {
    const constitution = (await this.#connection.query<DecisionConstitutionRow>(
      `SELECT version, level2_approval_quorum, level3_approval_quorum
         FROM constitutions WHERE guild_id = $1`,
      [this.#guildId],
    )).rows[0];
    if (!constitution) throw new Error("Guild Constitution was not found.");

    const requiresEvidence = decision.method === "editorial" ||
      decision.method === "policy" || decision.method === "hybrid" ||
      decision.method === "agent_proposal_human_approval" || decision.method === "custom";
    const policyGatePassed = !requiresEvidence ||
      decision.sourceIds.length > 0 && decision.rationale.trim().length > 0;
    if (!policyGatePassed) {
      throw new Error(
        `${decision.method} Decisions require a rationale and at least one evidence source.`,
      );
    }

    const constitutionQuorum = decision.classification === "restricted"
      ? constitution.level3_approval_quorum
      : constitution.level2_approval_quorum;
    const requiredParticipation = decision.method === "custodian" ||
      decision.method === "editorial" || decision.method === "policy" ||
      decision.method === "agent_proposal_human_approval"
      ? 1
      : decision.method === "hybrid" || decision.method === "quorum_vote" ||
          decision.method === "council" || decision.method === "custom"
        ? Math.max(requestedApprovals, constitutionQuorum)
        : requestedApprovals;

    const eligibleParticipantCount = await this.#captureParticipants(decision);
    if (eligibleParticipantCount < requiredParticipation) {
      throw new Error(
        "Decision participation threshold exceeds the number of eligible active Humans.",
      );
    }

    await this.#connection.query(
      `INSERT INTO decision_method_snapshots
         (guild_id, decision_id, method, constitution_version,
          required_participation, eligible_participant_count,
          policy_gate_passed, policy_evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        this.#guildId,
        decision.id,
        decision.method,
        constitution.version,
        requiredParticipation,
        eligibleParticipantCount,
        policyGatePassed,
        JSON.stringify({
          sourceCount: decision.sourceIds.length,
          rationalePresent: decision.rationale.trim().length > 0,
          constitutionQuorum,
          requestedApprovals,
          effectiveRequiredParticipation: requiredParticipation,
        }),
      ],
    );
    return {
      constitutionVersion: constitution.version,
      requiredParticipation,
      eligibleParticipantCount,
      policyGatePassed,
    };
  }

  async #captureParticipants(decision: Decision): Promise<number> {
    if (decision.method === "custodian" || decision.method === "editorial") {
      await this.#connection.query(
        `INSERT INTO decision_participant_snapshots
           (guild_id, decision_id, identity_id, is_custodian)
         SELECT $1, $2, identity_row.id, true
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
          WHERE identity_row.guild_id = $1
            AND identity_row.id = $3
            AND identity_row.kind = 'human'
            AND identity_row.status = 'active'
            AND membership_row.state = 'active'
            AND CASE $4::text
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END <= CASE membership_row.clearance
                  WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                  WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
                END`,
        [this.#guildId, decision.id, decision.ownerIdentityId, decision.classification],
      );
    } else {
      await this.#connection.query(
        `WITH ${this.#eligibleApproversCte()}
         INSERT INTO decision_participant_snapshots
           (guild_id, decision_id, identity_id, is_custodian)
         SELECT $1, $7, approver.id, approver.id = $5
           FROM eligible_approvers approver`,
        [...this.#eligibleApproverParameters(decision), decision.id],
      );
    }
    const result = await this.#connection.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM decision_participant_snapshots
        WHERE guild_id = $1 AND decision_id = $2`,
      [this.#guildId, decision.id],
    );
    return result.rows[0]?.count ?? 0;
  }

  async #notifyEligibleApprovers(decision: Decision, version: number): Promise<void> {
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id,
          space_id, owner_identity_id, visibility, classification, allowed_identity_ids,
          deduplication_key)
       SELECT gen_random_uuid(), $1, participant.identity_id, 'approval', $3, '',
              'decision', $2, $4, $5, $6, $7, $8::uuid[], $9
         FROM decision_participant_snapshots participant
        WHERE participant.guild_id = $1 AND participant.decision_id = $2
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        this.#guildId,
        decision.id,
        decision.title,
        decision.spaceId,
        decision.ownerIdentityId,
        decision.visibility,
        decision.classification,
        decision.allowedIdentityIds ?? [],
        `decision-approval:${decision.id}:v${version}`,
      ],
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
    decision: Decision,
    version: number,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id,
          space_id, owner_identity_id, visibility, classification, allowed_identity_ids,
          deduplication_key)
       VALUES ($1, $2, $3, 'approval', $4, '', 'decision', $5,
               $6, $7, $8, $9, $10::uuid[], $11)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        recipientIdentityId,
        decision.title,
        decision.id,
        decision.spaceId,
        decision.ownerIdentityId,
        decision.visibility,
        decision.classification,
        decision.allowedIdentityIds ?? [],
        `decision-outcome:${decision.id}:v${version}`,
      ],
    );
  }

  #decisionSelect(): string {
    return `SELECT d.id::text, d.guild_id::text, d.space_id::text,
                   d.proposer_identity_id::text, d.owner_identity_id::text, d.method,
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
