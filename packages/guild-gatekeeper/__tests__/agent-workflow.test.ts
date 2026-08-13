import { describe, expect, it, vi } from "vitest";
import type { AgentRunUsage, RiskLevel } from "@guild-os/domain";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import {
  runGuildAgentWorkflow,
  type AgentWorkflowParams,
  type AgentWorkflowRuntime,
} from "../src/agent-workflow.js";

const GUILD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const INSTANCE_ID = "agent-run-test";
const STARTED_AT = 1_723_593_600_000;
const USAGE: AgentRunUsage = {
  budgetMinor: 0,
  tokens: 0,
  durationSeconds: 1,
  steps: 1,
  retries: 0,
  delegationDepth: 0,
};

function workflowEvent(guildId = GUILD_ID): Readonly<WorkflowEvent<AgentWorkflowParams>> {
  return {
    instanceId: INSTANCE_ID,
    payload: { guildId, runId: RUN_ID },
  } as Readonly<WorkflowEvent<AgentWorkflowParams>>;
}

function workflowStep() {
  const names: string[] = [];
  const waits: string[] = [];
  const step = {
    do: vi.fn(async <T>(
      name: string,
      _config: unknown,
      callback: () => Promise<T>,
    ): Promise<T> => {
      names.push(name);
      return callback();
    }),
    waitForEvent: vi.fn(async (name: string) => {
      waits.push(name);
      return { payload: {} };
    }),
  } as unknown as WorkflowStep;
  return { step, names, waits };
}

function state(
  riskLevel: RiskLevel,
  status: "planning" | "awaiting_approval" | "running" = "planning",
  approvalStatus: "pending" | "approved" | "rejected" | null = null,
) {
  return { status, riskLevel, workflowInstanceId: INSTANCE_ID, approvalStatus } as const;
}

function successfulOutcome() {
  return {
    status: "succeeded" as const,
    result: {
      kind: "memory_search" as const,
      memoryIds: [],
      completedAt: "2026-08-14T00:00:00.000Z",
    },
    usage: USAGE,
  };
}

describe("runGuildAgentWorkflow", () => {
  it.each([0, 1] as const)(
    "executes Level %i actions without waiting for approval",
    async (riskLevel) => {
      const runtime: AgentWorkflowRuntime = {
        getState: vi.fn().mockResolvedValue(state(riskLevel)),
        execute: vi.fn().mockResolvedValue(successfulOutcome()),
        fail: vi.fn().mockResolvedValue(undefined),
      };
      const { step, waits } = workflowStep();

      const result = await runGuildAgentWorkflow(
        runtime,
        GUILD_ID,
        workflowEvent(),
        step,
        STARTED_AT,
      );

      expect(result).toEqual({ status: "succeeded", runId: RUN_ID, resultKind: "memory_search" });
      expect(waits).toEqual([]);
      expect(runtime.execute).toHaveBeenCalledWith(RUN_ID, INSTANCE_ID);
      expect(runtime.fail).not.toHaveBeenCalled();
    },
  );

  it.each([2, 3] as const)(
    "waits for Cloudflare OS and current Guild approval before Level %i execution",
    async (riskLevel) => {
      const runtime: AgentWorkflowRuntime = {
        getState: vi.fn()
          .mockResolvedValueOnce(state(riskLevel, "planning", "pending"))
          .mockResolvedValueOnce(state(riskLevel, "awaiting_approval", "pending"))
          .mockResolvedValueOnce(state(riskLevel, "awaiting_approval", "approved")),
        execute: vi.fn().mockResolvedValue(successfulOutcome()),
        fail: vi.fn().mockResolvedValue(undefined),
      };
      const { step, waits } = workflowStep();

      const result = await runGuildAgentWorkflow(
        runtime,
        GUILD_ID,
        workflowEvent(),
        step,
        STARTED_AT,
      );

      expect(result.status).toBe("succeeded");
      expect(waits).toEqual([
        "wait for Cloudflare OS approval",
        "wait for Guild approval quorum",
      ]);
      expect(runtime.execute).toHaveBeenCalledWith(RUN_ID, INSTANCE_ID);
    },
  );

  it("records a durable failure when an action adapter is unavailable", async () => {
    const runtime: AgentWorkflowRuntime = {
      getState: vi.fn()
        .mockResolvedValueOnce(state(1))
        .mockResolvedValueOnce(state(1, "running")),
      execute: vi.fn().mockRejectedValue(new Error("Action adapter is unavailable.")),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const { step, names } = workflowStep();

    const result = await runGuildAgentWorkflow(
      runtime,
      GUILD_ID,
      workflowEvent(),
      step,
      STARTED_AT,
    );

    expect(result).toEqual({ status: "failed", runId: RUN_ID });
    expect(names).toContain("record governed execution failure");
    expect(runtime.fail).toHaveBeenCalledWith(
      RUN_ID,
      INSTANCE_ID,
      "Agent execution failed before a verified completion was recorded.",
      STARTED_AT,
    );
  });

  it("rejects a workflow payload from another Guild before loading a run", async () => {
    const runtime: AgentWorkflowRuntime = {
      getState: vi.fn(),
      execute: vi.fn(),
      fail: vi.fn(),
    };
    const { step } = workflowStep();

    await expect(runGuildAgentWorkflow(
      runtime,
      GUILD_ID,
      workflowEvent("00000000-0000-4000-8000-000000000099"),
      step,
      STARTED_AT,
    )).rejects.toThrow("Workflow payload crosses the configured Guild boundary.");
    expect(runtime.getState).not.toHaveBeenCalled();
  });
});
