const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,9}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;

export const MAX_WEBHOOK_BYTES = 65_536;
export const MAX_REPLAY_SECONDS = 300;

export interface VerifiedWebhookEvent {
  id: string;
  guildId: string;
  type: string;
  occurredAt: string;
  actor: {
    agentIdentityId: string;
    requesterIdentityId: string;
  };
  data: Record<string, unknown>;
}

export interface VerifiedWebhookRequest {
  idempotencyKey: string;
  event: VerifiedWebhookEvent;
  body: string;
  bodySha256: string;
  receivedAt: string;
}

export class WebhookProtocolError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WebhookProtocolError";
    this.status = status;
  }
}

export async function readBoundedBody(
  request: Request,
  maximumBytes = MAX_WEBHOOK_BYTES,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new WebhookProtocolError(413, "Webhook body is too large.");
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Uint8Array.from(result.value);
      byteLength += chunk.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel("Webhook body exceeded its byte limit.");
        throw new WebhookProtocolError(413, "Webhook body is too large.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesFromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function signingBytes(timestamp: string, body: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength);
  bytes.set(prefix, 0);
  bytes.set(body, prefix.byteLength);
  return bytes;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(body: string, timestamp: string): VerifiedWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new WebhookProtocolError(400, "Webhook body must be valid JSON.");
  }
  if (!object(parsed) || !UUID_PATTERN.test(String(parsed.id ?? "")) ||
      !UUID_PATTERN.test(String(parsed.guildId ?? "")) ||
      typeof parsed.type !== "string" || parsed.type.length > 100 ||
      !EVENT_TYPE_PATTERN.test(parsed.type) || parsed.occurredAt !== timestamp ||
      !object(parsed.actor) ||
      !UUID_PATTERN.test(String(parsed.actor.agentIdentityId ?? "")) ||
      !UUID_PATTERN.test(String(parsed.actor.requesterIdentityId ?? "")) ||
      !object(parsed.data)) {
    throw new WebhookProtocolError(422, "Webhook event does not match the Guild OS v1 contract.");
  }
  return {
    id: String(parsed.id),
    guildId: String(parsed.guildId),
    type: parsed.type,
    occurredAt: timestamp,
    actor: {
      agentIdentityId: String(parsed.actor.agentIdentityId),
      requesterIdentityId: String(parsed.actor.requesterIdentityId),
    },
    data: parsed.data,
  };
}

export async function verifyWebhookRequest(
  headers: Headers,
  bodyBytes: Uint8Array,
  signingSecret: string,
  now = Date.now(),
): Promise<VerifiedWebhookRequest> {
  if (new TextEncoder().encode(signingSecret).byteLength < 32) {
    throw new Error("Webhook receiver signing secret must contain at least 32 bytes.");
  }
  if (bodyBytes.byteLength === 0 || bodyBytes.byteLength > MAX_WEBHOOK_BYTES) {
    throw new WebhookProtocolError(413, "Webhook body size is outside the accepted range.");
  }
  if (!headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new WebhookProtocolError(415, "Webhook content type must be application/json.");
  }

  const idempotencyKey = headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new WebhookProtocolError(400, "Webhook idempotency key is invalid.");
  }
  const timestamp = headers.get("x-guild-timestamp") ?? "";
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== timestamp ||
      Math.abs(now - timestampMs) > MAX_REPLAY_SECONDS * 1_000) {
    throw new WebhookProtocolError(401, "Webhook timestamp is outside the replay window.");
  }
  const eventHeader = headers.get("x-guild-event") ?? "";
  const signatureHeader = headers.get("x-guild-signature") ?? "";
  const signatureHex = /^v1=([a-f0-9]{64})$/.exec(signatureHeader)?.[1];
  if (!signatureHex) {
    throw new WebhookProtocolError(401, "Webhook signature is invalid.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = Uint8Array.from(bytesFromHex(signatureHex));
  const signedBytes = Uint8Array.from(signingBytes(timestamp, bodyBytes));
  if (!await crypto.subtle.verify(
    "HMAC",
    key,
    signature.buffer,
    signedBytes.buffer,
  )) {
    throw new WebhookProtocolError(401, "Webhook signature is invalid.");
  }

  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bodyBytes);
  } catch {
    throw new WebhookProtocolError(400, "Webhook body must be valid UTF-8.");
  }
  const event = parseEvent(body, timestamp);
  if (eventHeader !== event.type) {
    throw new WebhookProtocolError(422, "Webhook event header does not match its body.");
  }
  return {
    idempotencyKey,
    event,
    body,
    bodySha256: hex(await crypto.subtle.digest("SHA-256", Uint8Array.from(bodyBytes).buffer)),
    receivedAt: new Date(now).toISOString(),
  };
}
