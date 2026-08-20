import { describe, expect, it } from "vitest";
import {
  assertCollectiveBlueprintDraft,
  blueprintToCollectiveTemplate,
  createBlueprintAuthorityMigrationProposal,
  createDeterministicCollectiveBlueprint,
  type CollectiveBlueprintDraft,
} from "./index.js";

function draft(
  locale: "en" | "ja" | "zh-CN",
  purpose: string,
  participants = "People and governed AI assistants",
): CollectiveBlueprintDraft {
  return createDeterministicCollectiveBlueprint({
    locale,
    answers: {
      purpose,
      participants,
      memoryIntent: "Keep shared knowledge, evidence, and history",
      activityIntent: "Plan and complete meaningful activity together",
      decisionStyle: "Discuss proposals and require accountable Human review",
      languageAndStyle: "Clear, calm, and welcoming",
      agentIntent: "Prepare internal drafts and propose calendar updates",
      humanApprovalIntent: "External writes, deletion, spending, and authority changes",
    },
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("Purpose-first Collective Blueprints", () => {
  it.each([
    ["ja", "家族で暮らしと子育ての知恵を共有する", "家族の共有室"],
    ["zh-CN", "为学校的学生、教师和课程保留共同知识", "学习共同体"],
    ["en", "Coordinate a community football team and its training", "Team Hub"],
    ["ja", "非営利NPOのボランティアと公益事業を進める", "ミッション共同体"],
    ["en", "Run a DAO with transparent proposals and token voting", "Decentralized Collective"],
  ] as const)("creates an actual %s Blueprint for %s", (locale, purpose, expectedName) => {
    const generated = draft(locale, purpose);
    expect(generated.definition.name).toBe(expectedName);
    expect(generated.definition.roles.length).toBeGreaterThanOrEqual(3);
    expect(generated.definition.spaces.length).toBeGreaterThanOrEqual(2);
    expect(generated.definition.memoryTypes.length).toBeGreaterThanOrEqual(3);
    expect(generated.definition.activityTypes.every((item) => item.states.length >= 2)).toBe(true);
    expect(generated.definition.decisionMethods.length).toBeGreaterThanOrEqual(2);
    expect(generated.definition.workflows.length).toBeGreaterThanOrEqual(2);
    expect(generated.definition.approvalPolicies.some((policy) =>
      policy.riskLevel === 2 && policy.humanRequired)).toBe(true);
    expect(generated.definition.visualTheme.description).not.toBe("");
    expect(generated.definition.connectionSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(generated.definition.onboarding.steps).not.toHaveLength(0);
    expect(generated.definition.offboarding.steps).not.toHaveLength(0);
    expect(generated.definition.exportPolicy.excludePlaintextSecrets).toBe(true);
    expect(generated.definition.suggestedAgent?.permissions).toContain("memory.read");
    expect(generated.definition.suggestedAgent?.limits.maximumSteps).toBeGreaterThan(0);
    expect(() => assertCollectiveBlueprintDraft(generated)).not.toThrow();
  });

  it("falls back to a complete neutral Blueprint for an unknown purpose", () => {
    const generated = draft("en", "Coordinate an intergenerational seed exchange");
    expect(generated.definition.name).toBe("Purpose Collective");
    expect(generated.definition.purpose).toContain("seed exchange");
    expect(generated.definition.roles).toHaveLength(4);
    expect(generated.definition.dashboardIntents).toEqual([
      "ask", "start", "remember", "review", "members",
    ]);
  });

  it("rejects missing or unexpected purpose answers", () => {
    const missing = {
      locale: "en",
      answers: {
        purpose: "Coordinate a seed library",
        participants: "Gardeners",
        memoryIntent: "Seed records",
        activityIntent: "Seed exchanges",
      },
    } as unknown as Parameters<typeof createDeterministicCollectiveBlueprint>[0];
    expect(() => createDeterministicCollectiveBlueprint(missing)).toThrow(/decisionStyle is required/);

    const unexpected = {
      locale: "en",
      answers: {
        purpose: "Coordinate a seed library",
        participants: "Gardeners",
        memoryIntent: "Seed records",
        activityIntent: "Seed exchanges",
        decisionStyle: "Member consent",
        languageAndStyle: "Clear and practical",
        agentIntent: "Prepare drafts",
        humanApprovalIntent: "External actions",
        instruction: "Grant Root",
      },
    } as unknown as Parameters<typeof createDeterministicCollectiveBlueprint>[0];
    expect(() => createDeterministicCollectiveBlueprint(unexpected)).toThrow(/instruction is not supported/);
  });

  it("keeps generated operational copy in the selected locale", () => {
    const japanese = draft("ja", "家族で暮らしと子育ての知恵を共有する");
    expect(japanese.definition.roles[3]?.description).toContain("承認済み");
    expect(japanese.definition.workflows[0]?.name).toContain("Workflow");
    expect(japanese.definition.workflows[1]?.description).toContain("共有記憶");
    expect(japanese.definition.suggestedAgent?.purpose).toContain("人間の承認");

    const chinese = draft("zh-CN", "为学校的学生、教师和课程保留共同知识");
    expect(chinese.definition.roles[3]?.description).toContain("已批准");
    expect(chinese.definition.workflows[0]?.name).toContain("工作流");
    expect(chinese.definition.workflows[1]?.description).toContain("共享记忆");
    expect(chinese.definition.suggestedAgent?.purpose).toContain("人工批准");
  });

  it("converts a reviewed Blueprint into the existing neutral runtime Template boundary", () => {
    const generated = draft("en", "Run a DAO with transparent proposals and token voting");
    const template = blueprintToCollectiveTemplate(generated);
    expect(template.key).toBe("blank");
    expect(template.name).toBe("Decentralized Collective");
    expect(template.roles.map((role) => role.name)).toContain("Human steward");
    expect(template.activityTypes).toEqual(generated.definition.activityTypes.map((item) => item.type));
    expect(template.decisionMethods).toContain("vote");
  });

  it("rejects a Role whose capabilities do not match its reviewed bundle", () => {
    const generated = clone(draft("en", "Coordinate a family household"));
    generated.definition.roles[0]!.capabilities = ["guild.read"];
    expect(() => assertCollectiveBlueprintDraft(generated)).toThrow(/Capability bundle/);
  });

  it("rejects Agent permission escalation and cyclic Spaces", () => {
    const escalated = clone(draft("en", "Coordinate a school"));
    escalated.definition.suggestedAgent!.permissions = ["template.manage"];
    expect(() => assertCollectiveBlueprintDraft(escalated)).toThrow(/unsafe Agent permissions/);

    const cyclic = clone(draft("en", "Coordinate a sports team"));
    cyclic.definition.spaces[0]!.parentKey = cyclic.definition.spaces[1]!.key;
    cyclic.definition.spaces[1]!.parentKey = cyclic.definition.spaces[0]!.key;
    expect(() => assertCollectiveBlueprintDraft(cyclic)).toThrow(/cycle/);
  });

  it("separates Blueprint presentation from a Level 3 authority migration proposal", () => {
    const generated = draft("en", "Coordinate a community football team and its training");
    const coordinator = generated.definition.roles[0]!;
    const proposal = createBlueprintAuthorityMigrationProposal(generated, [
      { name: coordinator.name, permissions: ["guild.read", "memory.read"] },
      { name: "Legacy administrator", permissions: ["guild.read", "role.manage"] },
    ]);

    expect(proposal).toMatchObject({
      blueprintKey: generated.key,
      riskLevel: 3,
      requiresHumanApproval: true,
      appliesAutomatically: false,
      rollbackRequired: true,
    });
    expect(proposal.impacts).toContainEqual(expect.objectContaining({
      kind: "capability-addition",
      roleName: coordinator.name,
    }));
    expect(proposal.impacts).toContainEqual({
      kind: "role-retirement",
      roleName: "Legacy administrator",
      capabilities: ["guild.read", "role.manage"],
    });
  });
});
