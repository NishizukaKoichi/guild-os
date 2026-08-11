import { describe, expect, it } from "vitest";
import {
  assertConversationMentions,
  assertConversationStatusTransition,
  assertConversationSubjectType,
  normalizeConversationBody,
} from "./conversation.js";

describe("conversation policy", () => {
  it("normalizes bounded comments and rejects unsupported subjects", () => {
    expect(normalizeConversationBody("  Preserve this context.  ")).toBe("Preserve this context.");
    expect(() => normalizeConversationBody("   ")).toThrow("Comment must be non-blank");
    expect(() => assertConversationSubjectType("knowledge")).not.toThrow();
    expect(() => assertConversationSubjectType("private_message")).toThrow("not supported");
  });

  it("requires unique bounded mentions and real status changes", () => {
    expect(() => assertConversationMentions(["one", "two"])).not.toThrow();
    expect(() => assertConversationMentions(["one", "one"])).toThrow("unique mentions");
    expect(() => assertConversationStatusTransition("open", "locked")).not.toThrow();
    expect(() => assertConversationStatusTransition("open", "open")).toThrow("must change");
  });
});
