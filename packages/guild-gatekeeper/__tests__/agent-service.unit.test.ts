import { describe, expect, it, vi } from "vitest";
import type {
  AgentApprovalRequest,
  AgentApprovalVote,
  AgentLimits,
  AgentRun,
  AgentRunPlan,
  AgentRunUsage,
  AuthorizationSnapshot,
  Permission,
  RiskLevel,
  SecuredResource,
} from "@guild-os/domain";
import {
  executeGuildAgentAction,
  type ExecuteGuildAgentActionInput,
  type GuildAgentActionExecutionRecord,
  type GuildAgentActionHandlers,
  type GuildAgentExternalWriteIdempotency,
  type GuildAgentExternalWriteScope,
} from "../src/agent-service.js";

const NOW = "2026-08-14T00:00:00.000Z";
const COMPLETED_AT = "2026-08-14T00:00:01.000Z";
const IDS = {
  guild: "00000000-0000-4000-8000-000000000001",
  root: "00000000-0000-4000-8000-000000000002",
  requester: "00000000-0000-4000-8000-000000000003",
  approver1: "00000000-0000-4000-8000-000000000004",
  approver2: "00000000-0000-4000-8000-000000000005",
  agent: "00000000-0000-4000-8000-000000000006",
  targetAgent: "00000000-0000-4000-8000-000000000007",
  space: "00000000-0000-4000-8000-000000000008",
  connector: "00000000-0000-4000-8000-000000000009",
  memory: "00000000-0000-4000-8000-00000000000a",
  activity: "00000000-0000-4000-8000-00000000000b",
  childRun: "00000000-0000-4000-8000-00000000000c",
  delivery: "00000000-0000-4000-8000-00000000000d",
};

const LIMITS: AgentLimits = {
  currency: "AUD",
  maxBudgetMinor: 100,
  maxTokens: 1_000,
  maxDurationSeconds: 5,
  maxSteps: 5,
  maxRetries: 1,
  maxDelegationDepth: 2,
};

const ACTION_PERMISSIONS = new Set<Permission>([
  "memory.read",
  "activity.create",
  "agent.run",
  "connection.execute",
  "federation.read",
  "integration.execute",
]);

const ACTION_KIND = {
  memory_search: "memory.search",
  activity_draft: "activity.draft",
  agent_delegate: "agent.delegate",
  connection_invoke: "connection.invoke",
  https_webhook: "https_webhook.post",
  federation_publish: "federation.publish",
} as const;

const MEMORY_RESOURCE: SecuredResource = {
  id: IDS.memory,
  guildId: IDS.guild,
  spaceId: IDS.space,
  ownerIdentityId: IDS.requester,
  visibility: "space",
  classification: "internal",
  allowedIdentityIds: [],
};

function snapshot(level1Automatic = true): AuthorizationSnapshot {
  const agentPermissions = [...ACTION_PERMISSIONS];
  const requesterPermissions = [...ACTION_PERMISSIONS];
  return {
    guild: {
      id: IDS.guild,
      name: "Test Guild",
      purpose: "Verify governed Agent execution.",
      rootOwnerIdentityId: IDS.root,
      createdAt: NOW,
      updatedAt: NOW,
    },
    constitution: {
      guildId: IDS.guild,
      version: 1,
      level2ApprovalQuorum: 1,
      level3ApprovalQuorum: 2,
      dataRetentionDays: 365,
      agentDefaults: LIMITS,
      agentPolicy: {
        level0Automatic: true,
        level1Automatic,
        level2HumanApproval: true,
        level3MultiHumanApproval: true,
      },
      updatedByIdentityId: IDS.root,
      updatedAt: NOW,
    },
    spaces: [{
      id: IDS.space,
      guildId: IDS.guild,
      parentSpaceId: null,
      name: "Operations",
      status: "active",
    }],
    identities: [
      { id: IDS.root, guildId: IDS.guild, kind: "human", displayName: "Root", status: "active" },
      { id: IDS.requester, guildId: IDS.guild, kind: "human", displayName: "Requester", status: "active" },
      { id: IDS.approver1, guildId: IDS.guild, kind: "human", displayName: "Approver 1", status: "active" },
      { id: IDS.approver2, guildId: IDS.guild, kind: "human", displayName: "Approver 2", status: "active" },
      { id: IDS.agent, guildId: IDS.guild, kind: "agent", displayName: "Agent", status: "active" },
      { id: IDS.targetAgent, guildId: IDS.guild, kind: "agent", displayName: "Target", status: "active" },
    ],
    memberships: [IDS.root, IDS.requester, IDS.approver1, IDS.approver2, IDS.agent, IDS.targetAgent]
      .map((identityId) => ({
        guildId: IDS.guild,
        identityId,
        state: "active" as const,
        clearance: "restricted" as const,
        joinedAt: NOW,
        departedAt: null,
      })),
    roles: [
      { id: "requester-role", guildId: IDS.guild, name: "Requester", permissions: requesterPermissions, system: false },
      { id: "agent-role", guildId: IDS.guild, name: "Agent", permissions: agentPermissions, system: false },
      { id: "target-role", guildId: IDS.guild, name: "Target", permissions: ["agent.run"], system: false },
      { id: "approver-role", guildId: IDS.guild, name: "Approver", permissions: ["agent.approve"], system: false },
    ],
    roleBindings: [
      { guildId: IDS.guild, identityId: IDS.requester, roleId: "requester-role", spaceId: IDS.space },
      { guildId: IDS.guild, identityId: IDS.agent, roleId: "agent-role", spaceId: IDS.space },
      { guildId: IDS.guild, identityId: IDS.targetAgent, roleId: "target-role", spaceId: IDS.space },
      { guildId: IDS.guild, identityId: IDS.approver1, roleId: "approver-role", spaceId: IDS.space },
      { guildId: IDS.guild, identityId: IDS.approver2, roleId: "approver-role", spaceId: IDS.space },
    ],
    agents: [IDS.agent, IDS.targetAgent].map((identityId) => ({
      identityId,
      guildId: IDS.guild,
      instructions: "Operate only inside the governed test Space.",
      model: "test/model",
      toolIds: identityId === IDS.agent
        ? ["memory_search", "activity_draft", "agent_delegate", "connection_invoke", "https_webhook", "federation_publish"]
        : ["memory_search"],
      limits: LIMITS,
      status: "active" as const,
    })),
  };
}

function usage(delegationDepth = 0): AgentRunUsage {
  return {
    budgetMinor: 0,
    tokens: 10,
    durationSeconds: 1,
    steps: 1,
    retries: 0,
    delegationDepth,
  };
}

function runFor(
  action: AgentRunPlan["action"],
  riskLevel: RiskLevel,
  suffix: string,
): AgentRun {
  const external = action.kind === "connection_invoke" || action.kind === "https_webhook" ||
    action.kind === "federation_publish";
  const connectorId = external ? IDS.connector : null;
  return {
    id: `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    guildId: IDS.guild,
    spaceId: IDS.space,
    ownerIdentityId: IDS.requester,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    agentIdentityId: IDS.agent,
    requesterIdentityId: IDS.requester,
    connectorId,
    questId: null,
    riskLevel,
    status: "running",
    source: "guild-ui",
    plan: {
      objective: `Execute ${action.kind}`,
      expectedOutcome: "Return one verified adapter result.",
      steps: ["Execute the governed action"],
      connectorId,
      questId: null,
      action,
      estimatedUsage: usage(action.kind === "agent_delegate" ? 1 : 0),
    },
    result: null,
    errorMessage: null,
    limits: LIMITS,
    usage: { ...usage(), tokens: 0, durationSeconds: 0, steps: 0 },
    workflowInstanceId: `agent-run-${suffix}`,
    idempotencyKey: `agent-action:${suffix}`,
    requestHash: `request-hash:${suffix}`,
    estimatedBudgetMinor: 0,
    killRequestedAt: null,
    startedAt: NOW,
    finishedAt: null,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function approvalFor(
  run: AgentRun,
  count = run.riskLevel === 3 ? 2 : 1,
  reauthenticatedAt = NOW,
): { approval: AgentApprovalRequest; votes: AgentApprovalVote[] } {
  const approvalId = `20000000-0000-4000-8000-${run.id.slice(-12)}`;
  const approvers = [IDS.approver1, IDS.approver2].slice(0, count);
  return {
    approval: {
      id: approvalId,
      guildId: IDS.guild,
      agentRunId: run.id,
      riskLevel: run.riskLevel,
      actionKind: ACTION_KIND[run.plan.action.kind],
      requiredApprovals: run.riskLevel === 3 ? 2 : 1,
      approvalCount: count,
      reauthenticationRequired: run.riskLevel === 3,
      status: "approved",
      expiresAt: "2026-08-15T00:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
    },
    votes: approvers.map((approverIdentityId) => ({
      guildId: IDS.guild,
      approvalRequestId: approvalId,
      approverIdentityId,
      verdict: "approve" as const,
      reason: "Approved for this governed test.",
      reauthenticatedAt: run.riskLevel === 3 ? reauthenticatedAt : null,
      createdAt: NOW,
    })),
  };
}

const handlers: GuildAgentActionHandlers = {
  memory_search: async () => ({
    result: { kind: "memory_search", memoryIds: [IDS.memory], completedAt: COMPLETED_AT },
    usage: usage(),
    authorizedResources: [MEMORY_RESOURCE],
  }),
  activity_draft: async () => ({
    result: { kind: "activity_draft", activityId: IDS.activity, completedAt: COMPLETED_AT },
    usage: usage(),
  }),
  agent_delegate: async () => ({
    result: { kind: "agent_delegate", childRunId: IDS.childRun, completedAt: COMPLETED_AT },
    usage: usage(1),
  }),
  connection_invoke: async (action) => ({
    result: {
      kind: "connection_invoke",
      capabilityId: action.capabilityId,
      statusCode: 200,
      output: { ok: true },
      completedAt: COMPLETED_AT,
    },
    usage: usage(),
  }),
  https_webhook: async () => ({
    result: { kind: "https_webhook", statusCode: 202, deliveredAt: COMPLETED_AT },
    usage: usage(),
  }),
  federation_publish: async () => ({
    result: { kind: "federation_publish", deliveryId: IDS.delivery, completedAt: COMPLETED_AT },
    usage: usage(),
  }),
};

class MemoryExternalWriteIdempotency implements GuildAgentExternalWriteIdempotency {
  readonly #entries = new Map<string, {
    requestHash: string;
    result: Promise<GuildAgentActionExecutionRecord>;
  }>();

  runOnce(
    scope: GuildAgentExternalWriteScope,
    operation: () => Promise<GuildAgentActionExecutionRecord>,
  ): Promise<GuildAgentActionExecutionRecord> {
    const key = `${scope.guildId}:${scope.idempotencyKey}`;
    const existing = this.#entries.get(key);
    if (existing) {
      if (existing.requestHash !== scope.requestHash) {
        return Promise.reject(new Error("Idempotency key was reused for different content."));
      }
      return existing.result;
    }
    const result = operation();
    this.#entries.set(key, { requestHash: scope.requestHash, result });
    return result;
  }
}

function executionInput(
  run: AgentRun,
  overrides: Partial<ExecuteGuildAgentActionInput> = {},
): ExecuteGuildAgentActionInput {
  const evidence = run.riskLevel >= 2 ? approvalFor(run) : { approval: null, votes: [] };
  const external = run.plan.action.kind === "connection_invoke" ||
    run.plan.action.kind === "https_webhook" ||
    run.plan.action.kind === "federation_publish";
  return {
    run,
    snapshot: snapshot(),
    workflowPermissions: ACTION_PERMISSIONS,
    connectorPermissions: ACTION_PERMISSIONS,
    connectorWriteRiskLevel: external ? run.riskLevel : null,
    approval: evidence.approval,
    approvalVotes: evidence.votes,
    handlers,
    killSwitch: { async isKillRequested() { return false; } },
    externalWriteIdempotency: new MemoryExternalWriteIdempotency(),
    now: NOW,
    ...overrides,
  };
}

describe("generic Guild Agent action execution", () => {
  it("executes all six action kinds through the governed adapter path", async () => {
    const cases: readonly [AgentRunPlan["action"], RiskLevel, string][] = [
      [{ kind: "memory_search", query: "approved policy", locale: "en" }, 0, "1"],
      [{ kind: "activity_draft", title: "Draft", description: "", activityType: "task" }, 1, "2"],
      [{ kind: "agent_delegate", targetAgentActorId: IDS.targetAgent, objective: "Research" }, 1, "3"],
      [{ kind: "connection_invoke", capabilityId: "tickets.create", input: { title: "Issue" } }, 2, "6"],
      [{ kind: "https_webhook", eventType: "guild.test", payload: { ok: true } }, 2, "4"],
      [{ kind: "federation_publish", federationLinkId: IDS.connector, grantIds: [IDS.memory] }, 3, "5"],
    ];

    for (const [action, riskLevel, suffix] of cases) {
      const outcome = await executeGuildAgentAction(executionInput(runFor(action, riskLevel, suffix)));
      expect(outcome.result.kind).toBe(action.kind);
      expect(outcome.usage.durationSeconds).toBeGreaterThanOrEqual(1);
      expect(outcome.completedAfterKill).toBe(false);
      expect(outcome.effectiveLimits).toEqual(LIMITS);
    }
  });

  it("enforces Agent, requester, Workflow, and execution-side permission intersection", async () => {
    const run = runFor({ kind: "memory_search", query: "scope", locale: "en" }, 0, "11");
    const adapter = vi.fn(handlers.memory_search!);
    const base = snapshot();
    const withoutRolePermission = (roleId: string) => ({
      ...base,
      roles: base.roles.map((role) => role.id === roleId
        ? { ...role, permissions: role.permissions.filter((permission) => permission !== "memory.read") }
        : role),
    });
    const attempts = [
      executionInput(run, { snapshot: withoutRolePermission("agent-role"), handlers: { memory_search: adapter } }),
      executionInput(run, { snapshot: withoutRolePermission("requester-role"), handlers: { memory_search: adapter } }),
      executionInput(run, { workflowPermissions: new Set<Permission>(["agent.run"]), handlers: { memory_search: adapter } }),
      executionInput(run, { connectorPermissions: new Set<Permission>(["agent.run"]), handlers: { memory_search: adapter } }),
    ];

    for (const attempt of attempts) {
      await expect(executeGuildAgentAction(attempt)).rejects.toThrow(/memory\.read|Workflow or connector/);
    }
    expect(adapter).not.toHaveBeenCalled();

    const leakingAdapter = vi.fn(async () => ({
      result: { kind: "memory_search" as const, memoryIds: [IDS.memory], completedAt: COMPLETED_AT },
      usage: usage(),
      authorizedResources: [{
        ...MEMORY_RESOURCE,
        ownerIdentityId: IDS.approver1,
        visibility: "private" as const,
      }],
    }));
    await expect(executeGuildAgentAction(executionInput(run, {
      handlers: { memory_search: leakingAdapter },
    }))).rejects.toThrow(/Private resources require an explicit share/);
  });

  it("applies automatic Level 0/1 policy and durable Level 2/3 approval policy", async () => {
    const draft = runFor(
      { kind: "activity_draft", title: "Draft", description: "", activityType: "task" },
      1,
      "21",
    );
    await expect(executeGuildAgentAction(executionInput(draft, {
      snapshot: snapshot(false),
      approval: null,
      approvalVotes: [],
    }))).rejects.toThrow(/durable Human approval/);
    const draftApproval = approvalFor(draft);
    await expect(executeGuildAgentAction(executionInput(draft, {
      snapshot: snapshot(false),
      approval: draftApproval.approval,
      approvalVotes: draftApproval.votes,
    }))).resolves.toMatchObject({ result: { kind: "activity_draft" } });

    const publish = runFor({
      kind: "federation_publish",
      federationLinkId: IDS.connector,
      grantIds: [IDS.memory],
    }, 3, "22");
    const oneVote = approvalFor(publish, 1);
    await expect(executeGuildAgentAction(executionInput(publish, {
      approval: oneVote.approval,
      approvalVotes: oneVote.votes,
    }))).rejects.toThrow(/requires 2 authorized Human approvals/);

    await expect(executeGuildAgentAction(executionInput(publish, {
      connectorWriteRiskLevel: 2,
    }))).rejects.toThrow(/cannot weaken or override/);

    const stale = approvalFor(publish, 2, "2026-08-13T23:50:00.000Z");
    await expect(executeGuildAgentAction(executionInput(publish, {
      approval: stale.approval,
      approvalVotes: stale.votes,
    }))).rejects.toThrow(/last five minutes/);

    const current = approvalFor(publish, 2);
    await expect(executeGuildAgentAction(executionInput(publish, {
      approval: current.approval,
      approvalVotes: current.votes,
    }))).resolves.toMatchObject({ result: { kind: "federation_publish" } });
  });

  it("enforces planned and actual hard limits plus bounded, acyclic delegation", async () => {
    const search = runFor({ kind: "memory_search", query: "limits", locale: "en" }, 0, "31");
    const smallSnapshot = snapshot();
    smallSnapshot.agents[0]!.limits = { ...LIMITS, maxSteps: 1, maxTokens: 20 };
    const oversizedPlan = {
      ...search,
      plan: {
        ...search.plan,
        steps: ["One", "Two"],
        estimatedUsage: { ...search.plan.estimatedUsage, steps: 2 },
      },
    };
    await expect(executeGuildAgentAction(executionInput(oversizedPlan, {
      snapshot: smallSnapshot,
    }))).rejects.toThrow(/steps limit exceeded/);

    const excessiveUsage = vi.fn(async () => ({
      result: { kind: "memory_search" as const, memoryIds: [IDS.memory], completedAt: COMPLETED_AT },
      usage: { ...usage(), tokens: 21 },
      authorizedResources: [MEMORY_RESOURCE],
    }));
    await expect(executeGuildAgentAction(executionInput(search, {
      snapshot: smallSnapshot,
      handlers: { memory_search: excessiveUsage },
    }))).rejects.toThrow(/tokens limit exceeded/);

    const delegated = runFor({
      kind: "agent_delegate",
      targetAgentActorId: IDS.targetAgent,
      objective: "Delegate once",
    }, 1, "32");
    await expect(executeGuildAgentAction(executionInput(delegated, {
      delegationChainAgentIdentityIds: [IDS.targetAgent, IDS.agent],
    }))).rejects.toThrow(/cycle/);

    const noDelegationSnapshot = snapshot();
    noDelegationSnapshot.agents[0]!.limits = { ...LIMITS, maxDelegationDepth: 0 };
    await expect(executeGuildAgentAction(executionInput(delegated, {
      snapshot: noDelegationSnapshot,
    }))).rejects.toThrow(/delegation depth/);
  });

  it("fails closed before and during execution when the durable Kill Switch changes", async () => {
    const run = runFor({ kind: "memory_search", query: "kill", locale: "en" }, 0, "41");
    const adapter = vi.fn(handlers.memory_search!);
    await expect(executeGuildAgentAction(executionInput(run, {
      handlers: { memory_search: adapter },
      killSwitch: { async isKillRequested() { return true; } },
    }))).rejects.toThrow(/Kill Switch before execution/);
    expect(adapter).not.toHaveBeenCalled();

    let lateChecks = 0;
    const lateOutcome = await executeGuildAgentAction(executionInput(run, {
      killSwitch: {
        async isKillRequested() {
          lateChecks += 1;
          return lateChecks >= 2;
        },
      },
    }));
    expect(lateOutcome.completedAfterKill).toBe(true);

    let checks = 0;
    const abortingAdapter = vi.fn(async (
      _action: Extract<AgentRunPlan["action"], { kind: "memory_search" }>,
      context: Parameters<NonNullable<GuildAgentActionHandlers["memory_search"]>>[1],
    ) => new Promise<GuildAgentActionExecutionRecord>((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("Adapter observed abort.")));
    }));
    await expect(executeGuildAgentAction(executionInput(run, {
      handlers: { memory_search: abortingAdapter },
      killSwitch: { async isKillRequested() { checks += 1; return checks >= 2; } },
      killPollIntervalMs: 10,
    }))).rejects.toThrow(/abort|Kill Switch/);
    expect(abortingAdapter).toHaveBeenCalledOnce();
  });

  it("requires durable idempotency and executes concurrent external retries only once", async () => {
    const run = runFor({
      kind: "https_webhook",
      eventType: "guild.external.write",
      payload: { value: 1 },
    }, 2, "51");
    const idempotency = new MemoryExternalWriteIdempotency();
    const webhook = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        result: { kind: "https_webhook" as const, statusCode: 204, deliveredAt: COMPLETED_AT },
        usage: usage(),
      };
    });
    const input = executionInput(run, {
      handlers: { https_webhook: webhook },
      externalWriteIdempotency: idempotency,
    });
    const [first, second] = await Promise.all([
      executeGuildAgentAction(input),
      executeGuildAgentAction(input),
    ]);
    expect(first.result).toEqual(second.result);
    expect(webhook).toHaveBeenCalledOnce();

    await expect(executeGuildAgentAction(executionInput(run, {
      handlers: { https_webhook: webhook },
      externalWriteIdempotency: undefined,
    }))).rejects.toThrow(/durable idempotency adapter/);

    const changed = { ...run, requestHash: "different-request-hash" };
    await expect(executeGuildAgentAction(executionInput(changed, {
      handlers: { https_webhook: webhook },
      externalWriteIdempotency: idempotency,
    }))).rejects.toThrow(/reused for different content/);
  });

  it("does not report success when the requested execution adapter is absent", async () => {
    const run = runFor({ kind: "memory_search", query: "missing", locale: "en" }, 0, "61");
    await expect(executeGuildAgentAction(executionInput(run, {
      handlers: {},
    }))).rejects.toThrow("No execution adapter is registered for memory_search.");
  });
});
