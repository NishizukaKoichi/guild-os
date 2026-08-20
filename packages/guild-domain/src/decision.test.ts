import { describe, expect, it } from "vitest";
import {
  assertDecisionContent,
  assertDecisionMethod,
  assertDecisionOptions,
  assertDecisionReview,
  assertDecisionTransition,
} from "./decision.js";

describe("Decision governance", () => {
  it("supports the complete authoritative method set", () => {
    for (const method of [
      "custodian", "consent", "vote", "review", "editorial", "policy", "hybrid",
      "quorum_vote", "council", "agent_proposal_human_approval", "custom",
    ]) {
      expect(() => assertDecisionMethod(method)).not.toThrow();
    }
    expect(() => assertDecisionMethod("automatic_root")).toThrow(/invalid/);
  });

  it("accepts only explicit lifecycle transitions", () => {
    expect(() => assertDecisionTransition("draft", "proposed")).not.toThrow();
    expect(() => assertDecisionTransition("proposed", "approved")).not.toThrow();
    expect(() => assertDecisionTransition("approved", "superseded")).not.toThrow();
    expect(() => assertDecisionTransition("draft", "approved")).toThrow(/cannot transition/);
    expect(() => assertDecisionTransition("rejected", "draft")).toThrow(/cannot transition/);
  });

  it("requires distinct, bounded options and meaningful content", () => {
    expect(() => assertDecisionContent("Choose a path", "Compare the supported paths.", ""))
      .not.toThrow();
    expect(() => assertDecisionOptions([
      { label: "Option A", description: "First path" },
      { label: "Option B", description: "Second path" },
    ])).not.toThrow();
    expect(() => assertDecisionOptions([{ label: "Only", description: "" }]))
      .toThrow(/between 2 and 20/);
    expect(() => assertDecisionOptions([
      { label: "Same", description: "" },
      { label: "same", description: "" },
    ])).toThrow(/unique/);
  });

  it("requires an explicit option for approval and none for rejection", () => {
    expect(() => assertDecisionReview("approve", "option-id", "Supported by the evidence."))
      .not.toThrow();
    expect(() => assertDecisionReview("reject", null, "The evidence is incomplete."))
      .not.toThrow();
    expect(() => assertDecisionReview("approve", null, "Missing option."))
      .toThrow(/must select/);
    expect(() => assertDecisionReview("reject", "option-id", "Conflicting shape."))
      .toThrow(/cannot select/);
    expect(() => assertDecisionReview("abstain", null, "Unsupported verdict."))
      .toThrow(/verdict is invalid/);
  });
});
