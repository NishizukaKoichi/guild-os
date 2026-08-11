import { describe, expect, it } from "vitest";
import {
  assertGoalTransition,
  assertProjectTransition,
  assertQuestTransition,
  assertStepTransition,
  assertWorkText,
} from "./work.js";

describe("Work lifecycle", () => {
  it("allows explicit progress, completion, and reopening transitions", () => {
    expect(() => assertGoalTransition("active", "completed")).not.toThrow();
    expect(() => assertProjectTransition("blocked", "active")).not.toThrow();
    expect(() => assertQuestTransition("completed", "in_progress")).not.toThrow();
    expect(() => assertStepTransition("skipped", "pending")).not.toThrow();
  });

  it("rejects invalid shortcuts and malformed work text", () => {
    expect(() => assertGoalTransition("draft", "completed")).toThrow("cannot transition");
    expect(() => assertProjectTransition("planned", "completed")).toThrow("cannot transition");
    expect(() => assertQuestTransition("blocked", "completed")).toThrow("cannot transition");
    expect(() => assertStepTransition("skipped", "completed")).toThrow("cannot transition");
    expect(() => assertWorkText(" ", "description")).toThrow("non-blank");
    expect(() => assertWorkText("Valid", "x".repeat(10_001))).toThrow("10,000");
  });
});
