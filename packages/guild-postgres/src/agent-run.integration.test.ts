import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AgentApprovalRequest,
  AgentRun,
  ChronicleEvent,
  Constitution,
} from "@guild-os/domain";
import { GuildAdministrationRepository } from "./administration.js";
import { GuildAgentRunRepository } from "./agent-run.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  spaceId: string | null = null,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId,
    ownerIdentityId: actorIdentityId,
    visibility: spaceId ? "space" : "guild",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "agent-run-integration-test" },
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
      maxSteps: 5,
      maxRetries: 1,
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
    member: randomUUID(),
    deniedMember: randomUUID(),
    agent: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    deniedSpace: randomUUID(),
    humanRole: randomUUID(),
    agentRole: randomUUID(),
    connector: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    const repository = new GuildPostgresRepository(connection, ids.guild);
    await repository.bootstrapGuild({
      guildId: ids.guild,
      name: "Agent Execution Guild",
      purpose: "Verify governed durable Agent execution",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.humanRole,
        name: "Operator",
        permissions: [
          "agent.read",
          "agent.run",
          "agent.approve",
          "agent.stop",
          "integration.read",
          "integration.execute",
          "inbox.read",
          "chronicle.read",
        ],
      }, {
        id: ids.agentRole,
        name: "Webhook Agent",
        permissions: ["agent.read", "integration.read", "integration.execute"],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $3, $4, 'Team', 'active'), ($2, $3, $4, 'Denied', 'active')`,
      [ids.teamSpace, ids.deniedSpace, ids.guild, ids.rootSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $4, 'human', 'Member', 'active'),
              ($2, $4, 'human', 'Denied Member', 'active'),
              ($3, $4, 'agent', 'Webhook Agent', 'active')`,
      [ids.member, ids.deniedMember, ids.agent, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now())`,
      [ids.guild, ids.member, ids.deniedMember, ids.agent],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Send only approved signed webhook events.', 'test/model',
               ARRAY['https_webhook'], $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $4, $8),
              ($9, $2, $10, $11, $5)`,
      [
        randomUUID(), ids.guild, ids.member, ids.humanRole, ids.teamSpace,
        randomUUID(), ids.deniedMember, ids.deniedSpace,
        randomUUID(), ids.agent, ids.agentRole,
      ],
    );
    await new GuildAgentRunRepository(connection, ids.guild).ensureDeploymentWebhook({
      id: ids.connector,
      name: "Operations webhook",
      endpointUrl: "https://webhook.example.com/guild-events",
      rootOwnerIdentityId: ids.root,
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "connector.provisioned",
        "connector",
        ids.connector,
        ids.rootSpace,
      ),
    });
  });
  return ids;
}

function run(ids: Awaited<ReturnType<typeof fixture>>): AgentRun {
  const id = randomUUID();
  const now = new Date().toISOString();
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
    connectorId: ids.connector,
    questId: null,
    riskLevel: 2,
    status: "awaiting_approval",
    source: "guild-ui",
    plan: {
      objective: "Publish the approved completion event",
      expectedOutcome: "The purchaser endpoint accepts one signed event.",
      steps: ["Verify current authority", "Send the signed event"],
      connectorId: ids.connector,
      questId: null,
      action: {
        kind: "https_webhook",
        eventType: "guild.quest.completed",
        payload: { questId: randomUUID(), completed: true },
      },
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 0,
        durationSeconds: 10,
        steps: 2,
        retries: 0,
        delegationDepth: 0,
      },
    },
    result: null,
    errorMessage: null,
    limits: constitution(ids.guild, ids.root).agentDefaults,
    usage: {
      budgetMinor: 0,
      tokens: 0,
      durationSeconds: 0,
      steps: 0,
      retries: 0,
      delegationDepth: 0,
    },
    workflowInstanceId: `guild-run-${id}`,
    idempotencyKey: `guild-run:${id}`,
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

function approval(ids: Awaited<ReturnType<typeof fixture>>, candidate: AgentRun): AgentApprovalRequest {
  const now = new Date();
  return {
    id: randomUUID(),
    guildId: ids.guild,
    agentRunId: candidate.id,
    riskLevel: 2,
    actionKind: "https_webhook.post",
    requiredApprovals: 1,
    approvalCount: 0,
    reauthenticationRequired: false,
    status: "pending",
    expiresAt: new Date(now.valueOf() + 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

integration("Guild Agent run repository", () => {
  it("enforces token limits in persisted Agent profiles and usage", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    await expect(withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query(
        `UPDATE agent_profiles
            SET limits = jsonb_set(limits, '{maxTokens}', '0'::jsonb)
          WHERE guild_id = $1 AND identity_id = $2`,
        [ids.guild, ids.agent],
      ))).rejects.toThrow("agent_profiles_limits_valid");

    const result = await withGuildTransaction(connectionString, ids.guild, (connection) =>
      connection.query<{ permitted: boolean }>(
        `SELECT guild_runtime.agent_usage_within_limits(
           $1::jsonb,
           $2::jsonb
         ) AS permitted`,
        [
          JSON.stringify(constitution(ids.guild, ids.root).agentDefaults),
          JSON.stringify({
            budgetMinor: 0,
            tokens: 100_001,
            durationSeconds: 1,
            steps: 1,
            retries: 0,
            delegationDepth: 0,
          }),
        ],
      ));
    expect(result.rows[0]?.permitted).toBe(false);
  });

  it("plans, approves, dispatches, completes, filters, and audits one idempotent external write", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const candidate = run(ids);
    const request = approval(ids, candidate);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      expect(await repository.createRun({
        run: candidate,
        approval: request,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "agent.run.planned",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      })).toBe(true);
      expect(await repository.createRun({
        run: candidate,
        approval: request,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "agent.run.planned",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      })).toBe(false);
    });

    const visibility = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      return {
        root: await repository.listRuns(ids.root),
        member: await repository.listRuns(ids.member),
        denied: await repository.listRuns(ids.deniedMember),
      };
    });
    expect(visibility.root.items.map((item) => item.id)).toEqual([candidate.id]);
    expect(visibility.member.items.map((item) => item.id)).toEqual([candidate.id]);
    expect(visibility.denied.items).toEqual([]);

    const outcome = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).review({
        runId: candidate.id,
        approvalRequestId: request.id,
        approverIdentityId: ids.root,
        verdict: "approve",
        reason: "Payload and target are within the approved scope.",
        reauthenticatedAt: null,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "agent.run.approved",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      }));
    expect(outcome).toMatchObject({ approvalStatus: "approved", approvalCount: 1 });

    const topics: string[] = [];
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      for (;;) {
        const message = await repository.claimWorkflowMessage();
        if (!message) break;
        topics.push(message.topic);
        await repository.completeWorkflowMessage(message.outboxId);
      }
    });
    expect(topics).toEqual(["agent.workflow.start", "agent.workflow.signal"]);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      await repository.claimExecution(candidate.id, candidate.workflowInstanceId);
      await repository.completeExecution(
        candidate.id,
        candidate.workflowInstanceId,
        { kind: "https_webhook", statusCode: 202, deliveredAt: new Date().toISOString() },
        { budgetMinor: 0, tokens: 0, durationSeconds: 1, steps: 2, retries: 0, delegationDepth: 0 },
        event(
          ids.guild,
          ids.agent,
          "agent.run.succeeded",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      );
    });

    const detail = await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).getRunDetail(candidate.id));
    expect(detail).toMatchObject({
      status: "succeeded",
      result: { kind: "https_webhook", statusCode: 202 },
      approval: { status: "applied", approvalCount: 1 },
    });
    expect(detail.votes).toHaveLength(1);

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      "UPDATE approval_votes SET reason = 'tampered' WHERE guild_id = $1 AND approval_request_id = $2",
      [ids.guild, request.id],
    ))).rejects.toThrow("append-only");

    const actions = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2 ORDER BY sequence`,
        [ids.guild, candidate.id],
      )).rows.map((row) => row.action));
    expect(actions).toEqual(["agent.run.planned", "agent.run.approved", "agent.run.succeeded"]);
  });

  it("rejects unauthorized direct approval and terminates unfinished runs through the kill switch", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture();
    const candidate = run(ids);
    const request = approval(ids, candidate);
    await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).createRun({
        run: candidate,
        approval: request,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "agent.run.planned",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      }));

    await expect(withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      `INSERT INTO approval_votes
         (guild_id, approval_request_id, approver_identity_id, verdict, reason)
       VALUES ($1, $2, $3, 'approve', 'Attempted cross-Space approval')`,
      [ids.guild, request.id, ids.deniedMember],
    ))).rejects.toThrow("authorized active Human");

    await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).killRun(
        candidate.id,
        ids.root,
        event(
          ids.guild,
          ids.root,
          "agent.run.killed",
          "agent_run",
          candidate.id,
          ids.teamSpace,
        ),
      ));
    const killed = await withGuildTransaction(connectionString, ids.guild, (connection) =>
      new GuildAgentRunRepository(connection, ids.guild).getRun(candidate.id));
    expect(killed).toMatchObject({ status: "killed" });
    expect(killed.killRequestedAt).not.toBeNull();
  });
});
