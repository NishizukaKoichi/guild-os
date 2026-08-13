import type {
  ChronicleEvent,
  FederationGrant,
  FederationLink,
} from "@guild-os/domain";
import {
  GuildOperationsRepository,
  GuildPostgresRepository,
  withGuildTransaction,
  type GuildTransactionConnection,
  type FinishFederationDeliveryInput,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import {
  FEDERATION_EVENT_TYPES,
  FederationTransportError,
  deliverFederationDelivery,
  hashFederationPayload,
  receiveFederationDelivery,
  type FederationDeliveryCompletion,
  type FederationDeliveryRetry,
  type FederationEnvelope,
  type FederationEventType,
  type FederationExplicitPayload,
  type FederationFetch,
  type FederationGrantAuthorization,
  type FederationInboundReservation,
  type FederationOutboundDelivery,
  type FederationSecretResolver,
  type FederationTransportLink,
  type FederationTransportRepository,
} from "./federation-transport.js";

const DELIVERY_PATH = "/api/federation/v1/deliveries";
const REVOCATION_PATH = "/api/federation/v1/revocations";
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 15 * 60_000;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 20;
const MAX_ATTEMPTS = 20;
const DEFAULT_REQUEST_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_WORKER_ID_LENGTH = 200;

type FederationOperationsRepository = Pick<GuildOperationsRepository,
  | "getFederationLink"
  | "listFederationGrants"
  | "finishFederationDelivery"
>;

type FederationChronicleRepository = Pick<GuildPostgresRepository, "appendChronicle">;

export interface FederationOperationsContext {
  readonly connection: GuildTransactionConnection;
  readonly operations: FederationOperationsRepository;
  readonly chronicle: FederationChronicleRepository;
}

export interface FederationOperationsAccess {
  transact<T>(operation: (context: FederationOperationsContext) => Promise<T>): Promise<T>;
}

export interface FederationLeaseCoordinates {
  readonly direction: "inbound" | "outbound";
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface FederationOutboundLease extends FederationLeaseCoordinates {
  readonly direction: "outbound";
  /** The payload and hash must be immutable and durably bound to this delivery before return. */
  readonly delivery: FederationOutboundDelivery;
}

export interface FederationInboundLease extends FederationLeaseCoordinates {
  readonly direction: "inbound";
}

export interface FederationInboundLeaseClaim {
  readonly state: "accepted" | "duplicate" | "conflict" | "busy";
  readonly lease: FederationInboundLease | null;
}

export type FederationOutboundLeaseClaim =
  | { readonly state: "idle" }
  | {
      readonly state: "terminal";
      readonly deliveryId: string;
      readonly errorCode: string;
    }
  | { readonly state: "leased"; readonly lease: FederationOutboundLease };

export interface FederationLeaseSettlementInput {
  readonly connection: GuildTransactionConnection;
  readonly lease: FederationLeaseCoordinates;
  readonly now: string;
  readonly outcome: "completed" | "retry" | "terminal";
}

/**
 * Migration 0032 has a durable delivery queue but no lease token columns. Purchasers must back
 * this port with transactional lease state (normally a small PostgreSQL sidecar table). Every
 * method receives the same transaction used by OperationsRepository, so lease CAS and delivery
 * state changes commit or roll back together.
 */
export interface FederationDurableLeasePort {
  claimOutbound(input: {
    readonly connection: GuildTransactionConnection;
    readonly guildId: string;
    readonly systemActorId: string;
    readonly workerId: string;
    readonly now: string;
    readonly leaseDurationMs: number;
    readonly maxAttempts: number;
  }): Promise<FederationOutboundLeaseClaim>;
  claimInbound(input: {
    readonly connection: GuildTransactionConnection;
    readonly guildId: string;
    readonly systemActorId: string;
    readonly workerId: string;
    readonly now: string;
    readonly leaseDurationMs: number;
    readonly maxAttempts: number;
    readonly envelope: FederationEnvelope;
    readonly envelopeFingerprint: string;
    readonly receivedChronicleEvent: ChronicleEvent;
  }): Promise<FederationInboundLeaseClaim>;
  /** Returns false if the token expired, was replaced, or belongs to another worker. */
  settle(input: FederationLeaseSettlementInput): Promise<boolean>;
}

/**
 * Remote resources and revocation tombstones are deliberately outside the local canonical tables.
 * Implementations may store a read-only remote projection, but may only persist `envelope.payload`.
 */
export interface FederationSharedDataPort {
  authorizeInbound(input: {
    readonly connection: GuildTransactionConnection;
    readonly link: FederationLink;
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization>;
  /** Recheck current tombstones before writing; this runs in the completion transaction. */
  applyInbound(input: {
    readonly connection: GuildTransactionConnection;
    readonly envelope: FederationEnvelope;
  }): Promise<void>;
}

export interface FederationRuntimeDependencies {
  readonly guildId: string;
  readonly systemActorId: string;
  readonly operations: FederationOperationsAccess;
  readonly leases: FederationDurableLeasePort;
  readonly sharedData: FederationSharedDataPort;
  readonly resolveSecret: FederationSecretResolver;
  readonly fetch: FederationFetch;
}

export interface FederationRuntimeOptions {
  readonly workerId: string;
  readonly leaseDurationMs?: number;
  readonly maxAttempts?: number;
  readonly transportTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly freshnessMs?: number;
  readonly now?: () => Date;
}

export type FederationMaintenanceOutcome =
  | { readonly status: "idle" }
  | {
      readonly status: "sent";
      readonly deliveryId: string;
      readonly remoteStatus: "accepted" | "duplicate";
    }
  | {
      readonly status: "retry_scheduled";
      readonly deliveryId: string;
      readonly errorCode: string;
    }
  | {
      readonly status: "terminal_failure";
      readonly deliveryId: string;
      readonly errorCode: string;
    }
  | { readonly status: "lease_lost"; readonly deliveryId: string };

type RuntimeSettlement =
  | { readonly kind: "completed"; readonly errorCode: null }
  | { readonly kind: "retry" | "terminal"; readonly errorCode: string };

export class FederationLeaseLostError extends Error {
  constructor() {
    super("Federation delivery lease is no longer owned by this worker.");
    this.name = "FederationLeaseLostError";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isEventType(value: unknown): value is FederationEventType {
  return Object.values(FEDERATION_EVENT_TYPES).some((candidate) => candidate === value);
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error("Federation runtime limit is invalid.");
  }
  return resolved;
}

function assertDependencies(
  dependencies: FederationRuntimeDependencies,
  options: FederationRuntimeOptions,
): void {
  if (!isUuid(dependencies.guildId) || !isUuid(dependencies.systemActorId) ||
      !isBoundedText(options.workerId, MAX_WORKER_ID_LENGTH)) {
    throw new Error("Federation runtime identity is invalid.");
  }
}

function assertLease(lease: FederationOutboundLease, guildId: string): void {
  if (lease.direction !== "outbound" || lease.delivery.guildId !== guildId ||
      lease.delivery.id !== lease.deliveryId || !isUuid(lease.deliveryId) ||
      !isBoundedText(lease.leaseToken, 500) || !isBoundedText(lease.leaseOwner, 200) ||
      !isIsoTimestamp(lease.leaseExpiresAt) || !Number.isSafeInteger(lease.attempt) ||
      lease.attempt < 1 || !Number.isSafeInteger(lease.maxAttempts) ||
      lease.maxAttempts < 1 || lease.maxAttempts > MAX_ATTEMPTS ||
      lease.attempt > lease.maxAttempts || !isEventType(lease.delivery.eventType)) {
    throw new Error("Federation queue returned an invalid durable lease.");
  }
}

function toTransportLink(link: FederationLink): FederationTransportLink {
  return {
    id: link.id,
    guildId: link.guildId,
    remoteGuildId: link.remoteGuildId,
    endpointUrl: link.endpointUrl,
    secretReference: link.secretReference,
    direction: link.direction,
    status: link.status,
  };
}

function safeChronicleEvent(
  guildId: string,
  actorId: string,
  action: string,
  subjectId: string,
  occurredAt: string,
  details: ChronicleEvent["details"],
): ChronicleEvent {
  return {
    id: crypto.randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType: "federation_delivery",
    subjectId,
    correlationId: crypto.randomUUID(),
    occurredAt,
    details,
  };
}

function completionChronicle(
  guildId: string,
  actorId: string,
  input: FederationDeliveryCompletion,
): ChronicleEvent {
  return safeChronicleEvent(
    guildId,
    actorId,
    input.chronicleEventType,
    input.deliveryId,
    input.occurredAt,
    {
      direction: input.direction,
      outcome: input.outcome,
      eventType: input.eventType,
      errorCode: input.errorCode,
      source: "federation-runtime",
    },
  );
}

function retryChronicle(
  guildId: string,
  actorId: string,
  input: FederationDeliveryRetry,
): ChronicleEvent {
  return safeChronicleEvent(
    guildId,
    actorId,
    input.chronicleEventType,
    input.deliveryId,
    input.occurredAt,
    {
      direction: input.direction,
      eventType: input.eventType,
      errorCode: input.errorCode,
      retryAt: input.retryAt,
      source: "federation-runtime",
    },
  );
}

function receivedChronicle(
  guildId: string,
  actorId: string,
  envelope: FederationEnvelope,
  occurredAt: string,
): ChronicleEvent {
  return safeChronicleEvent(
    guildId,
    actorId,
    "federation.delivery.received",
    envelope.deliveryId,
    occurredAt,
    {
      direction: "inbound",
      eventType: envelope.eventType,
      sourceGuildId: envelope.sourceGuildId,
      source: "federation-runtime",
    },
  );
}

function grantMatches(
  actual: FederationGrant,
  expected: {
    readonly grantId: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly permission: string;
    readonly grantVersion: number;
  },
): boolean {
  return actual.id === expected.grantId && actual.resourceType === expected.resourceType &&
    actual.resourceId === expected.resourceId && actual.permission === expected.permission &&
    actual.version === expected.grantVersion;
}

function authorizeOutboundAgainstOperations(
  link: FederationLink,
  grants: readonly FederationGrant[],
  eventType: FederationEventType,
  payload: FederationExplicitPayload,
): FederationGrantAuthorization {
  if (payload.kind === "link_revoked") {
    return eventType === FEDERATION_EVENT_TYPES.linkRevoked &&
      payload.linkVersion >= link.version ? "authorized" : "denied";
  }
  if (eventType !== (payload.kind === "resources_published"
    ? FEDERATION_EVENT_TYPES.resourcesPublished
    : FEDERATION_EVENT_TYPES.grantsRevoked)) return "denied";
  for (const expected of payload.grants) {
    if (!link.allowedResourceTypes.includes(expected.resourceType)) return "denied";
    const actual = grants.find((grant) => grant.id === expected.grantId);
    if (!actual || !grantMatches(actual, expected)) return "denied";
    if (payload.kind === "resources_published" && actual.status === "revoked") return "revoked";
    if (payload.kind === "resources_published" && actual.status !== "active") return "denied";
    if (payload.kind === "grants_revoked" && actual.status !== "revoked") return "denied";
  }
  return "authorized";
}

async function forceTerminalDelivery(
  context: FederationOperationsContext,
  guildId: string,
  deliveryId: string,
  direction: "inbound" | "outbound",
  errorCode: string,
  event: ChronicleEvent,
): Promise<void> {
  const result = await context.connection.query(
    `UPDATE federation_deliveries
        SET status = 'rejected', completed_at = now(),
            last_error = $4
      WHERE guild_id = $1 AND id = $2 AND direction = $3 AND status = 'processing'
      RETURNING id`,
    [guildId, deliveryId, direction, `Federation delivery rejected (${errorCode}).`],
  );
  if (!result.rows[0]) throw new FederationLeaseLostError();
  await context.chronicle.appendChronicle(event);
}

export function createGuildOperationsFederationAccess(
  env: GuildEnv,
  systemActorId: string,
): FederationOperationsAccess {
  return {
    transact: <T>(operation: (context: FederationOperationsContext) => Promise<T>) =>
      withGuildTransaction(env.HYPERDRIVE.connectionString, env.GUILD_ID, async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [systemActorId]);
        return operation({
          connection,
          operations: new GuildOperationsRepository(connection, env.GUILD_ID),
          chronicle: new GuildPostgresRepository(connection, env.GUILD_ID),
        });
      }),
  };
}

export interface FederationPurchaserSecretStore {
  get(secretReference: string): Promise<string | null | undefined>;
}

/** Resolves only explicitly supported purchaser-owned bindings; it never indexes env dynamically. */
export function createGuildEnvFederationSecretResolver(
  env: GuildEnv,
  additionalStore?: FederationPurchaserSecretStore,
): FederationSecretResolver {
  return async (reference) => {
    if (reference === "GUILD_WEBHOOK_SIGNING_SECRET") return env.GUILD_WEBHOOK_SIGNING_SECRET;
    if (/^FEDERATION_SECRET_[A-Z0-9_]{1,109}$/.test(reference)) {
      const value = (env as unknown as Readonly<Record<string, unknown>>)[reference];
      if (typeof value === "string" && value.length >= 32) return value;
    }
    return additionalStore?.get(reference) ?? null;
  };
}

class OperationsFederationTransportRepository implements FederationTransportRepository {
  readonly #dependencies: FederationRuntimeDependencies;
  readonly #now: () => Date;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #maxAttempts: number;
  readonly #outboundLease: FederationOutboundLease | null;
  #inboundLease: FederationInboundLease | null = null;
  #pendingInbound: FederationEnvelope | null = null;
  #settlement: RuntimeSettlement | null = null;

  constructor(
    dependencies: FederationRuntimeDependencies,
    options: {
      readonly now: () => Date;
      readonly workerId: string;
      readonly leaseDurationMs: number;
      readonly maxAttempts: number;
      readonly outboundLease?: FederationOutboundLease | null;
    },
  ) {
    this.#dependencies = dependencies;
    this.#now = options.now;
    this.#workerId = options.workerId;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#maxAttempts = options.maxAttempts;
    this.#outboundLease = options.outboundLease ?? null;
  }

  get settlement(): RuntimeSettlement | null {
    return this.#settlement;
  }

  async getLink(linkId: string): Promise<FederationTransportLink | null> {
    return this.#dependencies.operations.transact(async ({ operations }) => {
      try {
        return toTransportLink(await operations.getFederationLink(linkId));
      } catch (error: unknown) {
        if (error instanceof Error && /not found in this Guild/i.test(error.message)) return null;
        throw error;
      }
    });
  }

  async authorizeOutboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    return this.#dependencies.operations.transact(async ({ operations }) => {
      const link = await operations.getFederationLink(input.link.id);
      if (link.guildId !== input.link.guildId || link.remoteGuildId !== input.link.remoteGuildId ||
          (link.status !== "active" && !(
            link.status === "revoked" && input.eventType === FEDERATION_EVENT_TYPES.linkRevoked
          )) ||
          (link.direction !== "outbound" && link.direction !== "bidirectional")) return "denied";
      const grants = input.payload.kind === "link_revoked"
        ? []
        : await operations.listFederationGrants(link.id, true, 500);
      return authorizeOutboundAgainstOperations(link, grants, input.eventType, input.payload);
    });
  }

  async authorizeInboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    return this.#dependencies.operations.transact(async (context) => {
      const link = await context.operations.getFederationLink(input.link.id);
      if ((link.status !== "active" && !(
            link.status === "revoked" && input.eventType === FEDERATION_EVENT_TYPES.linkRevoked
          )) ||
          (link.direction !== "inbound" && link.direction !== "bidirectional") ||
          (input.payload.kind !== "link_revoked" &&
            input.payload.grants.some((grant) =>
              !link.allowedResourceTypes.includes(grant.resourceType)))) return "denied";
      return this.#dependencies.sharedData.authorizeInbound({
        connection: context.connection,
        link,
        eventType: input.eventType,
        payload: input.payload,
      });
    });
  }

  async reserveInboundDelivery(input: {
    readonly envelope: FederationEnvelope;
    readonly envelopeHash: string;
  }): Promise<FederationInboundReservation> {
    const claim = await this.#dependencies.operations.transact((context) =>
      this.#dependencies.leases.claimInbound({
        connection: context.connection,
        guildId: this.#dependencies.guildId,
        systemActorId: this.#dependencies.systemActorId,
        workerId: this.#workerId,
        now: this.#now().toISOString(),
        leaseDurationMs: this.#leaseDurationMs,
        maxAttempts: this.#maxAttempts,
        envelope: input.envelope,
        envelopeFingerprint: input.envelopeHash,
        receivedChronicleEvent: receivedChronicle(
          this.#dependencies.guildId,
          this.#dependencies.systemActorId,
          input.envelope,
          this.#now().toISOString(),
        ),
      }));
    if (claim.state === "accepted") {
      if (claim.lease === null) throw new Error("Inbound Federation claim omitted its lease.");
      this.#inboundLease = claim.lease;
    }
    return { state: claim.state };
  }

  async applyInboundDelivery(input: { readonly envelope: FederationEnvelope }): Promise<void> {
    if (this.#inboundLease === null || this.#inboundLease.deliveryId !== input.envelope.deliveryId) {
      throw new FederationLeaseLostError();
    }
    // The actual write is deferred so shared projection, delivery state, lease CAS, and Chronicle
    // commit in one PostgreSQL transaction inside finishDelivery.
    this.#pendingInbound = input.envelope;
  }

  async finishDelivery(input: FederationDeliveryCompletion): Promise<void> {
    if (input.direction === "outbound") {
      await this.#finishOutbound(input);
      return;
    }
    await this.#finishInbound(input);
  }

  async retryDelivery(input: FederationDeliveryRetry): Promise<void> {
    const lease = input.direction === "outbound" ? this.#outboundLease : this.#inboundLease;
    if (lease === null || lease.deliveryId !== input.deliveryId) throw new FederationLeaseLostError();
    const terminal = lease.attempt >= lease.maxAttempts;
    await this.#dependencies.operations.transact(async (context) => {
      const owned = await this.#dependencies.leases.settle({
        connection: context.connection,
        lease,
        now: input.occurredAt,
        outcome: terminal ? "terminal" : "retry",
      });
      if (!owned) throw new FederationLeaseLostError();
      if (terminal) {
        await forceTerminalDelivery(
          context,
          this.#dependencies.guildId,
          input.deliveryId,
          input.direction,
          input.errorCode,
          safeChronicleEvent(
            this.#dependencies.guildId,
            this.#dependencies.systemActorId,
            "federation.delivery.rejected",
            input.deliveryId,
            input.occurredAt,
            {
              direction: input.direction,
              eventType: input.eventType,
              errorCode: input.errorCode,
              reason: "attempt_limit",
              source: "federation-runtime",
            },
          ),
        );
        return;
      }
      const finishInput: FinishFederationDeliveryInput = {
        id: input.deliveryId,
        succeeded: false,
        errorMessage: `Federation delivery failed (${input.errorCode}).`,
        retryAt: input.retryAt,
        actorId: this.#dependencies.systemActorId,
        chronicleEvent: retryChronicle(
          this.#dependencies.guildId,
          this.#dependencies.systemActorId,
          input,
        ),
      };
      await context.operations.finishFederationDelivery(finishInput);
    });
    this.#settlement = terminal
      ? { kind: "terminal", errorCode: input.errorCode }
      : { kind: "retry", errorCode: input.errorCode };
  }

  async #finishOutbound(input: FederationDeliveryCompletion): Promise<void> {
    const lease = this.#outboundLease;
    if (lease === null || lease.deliveryId !== input.deliveryId) throw new FederationLeaseLostError();
    const terminal = input.outcome === "rejected";
    await this.#dependencies.operations.transact(async (context) => {
      const owned = await this.#dependencies.leases.settle({
        connection: context.connection,
        lease,
        now: input.occurredAt,
        outcome: terminal ? "terminal" : "completed",
      });
      if (!owned) throw new FederationLeaseLostError();
      if (terminal) {
        await forceTerminalDelivery(
          context,
          this.#dependencies.guildId,
          input.deliveryId,
          "outbound",
          input.errorCode ?? "remote_rejected",
          completionChronicle(
            this.#dependencies.guildId,
            this.#dependencies.systemActorId,
            input,
          ),
        );
        return;
      }
      await context.operations.finishFederationDelivery({
        id: input.deliveryId,
        succeeded: true,
        errorMessage: null,
        actorId: this.#dependencies.systemActorId,
        chronicleEvent: completionChronicle(
          this.#dependencies.guildId,
          this.#dependencies.systemActorId,
          input,
        ),
      });
    });
    this.#settlement = terminal
      ? { kind: "terminal", errorCode: input.errorCode ?? "remote_rejected" }
      : { kind: "completed", errorCode: null };
  }

  async #finishInbound(input: FederationDeliveryCompletion): Promise<void> {
    if (input.outcome === "duplicate") {
      await this.#dependencies.operations.transact(({ chronicle }) =>
        chronicle.appendChronicle(completionChronicle(
          this.#dependencies.guildId,
          this.#dependencies.systemActorId,
          input,
        )));
      return;
    }
    const lease = this.#inboundLease;
    const envelope = this.#pendingInbound;
    if (lease === null || envelope === null || lease.deliveryId !== input.deliveryId ||
        envelope.deliveryId !== input.deliveryId) throw new FederationLeaseLostError();
    await this.#dependencies.operations.transact(async (context) => {
      const owned = await this.#dependencies.leases.settle({
        connection: context.connection,
        lease,
        now: input.occurredAt,
        outcome: input.outcome === "rejected" ? "terminal" : "completed",
      });
      if (!owned) throw new FederationLeaseLostError();
      if (input.outcome === "rejected") {
        await forceTerminalDelivery(
          context,
          this.#dependencies.guildId,
          input.deliveryId,
          "inbound",
          input.errorCode ?? "remote_rejected",
          completionChronicle(
            this.#dependencies.guildId,
            this.#dependencies.systemActorId,
            input,
          ),
        );
        return;
      }
      await this.#dependencies.sharedData.applyInbound({
        connection: context.connection,
        envelope,
      });
      await context.operations.finishFederationDelivery({
        id: input.deliveryId,
        succeeded: true,
        errorMessage: null,
        actorId: this.#dependencies.systemActorId,
        chronicleEvent: completionChronicle(
          this.#dependencies.guildId,
          this.#dependencies.systemActorId,
          input,
        ),
      });
    });
  }
}

function errorStatus(error: FederationTransportError): number {
  switch (error.code) {
    case "request_too_large":
      return 413;
    case "replay_conflict":
      return 409;
    case "signature_invalid":
      return 401;
    case "request_stale":
      return 408;
    case "delivery_in_progress":
    case "secret_unavailable":
    case "repository_error":
    case "network_error":
    case "remote_unavailable":
    case "request_timeout":
      return 503;
    case "link_not_found":
    case "link_inactive":
    case "direction_not_allowed":
    case "target_mismatch":
    case "source_mismatch":
    case "grant_not_authorized":
    case "grant_revoked":
      return 403;
    default:
      return 400;
  }
}

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readBoundedRequest(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new FederationTransportError("request_too_large");
  }
  if (!request.body) throw new FederationTransportError("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new FederationTransportError("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new FederationTransportError("invalid_request");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function peekEventType(rawBody: Uint8Array): FederationEventType | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = (parsed as Readonly<Record<string, unknown>>).eventType;
    return isEventType(value) ? value : null;
  } catch {
    return null;
  }
}

export class GuildFederationRuntime {
  readonly #dependencies: FederationRuntimeDependencies;
  readonly #options: Required<Pick<FederationRuntimeOptions,
    "workerId" | "leaseDurationMs" | "maxAttempts" | "maxRequestBytes">> &
    Omit<FederationRuntimeOptions, "workerId" | "leaseDurationMs" | "maxAttempts" | "maxRequestBytes"> & {
      readonly now: () => Date;
    };

  constructor(
    dependencies: FederationRuntimeDependencies,
    options: FederationRuntimeOptions,
  ) {
    assertDependencies(dependencies, options);
    const leaseDurationMs = normalizeInteger(options.leaseDurationMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
    const maxAttempts = normalizeInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS);
    const maxRequestBytes = normalizeInteger(
      options.maxRequestBytes,
      DEFAULT_REQUEST_BYTES,
      MAX_REQUEST_BYTES,
    );
    const effectiveTransportTimeout = options.transportTimeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    if (leaseDurationMs <= effectiveTransportTimeout + 5_000) {
      throw new Error("Federation lease must outlive the transport timeout by at least five seconds.");
    }
    this.#dependencies = dependencies;
    this.#options = {
      ...options,
      leaseDurationMs,
      maxAttempts,
      maxRequestBytes,
      now: options.now ?? (() => new Date()),
    };
  }

  async runMaintenanceOnce(): Promise<FederationMaintenanceOutcome> {
    const now = this.#options.now();
    const claim = await this.#dependencies.operations.transact((context) =>
      this.#dependencies.leases.claimOutbound({
        connection: context.connection,
        guildId: this.#dependencies.guildId,
        systemActorId: this.#dependencies.systemActorId,
        workerId: this.#options.workerId,
        now: now.toISOString(),
        leaseDurationMs: this.#options.leaseDurationMs,
        maxAttempts: this.#options.maxAttempts,
      }));
    if (claim.state === "idle") return { status: "idle" };
    if (claim.state === "terminal") {
      return {
        status: "terminal_failure",
        deliveryId: claim.deliveryId,
        errorCode: claim.errorCode,
      };
    }
    const lease = claim.lease;
    assertLease(lease, this.#dependencies.guildId);
    const repository = new OperationsFederationTransportRepository(this.#dependencies, {
      now: this.#options.now,
      workerId: this.#options.workerId,
      leaseDurationMs: this.#options.leaseDurationMs,
      maxAttempts: this.#options.maxAttempts,
      outboundLease: lease,
    });
    try {
      const result = await deliverFederationDelivery(lease.delivery, {
        repository,
        resolveSecret: this.#dependencies.resolveSecret,
        fetch: this.#dependencies.fetch,
        now: this.#options.now,
        maxRequestBytes: this.#options.maxRequestBytes,
        ...(this.#options.transportTimeoutMs === undefined
          ? {} : { timeoutMs: this.#options.transportTimeoutMs }),
        ...(this.#options.maxResponseBytes === undefined
          ? {} : { maxResponseBytes: this.#options.maxResponseBytes }),
        ...(this.#options.freshnessMs === undefined
          ? {} : { freshnessMs: this.#options.freshnessMs }),
      });
      return {
        status: "sent",
        deliveryId: lease.deliveryId,
        remoteStatus: result.status,
      };
    } catch (error: unknown) {
      const settlement = repository.settlement;
      if (settlement?.kind === "retry") {
        return {
          status: "retry_scheduled",
          deliveryId: lease.deliveryId,
          errorCode: settlement.errorCode,
        };
      }
      if (settlement?.kind === "terminal") {
        return {
          status: "terminal_failure",
          deliveryId: lease.deliveryId,
          errorCode: settlement.errorCode,
        };
      }
      if (error instanceof FederationLeaseLostError) {
        return { status: "lease_lost", deliveryId: lease.deliveryId };
      }
      throw error;
    }
  }

  async handleRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== DELIVERY_PATH && path !== REVOCATION_PATH) {
      return jsonResponse({ ok: false, code: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, code: "method_not_allowed" }), {
        status: 405,
        headers: { ...JSON_HEADERS, allow: "POST" },
      });
    }
    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      return jsonResponse({ ok: false, code: "unsupported_media_type" }, 415);
    }
    try {
      const rawBody = await readBoundedRequest(request, this.#options.maxRequestBytes);
      const eventType = peekEventType(rawBody);
      if (eventType === null || (path === REVOCATION_PATH &&
          eventType !== FEDERATION_EVENT_TYPES.grantsRevoked &&
          eventType !== FEDERATION_EVENT_TYPES.linkRevoked)) {
        throw new FederationTransportError("invalid_request");
      }
      const repository = new OperationsFederationTransportRepository(this.#dependencies, {
        now: this.#options.now,
        workerId: this.#options.workerId,
        leaseDurationMs: this.#options.leaseDurationMs,
        maxAttempts: this.#options.maxAttempts,
      });
      const acknowledgement = await receiveFederationDelivery({
        rawBody,
        signature: request.headers.get("x-guild-federation-signature"),
      }, {
        localGuildId: this.#dependencies.guildId,
        repository,
        resolveSecret: this.#dependencies.resolveSecret,
        now: this.#options.now,
        maxRequestBytes: this.#options.maxRequestBytes,
        ...(this.#options.freshnessMs === undefined
          ? {} : { freshnessMs: this.#options.freshnessMs }),
      });
      return jsonResponse(acknowledgement, acknowledgement.status === "accepted" ? 202 : 200);
    } catch (error: unknown) {
      const safe = error instanceof FederationTransportError
        ? error
        : new FederationTransportError("repository_error", true);
      return jsonResponse({ ok: false, code: safe.code }, errorStatus(safe));
    }
  }
}
