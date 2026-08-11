import { createHmac, randomUUID } from "node:crypto";

const endpoint = process.env.WEBHOOK_RECEIVER_URL;
const secret = process.env.GUILD_WEBHOOK_SIGNING_SECRET;
if (!endpoint) throw new Error("Set WEBHOOK_RECEIVER_URL to the deployed /guild-events URL.");
if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
  throw new Error("Set GUILD_WEBHOOK_SIGNING_SECRET to the deployed secret (at least 32 bytes).");
}
const url = new URL(endpoint);
if (url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || url.pathname !== "/guild-events") {
  throw new Error("WEBHOOK_RECEIVER_URL must be a credential-free HTTPS /guild-events URL.");
}

const timestamp = new Date().toISOString();
const idempotencyKey = `smoke:${randomUUID()}`;
const body = JSON.stringify({
  id: randomUUID(),
  guildId: randomUUID(),
  type: "guild.smoke.accepted",
  occurredAt: timestamp,
  actor: {
    agentIdentityId: randomUUID(),
    requesterIdentityId: randomUUID(),
  },
  data: { synthetic: true },
});
const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
const headers = {
  "content-type": "application/json",
  "idempotency-key": idempotencyKey,
  "x-guild-event": "guild.smoke.accepted",
  "x-guild-timestamp": timestamp,
  "x-guild-signature": `v1=${signature}`,
};

async function deliver(expectedStatus, expectedDuplicate) {
  const response = await fetch(url, { method: "POST", headers, body, redirect: "error" });
  const result = await response.json();
  if (response.status !== expectedStatus || result.accepted !== true ||
      result.duplicate !== expectedDuplicate) {
    throw new Error(`Receiver smoke failed with HTTP ${response.status}.`);
  }
  return result.bodySha256;
}

const firstHash = await deliver(201, false);
const duplicateHash = await deliver(200, true);
if (firstHash !== duplicateHash) throw new Error("Receiver returned inconsistent payload hashes.");
process.stdout.write(`Webhook receiver accepted one effect and deduplicated its replay (${firstHash}).\n`);
