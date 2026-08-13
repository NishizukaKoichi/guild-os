import { describe, expect, it, vi } from "vitest";
import type { FederationLink, JsonObject } from "@guild-os/domain";
import type { GuildTransactionConnection } from "@guild-os/postgres";
import { hashPersistedFederationJson } from "@guild-os/postgres";
import { PostgresFederationRuntimeAdapter } from "../src/federation-postgres-adapter.js";
import { FEDERATION_EVENT_TYPES, type FederationExplicitPayload } from "../src/federation-transport.js";

const IDS = {
  guild: "10000000-0000-4000-8000-000000000001",
  remoteGuild: "20000000-0000-4000-8000-000000000002",
  actor: "30000000-0000-4000-8000-000000000003",
  link: "40000000-0000-4000-8000-000000000004",
  delivery: "50000000-0000-4000-8000-000000000005",
  grant: "60000000-0000-4000-8000-000000000006",
  memory: "70000000-0000-4000-8000-000000000007",
};
const NOW = "2026-08-14T00:00:00.000Z";
const PRIVATE_CONTENT = "EXPLICIT-CONTENT-IS-DATA-NOT-A-LOG";

function payload(): FederationExplicitPayload {
  return {
    kind: "resources_published",
    grants: [{
      grantId: IDS.grant,
      resourceType: "memory",
      resourceId: IDS.memory,
      permission: "read",
      grantVersion: 1,
      resourceVersion: 2,
      resource: { title: "Selected memory", body: PRIVATE_CONTENT },
    }],
  };
}

function jsonPayload(): JsonObject {
  return JSON.parse(JSON.stringify(payload())) as JsonObject;
}

function link(): FederationLink {
  return {
    id: IDS.link,
    guildId: IDS.guild,
    remoteGuildId: IDS.remoteGuild,
    remoteName: "Remote Guild",
    endpointUrl: "https://remote.guild.example.test/api/federation/v1/deliveries",
    secretReference: "PURCHASER_FEDERATION_SECRET",
    direction: "inbound",
    status: "active",
    allowedResourceTypes: ["memory"],
    createdByActorId: IDS.actor,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("PostgresFederationRuntimeAdapter", () => {
  it("maps a materialized durable DB claim without resolving or logging its secret reference", async () => {
    const materialized = jsonPayload();
    const payloadHash = hashPersistedFederationJson(materialized);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("attempt_count >= LEAST")) return { rows: [] };
      if (sql.includes("WITH candidate AS")) {
        return {
          rows: [{
            id: IDS.delivery,
            guild_id: IDS.guild,
            federation_link_id: IDS.link,
            event_type: FEDERATION_EVENT_TYPES.resourcesPublished,
            payload: { grants: [{ grantId: IDS.grant }] },
            transport_payload: materialized,
            transport_payload_hash: payloadHash,
            idempotency_key: "federation:adapter:1",
            attempt_count: 1,
            effective_max_attempts: 3,
            lease_token: "80000000-0000-4000-8000-000000000008",
            lease_owner: "adapter-worker",
            lease_expires_at: "2026-08-14T00:01:00.000Z",
          }],
        };
      }
      throw new Error(`Unexpected SQL in adapter test: ${sql.slice(0, 40)}`);
    });
    const connection = { query } as unknown as GuildTransactionConnection;
    const adapter = new PostgresFederationRuntimeAdapter(IDS.guild);
    const claim = await adapter.claimOutbound({
      connection,
      guildId: IDS.guild,
      systemActorId: IDS.actor,
      workerId: "adapter-worker",
      now: NOW,
      leaseDurationMs: 60_000,
      maxAttempts: 3,
    });
    expect(claim).toMatchObject({
      state: "leased",
      lease: {
        deliveryId: IDS.delivery,
        delivery: { payload: materialized, payloadHash },
      },
    });
    const databaseInputs = JSON.stringify(query.mock.calls);
    expect(databaseInputs).not.toContain("PURCHASER_FEDERATION_SECRET");
    expect(databaseInputs).not.toContain(PRIVATE_CONTENT);
  });

  it("maps a persisted revocation tombstone to a fail-closed inbound authorization", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM federation_links")) {
        return {
          rows: [{
            remote_guild_id: IDS.remoteGuild,
            remote_actor_id: IDS.actor,
            direction: "inbound",
            status: "active",
            allowed_resource_types: ["memory"],
            remote_version: 0,
          }],
        };
      }
      if (sql.includes("FROM federation_inbound_resources")) {
        return {
          rows: [{
            grant_id: IDS.grant,
            resource_type: "memory",
            resource_id: IDS.memory,
            permission: "read",
            status: "revoked",
          }],
        };
      }
      throw new Error(`Unexpected SQL in adapter test: ${sql.slice(0, 40)}`);
    });
    const connection = { query } as unknown as GuildTransactionConnection;
    const adapter = new PostgresFederationRuntimeAdapter(IDS.guild);
    await expect(adapter.authorizeInbound({
      connection,
      link: link(),
      eventType: FEDERATION_EVENT_TYPES.resourcesPublished,
      payload: payload(),
    })).resolves.toBe("revoked");
  });
});
