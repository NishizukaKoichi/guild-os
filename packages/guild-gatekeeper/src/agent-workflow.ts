import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  GuildAgentActionRuntime,
  type GuildAgentRuntimeOutcome,
  type GuildAgentRuntimeState,
} from "./agent-action-runtime.js";
import type { GuildEnv } from "./config.js";

export interface AgentWorkflowParams {
  guildId: string;
  runId: string;
}

export interface AgentWorkflowRuntime {
  getState(runId: string): Promise<GuildAgentRuntimeState>;
  execute(runId: string, workflowInstanceId: string): Promise<GuildAgentRuntimeOutcome>;
  fail(
    runId: string,
    workflowInstanceId: string,
    message: string,
    startedAt: number,
  ): Promise<void>;
}

function terminal(status: string): boolean {
  return ["succeeded", "failed", "killed"].includes(status);
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Agent execution failure.";
  if (/approval/i.test(message)) return "Agent execution stopped because approval is unavailable.";
  if (/permission|authorized|membership|identity|clearance/i.test(message)) {
    return "Agent execution stopped because current authority no longer permits it.";
  }
  if (/connector|connection|webhook|federation/i.test(message)) {
    return "Agent execution stopped because its governed external connection is unavailable.";
  }
  if (/limit|budget|duration|steps|retries|delegation/i.test(message)) {
    return "Agent execution stopped because a hard execution limit was reached.";
  }
  return "Agent execution failed before a verified completion was recorded.";
}

export async function runGuildAgentWorkflow(
  runtime: AgentWorkflowRuntime,
  configuredGuildId: string,
  event: Readonly<WorkflowEvent<AgentWorkflowParams>>,
  step: WorkflowStep,
  startedAt = Date.now(),
): Promise<Readonly<Record<string, unknown>>> {
  if (event.payload.guildId !== configuredGuildId) {
    throw new NonRetryableError("Workflow payload crosses the configured Guild boundary.");
  }
  const runId = event.payload.runId;

  try {
    let state = await step.do("load governed run", { retries: { limit: 3, delay: "2 seconds" } },
      () => runtime.getState(runId));
    if (state.workflowInstanceId !== event.instanceId) {
      throw new NonRetryableError("Workflow instance does not own this Agent run.");
    }
    if (terminal(state.status)) return { status: state.status, runId };

    if (state.status === "planning" && state.riskLevel >= 2) {
      await step.waitForEvent("wait for Cloudflare OS approval", {
        type: "overseer-decision",
        timeout: "7 days",
      });
      state = await step.do(
        "verify Cloudflare OS decision",
        { retries: { limit: 3, delay: "2 seconds" } },
        () => runtime.getState(runId),
      );
      if (terminal(state.status)) return { status: state.status, runId };
      if (state.status !== "awaiting_approval") {
        throw new NonRetryableError("Cloudflare OS approval did not open Guild approval.");
      }
    }

    if (state.approvalStatus === "pending") {
      await step.waitForEvent("wait for Guild approval quorum", {
        type: "approval-decision",
        timeout: "7 days",
      });
      state = await step.do(
        "verify Guild approval quorum",
        { retries: { limit: 3, delay: "2 seconds" } },
        () => runtime.getState(runId),
      );
    }
    if (terminal(state.status)) return { status: state.status, runId };
    const automaticReady = (state.status === "planning" || state.status === "running") &&
      state.approvalStatus === null;
    const approvedReady = (state.status === "awaiting_approval" || state.status === "running") &&
      state.approvalStatus === "approved";
    if (!automaticReady && !approvedReady) {
      throw new NonRetryableError("Guild approval quorum was not reached.");
    }

    const outcome: { status: "succeeded" | "killed"; resultKind: string } = await step.do(
      "execute one governed Agent action",
      { retries: { limit: 0, delay: "1 second" }, timeout: "15 minutes", sensitive: "output" },
      async () => {
        const executed = await runtime.execute(runId, event.instanceId);
        return { status: executed.status, resultKind: executed.result.kind };
      },
    );
    return { status: outcome.status, runId, resultKind: outcome.resultKind };
  } catch (error) {
    const state = await step.do(
      "load state after execution failure",
      { retries: { limit: 3, delay: "2 seconds" } },
      () => runtime.getState(runId),
    );
    if (terminal(state.status)) return { status: state.status, runId };
    const message = safeFailure(error);
    await step.do(
      "record governed execution failure",
      { retries: { limit: 5, delay: "2 seconds" } },
      () => runtime.fail(runId, event.instanceId, message, startedAt),
    );
    return { status: "failed", runId };
  }
}

export class AgentExecutionWorkflow extends WorkflowEntrypoint<GuildEnv, AgentWorkflowParams> {
  async run(
    event: Readonly<WorkflowEvent<AgentWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<Readonly<Record<string, unknown>>> {
    const runtime = new GuildAgentActionRuntime(this.env, this.env.GUILD_ID);
    return runGuildAgentWorkflow(runtime, this.env.GUILD_ID, event, step);
  }
}
