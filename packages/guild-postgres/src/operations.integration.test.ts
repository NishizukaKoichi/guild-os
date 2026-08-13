import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildCollectiveRepository } from "./collective.js";
import { GuildOperationsRepository } from "./operations.js";
import { GuildPostgresRepository } from "./repository.js";
import { CURRENT_GUILD_SCHEMA_MIGRATION } from "./schema.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

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
    details: { source: "operations-integration-test" },
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

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    agent: randomUUID(),
    rootSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Operations Test Guild",
      purpose: "Verify purchaser-owned operations and federation boundaries",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Operator",
        permissions: [
          "guild.read", "memory.read", "memory.create", "activity.read",
          "agent.read", "agent.run", "integration.read", "integration.manage",
        ],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $2, 'agent', 'Operations Agent', 'active')`,
      [ids.agent, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now())`,
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Execute bounded test workflows.', 'test/model', '{}', $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
  });
  return ids;
}

async function createWorkflow(
  ids: Awaited<ReturnType<typeof fixture>>,
  name: string,
): Promise<string> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const workflowId = randomUUID();
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildOperationsRepository(connection, ids.guild).createWorkflowDefinition({
      id: workflowId,
      actorId: ids.root,
      ownerActorId: ids.root,
      spaceId: ids.rootSpace,
      name,
      description: "Durable integration workflow",
      status: "active",
      nodes: [{ id: "start", kind: "input" }, { id: "finish", kind: "output" }],
      edges: [{ from: "start", to: "finish" }],
      allowedActionKinds: ["memory_search", "activity_draft"],
      capabilityPermissions: ["memory.read", "activity.create"],
      visibility: "space",
      classification: "internal",
      allowedActorIds: [],
      maxConcurrentRuns: 2,
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "workflow.created",
        "workflow_definition",
        workflowId,
      ),
    });
  });
  return workflowId;
}

async function createMemory(
  ids: Awaited<ReturnType<typeof fixture>>,
  title: string,
): Promise<string> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const memoryId = randomUUID();
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildCollectiveRepository(connection, ids.guild).createMemory({
      id: memoryId,
      actorId: ids.root,
      ownerActorId: ids.root,
      spaceId: ids.rootSpace,
      type: "document",
      title: { en: title },
      summary: { en: "Explicitly selectable federation fixture." },
      body: { en: "This content is never federated without a specific grant." },
      visibility: "space",
      classification: "internal",
      allowedActorIds: [],
      sourceIds: [],
      confidence: 1,
      changeNote: "Create federation fixture",
      chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", memoryId),
    });
  });
  return memoryId;
}

integration("Guild Operations repository", () => {
  it("replaces immutable Connections and rejects stale or direct configuration mutation", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const connectionId = randomUUID();
    const replacementId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildOperationsRepository(connection, ids.guild);
      const created = await repository.createConnection({
        id: connectionId,
        actorId: ids.root,
        spaceId: ids.rootSpace,
        ownerIdentityId: ids.root,
        name: "Purchaser MCP",
        kind: "mcp",
        capabilityPermissions: ["integration.execute"],
        endpointUrl: "https://mcp.example.test/api",
        secretReference: "PURCHASER_MCP_SECRET",
        visibility: "space",
        classification: "restricted",
        provider: "purchaser",
        configuration: { transport: "streamable-http" },
        authKind: "secret_reference",
        writeRiskLevel: 2,
        chronicleEvent: event(ids.guild, ids.root, "connection.created", "connector", connectionId),
      });
      expect(created.version).toBe(1);
      const replaced = await repository.replaceConnection({
        currentId: connectionId,
        expectedVersion: 1,
        actorId: ids.root,
        replacement: {
          id: replacementId,
          spaceId: ids.rootSpace,
          ownerIdentityId: ids.root,
          name: "Purchaser MCP v2",
          kind: "mcp",
          capabilityPermissions: ["integration.execute"],
          endpointUrl: "https://mcp-v2.example.test/api",
          secretReference: "PURCHASER_MCP_V2_SECRET",
          visibility: "space",
          classification: "restricted",
          provider: "purchaser",
          configuration: { transport: "streamable-http", protocolVersion: "2" },
          authKind: "secret_reference",
          writeRiskLevel: 2,
        },
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "connection.replaced",
          "connector",
          replacementId,
        ),
      });
      expect(replaced.previous.status).toBe("revoked");
      expect(replaced.previous.version).toBe(2);
      expect(replaced.replacement.status).toBe("active");
      expect(replaced.replacement.version).toBe(1);
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).revokeConnection({
        id: replacementId,
        expectedVersion: 2,
        actorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "connection.revoked", "connector", replacementId),
      }))).rejects.toThrow("changed");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `UPDATE connectors
            SET endpoint_url = 'https://tampered.example.test', version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, replacementId],
      ))).rejects.toThrow("immutable");
  });

  it("deduplicates event ingestion and event-triggered durable run requests", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const workflowId = await createWorkflow(ids, "Event workflow");
    const ruleId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildOperationsRepository(connection, ids.guild).createAutomationRule({
        id: ruleId,
        actorId: ids.root,
        workflowId,
        agentActorId: ids.agent,
        createdByActorId: ids.root,
        name: "Activity event trigger",
        triggerKind: "event",
        triggerExpression: "activity.created",
        timezone: "UTC",
        inputTemplate: { source: "event-test" },
        status: "active",
        nextRunAt: null,
        chronicleEvent: event(ids.guild, ids.root, "automation.created", "automation_rule", ruleId),
      });
    });

    const eventId = randomUUID();
    const idempotencyKey = `event-test:${randomUUID()}`;
    const first = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).recordAutomationEvent({
        id: eventId,
        actorId: ids.root,
        eventType: "activity.created",
        sourceActorId: ids.root,
        payload: { activityId: randomUUID(), title: "Inspect evidence" },
        idempotencyKey,
        chronicleEvent: event(ids.guild, ids.root, "automation.event.recorded", "automation_event", eventId),
      }));
    const duplicateEventId = randomUUID();
    const duplicate = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).recordAutomationEvent({
        id: duplicateEventId,
        actorId: ids.root,
        eventType: first.value.eventType,
        sourceActorId: ids.root,
        payload: first.value.payload,
        idempotencyKey,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "automation.event.recorded",
          "automation_event",
          duplicateEventId,
        ),
      }));
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.value.id).toBe(eventId);

    const secondEventId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).recordAutomationEvent({
        id: secondEventId,
        actorId: ids.root,
        eventType: "activity.created",
        sourceActorId: ids.root,
        payload: { activityId: randomUUID(), title: "Second event" },
        idempotencyKey: `event-test:${randomUUID()}`,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "automation.event.recorded",
          "automation_event",
          secondEventId,
        ),
      }));
    let signalEventLocked: (() => void) | undefined;
    let releaseEventLock: (() => void) | undefined;
    const eventLocked = new Promise<void>((resolve) => { signalEventLocked = resolve; });
    const eventRelease = new Promise<void>((resolve) => { releaseEventLock = resolve; });
    const eventBlocker = withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `SELECT id FROM automation_events WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
        [ids.guild, eventId],
      );
      signalEventLocked?.();
      await eventRelease;
    });
    await eventLocked;
    let skippedEvent;
    try {
      skippedEvent = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await connection.query("SET LOCAL statement_timeout = '2s'");
        return new GuildOperationsRepository(connection, ids.guild).claimNextAutomationEvent();
      });
    } finally {
      releaseEventLock?.();
      await eventBlocker;
    }
    expect(skippedEvent?.event.id).toBe(secondEventId);

    const claimed = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).claimNextAutomationEvent());
    expect(claimed?.event.id).toBe(eventId);
    expect(claimed?.event.status).toBe("completed");
    expect(claimed?.createdRequestCount).toBe(1);
    expect(claimed?.requests).toHaveLength(1);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE automation_events SET status = 'pending', processed_at = NULL
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, eventId],
      );
    });
    const replay = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).claimNextAutomationEvent());
    expect(replay?.createdRequestCount).toBe(0);
    expect(replay?.requests).toHaveLength(1);

    const persisted = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workflow_run_requests
          WHERE guild_id = $1 AND trigger_event_id = $2`,
        [ids.guild, eventId],
      ));
    expect(persisted.rows[0]?.count).toBe("1");
  });

  it("skips locked due schedules and persists each schedule claim exactly once", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const workflowId = await createWorkflow(ids, "Schedule workflow");
    const firstRule = randomUUID();
    const secondRule = randomUUID();
    const now = new Date();
    const firstDue = new Date(now.valueOf() - 120_000).toISOString();
    const secondDue = new Date(now.valueOf() - 60_000).toISOString();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildOperationsRepository(connection, ids.guild);
      for (const [id, name, nextRunAt] of [
        [firstRule, "First schedule", firstDue],
        [secondRule, "Second schedule", secondDue],
      ] as const) {
        await repository.createAutomationRule({
          id,
          actorId: ids.root,
          workflowId,
          agentActorId: ids.agent,
          createdByActorId: ids.root,
          name,
          triggerKind: "schedule",
          triggerExpression: "* * * * *",
          status: "active",
          nextRunAt,
          chronicleEvent: event(ids.guild, ids.root, "automation.created", "automation_rule", id),
        });
      }
    });

    let signalLocked: (() => void) | undefined;
    let releaseLock: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `SELECT id FROM automation_rules WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
        [ids.guild, firstRule],
      );
      signalLocked?.();
      await release;
    });
    await locked;
    let skipped;
    try {
      skipped = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await connection.query("SET LOCAL statement_timeout = '2s'");
        return new GuildOperationsRepository(connection, ids.guild).claimDueSchedule({
          now: now.toISOString(),
          nextRunAt: new Date(now.valueOf() + 3_600_000).toISOString(),
        });
      });
    } finally {
      releaseLock?.();
      await blocker;
    }
    expect(skipped?.rule.id).toBe(secondRule);

    const firstClaim = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).claimDueSchedule({
        now: now.toISOString(),
        nextRunAt: new Date(now.valueOf() + 7_200_000).toISOString(),
      }));
    expect(firstClaim?.rule.id).toBe(firstRule);
    expect(firstClaim?.requestCreated).toBe(true);
    const noMore = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).claimDueSchedule({
        now: now.toISOString(),
        nextRunAt: new Date(now.valueOf() + 10_800_000).toISOString(),
      }));
    expect(noMore).toBeNull();

    const durable = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM workflow_run_requests
          WHERE guild_id = $1 AND trigger_kind = 'schedule'
            AND automation_rule_id = ANY($2::uuid[])`,
        [ids.guild, [firstRule, secondRule]],
      ));
    expect(durable.rows[0]?.count).toBe("2");
  });

  it("shares no Federation resource without a valid explicit grant and revokes access permanently", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const sharedMemory = await createMemory(ids, "Selected memory");
    const ambientMemory = await createMemory(ids, "Unselected memory");
    const outboundLink = randomUUID();
    const inboundLink = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildOperationsRepository(connection, ids.guild);
      await repository.createFederationLink({
        id: outboundLink,
        actorId: ids.root,
        remoteGuildId: randomUUID(),
        remoteName: "Outbound Partner",
        endpointUrl: "https://partner.example.test/federation",
        secretReference: "PARTNER_FEDERATION_SECRET",
        direction: "outbound",
        status: "active",
        allowedResourceTypes: ["memory"],
        createdByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.link.created", "federation_link", outboundLink),
      });
      await repository.createFederationLink({
        id: inboundLink,
        actorId: ids.root,
        remoteGuildId: randomUUID(),
        remoteName: "Inbound Partner",
        endpointUrl: "https://inbound.example.test/federation",
        secretReference: "INBOUND_FEDERATION_SECRET",
        direction: "inbound",
        status: "active",
        allowedResourceTypes: ["memory"],
        createdByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.link.created", "federation_link", inboundLink),
      });
      expect(await repository.listFederatedResourceReferences(outboundLink)).toEqual([]);
    });

    const invalidGrantId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).createFederationGrant({
        id: invalidGrantId,
        actorId: ids.root,
        federationLinkId: outboundLink,
        resourceType: "memory",
        resourceId: randomUUID(),
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "federation.grant.created",
          "federation_grant",
          invalidGrantId,
        ),
      }))).rejects.toThrow("does not exist");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const grantId = randomUUID();
      return new GuildOperationsRepository(connection, ids.guild).createFederationGrant({
        id: grantId,
        actorId: ids.root,
        federationLinkId: inboundLink,
        resourceType: "memory",
        resourceId: sharedMemory,
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.grant.created", "federation_grant", grantId),
      });
    })).rejects.toThrow("does not allow outbound");

    const grantId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildOperationsRepository(connection, ids.guild);
      await repository.createFederationGrant({
        id: grantId,
        actorId: ids.root,
        federationLinkId: outboundLink,
        resourceType: "memory",
        resourceId: sharedMemory,
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.grant.created", "federation_grant", grantId),
      });
      const visible = await repository.listFederatedResourceReferences(outboundLink);
      expect(visible.map((item) => item.grant.resourceId)).toEqual([sharedMemory]);
      expect(visible.some((item) => item.grant.resourceId === ambientMemory)).toBe(false);
      await repository.revokeFederationGrant({
        id: grantId,
        expectedVersion: 1,
        actorId: ids.root,
        revokedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.grant.revoked", "federation_grant", grantId),
      });
      expect(await repository.listFederatedResourceReferences(outboundLink)).toEqual([]);
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const replacementId = randomUUID();
      return new GuildOperationsRepository(connection, ids.guild).createFederationGrant({
        id: replacementId,
        actorId: ids.root,
        federationLinkId: outboundLink,
        resourceType: "memory",
        resourceId: sharedMemory,
        permission: "read",
        grantedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "federation.grant.created", "federation_grant", replacementId),
      });
    })).rejects.toThrow();
  });

  it("validates every Model route against its active purchaser-owned provider", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const providerId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildOperationsRepository(connection, ids.guild).createModelProvider({
        id: providerId,
        actorId: ids.root,
        name: "Purchaser Workers AI",
        kind: "workers_ai",
        endpointUrl: null,
        secretReference: null,
        allowedModels: ["@cf/test/primary", "@cf/test/fallback"],
        createdByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "model.provider.created", "model_provider", providerId),
      });
    });

    const routeId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).createModelRoute({
        id: routeId,
        actorId: ids.root,
        purpose: "act",
        providerId,
        primaryModel: "unapproved/model",
        fallbackModel: null,
        maxTokens: 2048,
        updatedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "model.route.created", "model_route", routeId),
      }))).rejects.toThrow("not allowed");

    const created = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).createModelRoute({
        id: routeId,
        actorId: ids.root,
        purpose: "act",
        providerId,
        primaryModel: "@cf/test/primary",
        fallbackModel: null,
        maxTokens: 2048,
        dailyBudgetMinor: 500,
        updatedByActorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "model.route.created", "model_route", routeId),
      }));
    expect(created.version).toBe(1);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).replaceModelRoute({
        id: routeId,
        expectedVersion: 1,
        actorId: ids.root,
        replacement: {
          providerId,
          primaryModel: "@cf/test/primary",
          fallbackModel: "unapproved/fallback",
          maxTokens: 4096,
          updatedByActorId: ids.root,
        },
        chronicleEvent: event(ids.guild, ids.root, "model.route.replaced", "model_route", routeId),
      }))).rejects.toThrow("not allowed");

    const replaced = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).replaceModelRoute({
        id: routeId,
        expectedVersion: 1,
        actorId: ids.root,
        replacement: {
          providerId,
          primaryModel: "@cf/test/primary",
          fallbackModel: "@cf/test/fallback",
          maxTokens: 4096,
          dailyBudgetMinor: 750,
          cacheEnabled: false,
          status: "active",
          updatedByActorId: ids.root,
        },
        chronicleEvent: event(ids.guild, ids.root, "model.route.replaced", "model_route", routeId),
      }));
    expect(replaced.version).toBe(2);
    expect(replaced.fallbackModel).toBe("@cf/test/fallback");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).replaceModelRoute({
        id: routeId,
        expectedVersion: 1,
        actorId: ids.root,
        replacement: {
          providerId,
          primaryModel: "@cf/test/primary",
          fallbackModel: null,
          maxTokens: 1024,
          updatedByActorId: ids.root,
        },
        chronicleEvent: event(ids.guild, ids.root, "model.route.replaced", "model_route", routeId),
      }))).rejects.toThrow("changed");

    const resolved = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).resolveModelRoute("act"));
    expect(resolved.provider.id).toBe(providerId);
    expect(resolved.route.version).toBe(2);

    const inventory = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildOperationsRepository(connection, ids.guild).getGuildDataExportInventory());
    expect(inventory.guild.id).toBe(ids.guild);
    expect(inventory.tables.some((table) => table.tableName === "model_routes" && table.rowCount === "1")).toBe(true);
    expect(inventory.schemaMigrations.at(-1)?.name).toBe(CURRENT_GUILD_SCHEMA_MIGRATION);
  });
});
