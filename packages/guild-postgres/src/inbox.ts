import type {
  Classification,
  InboxNotification,
  InboxNotificationKind,
  Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import type { GuildTransactionConnection } from "./transaction.js";

export interface InboxListCursor {
  createdAt: string;
  id: string;
}

export interface InboxListOptions {
  cursor?: InboxListCursor | null;
  kind?: InboxNotificationKind | null;
  unreadOnly?: boolean;
  pageSize?: number;
}

export interface InboxListPage {
  items: readonly InboxNotification[];
  unreadCount: number;
  nextCursor: InboxListCursor | null;
}

type InboxRow = QueryResultRow & {
  id: string;
  guild_id: string;
  recipient_identity_id: string;
  kind: InboxNotificationKind;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: string | null;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid Inbox timestamp.");
  }
  return timestamp.toISOString();
}

function notificationFromRow(row: InboxRow): InboxNotification {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    recipientIdentityId: row.recipient_identity_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    readAt: row.read_at === null ? null : isoTimestamp(row.read_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

function assertPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Inbox page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

export class GuildInboxRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
  }

  async listNotifications(
    actorIdentityId: string,
    options: InboxListOptions = {},
  ): Promise<InboxListPage> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<InboxRow>(
      `WITH ${this.#authorizationCtes()}
       ${this.#select()}
       CROSS JOIN inbox_actor actor
       WHERE n.guild_id = $1 AND n.recipient_identity_id = actor.id
         AND ${this.#readPredicate("n")}
         AND ($3::text IS NULL OR n.kind = $3)
         AND (NOT $4::boolean OR n.read_at IS NULL)
         AND ($5::timestamptz IS NULL OR (n.created_at, n.id) < ($5::timestamptz, $6::uuid))
       ORDER BY n.created_at DESC, n.id DESC LIMIT $7`,
      [
        this.#guildId,
        actorIdentityId,
        options.kind ?? null,
        options.unreadOnly ?? false,
        options.cursor?.createdAt ?? null,
        options.cursor?.id ?? null,
        pageSize + 1,
      ],
    )).rows;
    const unreadCount = await this.countUnread(actorIdentityId);
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(notificationFromRow),
      unreadCount,
      nextCursor: rows.length > pageSize && last
        ? { createdAt: isoTimestamp(last.created_at), id: last.id }
        : null,
    };
  }

  async countUnread(actorIdentityId: string): Promise<number> {
    const result = await this.#connection.query<{ count: number }>(
      `WITH ${this.#authorizationCtes()}
       SELECT count(*)::integer AS count
         FROM inbox_notifications n CROSS JOIN inbox_actor actor
        WHERE n.guild_id = $1 AND n.recipient_identity_id = actor.id
          AND n.read_at IS NULL AND ${this.#readPredicate("n")}`,
      [this.#guildId, actorIdentityId],
    );
    return result.rows[0]?.count ?? 0;
  }

  async markRead(
    actorIdentityId: string,
    notificationId: string,
    read: boolean,
  ): Promise<string | null> {
    const result = await this.#connection.query<{ read_at: string | null }>(
      `WITH ${this.#authorizationCtes()}, permitted AS (
         SELECT n.id
           FROM inbox_notifications n CROSS JOIN inbox_actor actor
          WHERE n.guild_id = $1 AND n.id = $3 AND n.recipient_identity_id = actor.id
            AND ${this.#readPredicate("n")}
       )
       UPDATE inbox_notifications n
          SET read_at = CASE WHEN $4::boolean THEN COALESCE(n.read_at, now()) ELSE NULL END
        WHERE n.guild_id = $1 AND n.id IN (SELECT id FROM permitted)
       RETURNING n.read_at::text`,
      [this.#guildId, actorIdentityId, notificationId, read],
    );
    if (result.rowCount !== 1) throw new Error("Inbox notification was not found or is not visible.");
    const readAt = result.rows[0]?.read_at ?? null;
    return readAt === null ? null : isoTimestamp(readAt);
  }

  async markAllRead(actorIdentityId: string): Promise<number> {
    const result = await this.#connection.query<{ count: number }>(
      `WITH ${this.#authorizationCtes()}, permitted AS (
         SELECT n.id
           FROM inbox_notifications n CROSS JOIN inbox_actor actor
          WHERE n.guild_id = $1 AND n.recipient_identity_id = actor.id
            AND n.read_at IS NULL AND ${this.#readPredicate("n")}
       ), updated AS (
         UPDATE inbox_notifications n SET read_at = now()
          WHERE n.guild_id = $1 AND n.id IN (SELECT id FROM permitted)
         RETURNING 1
       )
       SELECT count(*)::integer AS count FROM updated`,
      [this.#guildId, actorIdentityId],
    );
    return result.rows[0]?.count ?? 0;
  }

  #select(): string {
    return `SELECT n.id::text, n.guild_id::text, n.recipient_identity_id::text,
                   n.kind, n.title, n.body, n.resource_type, n.resource_id::text,
                   n.read_at::text, n.space_id::text, n.owner_identity_id::text,
                   n.visibility, n.classification, n.allowed_identity_ids::text[],
                   n.created_at::text
              FROM inbox_notifications n`;
  }

  #authorizationCtes(): string {
    return `inbox_actor AS (
              SELECT identity_row.id, membership_row.clearance,
                     guild_row.root_owner_identity_id = identity_row.id AS is_root
                FROM identities identity_row
                JOIN memberships membership_row
                  ON membership_row.guild_id = identity_row.guild_id
                 AND membership_row.identity_id = identity_row.id
                JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
               WHERE identity_row.guild_id = $1 AND identity_row.id = $2
                 AND identity_row.status = 'active'
                 AND membership_row.state IN ('preboarding', 'active')
            ),
            inbox_grants AS (
              SELECT binding_row.space_id
                FROM role_bindings binding_row
                JOIN role_permissions permission_row
                  ON permission_row.guild_id = binding_row.guild_id
                 AND permission_row.role_id = binding_row.role_id
               WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
                 AND permission_row.permission = 'inbox.read'
            )`;
  }

  #readPredicate(alias: string): string {
    return `(
      CASE ${alias}.classification
        WHEN 'public' THEN 0 WHEN 'internal' THEN 1
        WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
      END <= CASE actor.clearance
        WHEN 'public' THEN 0 WHEN 'internal' THEN 1
        WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
      END
      AND (${alias}.visibility NOT IN ('private', 'restricted')
        OR ${alias}.owner_identity_id = actor.id
        OR actor.id = ANY(${alias}.allowed_identity_ids))
      AND (actor.is_root OR EXISTS (
        SELECT 1 FROM inbox_grants grant_row
         WHERE grant_row.space_id IS NULL
            OR ${alias}.space_id IS NOT NULL
               AND guild_runtime.space_contains($1, grant_row.space_id, ${alias}.space_id)
      ))
    )`;
  }
}
