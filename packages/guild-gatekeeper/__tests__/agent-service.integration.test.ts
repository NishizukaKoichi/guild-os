import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildDirectoryRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import { GuildAgentService } from "../src/agent-service.js";
import { drainAgentWorkflowOutbox } from "../src/agent-dispatch.js";
import { deliverSignedWebhook } from "../src/agent-webhook.js";
import type { GuildEnv } from "../src/config.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function chronicle(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorIdentityId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "agent-service-integration-test" },
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
      maxBudgetMinor: 0,
      maxDurationSeconds: 60,
      maxSteps: 5,
      maxRetries: 0,
      maxDelegationDepth: 0,
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
    teamSpace: randomUUID(),
    agentRole: randomUUID(),
    connector: randomUUID(),
  };
  const endpointUrl = "https://hooks.example.com/guild-events";
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Agent Service Guild",
      purpose: "Exercise the complete governed external-write path.",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.agentRole,
        name: "Webhook Agent",
        permissions: ["agent.read", "integration.read", "integration.execute"],
      }],
      chronicleEvent: chronicle(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      "INSERT INTO spaces (id, guild_id, parent_space_id, name, status) VALUES ($1, $2, $3, 'Team', 'active')",
      [ids.teamSpace, ids.guild, ids.rootSpace],
    );
    await connection.query(
      "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'agent', 'Webhook Agent', 'active')",
      [ids.agent, ids.guild],
    );
    await connection.query(
      "INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES ($1, $2, 'active', 'internal', now())",
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Send only approved signed Webhook events.', 'test/model',
               ARRAY['https_webhook'], $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
    await connection.query(
      "INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), ids.guild, ids.agent, ids.agentRole, ids.teamSpace],
    );
    await new GuildAgentRunRepository(connection, ids.guild).ensureDeploymentWebhook({
      id: ids.connector,
      name: "Approved operations webhook",
      endpointUrl,
      rootOwnerIdentityId: ids.root,
      chronicleEvent: chronicle(
        ids.guild,
        ids.root,
        "connector.provisioned",
        "connector",
        ids.connector,
      ),
    });
  });
  const env = {
    GUILD_ID: ids.guild,
    GUILD_WEBHOOK_CONNECTOR_ID: ids.connector,
    GUILD_WEBHOOK_CONNECTOR_NAME: "Approved operations webhook",
    GUILD_WEBHOOK_URL: endpointUrl,
    GUILD_WEBHOOK_SIGNING_SECRET: "integration-test-signing-secret-32-characters",
    HYPERDRIVE: { connectionString },
  } as unknown as GuildEnv;
  return { ids, env };
}

function request(ids: Awaited<ReturnType<typeof fixture>>["ids"]) {
  return {
    requestId: randomUUID(),
    agentIdentityId: ids.agent,
    connectorId: ids.connector,
    questId: null,
    spaceId: ids.teamSpace,
    objective: "Publish an approved completion event",
    expectedOutcome: "One signed event is accepted by the configured endpoint.",
    steps: ["Recheck authority", "Send one signed Webhook"],
    eventType: "guild.quest.completed",
    payload: { completed: true, fixture: "agent-service" },
    estimatedUsage: {
      budgetMinor: 0,
      durationSeconds: 10,
      steps: 2,
      retries: 0,
      delegationDepth: 0,
    },
    visibility: "space" as const,
    classification: "internal" as const,
    allowedIdentityIds: [],
  };
}

integration("Guild Agent service", () => {
  it("plans, approves, claims once, signs, completes, and exposes the audited result", async () => {
    const { ids, env } = await fixture();
    const service = new GuildAgentService(env, ids.root);
    const context = await service.getExecutionContext();
    expect(context.spaces).toEqual(expect.arrayContaining([{ id: ids.teamSpace, name: "Team", parentSpaceId: ids.rootSpace }]));
    expect(context.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ identityId: ids.agent, spaceIds: [ids.teamSpace] }),
    ]));
    expect(context.connectors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.connector, kind: "https_webhook" }),
    ]));
    const input = request(ids);
    await expect(service.createRun(input)).resolves.toBe(input.requestId);
    await expect(service.createRun(input)).resolves.toBe(input.requestId);

    const planned = await service.getRun(input.requestId);
    expect(planned).toMatchObject({
      status: "awaiting_approval",
      approval: { status: "pending", requiredApprovals: 1 },
      capabilities: { review: true, stop: true },
    });
    await service.review({
      runId: input.requestId,
      approvalRequestId: planned.approval!.id,
      verdict: "approve",
      reason: "The target and payload are approved for this test.",
      reauthenticatedAt: null,
    });
    const claim = await service.claimExecution(
      input.requestId,
      `agent-run-${input.requestId}`,
    );
    await expect(service.claimExecution(
      input.requestId,
      `agent-run-${input.requestId}`,
    )).rejects.toThrow("duplicate delivery is refused");

    let requestCount = 0;
    const delivery = await deliverSignedWebhook(
      claim.endpointUrl,
      env.GUILD_WEBHOOK_SIGNING_SECRET,
      claim,
      async (_url, init) => {
        requestCount += 1;
        expect(new Headers(init?.headers).get("idempotency-key")).toBe(claim.idempotencyKey);
        return new Response(null, { status: 204 });
      },
    );
    expect(requestCount).toBe(1);
    await service.completeExecution(
      input.requestId,
      `agent-run-${input.requestId}`,
      { kind: "https_webhook", statusCode: 204, deliveredAt: delivery.deliveredAt },
      { budgetMinor: 0, durationSeconds: 1, steps: 2, retries: 0, delegationDepth: 0 },
    );
    const completed = await service.getRun(input.requestId);
    expect(completed).toMatchObject({
      status: "succeeded",
      result: { kind: "https_webhook", statusCode: 204 },
      approval: { status: "applied", approvalCount: 1 },
      capabilities: { review: false, stop: false },
    });
    expect(completed.votes).toHaveLength(1);
  });

  it("rechecks a stopped Agent before delivery and supports an authorized Kill Switch", async () => {
    const { ids, env } = await fixture();
    const service = new GuildAgentService(env, ids.root);
    const stoppedInput = request(ids);
    await service.createRun(stoppedInput);
    const stopped = await service.getRun(stoppedInput.requestId);
    await service.review({
      runId: stopped.id,
      approvalRequestId: stopped.approval!.id,
      verdict: "approve",
      reason: "Approved before the Agent is stopped.",
      reauthenticatedAt: null,
    });
    await withGuildTransaction(connectionString!, ids.guild, (connection) => connection.query(
      "UPDATE agent_profiles SET status = 'stopped' WHERE guild_id = $1 AND identity_id = $2",
      [ids.guild, ids.agent],
    ));
    await expect(service.claimExecution(
      stopped.id,
      `agent-run-${stopped.id}`,
    )).rejects.toThrow(/stopped/i);

    await withGuildTransaction(connectionString!, ids.guild, (connection) => connection.query(
      "UPDATE agent_profiles SET status = 'active' WHERE guild_id = $1 AND identity_id = $2",
      [ids.guild, ids.agent],
    ));
    const killedInput = request(ids);
    await service.createRun(killedInput);
    await service.kill(killedInput.requestId);
    const killed = await service.getRun(killedInput.requestId);
    expect(killed).toMatchObject({ status: "killed", capabilities: { stop: false } });
    expect(killed.killRequestedAt).not.toBeNull();
  });

  it("kills active runs, expires pending approval, and queues termination on offboarding", async () => {
    const { ids, env } = await fixture();
    const service = new GuildAgentService(env, ids.root);
    const input = request(ids);
    await service.createRun(input);

    await withGuildTransaction(connectionString!, ids.guild, async (connection) => {
      await new GuildDirectoryRepository(connection, ids.guild).changeMembership({
        actorIdentityId: ids.root,
        identityId: ids.agent,
        nextState: "suspended",
        chronicleEvent: chronicle(
          ids.guild,
          ids.root,
          "agent.suspended",
          "identity",
          ids.agent,
        ),
      });
    });

    const state = await withGuildTransaction(connectionString!, ids.guild, async (connection) => {
      const run = await new GuildAgentRunRepository(connection, ids.guild).getRun(input.requestId);
      const outbox = await connection.query<{ topic: string; status: string }>(
        `SELECT topic, status FROM outbox
          WHERE guild_id = $1 AND payload ->> 'runId' = $2 ORDER BY created_at, topic`,
        [ids.guild, input.requestId],
      );
      const events = await connection.query<{ action: string; details: Record<string, unknown> }>(
        `SELECT action, details FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'agent_run' AND subject_id = $2
          ORDER BY sequence`,
        [ids.guild, input.requestId],
      );
      return { run, outbox: outbox.rows, events: events.rows };
    });

    expect(state.run).toMatchObject({
      status: "killed",
      approval: { status: "expired" },
    });
    expect(state.run.killRequestedAt).not.toBeNull();
    expect(state.outbox).toEqual(expect.arrayContaining([
      { topic: "agent.workflow.start", status: "cancelled" },
      { topic: "agent.workflow.terminate", status: "pending" },
    ]));
    expect(state.events.at(-1)).toMatchObject({
      action: "agent.run.killed",
      details: { source: "identity-lifecycle", identityId: ids.agent },
    });
  });

  it("fails the run durably when Workflow dispatch exhausts its retry limit", async () => {
    const { ids, env } = await fixture();
    const service = new GuildAgentService(env, ids.root);
    const input = request(ids);
    await service.createRun(input);
    await withGuildTransaction(connectionString!, ids.guild, (connection) => connection.query(
      `UPDATE outbox SET attempt_count = 9, available_at = now()
        WHERE guild_id = $1 AND topic = 'agent.workflow.start' AND payload ->> 'runId' = $2`,
      [ids.guild, input.requestId],
    ));
    const dispatchEnv = {
      ...env,
      AGENT_EXECUTION: {
        async create() {
          throw new Error("Simulated Workflow API outage.");
        },
        async get() {
          return { async status() { return { status: "errored" }; } };
        },
      },
    } as unknown as GuildEnv;

    await expect(drainAgentWorkflowOutbox(dispatchEnv)).resolves.toBe(0);
    const failed = await service.getRun(input.requestId);
    expect(failed).toMatchObject({
      status: "failed",
      approval: { status: "expired" },
      errorMessage: "Agent Workflow dispatch failed before execution could be completed.",
    });
    const audit = await withGuildTransaction(connectionString!, ids.guild, async (connection) => ({
      outbox: (await connection.query<{ status: string; attempt_count: number }>(
        `SELECT status, attempt_count FROM outbox
          WHERE guild_id = $1 AND topic = 'agent.workflow.start' AND payload ->> 'runId' = $2`,
        [ids.guild, input.requestId],
      )).rows[0],
      event: (await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'agent_run' AND subject_id = $2
          ORDER BY sequence DESC LIMIT 1`,
        [ids.guild, input.requestId],
      )).rows[0],
    }));
    expect(audit).toEqual({
      outbox: { status: "failed", attempt_count: 10 },
      event: { action: "agent.run.dispatch_failed" },
    });
  });

  it("keeps a killed run terminal while auditing a delivery that won the HTTP race", async () => {
    const { ids, env } = await fixture();
    const service = new GuildAgentService(env, ids.root);
    const input = request(ids);
    await service.createRun(input);
    const planned = await service.getRun(input.requestId);
    await service.review({
      runId: input.requestId,
      approvalRequestId: planned.approval!.id,
      verdict: "approve",
      reason: "Approve the controlled race test.",
      reauthenticatedAt: null,
    });
    await service.claimExecution(input.requestId, `agent-run-${input.requestId}`);
    await service.kill(input.requestId);
    const result = { kind: "https_webhook" as const, statusCode: 202, deliveredAt: new Date().toISOString() };
    const usage = { budgetMinor: 0, durationSeconds: 1, steps: 2, retries: 0, delegationDepth: 0 };

    await expect(service.completeExecution(
      input.requestId,
      `agent-run-${input.requestId}`,
      result,
      usage,
    )).resolves.toBe("killed");
    await expect(service.completeExecution(
      input.requestId,
      `agent-run-${input.requestId}`,
      result,
      usage,
    )).resolves.toBe("killed");

    const audit = await withGuildTransaction(connectionString!, ids.guild, async (connection) => ({
      run: await new GuildAgentRunRepository(connection, ids.guild).getRun(input.requestId),
      lateEvents: Number((await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'agent_run' AND subject_id = $2
            AND action = 'agent.run.delivery_after_kill'`,
        [ids.guild, input.requestId],
      )).rows[0]?.count ?? "0"),
    }));
    expect(audit.run.status).toBe("killed");
    expect(audit.run.result).toBeNull();
    expect(audit.lateEvents).toBe(1);
  });
});
