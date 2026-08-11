import { describe, expect, it } from "vitest";
import {
  assertAgentRunPlan,
  assertAgentRunTransition,
  assertUsageWithinLimits,
  intersectAgentLimits,
} from "./agent.js";
import type { AgentLimits, AgentRunPlan } from "./types.js";

const limits: AgentLimits = {
  currency: "USD",
  maxBudgetMinor: 500,
  maxDurationSeconds: 60,
  maxSteps: 3,
  maxRetries: 1,
  maxDelegationDepth: 0,
};

function plan(overrides: Partial<AgentRunPlan> = {}): AgentRunPlan {
  return {
    objective: "Notify the purchaser-owned operations endpoint",
    expectedOutcome: "One signed event is accepted by the configured endpoint.",
    steps: ["Validate the approved payload", "Send the signed webhook"],
    connectorId: "00000000-0000-4000-8000-000000000001",
    questId: null,
    action: {
      kind: "https_webhook",
      eventType: "guild.quest.completed",
      payload: { questId: "quest-1", completed: true },
    },
    estimatedUsage: {
      budgetMinor: 0,
      durationSeconds: 10,
      steps: 2,
      retries: 0,
      delegationDepth: 0,
    },
    ...overrides,
  };
}

describe("Agent run policy", () => {
  it("validates bounded webhook plans and legal lifecycle transitions", () => {
    expect(() => assertAgentRunPlan(plan())).not.toThrow();
    expect(() => assertAgentRunTransition("planning", "awaiting_approval")).not.toThrow();
    expect(() => assertAgentRunTransition("succeeded", "running")).toThrow();
  });

  it("rejects malformed, oversized, and mismatched plans", () => {
    expect(() => assertAgentRunPlan(plan({
      action: { kind: "https_webhook", eventType: "bad event", payload: {} },
    }))).toThrow("Webhook event type");
    expect(() => assertAgentRunPlan(plan({
      estimatedUsage: { ...plan().estimatedUsage, steps: 1 },
    }))).toThrow("must match");
    expect(() => assertAgentRunPlan(plan({
      action: { kind: "https_webhook", eventType: "valid", payload: { body: "x".repeat(33_000) } },
    }))).toThrow("must not exceed");
  });

  it("uses the stricter of immutable run limits and current profile limits", () => {
    const effective = intersectAgentLimits(limits, { ...limits, maxSteps: 2, maxBudgetMinor: 800 });
    expect(effective).toMatchObject({ maxSteps: 2, maxBudgetMinor: 500 });
    expect(() => assertUsageWithinLimits(effective, plan().estimatedUsage)).not.toThrow();
    expect(() => assertUsageWithinLimits(effective, {
      ...plan().estimatedUsage,
      steps: 3,
    })).toThrow("limit exceeded");
  });
});
