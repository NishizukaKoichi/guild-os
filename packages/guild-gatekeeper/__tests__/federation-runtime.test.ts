import { describe, expect, it, vi } from "vitest";
import type {
  ChronicleEvent,
  FederationGrant,
  FederationLink,
} from "@guild-os/domain";
import type {
  FederationDelivery,
  FinishFederationDeliveryInput,
  GuildTransactionConnection,
  IdempotentResult,
  RecordInboundFederationDeliveryInput,
} from "@guild-os/postgres";
import {
  GuildFederationRuntime,
  type FederationDurableLeasePort,
  type FederationInboundLeaseClaim,
  type FederationLeaseSettlementInput,
  type FederationOperationsAccess,
  type FederationOperationsContext,
  type FederationOutboundLease,
  type FederationOutboundLeaseClaim,
  type FederationRuntimeDependencies,
  type FederationSharedDataPort,
} from "../src/federation-runtime.js";
import {
  FEDERATION_EVENT_TYPES,
  hashFederationPayload,
  type FederationEnvelope,
  type FederationEventType,
  type FederationExplicitPayload,
  type FederationGrantAuthorization,
  type FederationOutboundDelivery,
} from "../src/federation-transport.js";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const SECRET = "purchaser-owned-federation-secret-0123456789abcdef";
const CONTENT_SENTINEL = "PRIVATE-CANONICAL-CONTENT-MUST-NOT-BE-LOGGED";
const IDS = {
  sourceGuild: "10000000-0000-4000-8000-000000000001",
  targetGuild: "20000000-0000-4000-8000-000000000002",
  sourceActor: "30000000-0000-4000-8000-000000000003",
  targetActor: "40000000-0000-4000-8000-000000000004",
  link: "50000000-0000-4000-8000-000000000005",
  delivery: "60000000-0000-4000-8000-000000000006",
  delivery2: "70000000-0000-4000-8000-000000000007",
  grant: "80000000-0000-4000-8000-000000000008",
  memory: "90000000-0000-4000-8000-000000000009",
};

function link(
  side: "source" | "target",
  path = "/api/federation/v1/deliveries",
): FederationLink {
  const source = side === "source";
  return {
    id: IDS.link,
    guildId: source ? IDS.sourceGuild : IDS.targetGuild,
    remoteGuildId: source ? IDS.targetGuild : IDS.sourceGuild,
    remoteName: source ? "Target Guild" : "Source Guild",
    endpointUrl: `https://${source ? "target" : "source"}.guild.example.test${path}`,
    secretReference: "PURCHASER_FEDERATION_SECRET",
    direction: source ? "outbound" : "inbound",
    status: "active",
    allowedResourceTypes: ["memory"],
    createdByActorId: source ? IDS.sourceActor : IDS.targetActor,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function grant(status: "active" | "revoked" = "active"): FederationGrant {
  return {
    id: IDS.grant,
    guildId: IDS.sourceGuild,
    federationLinkId: IDS.link,
    resourceType: "memory",
    resourceId: IDS.memory,
    permission: "read",
    status,
    grantedByActorId: IDS.sourceActor,
    revokedByActorId: status === "revoked" ? IDS.sourceActor : null,
    revokedAt: status === "revoked" ? NOW.toISOString() : null,
    version: status === "revoked" ? 2 : 1,
    createdAt: NOW.toISOString(),
  };
}

function publishedPayload(): FederationExplicitPayload {
  return {
    kind: "resources_published",
    grants: [{
      grantId: IDS.grant,
      resourceType: "memory",
      resourceId: IDS.memory,
      permission: "read",
      grantVersion: 1,
      resourceVersion: 4,
      resource: {
        title: "Approved remote policy",
        body: CONTENT_SENTINEL,
      },
    }],
  };
}

function grantRevocationPayload(): FederationExplicitPayload {
  return {
    kind: "grants_revoked",
    grants: [{
      grantId: IDS.grant,
      resourceType: "memory",
      resourceId: IDS.memory,
      permission: "read",
      grantVersion: 2,
      revokedAt: NOW.toISOString(),
    }],
  };
}

function eventType(payload: FederationExplicitPayload): FederationEventType {
  if (payload.kind === "resources_published") return FEDERATION_EVENT_TYPES.resourcesPublished;
  if (payload.kind === "grants_revoked") return FEDERATION_EVENT_TYPES.grantsRevoked;
  return FEDERATION_EVENT_TYPES.linkRevoked;
}

async function transportDelivery(
  payload: FederationExplicitPayload = publishedPayload(),
  overrides: Partial<FederationOutboundDelivery> = {},
): Promise<FederationOutboundDelivery> {
  return {
    id: IDS.delivery,
    guildId: IDS.sourceGuild,
    federationLinkId: IDS.link,
    eventType: eventType(payload),
    payload,
    payloadHash: await hashFederationPayload(payload),
    idempotencyKey: "federation:runtime:delivery:1",
    attemptCount: 1,
    ...overrides,
  };
}

function databaseDelivery(
  delivery: FederationOutboundDelivery,
  direction: "inbound" | "outbound",
  status: FederationDelivery["status"],
): FederationDelivery {
  return {
    id: delivery.id,
    guildId: direction === "outbound" ? IDS.sourceGuild : IDS.targetGuild,
    federationLinkId: delivery.federationLinkId,
    direction,
    eventType: delivery.eventType,
    payload: JSON.parse(JSON.stringify(delivery.payload)) as FederationDelivery["payload"],
    payloadHash: delivery.payloadHash,
    idempotencyKey: delivery.idempotencyKey,
    status,
    attemptCount: delivery.attemptCount,
    availableAt: NOW.toISOString(),
    completedAt: null,
    lastError: null,
    createdAt: NOW.toISOString(),
  };
}

class FakeOperations {
  currentLink: FederationLink;
  currentGrants: FederationGrant[];
  readonly deliveries = new Map<string, FederationDelivery>();
  readonly idempotency = new Map<string, string>();
  readonly finishInputs: FinishFederationDeliveryInput[] = [];
  readonly finishConnections: GuildTransactionConnection[] = [];
  readonly events: ChronicleEvent[];
  readonly currentConnection: () => GuildTransactionConnection | null;

  constructor(
    currentLink: FederationLink,
    currentGrants: FederationGrant[],
    events: ChronicleEvent[],
    currentConnection: () => GuildTransactionConnection | null,
  ) {
    this.currentLink = currentLink;
    this.currentGrants = currentGrants;
    this.events = events;
    this.currentConnection = currentConnection;
  }

  async getFederationLink(id: string): Promise<FederationLink> {
    if (id !== this.currentLink.id) throw new Error("Federation link was not found in this Guild.");
    return this.currentLink;
  }

  async listFederationGrants(): Promise<FederationGrant[]> {
    return [...this.currentGrants];
  }

  async recordInboundFederationDelivery(
    input: RecordInboundFederationDeliveryInput,
  ): Promise<IdempotentResult<FederationDelivery>> {
    const payloadHash = await hashFederationPayload(
      input.payload as unknown as FederationExplicitPayload,
    );
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.deliveries.get(existingId);
      if (!existing) throw new Error("Federation delivery idempotency conflict could not be resolved.");
      if (existing.federationLinkId !== input.federationLinkId ||
          existing.eventType !== input.eventType || existing.payloadHash !== payloadHash) {
        throw new Error("Federation delivery idempotency key was reused with different input.");
      }
      return { value: existing, created: false };
    }
    const value: FederationDelivery = {
      id: input.id,
      guildId: this.currentLink.guildId,
      federationLinkId: input.federationLinkId,
      direction: "inbound",
      eventType: input.eventType,
      payload: input.payload,
      payloadHash,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      attemptCount: 0,
      availableAt: NOW.toISOString(),
      completedAt: null,
      lastError: null,
      createdAt: NOW.toISOString(),
    };
    this.deliveries.set(value.id, value);
    this.idempotency.set(value.idempotencyKey, value.id);
    this.events.push(input.chronicleEvent);
    return { value, created: true };
  }

  async finishFederationDelivery(
    input: FinishFederationDeliveryInput,
  ): Promise<FederationDelivery> {
    const connection = this.currentConnection();
    if (connection === null) throw new Error("Expected an active transaction.");
    this.finishConnections.push(connection);
    this.finishInputs.push(input);
    const current = this.deliveries.get(input.id);
    if (!current || current.status !== "processing") {
      throw new Error("Federation delivery is not processing in this Guild.");
    }
    const value: FederationDelivery = {
      ...current,
      status: input.succeeded ? "completed" : "failed",
      completedAt: input.succeeded ? NOW.toISOString() : null,
      lastError: input.errorMessage,
      availableAt: input.retryAt ?? current.availableAt,
    };
    this.deliveries.set(value.id, value);
    this.events.push(input.chronicleEvent);
    return value;
  }

  markProcessing(deliveryId: string, attempt: number): void {
    const current = this.deliveries.get(deliveryId);
    if (!current) throw new Error("Delivery is missing.");
    this.deliveries.set(deliveryId, { ...current, status: "processing", attemptCount: attempt });
  }

  markRejected(deliveryId: string): boolean {
    const current = this.deliveries.get(deliveryId);
    if (!current || current.status !== "processing") return false;
    this.deliveries.set(deliveryId, {
      ...current,
      status: "rejected",
      completedAt: NOW.toISOString(),
    });
    return true;
  }
}

class FakeOperationsAccess implements FederationOperationsAccess {
  readonly events: ChronicleEvent[] = [];
  readonly operations: FakeOperations;
  transactionCount = 0;
  #activeConnection: GuildTransactionConnection | null = null;

  constructor(currentLink: FederationLink, currentGrants: FederationGrant[]) {
    this.operations = new FakeOperations(
      currentLink,
      currentGrants,
      this.events,
      () => this.#activeConnection,
    );
  }

  async transact<T>(
    operation: (context: FederationOperationsContext) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    const rawConnection = {
      query: async (text: string, values?: readonly unknown[]) => {
        if (/UPDATE federation_deliveries/.test(text)) {
          const deliveryId = typeof values?.[1] === "string" ? values[1] : "";
          return { rows: this.operations.markRejected(deliveryId) ? [{ id: deliveryId }] : [] };
        }
        return { rows: [] };
      },
    };
    const connection = rawConnection as unknown as GuildTransactionConnection;
    this.#activeConnection = connection;
    try {
      return await operation({
        connection,
        operations: this.operations as unknown as FederationOperationsContext["operations"],
        chronicle: {
          appendChronicle: async (event) => {
            this.events.push(event);
          },
        },
      });
    } finally {
      this.#activeConnection = null;
    }
  }
}

class FakeLeasePort implements FederationDurableLeasePort {
  outbound: FederationOutboundLease | null;
  settleAllowed = true;
  readonly settlements: FederationLeaseSettlementInput[] = [];
  readonly fingerprints = new Map<string, string>();
  readonly settleConnections: GuildTransactionConnection[] = [];
  readonly operations: FakeOperations;
  readonly owner: string;

  constructor(
    operations: FakeOperations,
    outbound: FederationOutboundLease | null,
    owner: string,
  ) {
    this.operations = operations;
    this.outbound = outbound;
    this.owner = owner;
  }

  async claimOutbound(): Promise<FederationOutboundLeaseClaim> {
    const claim = this.outbound;
    this.outbound = null;
    if (claim !== null) this.operations.markProcessing(claim.deliveryId, claim.attempt);
    return claim === null ? { state: "idle" } : { state: "leased", lease: claim };
  }

  async claimInbound(input: {
    readonly envelope: FederationEnvelope;
    readonly envelopeFingerprint: string;
    readonly receivedChronicleEvent: ChronicleEvent;
  }): Promise<FederationInboundLeaseClaim> {
    const recorded = await this.operations.recordInboundFederationDelivery({
      id: input.envelope.deliveryId,
      federationLinkId: input.envelope.linkId,
      eventType: input.envelope.eventType,
      payload: JSON.parse(JSON.stringify(input.envelope.payload)) as FederationDelivery["payload"],
      idempotencyKey: input.envelope.idempotencyKey,
      actorId: IDS.targetActor,
      chronicleEvent: input.receivedChronicleEvent,
    });
    const existing = this.fingerprints.get(input.envelope.idempotencyKey);
    if (existing !== undefined) {
      return {
        state: existing === input.envelopeFingerprint ? "duplicate" : "conflict",
        lease: null,
      };
    }
    if (!recorded.created) return { state: "conflict", lease: null };
    this.fingerprints.set(input.envelope.idempotencyKey, input.envelopeFingerprint);
    this.operations.markProcessing(input.envelope.deliveryId, 1);
    return {
      state: "accepted",
      lease: {
        direction: "inbound",
        deliveryId: input.envelope.deliveryId,
        leaseToken: `inbound-lease-${input.envelope.deliveryId}`,
        leaseOwner: this.owner,
        leaseExpiresAt: "2026-08-14T00:01:00.000Z",
        attempt: 1,
        maxAttempts: 3,
      },
    };
  }

  async settle(input: FederationLeaseSettlementInput): Promise<boolean> {
    this.settlements.push(input);
    this.settleConnections.push(input.connection);
    return this.settleAllowed;
  }
}

class FakeSharedData implements FederationSharedDataPort {
  readonly applied: FederationEnvelope[] = [];
  readonly revokedGrants = new Set<string>();
  readonly operations: FakeOperations;

  constructor(operations: FakeOperations) {
    this.operations = operations;
  }

  async authorizeInbound(input: {
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    if (input.eventType !== eventType(input.payload)) return "denied";
    if (input.payload.kind === "resources_published" &&
        input.payload.grants.some((entry) => this.revokedGrants.has(entry.grantId))) {
      return "revoked";
    }
    return "authorized";
  }

  async applyInbound(input: { readonly envelope: FederationEnvelope }): Promise<void> {
    this.applied.push(input.envelope);
    if (input.envelope.payload.kind === "grants_revoked") {
      for (const entry of input.envelope.payload.grants) this.revokedGrants.add(entry.grantId);
    }
    if (input.envelope.payload.kind === "link_revoked") {
      this.operations.currentLink = { ...this.operations.currentLink, status: "revoked" };
    }
  }
}

function lease(
  delivery: FederationOutboundDelivery,
  attempt = 1,
  maxAttempts = 3,
): FederationOutboundLease {
  return {
    direction: "outbound",
    deliveryId: delivery.id,
    delivery: { ...delivery, attemptCount: attempt },
    leaseToken: `outbound-lease-${delivery.id}`,
    leaseOwner: "source-worker",
    leaseExpiresAt: "2026-08-14T00:01:00.000Z",
    attempt,
    maxAttempts,
  };
}

function resolver(reference: string): string | null {
  return reference === "PURCHASER_FEDERATION_SECRET" ? SECRET : null;
}

interface RuntimeHarness {
  readonly source: GuildFederationRuntime;
  readonly target: GuildFederationRuntime;
  readonly sourceAccess: FakeOperationsAccess;
  readonly targetAccess: FakeOperationsAccess;
  readonly sourceLeases: FakeLeasePort;
  readonly targetLeases: FakeLeasePort;
  readonly targetShared: FakeSharedData;
}

async function runtimeHarness(input: {
  readonly payload?: FederationExplicitPayload;
  readonly targetPath?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly fetchOverride?: FederationRuntimeDependencies["fetch"];
} = {}): Promise<RuntimeHarness> {
  const payload = input.payload ?? publishedPayload();
  const delivery = await transportDelivery(payload, {
    attemptCount: input.attempt ?? 1,
  });
  const sourceAccess = new FakeOperationsAccess(
    link("source", input.targetPath),
    [grant(payload.kind === "grants_revoked" ? "revoked" : "active")],
  );
  sourceAccess.operations.deliveries.set(
    delivery.id,
    databaseDelivery(delivery, "outbound", "pending"),
  );
  const targetAccess = new FakeOperationsAccess(link("target"), []);
  const sourceLeases = new FakeLeasePort(
    sourceAccess.operations,
    lease(delivery, input.attempt, input.maxAttempts),
    "source-worker",
  );
  const targetLeases = new FakeLeasePort(targetAccess.operations, null, "target-worker");
  const sourceShared = new FakeSharedData(sourceAccess.operations);
  const targetShared = new FakeSharedData(targetAccess.operations);
  const target = new GuildFederationRuntime({
    guildId: IDS.targetGuild,
    systemActorId: IDS.targetActor,
    operations: targetAccess,
    leases: targetLeases,
    sharedData: targetShared,
    resolveSecret: resolver,
    fetch: vi.fn(async () => new Response(null, { status: 500 })),
  }, {
    workerId: "target-worker",
    leaseDurationMs: 60_000,
    maxAttempts: 3,
    now: () => NOW,
  });
  const bridge = input.fetchOverride ?? (async (url, init) =>
    target.handleRequest(new Request(url, init)));
  const source = new GuildFederationRuntime({
    guildId: IDS.sourceGuild,
    systemActorId: IDS.sourceActor,
    operations: sourceAccess,
    leases: sourceLeases,
    sharedData: sourceShared,
    resolveSecret: resolver,
    fetch: bridge,
  }, {
    workerId: "source-worker",
    leaseDurationMs: 60_000,
    maxAttempts: input.maxAttempts ?? 3,
    transportTimeoutMs: 10_000,
    now: () => NOW,
  });
  return {
    source,
    target,
    sourceAccess,
    targetAccess,
    sourceLeases,
    targetLeases,
    targetShared,
  };
}

async function signedRequest(
  payload: FederationExplicitPayload,
  path: string,
  overrides: Partial<FederationEnvelope> = {},
): Promise<Request> {
  const envelope: FederationEnvelope = {
    sourceGuildId: IDS.sourceGuild,
    targetGuildId: IDS.targetGuild,
    linkId: IDS.link,
    deliveryId: IDS.delivery2,
    eventType: eventType(payload),
    payload,
    payloadHash: await hashFederationPayload(payload),
    idempotencyKey: `federation:runtime:${IDS.delivery2}`,
    issuedAt: NOW.toISOString(),
    ...overrides,
  };
  const body = JSON.stringify(envelope);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  ));
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`https://target.guild.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guild-federation-signature": `v1=${hex}`,
    },
    body,
  });
}

describe("GuildFederationRuntime", () => {
  it("claims, signs, sends, stores explicit shared data, and commits both Chronicles", async () => {
    const harness = await runtimeHarness();
    await expect(harness.source.runMaintenanceOnce()).resolves.toEqual({
      status: "sent",
      deliveryId: IDS.delivery,
      remoteStatus: "accepted",
    });

    expect(harness.targetShared.applied).toHaveLength(1);
    expect(harness.targetShared.applied[0]?.payload).toEqual(publishedPayload());
    expect(harness.sourceAccess.operations.deliveries.get(IDS.delivery)?.status).toBe("completed");
    expect(harness.targetAccess.operations.deliveries.get(IDS.delivery)?.status).toBe("completed");
    expect(harness.sourceLeases.settlements.at(-1)?.outcome).toBe("completed");
    expect(harness.targetLeases.settlements.at(-1)?.outcome).toBe("completed");
    expect(harness.sourceLeases.settleConnections.at(-1)).toBe(
      harness.sourceAccess.operations.finishConnections.at(-1),
    );
    expect(harness.targetLeases.settleConnections.at(-1)).toBe(
      harness.targetAccess.operations.finishConnections.at(-1),
    );

    const auditText = JSON.stringify([
      ...harness.sourceAccess.events,
      ...harness.targetAccess.events,
      ...harness.sourceAccess.operations.finishInputs,
      ...harness.targetAccess.operations.finishInputs,
    ]);
    expect(auditText).not.toContain(SECRET);
    expect(auditText).not.toContain(CONTENT_SENTINEL);
    expect(auditText).toContain("federation.delivery.completed");
  });

  it("records a transient response as an atomic retry without leaking its body", async () => {
    const privateRemoteBody = "PRIVATE-REMOTE-ERROR-BODY";
    const harness = await runtimeHarness({
      fetchOverride: vi.fn(async () => new Response(privateRemoteBody, { status: 503 })),
    });
    await expect(harness.source.runMaintenanceOnce()).resolves.toEqual({
      status: "retry_scheduled",
      deliveryId: IDS.delivery,
      errorCode: "remote_unavailable",
    });
    expect(harness.sourceAccess.operations.deliveries.get(IDS.delivery)?.status).toBe("failed");
    expect(harness.sourceLeases.settlements.at(-1)?.outcome).toBe("retry");
    expect(JSON.stringify(harness.sourceAccess.events)).not.toContain(privateRemoteBody);
    expect(JSON.stringify(harness.sourceAccess.events)).not.toContain(SECRET);
  });

  it.each([
    {
      name: "permanent rejection",
      attempt: 1,
      maxAttempts: 3,
      response: () => new Response("private rejection details", { status: 400 }),
      errorCode: "remote_rejected",
    },
    {
      name: "attempt exhaustion",
      attempt: 3,
      maxAttempts: 3,
      response: () => new Response("private outage details", { status: 503 }),
      errorCode: "remote_unavailable",
    },
  ])("commits $name as a terminal DB state plus Chronicle", async (scenario) => {
    const harness = await runtimeHarness({
      attempt: scenario.attempt,
      maxAttempts: scenario.maxAttempts,
      fetchOverride: vi.fn(async () => scenario.response()),
    });
    await expect(harness.source.runMaintenanceOnce()).resolves.toEqual({
      status: "terminal_failure",
      deliveryId: IDS.delivery,
      errorCode: scenario.errorCode,
    });
    expect(harness.sourceAccess.operations.deliveries.get(IDS.delivery)?.status).toBe("rejected");
    expect(harness.sourceLeases.settlements.at(-1)?.outcome).toBe("terminal");
    const auditText = JSON.stringify(harness.sourceAccess.events);
    expect(auditText).toContain("federation.delivery.rejected");
    expect(auditText).not.toContain("private rejection details");
    expect(auditText).not.toContain("private outage details");
  });

  it("does not settle delivery state after losing the durable lease", async () => {
    const harness = await runtimeHarness();
    harness.sourceLeases.settleAllowed = false;
    await expect(harness.source.runMaintenanceOnce()).resolves.toEqual({
      status: "lease_lost",
      deliveryId: IDS.delivery,
    });
    expect(harness.sourceAccess.operations.deliveries.get(IDS.delivery)?.status).toBe("processing");
    expect(harness.sourceAccess.operations.finishInputs).toHaveLength(0);
  });

  it("authenticates the HTTP route, deduplicates replay, and rejects forgery", async () => {
    const harness = await runtimeHarness();
    const request = await signedRequest(
      publishedPayload(),
      "/api/federation/v1/deliveries",
    );
    const body = await request.text();
    const headers = new Headers(request.headers);
    const first = await harness.target.handleRequest(new Request(request.url, {
      method: "POST",
      headers,
      body,
    }));
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ status: "accepted" });

    const duplicate = await harness.target.handleRequest(new Request(request.url, {
      method: "POST",
      headers,
      body,
    }));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ status: "duplicate" });
    expect(harness.targetShared.applied).toHaveLength(1);

    headers.set("x-guild-federation-signature", `v1=${"00".repeat(32)}`);
    const forged = await harness.target.handleRequest(new Request(request.url, {
      method: "POST",
      headers,
      body,
    }));
    expect(forged.status).toBe(401);
    await expect(forged.json()).resolves.toEqual({ ok: false, code: "signature_invalid" });
    expect(harness.targetShared.applied).toHaveLength(1);
  });

  it("applies the dedicated revocation endpoint before acknowledging and keeps a tombstone", async () => {
    const harness = await runtimeHarness({
      payload: grantRevocationPayload(),
      targetPath: "/api/federation/v1/revocations",
    });
    await expect(harness.source.runMaintenanceOnce()).resolves.toEqual({
      status: "sent",
      deliveryId: IDS.delivery,
      remoteStatus: "accepted",
    });
    expect(harness.targetShared.revokedGrants.has(IDS.grant)).toBe(true);
    expect(harness.targetShared.applied.at(-1)?.eventType).toBe(
      FEDERATION_EVENT_TYPES.grantsRevoked,
    );

    const laterPublication = await signedRequest(
      publishedPayload(),
      "/api/federation/v1/deliveries",
      {
        idempotencyKey: "federation:runtime:resurrection-attempt",
      },
    );
    const rejected = await harness.target.handleRequest(laterPublication);
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toEqual({ ok: false, code: "grant_revoked" });
    expect(harness.targetShared.applied).toHaveLength(1);
  });

  it("keeps revocation routing, methods, media type, and body size fail-closed", async () => {
    const harness = await runtimeHarness();
    const publicationOnRevocationPath = await signedRequest(
      publishedPayload(),
      "/api/federation/v1/revocations",
    );
    expect((await harness.target.handleRequest(publicationOnRevocationPath)).status).toBe(400);

    expect((await harness.target.handleRequest(new Request(
      "https://target.guild.example.test/api/federation/v1/deliveries",
      { method: "GET" },
    ))).status).toBe(405);
    expect((await harness.target.handleRequest(new Request(
      "https://target.guild.example.test/api/federation/v1/deliveries",
      { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" },
    ))).status).toBe(415);
    expect((await harness.target.handleRequest(new Request(
      "https://target.guild.example.test/api/federation/v1/deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2000000" },
        body: "{}",
      },
    ))).status).toBe(413);
    expect(harness.targetAccess.operations.deliveries.size).toBe(0);
  });
});
