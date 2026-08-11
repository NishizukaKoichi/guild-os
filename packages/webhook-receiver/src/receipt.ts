import type { VerifiedWebhookRequest } from "./protocol.js";

export interface StoredWebhookReceipt {
  idempotencyKey: string;
  eventId: string;
  guildId: string;
  eventType: string;
  agentIdentityId: string;
  requesterIdentityId: string;
  occurredAt: string;
  receivedAt: string;
  body: string;
  bodySha256: string;
}

export interface ReceiptClaimResult {
  duplicate: boolean;
  receipt: StoredWebhookReceipt;
}

export class ReceiptConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different payload.");
    this.name = "ReceiptConflictError";
  }
}

export function receiptFromRequest(request: VerifiedWebhookRequest): StoredWebhookReceipt {
  return {
    idempotencyKey: request.idempotencyKey,
    eventId: request.event.id,
    guildId: request.event.guildId,
    eventType: request.event.type,
    agentIdentityId: request.event.actor.agentIdentityId,
    requesterIdentityId: request.event.actor.requesterIdentityId,
    occurredAt: request.event.occurredAt,
    receivedAt: request.receivedAt,
    body: request.body,
    bodySha256: request.bodySha256,
  };
}

export function claimReceipt(
  existing: StoredWebhookReceipt | undefined,
  candidate: StoredWebhookReceipt,
): ReceiptClaimResult {
  if (!existing) return { duplicate: false, receipt: candidate };
  if (existing.idempotencyKey !== candidate.idempotencyKey ||
      existing.guildId !== candidate.guildId ||
      existing.bodySha256 !== candidate.bodySha256) {
    throw new ReceiptConflictError();
  }
  return { duplicate: true, receipt: existing };
}
