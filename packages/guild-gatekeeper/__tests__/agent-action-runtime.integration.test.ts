import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentApprovalRequest,
  AgentRun,
  AgentRunPlan,
  ChronicleEvent,
  Constitution,
  Permission,
  RiskLevel,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildCollectiveRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import { GuildOperationsRepository } from "../../guild-postgres/src/operations.js";
import { GuildAgentActionRuntime } from "../src/agent-action-runtime.js";
import type { GuildEnv } from "../src/config.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function auditEvent(
  guildId: string,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  spaceId: string | null = null,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId,
    ownerIdentityId: actorId,
    visibility: spaceId ? "space" : "guild",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "agent-action-runtime-integration" },
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
      maxBudgetMinor: 100,
      maxTokens: 100_000,
      maxDurationSeconds: 60,
      maxSteps: 10,
      maxRetries: 1,
      maxDelegationDepth: 3,
    },
    principles: "Agents remain bounded by Human authority and explicit grants.",
    publicScope: "",
    membershipPolicy: {
      preboardingRequired: true,
      departureMode: "revoke_then_handover",
    },
    dataPolicy: {
      defaultVisibility: "guild",
      defaultClassification: "internal",
      personalDataOnDeparture: "retain_by_policy",
      crossGuildSharing: "explicit_only",
    },
    agentPolicy: {
      level0Automatic: true,
      level1Automatic: true,
      level2HumanApproval: true,
      level3MultiHumanApproval: true,
    },
    externalSharingPolicy: { enabled: true, requireHumanApproval: true },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    approver: randomUUID(),
    agent: randomUUID(),
    targetAgent: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    humanRole: randomUUID(),
    agentRole: randomUUID(),
    webhookConnector: randomUUID(),
    federationConnector: randomUUID(),
    memory: randomUUID(),
    federationLink: randomUUID(),
    federationGrant: randomUUID(),
  };
  const agentPermissions: Permission[] = [
    "agent.read",
    "agent.run",
    "memory.read",
    "activity.create",
    "integration.read",
    "integration.execute",
    "federation.read",
    "chronicle.read",
  ];
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    const repository = new GuildPostgresRepository(connection, ids.guild);
    await repository.bootstrapGuild({
      guildId: ids.guild,
      name: "Agent Runtime Guild",
      purpose: "Verify every production Agent action adapter",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.humanRole,
        name: "Approver",
        permissions: ["agent.read", "agent.approve", "agent.stop", "chronicle.read"],
      }, {
        id: ids.agentRole,
        name: "Runtime Agent",
        permissions: agentPermissions,
      }],
      chronicleEvent: auditEvent(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Runtime', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $4, 'human', 'Second Approver', 'active'),
              ($2, $4, 'agent', 'Runtime Agent', 'active'),
              ($3, $4, 'agent', 'Delegated Agent', 'active')`,
      [ids.approver, ids.agent, ids.targetAgent, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now()),
              ($1, $3, 'active', 'restricted', now()),
              ($1, $4, 'active', 'restricted', now())`,
      [ids.guild, ids.approver, ids.agent, ids.targetAgent],
    );
    const limits = JSON.stringify(constitution(ids.guild, ids.root).agentDefaults);
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Execute bounded Guild actions.', 'test/model',
               ARRAY['memory_search','activity_draft','agent_delegate','https_webhook','federation_publish'],
               $4::jsonb, 'active'),
              ($1, $3, 'Search only authorized Guild Memory.', 'test/model',
               ARRAY['memory_search'], $4::jsonb, 'active')`,
      [ids.guild, ids.agent, ids.targetAgent, limits],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $5),
              ($9, $2, $10, $8, $5)`,
      [
        randomUUID(), ids.guild, ids.approver, ids.humanRole, ids.teamSpace,
        randomUUID(), ids.agent, ids.agentRole,
        randomUUID(), ids.targetAgent,
      ],
    );
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
    await connection.query(
      `UPDATE constitutions
          SET agent_policy = $3::jsonb, external_sharing_policy = $4::jsonb,
              version = version + 1, updated_by_identity_id = $2, updated_at = now()
        WHERE guild_id = $1`,
      [
        ids.guild,
        ids.root,
        JSON.stringify(constitution(ids.guild, ids.root).agentPolicy),
        JSON.stringify(constitution(ids.guild, ids.root).externalSharingPolicy),
      ],
    );
    await new GuildCollectiveRepository(connection, ids.guild).createMemory({
      id: ids.memory,
      actorId: ids.root,
      spaceId: ids.teamSpace,
      ownerActorId: ids.root,
      type: "research",
      title: { en: "Runtime lighthouse" },
      summary: { en: "Authorized runtime evidence" },
      body: { en: "The runtime lighthouse proves permission-filtered Memory retrieval." },
      visibility: "space",
      classification: "internal",
      allowedActorIds: [],
      sourceIds: [],
      confidence: 1,
      changeNote: "Runtime fixture",
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "memory.created",
        "memory",
        ids.memory,
        ids.teamSpace,
      ),
    });
    const runRepository = new GuildAgentRunRepository(connection, ids.guild);
    await runRepository.ensureDeploymentWebhook({
      id: ids.webhookConnector,
      name: "Runtime webhook",
      endpointUrl: "https://webhook.example.test/guild-events",
      rootOwnerIdentityId: ids.root,
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "connector.provisioned",
        "connector",
        ids.webhookConnector,
        ids.rootSpace,
      ),
    });
    const operations = new GuildOperationsRepository(connection, ids.guild);
    await operations.createConnection({
      id: ids.federationConnector,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.root,
      name: "Federation publisher",
      kind: "api",
      capabilityPermissions: ["federation.read", "integration.execute"],
      endpointUrl: "https://federation.example.test/events",
      secretReference: "FEDERATION_TEST_SECRET",
      visibility: "space",
      classification: "internal",
      description: "Explicit outbound Guild federation",
      provider: "test",
      configuration: { mode: "explicit_grants" },
      authKind: "secret_reference",
      writeRiskLevel: 3,
      actorId: ids.root,
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "connector.created",
        "connector",
        ids.federationConnector,
        ids.teamSpace,
      ),
    });
    await operations.createFederationLink({
      id: ids.federationLink,
      remoteGuildId: randomUUID(),
      remoteName: "Explicit Remote Guild",
      endpointUrl: "https://federation.example.test/inbox",
      secretReference: "FEDERATION_TEST_SECRET",
      direction: "outbound",
      status: "active",
      allowedResourceTypes: ["memory"],
      createdByActorId: ids.root,
      actorId: ids.root,
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "federation.link.created",
        "federation_link",
        ids.federationLink,
      ),
    });
    await operations.createFederationGrant({
      id: ids.federationGrant,
      federationLinkId: ids.federationLink,
      resourceType: "memory",
      resourceId: ids.memory,
      permission: "read",
      grantedByActorId: ids.root,
      actorId: ids.root,
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "federation.grant.created",
        "federation_grant",
        ids.federationGrant,
      ),
    });
  });
  const env = {
    GUILD_ID: ids.guild,
    GUILD_WEBHOOK_CONNECTOR_ID: ids.webhookConnector,
    GUILD_WEBHOOK_URL: "https://webhook.example.test/guild-events",
    GUILD_WEBHOOK_SIGNING_SECRET: "runtime-test-signing-secret-at-least-32-bytes",
    HYPERDRIVE: { connectionString },
  } as unknown as GuildEnv;
  return { ids, env };
}

function runFor(
  ids: Awaited<ReturnType<typeof fixture>>["ids"],
  action: AgentRunPlan["action"],
  riskLevel: RiskLevel,
  connectorId: string | null,
): AgentRun {
  const id = randomUUID();
  const now = new Date().toISOString();
  const delegationDepth = action.kind === "agent_delegate" ? 1 : 0;
  return {
    id,
    guildId: ids.guild,
    spaceId: ids.teamSpace,
    ownerIdentityId: ids.root,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    agentIdentityId: ids.agent,
    requesterIdentityId: ids.root,
    connectorId,
    questId: null,
    riskLevel,
    status: riskLevel <= 1 ? "planning" : "awaiting_approval",
    source: "guild-ui",
    plan: {
      objective: `Execute ${action.kind}`,
      expectedOutcome: `${action.kind} produces one durable governed result.`,
      steps: [`Execute ${action.kind}`],
      connectorId,
      questId: null,
      action,
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 0,
        durationSeconds: 30,
        steps: 1,
        retries: 0,
        delegationDepth,
      },
    },
    result: null,
    errorMessage: null,
    limits: constitution(ids.guild, ids.root).agentDefaults,
    usage: { budgetMinor: 0, tokens: 0, durationSeconds: 0, steps: 0, retries: 0, delegationDepth: 0 },
    workflowInstanceId: `agent-run-${id}`,
    idempotencyKey: `agent-action:${id}`,
    requestHash: "a".repeat(64),
    estimatedBudgetMinor: 0,
    killRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function approvalFor(run: AgentRun): AgentApprovalRequest | null {
  if (run.riskLevel <= 1) return null;
  const now = new Date();
  return {
    id: randomUUID(),
    guildId: run.guildId,
    agentRunId: run.id,
    riskLevel: run.riskLevel,
    actionKind: run.plan.action.kind === "https_webhook"
      ? "https_webhook.post"
      : "federation.publish",
    requiredApprovals: run.riskLevel === 3 ? 2 : 1,
    approvalCount: 0,
    reauthenticationRequired: run.riskLevel === 3,
    status: "pending",
    expiresAt: new Date(now.valueOf() + 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function persistAndApprove(
  ids: Awaited<ReturnType<typeof fixture>>["ids"],
  run: AgentRun,
): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const approval = approvalFor(run);
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
    await new GuildAgentRunRepository(connection, ids.guild).createRun({
      run,
      approval,
      chronicleEvent: auditEvent(
        ids.guild,
        ids.root,
        "agent.run.planned",
        "agent_run",
        run.id,
        ids.teamSpace,
      ),
    });
  });
  if (!approval) return;
  const voters = run.riskLevel === 3 ? [ids.root, ids.approver] : [ids.root];
  for (const voter of voters) {
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [voter]);
      await new GuildAgentRunRepository(connection, ids.guild).review({
        runId: run.id,
        approvalRequestId: approval.id,
        approverIdentityId: voter,
        verdict: "approve",
        reason: "Current authority, scope, and action payload were verified.",
        reauthenticatedAt: run.riskLevel === 3 ? new Date().toISOString() : null,
        chronicleEvent: auditEvent(
          ids.guild,
          voter,
          "agent.run.approved",
          "agent_run",
          run.id,
          ids.teamSpace,
        ),
      });
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

integration("production Agent action runtime", () => {
  it("executes and durably records all five governed action kinds", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env } = await fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
    const runtime = new GuildAgentActionRuntime(env, ids.guild);
    const runs = [
      runFor(ids, { kind: "memory_search", query: "runtime lighthouse", locale: "en" }, 0, null),
      runFor(ids, {
        kind: "activity_draft",
        title: "Review runtime evidence",
        description: "A reversible draft created by the governed Runtime Agent.",
        activityType: "task",
      }, 1, null),
      runFor(ids, {
        kind: "agent_delegate",
        targetAgentActorId: ids.targetAgent,
        objective: "Find the runtime lighthouse evidence",
      }, 1, null),
      runFor(ids, {
        kind: "https_webhook",
        eventType: "guild.runtime.verified",
        payload: { verified: true },
      }, 2, ids.webhookConnector),
      runFor(ids, {
        kind: "federation_publish",
        federationLinkId: ids.federationLink,
        grantIds: [ids.federationGrant],
      }, 3, ids.federationConnector),
    ] as const;

    for (const run of runs) {
      await persistAndApprove(ids, run);
      const result = await runtime.execute(run.id, run.workflowInstanceId);
      expect(result.status).toBe("succeeded");
      expect(result.result.kind).toBe(run.plan.action.kind);
    }

    const details = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      const loaded = [];
      for (const run of runs) loaded.push(await repository.getRunDetail(run.id));
      return loaded;
    });
    expect(details.map((detail) => detail.actionKind)).toEqual([
      "memory.search",
      "activity.draft",
      "agent.delegate",
      "https_webhook.post",
      "federation.publish",
    ]);
    expect(details.every((detail) => detail.status === "succeeded")).toBe(true);
    expect(details.map((detail) => detail.workflowPermissions)).toEqual([
      ["memory.read"],
      ["activity.create"],
      ["agent.run"],
      ["integration.execute"],
      ["federation.read", "integration.execute"],
    ]);
    expect(details.map((detail) => detail.connectorPermissionsSnapshot)).toEqual([
      ["memory.read"],
      ["activity.create"],
      ["agent.run"],
      ["integration.execute"],
      ["federation.read", "integration.execute"],
    ]);
    expect(details[0]?.result).toMatchObject({ kind: "memory_search", memoryIds: [ids.memory] });
    expect(details[1]?.result).toMatchObject({ kind: "activity_draft" });
    expect(details[2]?.result).toMatchObject({ kind: "agent_delegate" });
    expect(details[3]?.result).toMatchObject({ kind: "https_webhook", statusCode: 202 });
    expect(details[4]?.result).toMatchObject({ kind: "federation_publish" });
    expect(details[0]?.approval).toBeNull();
    expect(details[1]?.approval).toBeNull();
    expect(details[3]?.approval?.status).toBe("applied");
    expect(details[4]?.approval).toMatchObject({ status: "applied", approvalCount: 2 });

    const persisted = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const activity = (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM activities
          WHERE guild_id = $1 AND title = 'Review runtime evidence' AND status = 'proposed'`,
        [ids.guild],
      )).rows[0]?.count;
      const delegation = (await connection.query<{
        child_run_id: string;
        depth: number;
        status: string;
      }>(
        `SELECT child_run_id::text, depth, status FROM agent_delegations
          WHERE guild_id = $1 AND parent_run_id = $2`,
        [ids.guild, runs[2].id],
      )).rows[0];
      const deliveries = (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM federation_deliveries
          WHERE guild_id = $1 AND federation_link_id = $2 AND direction = 'outbound'`,
        [ids.guild, ids.federationLink],
      )).rows[0]?.count;
      const idempotency = (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox
          WHERE guild_id = $1 AND topic = 'agent.action.idempotency' AND status = 'completed'`,
        [ids.guild],
      )).rows[0]?.count;
      return { activity, delegation, deliveries, idempotency };
    });
    expect(persisted.activity).toBe("1");
    expect(persisted.delegation).toMatchObject({ depth: 1, status: "running" });
    expect(persisted.delegation?.child_run_id).toBe(
      (details[2]?.result as Extract<NonNullable<AgentRun["result"]>, { kind: "agent_delegate" }>).childRunId,
    );
    expect(persisted.deliveries).toBe("1");
    expect(persisted.idempotency).toBe("2");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a Memory result or Federation grant is outside current authority", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env } = await fixture();
    const runtime = new GuildAgentActionRuntime(env, ids.guild);
    const run = runFor(ids, {
      kind: "federation_publish",
      federationLinkId: ids.federationLink,
      grantIds: [randomUUID()],
    }, 3, ids.federationConnector);
    await persistAndApprove(ids, run);
    await expect(runtime.execute(run.id, run.workflowInstanceId))
      .rejects.toThrow(/inactive or implicit grant/i);
    const deliveryCount = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM federation_deliveries WHERE guild_id = $1",
        [ids.guild],
      )).rows[0]?.count);
    expect(deliveryCount).toBe("0");
  });

  it("uses the durable external-action claim to prevent duplicate Webhook delivery", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env } = await fixture();
    let releaseDelivery: (() => void) | undefined;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const fetcher = vi.fn(async () => {
      await deliveryGate;
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal("fetch", fetcher);
    const run = runFor(ids, {
      kind: "https_webhook",
      eventType: "guild.runtime.idempotency",
      payload: { once: true },
    }, 2, ids.webhookConnector);
    await persistAndApprove(ids, run);
    const runtime = new GuildAgentActionRuntime(env, ids.guild);
    const first = runtime.execute(run.id, run.workflowInstanceId);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const duplicate = runtime.execute(run.id, run.workflowInstanceId);
    releaseDelivery?.();
    const outcomes = await Promise.allSettled([first, duplicate]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const detail = await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).getRunDetail(run.id));
    expect(detail).toMatchObject({
      status: "succeeded",
      result: { kind: "https_webhook", statusCode: 202 },
    });
    const claimCount = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM outbox
          WHERE guild_id = $1 AND topic = 'agent.action.idempotency'`,
        [ids.guild],
      )).rows[0]?.count);
    expect(claimCount).toBe("1");
  });
});
