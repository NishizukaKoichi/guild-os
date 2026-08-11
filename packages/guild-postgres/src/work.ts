import {
  GuildDomainError,
  assertGoalTransition,
  assertProjectTransition,
  assertQuestTransition,
  assertStepTransition,
  assertWorkText,
  type ChronicleEvent,
  type Classification,
  type Goal,
  type GoalStatus,
  type Project,
  type ProjectStatus,
  type Quest,
  type QuestStatus,
  type Step,
  type StepStatus,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface WorkListCursor {
  updatedAt: string;
  id: string;
}

export interface WorkListPage<T> {
  items: readonly T[];
  nextCursor: WorkListCursor | null;
}

export interface CreateGoalInput {
  id: string;
  actorIdentityId: string;
  spaceId: string | null;
  ownerIdentityId: string;
  title: string;
  description: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
  sourceIds: readonly string[];
  targetAt: string | null;
  chronicleEvent: ChronicleEvent;
}

export interface CreateProjectInput extends Omit<CreateGoalInput, "targetAt"> {
  goalId: string;
  dueAt: string | null;
}

export interface CreateQuestInput extends Omit<CreateProjectInput, "goalId"> {
  projectId: string;
  assigneeIdentityId: string | null;
}

export interface CreateStepInput {
  id: string;
  questId: string;
  actorIdentityId: string;
  assigneeIdentityId: string | null;
  title: string;
  description: string;
  chronicleEvent: ChronicleEvent;
}

export interface WorkStatusInput<TStatus extends string> {
  id: string;
  expectedVersion: number;
  actorIdentityId: string;
  status: TStatus;
  chronicleEvent: ChronicleEvent;
}

export interface WorkAssignmentInput {
  id: string;
  expectedVersion: number;
  actorIdentityId: string;
  assigneeIdentityId: string | null;
  chronicleEvent: ChronicleEvent;
}

type SecuredWorkRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  title: string;
  description: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  source_ids: string[];
  creator_identity_id: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type GoalRow = SecuredWorkRow & {
  status: GoalStatus;
  target_at: string | null;
};

type ProjectRow = SecuredWorkRow & {
  goal_id: string;
  status: ProjectStatus;
  due_at: string | null;
};

type QuestRow = SecuredWorkRow & {
  project_id: string;
  assignee_identity_id: string | null;
  status: QuestStatus;
  due_at: string | null;
};

type StepRow = QueryResultRow & {
  id: string;
  guild_id: string;
  quest_id: string;
  assignee_identity_id: string | null;
  creator_identity_id: string;
  title: string;
  description: string;
  status: StepStatus;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
};

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_PROJECTS_PER_GOAL = 1_000;
const MAX_QUESTS_PER_PROJECT = 10_000;
const MAX_STEPS_PER_QUEST = 500;

function isoTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Database contains an invalid Work timestamp.");
  return parsed.toISOString();
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    creatorIdentityId: row.creator_identity_id,
    sourceIds: row.source_ids,
    targetAt: optionalTimestamp(row.target_at),
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    guildId: row.guild_id,
    goalId: row.goal_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    creatorIdentityId: row.creator_identity_id,
    sourceIds: row.source_ids,
    dueAt: optionalTimestamp(row.due_at),
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function questFromRow(row: QuestRow): Quest {
  return {
    id: row.id,
    guildId: row.guild_id,
    projectId: row.project_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    assigneeIdentityId: row.assignee_identity_id,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    creatorIdentityId: row.creator_identity_id,
    sourceIds: row.source_ids,
    dueAt: optionalTimestamp(row.due_at),
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function stepFromRow(row: StepRow): Step {
  return {
    id: row.id,
    guildId: row.guild_id,
    questId: row.quest_id,
    assigneeIdentityId: row.assignee_identity_id,
    creatorIdentityId: row.creator_identity_id,
    title: row.title,
    description: row.description,
    status: row.status,
    position: row.position,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function assertPageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`Work page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

export class GuildWorkRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listGoals(
    actorIdentityId: string,
    cursor: WorkListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<WorkListPage<Goal>> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<GoalRow>(
      `WITH RECURSIVE ${this.#authorizationCtes()}
       SELECT g.id::text, g.guild_id::text, g.space_id::text, g.owner_identity_id::text,
              g.title, g.description, g.status, g.visibility, g.classification,
              g.allowed_identity_ids::text[], g.source_ids::text[],
              g.creator_identity_id::text, g.target_at::text, g.version,
              g.created_at::text, g.updated_at::text
         FROM goals g CROSS JOIN work_access access
        WHERE g.guild_id = $1 AND ${this.#readPredicate("g")}
          AND ($3::timestamptz IS NULL OR (g.updated_at, g.id) < ($3::timestamptz, $4::uuid))
        ORDER BY g.updated_at DESC, g.id DESC LIMIT $5`,
      [this.#guildId, actorIdentityId, cursor?.updatedAt ?? null, cursor?.id ?? null, pageSize + 1],
    )).rows;
    return this.#page(rows, pageSize, goalFromRow);
  }

  async listProjects(
    actorIdentityId: string,
    goalId: string | null = null,
    cursor: WorkListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<WorkListPage<Project>> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<ProjectRow>(
      `WITH RECURSIVE ${this.#authorizationCtes()}
       SELECT p.id::text, p.guild_id::text, p.goal_id::text, p.space_id::text,
              p.owner_identity_id::text, p.title, p.description, p.status,
              p.visibility, p.classification, p.allowed_identity_ids::text[],
              p.source_ids::text[], p.creator_identity_id::text, p.due_at::text,
              p.version, p.created_at::text, p.updated_at::text
         FROM projects p CROSS JOIN work_access access
        WHERE p.guild_id = $1 AND ${this.#readPredicate("p")}
          AND ($3::uuid IS NULL OR p.goal_id = $3)
          AND ($4::timestamptz IS NULL OR (p.updated_at, p.id) < ($4::timestamptz, $5::uuid))
        ORDER BY p.updated_at DESC, p.id DESC LIMIT $6`,
      [
        this.#guildId,
        actorIdentityId,
        goalId,
        cursor?.updatedAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    return this.#page(rows, pageSize, projectFromRow);
  }

  async listQuests(
    actorIdentityId: string,
    filters: {
      projectId?: string | null;
      assigneeIdentityId?: string | null;
      statuses?: readonly QuestStatus[];
    } = {},
    cursor: WorkListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<WorkListPage<Quest>> {
    assertPageSize(pageSize);
    const statuses = filters.statuses?.length ? filters.statuses : null;
    const rows = (await this.#connection.query<QuestRow>(
      `WITH RECURSIVE ${this.#authorizationCtes()}
       SELECT q.id::text, q.guild_id::text, q.project_id::text, q.space_id::text,
              q.owner_identity_id::text, q.assignee_identity_id::text,
              q.title, q.description, q.status, q.visibility, q.classification,
              q.allowed_identity_ids::text[], q.source_ids::text[],
              q.creator_identity_id::text, q.due_at::text, q.version,
              q.created_at::text, q.updated_at::text
         FROM quests q CROSS JOIN work_access access
        WHERE q.guild_id = $1 AND ${this.#readPredicate("q")}
          AND ($3::uuid IS NULL OR q.project_id = $3)
          AND ($4::uuid IS NULL OR q.assignee_identity_id = $4)
          AND ($5::text[] IS NULL OR q.status = ANY($5::text[]))
          AND ($6::timestamptz IS NULL OR (q.updated_at, q.id) < ($6::timestamptz, $7::uuid))
        ORDER BY q.updated_at DESC, q.id DESC LIMIT $8`,
      [
        this.#guildId,
        actorIdentityId,
        filters.projectId ?? null,
        filters.assigneeIdentityId ?? null,
        statuses,
        cursor?.updatedAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    return this.#page(rows, pageSize, questFromRow);
  }

  async getGoal(id: string, forUpdate = false): Promise<Goal> {
    const row = (await this.#connection.query<GoalRow>(
      `${this.#goalSelect()} WHERE g.guild_id = $1 AND g.id = $2${forUpdate ? " FOR UPDATE OF g" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Goal was not found.");
    return goalFromRow(row);
  }

  async getProject(id: string, forUpdate = false): Promise<Project> {
    const row = (await this.#connection.query<ProjectRow>(
      `${this.#projectSelect()} WHERE p.guild_id = $1 AND p.id = $2${forUpdate ? " FOR UPDATE OF p" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Project was not found.");
    return projectFromRow(row);
  }

  async getQuest(id: string, forUpdate = false): Promise<Quest> {
    const row = (await this.#connection.query<QuestRow>(
      `${this.#questSelect()} WHERE q.guild_id = $1 AND q.id = $2${forUpdate ? " FOR UPDATE OF q" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Quest was not found.");
    return questFromRow(row);
  }

  async getStep(id: string, forUpdate = false): Promise<Step> {
    const row = (await this.#connection.query<StepRow>(
      `${this.#stepSelect()} WHERE s.guild_id = $1 AND s.id = $2${forUpdate ? " FOR UPDATE OF s" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Step was not found.");
    return stepFromRow(row);
  }

  async listSteps(questId: string): Promise<Step[]> {
    return (await this.#connection.query<StepRow>(
      `${this.#stepSelect()} WHERE s.guild_id = $1 AND s.quest_id = $2
       ORDER BY s.position, s.id`,
      [this.#guildId, questId],
    )).rows.map(stepFromRow);
  }

  async createGoal(input: CreateGoalInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, "goal", input.id);
    assertWorkText(input.title, input.description);
    await this.#connection.query(
      `INSERT INTO goals
         (id, guild_id, space_id, owner_identity_id, creator_identity_id,
          title, description, status, visibility, classification,
          allowed_identity_ids, source_ids, target_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10::uuid[], $11::uuid[], $12, 1)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.ownerIdentityId,
        input.actorIdentityId,
        input.title,
        input.description,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.sourceIds,
        input.targetAt,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async createProject(input: CreateProjectInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, "project", input.id);
    assertWorkText(input.title, input.description);
    const goal = await this.getGoal(input.goalId, true);
    if (goal.status === "completed" || goal.status === "cancelled") {
      throw new Error("Projects cannot be added to completed or cancelled Goals.");
    }
    await this.#assertChildLimit("projects", "goal_id", input.goalId, MAX_PROJECTS_PER_GOAL);
    await this.#connection.query(
      `INSERT INTO projects
         (id, guild_id, goal_id, space_id, owner_identity_id, creator_identity_id,
          title, description, status, visibility, classification,
          allowed_identity_ids, source_ids, due_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned', $9, $10,
               $11::uuid[], $12::uuid[], $13, 1)`,
      [
        input.id,
        this.#guildId,
        input.goalId,
        input.spaceId,
        input.ownerIdentityId,
        input.actorIdentityId,
        input.title,
        input.description,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.sourceIds,
        input.dueAt,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async createQuest(input: CreateQuestInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, "quest", input.id);
    assertWorkText(input.title, input.description);
    const project = await this.getProject(input.projectId, true);
    if (project.status === "completed" || project.status === "cancelled") {
      throw new Error("Quests cannot be added to completed or cancelled Projects.");
    }
    await this.#assertChildLimit("quests", "project_id", input.projectId, MAX_QUESTS_PER_PROJECT);
    await this.#connection.query(
      `INSERT INTO quests
         (id, guild_id, project_id, space_id, owner_identity_id, creator_identity_id,
          assignee_identity_id, title, description, status, visibility, classification,
          allowed_identity_ids, source_ids, due_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', $10, $11,
               $12::uuid[], $13::uuid[], $14, 1)`,
      [
        input.id,
        this.#guildId,
        input.projectId,
        input.spaceId,
        input.ownerIdentityId,
        input.actorIdentityId,
        input.assigneeIdentityId,
        input.title,
        input.description,
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.sourceIds,
        input.dueAt,
      ],
    );
    if (input.assigneeIdentityId) {
      await this.#notifyAssignment(input.assigneeIdentityId, "quest", input.id, input.title);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async createStep(input: CreateStepInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, "step", input.id);
    assertWorkText(input.title, input.description);
    const quest = await this.getQuest(input.questId, true);
    if (quest.status === "completed" || quest.status === "cancelled") {
      throw new Error("Steps cannot be added to completed or cancelled Quests.");
    }
    const positionRow = (await this.#connection.query<QueryResultRow & { next_position: number }>(
      `SELECT COALESCE(max(position) + 1, 0)::integer AS next_position
         FROM steps WHERE guild_id = $1 AND quest_id = $2`,
      [this.#guildId, input.questId],
    )).rows[0];
    const position = positionRow?.next_position ?? 0;
    if (position >= MAX_STEPS_PER_QUEST) {
      throw new Error(`A Quest supports at most ${MAX_STEPS_PER_QUEST} Steps.`);
    }
    await this.#connection.query(
      `INSERT INTO steps
         (id, guild_id, quest_id, assignee_identity_id, creator_identity_id,
          title, description, status, position, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, 1)`,
      [
        input.id,
        this.#guildId,
        input.questId,
        input.assigneeIdentityId,
        input.actorIdentityId,
        input.title,
        input.description,
        position,
      ],
    );
    if (input.assigneeIdentityId) {
      await this.#notifyAssignment(input.assigneeIdentityId, "step", input.id, input.title);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return position;
  }

  updateGoalStatus(input: WorkStatusInput<GoalStatus>): Promise<number> {
    return this.#updateStatus("goal", input, assertGoalTransition);
  }

  updateProjectStatus(input: WorkStatusInput<ProjectStatus>): Promise<number> {
    return this.#updateStatus("project", input, assertProjectTransition);
  }

  updateQuestStatus(input: WorkStatusInput<QuestStatus>): Promise<number> {
    return this.#updateStatus("quest", input, assertQuestTransition);
  }

  updateStepStatus(input: WorkStatusInput<StepStatus>): Promise<number> {
    return this.#updateStatus("step", input, assertStepTransition);
  }

  assignQuest(input: WorkAssignmentInput): Promise<number> {
    return this.#assign("quest", input);
  }

  assignStep(input: WorkAssignmentInput): Promise<number> {
    return this.#assign("step", input);
  }

  async #updateStatus<TStatus extends string>(
    kind: "goal" | "project" | "quest" | "step",
    input: WorkStatusInput<TStatus>,
    assertTransition: (current: never, next: never) => void,
  ): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, kind, input.id);
    const table = `${kind}s`;
    const row = await this.#loadStatusRow(table, input.id);
    this.#assertExpectedVersion(row.version, input.expectedVersion);
    assertTransition(row.status as never, input.status as never);
    if (input.status === "completed") await this.#assertChildrenComplete(kind, input.id);
    if (input.status === "cancelled") await this.#assertChildrenInactive(kind, input.id);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE ${table} SET status = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, input.id, input.status, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error(`${kind} changed since it was loaded.`);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async #assign(
    kind: "quest" | "step",
    input: WorkAssignmentInput,
  ): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, kind, input.id);
    const table = `${kind}s`;
    const row = await this.#connection.query<{ title: string; version: number }>(
      `SELECT title, version FROM ${table} WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [this.#guildId, input.id],
    );
    const work = row.rows[0];
    if (!work) throw new GuildDomainError("INVALID_INPUT", `${kind} was not found.`);
    this.#assertExpectedVersion(work.version, input.expectedVersion);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE ${table} SET assignee_identity_id = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, input.id, input.assigneeIdentityId, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error(`${kind} changed since it was loaded.`);
    if (input.assigneeIdentityId) {
      await this.#notifyAssignment(input.assigneeIdentityId, kind, input.id, work.title);
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async #loadStatusRow(table: string, id: string): Promise<{ status: string; version: number }> {
    const row = (await this.#connection.query<{ status: string; version: number }>(
      `SELECT status, version FROM ${table} WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Work item was not found.");
    return row;
  }

  async #assertChildrenComplete(kind: string, id: string): Promise<void> {
    const child = kind === "goal"
      ? { table: "projects", key: "goal_id" }
      : kind === "project" ? { table: "quests", key: "project_id" }
      : kind === "quest" ? { table: "steps", key: "quest_id" }
      : null;
    if (!child) return;
    const result = await this.#connection.query<QueryResultRow>(
      `SELECT 1 FROM ${child.table}
        WHERE guild_id = $1 AND ${child.key} = $2
          AND status NOT IN ('completed', 'cancelled', 'skipped') LIMIT 1`,
      [this.#guildId, id],
    );
    if (result.rows.length > 0) throw new Error("Complete or close every child Work item first.");
  }

  async #assertChildrenInactive(kind: string, id: string): Promise<void> {
    const child = kind === "goal"
      ? { table: "projects", key: "goal_id" }
      : kind === "project" ? { table: "quests", key: "project_id" }
      : kind === "quest" ? { table: "steps", key: "quest_id" }
      : null;
    if (!child) return;
    const result = await this.#connection.query<QueryResultRow>(
      `SELECT 1 FROM ${child.table}
        WHERE guild_id = $1 AND ${child.key} = $2
          AND status NOT IN ('completed', 'cancelled', 'skipped') LIMIT 1`,
      [this.#guildId, id],
    );
    if (result.rows.length > 0) throw new Error("Complete or close every child Work item first.");
  }

  async #assertChildLimit(table: string, parentColumn: string, parentId: string, limit: number) {
    const count = (await this.#connection.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE guild_id = $1 AND ${parentColumn} = $2`,
      [this.#guildId, parentId],
    )).rows[0]?.count;
    if (Number(count ?? 0) >= limit) throw new Error(`${table} child limit reached.`);
  }

  async #notifyAssignment(
    recipientIdentityId: string,
    resourceType: "quest" | "step",
    resourceId: string,
    title: string,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body, resource_type, resource_id)
       VALUES ($1, $2, $3, 'quest', $4, '', $5, $6)`,
      [crypto.randomUUID(), this.#guildId, recipientIdentityId, title, resourceType, resourceId],
    );
  }

  #page<TRow extends { id: string; updated_at: string }, T>(
    rows: readonly TRow[],
    pageSize: number,
    map: (row: TRow) => T,
  ): WorkListPage<T> {
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(map),
      nextCursor: rows.length > pageSize && last
        ? { updatedAt: isoTimestamp(last.updated_at), id: last.id }
        : null,
    };
  }

  #authorizationCtes(): string {
    return `work_actor AS (
              SELECT m.clearance, g.root_owner_identity_id = i.id AS is_root
                FROM identities i
                JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
                JOIN guilds g ON g.id = i.guild_id
               WHERE i.guild_id = $1 AND i.id = $2 AND i.status = 'active'
                 AND m.state IN ('preboarding', 'active')
            ),
            work_grants AS (
              SELECT rb.space_id
                FROM role_bindings rb
                JOIN role_permissions rp ON rp.guild_id = rb.guild_id AND rp.role_id = rb.role_id
                CROSS JOIN work_actor
               WHERE rb.guild_id = $1 AND rb.identity_id = $2 AND rp.permission = 'work.read'
            ),
            work_spaces AS (
              SELECT s.id FROM spaces s
                JOIN work_grants grant_row ON grant_row.space_id = s.id
               WHERE s.guild_id = $1 AND s.status = 'active'
              UNION
              SELECT child.id FROM spaces child
                JOIN work_spaces parent ON child.parent_space_id = parent.id
               WHERE child.guild_id = $1 AND child.status = 'active'
            ),
            work_access AS (
              SELECT work_actor.*,
                     EXISTS (SELECT 1 FROM work_grants WHERE space_id IS NULL) AS has_global_grant
                FROM work_actor
            )`;
  }

  #readPredicate(alias: string): string {
    return `(access.is_root OR access.has_global_grant OR (
              ${alias}.space_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM work_spaces permitted WHERE permitted.id = ${alias}.space_id
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

  #goalSelect(): string {
    return `SELECT g.id::text, g.guild_id::text, g.space_id::text, g.owner_identity_id::text,
                   g.title, g.description, g.status, g.visibility, g.classification,
                   g.allowed_identity_ids::text[], g.source_ids::text[],
                   g.creator_identity_id::text, g.target_at::text, g.version,
                   g.created_at::text, g.updated_at::text FROM goals g`;
  }

  #projectSelect(): string {
    return `SELECT p.id::text, p.guild_id::text, p.goal_id::text, p.space_id::text,
                   p.owner_identity_id::text, p.title, p.description, p.status,
                   p.visibility, p.classification, p.allowed_identity_ids::text[],
                   p.source_ids::text[], p.creator_identity_id::text, p.due_at::text,
                   p.version, p.created_at::text, p.updated_at::text FROM projects p`;
  }

  #questSelect(): string {
    return `SELECT q.id::text, q.guild_id::text, q.project_id::text, q.space_id::text,
                   q.owner_identity_id::text, q.assignee_identity_id::text,
                   q.title, q.description, q.status, q.visibility, q.classification,
                   q.allowed_identity_ids::text[], q.source_ids::text[],
                   q.creator_identity_id::text, q.due_at::text, q.version,
                   q.created_at::text, q.updated_at::text FROM quests q`;
  }

  #stepSelect(): string {
    return `SELECT s.id::text, s.guild_id::text, s.quest_id::text,
                   s.assignee_identity_id::text, s.creator_identity_id::text,
                   s.title, s.description, s.status, s.position, s.version,
                   s.created_at::text, s.updated_at::text FROM steps s`;
  }

  #assertExpectedVersion(current: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
      throw new Error("Work changed since it was loaded. Reload before continuing.");
    }
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    subjectType: string,
    subjectId: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.subjectType !== subjectType || event.subjectId !== subjectId) {
      throw new Error("Work event crosses the active Guild, actor, or subject boundary.");
    }
  }
}
