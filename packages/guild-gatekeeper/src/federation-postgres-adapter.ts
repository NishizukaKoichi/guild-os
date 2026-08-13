import type { JsonObject } from "@guild-os/domain";
import {
  FederationPersistenceError,
  GuildFederationRepository,
  withGuildTransaction,
  type PersistedFederationEventType,
  type PersistedFederationLease,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import {
  GuildFederationRuntime,
  createGuildEnvFederationSecretResolver,
  createGuildOperationsFederationAccess,
  type FederationDurableLeasePort,
  type FederationInboundLeaseClaim,
  type FederationLeaseCoordinates,
  type FederationLeaseSettlementInput,
  type FederationOutboundLeaseClaim,
  type FederationPurchaserSecretStore,
  type FederationRuntimeDependencies,
  type FederationRuntimeOptions,
  type FederationSharedDataPort,
} from "./federation-runtime.js";
import type {
  FederationEnvelope,
  FederationEventType,
  FederationExplicitPayload,
  FederationFetch,
  FederationGrantAuthorization,
  FederationOutboundDelivery,
} from "./federation-transport.js";

function payloadAsJson(payload: FederationExplicitPayload): JsonObject {
  return JSON.parse(JSON.stringify(payload)) as JsonObject;
}

function persistedLease(lease: FederationLeaseCoordinates): PersistedFederationLease {
  return {
    direction: lease.direction,
    deliveryId: lease.deliveryId,
    leaseToken: lease.leaseToken,
    leaseOwner: lease.leaseOwner,
    leaseExpiresAt: lease.leaseExpiresAt,
    attempt: lease.attempt,
    maxAttempts: lease.maxAttempts,
  };
}

function transportDelivery(input: {
  readonly id: string;
  readonly guildId: string;
  readonly federationLinkId: string;
  readonly eventType: PersistedFederationEventType;
  readonly payload: JsonObject;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
}): FederationOutboundDelivery {
  return {
    id: input.id,
    guildId: input.guildId,
    federationLinkId: input.federationLinkId,
    eventType: input.eventType,
    payload: input.payload as unknown as FederationExplicitPayload,
    payloadHash: input.payloadHash,
    idempotencyKey: input.idempotencyKey,
    attemptCount: input.attemptCount,
  };
}

/** Concrete PostgreSQL implementation of the runtime ports introduced by migration 0040. */
export class PostgresFederationRuntimeAdapter
implements FederationDurableLeasePort, FederationSharedDataPort {
  readonly #guildId: string;

  constructor(guildId: string) {
    this.#guildId = guildId;
  }

  async claimOutbound(
    input: Parameters<FederationDurableLeasePort["claimOutbound"]>[0],
  ): Promise<FederationOutboundLeaseClaim> {
    const claim = await new GuildFederationRepository(
      input.connection,
      input.guildId,
    ).claimOutboundDelivery({
      workerId: input.workerId,
      systemActorId: input.systemActorId,
      now: input.now,
      leaseDurationMs: input.leaseDurationMs,
      maxAttempts: input.maxAttempts,
    });
    if (claim.state !== "leased") return claim;
    return {
      state: "leased",
      lease: {
        ...claim.lease,
        delivery: transportDelivery(claim.delivery),
      },
    };
  }

  async claimInbound(
    input: Parameters<FederationDurableLeasePort["claimInbound"]>[0],
  ): Promise<FederationInboundLeaseClaim> {
    const claim = await new GuildFederationRepository(
      input.connection,
      input.guildId,
    ).claimInboundDelivery({
      workerId: input.workerId,
      systemActorId: input.systemActorId,
      now: input.now,
      leaseDurationMs: input.leaseDurationMs,
      maxAttempts: input.maxAttempts,
      deliveryId: input.envelope.deliveryId,
      federationLinkId: input.envelope.linkId,
      eventType: input.envelope.eventType,
      payload: payloadAsJson(input.envelope.payload),
      payloadHash: input.envelope.payloadHash,
      idempotencyKey: input.envelope.idempotencyKey,
      envelopeFingerprint: input.envelopeFingerprint,
      receivedChronicleEvent: input.receivedChronicleEvent,
    });
    return claim;
  }

  settle(input: FederationLeaseSettlementInput): Promise<boolean> {
    return new GuildFederationRepository(
      input.connection,
      this.#guildId,
    ).settleDeliveryLease({ lease: persistedLease(input.lease), now: input.now });
  }

  async authorizeInbound(input: {
    readonly connection: Parameters<FederationSharedDataPort["authorizeInbound"]>[0]["connection"];
    readonly link: Parameters<FederationSharedDataPort["authorizeInbound"]>[0]["link"];
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    try {
      return await new GuildFederationRepository(
        input.connection,
        input.link.guildId,
      ).authorizeInboundPayload({
        federationLinkId: input.link.id,
        eventType: input.eventType,
        payload: payloadAsJson(input.payload),
      });
    } catch (error: unknown) {
      if (error instanceof FederationPersistenceError) {
        return error.code === "grant_revoked" || error.code === "link_inactive"
          ? "revoked"
          : "denied";
      }
      throw error;
    }
  }

  applyInbound(input: {
    readonly connection: Parameters<FederationSharedDataPort["applyInbound"]>[0]["connection"];
    readonly envelope: FederationEnvelope;
  }): Promise<void> {
    return new GuildFederationRepository(
      input.connection,
      input.envelope.targetGuildId,
    ).applyInboundEnvelope({
      sourceGuildId: input.envelope.sourceGuildId,
      targetGuildId: input.envelope.targetGuildId,
      federationLinkId: input.envelope.linkId,
      deliveryId: input.envelope.deliveryId,
      eventType: input.envelope.eventType,
      payload: payloadAsJson(input.envelope.payload),
    });
  }

}

export interface CreatePostgresFederationRuntimeInput {
  readonly env: GuildEnv;
  readonly systemActorId: string;
  readonly workerId: string;
  readonly fetch?: FederationFetch;
  readonly purchaserSecrets?: FederationPurchaserSecretStore;
  readonly options?: Omit<FederationRuntimeOptions, "workerId">;
}

export async function resolveFederationRuntimeActor(env: GuildEnv): Promise<string> {
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    async (connection) => {
      const result = await connection.query<{ actor_id: string }>(
        `SELECT profile.actor_id::text
           FROM service_profiles profile
           JOIN identities identity_row
             ON identity_row.guild_id = profile.guild_id
            AND identity_row.id = profile.actor_id
           JOIN memberships membership
             ON membership.guild_id = profile.guild_id
            AND membership.identity_id = profile.actor_id
          WHERE profile.guild_id = $1
            AND profile.service_type = 'federation-runtime'
            AND identity_row.kind = 'service' AND identity_row.status = 'active'
            AND membership.state = 'active'
          ORDER BY profile.actor_id
          LIMIT 1`,
        [env.GUILD_ID],
      );
      const actorId = result.rows[0]?.actor_id;
      if (!actorId) {
        throw new Error("The Guild Federation runtime Service is unavailable.");
      }
      return actorId;
    },
  );
}

/** Creates the complete purchaser-owned PostgreSQL + signed HTTP Federation runtime. */
export function createPostgresFederationRuntime(
  input: CreatePostgresFederationRuntimeInput,
): GuildFederationRuntime {
  const adapter = new PostgresFederationRuntimeAdapter(input.env.GUILD_ID);
  const dependencies: FederationRuntimeDependencies = {
    guildId: input.env.GUILD_ID,
    systemActorId: input.systemActorId,
    operations: createGuildOperationsFederationAccess(input.env, input.systemActorId),
    leases: adapter,
    sharedData: adapter,
    resolveSecret: createGuildEnvFederationSecretResolver(input.env, input.purchaserSecrets),
    fetch: input.fetch ?? ((request, init) => globalThis.fetch(request, init)),
  };
  return new GuildFederationRuntime(dependencies, {
    ...input.options,
    workerId: input.workerId,
  });
}

/** Cron/maintenance entry helper. It sends at most one durably leased delivery. */
export function runFederationOutboundMaintenance(runtime: GuildFederationRuntime) {
  return runtime.runMaintenanceOnce();
}

/** Fetch route helper for `/api/federation/v1/deliveries` and `/revocations`. */
export function handleFederationInboundRequest(
  runtime: GuildFederationRuntime,
  request: Request,
): Promise<Response> {
  return runtime.handleRequest(request);
}

export async function drainGuildFederationOutbound(env: GuildEnv) {
  const systemActorId = await resolveFederationRuntimeActor(env);
  const runtime = createPostgresFederationRuntime({
    env,
    systemActorId,
    workerId: `guild-federation-outbound:${crypto.randomUUID()}`,
  });
  return runFederationOutboundMaintenance(runtime);
}

export async function handleGuildFederationInbound(
  request: Request,
  env: GuildEnv,
): Promise<Response> {
  const systemActorId = await resolveFederationRuntimeActor(env);
  const runtime = createPostgresFederationRuntime({
    env,
    systemActorId,
    workerId: `guild-federation-inbound:${crypto.randomUUID()}`,
  });
  return handleFederationInboundRequest(runtime, request);
}
