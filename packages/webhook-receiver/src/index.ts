import { DurableObject } from "cloudflare:workers";
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
  type ReceiptClaimResult,
  type StoredWebhookReceipt,
} from "./receipt.js";

interface Env {
  GUILD_WEBHOOK_SIGNING_SECRET: string;
  WEBHOOK_RECEIPTS: DurableObjectNamespace<WebhookReceipt>;
}

const responseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders });
}

export class WebhookReceipt extends DurableObject<Env> {
  async accept(candidate: StoredWebhookReceipt): Promise<ReceiptClaimResult> {
    return this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<StoredWebhookReceipt>("receipt");
      const result = claimReceipt(existing, candidate);
      if (!result.duplicate) await transaction.put("receipt", candidate);
      return result;
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true, service: "guild-os-webhook-receiver" });
    }
    if (request.method !== "POST" || url.pathname !== "/guild-events") {
      return json({ error: "Not found." }, 404);
    }

    try {
      const body = await readBoundedBody(request, MAX_WEBHOOK_BYTES);
      const verified = await verifyWebhookRequest(
        request.headers,
        body,
        env.GUILD_WEBHOOK_SIGNING_SECRET,
      );
      const objectId = env.WEBHOOK_RECEIPTS.idFromName(
        `${verified.event.guildId}\n${verified.idempotencyKey}`,
      );
      const result = await env.WEBHOOK_RECEIPTS.get(objectId).accept(
        receiptFromRequest(verified),
      );
      return json({
        accepted: true,
        duplicate: result.duplicate,
        eventId: result.receipt.eventId,
        bodySha256: result.receipt.bodySha256,
      }, result.duplicate ? 200 : 201);
    } catch (error) {
      if (error instanceof WebhookProtocolError) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof ReceiptConflictError) {
        return json({ error: error.message }, 409);
      }
      console.error({ event: "webhook.receiver.failed", error: "Internal receiver failure." });
      return json({ error: "Internal receiver failure." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
