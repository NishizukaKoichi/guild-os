import { createHash, randomUUID } from "node:crypto";
import type { ChronicleEvent, JsonObject, JsonValue } from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export const PERSISTED_FEDERATION_EVENT_TYPES = {
  resourcesPublished: "guild.federation.resources.published",
  grantsRevoked: "guild.federation.grants.revoked",
  linkRevoked: "guild.federation.link.revoked",
} as const;

export type PersistedFederationEventType =
  (typeof PERSISTED_FEDERATION_EVENT_TYPES)[keyof typeof PERSISTED_FEDERATION_EVENT_TYPES];
export type PersistedFederationResourceType = "memory" | "activity" | "decision";
export type PersistedFederationPermission = "read" | "participate";
export type PersistedFederationAuthorization = "authorized" | "denied" | "revoked";

export type FederationPersistenceErrorCode =
  | "invalid_request"
  | "link_inactive"
  | "direction_not_allowed"
  | "source_mismatch"
  | "grant_not_authorized"
  | "grant_revoked"
  | "payload_hash_mismatch"
  | "attempt_limit";

export class FederationPersistenceError extends Error {
  readonly code: FederationPersistenceErrorCode;

  constructor(code: FederationPersistenceErrorCode) {
    super(`Federation persistence rejected the operation (${code}).`);
    this.name = "FederationPersistenceError";
    this.code = code;
  }
}

export interface PersistedFederationLease {
  readonly direction: "inbound" | "outbound";
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface PersistedFederationOutboundDelivery {
  readonly id: string;
  readonly guildId: string;
  readonly federationLinkId: string;
  readonly eventType: PersistedFederationEventType;
  readonly payload: JsonObject;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
}

export type PersistedFederationOutboundClaim =
  | { readonly state: "idle" }
  | {
      readonly state: "terminal";
      readonly deliveryId: string;
      readonly errorCode: FederationPersistenceErrorCode;
    }
  | {
      readonly state: "leased";
      readonly lease: PersistedFederationLease & { readonly direction: "outbound" };
      readonly delivery: PersistedFederationOutboundDelivery;
    };

export type PersistedFederationInboundClaim =
  | { readonly state: "accepted"; readonly lease: PersistedFederationLease & { readonly direction: "inbound" } }
  | { readonly state: "duplicate" | "conflict" | "busy"; readonly lease: null };

export interface ClaimFederationOutboundInput {
  readonly workerId: string;
  readonly systemActorId: string;
  readonly now: string;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
}

export interface ClaimFederationInboundInput {
  readonly workerId: string;
  readonly systemActorId: string;
  readonly now: string;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly deliveryId: string;
  readonly federationLinkId: string;
  readonly eventType: PersistedFederationEventType;
  readonly payload: JsonObject;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly envelopeFingerprint: string;
  readonly receivedChronicleEvent: ChronicleEvent;
}

export interface SettleFederationLeaseInput {
  readonly lease: PersistedFederationLease;
  readonly now: string;
}

export interface AuthorizeFederationInboundInput {
  readonly federationLinkId: string;
  readonly eventType: PersistedFederationEventType;
  readonly payload: JsonObject;
}

export interface ApplyFederationInboundInput {
  readonly sourceGuildId: string;
  readonly targetGuildId: string;
  readonly federationLinkId: string;
  readonly deliveryId: string;
  readonly eventType: PersistedFederationEventType;
  readonly payload: JsonObject;
}

export interface FederatedInboundResource {
  readonly guildId: string;
  readonly federationLinkId: string;
  readonly remoteActorId: string;
  readonly sourceGuildId: string;
  readonly grantId: string;
  readonly resourceType: PersistedFederationResourceType;
  readonly resourceId: string;
  readonly permission: PersistedFederationPermission;
  readonly grantVersion: number;
  readonly resourceVersion: number | null;
  readonly status: "active" | "revoked";
  readonly resource: JsonObject | null;
  readonly resourceHash: string | null;
  readonly receivedDeliveryId: string;
  readonly revokedDeliveryId: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ClaimedDeliveryRow extends QueryResultRow {
  id: string;
  guild_id: string;
  federation_link_id: string;
  event_type: string;
  payload: JsonObject;
  transport_payload: JsonObject | null;
  transport_payload_hash: string | null;
  idempotency_key: string;
  attempt_count: number;
  effective_max_attempts: number;
  lease_token: string;
  lease_owner: string;
  lease_expires_at: string;
}

interface DeliveryStateRow extends QueryResultRow {
  id: string;
  federation_link_id: string;
  direction: "inbound" | "outbound";
  event_type: string;
  payload_hash: string;
  idempotency_key: string;
  status: "pending" | "processing" | "completed" | "failed" | "rejected";
  attempt_count: number;
  max_attempts: number;
  envelope_fingerprint: string | null;
  lease_expires_at: string | null;
}

interface MaterializedGrantRow extends QueryResultRow {
  position: number;
  grant_id: string;
  resource_type: string;
  resource_id: string;
  permission: string;
  status: "active" | "revoked";
  grant_version: number;
  resource_version: number | null;
  resource: JsonObject | null;
  link_status: "pending" | "active" | "revoked";
  link_direction: "inbound" | "outbound" | "bidirectional";
  type_allowed: boolean;
}

interface InboundProjectionRow extends QueryResultRow {
  guild_id: string;
  federation_link_id: string;
  remote_actor_id: string;
  source_guild_id: string;
  grant_id: string;
  resource_type: PersistedFederationResourceType;
  resource_id: string;
  permission: PersistedFederationPermission;
  grant_version: number;
  resource_version: number | null;
  status: "active" | "revoked";
  resource: JsonObject | null;
  resource_hash: string | null;
  received_delivery_id: string;
  revoked_delivery_id: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkStateRow extends QueryResultRow {
  remote_guild_id: string;
  remote_actor_id: string;
  direction: "inbound" | "outbound" | "bidirectional";
  status: "pending" | "active" | "revoked";
  allowed_resource_types: string[];
  remote_version: number;
}

interface GrantCoordinates {
  readonly grantId: string;
  readonly resourceType: PersistedFederationResourceType;
  readonly resourceId: string;
  readonly permission: PersistedFederationPermission;
  readonly grantVersion: number;
}

interface PublishedGrant extends GrantCoordinates {
  readonly resourceVersion: number;
  readonly resource: JsonObject;
}

interface RevokedGrant extends GrantCoordinates {
  readonly revokedAt: string;
}

interface ExistingProjectionRow extends QueryResultRow {
  grant_id: string;
  resource_type: PersistedFederationResourceType;
  resource_id: string;
  permission: PersistedFederationPermission;
  status: "active" | "revoked";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_GRANTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 32 || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, seen, depth + 1));
  return Object.values(value).every((entry) => isJsonValue(entry, seen, depth + 1));
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValue(value);
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}

function assertBoundedText(value: string, label: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertPositiveInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is outside its supported range.`);
  }
}

function assertHash(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
}

function isEventType(value: string): value is PersistedFederationEventType {
  return Object.values(PERSISTED_FEDERATION_EVENT_TYPES).some((candidate) => candidate === value);
}

function isResourceType(value: unknown): value is PersistedFederationResourceType {
  return value === "memory" || value === "activity" || value === "decision";
}

function isPermission(value: unknown): value is PersistedFederationPermission {
  return value === "read" || value === "participate";
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`).join(",")}}`;
}

export function hashPersistedFederationJson(value: JsonObject): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function leaseExpiry(now: string, durationMs: number): string {
  assertTimestamp(now, "Federation lease time");
  if (!Number.isSafeInteger(durationMs) || durationMs < 15_000 || durationMs > 15 * 60_000) {
    throw new Error("Federation lease duration is outside its supported range.");
  }
  return new Date(Date.parse(now) + durationMs).toISOString();
}

function persistenceError(code: FederationPersistenceErrorCode): FederationPersistenceError {
  return new FederationPersistenceError(code);
}

function selectorGrantIds(payload: JsonObject): readonly string[] {
  const grants = payload.grants;
  if (!Array.isArray(grants) || grants.length < 1 || grants.length > MAX_GRANTS) {
    throw persistenceError("invalid_request");
  }
  const ids = grants.map((entry) => {
    if (!isRecord(entry) || typeof entry.grantId !== "string" || !UUID_PATTERN.test(entry.grantId)) {
      throw persistenceError("invalid_request");
    }
    return entry.grantId;
  });
  if (new Set(ids).size !== ids.length) throw persistenceError("invalid_request");
  return ids;
}

function grantCoordinates(value: unknown): GrantCoordinates {
  if (!isRecord(value) || typeof value.grantId !== "string" || !UUID_PATTERN.test(value.grantId) ||
      !isResourceType(value.resourceType) || typeof value.resourceId !== "string" ||
      !UUID_PATTERN.test(value.resourceId) || !isPermission(value.permission) ||
      !Number.isSafeInteger(value.grantVersion) || typeof value.grantVersion !== "number" ||
      value.grantVersion < 1) {
    throw persistenceError("invalid_request");
  }
  return {
    grantId: value.grantId,
    resourceType: value.resourceType,
    resourceId: value.resourceId,
    permission: value.permission,
    grantVersion: value.grantVersion,
  };
}

function publishedGrants(payload: JsonObject): readonly PublishedGrant[] {
  if (payload.kind !== "resources_published" || !Array.isArray(payload.grants) ||
      payload.grants.length < 1 || payload.grants.length > MAX_GRANTS) {
    throw persistenceError("invalid_request");
  }
  const grants = payload.grants.map((entry) => {
    const coordinates = grantCoordinates(entry);
    if (!isRecord(entry) || !Number.isSafeInteger(entry.resourceVersion) ||
        typeof entry.resourceVersion !== "number" || entry.resourceVersion < 1 ||
        !isJsonObject(entry.resource)) throw persistenceError("invalid_request");
    return { ...coordinates, resourceVersion: entry.resourceVersion, resource: entry.resource };
  });
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw persistenceError("invalid_request");
  }
  return grants;
}

function revokedGrants(payload: JsonObject): readonly RevokedGrant[] {
  if (payload.kind !== "grants_revoked" || !Array.isArray(payload.grants) ||
      payload.grants.length < 1 || payload.grants.length > MAX_GRANTS) {
    throw persistenceError("invalid_request");
  }
  const grants = payload.grants.map((entry) => {
    const coordinates = grantCoordinates(entry);
    if (!isRecord(entry) || typeof entry.revokedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.revokedAt))) throw persistenceError("invalid_request");
    return { ...coordinates, revokedAt: new Date(entry.revokedAt).toISOString() };
  });
  if (new Set(grants.map((grant) => grant.grantId)).size !== grants.length) {
    throw persistenceError("invalid_request");
  }
  return grants;
}

function linkRevocation(payload: JsonObject): { readonly linkVersion: number; readonly revokedAt: string } {
  if (payload.kind !== "link_revoked" || !Number.isSafeInteger(payload.linkVersion) ||
      typeof payload.linkVersion !== "number" || payload.linkVersion < 1 ||
      typeof payload.revokedAt !== "string" || !Number.isFinite(Date.parse(payload.revokedAt))) {
    throw persistenceError("invalid_request");
  }
  return {
    linkVersion: payload.linkVersion,
    revokedAt: new Date(payload.revokedAt).toISOString(),
  };
}

function safeTerminalChronicle(
  guildId: string,
  systemActorId: string,
  deliveryId: string,
  eventType: string,
  errorCode: FederationPersistenceErrorCode,
  occurredAt: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: systemActorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: systemActorId,
    action: "federation.delivery.rejected",
    subjectType: "federation_delivery",
    subjectId: deliveryId,
    correlationId: randomUUID(),
    occurredAt,
    details: {
      direction: "outbound",
      eventType,
      errorCode,
      source: "federation-postgres",
    },
  };
}

function projectionFromRow(row: InboundProjectionRow): FederatedInboundResource {
  return {
    guildId: row.guild_id,
    federationLinkId: row.federation_link_id,
    remoteActorId: row.remote_actor_id,
    sourceGuildId: row.source_guild_id,
    grantId: row.grant_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    permission: row.permission,
    grantVersion: row.grant_version,
    resourceVersion: row.resource_version,
    status: row.status,
    resource: row.resource,
    resourceHash: row.resource_hash,
    receivedDeliveryId: row.received_delivery_id,
    revokedDeliveryId: row.revoked_delivery_id,
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const PROJECTION_COLUMNS = `
  guild_id::text, federation_link_id::text, remote_actor_id::text,
  source_guild_id::text, grant_id::text, resource_type, resource_id::text,
  permission, grant_version, resource_version, status, resource, resource_hash,
  received_delivery_id::text, revoked_delivery_id::text, revoked_at::text,
  created_at::text, updated_at::text`;

export class GuildFederationRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    assertUuid(guildId, "Guild ID");
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async claimOutboundDelivery(
    input: ClaimFederationOutboundInput,
  ): Promise<PersistedFederationOutboundClaim> {
    assertBoundedText(input.workerId, "Federation worker ID", 200);
    assertUuid(input.systemActorId, "Federation system Actor ID");
    assertPositiveInteger(input.maxAttempts, "Federation max attempts", 20);
    const expiresAt = leaseExpiry(input.now, input.leaseDurationMs);
    const exhausted = (await this.#connection.query<{
      id: string;
      event_type: string;
    }>(
      `WITH candidate AS (
         SELECT id
           FROM federation_deliveries
          WHERE guild_id = $1 AND direction = 'outbound'
            AND status IN ('pending', 'processing', 'failed')
            AND attempt_count >= LEAST(max_attempts, $3::integer)
            AND (status <> 'processing' OR lease_expires_at <= $2)
          ORDER BY COALESCE(lease_expires_at, available_at), created_at, id
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE federation_deliveries delivery
          SET status = 'rejected', completed_at = $2,
              last_error = 'Federation delivery exhausted its attempt limit.',
              lease_token = NULL, lease_owner = NULL,
              lease_expires_at = NULL, heartbeat_at = NULL
         FROM candidate
        WHERE delivery.guild_id = $1 AND delivery.id = candidate.id
       RETURNING delivery.id::text, delivery.event_type`,
      [this.#guildId, input.now, input.maxAttempts],
    )).rows[0];
    if (exhausted) {
      await this.#chronicle.appendChronicle(safeTerminalChronicle(
        this.#guildId,
        input.systemActorId,
        exhausted.id,
        exhausted.event_type,
        "attempt_limit",
        input.now,
      ));
      return { state: "terminal", deliveryId: exhausted.id, errorCode: "attempt_limit" };
    }
    const token = randomUUID();
    const claimed = (await this.#connection.query<ClaimedDeliveryRow>(
      `WITH candidate AS (
         SELECT delivery.id
           FROM federation_deliveries delivery
           JOIN federation_links link
             ON link.guild_id = delivery.guild_id
            AND link.id = delivery.federation_link_id
          WHERE delivery.guild_id = $1 AND delivery.direction = 'outbound'
            AND delivery.attempt_count < LEAST(delivery.max_attempts, $6::integer)
            AND (
              (delivery.status IN ('pending', 'failed') AND delivery.available_at <= $2)
              OR (delivery.status = 'processing' AND delivery.lease_expires_at <= $2)
            )
            AND link.direction IN ('outbound', 'bidirectional')
            AND (
              (delivery.event_type = $7 AND link.status IN ('active', 'revoked'))
              OR (delivery.event_type <> $7 AND link.status = 'active')
            )
          ORDER BY COALESCE(delivery.lease_expires_at, delivery.available_at),
                   delivery.created_at, delivery.id
          FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
       )
       UPDATE federation_deliveries delivery
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_token = $3, lease_owner = $4, lease_expires_at = $5,
              heartbeat_at = $2, last_error = NULL
         FROM candidate
        WHERE delivery.guild_id = $1 AND delivery.id = candidate.id
       RETURNING delivery.id::text, delivery.guild_id::text,
                 delivery.federation_link_id::text, delivery.event_type,
                 delivery.payload, delivery.transport_payload,
                 delivery.transport_payload_hash, delivery.idempotency_key,
                 delivery.attempt_count,
                 LEAST(delivery.max_attempts, $6::integer) AS effective_max_attempts,
                 delivery.lease_token::text, delivery.lease_owner,
                 delivery.lease_expires_at::text`,
      [
        this.#guildId,
        input.now,
        token,
        input.workerId,
        expiresAt,
        input.maxAttempts,
        PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked,
      ],
    )).rows[0];
    if (!claimed) return { state: "idle" };

    try {
      if (!isEventType(claimed.event_type)) throw persistenceError("invalid_request");
      const payload = claimed.transport_payload ?? await this.#materializeOutboundPayload(claimed);
      const payloadHash = hashPersistedFederationJson(payload);
      if (claimed.transport_payload_hash !== null && claimed.transport_payload_hash !== payloadHash) {
        throw persistenceError("payload_hash_mismatch");
      }
      if (claimed.transport_payload === null) {
        const bound = await this.#connection.query(
          `UPDATE federation_deliveries
              SET transport_payload = $4::jsonb, transport_payload_hash = $5
            WHERE guild_id = $1 AND id = $2 AND status = 'processing'
              AND lease_token = $3 AND transport_payload IS NULL
          RETURNING id`,
          [this.#guildId, claimed.id, claimed.lease_token, JSON.stringify(payload), payloadHash],
        );
        if (!bound.rows[0]) throw new Error("Federation transport payload lease was lost.");
      }
      return {
        state: "leased",
        lease: {
          direction: "outbound",
          deliveryId: claimed.id,
          leaseToken: claimed.lease_token,
          leaseOwner: claimed.lease_owner,
          leaseExpiresAt: new Date(claimed.lease_expires_at).toISOString(),
          attempt: claimed.attempt_count,
          maxAttempts: claimed.effective_max_attempts,
        },
        delivery: {
          id: claimed.id,
          guildId: claimed.guild_id,
          federationLinkId: claimed.federation_link_id,
          eventType: claimed.event_type,
          payload,
          payloadHash,
          idempotencyKey: claimed.idempotency_key,
          attemptCount: claimed.attempt_count,
        },
      };
    } catch (error: unknown) {
      if (!(error instanceof FederationPersistenceError)) throw error;
      const rejected = await this.#connection.query(
        `UPDATE federation_deliveries
            SET status = 'rejected', completed_at = $5, last_error = $6,
                lease_token = NULL, lease_owner = NULL,
                lease_expires_at = NULL, heartbeat_at = NULL
          WHERE guild_id = $1 AND id = $2 AND status = 'processing'
            AND lease_token = $3 AND lease_owner = $4
        RETURNING id`,
        [
          this.#guildId,
          claimed.id,
          claimed.lease_token,
          claimed.lease_owner,
          input.now,
          `Federation delivery rejected (${error.code}).`,
        ],
      );
      if (!rejected.rows[0]) throw new Error("Federation terminal claim lease was lost.");
      await this.#chronicle.appendChronicle(safeTerminalChronicle(
        this.#guildId,
        input.systemActorId,
        claimed.id,
        claimed.event_type,
        error.code,
        input.now,
      ));
      return { state: "terminal", deliveryId: claimed.id, errorCode: error.code };
    }
  }

  async claimInboundDelivery(
    input: ClaimFederationInboundInput,
  ): Promise<PersistedFederationInboundClaim> {
    assertBoundedText(input.workerId, "Federation worker ID", 200);
    assertUuid(input.systemActorId, "Federation system Actor ID");
    assertUuid(input.deliveryId, "Federation delivery ID");
    assertUuid(input.federationLinkId, "Federation link ID");
    assertHash(input.payloadHash, "Federation payload hash");
    assertHash(input.envelopeFingerprint, "Federation envelope fingerprint");
    assertBoundedText(input.idempotencyKey, "Federation idempotency key", 500);
    assertPositiveInteger(input.maxAttempts, "Federation max attempts", 20);
    assertTimestamp(input.now, "Federation receive time");
    const expiresAt = leaseExpiry(input.now, input.leaseDurationMs);
    const link = await this.#linkState(input.federationLinkId, true);

    let row = (await this.#connection.query<DeliveryStateRow>(
      `SELECT id::text, federation_link_id::text, direction, event_type, payload_hash,
              idempotency_key, status, attempt_count, max_attempts,
              envelope_fingerprint, lease_expires_at::text
         FROM federation_deliveries
        WHERE guild_id = $1 AND (id = $2 OR idempotency_key = $3)
        ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END
        FOR UPDATE LIMIT 1`,
      [this.#guildId, input.deliveryId, input.idempotencyKey],
    )).rows[0];

    if (!row) {
      if (link.status !== "active") return { state: "conflict", lease: null };
      if (link.direction !== "inbound" && link.direction !== "bidirectional") {
        return { state: "conflict", lease: null };
      }
      row = (await this.#connection.query<DeliveryStateRow>(
        `INSERT INTO federation_deliveries
           (id, guild_id, federation_link_id, direction, event_type, payload,
            payload_hash, idempotency_key, status, available_at, max_attempts,
            envelope_fingerprint)
         VALUES ($1, $2, $3, 'inbound', $4, $5::jsonb, $6, $7, 'pending', $8, $9, $10)
         ON CONFLICT DO NOTHING
         RETURNING id::text, federation_link_id::text, direction, event_type, payload_hash,
                   idempotency_key, status, attempt_count, max_attempts,
                   envelope_fingerprint, lease_expires_at::text`,
        [
          input.deliveryId,
          this.#guildId,
          input.federationLinkId,
          input.eventType,
          JSON.stringify(input.payload),
          input.payloadHash,
          input.idempotencyKey,
          input.now,
          input.maxAttempts,
          input.envelopeFingerprint,
        ],
      )).rows[0];
      if (row) {
        await this.#chronicle.appendChronicle(input.receivedChronicleEvent);
      } else {
        row = (await this.#connection.query<DeliveryStateRow>(
          `SELECT id::text, federation_link_id::text, direction, event_type, payload_hash,
                  idempotency_key, status, attempt_count, max_attempts,
                  envelope_fingerprint, lease_expires_at::text
             FROM federation_deliveries
            WHERE guild_id = $1 AND (id = $2 OR idempotency_key = $3)
            ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END
            FOR UPDATE LIMIT 1`,
          [this.#guildId, input.deliveryId, input.idempotencyKey],
        )).rows[0];
      }
    }

    if (!row || row.id !== input.deliveryId || row.federation_link_id !== input.federationLinkId ||
        row.direction !== "inbound" || row.event_type !== input.eventType ||
        row.payload_hash !== input.payloadHash || row.idempotency_key !== input.idempotencyKey ||
        row.envelope_fingerprint !== input.envelopeFingerprint) {
      return { state: "conflict", lease: null };
    }
    if (row.status === "completed") return { state: "duplicate", lease: null };
    if (row.status === "rejected") return { state: "conflict", lease: null };
    if (row.status === "processing" && row.lease_expires_at !== null &&
        Date.parse(row.lease_expires_at) > Date.parse(input.now)) {
      return { state: "busy", lease: null };
    }
    const effectiveMaxAttempts = Math.min(row.max_attempts, input.maxAttempts);
    if (row.attempt_count >= effectiveMaxAttempts) {
      const rejected = await this.#connection.query(
        `UPDATE federation_deliveries
            SET status = 'rejected', completed_at = $3,
                last_error = 'Federation delivery exhausted its attempt limit.',
                lease_token = NULL, lease_owner = NULL,
                lease_expires_at = NULL, heartbeat_at = NULL
          WHERE guild_id = $1 AND id = $2
            AND status IN ('pending', 'processing', 'failed')
            AND (status <> 'processing' OR lease_expires_at <= $3)
        RETURNING id`,
        [this.#guildId, input.deliveryId, input.now],
      );
      if (rejected.rows[0]) {
        await this.#chronicle.appendChronicle(safeTerminalChronicle(
          this.#guildId,
          input.systemActorId,
          input.deliveryId,
          input.eventType,
          "attempt_limit",
          input.now,
        ));
      }
      return { state: "conflict", lease: null };
    }

    const token = randomUUID();
    const leased = (await this.#connection.query<{
      lease_token: string;
      lease_owner: string;
      lease_expires_at: string;
      attempt_count: number;
    }>(
      `UPDATE federation_deliveries
          SET status = 'processing', attempt_count = attempt_count + 1,
              lease_token = $3, lease_owner = $4, lease_expires_at = $5,
              heartbeat_at = $2, last_error = NULL
        WHERE guild_id = $1 AND id = $6
          AND status IN ('pending', 'failed', 'processing')
          AND (status <> 'processing' OR lease_expires_at <= $2)
       RETURNING lease_token::text, lease_owner, lease_expires_at::text, attempt_count`,
      [this.#guildId, input.now, token, input.workerId, expiresAt, input.deliveryId],
    )).rows[0];
    if (!leased) return { state: "busy", lease: null };
    return {
      state: "accepted",
      lease: {
        direction: "inbound",
        deliveryId: input.deliveryId,
        leaseToken: leased.lease_token,
        leaseOwner: leased.lease_owner,
        leaseExpiresAt: new Date(leased.lease_expires_at).toISOString(),
        attempt: leased.attempt_count,
        maxAttempts: effectiveMaxAttempts,
      },
    };
  }

  async settleDeliveryLease(input: SettleFederationLeaseInput): Promise<boolean> {
    assertTimestamp(input.now, "Federation settlement time");
    const settled = await this.#connection.query(
      `UPDATE federation_deliveries
          SET lease_token = NULL, lease_owner = NULL,
              lease_expires_at = NULL, heartbeat_at = NULL
        WHERE guild_id = $1 AND id = $2 AND direction = $3
          AND status = 'processing' AND lease_token = $4 AND lease_owner = $5
          AND lease_expires_at > GREATEST($6::timestamptz, now())
      RETURNING id`,
      [
        this.#guildId,
        input.lease.deliveryId,
        input.lease.direction,
        input.lease.leaseToken,
        input.lease.leaseOwner,
        input.now,
      ],
    );
    return settled.rows[0] !== undefined;
  }

  async authorizeInboundPayload(
    input: AuthorizeFederationInboundInput,
  ): Promise<PersistedFederationAuthorization> {
    const link = await this.#linkState(input.federationLinkId, false);
    if (link.direction !== "inbound" && link.direction !== "bidirectional") return "denied";
    if (input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked) {
      try {
        linkRevocation(input.payload);
      } catch (error: unknown) {
        if (error instanceof FederationPersistenceError) return "denied";
        throw error;
      }
      return link.status === "active" || link.status === "revoked" ? "authorized" : "denied";
    }
    if (link.status !== "active") return "revoked";

    let grants: readonly GrantCoordinates[];
    try {
      grants = input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished
        ? publishedGrants(input.payload)
        : input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.grantsRevoked
          ? revokedGrants(input.payload)
          : [];
    } catch (error: unknown) {
      if (error instanceof FederationPersistenceError) return "denied";
      throw error;
    }
    if (grants.length === 0 || grants.some((grant) =>
      !link.allowed_resource_types.includes(grant.resourceType))) return "denied";
    const existing = (await this.#connection.query<ExistingProjectionRow>(
      `SELECT grant_id::text, resource_type, resource_id::text, permission, status
         FROM federation_inbound_resources
        WHERE guild_id = $1 AND federation_link_id = $2
          AND grant_id = ANY($3::uuid[])`,
      [this.#guildId, input.federationLinkId, grants.map((grant) => grant.grantId)],
    )).rows;
    for (const row of existing) {
      const incoming = grants.find((grant) => grant.grantId === row.grant_id);
      if (!incoming || incoming.resourceType !== row.resource_type ||
          incoming.resourceId !== row.resource_id || incoming.permission !== row.permission) {
        return "denied";
      }
      if (input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished &&
          row.status === "revoked") return "revoked";
    }
    return "authorized";
  }

  async applyInboundEnvelope(input: ApplyFederationInboundInput): Promise<void> {
    if (input.targetGuildId !== this.#guildId) throw persistenceError("invalid_request");
    const link = await this.#linkState(input.federationLinkId, true);
    if (link.remote_guild_id !== input.sourceGuildId) throw persistenceError("source_mismatch");
    if (link.direction !== "inbound" && link.direction !== "bidirectional") {
      throw persistenceError("direction_not_allowed");
    }
    await this.#assertInboundDelivery(input.deliveryId, input.federationLinkId);
    if (input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished) {
      if (link.status !== "active") throw persistenceError("link_inactive");
      await this.#applyPublishedGrants(
        link,
        input.federationLinkId,
        input.deliveryId,
        publishedGrants(input.payload),
      );
      return;
    }
    if (input.eventType === PERSISTED_FEDERATION_EVENT_TYPES.grantsRevoked) {
      if (link.status !== "active") throw persistenceError("link_inactive");
      await this.#applyRevokedGrants(
        link,
        input.federationLinkId,
        input.deliveryId,
        revokedGrants(input.payload),
      );
      return;
    }
    if (input.eventType !== PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked) {
      throw persistenceError("invalid_request");
    }
    const revocation = linkRevocation(input.payload);
    await this.#connection.query("SELECT set_config('app.federation_delivery_id', $1, true)", [
      input.deliveryId,
    ]);
    await this.#connection.query(
      "SELECT set_config('app.federation_inbound_revocation', 'true', true)",
    );
    await this.#connection.query(
      `UPDATE federation_links
          SET status = 'revoked', version = CASE WHEN status = 'revoked' THEN version ELSE version + 1 END,
              remote_version = GREATEST(remote_version, $3), updated_at = now()
        WHERE guild_id = $1 AND id = $2 AND status IN ('active', 'revoked')`,
      [this.#guildId, input.federationLinkId, revocation.linkVersion],
    );
  }

  async getInboundResource(
    federationLinkId: string,
    grantId: string,
  ): Promise<FederatedInboundResource | null> {
    assertUuid(federationLinkId, "Federation link ID");
    assertUuid(grantId, "Federation grant ID");
    const row = (await this.#connection.query<InboundProjectionRow>(
      `SELECT ${PROJECTION_COLUMNS}
         FROM federation_inbound_resources
        WHERE guild_id = $1 AND federation_link_id = $2 AND grant_id = $3`,
      [this.#guildId, federationLinkId, grantId],
    )).rows[0];
    return row ? projectionFromRow(row) : null;
  }

  async getRemoteGuildActorId(federationLinkId: string): Promise<string> {
    assertUuid(federationLinkId, "Federation link ID");
    const row = (await this.#connection.query<{ remote_actor_id: string }>(
      `SELECT link.remote_actor_id::text
         FROM federation_links link
         JOIN actors actor ON actor.id = link.remote_actor_id AND actor.kind = 'guild'
        WHERE link.guild_id = $1 AND link.id = $2`,
      [this.#guildId, federationLinkId],
    )).rows[0];
    if (!row) throw new Error("Federation remote Guild Actor was not found.");
    return row.remote_actor_id;
  }

  async #materializeOutboundPayload(row: ClaimedDeliveryRow): Promise<JsonObject> {
    if (row.event_type === PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked) {
      linkRevocation(row.payload);
      return row.payload;
    }
    const selectedIds = selectorGrantIds(row.payload);
    const grants = (await this.#connection.query<MaterializedGrantRow>(
      `SELECT reference.position, grant_record.id::text AS grant_id,
              grant_record.resource_type, grant_record.resource_id::text,
              grant_record.permission, grant_record.status,
              grant_record.version AS grant_version,
              CASE grant_record.resource_type
                WHEN 'memory' THEN memory_record.current_version
                WHEN 'activity' THEN activity_record.version
                WHEN 'decision' THEN decision_record.version
              END AS resource_version,
              CASE grant_record.resource_type
                WHEN 'memory' THEN (
                  SELECT jsonb_build_object(
                    'id', memory_record.id::text,
                    'type', memory_record.type,
                    'status', memory_record.status,
                    'workflow', memory_record.workflow,
                    'governanceState', memory_record.governance_state,
                    'visibility', memory_record.visibility,
                    'classification', memory_record.classification,
                    'version', version_record.version,
                    'title', version_record.title,
                    'summary', version_record.summary,
                    'body', version_record.body,
                    'changeNote', version_record.change_note,
                    'reviewDueAt', memory_record.review_due_at
                  )
                    FROM memory_versions version_record
                   WHERE version_record.guild_id = memory_record.guild_id
                     AND version_record.memory_id = memory_record.id
                     AND version_record.version = memory_record.current_version
                     AND memory_record.status <> 'archived'
                )
                WHEN 'activity' THEN CASE WHEN activity_record.status <> 'archived' THEN
                  jsonb_build_object(
                    'id', activity_record.id::text,
                    'type', activity_record.type,
                    'title', activity_record.title,
                    'description', activity_record.description,
                    'status', activity_record.status,
                    'visibility', activity_record.visibility,
                    'classification', activity_record.classification,
                    'startsAt', activity_record.starts_at,
                    'dueAt', activity_record.due_at,
                    'position', activity_record.position,
                    'version', activity_record.version
                  ) END
                WHEN 'decision' THEN jsonb_build_object(
                  'id', decision_record.id::text,
                  'title', decision_record.title,
                  'description', decision_record.description,
                  'status', decision_record.status,
                  'rationale', decision_record.rationale,
                  'method', decision_record.method,
                  'visibility', decision_record.visibility,
                  'classification', decision_record.classification,
                  'requiredApprovals', decision_record.required_approvals,
                  'approvalCount', decision_record.approval_count,
                  'participationCount', decision_record.participation_count,
                  'selectedOptionId', decision_record.selected_option_id::text,
                  'decidedAt', decision_record.decided_at,
                  'reviewAt', decision_record.review_at,
                  'version', decision_record.version,
                  'options', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                      'id', option_record.id::text,
                      'label', option_record.label,
                      'description', option_record.description,
                      'selected', option_record.selected,
                      'position', option_record.position
                    ) ORDER BY option_record.position, option_record.id)
                      FROM decision_options option_record
                     WHERE option_record.guild_id = decision_record.guild_id
                       AND option_record.decision_id = decision_record.id
                  ), '[]'::jsonb)
                )
              END AS resource,
              link.status AS link_status, link.direction AS link_direction,
              grant_record.resource_type = ANY(link.allowed_resource_types) AS type_allowed
         FROM federation_delivery_grants reference
         JOIN federation_grants grant_record
           ON grant_record.guild_id = reference.guild_id
          AND grant_record.federation_link_id = reference.federation_link_id
          AND grant_record.id = reference.grant_id
         JOIN federation_links link
           ON link.guild_id = reference.guild_id AND link.id = reference.federation_link_id
         LEFT JOIN memories memory_record
           ON grant_record.resource_type = 'memory'
          AND memory_record.guild_id = grant_record.guild_id
          AND memory_record.id = grant_record.resource_id
         LEFT JOIN activities activity_record
           ON grant_record.resource_type = 'activity'
          AND activity_record.guild_id = grant_record.guild_id
          AND activity_record.id = grant_record.resource_id
         LEFT JOIN decisions decision_record
           ON grant_record.resource_type = 'decision'
          AND decision_record.guild_id = grant_record.guild_id
          AND decision_record.id = grant_record.resource_id
        WHERE reference.guild_id = $1 AND reference.delivery_id = $2
        ORDER BY reference.position
        FOR SHARE OF grant_record, link`,
      [this.#guildId, row.id],
    )).rows;
    if (grants.length !== selectedIds.length || grants.some((grant, index) =>
      grant.grant_id !== selectedIds[index])) throw persistenceError("grant_not_authorized");

    if (row.event_type === PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished) {
      const published = grants.map((grant): JsonObject => {
        if (grant.link_status !== "active") throw persistenceError("link_inactive");
        if (grant.link_direction !== "outbound" && grant.link_direction !== "bidirectional") {
          throw persistenceError("direction_not_allowed");
        }
        if (grant.status === "revoked") throw persistenceError("grant_revoked");
        if (!isResourceType(grant.resource_type) || !isPermission(grant.permission) ||
            !grant.type_allowed || grant.resource === null || grant.resource_version === null) {
          throw persistenceError("grant_not_authorized");
        }
        return {
          grantId: grant.grant_id,
          resourceType: grant.resource_type,
          resourceId: grant.resource_id,
          permission: grant.permission,
          grantVersion: grant.grant_version,
          resourceVersion: grant.resource_version,
          resource: grant.resource,
        };
      });
      return { kind: "resources_published", grants: published };
    }

    if (row.event_type === PERSISTED_FEDERATION_EVENT_TYPES.grantsRevoked) {
      const requested = revokedGrants(row.payload);
      const revoked = grants.map((grant, index): JsonObject => {
        const request = requested[index];
        if (!request || grant.status !== "revoked" || !isResourceType(grant.resource_type) ||
            !isPermission(grant.permission) || grant.grant_id !== request.grantId ||
            grant.resource_type !== request.resourceType || grant.resource_id !== request.resourceId ||
            grant.permission !== request.permission || grant.grant_version !== request.grantVersion) {
          throw persistenceError("grant_not_authorized");
        }
        return {
          grantId: request.grantId,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          permission: request.permission,
          grantVersion: request.grantVersion,
          revokedAt: request.revokedAt,
        };
      });
      return { kind: "grants_revoked", grants: revoked };
    }
    throw persistenceError("invalid_request");
  }

  async #linkState(federationLinkId: string, forUpdate: boolean): Promise<LinkStateRow> {
    assertUuid(federationLinkId, "Federation link ID");
    const row = (await this.#connection.query<LinkStateRow>(
      `SELECT remote_guild_id::text, remote_actor_id::text, direction, status,
              allowed_resource_types, remote_version
         FROM federation_links
        WHERE guild_id = $1 AND id = $2
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [this.#guildId, federationLinkId],
    )).rows[0];
    if (!row) throw persistenceError("link_inactive");
    return row;
  }

  async #existingProjections(
    federationLinkId: string,
    grantIds: readonly string[],
  ): Promise<readonly ExistingProjectionRow[]> {
    return (await this.#connection.query<ExistingProjectionRow>(
      `SELECT grant_id::text, resource_type, resource_id::text, permission, status
         FROM federation_inbound_resources
        WHERE guild_id = $1 AND federation_link_id = $2
          AND grant_id = ANY($3::uuid[])
        FOR UPDATE`,
      [this.#guildId, federationLinkId, grantIds],
    )).rows;
  }

  #assertProjectionCoordinates(
    existing: readonly ExistingProjectionRow[],
    grants: readonly GrantCoordinates[],
    rejectTombstones: boolean,
  ): void {
    for (const row of existing) {
      const grant = grants.find((candidate) => candidate.grantId === row.grant_id);
      if (!grant || grant.resourceType !== row.resource_type || grant.resourceId !== row.resource_id ||
          grant.permission !== row.permission) throw persistenceError("grant_not_authorized");
      if (rejectTombstones && row.status === "revoked") throw persistenceError("grant_revoked");
    }
  }

  async #applyPublishedGrants(
    link: LinkStateRow,
    federationLinkId: string,
    deliveryId: string,
    grants: readonly PublishedGrant[],
  ): Promise<void> {
    if (grants.some((grant) => !link.allowed_resource_types.includes(grant.resourceType))) {
      throw persistenceError("grant_not_authorized");
    }
    const existing = await this.#existingProjections(
      federationLinkId,
      grants.map((grant) => grant.grantId),
    );
    this.#assertProjectionCoordinates(existing, grants, true);
    const records = grants.map((grant) => ({
      ...grant,
      resourceHash: hashPersistedFederationJson(grant.resource),
    }));
    await this.#connection.query(
      `INSERT INTO federation_inbound_resources (
         guild_id, federation_link_id, remote_actor_id, source_guild_id,
         grant_id, resource_type, resource_id, permission, grant_version,
         resource_version, status, resource, resource_hash, received_delivery_id
       )
       SELECT $1, $2, $3, $4, entry.grant_id, entry.resource_type,
              entry.resource_id, entry.permission, entry.grant_version,
              entry.resource_version, 'active', entry.resource, entry.resource_hash, $5
         FROM jsonb_to_recordset($6::jsonb) AS entry(
           grant_id uuid, resource_type text, resource_id uuid, permission text,
           grant_version integer, resource_version integer, resource jsonb,
           resource_hash text
         )
       ON CONFLICT (guild_id, federation_link_id, grant_id) DO UPDATE
         SET permission = EXCLUDED.permission,
             grant_version = EXCLUDED.grant_version,
             resource_version = EXCLUDED.resource_version,
             resource = EXCLUDED.resource,
             resource_hash = EXCLUDED.resource_hash,
             received_delivery_id = EXCLUDED.received_delivery_id,
             updated_at = now()
       WHERE federation_inbound_resources.status = 'active'
         AND (
           EXCLUDED.grant_version > federation_inbound_resources.grant_version
           OR (
             EXCLUDED.grant_version = federation_inbound_resources.grant_version
             AND EXCLUDED.resource_version >= federation_inbound_resources.resource_version
           )
         )`,
      [
        this.#guildId,
        federationLinkId,
        link.remote_actor_id,
        link.remote_guild_id,
        deliveryId,
        JSON.stringify(records.map((record) => ({
          grant_id: record.grantId,
          resource_type: record.resourceType,
          resource_id: record.resourceId,
          permission: record.permission,
          grant_version: record.grantVersion,
          resource_version: record.resourceVersion,
          resource: record.resource,
          resource_hash: record.resourceHash,
        }))),
      ],
    );
  }

  async #applyRevokedGrants(
    link: LinkStateRow,
    federationLinkId: string,
    deliveryId: string,
    grants: readonly RevokedGrant[],
  ): Promise<void> {
    if (grants.some((grant) => !link.allowed_resource_types.includes(grant.resourceType))) {
      throw persistenceError("grant_not_authorized");
    }
    const existing = await this.#existingProjections(
      federationLinkId,
      grants.map((grant) => grant.grantId),
    );
    this.#assertProjectionCoordinates(existing, grants, false);
    await this.#connection.query(
      `INSERT INTO federation_inbound_resources (
         guild_id, federation_link_id, remote_actor_id, source_guild_id,
         grant_id, resource_type, resource_id, permission, grant_version,
         resource_version, status, resource, resource_hash,
         received_delivery_id, revoked_delivery_id, revoked_at
       )
       SELECT $1, $2, $3, $4, entry.grant_id, entry.resource_type,
              entry.resource_id, entry.permission, entry.grant_version,
              NULL, 'revoked', NULL, NULL, $5, $5, entry.revoked_at
         FROM jsonb_to_recordset($6::jsonb) AS entry(
           grant_id uuid, resource_type text, resource_id uuid, permission text,
           grant_version integer, revoked_at timestamptz
         )
       ON CONFLICT (guild_id, federation_link_id, grant_id) DO UPDATE
         SET status = 'revoked', grant_version = GREATEST(
               federation_inbound_resources.grant_version,
               EXCLUDED.grant_version
             ),
             resource_version = NULL, resource = NULL, resource_hash = NULL,
             revoked_delivery_id = EXCLUDED.revoked_delivery_id,
             revoked_at = LEAST(federation_inbound_resources.revoked_at, EXCLUDED.revoked_at),
             updated_at = now()`,
      [
        this.#guildId,
        federationLinkId,
        link.remote_actor_id,
        link.remote_guild_id,
        deliveryId,
        JSON.stringify(grants.map((grant) => ({
          grant_id: grant.grantId,
          resource_type: grant.resourceType,
          resource_id: grant.resourceId,
          permission: grant.permission,
          grant_version: grant.grantVersion,
          revoked_at: grant.revokedAt,
        }))),
      ],
    );
  }

  async #assertInboundDelivery(deliveryId: string, federationLinkId: string): Promise<void> {
    const row = (await this.#connection.query(
      `SELECT 1 FROM federation_deliveries
        WHERE guild_id = $1 AND id = $2 AND federation_link_id = $3
          AND direction = 'inbound' AND status = 'processing'
        FOR KEY SHARE`,
      [this.#guildId, deliveryId, federationLinkId],
    )).rows[0];
    if (!row) throw persistenceError("invalid_request");
  }
}
