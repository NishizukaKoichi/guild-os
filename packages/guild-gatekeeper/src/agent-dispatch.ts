import { GuildAgentRunRepository, withGuildTransaction } from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";

const MAX_MESSAGES_PER_DRAIN = 50;

interface AgentMessagePayload {
  runId: string;
  workflowInstanceId: string;
  eventType?: "overseer-decision" | "approval-decision";
  decision?: "approved" | "rejected";
}

function payloadFrom(value: Readonly<Record<string, unknown>>): AgentMessagePayload {
  if (typeof value.runId !== "string" || typeof value.workflowInstanceId !== "string") {
    throw new Error("Agent Workflow message is missing its run or instance ID.");
  }
  if (value.eventType !== undefined &&
      !["overseer-decision", "approval-decision"].includes(String(value.eventType))) {
    throw new Error("Agent Workflow message event type is invalid.");
  }
  if (value.decision !== undefined && !["approved", "rejected"].includes(String(value.decision))) {
    throw new Error("Agent Workflow decision is invalid.");
  }
  return value as unknown as AgentMessagePayload;
}

function errorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "Unknown Workflow dispatch failure.";
  return value.slice(0, 2_000);
}

async function dispatch(
  env: GuildEnv,
  topic: "agent.workflow.start" | "agent.workflow.signal" | "agent.workflow.terminate",
  rawPayload: Readonly<Record<string, unknown>>,
): Promise<void> {
  const payload = payloadFrom(rawPayload);
  if (topic === "agent.workflow.start") {
    try {
      await env.AGENT_EXECUTION.create({
        id: payload.workflowInstanceId,
        params: { guildId: env.GUILD_ID, runId: payload.runId },
        retention: { successRetention: "30 days", errorRetention: "30 days" },
      });
      return;
    } catch (error) {
      const existing = await env.AGENT_EXECUTION.get(payload.workflowInstanceId);
      const status = await existing.status();
      if (["queued", "running", "paused", "waiting", "waitingForPause", "complete"]
        .includes(status.status)) return;
      throw error;
    }
  }

  const instance = await env.AGENT_EXECUTION.get(payload.workflowInstanceId);
  const status = await instance.status();
  if (topic === "agent.workflow.terminate") {
    if (["queued", "running", "paused", "waiting", "waitingForPause"].includes(status.status)) {
      await instance.terminate({ rollback: false });
    }
    return;
  }
  if (["complete", "errored", "terminated"].includes(status.status)) return;
  if (status.status === "unknown" || !payload.eventType || !payload.decision) {
    throw new Error("Agent Workflow is not ready for this durable decision signal.");
  }
  await instance.sendEvent({
    type: payload.eventType,
    payload: { decision: payload.decision, runId: payload.runId },
  });
}

export async function drainAgentWorkflowOutbox(env: GuildEnv): Promise<number> {
  let completed = 0;
  for (let index = 0; index < MAX_MESSAGES_PER_DRAIN; index += 1) {
    const message = await withGuildTransaction(
      env.HYPERDRIVE.connectionString,
      env.GUILD_ID,
      (connection) => new GuildAgentRunRepository(
        connection,
        env.GUILD_ID,
      ).claimWorkflowMessage(),
    );
    if (!message) break;
    try {
      await dispatch(env, message.topic, message.payload);
      await withGuildTransaction(
        env.HYPERDRIVE.connectionString,
        env.GUILD_ID,
        (connection) => new GuildAgentRunRepository(
          connection,
          env.GUILD_ID,
        ).completeWorkflowMessage(message.outboxId),
      );
      completed += 1;
    } catch (error) {
      const failure = errorMessage(error);
      await withGuildTransaction(
        env.HYPERDRIVE.connectionString,
        env.GUILD_ID,
        async (connection) => {
          const repository = new GuildAgentRunRepository(connection, env.GUILD_ID);
          const exhausted = await repository.retryWorkflowMessage(message.outboxId, failure);
          if (!exhausted) return;
          const run = await repository.getRun(payloadFrom(message.payload).runId);
          await repository.failExecution(
            run.id,
            run.workflowInstanceId,
            "Agent Workflow dispatch failed before execution could be completed.",
            run.usage,
            makeChronicleEvent(
              env.GUILD_ID,
              run.agentIdentityId,
              "agent.run.dispatch_failed",
              "agent_run",
              run.id,
              {
                source: "agent-workflow-outbox",
                outboxId: message.outboxId,
                topic: message.topic,
                failure,
              },
              run,
            ),
          );
        },
      );
    }
  }
  return completed;
}
