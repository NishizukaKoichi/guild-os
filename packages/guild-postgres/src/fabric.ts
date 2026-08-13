import {
  assertNonBlank,
  type ChronicleEvent,
  type Classification,
  type ContributionCorrectionRequest,
  type EmergencyPrivateAccessGrant,
  type HandoverCase,
  type HandoverItem,
  type OnboardingAssignment,
  type OnboardingPath,
  type OnboardingRequirement,
  type PrivateMessage,
  type PrivateThread,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildFabricGovernanceRepository } from "./fabric-governance.js";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface PrivateThreadSummary extends PrivateThread {
  participantActorIds: readonly string[];
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface PrivateThreadDetail {
  thread: PrivateThreadSummary;
  messages: readonly PrivateMessage[];
  emergencyGrant: EmergencyPrivateAccessGrant | null;
}

export interface CreatePrivateThreadInput {
  id: string;
  actorId: string;
  participantActorIds: readonly string[];
  spaceId: string | null;
  subject: string;
  classification: Classification;
  initialMessageId: string;
  initialBody: string;
  chronicleEvent: ChronicleEvent;
}

export interface OnboardingPathDetail {
  path: OnboardingPath;
  requirements: readonly OnboardingRequirement[];
}

export interface OnboardingAssignmentDetail {
  assignment: OnboardingAssignment;
  path: OnboardingPath;
  requirements: readonly (OnboardingRequirement & { completedAt: string | null; evidence: string })[];
}

export interface HandoverDetail {
  handover: HandoverCase;
  items: readonly HandoverItem[];
}

export interface OnboardingAssignmentSummary extends OnboardingAssignment {
  actorDisplayName: string;
  pathName: string;
  completedRequirementCount: number;
  totalRequirementCount: number;
}

export interface ContributionFacet {
  facet: "knowledge" | "activity" | "decision" | "support" | "agent_supervision" | "governance";
  count: number;
}

export interface ContributionEvidence {
  eventId: string;
  sequence: string;
  action: string;
  subjectType: string;
  subjectId: string;
  occurredAt: string;
  facet: ContributionFacet["facet"];
}

export interface ContributionProfile {
  actorId: string;
  actorDisplayName: string;
  facets: readonly ContributionFacet[];
  evidence: readonly ContributionEvidence[];
  corrections: readonly ContributionCorrectionRequest[];
}

type PrivateThreadRow = QueryResultRow & {
  id: string; guild_id: string; space_id: string | null; created_by_actor_id: string;
  subject: string; classification: Classification; status: "open" | "closed";
  version: number; created_at: string; updated_at: string; participant_actor_ids: string[];
  last_message_at: string | null; last_message_preview: string | null;
};

type PrivateMessageRow = QueryResultRow & {
  id: string; guild_id: string; thread_id: string; author_actor_id: string; body: string;
  state: "active" | "redacted"; redacted_by_actor_id: string | null;
  redacted_at: string | null; redaction_reason: string | null; version: number; created_at: string;
};

type EmergencyGrantRow = QueryResultRow & {
  id: string; guild_id: string; thread_id: string; granted_to_actor_id: string;
  granted_by_actor_id: string; reason: string; intended_access: string;
  viewed_information: string; changes_made: string; status: "active" | "closed" | "expired";
  expires_at: string; closed_at: string | null; version: number; created_at: string;
};

type OnboardingPathRow = QueryResultRow & {
  id: string; guild_id: string; space_id: string | null; template_key: OnboardingPath["templateKey"];
  applicable_role_ids: string[];
  name: string; description: string; status: OnboardingPath["status"];
  created_by_actor_id: string; version: number; created_at: string; updated_at: string;
};

type RequirementRow = QueryResultRow & {
  id: string; guild_id: string; path_id: string; kind: OnboardingRequirement["kind"];
  resource_id: string | null; title: string; instructions: string; required: boolean;
  position: number; created_at: string; completed_at?: string | null; evidence?: string | null;
};

type AssignmentRow = QueryResultRow & {
  id: string; guild_id: string; actor_id: string; path_id: string; manager_actor_id: string;
  status: OnboardingAssignment["status"]; due_at: string | null; completed_at: string | null;
  version: number; created_at: string; updated_at: string;
};

type HandoverRow = QueryResultRow & {
  id: string; guild_id: string; departing_actor_id: string; successor_actor_id: string | null;
  initiated_by_actor_id: string; reason: string; status: HandoverCase["status"];
  completed_at: string | null; version: number; created_at: string; updated_at: string;
};

type HandoverItemRow = QueryResultRow & {
  id: string; guild_id: string; case_id: string; resource_type: HandoverItem["resourceType"];
  resource_id: string; title: string; disposition: HandoverItem["disposition"];
  status: HandoverItem["status"]; note: string; completed_at: string | null; created_at: string;
};

type CorrectionRow = QueryResultRow & {
  id: string; guild_id: string; subject_actor_id: string; requested_by_actor_id: string;
  chronicle_event_id: string; evidence_sha256: string; reason: string;
  status: ContributionCorrectionRequest["status"];
  reviewed_by_actor_id: string | null; review_reason: string | null;
  reviewed_at: string | null; version: number; request_chronicle_event_id: string;
  resolution_chronicle_event_id: string | null; created_at: string;
};

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return date.toISOString();
}

function optionalIso(value: string | null | undefined): string | null {
  return value == null ? null : iso(value);
}

function threadFrom(row: PrivateThreadRow): PrivateThreadSummary {
  return {
    id: row.id, guildId: row.guild_id, spaceId: row.space_id,
    createdByActorId: row.created_by_actor_id, subject: row.subject,
    classification: row.classification, status: row.status, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    participantActorIds: row.participant_actor_ids,
    lastMessageAt: optionalIso(row.last_message_at), lastMessagePreview: row.last_message_preview,
  };
}

function messageFrom(row: PrivateMessageRow): PrivateMessage {
  return {
    id: row.id, guildId: row.guild_id, threadId: row.thread_id,
    authorActorId: row.author_actor_id, body: row.body, state: row.state,
    redactedByActorId: row.redacted_by_actor_id, redactedAt: optionalIso(row.redacted_at),
    redactionReason: row.redaction_reason, version: row.version, createdAt: iso(row.created_at),
  };
}

function grantFrom(row: EmergencyGrantRow): EmergencyPrivateAccessGrant {
  return {
    id: row.id, guildId: row.guild_id, threadId: row.thread_id,
    grantedToActorId: row.granted_to_actor_id, grantedByActorId: row.granted_by_actor_id,
    reason: row.reason, intendedAccess: row.intended_access,
    viewedInformation: row.viewed_information, changesMade: row.changes_made,
    status: row.status, expiresAt: iso(row.expires_at), closedAt: optionalIso(row.closed_at),
    version: row.version, createdAt: iso(row.created_at),
  };
}

function pathFrom(row: OnboardingPathRow): OnboardingPath {
  return {
    id: row.id, guildId: row.guild_id, spaceId: row.space_id, templateKey: row.template_key,
    applicableRoleIds: row.applicable_role_ids,
    name: row.name, description: row.description, status: row.status,
    createdByActorId: row.created_by_actor_id, version: row.version,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function requirementFrom(row: RequirementRow): OnboardingRequirement {
  return {
    id: row.id, guildId: row.guild_id, pathId: row.path_id, kind: row.kind,
    resourceId: row.resource_id, title: row.title, instructions: row.instructions,
    required: row.required, position: row.position, createdAt: iso(row.created_at),
  };
}

function assignmentFrom(row: AssignmentRow): OnboardingAssignment {
  return {
    id: row.id, guildId: row.guild_id, actorId: row.actor_id, pathId: row.path_id,
    managerActorId: row.manager_actor_id, status: row.status,
    dueAt: optionalIso(row.due_at), completedAt: optionalIso(row.completed_at),
    version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function handoverFrom(row: HandoverRow): HandoverCase {
  return {
    id: row.id, guildId: row.guild_id, departingActorId: row.departing_actor_id,
    successorActorId: row.successor_actor_id, initiatedByActorId: row.initiated_by_actor_id,
    reason: row.reason, status: row.status, completedAt: optionalIso(row.completed_at),
    version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function handoverItemFrom(row: HandoverItemRow): HandoverItem {
  return {
    id: row.id, guildId: row.guild_id, caseId: row.case_id,
    resourceType: row.resource_type, resourceId: row.resource_id, title: row.title,
    disposition: row.disposition, status: row.status, note: row.note,
    completedAt: optionalIso(row.completed_at), createdAt: iso(row.created_at),
  };
}

function correctionFrom(row: CorrectionRow): ContributionCorrectionRequest {
  return {
    id: row.id, guildId: row.guild_id, subjectActorId: row.subject_actor_id,
    requestedByActorId: row.requested_by_actor_id, chronicleEventId: row.chronicle_event_id,
    evidenceSha256: row.evidence_sha256, reason: row.reason, status: row.status,
    reviewedByActorId: row.reviewed_by_actor_id,
    reviewReason: row.review_reason, reviewedAt: optionalIso(row.reviewed_at),
    version: row.version, requestChronicleEventId: row.request_chronicle_event_id,
    resolutionChronicleEventId: row.resolution_chronicle_event_id,
    createdAt: iso(row.created_at),
  };
}

export class GuildFabricRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listPrivateThreads(actorId: string): Promise<readonly PrivateThreadSummary[]> {
    const rows = (await this.#connection.query<PrivateThreadRow>(
      `${this.#privateThreadSelect()}
        WHERE thread.guild_id = $1 AND (
          EXISTS (SELECT 1 FROM private_thread_participants participant
                   WHERE participant.guild_id = thread.guild_id AND participant.thread_id = thread.id
                     AND participant.actor_id = $2 AND participant.state = 'active')
          OR EXISTS (SELECT 1 FROM emergency_private_access_grants emergency
                      WHERE emergency.guild_id = thread.guild_id AND emergency.thread_id = thread.id
                        AND emergency.granted_to_actor_id = $2 AND emergency.status = 'active'
                        AND emergency.expires_at > now())
        ) ORDER BY thread.updated_at DESC, thread.id DESC LIMIT 100`,
      [this.#guildId, actorId],
    )).rows;
    return rows.map(threadFrom);
  }

  async getPrivateThread(actorId: string, threadId: string): Promise<PrivateThreadDetail> {
    const thread = (await this.#connection.query<PrivateThreadRow>(
      `${this.#privateThreadSelect()} WHERE thread.guild_id = $1 AND thread.id = $2 AND (
         EXISTS (SELECT 1 FROM private_thread_participants participant
                  WHERE participant.guild_id = thread.guild_id AND participant.thread_id = thread.id
                    AND participant.actor_id = $3 AND participant.state = 'active')
         OR EXISTS (SELECT 1 FROM emergency_private_access_grants emergency
                     WHERE emergency.guild_id = thread.guild_id AND emergency.thread_id = thread.id
                       AND emergency.granted_to_actor_id = $3 AND emergency.status = 'active'
                       AND emergency.expires_at > now()))`,
      [this.#guildId, threadId, actorId],
    )).rows[0];
    if (!thread) throw new Error("Private thread was not found or is not visible.");
    const messages = (await this.#connection.query<PrivateMessageRow>(
      `SELECT id::text, guild_id::text, thread_id::text, author_actor_id::text,
              CASE WHEN state = 'redacted' THEN '' ELSE body END AS body, state,
              redacted_by_actor_id::text, redacted_at::text, redaction_reason,
              version, created_at::text FROM private_messages
        WHERE guild_id = $1 AND thread_id = $2 ORDER BY created_at, id LIMIT 500`,
      [this.#guildId, threadId],
    )).rows.map(messageFrom);
    const emergency = (await this.#connection.query<EmergencyGrantRow>(
      `SELECT id::text, guild_id::text, thread_id::text, granted_to_actor_id::text,
              granted_by_actor_id::text, reason, intended_access, viewed_information,
              changes_made, status, expires_at::text, closed_at::text, version, created_at::text
         FROM emergency_private_access_grants WHERE guild_id = $1 AND thread_id = $2
           AND granted_to_actor_id = $3 AND status = 'active' AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1`,
      [this.#guildId, threadId, actorId],
    )).rows[0];
    return { thread: threadFrom(thread), messages, emergencyGrant: emergency ? grantFrom(emergency) : null };
  }

  async createPrivateThread(input: CreatePrivateThreadInput): Promise<void> {
    assertNonBlank(input.subject, "Private thread subject", 200);
    assertNonBlank(input.initialBody, "Private message", 20_000);
    const participants = [...new Set([input.actorId, ...input.participantActorIds])];
    if (participants.length < 2 || participants.length > 20) {
      throw new Error("A private thread requires between two and twenty unique participants.");
    }
    await this.#connection.query(
      `INSERT INTO private_threads
         (id, guild_id, space_id, created_by_actor_id, subject, classification)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, this.#guildId, input.spaceId, input.actorId, input.subject, input.classification],
    );
    const active = await this.#connection.query<{ id: string }>(
      `SELECT actor.actor_id::text AS id FROM actor_memberships actor
        WHERE actor.guild_id = $1 AND actor.actor_id = ANY($2::uuid[])
          AND actor.state IN ('joined', 'active') AND actor.operational`,
      [this.#guildId, participants],
    );
    if (active.rowCount !== participants.length) throw new Error("Every private participant must be active.");
    await this.#connection.query(
      `INSERT INTO private_thread_participants (guild_id, thread_id, actor_id)
       SELECT $1, $2, unnest($3::uuid[])`,
      [this.#guildId, input.id, participants],
    );
    await this.#connection.query(
      `INSERT INTO private_messages (id, guild_id, thread_id, author_actor_id, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.initialMessageId, this.#guildId, input.id, input.actorId, input.initialBody],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async postPrivateMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    body: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    assertNonBlank(body, "Private message", 20_000);
    const inserted = await this.#connection.query(
      `INSERT INTO private_messages (id, guild_id, thread_id, author_actor_id, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [messageId, this.#guildId, threadId, actorId, body],
    );
    if (inserted.rowCount !== 1) throw new Error("Private message was not stored.");
    await this.#connection.query(
      `UPDATE private_threads SET updated_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'open'`,
      [this.#guildId, threadId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async createEmergencyGrant(
    grant: EmergencyPrivateAccessGrant,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    assertNonBlank(grant.reason, "Emergency reason", 5_000);
    assertNonBlank(grant.intendedAccess, "Intended emergency access", 5_000);
    await this.#connection.query(
      `INSERT INTO emergency_private_access_grants
         (id, guild_id, thread_id, granted_to_actor_id, granted_by_actor_id,
          reason, intended_access, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [grant.id, this.#guildId, grant.threadId, grant.grantedToActorId,
        grant.grantedByActorId, grant.reason, grant.intendedAccess, grant.expiresAt],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async closeEmergencyGrant(
    grantId: string,
    actorId: string,
    viewedInformation: string,
    changesMade: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    const updated = await this.#connection.query(
      `UPDATE emergency_private_access_grants
          SET status = 'closed', viewed_information = $4, changes_made = $5,
              closed_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND granted_to_actor_id = $3
          AND status = 'active' AND expires_at > now()`,
      [this.#guildId, grantId, actorId, viewedInformation, changesMade],
    );
    if (updated.rowCount !== 1) throw new Error("Active emergency access was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async listOnboardingPaths(
    visibleSpaceIds: readonly string[] | null = null,
  ): Promise<readonly OnboardingPathDetail[]> {
    const paths = (await this.#connection.query<OnboardingPathRow>(
      `SELECT id::text, guild_id::text, space_id::text, template_key, name, description,
              status, created_by_actor_id::text, version, created_at::text, updated_at::text,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = onboarding_paths.guild_id
                       AND scope.path_id = onboarding_paths.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM onboarding_paths WHERE guild_id = $1 AND status = 'active'
          AND ($2::uuid[] IS NULL OR space_id = ANY($2::uuid[]))
         ORDER BY name, id LIMIT 100`,
      [this.#guildId, visibleSpaceIds],
    )).rows;
    const requirements = (await this.#connection.query<RequirementRow>(
      `SELECT id::text, guild_id::text, path_id::text, kind, resource_id::text,
              title, instructions, required, position, created_at::text
         FROM onboarding_requirements WHERE guild_id = $1
           AND path_id = ANY($2::uuid[])
         ORDER BY path_id, position, id`,
      [this.#guildId, paths.map((path) => path.id)],
    )).rows;
    return paths.map((path) => ({
      path: pathFrom(path),
      requirements: requirements.filter((item) => item.path_id === path.id).map(requirementFrom),
    }));
  }

  async getOnboardingAssignment(actorId: string): Promise<OnboardingAssignmentDetail | null> {
    return (await this.listOnboardingAssignmentDetails(actorId))[0] ?? null;
  }

  async listOnboardingAssignmentDetails(
    actorId: string,
  ): Promise<readonly OnboardingAssignmentDetail[]> {
    const assignments = (await this.#connection.query<AssignmentRow>(
      `SELECT id::text, guild_id::text, actor_id::text, path_id::text,
              manager_actor_id::text, status, due_at::text, completed_at::text,
              version, created_at::text, updated_at::text
         FROM onboarding_assignments WHERE guild_id = $1 AND actor_id = $2
           AND status NOT IN ('completed', 'cancelled') ORDER BY created_at DESC, id DESC
         LIMIT 100`,
      [this.#guildId, actorId],
    )).rows;
    if (assignments.length === 0) return [];
    const paths = (await this.#connection.query<OnboardingPathRow>(
      `SELECT id::text, guild_id::text, space_id::text, template_key, name, description,
              status, created_by_actor_id::text, version, created_at::text, updated_at::text,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = onboarding_paths.guild_id
                       AND scope.path_id = onboarding_paths.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM onboarding_paths WHERE guild_id = $1 AND id = ANY($2::uuid[])`,
      [this.#guildId, assignments.map((assignment) => assignment.path_id)],
    )).rows;
    if (paths.length !== assignments.length) throw new Error("Onboarding path was not found.");
    const requirements = (await this.#connection.query<RequirementRow & {
      assignment_id: string;
    }>(
      `SELECT requirement.id::text, requirement.guild_id::text, requirement.path_id::text,
              requirement.kind, requirement.resource_id::text, requirement.title,
              requirement.instructions, requirement.required, requirement.position,
              requirement.created_at::text, completion.completed_at::text,
              COALESCE(completion.evidence, '') AS evidence,
              assignment.id::text AS assignment_id
         FROM onboarding_assignments assignment
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = assignment.guild_id
          AND requirement.path_id = assignment.path_id
         LEFT JOIN onboarding_completions completion
           ON completion.guild_id = requirement.guild_id
          AND completion.requirement_id = requirement.id
          AND completion.assignment_id = assignment.id
        WHERE assignment.guild_id = $1 AND assignment.id = ANY($2::uuid[])
        ORDER BY assignment.created_at DESC, assignment.id DESC,
                 requirement.position, requirement.id`,
      [this.#guildId, assignments.map((assignment) => assignment.id)],
    )).rows;
    return assignments.map((assignment) => {
      const path = paths.find((candidate) => candidate.id === assignment.path_id);
      if (!path) throw new Error("Onboarding path was not found.");
      return {
        assignment: assignmentFrom(assignment),
        path: pathFrom(path),
        requirements: requirements
          .filter((row) => row.assignment_id === assignment.id)
          .map((row) => ({
            ...requirementFrom(row),
            completedAt: optionalIso(row.completed_at),
            evidence: row.evidence ?? "",
          })),
      };
    });
  }

  async createOnboardingPath(
    path: OnboardingPath,
    requirements: readonly OnboardingRequirement[],
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    assertNonBlank(path.name, "Onboarding path name", 200);
    if (requirements.length < 1 || requirements.length > 100) {
      throw new Error("Onboarding paths require between one and one hundred requirements.");
    }
    const applicableRoleIds = path.applicableRoleIds ?? [];
    if (applicableRoleIds.length > 100 ||
        new Set(applicableRoleIds).size !== applicableRoleIds.length) {
      throw new Error("Onboarding Role scope must contain at most one hundred unique Roles.");
    }
    await this.#connection.query(
      `INSERT INTO onboarding_paths
         (id, guild_id, space_id, template_key, name, description, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [path.id, this.#guildId, path.spaceId, path.templateKey, path.name,
        path.description, path.createdByActorId],
    );
    if (applicableRoleIds.length > 0) {
      await this.#connection.query(
        `INSERT INTO onboarding_path_roles (guild_id, path_id, role_id)
         SELECT $1, $2, role_id FROM unnest($3::uuid[]) role_id`,
        [this.#guildId, path.id, applicableRoleIds],
      );
    }
    for (const requirement of requirements) {
      await this.#connection.query(
        `INSERT INTO onboarding_requirements
           (id, guild_id, path_id, kind, resource_id, title, instructions, required, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [requirement.id, this.#guildId, path.id, requirement.kind,
          requirement.resourceId, requirement.title, requirement.instructions,
          requirement.required, requirement.position],
      );
    }
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async assignOnboarding(
    assignment: OnboardingAssignment,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    const inserted = await this.#connection.query(
      `INSERT INTO onboarding_assignments
         (id, guild_id, actor_id, path_id, manager_actor_id, due_at)
       SELECT $1, $2, target.actor_id, path.id, manager.actor_id, $6
         FROM actor_memberships target
         JOIN onboarding_paths path ON path.guild_id = target.guild_id AND path.id = $4
         JOIN actor_memberships manager ON manager.guild_id = target.guild_id
              AND manager.actor_id = $5 AND manager.state IN ('joined', 'active')
              AND manager.operational
        WHERE target.guild_id = $2 AND target.actor_id = $3
          AND target.state = 'joined' AND target.operational
          AND path.status = 'active'`,
      [assignment.id, this.#guildId, assignment.actorId, assignment.pathId,
        assignment.managerActorId, assignment.dueAt],
    );
    if (inserted.rowCount !== 1) {
      throw new Error("Onboarding can be assigned only to an operational preboarding Actor.");
    }
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async listOnboardingAssignments(
    visibleSpaceIds: readonly string[] | null = null,
  ): Promise<readonly OnboardingAssignmentSummary[]> {
    const rows = await this.#connection.query<AssignmentRow & {
      actor_display_name: string;
      path_name: string;
      completed_requirement_count: string;
      total_requirement_count: string;
    }>(
      `SELECT assignment.id::text, assignment.guild_id::text, assignment.actor_id::text,
              assignment.path_id::text, assignment.manager_actor_id::text, assignment.status,
              assignment.due_at::text, assignment.completed_at::text, assignment.version,
              assignment.created_at::text, assignment.updated_at::text,
              actor.display_name AS actor_display_name, path.name AS path_name,
              count(completion.requirement_id)::text AS completed_requirement_count,
              count(requirement.id)::text AS total_requirement_count
         FROM onboarding_assignments assignment
         JOIN actors actor ON actor.guild_id = assignment.guild_id
              AND actor.id = assignment.actor_id
         JOIN onboarding_paths path ON path.guild_id = assignment.guild_id
              AND path.id = assignment.path_id
         LEFT JOIN onboarding_requirements requirement
              ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
         LEFT JOIN onboarding_completions completion
              ON completion.guild_id = assignment.guild_id
             AND completion.assignment_id = assignment.id
             AND completion.requirement_id = requirement.id
        WHERE assignment.guild_id = $1
          AND ($2::uuid[] IS NULL OR path.space_id = ANY($2::uuid[]))
        GROUP BY assignment.id, actor.display_name, path.name
        ORDER BY assignment.created_at DESC, assignment.id DESC
        LIMIT 200`,
      [this.#guildId, visibleSpaceIds],
    );
    return rows.rows.map((row) => ({
      ...assignmentFrom(row),
      actorDisplayName: row.actor_display_name,
      pathName: row.path_name,
      completedRequirementCount: Number(row.completed_requirement_count),
      totalRequirementCount: Number(row.total_requirement_count),
    }));
  }

  async completeOnboardingRequirement(
    assignmentId: string,
    requirementId: string,
    actorId: string,
    evidence: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    const inserted = await this.#connection.query(
      `INSERT INTO onboarding_completions
         (guild_id, assignment_id, requirement_id, completed_by_actor_id, evidence)
       SELECT $1, assignment.id, requirement.id, $4, $5
         FROM onboarding_assignments assignment
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = assignment.guild_id AND requirement.path_id = assignment.path_id
        WHERE assignment.guild_id = $1 AND assignment.id = $2
          AND assignment.actor_id = $4 AND requirement.id = $3
       ON CONFLICT (guild_id, assignment_id, requirement_id) DO NOTHING`,
      [this.#guildId, assignmentId, requirementId, actorId, evidence],
    );
    if (inserted.rowCount !== 1) {
      throw new Error("The onboarding requirement is unavailable or was already completed.");
    }
    await this.#connection.query(
      `UPDATE onboarding_assignments assignment SET
          status = CASE WHEN NOT EXISTS (
            SELECT 1 FROM onboarding_requirements requirement
             WHERE requirement.guild_id = assignment.guild_id
               AND requirement.path_id = assignment.path_id AND requirement.required
               AND NOT EXISTS (SELECT 1 FROM onboarding_completions completion
                 WHERE completion.guild_id = assignment.guild_id
                   AND completion.assignment_id = assignment.id
                   AND completion.requirement_id = requirement.id)
          ) THEN 'completed' ELSE 'in_progress' END,
          completed_at = CASE WHEN NOT EXISTS (
            SELECT 1 FROM onboarding_requirements requirement
             WHERE requirement.guild_id = assignment.guild_id
               AND requirement.path_id = assignment.path_id AND requirement.required
               AND NOT EXISTS (SELECT 1 FROM onboarding_completions completion
                 WHERE completion.guild_id = assignment.guild_id
                   AND completion.assignment_id = assignment.id
                   AND completion.requirement_id = requirement.id)
          ) THEN now() ELSE NULL END,
          version = version + 1, updated_at = now()
        WHERE assignment.guild_id = $1 AND assignment.id = $2 AND assignment.actor_id = $3
          AND assignment.status NOT IN ('completed', 'cancelled')`,
      [this.#guildId, assignmentId, actorId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async offboardWithHandover(
    actorId: string,
    successorActorId: string | null,
    initiatedByActorId: string,
    reason: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<HandoverDetail> {
    assertNonBlank(reason, "Offboarding reason", 5_000);
    const handoverId = crypto.randomUUID();
    await this.#connection.query(
      `INSERT INTO handover_cases
         (id, guild_id, departing_actor_id, successor_actor_id, initiated_by_actor_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [handoverId, this.#guildId, actorId, successorActorId, initiatedByActorId, reason],
    );
    await this.#connection.query(
      `INSERT INTO handover_items
         (id, guild_id, case_id, resource_type, resource_id, title)
       SELECT gen_random_uuid(), $1, $2, item.resource_type, item.resource_id, item.title FROM (
         SELECT 'memory'::text AS resource_type, memory.id AS resource_id,
                COALESCE(version.title ->> 'en', version.title ->> 'ja',
                         version.title ->> 'zh-CN', 'Memory') AS title
           FROM memories memory
           JOIN memory_versions version ON version.guild_id = memory.guild_id
                AND version.memory_id = memory.id AND version.version = memory.current_version
          WHERE memory.guild_id = $1 AND memory.owner_actor_id = $3
            AND memory.status = 'active'
         UNION ALL SELECT 'activity', activity.id, activity.title FROM activities activity
           WHERE activity.guild_id = $1
             AND (activity.owner_actor_id = $3 OR activity.assignee_actor_id = $3)
             AND activity.status NOT IN ('completed', 'cancelled', 'archived')
         UNION ALL SELECT 'knowledge', knowledge.id,
           COALESCE(version.title ->> 'en', version.title ->> 'ja',
                    version.title ->> 'zh-CN', 'Knowledge')
           FROM knowledge knowledge
           JOIN knowledge_versions version ON version.guild_id = knowledge.guild_id
                AND version.knowledge_id = knowledge.id
                AND version.version = knowledge.current_version
          WHERE knowledge.guild_id = $1 AND knowledge.owner_identity_id = $3
            AND knowledge.state NOT IN ('archived')
         UNION ALL SELECT 'file', file.id, file.original_name FROM files file
           WHERE file.guild_id = $1 AND file.owner_identity_id = $3 AND file.status <> 'deleted'
         UNION ALL SELECT 'decision', decision.id, decision.title FROM decisions decision
           WHERE decision.guild_id = $1 AND decision.owner_identity_id = $3
             AND decision.status IN ('draft', 'proposed', 'approved')
         UNION ALL SELECT 'connection', connector.id, connector.name FROM connectors connector
           WHERE connector.guild_id = $1 AND connector.owner_identity_id = $3
             AND connector.status <> 'revoked'
         UNION ALL SELECT 'schedule', rule.id, rule.name FROM automation_rules rule
           WHERE rule.guild_id = $1 AND rule.created_by_actor_id = $3
             AND rule.status <> 'archived'
       ) item ON CONFLICT DO NOTHING`,
      [this.#guildId, handoverId, actorId],
    );
    if (successorActorId !== null) {
      await this.#connection.query(
        `UPDATE activities SET owner_actor_id = CASE WHEN owner_actor_id = $2 THEN $3 ELSE owner_actor_id END,
                                assignee_actor_id = CASE WHEN assignee_actor_id = $2 THEN $3 ELSE assignee_actor_id END,
                                version = version + 1, updated_at = now()
          WHERE guild_id = $1 AND (owner_actor_id = $2 OR assignee_actor_id = $2)
            AND status NOT IN ('completed', 'cancelled', 'archived')`,
        [this.#guildId, actorId, successorActorId],
      );
    }
    await this.#connection.query(
      `UPDATE automation_rules SET status = 'paused', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND (agent_actor_id = $2 OR created_by_actor_id = $2)
          AND status = 'active'`,
      [this.#guildId, actorId],
    );
    await this.#connection.query(
      `UPDATE model_providers SET status = 'disabled', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND created_by_actor_id = $2 AND status = 'active'
          AND NOT deployment_managed`,
      [this.#guildId, actorId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
    const handover = (await this.#connection.query<HandoverRow>(
      `SELECT id::text, guild_id::text, departing_actor_id::text, successor_actor_id::text,
              initiated_by_actor_id::text, reason, status, completed_at::text, version,
              created_at::text, updated_at::text FROM handover_cases
        WHERE guild_id = $1 AND id = $2`, [this.#guildId, handoverId],
    )).rows[0]!;
    const items = (await this.#connection.query<HandoverItemRow>(
      `SELECT id::text, guild_id::text, case_id::text, resource_type, resource_id::text,
              title, disposition, status, note, completed_at::text, created_at::text
         FROM handover_items WHERE guild_id = $1 AND case_id = $2 ORDER BY created_at, id`,
      [this.#guildId, handoverId],
    )).rows;
    return { handover: handoverFrom(handover), items: items.map(handoverItemFrom) };
  }

  async listHandovers(
    visibleSpaceIds: readonly string[] | null = null,
  ): Promise<readonly HandoverDetail[]> {
    const handovers = (await this.#connection.query<HandoverRow>(
      `SELECT id::text, guild_id::text, departing_actor_id::text, successor_actor_id::text,
              initiated_by_actor_id::text, reason, status, completed_at::text, version,
              created_at::text, updated_at::text
         FROM handover_cases handover
        WHERE handover.guild_id = $1
          AND ($2::uuid[] IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = handover.guild_id
               AND binding.actor_id = handover.departing_actor_id
               AND (binding.space_id IS NULL OR binding.space_id = ANY($2::uuid[]))
          ))
        ORDER BY created_at DESC, id DESC LIMIT 100`,
      [this.#guildId, visibleSpaceIds],
    )).rows;
    if (handovers.length === 0) return [];
    const items = (await this.#connection.query<HandoverItemRow>(
      `SELECT id::text, guild_id::text, case_id::text, resource_type, resource_id::text,
              title, disposition, status, note, completed_at::text, created_at::text
         FROM handover_items WHERE guild_id = $1 AND case_id = ANY($2::uuid[])
        ORDER BY created_at, id`,
      [this.#guildId, handovers.map((handover) => handover.id)],
    )).rows;
    return handovers.map((handover) => ({
      handover: handoverFrom(handover),
      items: items.filter((item) => item.case_id === handover.id).map(handoverItemFrom),
    }));
  }

  async completeHandoverItem(
    caseId: string,
    itemId: string,
    disposition: HandoverItem["disposition"],
    note: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    const updated = await this.#connection.query(
      `UPDATE handover_items SET disposition = $4, status = 'completed', note = $5,
              completed_at = now()
        WHERE guild_id = $1 AND case_id = $2 AND id = $3 AND status = 'pending'`,
      [this.#guildId, caseId, itemId, disposition, note],
    );
    if (updated.rowCount !== 1) throw new Error("Pending handover item was not found.");
    await this.#connection.query(
      `UPDATE handover_cases handover SET status = 'completed', completed_at = now(),
              version = version + 1, updated_at = now()
        WHERE handover.guild_id = $1 AND handover.id = $2 AND handover.status = 'open'
          AND NOT EXISTS (SELECT 1 FROM handover_items item
               WHERE item.guild_id = handover.guild_id AND item.case_id = handover.id
                 AND item.status = 'pending')`,
      [this.#guildId, caseId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async getContributionProfile(actorId: string): Promise<ContributionProfile> {
    const actor = (await this.#connection.query<{ display_name: string }>(
      `SELECT actor.display_name FROM actors actor
        JOIN actor_memberships membership ON membership.actor_id = actor.id
             AND membership.guild_id = $1
       WHERE actor.id = $2`,
      [this.#guildId, actorId],
    )).rows[0];
    if (!actor) throw new Error("Actor was not found.");
    const evidence = (await this.#connection.query<QueryResultRow & {
      event_id: string; sequence: string; action: string; subject_type: string;
      subject_id: string; occurred_at: string; facet: ContributionEvidence["facet"];
    }>(
      `SELECT event.id::text AS event_id, event.sequence::text, event.action,
              event.subject_type, event.subject_id::text, event.occurred_at::text,
              CASE
                WHEN event.subject_type IN ('knowledge', 'memory') THEN 'knowledge'
                WHEN event.subject_type IN ('activity', 'goal', 'project', 'quest', 'step') THEN 'activity'
                WHEN event.subject_type = 'decision' THEN 'decision'
                WHEN event.action LIKE 'conversation.%' OR event.action LIKE 'message.%' THEN 'support'
                WHEN event.subject_type = 'agent_run' THEN 'agent_supervision'
                ELSE 'governance'
              END AS facet
         FROM chronicle_events event
        WHERE event.guild_id = $1 AND event.actor_identity_id = $2
        ORDER BY event.sequence DESC LIMIT 200`,
      [this.#guildId, actorId],
    )).rows.map((row) => ({
      eventId: row.event_id, sequence: row.sequence, action: row.action,
      subjectType: row.subject_type, subjectId: row.subject_id,
      occurredAt: iso(row.occurred_at), facet: row.facet,
    }));
    const facetNames: ContributionFacet["facet"][] = [
      "knowledge", "activity", "decision", "support", "agent_supervision", "governance",
    ];
    const corrections = (await this.#connection.query<CorrectionRow>(
      `SELECT id::text, guild_id::text, subject_actor_id::text, requested_by_actor_id::text,
              chronicle_event_id::text, evidence_sha256, reason, status,
              reviewed_by_actor_id::text, review_reason, reviewed_at::text, version,
              request_chronicle_event_id::text, resolution_chronicle_event_id::text,
              created_at::text
         FROM contribution_correction_requests WHERE guild_id = $1 AND subject_actor_id = $2
         ORDER BY created_at DESC LIMIT 100`,
      [this.#guildId, actorId],
    )).rows;
    return {
      actorId, actorDisplayName: actor.display_name,
      facets: facetNames.map((facet) => ({ facet, count: evidence.filter((item) => item.facet === facet).length })),
      evidence, corrections: corrections.map(correctionFrom),
    };
  }

  async requestContributionCorrection(
    request: Pick<ContributionCorrectionRequest,
      "id" | "subjectActorId" | "requestedByActorId" | "chronicleEventId" | "reason">,
    chronicleEvent: ChronicleEvent,
  ): Promise<ContributionCorrectionRequest> {
    if (request.requestedByActorId !== request.subjectActorId) {
      throw new Error("An Actor can request correction only for their own Contribution Graph.");
    }
    const correction = await new GuildFabricGovernanceRepository(
      this.#connection,
      this.#guildId,
    ).requestContributionCorrection({
      id: request.id,
      actorId: request.requestedByActorId,
      evidenceEventId: request.chronicleEventId,
      reason: request.reason,
      audit: {
        id: chronicleEvent.id,
        correlationId: chronicleEvent.correlationId,
        occurredAt: chronicleEvent.occurredAt,
      },
    });
    return {
      id: correction.id,
      guildId: correction.guildId,
      subjectActorId: correction.subjectActorId,
      requestedByActorId: correction.requestedByActorId,
      chronicleEventId: correction.evidenceEventId,
      evidenceSha256: correction.evidenceSha256,
      reason: correction.reason,
      status: correction.status,
      reviewedByActorId: correction.reviewedByActorId,
      reviewReason: correction.reviewReason,
      reviewedAt: correction.reviewedAt,
      version: correction.version,
      requestChronicleEventId: correction.requestChronicleEventId,
      resolutionChronicleEventId: correction.resolutionChronicleEventId,
      createdAt: correction.createdAt,
    };
  }

  #privateThreadSelect(): string {
    return `SELECT thread.id::text, thread.guild_id::text, thread.space_id::text,
                   thread.created_by_actor_id::text, thread.subject, thread.classification,
                   thread.status, thread.version, thread.created_at::text, thread.updated_at::text,
                   ARRAY(SELECT participant.actor_id::text FROM private_thread_participants participant
                          WHERE participant.guild_id = thread.guild_id AND participant.thread_id = thread.id
                            AND participant.state = 'active' ORDER BY participant.actor_id) AS participant_actor_ids,
                   latest.created_at::text AS last_message_at,
                   CASE WHEN latest.state = 'active' THEN left(latest.body, 160) ELSE NULL END AS last_message_preview
              FROM private_threads thread
              LEFT JOIN LATERAL (SELECT message.created_at, message.body, message.state
                FROM private_messages message WHERE message.guild_id = thread.guild_id
                  AND message.thread_id = thread.id ORDER BY message.created_at DESC, message.id DESC LIMIT 1
              ) latest ON true`;
  }
}
