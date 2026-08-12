import {
  GuildDomainError,
  SUPPORTED_LOCALES,
  assertActivityText,
  assertActivityStatus,
  assertActivityTransition,
  assertActivityType,
  assertMemoryContent,
  assertMemoryType,
  assertNonBlank,
  collectiveTemplate,
  type Activity,
  type ActivityStatus,
  type ActivityType,
  type ActorKind,
  type ActorMembershipState,
  type AppLocale,
  type ChronicleEvent,
  type Classification,
  type CollectiveOnboardingAnswers,
  type CollectiveSettings,
  type CollectiveTemplateKey,
  type CollectiveTemplateLabels,
  type IdentityStatus,
  type LocalizedText,
  type MemoryRecord,
  type MemoryType,
  type MemoryVersion,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface CollectiveListCursor {
  updatedAt: string;
  id: string;
}

export interface ActorListCursor {
  displayName: string;
  id: string;
}

export interface ActorRoleSummary {
  bindingId: string;
  roleId: string;
  roleName: string;
  spaceId: string | null;
}

export interface CollectiveActorSummary {
  id: string;
  kind: ActorKind;
  displayName: string;
  status: IdentityStatus;
  preferredLocale: AppLocale;
  membershipState: ActorMembershipState;
  clearance: Classification;
  operational: boolean;
  roles: readonly ActorRoleSummary[];
  agentStatus: "active" | "stopped" | null;
  agentModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectiveListPage<T> {
  items: readonly T[];
  nextCursor: CollectiveListCursor | null;
}

export interface ActorListPage {
  items: readonly CollectiveActorSummary[];
  nextCursor: ActorListCursor | null;
}

export interface MemorySummary extends MemoryRecord {
  body: LocalizedText;
}

export interface MemoryDetail extends MemorySummary {
  versions: readonly MemoryVersion[];
}

export interface MemorySearchCandidate extends MemorySummary {
  evidenceVersion: number;
}

export interface CollectiveActivity extends Activity {
  compatibilitySourceType: "goal" | "project" | "quest" | "step" | null;
}

export interface CreateMemoryInput {
  id: string;
  actorId: string;
  spaceId: string | null;
  ownerActorId: string;
  type: MemoryType;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  sourceIds: readonly string[];
  confidence: number | null;
  changeNote: string;
  chronicleEvent: ChronicleEvent;
}

export interface SaveMemoryInput {
  memoryId: string;
  actorId: string;
  expectedVersion: number;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  sourceIds: readonly string[];
  changeNote: string;
  chronicleEvent: ChronicleEvent;
}

export interface CreateActivityInput {
  id: string;
  actorId: string;
  parentActivityId: string | null;
  spaceId: string | null;
  ownerActorId: string;
  assigneeActorId: string | null;
  type: ActivityType;
  title: string;
  description: string;
  status: ActivityStatus;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  sourceIds: readonly string[];
  startsAt: string | null;
  dueAt: string | null;
  position: number;
  chronicleEvent: ChronicleEvent;
}

export interface ActivityMutationInput {
  activityId: string;
  actorId: string;
  expectedVersion: number;
  chronicleEvent: ChronicleEvent;
}

export interface MemoryMutationInput {
  memoryId: string;
  actorId: string;
  expectedVersion: number;
  chronicleEvent: ChronicleEvent;
}

export interface ActivityStatusInput extends ActivityMutationInput {
  status: ActivityStatus;
}

export interface ActivityAssignmentInput extends ActivityMutationInput {
  assigneeActorId: string | null;
}

export interface ConfigureCollectiveInput {
  templateKey: CollectiveTemplateKey;
  vocabularyOverrides: Partial<CollectiveTemplateLabels>;
  onboardingAnswers: Partial<CollectiveOnboardingAnswers>;
  actorId: string;
  chronicleEvent: ChronicleEvent;
}

type ActorRow = QueryResultRow & {
  id: string;
  kind: ActorKind;
  display_name: string;
  status: IdentityStatus;
  preferred_locale: AppLocale;
  membership_state: ActorMembershipState;
  clearance: Classification;
  operational: boolean;
  roles: ActorRoleSummary[];
  agent_status: "active" | "stopped" | null;
  agent_model: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_actor_id: string;
  creator_actor_id: string;
  type: MemoryType;
  status: "active" | "archived";
  workflow: "canonical" | null;
  governance_state: MemoryRecord["governanceState"];
  visibility: Visibility;
  classification: Classification;
  allowed_actor_ids: string[];
  current_version: number;
  confidence: string | null;
  source_ids: string[];
  review_due_at: string | null;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  evidence_version: number;
  created_at: string;
  updated_at: string;
};

type MemoryVersionRow = QueryResultRow & {
  guild_id: string;
  memory_id: string;
  version: number;
  title: LocalizedText;
  summary: LocalizedText;
  body: LocalizedText;
  source_ids: string[];
  created_by_actor_id: string;
  created_at: string;
};

type ActivityRow = QueryResultRow & {
  id: string;
  guild_id: string;
  parent_activity_id: string | null;
  space_id: string | null;
  owner_actor_id: string;
  creator_actor_id: string;
  assignee_actor_id: string | null;
  type: ActivityType;
  title: string;
  description: string;
  status: ActivityStatus;
  visibility: Visibility;
  classification: Classification;
  allowed_actor_ids: string[];
  source_ids: string[];
  starts_at: string | null;
  due_at: string | null;
  position: number;
  version: number;
  legacy_source_type: CollectiveActivity["compatibilitySourceType"];
  created_at: string;
  updated_at: string;
};

type SettingsRow = QueryResultRow & {
  guild_id: string;
  template_key: CollectiveTemplateKey;
  template_version: number;
  vocabulary_overrides: Partial<CollectiveTemplateLabels>;
  onboarding_answers: Partial<CollectiveOnboardingAnswers>;
  updated_by_actor_id: string | null;
  updated_at: string;
};

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_MEMORY_VERSIONS = 100;

function isoTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return date.toISOString();
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function assertPageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

function actorFromRow(row: ActorRow): CollectiveActorSummary {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    status: row.status,
    preferredLocale: row.preferred_locale,
    membershipState: row.membership_state,
    clearance: row.clearance,
    operational: row.operational,
    roles: row.roles,
    agentStatus: row.agent_status,
    agentModel: row.agent_model,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function memoryFromRow(row: MemoryRow): MemorySummary {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerActorId: row.owner_actor_id,
    createdByActorId: row.creator_actor_id,
    type: row.type,
    status: row.status,
    workflow: row.workflow,
    governanceState: row.governance_state,
    visibility: row.visibility,
    classification: row.classification,
    allowedActorIds: row.allowed_actor_ids,
    currentVersion: row.current_version,
    confidence: row.confidence === null ? null : Number(row.confidence),
    sourceIds: row.source_ids,
    title: row.title,
    summary: row.summary,
    body: row.body,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function memoryVersionFromRow(row: MemoryVersionRow): MemoryVersion {
  return {
    guildId: row.guild_id,
    memoryId: row.memory_id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    body: row.body,
    sourceIds: row.source_ids,
    createdByActorId: row.created_by_actor_id,
    createdAt: isoTimestamp(row.created_at),
  };
}

function activityFromRow(row: ActivityRow): CollectiveActivity {
  return {
    id: row.id,
    guildId: row.guild_id,
    parentActivityId: row.parent_activity_id,
    spaceId: row.space_id,
    ownerActorId: row.owner_actor_id,
    creatorActorId: row.creator_actor_id,
    assigneeActorId: row.assignee_actor_id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedActorIds: row.allowed_actor_ids,
    sourceIds: row.source_ids,
    startsAt: optionalTimestamp(row.starts_at),
    dueAt: optionalTimestamp(row.due_at),
    position: row.position,
    version: row.version,
    compatibilitySourceType: row.legacy_source_type,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export class GuildCollectiveRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async getSettings(): Promise<CollectiveSettings> {
    const row = (await this.#connection.query<SettingsRow>(
      `SELECT guild_id::text, template_key, template_version,
              vocabulary_overrides, onboarding_answers,
              updated_by_actor_id::text, updated_at::text
         FROM guild_collective_settings
        WHERE guild_id = $1`,
      [this.#guildId],
    )).rows[0];
    if (!row) throw new Error("Collective settings are unavailable.");
    collectiveTemplate(row.template_key);
    return {
      guildId: row.guild_id,
      templateKey: row.template_key,
      templateVersion: row.template_version,
      vocabularyOverrides: row.vocabulary_overrides,
      onboardingAnswers: row.onboarding_answers,
      updatedByActorId: row.updated_by_actor_id,
      updatedAt: isoTimestamp(row.updated_at),
    };
  }

  async configure(input: ConfigureCollectiveInput): Promise<CollectiveSettings> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "collective", this.#guildId);
    collectiveTemplate(input.templateKey);
    this.#assertPlainStringMap(input.vocabularyOverrides, "Vocabulary overrides", 200);
    this.#assertPlainStringMap(input.onboardingAnswers, "Onboarding answers", 2_000);
    const row = (await this.#connection.query<SettingsRow>(
      `UPDATE guild_collective_settings
          SET template_key = $2,
              template_version = template_version + 1,
              vocabulary_overrides = $3::jsonb,
              onboarding_answers = $4::jsonb,
              updated_by_actor_id = $5
        WHERE guild_id = $1
      RETURNING guild_id::text, template_key, template_version,
                vocabulary_overrides, onboarding_answers,
                updated_by_actor_id::text, updated_at::text`,
      [
        this.#guildId,
        input.templateKey,
        JSON.stringify(input.vocabularyOverrides),
        JSON.stringify(input.onboardingAnswers),
        input.actorId,
      ],
    )).rows[0];
    if (!row) throw new Error("Collective settings are unavailable.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return this.getSettings();
  }

  async setSpaceVocabulary(
    spaceId: string,
    profileKey: string | null,
    actorId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorId, "space", spaceId);
    const result = await this.#connection.query(
      `UPDATE spaces SET vocabulary_profile_key = $3
        WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, spaceId, profileKey],
    );
    if (result.rowCount !== 1) throw new Error("Space was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async listActors(
    cursor: ActorListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<ActorListPage> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<ActorRow>(
      `SELECT actor.id::text, actor.kind, actor.display_name, actor.status,
              actor.preferred_locale, membership.state AS membership_state,
              membership.clearance, membership.operational,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'bindingId', binding.id::text,
                    'roleId', role.id::text,
                    'roleName', role.name,
                    'spaceId', binding.space_id::text
                  ) ORDER BY role.name, binding.id
                ) FILTER (WHERE binding.id IS NOT NULL),
                '[]'::jsonb
              ) AS roles,
              agent.status AS agent_status, agent.model AS agent_model,
              actor.created_at::text, actor.updated_at::text
         FROM actors actor
         JOIN actor_memberships membership
           ON membership.actor_id = actor.id AND membership.guild_id = $1
         LEFT JOIN actor_role_bindings binding
           ON binding.guild_id = membership.guild_id AND binding.actor_id = actor.id
         LEFT JOIN roles role
           ON role.guild_id = binding.guild_id AND role.id = binding.role_id
         LEFT JOIN actor_agent_profiles agent
           ON agent.guild_id = membership.guild_id AND agent.actor_id = actor.id
        WHERE ($2::text IS NULL OR (actor.display_name, actor.id) > ($2::text, $3::uuid))
        GROUP BY actor.id, membership.state, membership.clearance,
                 membership.operational, agent.status, agent.model
        ORDER BY actor.display_name, actor.id
        LIMIT $4`,
      [this.#guildId, cursor?.displayName ?? null, cursor?.id ?? null, pageSize + 1],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(actorFromRow),
      nextCursor: rows.length > pageSize && last
        ? { displayName: last.display_name, id: last.id }
        : null,
    };
  }

  async listMemories(
    actorId: string,
    options: {
      cursor?: CollectiveListCursor | null;
      pageSize?: number;
      type?: MemoryType | null;
      search?: string | null;
      includeArchived?: boolean;
    } = {},
  ): Promise<CollectiveListPage<MemorySummary>> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    assertPageSize(pageSize);
    if (options.type) assertMemoryType(options.type);
    const search = options.search?.trim() || null;
    const rows = (await this.#connection.query<MemoryRow>(
      `WITH RECURSIVE ${this.#authorizationCtes("memory", "memory.read")}
       ${this.#memorySelect()}
         CROSS JOIN memory_access access
        WHERE memory.guild_id = $1 AND ${this.#readPredicate("memory", "memory")}
          AND ($3::text IS NULL OR memory.type = $3)
          AND ($4::boolean OR memory.status <> 'archived')
          AND ($5::text IS NULL OR to_tsvector('simple',
                version.title::text || ' ' || version.summary::text || ' ' || version.body::text
              ) @@ plainto_tsquery('simple', $5))
          AND ($6::timestamptz IS NULL OR
               (memory.updated_at, memory.id) < ($6::timestamptz, $7::uuid))
        ORDER BY memory.updated_at DESC, memory.id DESC
        LIMIT $8`,
      [
        this.#guildId,
        actorId,
        options.type ?? null,
        options.includeArchived ?? false,
        search,
        options.cursor?.updatedAt ?? null,
        options.cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    return this.#page(rows, pageSize, memoryFromRow);
  }

  async searchAuthorizedMemories(
    actorId: string,
    query: string,
    locale: AppLocale = "en",
    limit = 24,
  ): Promise<readonly MemorySearchCandidate[]> {
    assertNonBlank(query, "Memory search query", 500);
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
      throw new Error("Memory search locale is unsupported.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Memory search limit must be between 1 and 50.");
    }
    const rows = (await this.#connection.query<MemoryRow>(
      `WITH RECURSIVE ${this.#authorizationCtes("memory", "memory.read")},
       search AS (
         SELECT CASE WHEN $4::text = 'en'
                THEN 'english'::regconfig ELSE 'simple'::regconfig END AS config
       ), search_terms AS (
         SELECT search.config, websearch_to_tsquery(search.config, $3) AS terms
           FROM search
       )
       ${this.#memorySelect(
         "CASE WHEN memory.workflow = 'canonical' THEN memory.canonical_version ELSE memory.current_version END",
       )}
         CROSS JOIN memory_access access
         CROSS JOIN search_terms
        WHERE memory.guild_id = $1 AND ${this.#readPredicate("memory", "memory")}
          AND memory.status = 'active'
          AND (memory.workflow IS NULL OR (
            memory.canonical_version IS NOT NULL
            AND memory.governance_state NOT IN ('deprecated', 'archived')
          ))
          AND (
            numnode(search_terms.terms) > 0
              AND to_tsvector(search_terms.config,
                version.title::text || ' ' || version.summary::text || ' ' || version.body::text
              ) @@ search_terms.terms
            OR lower(version.title::text || ' ' || version.summary::text || ' ' || version.body::text)
                 LIKE '%' || lower($3) || '%'
          )
        ORDER BY
          CASE WHEN lower(version.title::text) LIKE '%' || lower($3) || '%' THEN 1 ELSE 0 END DESC,
          ts_rank(
            to_tsvector(search_terms.config,
              version.title::text || ' ' || version.summary::text || ' ' || version.body::text),
            search_terms.terms
          ) DESC,
          memory.updated_at DESC, memory.id
        LIMIT $5`,
      [this.#guildId, actorId, query, locale, limit],
    )).rows;
    return rows.map((row) => ({
      ...memoryFromRow(row),
      evidenceVersion: row.evidence_version,
    }));
  }

  async getMemory(memoryId: string, forUpdate = false): Promise<MemoryDetail> {
    const row = (await this.#connection.query<MemoryRow>(
      `${this.#memorySelect()} WHERE memory.guild_id = $1 AND memory.id = $2${
        forUpdate ? " FOR UPDATE OF memory" : ""
      }`,
      [this.#guildId, memoryId],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Memory was not found.");
    const versions = (await this.#connection.query<MemoryVersionRow>(
      `SELECT guild_id::text, memory_id::text, version, title, summary, body,
              source_ids::text[], created_by_actor_id::text, created_at::text
         FROM memory_versions
        WHERE guild_id = $1 AND memory_id = $2
        ORDER BY version DESC LIMIT $3`,
      [this.#guildId, memoryId, MAX_MEMORY_VERSIONS],
    )).rows;
    return { ...memoryFromRow(row), versions: versions.map(memoryVersionFromRow) };
  }

  async createMemory(input: CreateMemoryInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "memory", input.id);
    assertMemoryType(input.type);
    assertMemoryContent(input.title, input.summary, input.body);
    this.#assertConfidence(input.confidence);
    await this.#connection.query(
      `INSERT INTO memories
         (id, guild_id, space_id, owner_actor_id, creator_actor_id, type,
          status, workflow, governance_state, visibility, classification,
          allowed_actor_ids, current_version, confidence, source_ids)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NULL, NULL, $7, $8,
               $9::uuid[], 1, $10, $11::uuid[])`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.ownerActorId,
        input.actorId,
        input.type,
        input.visibility,
        input.classification,
        input.allowedActorIds,
        input.confidence,
        input.sourceIds,
      ],
    );
    await this.#connection.query(
      `INSERT INTO memory_versions
         (guild_id, memory_id, version, title, summary, body, source_ids,
          change_note, created_by_actor_id)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb, $6::uuid[], $7, $8)`,
      [
        this.#guildId,
        input.id,
        JSON.stringify(input.title),
        JSON.stringify(input.summary),
        JSON.stringify(input.body),
        input.sourceIds,
        input.changeNote,
        input.actorId,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async saveMemory(input: SaveMemoryInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "memory", input.memoryId);
    assertMemoryContent(input.title, input.summary, input.body);
    const memory = await this.getMemory(input.memoryId, true);
    this.#assertDirectMemory(memory);
    this.#assertExpectedVersion(memory.currentVersion, input.expectedVersion, "Memory");
    const version = input.expectedVersion + 1;
    await this.#connection.query(
      `INSERT INTO memory_versions
         (guild_id, memory_id, version, title, summary, body, source_ids,
          change_note, created_by_actor_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::uuid[], $8, $9)`,
      [
        this.#guildId,
        input.memoryId,
        version,
        JSON.stringify(input.title),
        JSON.stringify(input.summary),
        JSON.stringify(input.body),
        input.sourceIds,
        input.changeNote,
        input.actorId,
      ],
    );
    const result = await this.#connection.query(
      `UPDATE memories
          SET current_version = $3, source_ids = $4::uuid[]
        WHERE guild_id = $1 AND id = $2 AND current_version = $5`,
      [this.#guildId, input.memoryId, version, input.sourceIds, input.expectedVersion],
    );
    if (result.rowCount !== 1) {
      throw new Error("Memory changed since it was loaded. Reload before continuing.");
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async archiveMemory(input: MemoryMutationInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "memory", input.memoryId);
    const memory = await this.getMemory(input.memoryId, true);
    this.#assertDirectMemory(memory);
    this.#assertExpectedVersion(memory.currentVersion, input.expectedVersion, "Memory");
    const result = await this.#connection.query(
      `UPDATE memories SET status = 'archived'
        WHERE guild_id = $1 AND id = $2 AND current_version = $3 AND status <> 'archived'`,
      [this.#guildId, input.memoryId, input.expectedVersion],
    );
    if (result.rowCount !== 1) throw new Error("Memory could not be archived.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return input.expectedVersion;
  }

  async listActivities(
    actorId: string,
    options: {
      cursor?: CollectiveListCursor | null;
      pageSize?: number;
      parentActivityId?: string | null;
      assigneeActorId?: string | null;
      types?: readonly ActivityType[];
      statuses?: readonly ActivityStatus[];
      search?: string | null;
    } = {},
  ): Promise<CollectiveListPage<CollectiveActivity>> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    assertPageSize(pageSize);
    const types = options.types?.length ? options.types : null;
    types?.forEach(assertActivityType);
    const statuses = options.statuses?.length ? options.statuses : null;
    const search = options.search?.trim() || null;
    const rows = (await this.#connection.query<ActivityRow>(
      `WITH RECURSIVE ${this.#authorizationCtes("activity", "activity.read")}
       ${this.#activitySelect()}
         CROSS JOIN activity_access access
        WHERE activity.guild_id = $1 AND ${this.#readPredicate("activity", "activity")}
          AND ($3::uuid IS NULL OR activity.parent_activity_id = $3)
          AND ($4::uuid IS NULL OR activity.assignee_actor_id = $4)
          AND ($5::text[] IS NULL OR activity.type = ANY($5::text[]))
          AND ($6::text[] IS NULL OR activity.status = ANY($6::text[]))
          AND ($7::text IS NULL OR to_tsvector('simple',
                activity.title || ' ' || activity.description
              ) @@ plainto_tsquery('simple', $7))
          AND ($8::timestamptz IS NULL OR
               (activity.updated_at, activity.id) < ($8::timestamptz, $9::uuid))
        ORDER BY activity.updated_at DESC, activity.id DESC
        LIMIT $10`,
      [
        this.#guildId,
        actorId,
        options.parentActivityId ?? null,
        options.assigneeActorId ?? null,
        types,
        statuses,
        search,
        options.cursor?.updatedAt ?? null,
        options.cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    return this.#page(rows, pageSize, activityFromRow);
  }

  async getActivity(activityId: string, forUpdate = false): Promise<CollectiveActivity> {
    const row = (await this.#connection.query<ActivityRow>(
      `${this.#activitySelect()} WHERE activity.guild_id = $1 AND activity.id = $2${
        forUpdate ? " FOR UPDATE OF activity" : ""
      }`,
      [this.#guildId, activityId],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Activity was not found.");
    return activityFromRow(row);
  }

  async createActivity(input: CreateActivityInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.id);
    assertActivityType(input.type);
    assertActivityStatus(input.status);
    assertActivityText(input.title, input.description);
    if (!Number.isSafeInteger(input.position) || input.position < 0) {
      throw new GuildDomainError("INVALID_INPUT", "Activity position must be a positive integer.");
    }
    if (input.parentActivityId) {
      const parent = await this.getActivity(input.parentActivityId, true);
      this.#assertDirectActivity(parent);
      if (parent.spaceId !== input.spaceId) {
        throw new GuildDomainError(
          "INVALID_INPUT",
          "A child Activity cannot broaden its parent Space.",
        );
      }
    }
    if (input.assigneeActorId) await this.#assertAssignee(input.assigneeActorId);
    await this.#connection.query(
      `INSERT INTO activities
         (id, guild_id, parent_activity_id, space_id, owner_actor_id,
          creator_actor_id, assignee_actor_id, type, title, description, status,
          visibility, classification, allowed_actor_ids, source_ids,
          starts_at, due_at, position, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14::uuid[], $15::uuid[], $16, $17, $18, 1)`,
      [
        input.id,
        this.#guildId,
        input.parentActivityId,
        input.spaceId,
        input.ownerActorId,
        input.actorId,
        input.assigneeActorId,
        input.type,
        input.title,
        input.description,
        input.status,
        input.visibility,
        input.classification,
        input.allowedActorIds,
        input.sourceIds,
        input.startsAt,
        input.dueAt,
        input.position,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async changeActivityStatus(input: ActivityStatusInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.activityId);
    const activity = await this.getActivity(input.activityId, true);
    this.#assertDirectActivity(activity);
    this.#assertExpectedVersion(activity.version, input.expectedVersion, "Activity");
    assertActivityTransition(activity.status, input.status);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE activities SET status = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, input.activityId, input.status, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Activity changed since it was loaded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async assignActivity(input: ActivityAssignmentInput): Promise<number> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.activityId);
    const activity = await this.getActivity(input.activityId, true);
    this.#assertDirectActivity(activity);
    this.#assertExpectedVersion(activity.version, input.expectedVersion, "Activity");
    if (input.assigneeActorId) await this.#assertAssignee(input.assigneeActorId);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE activities SET assignee_actor_id = $3, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $4 RETURNING version`,
      [this.#guildId, input.activityId, input.assigneeActorId, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Activity changed since it was loaded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async #assertAssignee(actorId: string): Promise<void> {
    const row = (await this.#connection.query<{ operational: boolean }>(
      `SELECT membership.operational
         FROM actor_memberships membership
         JOIN actors actor ON actor.id = membership.actor_id
        WHERE membership.guild_id = $1 AND membership.actor_id = $2
          AND membership.state IN ('joined', 'active')
          AND membership.operational = true AND actor.status = 'active'`,
      [this.#guildId, actorId],
    )).rows[0];
    if (!row?.operational) {
      throw new GuildDomainError("INVALID_INPUT", "Assignee is not operational in this Guild.");
    }
  }

  #page<TRow extends { id: string; updated_at: string }, T>(
    rows: readonly TRow[],
    pageSize: number,
    map: (row: TRow) => T,
  ): CollectiveListPage<T> {
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(map),
      nextCursor: rows.length > pageSize && last
        ? { updatedAt: isoTimestamp(last.updated_at), id: last.id }
        : null,
    };
  }

  #authorizationCtes(namespace: "memory" | "activity", permission: string): string {
    return `${namespace}_actor AS (
              SELECT membership.clearance,
                     guild.root_owner_identity_id = actor.id AS is_root
                FROM actors actor
                JOIN actor_memberships membership
                  ON membership.actor_id = actor.id AND membership.guild_id = $1
                JOIN guilds guild ON guild.id = membership.guild_id
               WHERE actor.id = $2 AND actor.status = 'active'
                 AND membership.state IN ('joined', 'active')
                 AND membership.operational = true
            ),
            ${namespace}_grants AS (
              SELECT binding.space_id
                FROM actor_role_bindings binding
                JOIN role_permissions role_permission
                  ON role_permission.guild_id = binding.guild_id
                 AND role_permission.role_id = binding.role_id
                CROSS JOIN ${namespace}_actor
               WHERE binding.guild_id = $1 AND binding.actor_id = $2
                 AND role_permission.permission = '${permission}'
            ),
            ${namespace}_spaces AS (
              SELECT space.id FROM spaces space
                JOIN ${namespace}_grants grant_row ON grant_row.space_id = space.id
               WHERE space.guild_id = $1 AND space.status = 'active'
              UNION
              SELECT child.id FROM spaces child
                JOIN ${namespace}_spaces parent ON child.parent_space_id = parent.id
               WHERE child.guild_id = $1 AND child.status = 'active'
            ),
            ${namespace}_access AS (
              SELECT ${namespace}_actor.*,
                     EXISTS (
                       SELECT 1 FROM ${namespace}_grants WHERE space_id IS NULL
                     ) AS has_global_grant
                FROM ${namespace}_actor
            )`;
  }

  #readPredicate(alias: string, namespace: "memory" | "activity"): string {
    return `(access.is_root OR access.has_global_grant OR (
              ${alias}.space_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM ${namespace}_spaces permitted
                 WHERE permitted.id = ${alias}.space_id
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
              OR ${alias}.owner_actor_id = $2
              OR $2::uuid = ANY(${alias}.allowed_actor_ids))`;
  }

  #memorySelect(versionExpression = "memory.current_version"): string {
    return `SELECT memory.id::text, memory.guild_id::text, memory.space_id::text,
                   memory.owner_actor_id::text, memory.creator_actor_id::text,
                   memory.type, memory.status, memory.workflow,
                   memory.governance_state, memory.visibility, memory.classification,
                   memory.allowed_actor_ids::text[], memory.current_version,
                   memory.confidence::text, memory.source_ids::text[],
                   memory.review_due_at::text, version.title, version.summary,
                   version.body, version.version AS evidence_version,
                   memory.created_at::text, memory.updated_at::text
              FROM memories memory
              JOIN memory_versions version
                ON version.guild_id = memory.guild_id
               AND version.memory_id = memory.id
               AND version.version = ${versionExpression}`;
  }

  #activitySelect(): string {
    return `SELECT activity.id::text, activity.guild_id::text,
                   activity.parent_activity_id::text, activity.space_id::text,
                   activity.owner_actor_id::text, activity.creator_actor_id::text,
                   activity.assignee_actor_id::text, activity.type, activity.title,
                   activity.description, activity.status, activity.visibility,
                   activity.classification, activity.allowed_actor_ids::text[],
                   activity.source_ids::text[], activity.starts_at::text,
                   activity.due_at::text, activity.position, activity.version,
                   activity.legacy_source_type,
                   activity.created_at::text, activity.updated_at::text
              FROM activities activity`;
  }

  #assertDirectMemory(memory: MemoryRecord): void {
    if (memory.workflow !== null) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Governed Knowledge must be changed through its approval workflow.",
      );
    }
  }

  #assertDirectActivity(activity: CollectiveActivity): void {
    if (activity.compatibilitySourceType !== null) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Structured legacy Work must be changed through its compatibility workflow.",
      );
    }
  }

  #assertExpectedVersion(current: number, expected: number, label: string): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
      throw new Error(`${label} changed since it was loaded. Reload before continuing.`);
    }
  }

  #assertConfidence(confidence: number | null): void {
    if (confidence !== null &&
        (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new GuildDomainError("INVALID_INPUT", "Memory confidence must be between 0 and 1.");
    }
  }

  #assertPlainStringMap(
    value: Readonly<Record<string, unknown>>,
    label: string,
    maxLength: number,
  ): void {
    if (Object.values(value).some((entry) =>
      typeof entry !== "string" || entry.length > maxLength)) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        `${label} may only contain strings up to ${maxLength} characters.`,
      );
    }
  }

  #assertEvent(
    event: ChronicleEvent,
    actorId: string,
    subjectType: string,
    subjectId: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorId ||
        event.subjectType !== subjectType || event.subjectId !== subjectId) {
      throw new Error("Collective event crosses the active Guild, actor, or subject boundary.");
    }
  }
}
