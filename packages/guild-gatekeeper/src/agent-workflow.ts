import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { assertUsageWithinLimits, type AgentRunUsage } from "@guild-os/domain";
import { GuildAgentService, type AgentExecutionClaim } from "./agent-service.js";
import { deliverSignedWebhook } from "./agent-webhook.js";
import type { GuildEnv } from "./config.js";

export interface AgentWorkflowParams {
  guildId: string;
  runId: string;
}

const ZERO_USAGE: AgentRunUsage = {
  budgetMinor: 0,
  durationSeconds: 0,
  steps: 0,
  retries: 0,
  delegationDepth: 0,
};

function terminal(status: string): boolean {
  return ["succeeded", "failed", "killed"].includes(status);
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Agent execution failure.";
  if (/approval/i.test(message)) return "Agent execution stopped because approval is unavailable.";
  if (/permission|authorized|membership|identity|clearance/i.test(message)) {
    return "Agent execution stopped because current authority no longer permits it.";
  }
  if (/connector|webhook/i.test(message)) {
    return "Agent execution stopped because the deployment Webhook is unavailable.";
  }
  if (/limit|budget|duration|steps|retries|delegation/i.test(message)) {
    return "Agent execution stopped because a hard execution limit was reached.";
  }
  return "Agent execution failed before a verified completion was recorded.";
}

function boundedFailureUsage(
  claim: AgentExecutionClaim | null,
  startedAt: number,
): AgentRunUsage {
  if (!claim) return ZERO_USAGE;
  return {
    budgetMinor: 0,
    durationSeconds: Math.min(
      claim.effectiveLimits.maxDurationSeconds,
      Math.max(0, Math.ceil((Date.now() - startedAt) / 1_000)),
    ),
    steps: Math.min(claim.effectiveLimits.maxSteps, claim.plannedSteps),
    retries: 0,
    delegationDepth: 0,
  };
}

export class AgentExecutionWorkflow extends WorkflowEntrypoint<GuildEnv, AgentWorkflowParams> {
  async run(
    event: Readonly<WorkflowEvent<AgentWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (event.payload.guildId !== this.env.GUILD_ID) {
      throw new NonRetryableError("Workflow payload crosses the configured Guild boundary.");
    }
    const service = new GuildAgentService(this.env, this.env.GUILD_ID);
    const runId = event.payload.runId;
    const startedAt = Date.now();
    let claim: AgentExecutionClaim | null = null;

    try {
      let state = await step.do("load governed run", { retries: { limit: 3, delay: "2 seconds" } },
        () => service.getWorkflowState(runId));
      if (state.workflowInstanceId !== event.instanceId) {
        throw new NonRetryableError("Workflow instance does not own this Agent run.");
      }
      if (terminal(state.status)) return { status: state.status, runId };

      if (state.status === "planning") {
        await step.waitForEvent("wait for Cloudflare OS approval", {
          type: "overseer-decision",
          timeout: "7 days",
        });
        state = await step.do(
          "verify Cloudflare OS decision",
          { retries: { limit: 3, delay: "2 seconds" } },
          () => service.getWorkflowState(runId),
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
          () => service.getWorkflowState(runId),
        );
      }
      if (terminal(state.status)) return { status: state.status, runId };
      if (state.status !== "awaiting_approval" || state.approvalStatus !== "approved") {
        throw new NonRetryableError("Guild approval quorum was not reached.");
      }

      claim = await step.do(
        "recheck authority and claim execution",
        { retries: { limit: 3, delay: "2 seconds" }, sensitive: "output" },
        () => service.claimExecution(runId, event.instanceId),
      );
      const delivery = await step.do(
        "send one signed webhook",
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        () => deliverSignedWebhook(
          claim!.endpointUrl,
          this.env.GUILD_WEBHOOK_SIGNING_SECRET,
          claim!,
        ),
      );
      const usage: AgentRunUsage = {
        budgetMinor: 0,
        durationSeconds: delivery.durationSeconds,
        steps: claim.plannedSteps,
        retries: 0,
        delegationDepth: 0,
      };
      assertUsageWithinLimits(claim.effectiveLimits, usage);
      const completionStatus = await step.do(
        "record verified completion",
        { retries: { limit: 5, delay: "2 seconds" } },
        () => service.completeExecution(
          runId,
          event.instanceId,
          {
            kind: "https_webhook",
            statusCode: delivery.statusCode,
            deliveredAt: delivery.deliveredAt,
          },
          usage,
        ),
      );
      return { status: completionStatus, runId, statusCode: delivery.statusCode };
    } catch (error) {
      const state = await step.do(
        "load state after execution failure",
        { retries: { limit: 3, delay: "2 seconds" } },
        () => service.getWorkflowState(runId),
      );
      if (terminal(state.status)) return { status: state.status, runId };
      const message = safeFailure(error);
      await step.do(
        "record governed execution failure",
        { retries: { limit: 5, delay: "2 seconds" } },
        () => service.failExecution(
          runId,
          event.instanceId,
          message,
          boundedFailureUsage(claim, startedAt),
        ),
      );
      return { status: "failed", runId };
    }
  }
}
