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
  type ActivityDependency,
  type ActivityOutcome,
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
  type MemoryLayer,
  type JsonObject,
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

export interface ActivityReference {
  id: string;
  title: string;
  status: ActivityStatus;
}

export interface CollectiveActivityDependency {
  dependency: ActivityDependency;
  activity: ActivityReference;
  dependsOnActivity: ActivityReference;
}

export interface CollectiveActivityGraph {
  dependencies: readonly CollectiveActivityDependency[];
  dependents: readonly CollectiveActivityDependency[];
  outcome: ActivityOutcome | null;
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
  custody?: "guild" | "personal";
  layer?: Exclude<MemoryLayer, "canonical">;
  provenance?: JsonObject;
  lastVerifiedAt?: string | null;
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

export interface AddActivityDependencyInput extends ActivityMutationInput {
  id: string;
  dependsOnActivityId: string;
  kind: ActivityDependency["kind"];
}

export interface RemoveActivityDependencyInput extends ActivityMutationInput {
  dependencyId: string;
  expectedDependencyVersion: number;
}

export interface CompleteActivityInput extends ActivityMutationInput {
  summary: string;
  evidenceSourceIds: readonly string[];
}

export interface ActivityGraphMutationResult {
  activityVersion: number;
  dependency: ActivityDependency;
}

export interface ActivityCompletionResult {
  activityVersion: number;
  outcome: ActivityOutcome;
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
  layer: MemoryLayer;
  visibility: Visibility;
  classification: Classification;
  allowed_actor_ids: string[];
  current_version: number;
  confidence: string | null;
  provenance: JsonObject;
  last_verified_at: string | null;
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

type ActivityDependencyRow = QueryResultRow & {
  id: string;
  guild_id: string;
  activity_id: string;
  depends_on_activity_id: string;
  kind: ActivityDependency["kind"];
  status: ActivityDependency["status"];
  version: number;
  created_by_actor_id: string;
  updated_by_actor_id: string;
  revoked_by_actor_id: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type ActivityDependencyViewRow = ActivityDependencyRow & {
  activity_title: string;
  activity_status: ActivityStatus;
  depends_on_activity_title: string;
  depends_on_activity_status: ActivityStatus;
};

type ActivityOutcomeRow = QueryResultRow & {
  guild_id: string;
  activity_id: string;
  version: number;
  activity_version: number;
  summary: string;
  evidence_source_ids: string[];
  completed_by_actor_id: string;
  completed_at: string;
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
    layer: row.layer,
    visibility: row.visibility,
    classification: row.classification,
    allowedActorIds: row.allowed_actor_ids,
    currentVersion: row.current_version,
    confidence: row.confidence === null ? null : Number(row.confidence),
    provenance: row.provenance,
    lastVerifiedAt: optionalTimestamp(row.last_verified_at),
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

function activityDependencyFromRow(row: ActivityDependencyRow): ActivityDependency {
  return {
    id: row.id,
    guildId: row.guild_id,
    activityId: row.activity_id,
    dependsOnActivityId: row.depends_on_activity_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    createdByActorId: row.created_by_actor_id,
    updatedByActorId: row.updated_by_actor_id,
    revokedByActorId: row.revoked_by_actor_id,
    revokedAt: optionalTimestamp(row.revoked_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function activityOutcomeFromRow(row: ActivityOutcomeRow): ActivityOutcome {
  return {
    guildId: row.guild_id,
    activityId: row.activity_id,
    version: row.version,
    activityVersion: row.activity_version,
    summary: row.summary,
    evidenceSourceIds: row.evidence_source_ids,
    completedByActorId: row.completed_by_actor_id,
    completedAt: isoTimestamp(row.completed_at),
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
    embedding: readonly number[] | null = null,
    embeddingModel = "@cf/baai/bge-m3",
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
       ), query_embedding AS (
         SELECT CASE WHEN $6::text IS NULL THEN NULL::vector ELSE $6::vector END AS value
       )
       ${this.#memorySelect(
         "CASE WHEN memory.workflow = 'canonical' THEN memory.canonical_version ELSE memory.current_version END",
       )}
         CROSS JOIN memory_access access
         CROSS JOIN search_terms
         CROSS JOIN query_embedding
         LEFT JOIN memory_embeddings semantic
           ON semantic.guild_id = memory.guild_id
          AND semantic.memory_id = memory.id
          AND semantic.memory_version = version.version
          AND semantic.locale = $4
          AND semantic.model = $7
         JOIN resource_custody custody
           ON custody.guild_id = memory.guild_id
          AND custody.resource_type = 'memory' AND custody.resource_id = memory.id
          AND custody.custody IN ('guild', 'shared')
        WHERE memory.guild_id = $1 AND ${this.#readPredicate("memory", "memory")}
          AND memory.status = 'active'
          AND (memory.workflow IS NULL OR (
            memory.canonical_version IS NOT NULL
            AND memory.governance_state NOT IN ('deprecated', 'archived')
          ))
          AND (query_embedding.value IS NOT NULL OR (
            numnode(search_terms.terms) > 0
              AND to_tsvector(search_terms.config,
                version.title::text || ' ' || version.summary::text || ' ' || version.body::text
              ) @@ search_terms.terms
            OR lower(version.title::text || ' ' || version.summary::text || ' ' || version.body::text)
                 LIKE '%' || lower($3) || '%'
          ))
        ORDER BY
          CASE memory.layer WHEN 'canonical' THEN 3 WHEN 'working' THEN 2 ELSE 1 END DESC,
          CASE WHEN query_embedding.value IS NULL OR semantic.embedding IS NULL THEN 0
               ELSE 1 - (semantic.embedding <=> query_embedding.value) END DESC,
          CASE WHEN lower(version.title::text) LIKE '%' || lower($3) || '%' THEN 1 ELSE 0 END DESC,
          ts_rank(
            to_tsvector(search_terms.config,
              version.title::text || ' ' || version.summary::text || ' ' || version.body::text),
            search_terms.terms
          ) DESC,
          memory.updated_at DESC, memory.id
        LIMIT $5`,
      [
        this.#guildId,
        actorId,
        query,
        locale,
        limit,
        embedding === null ? null : `[${embedding.join(",")}]`,
        embeddingModel,
      ],
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
          allowed_actor_ids, current_version, confidence, source_ids, layer,
          provenance, last_verified_at, origin_custody)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NULL, NULL, $7, $8,
               $9::uuid[], 1, $10, $11::uuid[], $12, $13::jsonb, $14, $15)`,
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
        input.layer ?? (input.type === "external" ? "external" : "working"),
        JSON.stringify(input.provenance ?? {}),
        input.lastVerifiedAt ?? null,
        input.custody ?? "guild",
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

  async listActivityGraphs(
    actorId: string,
    activityIds: readonly string[],
  ): Promise<ReadonlyMap<string, CollectiveActivityGraph>> {
    const uniqueIds = [...new Set(activityIds)];
    if (uniqueIds.length > MAX_PAGE_SIZE) {
      throw new GuildDomainError("INVALID_INPUT", "Too many Activity graphs were requested.");
    }
    const graphs = new Map<string, {
      dependencies: CollectiveActivityDependency[];
      dependents: CollectiveActivityDependency[];
      outcome: ActivityOutcome | null;
    }>();
    for (const activityId of uniqueIds) {
      graphs.set(activityId, { dependencies: [], dependents: [], outcome: null });
    }
    if (uniqueIds.length === 0) return graphs;

    const visibleActivitiesCte = `${this.#authorizationCtes("activity", "activity.read")},
      visible_activities AS (
        SELECT activity.id, activity.title, activity.status
          FROM activities activity
          CROSS JOIN activity_access access
         WHERE activity.guild_id = $1 AND ${this.#readPredicate("activity", "activity")}
      )`;
    const dependencyRows = (await this.#connection.query<ActivityDependencyViewRow>(
      `WITH RECURSIVE ${visibleActivitiesCte}
       SELECT dependency.id::text, dependency.guild_id::text,
              dependency.activity_id::text, dependency.depends_on_activity_id::text,
              dependency.kind, dependency.status, dependency.version,
              dependency.created_by_actor_id::text, dependency.updated_by_actor_id::text,
              dependency.revoked_by_actor_id::text, dependency.revoked_at::text,
              dependency.created_at::text, dependency.updated_at::text,
              activity.title AS activity_title, activity.status AS activity_status,
              predecessor.title AS depends_on_activity_title,
              predecessor.status AS depends_on_activity_status
         FROM activity_dependencies dependency
         JOIN visible_activities activity ON activity.id = dependency.activity_id
         JOIN visible_activities predecessor
           ON predecessor.id = dependency.depends_on_activity_id
        WHERE dependency.guild_id = $1 AND dependency.status = 'active'
          AND (dependency.activity_id = ANY($3::uuid[])
            OR dependency.depends_on_activity_id = ANY($3::uuid[]))
        ORDER BY dependency.created_at, dependency.id`,
      [this.#guildId, actorId, uniqueIds],
    )).rows;

    for (const row of dependencyRows) {
      const view: CollectiveActivityDependency = {
        dependency: activityDependencyFromRow(row),
        activity: {
          id: row.activity_id,
          title: row.activity_title,
          status: row.activity_status,
        },
        dependsOnActivity: {
          id: row.depends_on_activity_id,
          title: row.depends_on_activity_title,
          status: row.depends_on_activity_status,
        },
      };
      graphs.get(row.activity_id)?.dependencies.push(view);
      graphs.get(row.depends_on_activity_id)?.dependents.push(view);
    }

    const outcomeRows = (await this.#connection.query<ActivityOutcomeRow>(
      `WITH RECURSIVE ${visibleActivitiesCte}
       SELECT DISTINCT ON (outcome.activity_id)
              outcome.guild_id::text, outcome.activity_id::text,
              outcome.version, outcome.activity_version, outcome.summary,
              outcome.evidence_source_ids::text[],
              outcome.completed_by_actor_id::text, outcome.completed_at::text
         FROM activity_outcomes outcome
         JOIN visible_activities activity ON activity.id = outcome.activity_id
        WHERE outcome.guild_id = $1 AND outcome.activity_id = ANY($3::uuid[])
        ORDER BY outcome.activity_id, outcome.version DESC`,
      [this.#guildId, actorId, uniqueIds],
    )).rows;
    for (const row of outcomeRows) {
      const graph = graphs.get(row.activity_id);
      if (graph) graph.outcome = activityOutcomeFromRow(row);
    }
    return graphs;
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
    if (input.status === "completed") {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Complete an Activity with an outcome instead of changing its status directly.",
      );
    }
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

  async getActivityDependency(
    dependencyId: string,
    forUpdate = false,
  ): Promise<ActivityDependency> {
    const row = (await this.#connection.query<ActivityDependencyRow>(
      `${this.#activityDependencySelect()}
        WHERE dependency.guild_id = $1 AND dependency.id = $2${
        forUpdate ? " FOR UPDATE OF dependency" : ""
      }`,
      [this.#guildId, dependencyId],
    )).rows[0];
    if (!row) throw new GuildDomainError("INVALID_INPUT", "Activity dependency was not found.");
    return activityDependencyFromRow(row);
  }

  async addActivityDependency(
    input: AddActivityDependencyInput,
  ): Promise<ActivityGraphMutationResult> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.activityId);
    this.#assertDependencyKind(input.kind);
    await this.#lockActivityDependencyGraph();
    const activity = await this.getActivity(input.activityId, true);
    this.#assertDirectActivity(activity);
    this.#assertExpectedVersion(activity.version, input.expectedVersion, "Activity");
    await this.getActivity(input.dependsOnActivityId, true);

    const existing = (await this.#connection.query<ActivityDependencyRow>(
      `${this.#activityDependencySelect()}
        WHERE dependency.guild_id = $1
          AND dependency.activity_id = $2
          AND dependency.depends_on_activity_id = $3
          AND dependency.kind = $4
        FOR UPDATE OF dependency`,
      [this.#guildId, input.activityId, input.dependsOnActivityId, input.kind],
    )).rows[0];
    if (existing?.status === "active") {
      throw new GuildDomainError("INVALID_INPUT", "This Activity dependency is already active.");
    }

    let dependency: ActivityDependency;
    if (existing) {
      const row = (await this.#connection.query<ActivityDependencyRow>(
        `UPDATE activity_dependencies dependency
            SET status = 'active', version = dependency.version + 1,
                updated_by_actor_id = $3, revoked_by_actor_id = NULL, revoked_at = NULL
          WHERE dependency.guild_id = $1 AND dependency.id = $2
          RETURNING dependency.id::text, dependency.guild_id::text,
                    dependency.activity_id::text, dependency.depends_on_activity_id::text,
                    dependency.kind, dependency.status, dependency.version,
                    dependency.created_by_actor_id::text,
                    dependency.updated_by_actor_id::text,
                    dependency.revoked_by_actor_id::text, dependency.revoked_at::text,
                    dependency.created_at::text, dependency.updated_at::text`,
        [this.#guildId, existing.id, input.actorId],
      )).rows[0];
      if (!row) throw new Error("Activity dependency could not be reactivated.");
      dependency = activityDependencyFromRow(row);
    } else {
      const row = (await this.#connection.query<ActivityDependencyRow>(
        `INSERT INTO activity_dependencies
           (id, guild_id, activity_id, depends_on_activity_id, kind,
            created_by_actor_id, updated_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id::text, guild_id::text, activity_id::text,
                   depends_on_activity_id::text, kind, status, version,
                   created_by_actor_id::text, updated_by_actor_id::text,
                   revoked_by_actor_id::text, revoked_at::text,
                   created_at::text, updated_at::text`,
        [
          input.id,
          this.#guildId,
          input.activityId,
          input.dependsOnActivityId,
          input.kind,
          input.actorId,
        ],
      )).rows[0];
      if (!row) throw new Error("Activity dependency could not be created.");
      dependency = activityDependencyFromRow(row);
    }

    const activityVersion = await this.#advanceActivityVersion(
      input.activityId,
      input.expectedVersion,
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { activityVersion, dependency };
  }

  async removeActivityDependency(
    input: RemoveActivityDependencyInput,
  ): Promise<ActivityGraphMutationResult> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.activityId);
    await this.#lockActivityDependencyGraph();
    const activity = await this.getActivity(input.activityId, true);
    this.#assertDirectActivity(activity);
    this.#assertExpectedVersion(activity.version, input.expectedVersion, "Activity");
    const current = await this.getActivityDependency(input.dependencyId, true);
    if (current.activityId !== input.activityId || current.status !== "active") {
      throw new GuildDomainError("INVALID_INPUT", "Activity dependency is not active here.");
    }
    this.#assertExpectedVersion(
      current.version,
      input.expectedDependencyVersion,
      "Activity dependency",
    );

    const row = (await this.#connection.query<ActivityDependencyRow>(
      `UPDATE activity_dependencies dependency
          SET status = 'revoked', version = dependency.version + 1,
              updated_by_actor_id = $3, revoked_by_actor_id = $3, revoked_at = now()
        WHERE dependency.guild_id = $1 AND dependency.id = $2
          AND dependency.status = 'active' AND dependency.version = $4
        RETURNING dependency.id::text, dependency.guild_id::text,
                  dependency.activity_id::text, dependency.depends_on_activity_id::text,
                  dependency.kind, dependency.status, dependency.version,
                  dependency.created_by_actor_id::text,
                  dependency.updated_by_actor_id::text,
                  dependency.revoked_by_actor_id::text, dependency.revoked_at::text,
                  dependency.created_at::text, dependency.updated_at::text`,
      [this.#guildId, input.dependencyId, input.actorId, input.expectedDependencyVersion],
    )).rows[0];
    if (!row) throw new Error("Activity dependency changed since it was loaded.");
    const activityVersion = await this.#advanceActivityVersion(
      input.activityId,
      input.expectedVersion,
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { activityVersion, dependency: activityDependencyFromRow(row) };
  }

  async completeActivity(input: CompleteActivityInput): Promise<ActivityCompletionResult> {
    this.#assertEvent(input.chronicleEvent, input.actorId, "activity", input.activityId);
    assertNonBlank(input.summary, "Activity outcome summary", 10_000);
    if (input.evidenceSourceIds.length > 100 ||
        new Set(input.evidenceSourceIds).size !== input.evidenceSourceIds.length) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Activity outcome evidence must contain at most 100 unique source IDs.",
      );
    }
    await this.#lockActivityDependencyGraph();
    const activity = await this.getActivity(input.activityId, true);
    this.#assertDirectActivity(activity);
    this.#assertExpectedVersion(activity.version, input.expectedVersion, "Activity");
    assertActivityTransition(activity.status, "completed");

    const activityResult = await this.#connection.query<{ version: number }>(
      `UPDATE activities SET status = 'completed', version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 RETURNING version`,
      [this.#guildId, input.activityId, input.expectedVersion],
    );
    const activityVersion = activityResult.rows[0]?.version;
    if (!activityVersion) throw new Error("Activity changed since it was loaded.");

    const outcomeVersion = (await this.#connection.query<{ version: number }>(
      `SELECT COALESCE(max(version), 0) + 1 AS version
         FROM activity_outcomes
        WHERE guild_id = $1 AND activity_id = $2`,
      [this.#guildId, input.activityId],
    )).rows[0]?.version;
    if (!outcomeVersion) throw new Error("Activity outcome version could not be allocated.");
    const outcomeRow = (await this.#connection.query<ActivityOutcomeRow>(
      `INSERT INTO activity_outcomes
         (guild_id, activity_id, version, activity_version, summary,
          evidence_source_ids, completed_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7)
       RETURNING guild_id::text, activity_id::text, version, activity_version,
                 summary, evidence_source_ids::text[], completed_by_actor_id::text,
                 completed_at::text`,
      [
        this.#guildId,
        input.activityId,
        outcomeVersion,
        activityVersion,
        input.summary.trim(),
        input.evidenceSourceIds,
        input.actorId,
      ],
    )).rows[0];
    if (!outcomeRow) throw new Error("Activity outcome could not be recorded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { activityVersion, outcome: activityOutcomeFromRow(outcomeRow) };
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

  #activityDependencySelect(): string {
    return `SELECT dependency.id::text, dependency.guild_id::text,
                   dependency.activity_id::text, dependency.depends_on_activity_id::text,
                   dependency.kind, dependency.status, dependency.version,
                   dependency.created_by_actor_id::text,
                   dependency.updated_by_actor_id::text,
                   dependency.revoked_by_actor_id::text, dependency.revoked_at::text,
                   dependency.created_at::text, dependency.updated_at::text
              FROM activity_dependencies dependency`;
  }

  async #lockActivityDependencyGraph(): Promise<void> {
    await this.#connection.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('activity_dependencies'), hashtext($1::text)
       )`,
      [this.#guildId],
    );
  }

  async #advanceActivityVersion(activityId: string, expectedVersion: number): Promise<number> {
    const version = (await this.#connection.query<{ version: number }>(
      `UPDATE activities SET version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 RETURNING version`,
      [this.#guildId, activityId, expectedVersion],
    )).rows[0]?.version;
    if (!version) throw new Error("Activity changed since it was loaded.");
    return version;
  }

  #assertDependencyKind(kind: string): asserts kind is ActivityDependency["kind"] {
    if (!["blocks", "relates_to", "follows"].includes(kind)) {
      throw new GuildDomainError("INVALID_INPUT", "Activity dependency kind is invalid.");
    }
  }

  #memorySelect(versionExpression = "memory.current_version"): string {
    return `SELECT memory.id::text, memory.guild_id::text, memory.space_id::text,
                   memory.owner_actor_id::text, memory.creator_actor_id::text,
                   memory.type, memory.status, memory.workflow,
                   memory.governance_state, memory.layer, memory.visibility, memory.classification,
                   memory.allowed_actor_ids::text[], memory.current_version,
                   memory.confidence::text, memory.provenance,
                   memory.last_verified_at::text, memory.source_ids::text[],
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
