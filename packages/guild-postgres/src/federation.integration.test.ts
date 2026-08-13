import { randomUUID } from "node:crypto";
import type { ChronicleEvent, Constitution, JsonObject } from "@guild-os/domain";
import { describe, expect, it } from "vitest";
import { GuildCollectiveRepository } from "./collective.js";
import { GuildDecisionRepository } from "./decision.js";
import {
  GuildFederationRepository,
  PERSISTED_FEDERATION_EVENT_TYPES,
  hashPersistedFederationJson,
  type PersistedFederationInboundClaim,
} from "./federation.js";
import { GuildOperationsRepository } from "./operations.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const CONTENT_SENTINEL = "FEDERATION-EXPLICIT-CONTENT-NOT-FOR-CHRONICLE";

interface FixtureIds {
  readonly guild: string;
  readonly root: string;
  readonly rootSpace: string;
}

function event(
  guildId: string,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "federation-integration-test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1_000,
      maxTokens: 100_000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

async function fixture(label: string): Promise<FixtureIds> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    rootSpace: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: `${label} Guild`,
      purpose: "Verify production Federation persistence",
      rootIdentityId: ids.root,
      rootDisplayName: `${label} Root`,
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
  });
  return ids;
}

async function createLink(
  ids: FixtureIds,
  direction: "inbound" | "outbound",
  remoteGuildId: string,
  allowedResourceTypes: readonly ("memory" | "activity" | "decision")[] = ["memory"],
): Promise<string> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const id = randomUUID();
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
    await new GuildOperationsRepository(connection, ids.guild).createFederationLink({
      id,
      actorId: ids.root,
      createdByActorId: ids.root,
      remoteGuildId,
      remoteName: `${direction} Remote Guild`,
      endpointUrl: `https://${direction}.guild.example.test/api/federation/v1/deliveries`,
      secretReference: "PURCHASER_FEDERATION_SECRET",
      direction,
      status: "active",
      allowedResourceTypes,
      chronicleEvent: event(ids.guild, ids.root, "federation.link.created", "federation_link", id),
    });
  });
  return id;
}

async function finishInbound(
  ids: FixtureIds,
  linkId: string,
  claim: Extract<PersistedFederationInboundClaim, { state: "accepted" }>,
  deliveryId: string,
  eventType: string,
  payload: JsonObject,
  sourceGuildId: string,
): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
    const federation = new GuildFederationRepository(connection, ids.guild);
    expect(await federation.settleDeliveryLease({
      lease: claim.lease,
      now: new Date().toISOString(),
    })).toBe(true);
    await federation.applyInboundEnvelope({
      sourceGuildId,
      targetGuildId: ids.guild,
      federationLinkId: linkId,
      deliveryId,
      eventType: eventType as Parameters<typeof federation.applyInboundEnvelope>[0]["eventType"],
      payload,
    });
    await new GuildOperationsRepository(connection, ids.guild).finishFederationDelivery({
      id: deliveryId,
      succeeded: true,
      errorMessage: null,
      actorId: ids.root,
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "federation.delivery.completed",
        "federation_delivery",
        deliveryId,
      ),
    });
  });
}

integration("production Federation persistence", () => {
  it("materializes only selected resources, leases durably, and blocks revoked grants", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Federation Outbound");
    const remoteGuildId = randomUUID();
    const linkId = await createLink(
      ids,
      "outbound",
      remoteGuildId,
      ["memory", "activity", "decision"],
    );
    const memoryId = randomUUID();
    const activityId = randomUUID();
    const decisionId = randomUUID();
    const grantId = randomUUID();
    const activityGrantId = randomUUID();
    const decisionGrantId = randomUUID();
    const deliveryId = randomUUID();
    const exhaustedDeliveryId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await new GuildCollectiveRepository(connection, ids.guild).createMemory({
        id: memoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.rootSpace,
        type: "manual",
        title: { en: "Explicit Federation manual" },
        summary: { en: "Selected content only" },
        body: { en: CONTENT_SENTINEL },
        visibility: "restricted",
        classification: "restricted",
        allowedActorIds: [ids.root],
        sourceIds: [],
        confidence: 1,
        changeNote: "Federation fixture",
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", memoryId),
      });
      await new GuildCollectiveRepository(connection, ids.guild).createActivity({
        id: activityId,
        actorId: ids.root,
        parentActivityId: null,
        spaceId: ids.rootSpace,
        ownerActorId: ids.root,
        assigneeActorId: ids.root,
        type: "project",
        title: "Explicit Federation activity",
        description: "Only this selected Activity may cross the link.",
        status: "active",
        visibility: "restricted",
        classification: "restricted",
        allowedActorIds: [ids.root],
        sourceIds: [],
        startsAt: null,
        dueAt: null,
        position: 0,
        chronicleEvent: event(ids.guild, ids.root, "activity.created", "activity", activityId),
      });
      await new GuildDecisionRepository(connection, ids.guild).createDecision({
        id: decisionId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.rootSpace,
        method: "custodian",
        title: "Explicit Federation decision",
        description: "Only this selected Decision aggregate may cross the link.",
        rationale: "Verify the production transport contract.",
        visibility: "restricted",
        classification: "restricted",
        allowedIdentityIds: [ids.root],
        sourceIds: [],
        reviewAt: null,
        options: [
          {
            id: randomUUID(),
            label: "Proceed",
            description: "Approve the explicit transport test.",
            position: 0,
          },
          {
            id: randomUUID(),
            label: "Pause",
            description: "Hold the explicit transport test.",
            position: 1,
          },
        ],
        chronicleEvent: event(ids.guild, ids.root, "decision.created", "decision", decisionId),
      });
      const operations = new GuildOperationsRepository(connection, ids.guild);
      await operations.createFederationGrant({
        id: grantId,
        actorId: ids.root,
        federationLinkId: linkId,
        resourceType: "memory",
        resourceId: memoryId,
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.grant.created",
          "federation_grant",
          grantId,
        ),
      });
      await operations.createFederationGrant({
        id: activityGrantId,
        actorId: ids.root,
        federationLinkId: linkId,
        resourceType: "activity",
        resourceId: activityId,
        permission: "participate",
        grantedByActorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.grant.created",
          "federation_grant",
          activityGrantId,
        ),
      });
      await operations.createFederationGrant({
        id: decisionGrantId,
        actorId: ids.root,
        federationLinkId: linkId,
        resourceType: "decision",
        resourceId: decisionId,
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.grant.created",
          "federation_grant",
          decisionGrantId,
        ),
      });
      await operations.enqueueFederationDelivery({
        id: deliveryId,
        federationLinkId: linkId,
        federationGrantId: grantId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
        payload: {
          grants: [{ grantId }, { grantId: activityGrantId }, { grantId: decisionGrantId }],
        },
        idempotencyKey: `federation:test:${deliveryId}`,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.delivery.enqueued",
          "federation_delivery",
          deliveryId,
        ),
      });
    });

    const claim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildFederationRepository(connection, ids.guild).claimOutboundDelivery({
        workerId: "federation-worker-a",
        systemActorId: ids.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
      }));
    expect(claim.state).toBe("leased");
    if (claim.state !== "leased") throw new Error("Expected an outbound lease.");
    expect(claim.delivery.payload).toMatchObject({
      kind: "resources_published",
      grants: [
        { grantId, resourceType: "memory", resourceId: memoryId },
        { grantId: activityGrantId, resourceType: "activity", resourceId: activityId },
        { grantId: decisionGrantId, resourceType: "decision", resourceId: decisionId },
      ],
    });
    expect(JSON.stringify(claim.delivery.payload)).toContain(CONTENT_SENTINEL);

    const competing = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildFederationRepository(connection, ids.guild).claimOutboundDelivery({
        workerId: "federation-worker-b",
        systemActorId: ids.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
      }));
    expect(competing).toEqual({ state: "idle" });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await new GuildOperationsRepository(connection, ids.guild).enqueueFederationDelivery({
        id: exhaustedDeliveryId,
        federationLinkId: linkId,
        federationGrantId: grantId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
        payload: { grants: [{ grantId }] },
        idempotencyKey: `federation:test:exhausted:${exhaustedDeliveryId}`,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.delivery.enqueued",
          "federation_delivery",
          exhaustedDeliveryId,
        ),
      });
      await connection.query(
        `UPDATE federation_deliveries
            SET status = 'processing', attempt_count = 3, max_attempts = 3,
                lease_token = $3, lease_owner = 'crashed-worker',
                lease_expires_at = now() - interval '1 minute',
                heartbeat_at = now() - interval '2 minutes'
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, exhaustedDeliveryId, randomUUID()],
      );
    });
    const exhausted = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildFederationRepository(
        connection,
        ids.guild,
      ).claimOutboundDelivery({
        workerId: "federation-recovery-worker",
        systemActorId: ids.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
      }),
    );
    expect(exhausted).toEqual({
      state: "terminal",
      deliveryId: exhaustedDeliveryId,
      errorCode: "attempt_limit",
    });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await new GuildOperationsRepository(connection, ids.guild).revokeFederationGrant({
        id: grantId,
        expectedVersion: 1,
        revokedByActorId: ids.root,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.grant.revoked",
          "federation_grant",
          grantId,
        ),
      });
    });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const state = (await connection.query<{ status: string; lease_token: string | null }>(
        `SELECT status, lease_token::text FROM federation_deliveries
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, deliveryId],
      )).rows[0];
      expect(state).toEqual({ status: "rejected", lease_token: null });
      const actor = (await connection.query<{ kind: string }>(
        `SELECT actor.kind FROM federation_links link
          JOIN actors actor ON actor.id = link.remote_actor_id
         WHERE link.guild_id = $1 AND link.id = $2`,
        [ids.guild, linkId],
      )).rows[0];
      expect(actor?.kind).toBe("guild");
      const audit = (await connection.query<{ details: JsonObject }>(
        `SELECT details FROM chronicle_events WHERE guild_id = $1`,
        [ids.guild],
      )).rows;
      expect(JSON.stringify(audit)).not.toContain(CONTENT_SENTINEL);
      expect(JSON.stringify(audit)).not.toContain("PURCHASER_FEDERATION_SECRET");
    });

    const revocationClaim = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildFederationRepository(
        connection,
        ids.guild,
      ).claimOutboundDelivery({
        workerId: "federation-worker-a",
        systemActorId: ids.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
      }),
    );
    expect(revocationClaim.state).toBe("leased");
    if (revocationClaim.state === "leased") {
      expect(revocationClaim.delivery.payload).toMatchObject({ kind: "grants_revoked" });
    }

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await new GuildOperationsRepository(connection, ids.guild).revokeFederationLink({
        id: linkId,
        expectedVersion: 1,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.link.revoked",
          "federation_link",
          linkId,
        ),
      });
    });
    const linkRevocationClaim = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildFederationRepository(
        connection,
        ids.guild,
      ).claimOutboundDelivery({
        workerId: "federation-link-revocation-worker",
        systemActorId: ids.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
      }),
    );
    expect(linkRevocationClaim.state).toBe("leased");
    if (linkRevocationClaim.state === "leased") {
      expect(linkRevocationClaim.delivery.payload).toMatchObject({
        kind: "link_revoked",
        linkVersion: 2,
      });
    }
  });

  it("stores an RLS-scoped projection, deduplicates, tombstones, and applies link revocation", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const target = await fixture("Federation Inbound");
    const other = await fixture("Federation Isolated");
    const sourceGuildId = randomUUID();
    const linkId = await createLink(target, "inbound", sourceGuildId);
    const grantId = randomUUID();
    const resourceId = randomUUID();
    const deliveryId = randomUUID();
    const published: JsonObject = {
      kind: "resources_published",
      grants: [{
        grantId,
        resourceType: "memory",
        resourceId,
        permission: "read",
        grantVersion: 1,
        resourceVersion: 7,
        resource: { id: resourceId, title: { en: "Remote manual" }, body: CONTENT_SENTINEL },
      }],
    };
    const payloadHash = hashPersistedFederationJson(published);
    const fingerprint = "a".repeat(64);

    const claim = await withGuildTransaction(connectionString, target.guild, async (connection) =>
      new GuildFederationRepository(connection, target.guild).claimInboundDelivery({
        workerId: "inbound-worker",
        systemActorId: target.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
        deliveryId,
        federationLinkId: linkId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
        payload: published,
        payloadHash,
        idempotencyKey: `inbound:${deliveryId}`,
        envelopeFingerprint: fingerprint,
        receivedChronicleEvent: event(
          target.guild,
          target.root,
          "federation.delivery.received",
          "federation_delivery",
          deliveryId,
        ),
      }));
    expect(claim.state).toBe("accepted");
    if (claim.state !== "accepted") throw new Error("Expected an inbound lease.");
    await finishInbound(
      target,
      linkId,
      claim,
      deliveryId,
      PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
      published,
      sourceGuildId,
    );

    await withGuildTransaction(connectionString, target.guild, async (connection) => {
      const federation = new GuildFederationRepository(connection, target.guild);
      const projection = await federation.getInboundResource(linkId, grantId);
      expect(projection).toMatchObject({
        status: "active",
        resourceType: "memory",
        resourceId,
        sourceGuildId,
      });
      expect(JSON.stringify(projection?.resource)).toContain(CONTENT_SENTINEL);
      expect(await connection.query(
        "SELECT 1 FROM memories WHERE guild_id = $1 AND id = $2",
        [target.guild, resourceId],
      )).toMatchObject({ rows: [] });
    });

    const duplicate = await withGuildTransaction(connectionString, target.guild, async (connection) =>
      new GuildFederationRepository(connection, target.guild).claimInboundDelivery({
        workerId: "inbound-worker-duplicate",
        systemActorId: target.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
        deliveryId,
        federationLinkId: linkId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
        payload: published,
        payloadHash,
        idempotencyKey: `inbound:${deliveryId}`,
        envelopeFingerprint: fingerprint,
        receivedChronicleEvent: event(
          target.guild,
          target.root,
          "federation.delivery.received",
          "federation_delivery",
          deliveryId,
        ),
      }));
    expect(duplicate).toEqual({ state: "duplicate", lease: null });

    await withGuildTransaction(connectionString, other.guild, async (connection) => {
      expect(await new GuildFederationRepository(
        connection,
        other.guild,
      ).getInboundResource(linkId, grantId)).toBeNull();
    });

    const revocationDeliveryId = randomUUID();
    const revoked: JsonObject = {
      kind: "grants_revoked",
      grants: [{
        grantId,
        resourceType: "memory",
        resourceId,
        permission: "read",
        grantVersion: 2,
        revokedAt: new Date().toISOString(),
      }],
    };
    const revocationClaim = await withGuildTransaction(
      connectionString,
      target.guild,
      async (connection) => new GuildFederationRepository(
        connection,
        target.guild,
      ).claimInboundDelivery({
        workerId: "inbound-revocation-worker",
        systemActorId: target.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
        deliveryId: revocationDeliveryId,
        federationLinkId: linkId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.grantsRevoked,
        payload: revoked,
        payloadHash: hashPersistedFederationJson(revoked),
        idempotencyKey: `inbound:${revocationDeliveryId}`,
        envelopeFingerprint: "b".repeat(64),
        receivedChronicleEvent: event(
          target.guild,
          target.root,
          "federation.delivery.received",
          "federation_delivery",
          revocationDeliveryId,
        ),
      }),
    );
    expect(revocationClaim.state).toBe("accepted");
    if (revocationClaim.state !== "accepted") throw new Error("Expected a revocation lease.");
    await finishInbound(
      target,
      linkId,
      revocationClaim,
      revocationDeliveryId,
      PERSISTED_FEDERATION_EVENT_TYPES.grantsRevoked,
      revoked,
      sourceGuildId,
    );

    await withGuildTransaction(connectionString, target.guild, async (connection) => {
      const federation = new GuildFederationRepository(connection, target.guild);
      expect(await federation.getInboundResource(linkId, grantId)).toMatchObject({
        status: "revoked",
        resource: null,
        resourceHash: null,
      });
      await expect(federation.authorizeInboundPayload({
        federationLinkId: linkId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.resourcesPublished,
        payload: published,
      })).resolves.toBe("revoked");
    });

    const linkRevocationDeliveryId = randomUUID();
    const linkRevocation: JsonObject = {
      kind: "link_revoked",
      linkVersion: 2,
      revokedAt: new Date().toISOString(),
    };
    const linkClaim = await withGuildTransaction(connectionString, target.guild, async (connection) =>
      new GuildFederationRepository(connection, target.guild).claimInboundDelivery({
        workerId: "inbound-link-revocation-worker",
        systemActorId: target.root,
        now: new Date().toISOString(),
        leaseDurationMs: 60_000,
        maxAttempts: 3,
        deliveryId: linkRevocationDeliveryId,
        federationLinkId: linkId,
        eventType: PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked,
        payload: linkRevocation,
        payloadHash: hashPersistedFederationJson(linkRevocation),
        idempotencyKey: `inbound:${linkRevocationDeliveryId}`,
        envelopeFingerprint: "c".repeat(64),
        receivedChronicleEvent: event(
          target.guild,
          target.root,
          "federation.delivery.received",
          "federation_delivery",
          linkRevocationDeliveryId,
        ),
      }));
    expect(linkClaim.state).toBe("accepted");
    if (linkClaim.state !== "accepted") throw new Error("Expected a link revocation lease.");
    await finishInbound(
      target,
      linkId,
      linkClaim,
      linkRevocationDeliveryId,
      PERSISTED_FEDERATION_EVENT_TYPES.linkRevoked,
      linkRevocation,
      sourceGuildId,
    );

    await withGuildTransaction(connectionString, target.guild, async (connection) => {
      const state = (await connection.query<{
        status: string;
        identity_status: string;
        membership_state: string;
      }>(
        `SELECT link.status, identity_row.status AS identity_status,
                membership_row.state AS membership_state
           FROM federation_links link
           JOIN identities identity_row
             ON identity_row.guild_id = link.guild_id AND identity_row.id = link.remote_actor_id
           JOIN memberships membership_row
             ON membership_row.guild_id = link.guild_id
            AND membership_row.identity_id = link.remote_actor_id
          WHERE link.guild_id = $1 AND link.id = $2`,
        [target.guild, linkId],
      )).rows[0];
      expect(state).toEqual({
        status: "revoked",
        identity_status: "disabled",
        membership_state: "departed",
      });
    });
  });
});
