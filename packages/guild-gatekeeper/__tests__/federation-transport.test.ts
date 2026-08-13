import { describe, expect, it, vi } from "vitest";
import {
  FEDERATION_EVENT_TYPES,
  FederationTransportError,
  deliverFederationDelivery,
  hashFederationPayload,
  receiveFederationDelivery,
  type FederationDeliveryCompletion,
  type FederationDeliveryRetry,
  type FederationEnvelope,
  type FederationExplicitPayload,
  type FederationFetch,
  type FederationGrantAuthorization,
  type FederationInboundRequest,
  type FederationInboundReservation,
  type FederationOutboundDelivery,
  type FederationTransportErrorCode,
  type FederationTransportLink,
  type FederationTransportRepository,
} from "../src/federation-transport.js";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const SECRET = "purchaser-owned-federation-secret-0123456789abcdef";
const IDS = {
  sourceGuild: "10000000-0000-4000-8000-000000000001",
  targetGuild: "20000000-0000-4000-8000-000000000002",
  otherGuild: "30000000-0000-4000-8000-000000000003",
  link: "40000000-0000-4000-8000-000000000004",
  otherLink: "50000000-0000-4000-8000-000000000005",
  delivery: "60000000-0000-4000-8000-000000000006",
  delivery2: "70000000-0000-4000-8000-000000000007",
  grant: "80000000-0000-4000-8000-000000000008",
  memory: "90000000-0000-4000-8000-000000000009",
};

function sourceLink(
  overrides: Partial<FederationTransportLink> = {},
): FederationTransportLink {
  return {
    id: IDS.link,
    guildId: IDS.sourceGuild,
    remoteGuildId: IDS.targetGuild,
    endpointUrl: "https://target.guild.example.test/federation/inbox",
    secretReference: "GUILD_FEDERATION_SHARED_SECRET",
    direction: "outbound",
    status: "active",
    ...overrides,
  };
}

function targetLink(
  overrides: Partial<FederationTransportLink> = {},
): FederationTransportLink {
  return {
    id: IDS.link,
    guildId: IDS.targetGuild,
    remoteGuildId: IDS.sourceGuild,
    endpointUrl: "https://source.guild.example.test/federation/inbox",
    secretReference: "GUILD_FEDERATION_SHARED_SECRET",
    direction: "inbound",
    status: "active",
    ...overrides,
  };
}

function publishedPayload(label = "Approved memory"): FederationExplicitPayload {
  return {
    kind: "resources_published",
    grants: [{
      grantId: IDS.grant,
      resourceType: "memory",
      resourceId: IDS.memory,
      permission: "read",
      grantVersion: 1,
      resourceVersion: 3,
      resource: { title: label, body: "Only explicitly granted content crosses the boundary." },
    }],
  };
}

function revokedGrantPayload(): FederationExplicitPayload {
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

function linkRevocationPayload(): FederationExplicitPayload {
  return {
    kind: "link_revoked",
    linkVersion: 2,
    revokedAt: NOW.toISOString(),
  };
}

function eventFor(payload: FederationExplicitPayload): FederationOutboundDelivery["eventType"] {
  if (payload.kind === "resources_published") return FEDERATION_EVENT_TYPES.resourcesPublished;
  if (payload.kind === "grants_revoked") return FEDERATION_EVENT_TYPES.grantsRevoked;
  return FEDERATION_EVENT_TYPES.linkRevoked;
}

async function outboundDelivery(
  payload: FederationExplicitPayload = publishedPayload(),
  overrides: Partial<FederationOutboundDelivery> = {},
): Promise<FederationOutboundDelivery> {
  return {
    id: IDS.delivery,
    guildId: IDS.sourceGuild,
    federationLinkId: IDS.link,
    eventType: eventFor(payload),
    payload,
    payloadHash: await hashFederationPayload(payload),
    idempotencyKey: "federation:delivery:1",
    attemptCount: 1,
    ...overrides,
  };
}

function grantIds(payload: FederationExplicitPayload): readonly string[] {
  return payload.kind === "link_revoked" ? [] : payload.grants.map((grant) => grant.grantId);
}

class MemoryFederationRepository implements FederationTransportRepository {
  link: FederationTransportLink | null;
  readonly activeGrantIds = new Set<string>();
  readonly revokedGrantIds = new Set<string>();
  readonly inboundReceipts = new Map<string, string>();
  readonly applied: FederationEnvelope[] = [];
  readonly completions: FederationDeliveryCompletion[] = [];
  readonly retries: FederationDeliveryRetry[] = [];
  reservationOverride: FederationInboundReservation["state"] | null = null;

  constructor(link: FederationTransportLink | null) {
    this.link = link;
  }

  async getLink(linkId: string): Promise<FederationTransportLink | null> {
    return this.link?.id === linkId ? this.link : null;
  }

  async authorizeOutboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationOutboundDelivery["eventType"];
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    const ids = grantIds(input.payload);
    if (input.payload.kind === "resources_published") {
      if (ids.some((id) => this.revokedGrantIds.has(id))) return "revoked";
      return ids.every((id) => this.activeGrantIds.has(id)) ? "authorized" : "denied";
    }
    if (input.payload.kind === "grants_revoked") {
      return ids.every((id) => this.revokedGrantIds.has(id)) ? "authorized" : "denied";
    }
    return input.eventType === FEDERATION_EVENT_TYPES.linkRevoked ? "authorized" : "denied";
  }

  async authorizeInboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationOutboundDelivery["eventType"];
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization> {
    const ids = grantIds(input.payload);
    if (input.payload.kind === "resources_published" &&
        ids.some((id) => this.revokedGrantIds.has(id))) return "revoked";
    return input.eventType === eventFor(input.payload) ? "authorized" : "denied";
  }

  async reserveInboundDelivery(input: {
    readonly envelope: FederationEnvelope;
    readonly envelopeHash: string;
  }): Promise<FederationInboundReservation> {
    if (this.reservationOverride !== null) return { state: this.reservationOverride };
    const existing = this.inboundReceipts.get(input.envelope.idempotencyKey);
    if (existing === undefined) {
      this.inboundReceipts.set(input.envelope.idempotencyKey, input.envelopeHash);
      return { state: "accepted" };
    }
    return { state: existing === input.envelopeHash ? "duplicate" : "conflict" };
  }

  async applyInboundDelivery(input: { readonly envelope: FederationEnvelope }): Promise<void> {
    this.applied.push(input.envelope);
    if (input.envelope.payload.kind === "grants_revoked") {
      for (const grant of input.envelope.payload.grants) this.revokedGrantIds.add(grant.grantId);
    }
    if (input.envelope.payload.kind === "link_revoked" && this.link !== null) {
      this.link = { ...this.link, status: "revoked" };
    }
  }

  async finishDelivery(input: FederationDeliveryCompletion): Promise<void> {
    this.completions.push(input);
  }

  async retryDelivery(input: FederationDeliveryRetry): Promise<void> {
    this.retries.push(input);
  }
}

async function expectTransportError(
  operation: Promise<unknown>,
  code: FederationTransportErrorCode,
): Promise<FederationTransportError> {
  try {
    await operation;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FederationTransportError);
    expect(error).toMatchObject({ code });
    return error as FederationTransportError;
  }
  throw new Error(`Expected FederationTransportError(${code}).`);
}

function bodyFrom(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("Expected a string Federation body.");
  return init.body;
}

function acknowledgementResponse(
  envelope: FederationEnvelope,
  status: "accepted" | "duplicate" = "accepted",
): Response {
  return new Response(JSON.stringify({
    deliveryId: envelope.deliveryId,
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    status,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function signBytes(bytes: Uint8Array, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return `v1=${[...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function inboundRequest(
  overrides: Partial<FederationEnvelope> = {},
): Promise<{ readonly envelope: FederationEnvelope; readonly request: FederationInboundRequest }> {
  const payload = overrides.payload ?? publishedPayload();
  const envelope: FederationEnvelope = {
    sourceGuildId: IDS.sourceGuild,
    targetGuildId: IDS.targetGuild,
    linkId: IDS.link,
    deliveryId: IDS.delivery,
    eventType: eventFor(payload),
    payload,
    payloadHash: await hashFederationPayload(payload),
    idempotencyKey: "federation:delivery:1",
    issuedAt: NOW.toISOString(),
    ...overrides,
  };
  const rawBody = new TextEncoder().encode(JSON.stringify(envelope));
  return { envelope, request: { rawBody, signature: await signBytes(rawBody) } };
}

function secretResolver(reference: string): string | null {
  return reference === "GUILD_FEDERATION_SHARED_SECRET" ? SECRET : null;
}

describe("signed two-deployment Federation transport", () => {
  it("delivers one explicit grant across two deployments and records both Chronicles", async () => {
    const source = new MemoryFederationRepository(sourceLink());
    const target = new MemoryFederationRepository(targetLink());
    source.activeGrantIds.add(IDS.grant);
    let transmitted: FederationEnvelope | null = null;
    const fetcher = vi.fn<FederationFetch>(async (input, init) => {
      expect(input.toString()).toBe(sourceLink().endpointUrl);
      expect(init?.redirect).toBe("manual");
      const body = bodyFrom(init);
      transmitted = JSON.parse(body) as FederationEnvelope;
      expect(Object.keys(transmitted).sort()).toEqual([
        "deliveryId", "eventType", "idempotencyKey", "issuedAt", "linkId", "payload",
        "payloadHash", "sourceGuildId", "targetGuildId",
      ]);
      const acknowledgement = await receiveFederationDelivery({
        rawBody: new TextEncoder().encode(body),
        signature: new Headers(init?.headers).get("x-guild-federation-signature"),
      }, {
        localGuildId: IDS.targetGuild,
        repository: target,
        resolveSecret: secretResolver,
        now: () => NOW,
      });
      return new Response(JSON.stringify(acknowledgement), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await deliverFederationDelivery(await outboundDelivery(), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: fetcher,
      now: () => NOW,
    });

    expect(result).toMatchObject({ status: "accepted", statusCode: 200 });
    expect(transmitted).toMatchObject({
      sourceGuildId: IDS.sourceGuild,
      targetGuildId: IDS.targetGuild,
      linkId: IDS.link,
      deliveryId: IDS.delivery,
    });
    expect(target.applied).toHaveLength(1);
    expect(target.applied[0]?.payload).toEqual(publishedPayload());
    expect(source.completions.at(-1)).toMatchObject({
      direction: "outbound",
      outcome: "completed",
      chronicleEventType: "federation.delivery.completed",
    });
    expect(target.completions.at(-1)).toMatchObject({
      direction: "inbound",
      outcome: "completed",
      chronicleEventType: "federation.delivery.completed",
    });
  });

  it("verifies the exact raw bytes and refuses forged signatures", async () => {
    const target = new MemoryFederationRepository(targetLink());
    const { request } = await inboundRequest();
    const original = new TextDecoder().decode(request.rawBody);
    const changed = new TextEncoder().encode(original.replace("Approved memory", "Forged memory"));

    await expectTransportError(receiveFederationDelivery({
      rawBody: changed,
      signature: request.signature,
    }, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "signature_invalid");

    await expectTransportError(receiveFederationDelivery({
      rawBody: request.rawBody,
      signature: `v1=${"00".repeat(32)}`,
    }, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "signature_invalid");
    expect(target.applied).toHaveLength(0);
  });

  it.each([
    ["target_mismatch" as const, { targetGuildId: IDS.otherGuild }],
    ["source_mismatch" as const, { sourceGuildId: IDS.otherGuild }],
    ["link_not_found" as const, { linkId: IDS.otherLink }],
  ])("rejects %s before applying remote data", async (code, overrides) => {
    const target = new MemoryFederationRepository(targetLink());
    const { request } = await inboundRequest(overrides);
    await expectTransportError(receiveFederationDelivery(request, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), code);
    expect(target.applied).toHaveLength(0);
  });

  it("deduplicates exact and freshly signed retries, then rejects an idempotency conflict", async () => {
    const target = new MemoryFederationRepository(targetLink());
    const first = await inboundRequest();
    const runtime = {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    };
    await expect(receiveFederationDelivery(first.request, runtime)).resolves.toMatchObject({
      status: "accepted",
    });
    await expect(receiveFederationDelivery(first.request, runtime)).resolves.toMatchObject({
      status: "duplicate",
    });
    const refreshed = await inboundRequest({ issuedAt: "2026-08-14T00:01:00.000Z" });
    await expect(receiveFederationDelivery(refreshed.request, runtime)).resolves.toMatchObject({
      status: "duplicate",
    });
    expect(target.applied).toHaveLength(1);

    const conflicting = await inboundRequest({
      deliveryId: IDS.delivery2,
      payload: publishedPayload("Different approved memory"),
      payloadHash: await hashFederationPayload(publishedPayload("Different approved memory")),
    });
    await expectTransportError(
      receiveFederationDelivery(conflicting.request, runtime),
      "replay_conflict",
    );
    expect(target.applied).toHaveLength(1);
    expect(target.completions.some((entry) =>
      entry.chronicleEventType === "federation.delivery.duplicate")).toBe(true);
  });

  it("returns a retryable error while the same inbound delivery has a live lease", async () => {
    const target = new MemoryFederationRepository(targetLink());
    target.reservationOverride = "busy";
    const { request } = await inboundRequest();
    const error = await expectTransportError(receiveFederationDelivery(request, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "delivery_in_progress");
    expect(error.retryable).toBe(true);
    expect(target.applied).toHaveLength(0);
    expect(target.completions).toHaveLength(0);
  });

  it("refuses a correctly signed request outside the freshness window", async () => {
    const target = new MemoryFederationRepository(targetLink());
    const { request } = await inboundRequest({ issuedAt: "2026-08-13T23:50:00.000Z" });
    await expectTransportError(receiveFederationDelivery(request, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "request_stale");
    expect(target.inboundReceipts.size).toBe(0);
  });

  it("refuses revoked links and revoked grants without making a network request", async () => {
    const fetcher = vi.fn<FederationFetch>();
    const revokedLinkRepository = new MemoryFederationRepository(sourceLink({ status: "revoked" }));
    revokedLinkRepository.activeGrantIds.add(IDS.grant);
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: revokedLinkRepository,
      resolveSecret: secretResolver,
      fetch: fetcher,
      now: () => NOW,
    }), "link_inactive");

    const revokedGrantRepository = new MemoryFederationRepository(sourceLink());
    revokedGrantRepository.revokedGrantIds.add(IDS.grant);
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: revokedGrantRepository,
      resolveSecret: secretResolver,
      fetch: fetcher,
      now: () => NOW,
    }), "grant_revoked");
    expect(fetcher).not.toHaveBeenCalled();
    expect(revokedGrantRepository.completions.at(-1)).toMatchObject({
      outcome: "rejected",
      errorCode: "grant_revoked",
    });

    const revokedInboundRepository = new MemoryFederationRepository(targetLink({ status: "revoked" }));
    const { request } = await inboundRequest();
    await expectTransportError(receiveFederationDelivery(request, {
      localGuildId: IDS.targetGuild,
      repository: revokedInboundRepository,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "link_inactive");
    expect(revokedInboundRepository.inboundReceipts.size).toBe(0);
  });

  it("keeps a revoked inbound grant tombstoned against later publication", async () => {
    const target = new MemoryFederationRepository(targetLink());
    target.revokedGrantIds.add(IDS.grant);
    const { request } = await inboundRequest();
    await expectTransportError(receiveFederationDelivery(request, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "grant_revoked");
    expect(target.inboundReceipts.size).toBe(0);
  });

  it("refuses internal endpoints and redirects", async () => {
    const internal = new MemoryFederationRepository(sourceLink({
      endpointUrl: "https://127.0.0.1/federation/inbox",
    }));
    internal.activeGrantIds.add(IDS.grant);
    const internalFetch = vi.fn<FederationFetch>();
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: internal,
      resolveSecret: secretResolver,
      fetch: internalFetch,
      now: () => NOW,
    }), "unsafe_endpoint");
    expect(internalFetch).not.toHaveBeenCalled();

    const redirected = new MemoryFederationRepository(sourceLink());
    redirected.activeGrantIds.add(IDS.grant);
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: redirected,
      resolveSecret: secretResolver,
      fetch: vi.fn<FederationFetch>(async () => new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/inbox" },
      })),
      now: () => NOW,
    }), "redirect_refused");
  });

  it("times out boundedly and records a retry Chronicle", async () => {
    const source = new MemoryFederationRepository(sourceLink());
    source.activeGrantIds.add(IDS.grant);
    const neverReturns = vi.fn<FederationFetch>(
      async () => new Promise<Response>(() => undefined),
    );
    const error = await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: neverReturns,
      now: () => NOW,
      timeoutMs: 5,
    }), "request_timeout");
    expect(error.retryable).toBe(true);
    expect(source.retries).toHaveLength(1);
    expect(source.retries[0]).toMatchObject({
      errorCode: "request_timeout",
      chronicleEventType: "federation.delivery.retry_scheduled",
    });
  });

  it("rejects oversized responses and request bodies", async () => {
    const source = new MemoryFederationRepository(sourceLink());
    source.activeGrantIds.add(IDS.grant);
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: vi.fn<FederationFetch>(async () => new Response("x".repeat(128), {
        status: 200,
        headers: { "content-length": "128" },
      })),
      now: () => NOW,
      maxResponseBytes: 32,
    }), "response_too_large");

    const target = new MemoryFederationRepository(targetLink());
    await expectTransportError(receiveFederationDelivery({
      rawBody: new Uint8Array(128),
      signature: null,
    }, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
      maxRequestBytes: 32,
    }), "request_too_large");
  });

  it("propagates grant and link revocation across the signed boundary", async () => {
    const source = new MemoryFederationRepository(sourceLink());
    const target = new MemoryFederationRepository(targetLink());
    source.revokedGrantIds.add(IDS.grant);
    const bridge = vi.fn<FederationFetch>(async (_input, init) => {
      const body = bodyFrom(init);
      const acknowledgement = await receiveFederationDelivery({
        rawBody: new TextEncoder().encode(body),
        signature: new Headers(init?.headers).get("x-guild-federation-signature"),
      }, {
        localGuildId: IDS.targetGuild,
        repository: target,
        resolveSecret: secretResolver,
        now: () => NOW,
      });
      return new Response(JSON.stringify(acknowledgement), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await deliverFederationDelivery(await outboundDelivery(revokedGrantPayload()), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: bridge,
      now: () => NOW,
    });
    expect(target.revokedGrantIds.has(IDS.grant)).toBe(true);

    source.link = sourceLink({ status: "revoked" });
    await deliverFederationDelivery(await outboundDelivery(linkRevocationPayload(), {
      id: IDS.delivery2,
      idempotencyKey: "federation:delivery:2",
    }), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: bridge,
      now: () => NOW,
    });
    expect(target.link?.status).toBe("revoked");
    expect(target.applied.map((entry) => entry.eventType)).toEqual([
      FEDERATION_EVENT_TYPES.grantsRevoked,
      FEDERATION_EVENT_TYPES.linkRevoked,
    ]);
  });

  it("rejects payloads that try to smuggle ambient resources outside explicit grants", async () => {
    const target = new MemoryFederationRepository(targetLink());
    const valid = await inboundRequest();
    const parsed = JSON.parse(new TextDecoder().decode(valid.request.rawBody)) as Record<string, unknown>;
    const payload = parsed.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Expected a payload object.");
    }
    parsed.payload = { ...payload, ambientResource: { secret: "must-not-cross" } };
    const rawBody = new TextEncoder().encode(JSON.stringify(parsed));
    await expectTransportError(receiveFederationDelivery({
      rawBody,
      signature: await signBytes(rawBody),
    }, {
      localGuildId: IDS.targetGuild,
      repository: target,
      resolveSecret: secretResolver,
      now: () => NOW,
    }), "invalid_request");
    expect(target.applied).toHaveLength(0);
  });

  it("rejects a response whose acknowledgement does not bind to the delivery", async () => {
    const source = new MemoryFederationRepository(sourceLink());
    source.activeGrantIds.add(IDS.grant);
    await expectTransportError(deliverFederationDelivery(await outboundDelivery(), {
      repository: source,
      resolveSecret: secretResolver,
      fetch: vi.fn<FederationFetch>(async (_input, init) => {
        const envelope = JSON.parse(bodyFrom(init)) as FederationEnvelope;
        return acknowledgementResponse({ ...envelope, deliveryId: IDS.delivery2 });
      }),
      now: () => NOW,
    }), "invalid_acknowledgement");
  });
});
