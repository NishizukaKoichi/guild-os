import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_WEBHOOK_BYTES,
  WebhookProtocolError,
  readBoundedBody,
  verifyWebhookRequest,
} from "./protocol.js";
import {
  ReceiptConflictError,
  claimReceipt,
  receiptFromRequest,
} from "./receipt.js";

const secret = "s".repeat(48);
const now = Date.parse("2026-08-12T00:00:00.000Z");

function signedRequest(overrides: { timestamp?: string; type?: string; body?: string } = {}) {
  const timestamp = overrides.timestamp ?? new Date(now).toISOString();
  const type = overrides.type ?? "guild.quest.completed";
  const body = overrides.body ?? JSON.stringify({
    id: randomUUID(),
    guildId: randomUUID(),
    type,
    occurredAt: timestamp,
    actor: {
      agentIdentityId: randomUUID(),
      requesterIdentityId: randomUUID(),
    },
    data: { questId: randomUUID() },
  });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    headers: new Headers({
      "content-type": "application/json",
      "idempotency-key": `agent-action:${randomUUID()}:${randomUUID()}`,
      "x-guild-event": type,
      "x-guild-timestamp": timestamp,
      "x-guild-signature": `v1=${signature}`,
    }),
    bytes: new TextEncoder().encode(body),
  };
}

describe("Guild Webhook receiver protocol", () => {
  it("verifies the exact request and produces a durable receipt", async () => {
    const request = signedRequest();
    const verified = await verifyWebhookRequest(request.headers, request.bytes, secret, now);
    expect(verified.event.type).toBe("guild.quest.completed");
    expect(verified.bodySha256).toMatch(/^[a-f0-9]{64}$/);

    const receipt = receiptFromRequest(verified);
    expect(claimReceipt(undefined, receipt)).toEqual({ duplicate: false, receipt });
    expect(claimReceipt(receipt, { ...receipt, receivedAt: new Date(now + 1).toISOString() }))
      .toEqual({ duplicate: true, receipt });
  });

  it("rejects forged, stale, mismatched, oversized, and conflicting requests", async () => {
    const forged = signedRequest();
    forged.headers.set("x-guild-signature", `v1=${"0".repeat(64)}`);
    await expect(verifyWebhookRequest(forged.headers, forged.bytes, secret, now))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<WebhookProtocolError>);

    const stale = signedRequest({ timestamp: "2026-08-11T23:54:59.000Z" });
    await expect(verifyWebhookRequest(stale.headers, stale.bytes, secret, now))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<WebhookProtocolError>);

    const mismatched = signedRequest();
    mismatched.headers.set("x-guild-event", "guild.quest.failed");
    await expect(verifyWebhookRequest(mismatched.headers, mismatched.bytes, secret, now))
      .rejects.toMatchObject({ status: 422 } satisfies Partial<WebhookProtocolError>);

    const oversized = signedRequest();
    await expect(verifyWebhookRequest(
      oversized.headers,
      new Uint8Array(MAX_WEBHOOK_BYTES + 1),
      secret,
      now,
    )).rejects.toMatchObject({ status: 413 } satisfies Partial<WebhookProtocolError>);

    const valid = await verifyWebhookRequest(
      signedRequest().headers,
      signedRequest().bytes,
      secret,
      now,
    ).catch(() => null);
    expect(valid).toBeNull();

    const firstRequest = signedRequest();
    const first = receiptFromRequest(await verifyWebhookRequest(
      firstRequest.headers,
      firstRequest.bytes,
      secret,
      now,
    ));
    expect(() => claimReceipt(first, { ...first, bodySha256: "0".repeat(64) }))
      .toThrow(ReceiptConflictError);
  });

  it("stops reading request streams at the byte limit", async () => {
    const request = new Request("https://hooks.example.com/guild-events", {
      method: "POST",
      body: new Uint8Array(MAX_WEBHOOK_BYTES + 1),
    });
    await expect(readBoundedBody(request)).rejects.toMatchObject({
      status: 413,
    } satisfies Partial<WebhookProtocolError>);
  });
});
