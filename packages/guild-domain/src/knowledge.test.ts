import { describe, expect, it } from "vitest";
import { canTransitionKnowledge } from "./knowledge.js";

describe("Knowledge lifecycle", () => {
  it("requires proposal and approval before Canonical state", () => {
    expect(canTransitionKnowledge("draft", "proposed")).toBe(true);
    expect(canTransitionKnowledge("proposed", "canonical")).toBe(true);
    expect(canTransitionKnowledge("draft", "canonical")).toBe(false);
    expect(canTransitionKnowledge("canonical", "draft")).toBe(false);
  });

  it("does not revive archived knowledge", () => {
    expect(canTransitionKnowledge("archived", "draft")).toBe(false);
  });
});
