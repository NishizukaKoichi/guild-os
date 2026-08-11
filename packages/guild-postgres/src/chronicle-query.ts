import type {
  ChronicleEvent,
  Classification,
  Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import type { GuildTransactionConnection } from "./transaction.js";

export interface StoredChronicleEvent extends ChronicleEvent {
  sequence: string;
  actorDisplayName: string;
}

export interface ChronicleListOptions {
  cursor?: string | null;
  search?: string | null;
  actorIdentityId?: string | null;
  subjectType?: string | null;
  occurredFrom?: string | null;
  occurredTo?: string | null;
  pageSize?: number;
}

export interface ChronicleListPage {
  items: readonly StoredChronicleEvent[];
  nextCursor: string | null;
}

type ChronicleRow = QueryResultRow & {
  sequence: string;
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  actor_identity_id: string;
  actor_display_name: string;
  action: string;
  subject_type: string;
  subject_id: string;
  correlation_id: string;
  occurred_at: string;
  details: unknown;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid Chronicle timestamp.");
  }
  return timestamp.toISOString();
}

function detailsFrom(value: unknown): ChronicleEvent["details"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Database contains invalid Chronicle details.");
  }
  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, detail] of Object.entries(value)) {
    if (detail !== null && typeof detail !== "string" && typeof detail !== "number" &&
        typeof detail !== "boolean") {
      throw new Error("Database contains nested Chronicle details.");
    }
    details[key] = detail;
  }
  return details;
}

function eventFromRow(row: ChronicleRow): StoredChronicleEvent {
  if (!/^\d+$/.test(row.sequence)) throw new Error("Database contains an invalid Chronicle sequence.");
  return {
    sequence: row.sequence,
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    actorIdentityId: row.actor_identity_id,
    actorDisplayName: row.actor_display_name,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    correlationId: row.correlation_id,
    occurredAt: isoTimestamp(row.occurred_at),
    details: detailsFrom(row.details),
  };
}

function assertPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Chronicle page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

export class GuildChronicleQueryRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
  }

  async listEvents(
    actorIdentityId: string,
    options: ChronicleListOptions = {},
  ): Promise<ChronicleListPage> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<ChronicleRow>(
      `WITH chronicle_actor AS (
         SELECT identity_row.id, membership_row.clearance,
                guild_row.root_owner_identity_id = identity_row.id AS is_root
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
           JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
          WHERE identity_row.guild_id = $1 AND identity_row.id = $2
            AND identity_row.status = 'active' AND membership_row.state = 'active'
       ), chronicle_grants AS (
         SELECT binding_row.space_id
           FROM role_bindings binding_row
           JOIN role_permissions permission_row
             ON permission_row.guild_id = binding_row.guild_id
            AND permission_row.role_id = binding_row.role_id
          WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
            AND permission_row.permission = 'chronicle.read'
       )
       SELECT event_row.sequence::text, event_row.id::text, event_row.guild_id::text,
              event_row.space_id::text, event_row.owner_identity_id::text,
              event_row.visibility, event_row.classification,
              event_row.allowed_identity_ids::text[], event_row.actor_identity_id::text,
              actor_identity.display_name AS actor_display_name, event_row.action,
              event_row.subject_type, event_row.subject_id::text,
              event_row.correlation_id::text, event_row.occurred_at::text, event_row.details
         FROM chronicle_events event_row
         JOIN identities actor_identity
           ON actor_identity.guild_id = event_row.guild_id
          AND actor_identity.id = event_row.actor_identity_id
         CROSS JOIN chronicle_actor actor
        WHERE event_row.guild_id = $1
          AND CASE event_row.classification
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
              END <= CASE actor.clearance
                WHEN 'public' THEN 0 WHEN 'internal' THEN 1
                WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
              END
          AND (event_row.visibility NOT IN ('private', 'restricted')
            OR event_row.owner_identity_id = actor.id
            OR actor.id = ANY(event_row.allowed_identity_ids))
          AND (actor.is_root OR EXISTS (
            SELECT 1 FROM chronicle_grants grant_row
             WHERE grant_row.space_id IS NULL
                OR event_row.space_id IS NOT NULL
                   AND guild_runtime.space_contains($1, grant_row.space_id, event_row.space_id)
          ))
          AND ($3::text IS NULL
            OR event_row.search_document @@ websearch_to_tsquery('simple'::regconfig, $3))
          AND ($4::text IS NULL OR event_row.subject_type = $4)
          AND ($5::uuid IS NULL OR event_row.actor_identity_id = $5)
          AND ($6::timestamptz IS NULL OR event_row.occurred_at >= $6)
          AND ($7::timestamptz IS NULL OR event_row.occurred_at <= $7)
          AND ($8::bigint IS NULL OR event_row.sequence < $8)
        ORDER BY event_row.sequence DESC LIMIT $9`,
      [
        this.#guildId,
        actorIdentityId,
        options.search ?? null,
        options.subjectType ?? null,
        options.actorIdentityId ?? null,
        options.occurredFrom ?? null,
        options.occurredTo ?? null,
        options.cursor ?? null,
        pageSize + 1,
      ],
    )).rows;
    const selected = rows.slice(0, pageSize);
    return {
      items: selected.map(eventFromRow),
      nextCursor: rows.length > pageSize ? selected.at(-1)?.sequence ?? null : null,
    };
  }
}
