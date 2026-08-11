import type { AgentExecutionClaim } from "./agent-service.js";

export interface AgentWebhookDeliveryResult {
  statusCode: number;
  deliveredAt: string;
  durationSeconds: number;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function deliverSignedWebhook(
  endpointUrl: string,
  signingSecret: string,
  claim: AgentExecutionClaim,
  fetcher: typeof fetch = fetch,
): Promise<AgentWebhookDeliveryResult> {
  if (new TextEncoder().encode(signingSecret).byteLength < 32) {
    throw new Error("Webhook signing secret must contain at least 32 bytes.");
  }
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    id: claim.runId,
    guildId: claim.guildId,
    type: claim.eventType,
    occurredAt: timestamp,
    actor: {
      agentIdentityId: claim.agentIdentityId,
      requesterIdentityId: claim.requesterIdentityId,
    },
    data: JSON.parse(claim.payloadJson) as unknown,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  ));
  const timeoutMs = Math.max(
    1_000,
    Math.min(30_000, claim.effectiveLimits.maxDurationSeconds * 1_000),
  );
  const response = await fetcher(endpointUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "content-type": "application/json",
      "idempotency-key": claim.idempotencyKey,
      "user-agent": "Guild-OS/1.0",
      "x-guild-event": claim.eventType,
      "x-guild-signature": `v1=${signature}`,
      "x-guild-timestamp": timestamp,
    },
    body,
  });
  await response.body?.cancel();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Webhook returned a non-success status (${response.status}).`);
  }
  return {
    statusCode: response.status,
    deliveredAt: new Date().toISOString(),
    durationSeconds: Math.max(1, Math.ceil((Date.now() - startedAt) / 1_000)),
  };
}
