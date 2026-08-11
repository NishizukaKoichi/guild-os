import { describe, expect, it } from "vitest";
import {
  assertKnowledgeContent,
  assertKnowledgeReview,
  canTransitionKnowledge,
  resolveLocalizedText,
} from "./knowledge.js";

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

  it("validates aligned multilingual content and resolves a deterministic fallback", () => {
    expect(() => assertKnowledgeContent(
      { en: "Opening procedure", ja: "開店手順" },
      { en: "Daily checklist", ja: "日次チェック" },
      { en: "Open the register.", ja: "レジを起動します。" },
    )).not.toThrow();
    expect(() => assertKnowledgeContent(
      { en: "Opening procedure" },
      { ja: "日次チェック" },
      { en: "Open the register." },
    )).toThrow("same languages");
    expect(resolveLocalizedText({ ja: "日本語", en: "English" }, "zh-CN")).toBe("日本語");
  });

  it("requires an auditable review reason", () => {
    expect(() => assertKnowledgeReview("approve", "Verified against the current policy."))
      .not.toThrow();
    expect(() => assertKnowledgeReview("request_changes", " ")).toThrow("review reason");
  });
});
