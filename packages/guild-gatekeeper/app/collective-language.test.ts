import {
  COLLECTIVE_TEMPLATES,
  blueprintToCollectiveTemplate,
  collectiveTemplate,
  createDeterministicCollectiveBlueprint,
} from "@guild-os/domain";
import { describe, expect, it } from "vitest";
import type { UiCollectiveContext } from "../src/management-types";
import { localizeCollectiveContext, localizeTemplate } from "./collective-language";

function makeContext(): UiCollectiveContext {
  const template = collectiveTemplate("company");
  return {
    template,
    templates: COLLECTIVE_TEMPLATES,
    labels: { ...template.labels, members: "Custom members" },
    vocabularyOverrides: { members: "Custom members" },
    blueprint: null,
    blueprints: [],
    onboardingAnswers: {},
    templateVersion: 1,
    spaces: [{
      id: "operations",
      parentSpaceId: null,
      name: "Operations",
      vocabularyProfileKey: null,
      blueprintKey: null,
      labels: template.labels,
      canConfigure: true,
    }, {
      id: "laboratory",
      parentSpaceId: null,
      name: "Laboratory",
      vocabularyProfileKey: "research",
      blueprintKey: null,
      labels: collectiveTemplate("research").labels,
      canConfigure: true,
    }, {
      id: "community",
      parentSpaceId: null,
      name: "Community",
      vocabularyProfileKey: "community",
      blueprintKey: null,
      labels: collectiveTemplate("community").labels,
      canConfigure: true,
    }],
    canConfigure: true,
    canConfigureSpaces: true,
  };
}

describe("Context Profile localization", () => {
  it("uses canonical English copy when English is selected", () => {
    const company = collectiveTemplate("company");
    expect(localizeTemplate(company, "en")).toBe(company);

    const localized = localizeCollectiveContext(makeContext(), "en");
    expect(localized.template.name).toBe("Company");
    expect(localized.labels.members).toBe("Custom members");
    expect(localized.spaces[0]?.labels.members).toBe("Custom members");
    expect(localized.spaces[1]?.labels.activityItem).toBe("Study");
    expect(localized.spaces[2]?.labels.coordinator).toBe("Moderator");
  });

  it("localizes the Guild profile and each Space override independently in Japanese", () => {
    const source = makeContext();
    const localized = localizeCollectiveContext(source, "ja");

    expect(localized.template.name).toBe("会社");
    expect(localized.labels.members).toBe("Custom members");
    expect(localized.labels.activity).toBe("仕事");
    expect(localized.spaces[0]?.labels.members).toBe("Custom members");
    expect(localized.spaces[0]?.labels.activityItem).toBe("タスク");
    expect(localized.spaces[1]?.labels.members).toBe("研究メンバー");
    expect(localized.spaces[1]?.labels.activityItem).toBe("研究");
    expect(localized.spaces[2]?.labels.members).toBe("メンバー");
    expect(localized.spaces[2]?.labels.coordinator).toBe("モデレーター");

    expect(source.template.name).toBe("Company");
    expect(source.spaces[1]?.labels.activityItem).toBe("Study");
  });

  it("localizes Space-specific language in Simplified Chinese without changing its operating profile", () => {
    const localized = localizeCollectiveContext(makeContext(), "zh-CN");
    const laboratory = localized.spaces.find(({ id }) => id === "laboratory");
    const community = localized.spaces.find(({ id }) => id === "community");

    expect(localized.template.name).toBe("公司");
    expect(laboratory?.vocabularyProfileKey).toBe("research");
    expect(laboratory?.labels.activity).toBe("研究活动");
    expect(laboratory?.labels.decision).toBe("研究决策");
    expect(community?.vocabularyProfileKey).toBe("community");
    expect(community?.labels.activityItem).toBe("倡议");
    expect(community?.labels.coordinator).toBe("版主");
  });

  it("presents an active customized Blank context without renaming the raw Blank option", () => {
    const blank = collectiveTemplate("blank");
    const source: UiCollectiveContext = {
      ...makeContext(),
      template: blank,
      labels: { ...blank.labels, members: "Contributors" },
      vocabularyOverrides: { members: "Contributors" },
      spaces: [{
        id: "custom",
        parentSpaceId: null,
        name: "Custom",
        vocabularyProfileKey: null,
        blueprintKey: null,
        labels: blank.labels,
        canConfigure: true,
      }],
    };

    const localized = localizeCollectiveContext(source, "en", {
      name: "Other / Build your own",
      description: "Guided custom context",
    });

    expect(localized.template.name).toBe("Other / Build your own");
    expect(localized.labels.members).toBe("Contributors");
    expect(localized.templates.find(({ key }) => key === "blank")?.name).toBe("Blank Guild");
  });

  it("preserves purchaser-authored Blueprint content when the UI locale changes", () => {
    const draft = createDeterministicCollectiveBlueprint({
      locale: "ja",
      answers: {
        purpose: "家族で暮らしと子育ての知恵を共有する",
        participants: "家族とAIアシスタント",
        memoryIntent: "家族の知恵と予定を残す",
        activityIntent: "家事、ケア、行事を進める",
        decisionStyle: "家族で話し合い、責任者が確認する",
      },
    });
    const timestamp = "2026-08-16T00:00:00.000Z";
    const record = {
      ...draft,
      version: 1,
      status: "active" as const,
      system: false,
      createdByActorId: "owner",
      updatedByActorId: "owner",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const template = blueprintToCollectiveTemplate(record);
    const source: UiCollectiveContext = {
      ...makeContext(),
      template,
      labels: template.labels,
      vocabularyOverrides: {},
      blueprint: record,
      blueprints: [record],
      spaces: [{
        id: "family-care",
        parentSpaceId: null,
        name: "ケア",
        vocabularyProfileKey: null,
        blueprintKey: record.key,
        labels: record.definition.labels,
        canConfigure: true,
      }],
    };

    const localized = localizeCollectiveContext(source, "zh-CN");
    expect(localized.template.name).toBe("家族の共有室");
    expect(localized.labels.activity).toBe("共同生活");
    expect(localized.spaces[0]?.labels.memory).toBe("家族の記憶");
    expect(localized.templates.find(({ key }) => key === "blank")?.name).toBe("空白 Guild");
  });

  it("provides localized names, descriptions, and complete labels for every profile", () => {
    for (const locale of ["en", "ja", "zh-CN"] as const) {
      for (const template of COLLECTIVE_TEMPLATES) {
        const localized = localizeTemplate(template, locale);
        expect(localized.name.trim(), `${locale}.${template.key}.name`).not.toBe("");
        expect(localized.description.trim(), `${locale}.${template.key}.description`).not.toBe("");
        expect(Object.values(localized.labels)).toHaveLength(19);
        for (const [key, value] of Object.entries(localized.labels)) {
          expect(value.trim(), `${locale}.${template.key}.labels.${key}`).not.toBe("");
        }
      }
    }
  });
});
