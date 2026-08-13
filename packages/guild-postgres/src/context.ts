import {
  assertDataCustody,
  assertNonBlank,
  assertRelationType,
  assertReviewSignalResolution,
  type AppLocale,
  type ChronicleEvent,
  type Classification,
  type ContextRelation,
  type JsonObject,
  type MemoryReviewSignal,
  type MemoryReviewSignalKind,
  type ResourceCustody,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const MAX_PAGE_SIZE = 100;

export interface ContextCursor {
  createdAt: string;
  id: string;
}

export interface ContextRelationPage {
  items: readonly ContextRelation[];
  nextCursor: ContextCursor | null;
}

export interface ContextNodeSummary {
  type: string;
  id: string;
  label: string;
}

export interface CreateContextRelationInput {
  id: string;
  actorId: string;
  fromType: string;
  fromId: string;
  relationType: string;
  toType: string;
  toId: string;
  spaceId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedActorIds: readonly string[];
  properties: JsonObject;
  rationale: string;
  chronicleEvent: ChronicleEvent;
}

export interface MemoryEmbeddingJob {
  id: string;
  memoryId: string;
  memoryVersion: number;
  locale: AppLocale;
  model: string;
  text: string;
  attemptCount: number;
}

export interface MemoryComparisonCandidate {
  memoryId: string;
  comparedMemoryId: string;
  locale: AppLocale;
  firstText: string;
  secondText: string;
}

type RelationRow = QueryResultRow & {
  id: string;
  guild_id: string;
  from_type: string;
  from_id: string;
  relation_type: string;
  to_type: string;
  to_id: string;
  space_id: string | null;
  owner_actor_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_actor_ids: string[];
  status: ContextRelation["status"];
  properties: JsonObject;
  rationale: string;
  created_by_identity_id: string;
  revoked_by_actor_id: string | null;
  revoked_at: string | null;
  version: number;
  created_at: string;
};

type CustodyRow = QueryResultRow & {
  guild_id: string;
  resource_type: ResourceCustody["resourceType"];
  resource_id: string;
  custody: ResourceCustody["custody"];
  personal_owner_actor_id: string | null;
  shared_by_actor_id: string | null;
  shared_at: string | null;
  retention_until: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type ReviewSignalRow = QueryResultRow & {
  id: string;
  guild_id: string;
  memory_id: string;
  compared_memory_id: string | null;
  kind: MemoryReviewSignal["kind"];
  status: MemoryReviewSignal["status"];
  evidence: string;
  detected_by_actor_id: string | null;
  resolved_by_actor_id: string | null;
  resolution: string | null;
  detected_at: string;
  resolved_at: string | null;
  version: number;
};

function iso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error("Database contains an invalid timestamp.");
  return parsed.toISOString();
}

function optionalIso(value: string | null): string | null {
  return value === null ? null : iso(value);
}

function relationFromRow(row: RelationRow): ContextRelation {
  return {
    id: row.id,
    guildId: row.guild_id,
    fromType: row.from_type,
    fromId: row.from_id,
    relationType: row.relation_type,
    toType: row.to_type,
    toId: row.to_id,
    spaceId: row.space_id,
    ownerActorId: row.owner_actor_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedActorIds: row.allowed_actor_ids,
    status: row.status,
    properties: row.properties,
    rationale: row.rationale,
    createdByActorId: row.created_by_identity_id,
    revokedByActorId: row.revoked_by_actor_id,
    revokedAt: optionalIso(row.revoked_at),
    version: row.version,
    createdAt: iso(row.created_at),
  };
}

function custodyFromRow(row: CustodyRow): ResourceCustody {
  return {
    guildId: row.guild_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    custody: row.custody,
    personalOwnerActorId: row.personal_owner_actor_id,
    sharedByActorId: row.shared_by_actor_id,
    sharedAt: optionalIso(row.shared_at),
    retentionUntil: optionalIso(row.retention_until),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function signalFromRow(row: ReviewSignalRow): MemoryReviewSignal {
  return {
    id: row.id,
    guildId: row.guild_id,
    memoryId: row.memory_id,
    comparedMemoryId: row.compared_memory_id,
    kind: row.kind,
    status: row.status,
    evidence: row.evidence,
    detectedByActorId: row.detected_by_actor_id,
    resolvedByActorId: row.resolved_by_actor_id,
    resolution: row.resolution,
    detectedAt: iso(row.detected_at),
    resolvedAt: optionalIso(row.resolved_at),
    version: row.version,
  };
}

export class GuildContextRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listRelations(
    actorId: string,
    cursor: ContextCursor | null = null,
    pageSize = 50,
  ): Promise<ContextRelationPage> {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error("Context Graph page size is invalid.");
    }
    const rows = (await this.#connection.query<RelationRow>(
      `WITH RECURSIVE actor AS (
         SELECT membership.clearance,
                guild.root_owner_identity_id = membership.actor_id AS is_root
           FROM actor_memberships membership
           JOIN actors actor_row ON actor_row.id = membership.actor_id
           JOIN guilds guild ON guild.id = membership.guild_id
          WHERE membership.guild_id = $1 AND membership.actor_id = $2
            AND membership.state IN ('joined', 'active') AND membership.operational
            AND actor_row.status = 'active'
       ), grants AS (
         SELECT binding.space_id
           FROM actor_role_bindings binding
           JOIN role_permissions permission
             ON permission.guild_id = binding.guild_id AND permission.role_id = binding.role_id
          WHERE binding.guild_id = $1 AND binding.actor_id = $2
            AND permission.permission = 'relation.read'
       ), permitted_spaces AS (
         SELECT space.id FROM spaces space JOIN grants ON grants.space_id = space.id
          WHERE space.guild_id = $1 AND space.status = 'active'
         UNION ALL
         SELECT child.id FROM spaces child JOIN permitted_spaces parent
           ON child.parent_space_id = parent.id
          WHERE child.guild_id = $1 AND child.status = 'active'
       )
       SELECT relation.id::text, relation.guild_id::text, relation.from_type,
              relation.from_id::text, relation.relation_type, relation.to_type,
              relation.to_id::text, relation.space_id::text,
              relation.owner_actor_id::text, relation.visibility,
              relation.classification, relation.allowed_actor_ids::text[],
              relation.status, relation.properties, relation.rationale,
              relation.created_by_identity_id::text, relation.revoked_by_actor_id::text,
              relation.revoked_at::text, relation.version, relation.created_at::text
         FROM relations relation CROSS JOIN actor
        WHERE relation.guild_id = $1 AND relation.status = 'active'
          AND (actor.is_root OR EXISTS (SELECT 1 FROM grants WHERE space_id IS NULL)
            OR relation.space_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM permitted_spaces WHERE id = relation.space_id
            ))
          AND CASE relation.classification
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3 END
              <= CASE actor.clearance
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3 END
          AND (relation.visibility NOT IN ('private', 'restricted')
            OR relation.owner_actor_id = $2 OR $2::uuid = ANY(relation.allowed_actor_ids))
          AND guild_runtime.actor_can_read_context_endpoint(
            $1, $2, relation.from_type, relation.from_id
          )
          AND guild_runtime.actor_can_read_context_endpoint(
            $1, $2, relation.to_type, relation.to_id
          )
          AND ($3::timestamptz IS NULL OR
               (relation.created_at, relation.id) < ($3::timestamptz, $4::uuid))
        ORDER BY relation.created_at DESC, relation.id DESC LIMIT $5`,
      [this.#guildId, actorId, cursor?.createdAt ?? null, cursor?.id ?? null, pageSize + 1],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const scanBoundary = selected.at(-1);
    return {
      items: selected.map(relationFromRow),
      nextCursor: rows.length > pageSize && scanBoundary
        ? { createdAt: iso(scanBoundary.created_at), id: scanBoundary.id }
        : null,
    };
  }

  async getRelation(id: string, forUpdate = false): Promise<ContextRelation> {
    const row = (await this.#connection.query<RelationRow>(
      `SELECT id::text, guild_id::text, from_type, from_id::text, relation_type,
              to_type, to_id::text, space_id::text, owner_actor_id::text,
              visibility, classification, allowed_actor_ids::text[], status,
              properties, rationale, created_by_identity_id::text,
              revoked_by_actor_id::text, revoked_at::text, version, created_at::text
         FROM relations WHERE guild_id = $1 AND id = $2
         ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, id],
    )).rows[0];
    if (!row) throw new Error("Context Graph relation was not found.");
    return relationFromRow(row);
  }

  async listVisibleNodes(
    actorId: string,
    endpoints: readonly { type: string; id: string }[],
  ): Promise<readonly ContextNodeSummary[]> {
    if (endpoints.length === 0) return [];
    if (endpoints.length > 200) throw new Error("Context Graph node request is too large.");
    const rows = await this.#connection.query<{ type: string; id: string; label: string }>(
      `WITH requested AS (
         SELECT endpoint.type, endpoint.id
           FROM unnest($3::text[], $4::uuid[]) AS endpoint(type, id)
       )
       SELECT requested.type, requested.id::text,
              guild_runtime.context_endpoint_label($1, requested.type, requested.id) AS label
         FROM requested
        WHERE guild_runtime.actor_can_read_context_endpoint(
          $1, $2, requested.type, requested.id
        )
          AND guild_runtime.context_endpoint_label($1, requested.type, requested.id) IS NOT NULL
        ORDER BY requested.type, requested.id`,
      [
        this.#guildId,
        actorId,
        endpoints.map((endpoint) => endpoint.type),
        endpoints.map((endpoint) => endpoint.id),
      ],
    );
    return rows.rows;
  }

  async createRelation(input: CreateContextRelationInput): Promise<void> {
    assertRelationType(input.relationType);
    assertNonBlank(input.fromType, "Relation source type", 100);
    assertNonBlank(input.toType, "Relation target type", 100);
    if (input.fromType === input.toType && input.fromId === input.toId) {
      throw new Error("A Context Graph relation cannot point to itself.");
    }
    await this.#connection.query(
      `INSERT INTO relations (
         id, guild_id, from_type, from_id, relation_type, to_type, to_id,
         created_by_identity_id, space_id, owner_actor_id, visibility,
         classification, allowed_actor_ids, properties, rationale
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, $11,
                 $12::uuid[], $13::jsonb, $14)`,
      [
        input.id, this.#guildId, input.fromType, input.fromId, input.relationType,
        input.toType, input.toId, input.actorId, input.spaceId, input.visibility,
        input.classification, input.allowedActorIds, JSON.stringify(input.properties),
        input.rationale,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async revokeRelation(
    id: string,
    expectedVersion: number,
    actorId: string,
    event: ChronicleEvent,
  ): Promise<number> {
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE relations
          SET status = 'revoked', revoked_by_actor_id = $3, revoked_at = now(),
              version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'active' AND version = $4
      RETURNING version`,
      [this.#guildId, id, actorId, expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Context Graph relation changed. Reload before continuing.");
    await this.#chronicle.appendChronicle(event);
    return version;
  }

  async getCustody(resourceType: ResourceCustody["resourceType"], resourceId: string): Promise<ResourceCustody> {
    const row = (await this.#connection.query<CustodyRow>(
      `SELECT guild_id::text, resource_type, resource_id::text, custody,
              personal_owner_actor_id::text, shared_by_actor_id::text,
              shared_at::text, retention_until::text, version,
              created_at::text, updated_at::text
         FROM resource_custody
        WHERE guild_id = $1 AND resource_type = $2 AND resource_id = $3`,
      [this.#guildId, resourceType, resourceId],
    )).rows[0];
    if (!row) throw new Error("Resource custody was not found.");
    return custodyFromRow(row);
  }

  async listPersonalCustody(actorId: string): Promise<readonly ResourceCustody[]> {
    const rows = (await this.#connection.query<CustodyRow>(
      `SELECT guild_id::text, resource_type, resource_id::text, custody,
              personal_owner_actor_id::text, shared_by_actor_id::text,
              shared_at::text, retention_until::text, version,
              created_at::text, updated_at::text
         FROM resource_custody
        WHERE guild_id = $1 AND personal_owner_actor_id = $2
        ORDER BY updated_at DESC, resource_type, resource_id LIMIT 200`,
      [this.#guildId, actorId],
    )).rows;
    return rows.map(custodyFromRow);
  }

  async getCustodyCounts(): Promise<Readonly<Record<ResourceCustody["custody"], number>>> {
    const rows = await this.#connection.query<{ custody: ResourceCustody["custody"]; count: string }>(
      `SELECT custody, count(*)::text AS count FROM resource_custody
        WHERE guild_id = $1 GROUP BY custody`,
      [this.#guildId],
    );
    const counts: Record<ResourceCustody["custody"], number> = {
      guild: 0,
      personal: 0,
      shared: 0,
    };
    for (const row of rows.rows) counts[row.custody] = Number(row.count);
    return counts;
  }

  async sharePersonalData(
    resourceType: ResourceCustody["resourceType"],
    resourceId: string,
    expectedVersion: number,
    actorId: string,
    event: ChronicleEvent,
  ): Promise<ResourceCustody> {
    assertDataCustody("shared");
    if (resourceType !== "memory") {
      throw new Error("This Personal Data type does not support Guild sharing yet.");
    }
    const row = (await this.#connection.query<CustodyRow>(
      `UPDATE resource_custody
          SET custody = 'shared', shared_by_actor_id = $4, shared_at = now(),
              version = version + 1
        WHERE guild_id = $1 AND resource_type = $2 AND resource_id = $3
          AND custody = 'personal' AND personal_owner_actor_id = $4 AND version = $5
      RETURNING guild_id::text, resource_type, resource_id::text, custody,
                personal_owner_actor_id::text, shared_by_actor_id::text,
                shared_at::text, retention_until::text, version,
                created_at::text, updated_at::text`,
      [this.#guildId, resourceType, resourceId, actorId, expectedVersion],
    )).rows[0];
    if (!row) throw new Error("Only the Personal Data owner can share this record.");
    await this.#connection.query(
      `UPDATE memories
          SET visibility = CASE WHEN space_id IS NULL THEN 'guild' ELSE 'space' END,
              allowed_actor_ids = '{}', updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND owner_actor_id = $3
          AND origin_custody = 'personal'`,
      [this.#guildId, resourceId, actorId],
    );
    await this.#connection.query(
        `INSERT INTO memory_embedding_jobs
           (id, guild_id, memory_id, memory_version, locale)
         SELECT gen_random_uuid(), version.guild_id, version.memory_id, version.version, language.locale
           FROM memories memory
           JOIN memory_versions version
             ON version.guild_id = memory.guild_id AND version.memory_id = memory.id
            AND version.version = memory.current_version
          CROSS JOIN LATERAL jsonb_object_keys(version.body) AS language(locale)
          WHERE memory.guild_id = $1 AND memory.id = $2
            AND language.locale IN ('en', 'ja', 'zh-CN')
         ON CONFLICT DO NOTHING`,
      [this.#guildId, resourceId],
    );
    await this.#chronicle.appendChronicle(event);
    return custodyFromRow(row);
  }

  async claimEmbeddingJob(): Promise<MemoryEmbeddingJob | null> {
    const row = (await this.#connection.query<QueryResultRow & {
      id: string;
      memory_id: string;
      memory_version: number;
      locale: AppLocale;
      model: string;
      title: string;
      summary: string;
      body: string;
      attempt_count: number;
    }>(
      `WITH candidate AS (
         SELECT job.id
           FROM memory_embedding_jobs job
          WHERE job.guild_id = $1
            AND (job.status IN ('pending', 'failed') AND job.available_at <= now()
              OR job.status = 'processing' AND job.locked_at < now() - interval '10 minutes')
          ORDER BY job.available_at, job.created_at, job.id
          FOR UPDATE SKIP LOCKED LIMIT 1
       ), claimed AS (
         UPDATE memory_embedding_jobs job
            SET status = 'processing', locked_at = now(), attempt_count = attempt_count + 1
           FROM candidate WHERE job.guild_id = $1 AND job.id = candidate.id
         RETURNING job.*
       )
       SELECT claimed.id::text, claimed.memory_id::text, claimed.memory_version,
              claimed.locale, claimed.model, claimed.attempt_count,
              COALESCE(version.title ->> claimed.locale, version.title ->> 'en',
                       version.title ->> 'ja', version.title ->> 'zh-CN', '') AS title,
              COALESCE(version.summary ->> claimed.locale, version.summary ->> 'en',
                       version.summary ->> 'ja', version.summary ->> 'zh-CN', '') AS summary,
              COALESCE(version.body ->> claimed.locale, version.body ->> 'en',
                       version.body ->> 'ja', version.body ->> 'zh-CN', '') AS body
         FROM claimed JOIN memory_versions version
           ON version.guild_id = claimed.guild_id
          AND version.memory_id = claimed.memory_id
          AND version.version = claimed.memory_version`,
      [this.#guildId],
    )).rows[0];
    if (!row) return null;
    return {
      id: row.id,
      memoryId: row.memory_id,
      memoryVersion: row.memory_version,
      locale: row.locale,
      model: row.model,
      text: [row.title, row.summary, row.body].filter(Boolean).join("\n\n").slice(0, 20_000),
      attemptCount: row.attempt_count,
    };
  }

  async completeEmbeddingJob(
    job: MemoryEmbeddingJob,
    embedding: readonly number[],
    contentHash: string,
  ): Promise<void> {
    if (embedding.length !== 1_024 || !embedding.every(Number.isFinite)) {
      throw new Error("Embedding model returned an invalid vector.");
    }
    await this.#connection.query(
      `INSERT INTO memory_embeddings (
         guild_id, memory_id, memory_version, locale, model, content_hash, embedding
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       ON CONFLICT (guild_id, memory_id, memory_version, locale, model)
       DO UPDATE SET content_hash = EXCLUDED.content_hash,
                     embedding = EXCLUDED.embedding, indexed_at = now()`,
      [
        this.#guildId, job.memoryId, job.memoryVersion, job.locale, job.model,
        contentHash, `[${embedding.join(",")}]`,
      ],
    );
    await this.#connection.query(
      `UPDATE memory_embedding_jobs
          SET status = 'completed', completed_at = now(), locked_at = NULL, last_error = NULL
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'`,
      [this.#guildId, job.id],
    );
  }

  async failEmbeddingJob(jobId: string, error: string): Promise<void> {
    await this.#connection.query(
      `UPDATE memory_embedding_jobs
          SET status = 'failed', available_at = now() + make_interval(
                secs => LEAST(3600, power(2, attempt_count)::integer)
              ), locked_at = NULL, last_error = $3
        WHERE guild_id = $1 AND id = $2 AND status = 'processing'`,
      [this.#guildId, jobId, error.slice(0, 2_000)],
    );
  }

  async detectDeterministicMemorySignals(actorId: string): Promise<number> {
    const result = await this.#connection.query(
      `INSERT INTO memory_review_signals (
         id, guild_id, memory_id, kind, evidence, detected_by_actor_id
       )
       SELECT gen_random_uuid(), memory.guild_id, memory.id, signal.kind,
              signal.evidence, $2
         FROM memories memory
         JOIN resource_custody custody
           ON custody.guild_id = memory.guild_id
          AND custody.resource_type = 'memory'
          AND custody.resource_id = memory.id
          AND custody.custody IN ('guild', 'shared')
         CROSS JOIN LATERAL (
           VALUES
             ('stale'::text, CASE WHEN memory.review_due_at < now()
               THEN 'The configured review date has passed.' END),
             ('missing_source'::text, CASE WHEN memory.layer = 'external'
                    AND cardinality(memory.source_ids) = 0
               THEN 'External Memory has no linked source record.' END),
             ('low_confidence'::text, CASE WHEN memory.confidence IS NOT NULL
                    AND memory.confidence < 0.5
               THEN 'Memory confidence is below 0.50.' END)
         ) AS signal(kind, evidence)
        WHERE memory.guild_id = $1 AND memory.status = 'active'
          AND signal.evidence IS NOT NULL
       ON CONFLICT (guild_id, memory_id, compared_memory_id, kind, status) DO NOTHING`,
      [this.#guildId, actorId],
    );
    return result.rowCount ?? 0;
  }

  async addContradictionSignal(
    memoryId: string,
    comparedMemoryId: string,
    evidence: string,
    actorId: string,
  ): Promise<boolean> {
    assertNonBlank(evidence, "Contradiction evidence", 10_000);
    const result = await this.#connection.query(
      `INSERT INTO memory_review_signals (
         id, guild_id, memory_id, compared_memory_id, kind, evidence, detected_by_actor_id
       ) VALUES ($1, $2, $3, $4, 'possible_contradiction', $5, $6)
       ON CONFLICT (guild_id, memory_id, compared_memory_id, kind, status) DO NOTHING`,
      [crypto.randomUUID(), this.#guildId, memoryId, comparedMemoryId, evidence, actorId],
    );
    return result.rowCount === 1;
  }

  async listMemoryComparisonCandidates(limit = 10): Promise<MemoryComparisonCandidate[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Memory comparison limit is invalid.");
    }
    const rows = (await this.#connection.query<QueryResultRow & {
      memory_id: string;
      compared_memory_id: string;
      locale: AppLocale;
      first_text: string;
      second_text: string;
    }>(
      `SELECT first.id::text AS memory_id, second.id::text AS compared_memory_id,
              language.locale,
              concat_ws(E'\n', first_version.title ->> language.locale,
                first_version.summary ->> language.locale,
                first_version.body ->> language.locale) AS first_text,
              concat_ws(E'\n', second_version.title ->> language.locale,
                second_version.summary ->> language.locale,
                second_version.body ->> language.locale) AS second_text
         FROM memories first
         JOIN resource_custody first_custody
           ON first_custody.guild_id = first.guild_id
          AND first_custody.resource_type = 'memory'
          AND first_custody.resource_id = first.id
          AND first_custody.custody IN ('guild', 'shared')
         JOIN memories second
           ON second.guild_id = first.guild_id AND second.id > first.id
          AND second.space_id IS NOT DISTINCT FROM first.space_id
          AND second.type = first.type AND second.status = 'active'
         JOIN resource_custody second_custody
           ON second_custody.guild_id = second.guild_id
          AND second_custody.resource_type = 'memory'
          AND second_custody.resource_id = second.id
          AND second_custody.custody IN ('guild', 'shared')
         JOIN memory_versions first_version
           ON first_version.guild_id = first.guild_id AND first_version.memory_id = first.id
          AND first_version.version = CASE WHEN first.workflow = 'canonical'
                THEN first.canonical_version ELSE first.current_version END
         JOIN memory_versions second_version
           ON second_version.guild_id = second.guild_id AND second_version.memory_id = second.id
          AND second_version.version = CASE WHEN second.workflow = 'canonical'
                THEN second.canonical_version ELSE second.current_version END
        CROSS JOIN LATERAL (
          SELECT locale FROM unnest(ARRAY['en', 'ja', 'zh-CN']) locale
           WHERE first_version.body ? locale AND second_version.body ? locale
           LIMIT 1
        ) language
        WHERE first.guild_id = $1 AND first.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM memory_review_signals signal
             WHERE signal.guild_id = first.guild_id
               AND signal.memory_id = first.id
               AND signal.compared_memory_id = second.id
               AND signal.kind = 'possible_contradiction' AND signal.status = 'open'
          )
          AND (
            to_tsvector('simple', first_version.title::text || ' ' || first_version.summary::text)
              @@ plainto_tsquery('simple', coalesce(second_version.title ->> language.locale, ''))
            OR similarity(
              lower(coalesce(first_version.title ->> language.locale, '')),
              lower(coalesce(second_version.title ->> language.locale, ''))
            ) > 0.2
          )
        ORDER BY greatest(first.updated_at, second.updated_at) DESC
        LIMIT $2`,
      [this.#guildId, limit],
    )).rows;
    return rows.map((row) => ({
      memoryId: row.memory_id,
      comparedMemoryId: row.compared_memory_id,
      locale: row.locale,
      firstText: row.first_text.slice(0, 20_000),
      secondText: row.second_text.slice(0, 20_000),
    }));
  }

  async listReviewSignals(status: MemoryReviewSignal["status"] = "open"): Promise<MemoryReviewSignal[]> {
    const rows = (await this.#connection.query<ReviewSignalRow>(
      `SELECT id::text, guild_id::text, memory_id::text, compared_memory_id::text,
              kind, status, evidence, detected_by_actor_id::text,
              resolved_by_actor_id::text, resolution, detected_at::text,
              resolved_at::text, version
         FROM memory_review_signals
        WHERE guild_id = $1 AND status = $2
        ORDER BY detected_at DESC, id DESC LIMIT 200`,
      [this.#guildId, status],
    )).rows;
    return rows.map(signalFromRow);
  }

  async resolveReviewSignal(
    id: string,
    expectedVersion: number,
    status: "resolved" | "dismissed",
    resolution: string,
    actorId: string,
    event: ChronicleEvent,
  ): Promise<number> {
    assertReviewSignalResolution(status);
    assertNonBlank(resolution, "Memory review resolution", 5_000);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE memory_review_signals
          SET status = $3, resolved_by_actor_id = $4, resolution = $5,
              resolved_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND status = 'open' AND version = $6
      RETURNING version`,
      [this.#guildId, id, status, actorId, resolution, expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Memory review signal changed. Reload before continuing.");
    await this.#chronicle.appendChronicle(event);
    return version;
  }

}
