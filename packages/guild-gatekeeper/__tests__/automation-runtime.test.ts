import { describe, expect, it, vi } from "vitest";
import type { AgentLimits, AgentRunPlan, Permission } from "@guild-os/domain";
import {
  AutomationRuntimeError,
  DurableAutomationRuntime,
  createModelRouteAutomationPlanner,
  type AutomationAgentRunDispatchResult,
  type AutomationAgentRunPort,
  type AutomationDispatchAuthority,
  type AutomationPlanningContext,
  type AutomationRunLease,
  type AutomationRuntimeRepository,
} from "../src/automation-runtime.js";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const IDS = {
  guild: "00000000-0000-4000-8000-000000000001",
  requester: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000003",
  workflow: "00000000-0000-4000-8000-000000000004",
  rule: "00000000-0000-4000-8000-000000000005",
  event: "00000000-0000-4000-8000-000000000006",
  request: "00000000-0000-4000-8000-000000000007",
  space: "00000000-0000-4000-8000-000000000008",
};

const LIMITS: AgentLimits = {
  currency: "AUD",
  maxBudgetMinor: 1_000,
  maxTokens: 10_000,
  maxDurationSeconds: 300,
  maxSteps: 10,
  maxRetries: 2,
  maxDelegationDepth: 2,
};

const MEMORY_PERMISSIONS: readonly Permission[] = ["memory.read"];

function memoryPlan(): AgentRunPlan {
  return {
    objective: "Find the current retention policy",
    expectedOutcome: "Return the authorized canonical policy with its source.",
    steps: ["Search authorized Guild Memory"],
    connectorId: null,
    questId: null,
    action: { kind: "memory_search", query: "retention policy", locale: "en" },
    estimatedUsage: {
      budgetMinor: 0,
      tokens: 200,
      durationSeconds: 5,
      steps: 1,
      retries: 0,
      delegationDepth: 0,
    },
  };
}

function lease(
  triggerKind: "schedule" | "event" | "manual" = "manual",
  attempt = 1,
): AutomationRunLease {
  return {
    request: {
      id: IDS.request,
      guildId: IDS.guild,
      workflowId: IDS.workflow,
      automationRuleId: triggerKind === "manual" ? null : IDS.rule,
      requestedByActorId: IDS.requester,
      agentActorId: IDS.agent,
      triggerKind,
      triggerEventId: triggerKind === "event" ? IDS.event : null,
      input: { query: "retention policy" },
      idempotencyKey: triggerKind === "event"
        ? `event:${IDS.event}:rule:${IDS.rule}`
        : `${triggerKind}:${IDS.request}`,
    },
    leaseToken: "lease-token-1",
    leaseOwner: "worker-1",
    leaseExpiresAt: "2026-08-14T00:01:00.000Z",
    attempt,
    maxAttempts: 3,
  };
}

function planningContext(): AutomationPlanningContext {
  return {
    guildName: "Research Guild",
    workflowName: "Policy lookup",
    workflowInstructions: "Find the current authorized policy.",
    spaceId: IDS.space,
    allowedActionKinds: ["memory_search"],
    workflowPermissions: MEMORY_PERMISSIONS,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
  };
}

function dispatchAuthority(
  overrides: Partial<AutomationDispatchAuthority> = {},
): AutomationDispatchAuthority {
  return {
    revision: "authority-revision-1",
    guildId: IDS.guild,
    automationRuleStatus: null,
    workflowStatus: "active",
    agentStatus: "active",
    agentMembershipOperational: true,
    requesterStatus: "active",
    requesterMembershipOperational: true,
    killRequested: false,
    agentPermissions: MEMORY_PERMISSIONS,
    requesterPermissions: MEMORY_PERMISSIONS,
    workflowPermissions: MEMORY_PERMISSIONS,
    agentToolIds: ["memory_search"],
    agentLimits: LIMITS,
    constitutionLimits: LIMITS,
    connector: null,
    delegatedAgentOperational: null,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    spaceId: IDS.space,
    ...overrides,
  };
}

interface HarnessOptions {
  claimed?: AutomationRunLease | null;
  context?: AutomationPlanningContext;
  authority?: AutomationDispatchAuthority;
  planResult?: unknown;
  planFailure?: unknown;
  renewed?: AutomationRunLease | null;
  dispatchResult?: AutomationAgentRunDispatchResult;
  dispatchFailure?: unknown;
}

function harness(options: HarnessOptions = {}) {
  const claimed = options.claimed === undefined ? lease() : options.claimed;
  const context = options.context ?? planningContext();
  const authority = options.authority ?? dispatchAuthority({
    automationRuleStatus: claimed?.request.automationRuleId ? "active" : null,
  });
  const renewed = options.renewed === undefined ? claimed : options.renewed;
  const repository: AutomationRuntimeRepository = {
    claimNext: vi.fn(async () => claimed),
    loadPlanningContext: vi.fn(async () => context),
    renewLease: vi.fn(async () => renewed),
    loadDispatchAuthority: vi.fn(async () => authority),
    commitDispatched: vi.fn(async () => undefined),
    releaseForRetry: vi.fn(async () => undefined),
    commitTerminal: vi.fn(async () => undefined),
  };
  const dispatcher: AutomationAgentRunPort = {
    createGovernedRun: vi.fn(async () => {
      if (options.dispatchFailure !== undefined) throw options.dispatchFailure;
      return options.dispatchResult ?? { status: "created", runId: IDS.request };
    }),
  };
  const planner = {
    plan: vi.fn(async () => {
      if (options.planFailure !== undefined) throw options.planFailure;
      return options.planResult ?? memoryPlan();
    }),
  };
  const runtime = new DurableAutomationRuntime(repository, dispatcher, planner, {
    workerId: "worker-1",
    leaseDurationMs: 60_000,
    plannerTimeoutMs: 1_000,
    maxAttempts: 3,
    baseBackoffMs: 2_000,
    maxBackoffMs: 30_000,
    now: () => NOW,
  });
  return { runtime, repository, dispatcher, planner };
}

describe("DurableAutomationRuntime", () => {
  it.each(["schedule", "event", "manual"] as const)(
    "claims and dispatches a due %s request through the governed Agent port",
    async (triggerKind) => {
      const currentLease = lease(triggerKind);
      const { runtime, repository, dispatcher } = harness({
        claimed: currentLease,
        authority: dispatchAuthority({
          automationRuleStatus: triggerKind === "manual" ? null : "active",
        }),
      });

      await expect(runtime.runOnce()).resolves.toEqual({
        status: "dispatched",
        requestId: IDS.request,
        agentRunId: IDS.request,
        duplicate: false,
      });
      expect(repository.claimNext).toHaveBeenCalledWith(expect.objectContaining({
        workerId: "worker-1",
        triggerKinds: ["schedule", "event", "manual"],
      }));
      expect(dispatcher.createGovernedRun).toHaveBeenCalledWith(expect.objectContaining({
        requestId: IDS.request,
        requesterIdentityId: IDS.requester,
        agentIdentityId: IDS.agent,
        workflowDefinitionId: IDS.workflow,
        origin: "automation",
      }));
    },
  );

  it("treats a duplicate event dispatch as the same governed run", async () => {
    const currentLease = lease("event");
    const { runtime, repository, dispatcher } = harness({
      claimed: currentLease,
      authority: dispatchAuthority({ automationRuleStatus: "active" }),
      dispatchResult: { status: "existing", runId: IDS.request },
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({
      status: "dispatched",
      duplicate: true,
      agentRunId: IDS.request,
    });
    expect(dispatcher.createGovernedRun).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `automation:${IDS.guild}:${IDS.request}`,
    }));
    expect(repository.commitDispatched).toHaveBeenCalledWith(expect.objectContaining({
      duplicate: true,
      event: expect.objectContaining({
        action: "automation.run.dispatched",
        details: expect.objectContaining({ duplicate: true }),
      }),
    }));
  });

  it("does not dispatch when another worker wins the lease race", async () => {
    const { runtime, repository, dispatcher } = harness({ renewed: null });

    await expect(runtime.runOnce()).resolves.toEqual({
      status: "lease_lost",
      requestId: IDS.request,
    });
    expect(repository.loadDispatchAuthority).not.toHaveBeenCalled();
    expect(dispatcher.createGovernedRun).not.toHaveBeenCalled();
    expect(repository.commitDispatched).not.toHaveBeenCalled();
    expect(repository.commitTerminal).not.toHaveBeenCalled();
  });

  it("cancels a request when its Automation rule was disabled during planning", async () => {
    const currentLease = lease("schedule");
    const { runtime, repository, dispatcher } = harness({
      claimed: currentLease,
      authority: dispatchAuthority({ automationRuleStatus: "paused" }),
    });

    await expect(runtime.runOnce()).resolves.toEqual({
      status: "cancelled",
      requestId: IDS.request,
      errorCode: "rule_inactive",
    });
    expect(dispatcher.createGovernedRun).not.toHaveBeenCalled();
    expect(repository.commitTerminal).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "cancelled",
      errorCode: "rule_inactive",
    }));
  });

  it("cancels a request when the Agent was stopped or offboarded", async () => {
    const { runtime, repository, dispatcher } = harness({
      authority: dispatchAuthority({
        agentStatus: "stopped",
        agentMembershipOperational: false,
      }),
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({
      status: "cancelled",
      errorCode: "agent_inactive",
    });
    expect(dispatcher.createGovernedRun).not.toHaveBeenCalled();
    expect(repository.releaseForRetry).not.toHaveBeenCalled();
  });

  it("fails terminally when the planner returns malformed output", async () => {
    const { runtime, repository, dispatcher } = harness({
      planResult: { response: "not-json" },
    });

    await expect(runtime.runOnce()).resolves.toEqual({
      status: "terminal_failure",
      requestId: IDS.request,
      errorCode: "planner_invalid",
    });
    expect(dispatcher.createGovernedRun).not.toHaveBeenCalled();
    expect(repository.commitTerminal).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      errorCode: "planner_invalid",
    }));
  });

  it("cancels when requester permission is lost before dispatch", async () => {
    const { runtime, repository, dispatcher } = harness({
      authority: dispatchAuthority({ requesterPermissions: [] }),
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({
      status: "cancelled",
      errorCode: "permission_lost",
    });
    expect(dispatcher.createGovernedRun).not.toHaveBeenCalled();
    expect(repository.commitTerminal).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "permission_lost",
    }));
  });

  it("releases a transient planning failure with bounded exponential backoff", async () => {
    const { runtime, repository } = harness({
      planFailure: new Error("temporary provider outage with private transport details"),
    });

    await expect(runtime.runOnce()).resolves.toEqual({
      status: "retry_scheduled",
      requestId: IDS.request,
      availableAt: "2026-08-14T00:00:02.000Z",
      errorCode: "planner_unavailable",
    });
    expect(repository.releaseForRetry).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "planner_unavailable",
      availableAt: "2026-08-14T00:00:02.000Z",
      event: expect.objectContaining({
        details: expect.not.objectContaining({
          message: "temporary provider outage with private transport details",
        }),
      }),
    }));
  });

  it("records a terminal failure when the durable retry limit is exhausted", async () => {
    const { runtime, repository } = harness({
      claimed: lease("manual", 3),
      renewed: lease("manual", 3),
      planFailure: new AutomationRuntimeError(
        "planner_unavailable",
        "Configured planner is unavailable.",
        true,
      ),
    });

    await expect(runtime.runOnce()).resolves.toEqual({
      status: "terminal_failure",
      requestId: IDS.request,
      errorCode: "planner_unavailable",
    });
    expect(repository.releaseForRetry).not.toHaveBeenCalled();
    expect(repository.commitTerminal).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      errorCode: "planner_unavailable",
    }));
  });

  it("delegates approval waits and all execution to the Agent Workflow", async () => {
    const { runtime, repository, dispatcher } = harness();

    await runtime.runOnce();

    expect(dispatcher.createGovernedRun).toHaveBeenCalledTimes(1);
    expect(dispatcher.createGovernedRun).toHaveBeenCalledWith(expect.objectContaining({
      plan: memoryPlan(),
      riskLevel: 0,
      workflowPermissions: MEMORY_PERMISSIONS,
      effectiveLimits: LIMITS,
    }));
    expect(repository.commitDispatched).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        details: expect.objectContaining({
          approvalAndExecutionDelegatedToAgentWorkflow: true,
        }),
      }),
    }));
  });

  it.each([
    ["killed", "kill_requested"],
    ["offboarded", "agent_inactive"],
    ["authority_changed", "authority_changed"],
  ] as const)("records a %s race as cancellation", async (status, errorCode) => {
    const { runtime, repository } = harness({ dispatchResult: { status } });

    await expect(runtime.runOnce()).resolves.toMatchObject({
      status: "cancelled",
      errorCode,
    });
    expect(repository.commitTerminal).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "cancelled",
      errorCode,
    }));
  });
});

describe("configured model route planner", () => {
  it("uses only the plan route and treats Workflow text as untrusted model data", async () => {
    const runner = vi.fn(async () => ({ response: JSON.stringify(memoryPlan()) }));
    const planner = createModelRouteAutomationPlanner(runner);

    const result = await planner.plan({ request: lease().request, context: planningContext() },
      new AbortController().signal);

    expect(result).toEqual({ response: JSON.stringify(memoryPlan()) });
    expect(runner).toHaveBeenCalledWith(
      "plan",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("untrusted data"),
          }),
        ]),
        response_format: { type: "json_object" },
      }),
      null,
    );
  });
});
