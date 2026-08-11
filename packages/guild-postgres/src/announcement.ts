import {
  assertAnnouncementContent,
  assertAnnouncementExpiry,
  assertAnnouncementTransition,
  type Announcement,
  type ChronicleEvent,
  type Classification,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface AnnouncementListCursor {
  updatedAt: string;
  id: string;
}

export interface AnnouncementListPage {
  items: readonly Announcement[];
  nextCursor: AnnouncementListCursor | null;
}

export interface AnnouncementAudienceInput {
  spaceId: string | null;
  targetRoleId: string | null;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds: readonly string[];
}

export interface CreateAnnouncementInput extends AnnouncementAudienceInput {
  id: string;
  actorIdentityId: string;
  ownerIdentityId: string;
  title: string;
  body: string;
  expiresAt: string | null;
  chronicleEvent: ChronicleEvent;
}

export interface SaveAnnouncementDraftInput extends AnnouncementAudienceInput {
  announcementId: string;
  actorIdentityId: string;
  expectedVersion: number;
  title: string;
  body: string;
  expiresAt: string | null;
  chronicleEvent: ChronicleEvent;
}

export interface AnnouncementTransitionInput {
  announcementId: string;
  actorIdentityId: string;
  expectedVersion: number;
  chronicleEvent: ChronicleEvent;
}

export interface PublishAnnouncementResult {
  version: number;
  recipientCount: number;
}

type AnnouncementRow = QueryResultRow & {
  id: string;
  guild_id: string;
  space_id: string | null;
  target_role_id: string | null;
  owner_identity_id: string;
  creator_identity_id: string;
  title: string;
  body: string;
  status: Announcement["status"];
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  published_at: string | null;
  expires_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type AnnouncementSecurityBoundary = {
  spaceId: string | null;
  ownerIdentityId: string;
  visibility: Visibility;
  classification: Classification;
  allowedIdentityIds?: readonly string[];
};

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid Announcement timestamp.");
  }
  return timestamp.toISOString();
}

function optionalTimestamp(value: string | null): string | null {
  return value === null ? null : isoTimestamp(value);
}

function announcementFromRow(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    guildId: row.guild_id,
    spaceId: row.space_id,
    targetRoleId: row.target_role_id,
    ownerIdentityId: row.owner_identity_id,
    creatorIdentityId: row.creator_identity_id,
    title: row.title,
    body: row.body,
    status: row.status,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    publishedAt: optionalTimestamp(row.published_at),
    expiresAt: optionalTimestamp(row.expires_at),
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function assertPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Announcement page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
}

function sortedIds(values: readonly string[] | undefined): string {
  return [...(values ?? [])].sort().join(",");
}

export class GuildAnnouncementRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listAnnouncements(
    actorIdentityId: string,
    cursor: AnnouncementListCursor | null = null,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<AnnouncementListPage> {
    assertPageSize(pageSize);
    const rows = (await this.#connection.query<AnnouncementRow>(
      `WITH ${this.#authorizationCtes()}
       ${this.#select()}
       CROSS JOIN announcement_actor actor
       WHERE a.guild_id = $1 AND ${this.#readPredicate("a")}
         AND ($3::timestamptz IS NULL OR (a.updated_at, a.id) < ($3::timestamptz, $4::uuid))
       ORDER BY a.updated_at DESC, a.id DESC LIMIT $5`,
      [this.#guildId, actorIdentityId, cursor?.updatedAt ?? null, cursor?.id ?? null, pageSize + 1],
    )).rows;
    const selected = rows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      items: selected.map(announcementFromRow),
      nextCursor: rows.length > pageSize && last
        ? { updatedAt: isoTimestamp(last.updated_at), id: last.id }
        : null,
    };
  }

  async getAnnouncement(actorIdentityId: string, announcementId: string): Promise<Announcement> {
    const rows = (await this.#connection.query<AnnouncementRow>(
      `WITH ${this.#authorizationCtes()}
       ${this.#select()}
       CROSS JOIN announcement_actor actor
       WHERE a.guild_id = $1 AND a.id = $3 AND ${this.#readPredicate("a")}`,
      [this.#guildId, actorIdentityId, announcementId],
    )).rows;
    const row = rows[0];
    if (!row) throw new Error("Announcement was not found or is not visible.");
    return announcementFromRow(row);
  }

  async createAnnouncement(input: CreateAnnouncementInput): Promise<void> {
    this.#assertContent(input.title, input.body, input.expiresAt);
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.id, input);
    await this.#assertAudienceReferences(input);
    await this.#connection.query(
      `INSERT INTO announcements
         (id, guild_id, space_id, target_role_id, owner_identity_id, creator_identity_id,
          title, body, status, visibility, classification, allowed_identity_ids,
          published_at, expires_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11::uuid[], NULL, $12, 1)`,
      [
        input.id,
        this.#guildId,
        input.spaceId,
        input.targetRoleId,
        input.ownerIdentityId,
        input.actorIdentityId,
        input.title.trim(),
        input.body.trim(),
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.expiresAt,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async saveDraft(input: SaveAnnouncementDraftInput): Promise<number> {
    this.#assertContent(input.title, input.body, input.expiresAt);
    const current = await this.#load(input.announcementId, true);
    this.#assertExpectedVersion(current, input.expectedVersion);
    if (current.status !== "draft") throw new Error("Only a draft Announcement can be edited.");
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.announcementId, {
      ...input,
      ownerIdentityId: current.ownerIdentityId,
    });
    await this.#assertAudienceReferences(input);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE announcements
          SET space_id = $4, target_role_id = $5, title = $6, body = $7,
              visibility = $8, classification = $9, allowed_identity_ids = $10::uuid[],
              expires_at = $11, version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status = 'draft'
        RETURNING version`,
      [
        this.#guildId,
        input.announcementId,
        input.expectedVersion,
        input.spaceId,
        input.targetRoleId,
        input.title.trim(),
        input.body.trim(),
        input.visibility,
        input.classification,
        input.allowedIdentityIds,
        input.expiresAt,
      ],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Announcement changed since it was loaded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async publish(input: AnnouncementTransitionInput): Promise<PublishAnnouncementResult> {
    const current = await this.#load(input.announcementId, true);
    this.#assertExpectedVersion(current, input.expectedVersion);
    assertAnnouncementTransition(current.status, "published");
    if (current.expiresAt !== null && new Date(current.expiresAt).valueOf() <= Date.now()) {
      throw new Error("Announcement expiry must be in the future when published.");
    }
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.announcementId, current);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE announcements
          SET status = 'published', published_at = now(), version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND status = 'draft'
        RETURNING version`,
      [this.#guildId, input.announcementId, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Announcement changed since it was loaded.");
    const recipientCount = await this.#notifyAudience(current, input.actorIdentityId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return { version, recipientCount };
  }

  async archive(input: AnnouncementTransitionInput): Promise<number> {
    const current = await this.#load(input.announcementId, true);
    this.#assertExpectedVersion(current, input.expectedVersion);
    assertAnnouncementTransition(current.status, "archived");
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId, input.announcementId, current);
    const result = await this.#connection.query<{ version: number }>(
      `UPDATE announcements
          SET status = 'archived', version = version + 1
        WHERE guild_id = $1 AND id = $2 AND version = $3
          AND status IN ('draft', 'published')
        RETURNING version`,
      [this.#guildId, input.announcementId, input.expectedVersion],
    );
    const version = result.rows[0]?.version;
    if (!version) throw new Error("Announcement changed since it was loaded.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return version;
  }

  async #notifyAudience(announcement: Announcement, actorIdentityId: string): Promise<number> {
    const result = await this.#connection.query<{ count: number }>(
      `WITH eligible_recipients AS (
         SELECT DISTINCT identity_row.id
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
           JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
          WHERE identity_row.guild_id = $1
            AND identity_row.id <> $9
            AND identity_row.kind = 'human'
            AND identity_row.status = 'active'
            AND membership_row.state IN ('preboarding', 'active')
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
                 AND permission_row.permission = 'announcement.read'
                 AND (binding_row.space_id IS NULL
                   OR $2::uuid IS NOT NULL
                      AND guild_runtime.space_contains($1, binding_row.space_id, $2::uuid))
              )
            )
            AND ($7::uuid IS NULL OR guild_row.root_owner_identity_id = identity_row.id
              OR identity_row.id = $5
              OR EXISTS (
                SELECT 1 FROM role_bindings target_binding
                 WHERE target_binding.guild_id = identity_row.guild_id
                   AND target_binding.identity_id = identity_row.id
                   AND target_binding.role_id = $7
                   AND (target_binding.space_id IS NULL
                     OR $2::uuid IS NOT NULL
                        AND guild_runtime.space_contains($1, target_binding.space_id, $2::uuid))
              ))
       ), inserted AS (
         INSERT INTO inbox_notifications
           (id, guild_id, recipient_identity_id, kind, title, body,
            resource_type, resource_id, space_id, owner_identity_id, visibility,
            classification, allowed_identity_ids, deduplication_key)
         SELECT gen_random_uuid(), $1, recipient.id, 'announcement', $8, left($10, 2000),
              'announcement', $11::uuid, $2, $5, $4, $3, $6::uuid[],
              'announcement:' || $11::uuid::text
           FROM eligible_recipients recipient
         ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
           WHERE deduplication_key IS NOT NULL DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::integer AS count FROM inserted`,
      [
        this.#guildId,
        announcement.spaceId,
        announcement.classification,
        announcement.visibility,
        announcement.ownerIdentityId,
        announcement.allowedIdentityIds ?? [],
        announcement.targetRoleId,
        announcement.title,
        actorIdentityId,
        announcement.body,
        announcement.id,
      ],
    );
    return result.rows[0]?.count ?? 0;
  }

  async #assertAudienceReferences(input: AnnouncementAudienceInput): Promise<void> {
    if (input.targetRoleId !== null) {
      const role = await this.#connection.query<QueryResultRow>(
        "SELECT 1 FROM roles WHERE guild_id = $1 AND id = $2",
        [this.#guildId, input.targetRoleId],
      );
      if (role.rows.length === 0) throw new Error("Announcement target Role was not found.");
    }
    if (input.allowedIdentityIds.length > 0) {
      const result = await this.#connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM identities
          WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
        [this.#guildId, input.allowedIdentityIds],
      );
      if (Number(result.rows[0]?.count ?? 0) !== input.allowedIdentityIds.length) {
        throw new Error("An Announcement shared Identity is not active in this Guild.");
      }
    }
  }

  #assertContent(title: string, body: string, expiresAt: string | null): void {
    assertAnnouncementContent(title, body);
    assertAnnouncementExpiry(expiresAt);
  }

  async #load(announcementId: string, lock: boolean): Promise<Announcement> {
    const rows = (await this.#connection.query<AnnouncementRow>(
      `${this.#select()} WHERE a.guild_id = $1 AND a.id = $2${lock ? " FOR UPDATE" : ""}`,
      [this.#guildId, announcementId],
    )).rows;
    const row = rows[0];
    if (!row) throw new Error("Announcement was not found.");
    return announcementFromRow(row);
  }

  #assertExpectedVersion(announcement: Announcement, expectedVersion: number): void {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected Announcement version must be a positive integer.");
    }
    if (announcement.version !== expectedVersion) {
      throw new Error("Announcement changed since it was loaded.");
    }
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    subjectId: string,
    boundary: AnnouncementSecurityBoundary,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.subjectType !== "announcement" || event.subjectId !== subjectId) {
      throw new Error("Announcement Chronicle evidence does not match the mutation.");
    }
    if (event.spaceId !== boundary.spaceId || event.ownerIdentityId !== boundary.ownerIdentityId ||
        event.visibility !== boundary.visibility ||
        event.classification !== boundary.classification ||
        sortedIds(event.allowedIdentityIds) !== sortedIds(boundary.allowedIdentityIds)) {
      throw new Error("Announcement Chronicle evidence must preserve the resource boundary.");
    }
  }

  #select(): string {
    return `SELECT a.id::text, a.guild_id::text, a.space_id::text, a.target_role_id::text,
                   a.owner_identity_id::text, a.creator_identity_id::text, a.title, a.body,
                   a.status, a.visibility, a.classification, a.allowed_identity_ids::text[],
                   a.published_at::text, a.expires_at::text, a.version,
                   a.created_at::text, a.updated_at::text
              FROM announcements a`;
  }

  #authorizationCtes(): string {
    return `announcement_actor AS (
              SELECT identity_row.id, membership_row.state, membership_row.clearance,
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
            announcement_read_grants AS (
              SELECT binding_row.role_id, binding_row.space_id
                FROM role_bindings binding_row
                JOIN role_permissions permission_row
                  ON permission_row.guild_id = binding_row.guild_id
                 AND permission_row.role_id = binding_row.role_id
               WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
                 AND permission_row.permission = 'announcement.read'
            ),
            announcement_manage_grants AS (
              SELECT binding_row.space_id
                FROM role_bindings binding_row
                JOIN role_permissions permission_row
                  ON permission_row.guild_id = binding_row.guild_id
                 AND permission_row.role_id = binding_row.role_id
                CROSS JOIN announcement_actor actor_row
               WHERE binding_row.guild_id = $1 AND binding_row.identity_id = $2
                 AND actor_row.state = 'active'
                 AND permission_row.permission = 'announcement.manage'
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
        SELECT 1 FROM announcement_read_grants read_grant
         WHERE read_grant.space_id IS NULL
            OR ${alias}.space_id IS NOT NULL
               AND guild_runtime.space_contains($1, read_grant.space_id, ${alias}.space_id)
      ))
      AND (
        (${alias}.status = 'published'
          AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now())
          AND (${alias}.target_role_id IS NULL OR actor.is_root
            OR ${alias}.owner_identity_id = actor.id
            OR EXISTS (
              SELECT 1 FROM announcement_read_grants target_grant
               WHERE target_grant.role_id = ${alias}.target_role_id
                 AND (target_grant.space_id IS NULL
                   OR ${alias}.space_id IS NOT NULL
                      AND guild_runtime.space_contains($1, target_grant.space_id, ${alias}.space_id))
            )))
        OR actor.is_root
        OR ${alias}.owner_identity_id = actor.id
        OR EXISTS (
          SELECT 1 FROM announcement_manage_grants manage_grant
           WHERE manage_grant.space_id IS NULL
              OR ${alias}.space_id IS NOT NULL
                 AND guild_runtime.space_contains($1, manage_grant.space_id, ${alias}.space_id)
        )
      )
    )`;
  }
}
