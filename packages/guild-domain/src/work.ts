import {
  GOAL_STATUSES,
  GOAL_TRANSITIONS,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  QUEST_STATUSES,
  QUEST_TRANSITIONS,
  STEP_STATUSES,
  STEP_TRANSITIONS,
} from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type { GoalStatus, ProjectStatus, QuestStatus, StepStatus } from "./types.js";
import { assertNonBlank } from "./validation.js";

export function assertWorkText(title: string, description: string): void {
  assertNonBlank(title, "Work title", 200);
  if (typeof description !== "string" || description.length > 10_000) {
    throw new GuildDomainError("INVALID_INPUT", "Work description must be at most 10,000 characters.");
  }
}

function assertTransition<T extends string>(
  current: T,
  next: T,
  transitions: Readonly<Record<T, readonly T[]>>,
  label: string,
): void {
  if (current === next) return;
  if (!transitions[current]?.includes(next)) {
    throw new GuildDomainError("INVALID_WORK_TRANSITION", `${label} cannot transition from ${current} to ${next}.`);
  }
}

export function assertGoalStatus(value: string): asserts value is GoalStatus {
  if (!(GOAL_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Goal status is invalid.");
  }
}

export function assertProjectStatus(value: string): asserts value is ProjectStatus {
  if (!(PROJECT_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Project status is invalid.");
  }
}

export function assertQuestStatus(value: string): asserts value is QuestStatus {
  if (!(QUEST_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Quest status is invalid.");
  }
}

export function assertStepStatus(value: string): asserts value is StepStatus {
  if (!(STEP_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Step status is invalid.");
  }
}

export function assertGoalTransition(current: GoalStatus, next: GoalStatus): void {
  assertTransition(current, next, GOAL_TRANSITIONS, "Goal");
}

export function assertProjectTransition(current: ProjectStatus, next: ProjectStatus): void {
  assertTransition(current, next, PROJECT_TRANSITIONS, "Project");
}

export function assertQuestTransition(current: QuestStatus, next: QuestStatus): void {
  assertTransition(current, next, QUEST_TRANSITIONS, "Quest");
}

export function assertStepTransition(current: StepStatus, next: StepStatus): void {
  assertTransition(current, next, STEP_TRANSITIONS, "Step");
}
