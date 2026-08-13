import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentRun, ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildAgentRunRepository } from "./agent-run.js";
import {
  GuildIntentRepository,
  type CreateIntentProposalInput,
  type IntentActionInput,
} from "./intent.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function event(
  guildId: string,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  spaceId: string | null,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId,
    ownerIdentityId: actorId,
    visibility: spaceId === null ? "guild" : "space",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "intent-integration-test" },
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
      maxDurationSeconds: 300,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

interface FixtureIds {
  guild: string;
  root: string;
  member: string;
  otherMember: string;
  agent: string;
  rootSpace: string;
  role: string;
}

async function fixture(label = "Intent"): Promise<FixtureIds> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids: FixtureIds = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    otherMember: randomUUID(),
    agent: randomUUID(),
    rootSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: `${label} Guild`,
      purpose: "Verify durable Plan and Act execution",
      rootIdentityId: ids.root,
      rootDisplayName: `${label} Root`,
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Planner",
        permissions: [
          "guild.manage",
          "memory.create",
          "activity.create",
          "activity.assign",
          "decision.propose",
          "agent.run",
        ],
      }],
      chronicleEvent: event(
        ids.guild,
        ids.root,
        "guild.initialized",
        "guild",
        ids.guild,
        null,
      ),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $4, 'human', 'Planner One', 'active'),
              ($2, $4, 'human', 'Planner Two', 'active'),
              ($3, $4, 'agent', 'Plan Agent', 'active')`,
      [ids.member, ids.otherMember, ids.agent, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now())`,
      [ids.guild, ids.member, ids.otherMember, ids.agent],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Execute only the immutable approved Plan.', 'test/model', '{}',
               $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
  });
  return ids;
}

function memoryAction(ids: FixtureIds, label = "Draft handbook"): IntentActionInput {
  return {
    kind: "memory.propose",
    riskLevel: 1,
    action: {
      memoryId: randomUUID(),
      spaceId: ids.rootSpace,
      request: { title: label, body: "A bounded draft generated from the Plan." },
    },
  };
}

function activityAction(ids: FixtureIds, label = "Review handbook"): IntentActionInput {
  return {
    kind: "activity.create",
    riskLevel: 1,
    action: {
      activityId: randomUUID(),
      spaceId: ids.rootSpace,
      request: { title: label, description: "Review the proposed Memory." },
    },
  };
}

function proposalInput(
  ids: FixtureIds,
  options: {
    id?: string;
    actorId?: string;
    objective?: string;
    requestHash?: string;
    expiresAt?: string;
    actions?: readonly IntentActionInput[];
  } = {},
): CreateIntentProposalInput {
  const id = options.id ?? randomUUID();
  const actorId = options.actorId ?? ids.root;
  const objective = options.objective ?? "Create and review one durable operating handbook";
  return {
    id,
    createdByActorId: actorId,
    spaceId: ids.rootSpace,
    locale: "en",
    objective,
    evidence: [{
      sourceType: "memory",
      sourceId: randomUUID(),
      label: "Current handbook",
      metadata: { version: 1 },
    }],
    authorizationSnapshot: {
      actorId,
      permissions: ["memory.create", "activity.create", "agent.run"],
      spaceIds: [ids.rootSpace],
      constitutionVersion: 1,
      capturedAt: new Date().toISOString(),
    },
    requestHash: options.requestHash ?? hash(`${id}:${objective}`),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
    actions: options.actions ?? [memoryAction(ids), activityAction(ids)],
    chronicleEvent: event(
      ids.guild,
      actorId,
      "intent.proposal.created",
      "intent_proposal",
      id,
      ids.rootSpace,
    ),
  };
}

async function createProposal(
  ids: FixtureIds,
  input: CreateIntentProposalInput,
): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    const result = await new GuildIntentRepository(connection, ids.guild).createProposal(input);
    expect(result.created).toBe(true);
  });
}

function proposalMutationEvent(
  ids: FixtureIds,
  proposalId: string,
  actorId: string,
  action: string,
): ChronicleEvent {
  return event(
    ids.guild,
    actorId,
    action,
    "intent_proposal",
    proposalId,
    ids.rootSpace,
  );
}

function internalAgentRun(ids: FixtureIds, runId: string): AgentRun {
  const now = new Date().toISOString();
  return {
    id: runId,
    guildId: ids.guild,
    spaceId: ids.rootSpace,
    ownerIdentityId: ids.root,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    agentIdentityId: ids.agent,
    requesterIdentityId: ids.root,
    connectorId: null,
    questId: null,
    riskLevel: 1,
    status: "planning",
    source: "guild-ui",
    plan: {
      objective: "Draft a review Activity",
      expectedOutcome: "One draft Activity is created for Human review.",
      steps: ["Read the immutable Plan", "Create the Activity draft"],
      connectorId: null,
      questId: null,
      action: {
        kind: "activity_draft",
        title: "Review the Plan outcome",
        description: "Human review remains required.",
        activityType: "task",
      },
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 100,
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
    workflowInstanceId: `intent-agent-${runId}`,
    idempotencyKey: `intent-agent:${runId}`,
    requestHash: hash(`agent-run:${runId}`),
    estimatedBudgetMinor: 0,
    killRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

integration("Guild Intent repository", () => {
  it("creates an immutable ordered Plan exactly once for one idempotency hash", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Idempotency");
    const input = proposalInput(ids);
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const first = await repository.createProposal(input);
      expect(first.created).toBe(true);
      expect(first.proposal.actions.map((action) => action.position)).toEqual([0, 1]);
      expect(first.proposal.actions.map((action) => action.kind)).toEqual([
        "memory.propose",
        "activity.create",
      ]);
    });
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const duplicate = await repository.createProposal({
        ...input,
        chronicleEvent: proposalMutationEvent(
          ids,
          input.id,
          ids.root,
          "intent.proposal.created",
        ),
      });
      expect(duplicate.created).toBe(false);
      expect(duplicate.proposal.id).toBe(input.id);
      const counts = await connection.query<{ proposal_count: number; action_count: number; event_count: number }>(
        `SELECT
           (SELECT count(*)::integer FROM intent_proposals
             WHERE guild_id = $1 AND created_by_actor_id = $2 AND request_hash = $3) AS proposal_count,
           (SELECT count(*)::integer FROM intent_proposal_actions
             WHERE guild_id = $1 AND proposal_id = $4) AS action_count,
           (SELECT count(*)::integer FROM chronicle_events
             WHERE guild_id = $1 AND subject_type = 'intent_proposal'
               AND subject_id = $4 AND action = 'intent.proposal.created') AS event_count`,
        [ids.guild, ids.root, input.requestHash, input.id],
      );
      expect(counts.rows[0]).toEqual({ proposal_count: 1, action_count: 2, event_count: 1 });
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildIntentRepository(connection, ids.guild).createProposal({
        ...input,
        objective: "Different immutable objective",
        chronicleEvent: proposalMutationEvent(
          ids,
          input.id,
          ids.root,
          "intent.proposal.created",
        ),
      }))).rejects.toThrow("different immutable content");
  });

  it("keeps proposals private to their creator unless verified guild.manage is explicit", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Privacy");
    const rootPlan = proposalInput(ids);
    const memberPlan = proposalInput(ids, { actorId: ids.member });
    await createProposal(ids, rootPlan);
    await createProposal(ids, memberPlan);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const own = await repository.listProposals({ actorId: ids.member });
      expect(own.items.map((proposal) => proposal.id)).toEqual([memberPlan.id]);
      await expect(repository.getProposal(rootPlan.id, { actorId: ids.member })).rejects.toThrow(
        "not found for the current Actor",
      );
      await expect(repository.listProposals({
        actorId: ids.member,
        scope: "guild",
        assertedPermission: "guild.manage",
      })).rejects.toThrow("not currently granted");
      const managed = await repository.listProposals({
        actorId: ids.root,
        scope: "guild",
        assertedPermission: "guild.manage",
      });
      expect(new Set(managed.items.map((proposal) => proposal.id))).toEqual(
        new Set([rootPlan.id, memberPlan.id]),
      );
    });

    const otherGuild = await fixture("Other Guild");
    const otherPlan = proposalInput(otherGuild);
    await createProposal(otherGuild, otherPlan);
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      await expect(repository.getProposal(otherPlan.id, {
        actorId: ids.root,
        scope: "guild",
        assertedPermission: "guild.manage",
      })).rejects.toThrow("not found for the current Actor");
    });
  });

  it("uses SKIP LOCKED so two workers cannot claim the same leased action", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Lease");
    const input = proposalInput(ids, { actions: [memoryAction(ids)] });
    await createProposal(ids, input);
    let signalClaimed: (() => void) | undefined;
    let releaseClaim: (() => void) | undefined;
    const claimed = new Promise<void>((resolve) => { signalClaimed = resolve; });
    const release = new Promise<void>((resolve) => { releaseClaim = resolve; });
    const firstLease = randomUUID();
    const firstWorker = withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const result = await new GuildIntentRepository(connection, ids.guild).claimNextAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        leaseToken: firstLease,
        leaseSeconds: 60,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
      });
      expect(result.state).toBe("claimed");
      signalClaimed?.();
      await release;
    });
    await claimed;
    try {
      const second = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await connection.query("SET LOCAL statement_timeout = '2s'");
        return new GuildIntentRepository(connection, ids.guild).claimNextAction({
          access: { actorId: ids.root },
          proposalId: input.id,
          leaseToken: randomUUID(),
          leaseSeconds: 60,
          chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
        });
      });
      expect(second.state).toBe("empty");
    } finally {
      releaseClaim?.();
      await firstWorker;
    }
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const detail = await new GuildIntentRepository(connection, ids.guild).getProposal(
        input.id,
        { actorId: ids.root },
      );
      expect(detail.actions[0]).toMatchObject({
        status: "processing",
        attemptCount: 1,
        leaseToken: firstLease,
      });
    });
    const retryLease = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const requeued = await repository.requeueAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        position: 0,
        leaseToken: firstLease,
        errorSummary: "Transient dependency timeout.",
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.requeued"),
      });
      expect(requeued).toMatchObject({ status: "pending", attemptCount: 1, leaseToken: null });
      const reclaimed = await repository.claimNextAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        leaseToken: retryLease,
        leaseSeconds: 60,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
      });
      expect(reclaimed.state).toBe("claimed");
      if (reclaimed.state !== "claimed") throw new Error("Expected a reclaimed Plan action.");
      expect(reclaimed.action).toMatchObject({
        status: "processing",
        attemptCount: 2,
        leaseToken: retryLease,
      });
    });
  });

  it("rejects mutation of the immutable action intent at the database boundary", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Immutable");
    const input = proposalInput(ids, { actions: [memoryAction(ids)] });
    await createProposal(ids, input);
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `UPDATE intent_proposal_actions
            SET action = jsonb_set(action, '{request,title}', '"tampered"'::jsonb),
                version = version + 1
          WHERE guild_id = $1 AND proposal_id = $2 AND position = 0`,
        [ids.guild, input.id],
      ))).rejects.toThrow("immutable");
  });

  it("completes the proposal only after every ordered action succeeds", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Success");
    const actions = [memoryAction(ids), activityAction(ids)] as const;
    const input = proposalInput(ids, { actions });
    await createProposal(ids, input);
    for (const [position, action] of actions.entries()) {
      await withGuildTransaction(connectionString, ids.guild, async (connection) => {
        const repository = new GuildIntentRepository(connection, ids.guild);
        const leaseToken = randomUUID();
        const claim = await repository.claimNextAction({
          access: { actorId: ids.root },
          proposalId: input.id,
          leaseToken,
          leaseSeconds: 60,
          chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
        });
        expect(claim.state).toBe("claimed");
        if (claim.state !== "claimed") throw new Error("Expected a claimed Plan action.");
        expect(claim.action.position).toBe(position);
        if (action.kind !== "memory.propose" && action.kind !== "activity.create") {
          throw new Error("Unexpected success-test action kind.");
        }
        const resourceType = action.kind === "memory.propose" ? "memory" : "activity";
        const resourceId = action.kind === "memory.propose"
          ? action.action.memoryId
          : action.action.activityId;
        const result = await repository.succeedAction({
          access: { actorId: ids.root },
          proposalId: input.id,
          position,
          leaseToken,
          resourceType,
          resourceId,
          result: { stored: true, position },
          chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.succeeded"),
        });
        expect(result.status).toBe(position === actions.length - 1 ? "completed" : "executing");
      });
    }
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const detail = await new GuildIntentRepository(connection, ids.guild).getProposal(
        input.id,
        { actorId: ids.root },
      );
      expect(detail.status).toBe("completed");
      expect(detail.completedAt).not.toBeNull();
      expect(detail.actions.every((action) => action.status === "succeeded")).toBe(true);
    });
  });

  it("fails atomically, preserves the error, and cancels unstarted later actions", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Failure");
    const input = proposalInput(ids);
    await createProposal(ids, input);
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const leaseToken = randomUUID();
      const claim = await repository.claimNextAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        leaseToken,
        leaseSeconds: 60,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
      });
      expect(claim.state).toBe("claimed");
      const failed = await repository.failAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        position: 0,
        leaseToken,
        errorSummary: "The downstream validator rejected the draft.",
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.failed"),
      });
      expect(failed.status).toBe("failed");
      expect(failed.errorSummary).toBe("The downstream validator rejected the draft.");
      expect(failed.actions.map((action) => action.status)).toEqual(["failed", "cancelled"]);
    });
  });

  it("rejects already-expired creation input and durably expires an unclaimed Plan", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Expiry");
    const invalid = proposalInput(ids, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildIntentRepository(connection, ids.guild).createProposal(invalid))).rejects.toThrow(
      "must be in the future",
    );

    const input = proposalInput(ids, {
      expiresAt: new Date(Date.now() + 500).toISOString(),
      actions: [memoryAction(ids)],
    });
    await createProposal(ids, input);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const expired = await new GuildIntentRepository(connection, ids.guild).claimNextAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        leaseToken: randomUUID(),
        leaseSeconds: 60,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.proposal.expired"),
      });
      expect(expired.state).toBe("expired");
      if (expired.state !== "expired") throw new Error("Expected an expired Plan.");
      expect(expired.proposal.status).toBe("expired");
      expect(expired.proposal.actions[0]?.status).toBe("cancelled");
    });
  });

  it("stages one governed Agent run and reconciles its terminal result into the Plan", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const ids = await fixture("Agent Reconciliation");
    const runId = randomUUID();
    const action: IntentActionInput = {
      kind: "agent.run",
      riskLevel: 1,
      action: {
        agentRunId: runId,
        agentActorId: ids.agent,
        spaceId: ids.rootSpace,
        request: { objective: "Draft one review Activity" },
      },
    };
    const input = proposalInput(ids, { actions: [action] });
    await createProposal(ids, input);
    const run = internalAgentRun(ids, runId);
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const runRepository = new GuildAgentRunRepository(connection, ids.guild);
      expect(await runRepository.createRun({
        run,
        approval: null,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "agent.run.planned",
          "agent_run",
          run.id,
          ids.rootSpace,
        ),
      })).toBe(true);
      const intentRepository = new GuildIntentRepository(connection, ids.guild);
      const leaseToken = randomUUID();
      const claim = await intentRepository.claimNextAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        leaseToken,
        leaseSeconds: 60,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.claimed"),
      });
      expect(claim.state).toBe("claimed");
      const staged = await intentRepository.stageAgentAction({
        access: { actorId: ids.root },
        proposalId: input.id,
        position: 0,
        leaseToken,
        agentRunId: run.id,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.staged"),
      });
      expect(staged).toMatchObject({ status: "staged", agentRunId: run.id });
    });

    const activityId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildAgentRunRepository(connection, ids.guild);
      await repository.claimExecution(run.id, run.workflowInstanceId);
      await repository.completeExecution(
        run.id,
        run.workflowInstanceId,
        { kind: "activity_draft", activityId, completedAt: new Date().toISOString() },
        {
          budgetMinor: 0,
          tokens: 80,
          durationSeconds: 4,
          steps: 2,
          retries: 0,
          delegationDepth: 0,
        },
        event(
          ids.guild,
          ids.agent,
          "agent.run.succeeded",
          "agent_run",
          run.id,
          ids.rootSpace,
        ),
      );
    });
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildIntentRepository(connection, ids.guild);
      const reconciled = await repository.reconcileStagedAgentRun({
        access: { actorId: ids.root },
        proposalId: input.id,
        position: 0,
        chronicleEvent: proposalMutationEvent(ids, input.id, ids.root, "intent.action.reconciled"),
      });
      expect(reconciled.state).toBe("succeeded");
      expect(reconciled.proposal.status).toBe("completed");
      expect(reconciled.action).toMatchObject({
        status: "succeeded",
        resourceType: "agent_run",
        resourceId: run.id,
        agentRunId: run.id,
      });
      expect(reconciled.action.result).toMatchObject({
        agentRunId: run.id,
        runStatus: "succeeded",
        output: { kind: "activity_draft", activityId },
      });
    });
  });
});
