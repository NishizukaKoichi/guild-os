import { AGENT_RUN_STATUSES } from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  AgentLimits,
  AgentRunPlan,
  AgentRunStatus,
  AgentRunUsage,
  JsonValue,
} from "./types.js";
import {
  assertNonBlank,
  assertNonNegativeInteger,
  assertPositiveInteger,
} from "./validation.js";

export const AGENT_RUN_TRANSITIONS = {
  planning: ["awaiting_approval", "failed", "killed"],
  awaiting_approval: ["running", "failed", "killed"],
  running: ["succeeded", "failed", "killed"],
  succeeded: [],
  failed: [],
  killed: [],
} as const satisfies Record<AgentRunStatus, readonly AgentRunStatus[]>;

const EVENT_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_PLAN_STEPS = 50;
const MAX_WEBHOOK_PAYLOAD_BYTES = 32 * 1024;
const MAX_JSON_DEPTH = 10;
const MAX_JSON_PROPERTIES = 500;

export function assertAgentRunTransition(
  current: AgentRunStatus,
  next: AgentRunStatus,
): void {
  if (!(AGENT_RUN_STATUSES as readonly string[]).includes(current) ||
      !(AGENT_RUN_STATUSES as readonly string[]).includes(next) ||
      !(AGENT_RUN_TRANSITIONS[current] as readonly AgentRunStatus[]).includes(next)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `Agent run cannot transition from ${current} to ${next}.`,
    );
  }
}

export function assertAgentRunPlan(plan: AgentRunPlan): void {
  assertNonBlank(plan.objective, "Agent run objective", 500);
  assertNonBlank(plan.expectedOutcome, "Agent run expected outcome", 2_000);
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > MAX_PLAN_STEPS) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `Agent run plans require between 1 and ${MAX_PLAN_STEPS} steps.`,
    );
  }
  for (const step of plan.steps) assertNonBlank(step, "Agent run step", 500);
  if (plan.action.kind !== "https_webhook" || !EVENT_TYPE_PATTERN.test(plan.action.eventType)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Webhook event type must use 1-100 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  const jsonState = { properties: 0 };
  assertBoundedJson(plan.action.payload, 0, jsonState);
  const payloadSize = new TextEncoder().encode(JSON.stringify(plan.action.payload)).byteLength;
  if (payloadSize > MAX_WEBHOOK_PAYLOAD_BYTES) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `Webhook payload must not exceed ${MAX_WEBHOOK_PAYLOAD_BYTES} bytes.`,
    );
  }
  assertEstimatedUsage(plan.estimatedUsage);
  if (plan.estimatedUsage.steps !== plan.steps.length) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Estimated Agent steps must match the number of plan steps.",
    );
  }
}

export function assertUsageWithinLimits(
  limits: AgentLimits,
  usage: AgentRunUsage,
): void {
  const checks: readonly [number, number, string][] = [
    [usage.budgetMinor, limits.maxBudgetMinor, "budget"],
    [usage.durationSeconds, limits.maxDurationSeconds, "duration"],
    [usage.steps, limits.maxSteps, "steps"],
    [usage.retries, limits.maxRetries, "retries"],
    [usage.delegationDepth, limits.maxDelegationDepth, "delegation depth"],
  ];
  const exceeded = checks.find(([actual, maximum]) => actual > maximum);
  if (exceeded) {
    throw new GuildDomainError(
      "AGENT_LIMIT_EXCEEDED",
      `Agent ${exceeded[2]} limit exceeded (${exceeded[0]} > ${exceeded[1]}).`,
    );
  }
}

export function intersectAgentLimits(
  runLimits: AgentLimits,
  currentLimits: AgentLimits,
): AgentLimits {
  if (runLimits.currency !== currentLimits.currency) {
    throw new GuildDomainError(
      "AGENT_LIMIT_EXCEEDED",
      "Agent currency changed after this run was planned.",
    );
  }
  return {
    currency: runLimits.currency,
    maxBudgetMinor: Math.min(runLimits.maxBudgetMinor, currentLimits.maxBudgetMinor),
    maxDurationSeconds: Math.min(runLimits.maxDurationSeconds, currentLimits.maxDurationSeconds),
    maxSteps: Math.min(runLimits.maxSteps, currentLimits.maxSteps),
    maxRetries: Math.min(runLimits.maxRetries, currentLimits.maxRetries),
    maxDelegationDepth: Math.min(
      runLimits.maxDelegationDepth,
      currentLimits.maxDelegationDepth,
    ),
  };
}

function assertEstimatedUsage(usage: AgentRunUsage): void {
  assertNonNegativeInteger(usage.budgetMinor, "Estimated Agent budget");
  assertPositiveInteger(usage.durationSeconds, "Estimated Agent duration");
  assertPositiveInteger(usage.steps, "Estimated Agent steps");
  assertNonNegativeInteger(usage.retries, "Estimated Agent retries");
  assertNonNegativeInteger(usage.delegationDepth, "Estimated Agent delegation depth");
}

function assertBoundedJson(
  value: JsonValue,
  depth: number,
  state: { properties: number },
): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new GuildDomainError("INVALID_INPUT", "Webhook payload nesting is too deep.");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new GuildDomainError("INVALID_INPUT", "Webhook payload numbers must be finite.");
    }
    return;
  }
  if (Array.isArray(value)) {
    state.properties += value.length;
    if (state.properties > MAX_JSON_PROPERTIES) {
      throw new GuildDomainError("INVALID_INPUT", "Webhook payload contains too many values.");
    }
    for (const item of value) assertBoundedJson(item, depth + 1, state);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new GuildDomainError("INVALID_INPUT", "Webhook payload must be plain JSON data.");
  }
  const entries = Object.entries(value);
  state.properties += entries.length;
  if (state.properties > MAX_JSON_PROPERTIES) {
    throw new GuildDomainError("INVALID_INPUT", "Webhook payload contains too many properties.");
  }
  for (const [key, item] of entries) {
    assertNonBlank(key, "Webhook payload key", 200);
    assertBoundedJson(item, depth + 1, state);
  }
}
