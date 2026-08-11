import { DECISION_STATUSES, DECISION_TRANSITIONS } from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type { DecisionStatus } from "./types.js";
import { assertNonBlank } from "./validation.js";

export interface DecisionOptionInput {
  label: string;
  description: string;
}

export function assertDecisionStatus(value: string): asserts value is DecisionStatus {
  if (!(DECISION_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Decision status is invalid.");
  }
}

export function assertDecisionTransition(current: DecisionStatus, next: DecisionStatus): void {
  if (current === next) return;
  const allowed = DECISION_TRANSITIONS[current] as readonly DecisionStatus[];
  if (!allowed.includes(next)) {
    throw new GuildDomainError(
      "INVALID_DECISION_TRANSITION",
      `Decision cannot transition from ${current} to ${next}.`,
    );
  }
}

export function assertDecisionContent(
  title: string,
  description: string,
  rationale: string,
): void {
  assertNonBlank(title, "Decision title", 200);
  assertNonBlank(description, "Decision description", 10_000);
  if (typeof rationale !== "string" || rationale.length > 10_000) {
    throw new GuildDomainError("INVALID_INPUT", "Decision rationale must be at most 10,000 characters.");
  }
}

export function assertDecisionOptions(options: readonly DecisionOptionInput[]): void {
  if (!Array.isArray(options) || options.length < 2 || options.length > 20) {
    throw new GuildDomainError("INVALID_INPUT", "A Decision requires between 2 and 20 options.");
  }
  const labels = new Set<string>();
  for (const option of options) {
    assertNonBlank(option.label, "Decision option label", 200);
    if (typeof option.description !== "string" || option.description.length > 5_000) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Decision option description must be at most 5,000 characters.",
      );
    }
    const key = option.label.trim().toLocaleLowerCase("en-US");
    if (labels.has(key)) {
      throw new GuildDomainError("INVALID_INPUT", "Decision option labels must be unique.");
    }
    labels.add(key);
  }
}

export function assertDecisionReview(
  verdict: string,
  selectedOptionId: string | null,
  reason: string,
): asserts verdict is "approve" | "reject" {
  if (verdict !== "approve" && verdict !== "reject") {
    throw new GuildDomainError("INVALID_INPUT", "Decision review verdict is invalid.");
  }
  assertNonBlank(reason, "Decision review reason", 5_000);
  if (verdict === "approve" && !selectedOptionId) {
    throw new GuildDomainError("INVALID_INPUT", "An approval must select a Decision option.");
  }
  if (verdict === "reject" && selectedOptionId !== null) {
    throw new GuildDomainError("INVALID_INPUT", "A rejection cannot select a Decision option.");
  }
}
