import { describe, expect, it } from "vitest";
import {
  actorMembershipToLegacyState,
  assertActivityTransition,
  assertActivityType,
  assertActorMembershipTransition,
  assertMemoryContent,
  assertMemoryType,
  COLLECTIVE_TEMPLATES,
  collectiveTemplate,
  legacyMembershipToActorState,
} from "./index.js";

describe("Actor-neutral Collective primitives", () => {
  it("maps legacy employment-shaped states without losing meaning", () => {
    expect(legacyMembershipToActorState("preboarding")).toBe("joined");
    expect(legacyMembershipToActorState("suspended")).toBe("paused");
    expect(legacyMembershipToActorState("departed")).toBe("left");
    expect(actorMembershipToLegacyState("blocked")).toBe("suspended");
  });

  it("supports neutral membership and recursive activity transitions", () => {
    expect(() => assertActorMembershipTransition("joined", "active")).not.toThrow();
    expect(() => assertActorMembershipTransition("left", "active")).toThrow();
    expect(() => assertActivityTransition("planned", "active")).not.toThrow();
    expect(() => assertActivityTransition("archived", "active")).toThrow();
  });

  it("allows built-in and namespaced custom Memory and Activity types", () => {
    expect(() => assertMemoryType("research")).not.toThrow();
    expect(() => assertMemoryType("custom:recipe")).not.toThrow();
    expect(() => assertActivityType("experiment")).not.toThrow();
    expect(() => assertActivityType("custom:mutual_aid")).not.toThrow();
    expect(() => assertMemoryType("recipe")).toThrow();
  });

  it("validates multilingual Memory content without forcing every supported language", () => {
    expect(() => assertMemoryContent(
      { ja: "観察" },
      { ja: "短い要約" },
      { ja: "観察した内容" },
    )).not.toThrow();
    expect(() => assertMemoryContent(
      { en: "Observation" },
      { ja: "不一致" },
      { en: "Body" },
    )).toThrow();
  });

  it("keeps Blank first-class and Company as one editable preset", () => {
    expect(COLLECTIVE_TEMPLATES.map((template) => template.key)).toEqual([
      "blank",
      "company",
      "community",
      "research",
      "creator",
      "open-source",
      "agent-collective",
    ]);
    expect(collectiveTemplate("blank").roles[0]?.name).toBe("Coordinator");
    expect(collectiveTemplate("company").roles.map((role) => role.name)).toContain("Staff");
    expect(collectiveTemplate("research").activityTypes).toContain("experiment");
    expect(collectiveTemplate("research").labels.activityItem).toBe("Study");
    expect(collectiveTemplate("community").decisionMethods).toContain("vote");
    expect(collectiveTemplate("agent-collective").workflows[0]?.decisionMethod).toBe("hybrid");
  });
});
