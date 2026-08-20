import {
  COLLECTIVE_TEMPLATES,
  blueprintToCollectiveTemplate,
  collectiveTemplate,
  createDeterministicCollectiveBlueprint,
} from "@guild-os/domain";
import { describe, expect, it } from "vitest";
import type { UiCollectiveContext } from "../src/management-types";
import {
  contextActivityTypeLabel,
  contextDecisionMethodLabel,
  contextMemoryTypeLabel,
  contextProfileForSpace,
  visibleActivityTypes,
  visibleMemoryTypes,
} from "./collective-context";

describe("Space Blueprint context", () => {
  it("overrides the complete operating profile rather than labels alone", () => {
    const guildTemplate = collectiveTemplate("company");
    const draft = createDeterministicCollectiveBlueprint({
      locale: "en",
      answers: {
        purpose: "Coordinate a community football team and its training",
        participants: "Players, coaches, volunteers, and a team assistant",
        memoryIntent: "Keep playbooks, training notes, and team history",
        activityIntent: "Run training, matches, and team events",
        decisionStyle: "Coach review with team consent for major changes",
        languageAndStyle: "Energetic and practical",
        agentIntent: "Prepare training and calendar drafts",
        humanApprovalIntent: "External messages and team selection changes",
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
    const collective: UiCollectiveContext = {
      template: guildTemplate,
      templates: COLLECTIVE_TEMPLATES,
      labels: guildTemplate.labels,
      vocabularyOverrides: {},
      blueprint: null,
      blueprints: [record],
      onboardingAnswers: {},
      templateVersion: 1,
      spaces: [{
        id: "team-space",
        parentSpaceId: null,
        name: "Team",
        vocabularyProfileKey: null,
        blueprintKey: record.key,
        labels: record.definition.labels,
        canConfigure: true,
      }],
      canConfigure: true,
      canConfigureSpaces: true,
    };

    const profile = contextProfileForSpace(collective, "team-space");
    const expected = blueprintToCollectiveTemplate(record);
    expect(profile.name).toBe("Team Hub");
    expect(profile.activityTypes).toEqual(expected.activityTypes);
    expect(profile.memoryTypes).toEqual(expected.memoryTypes);
    expect(profile.decisionMethods).toEqual(expected.decisionMethods);
    expect(profile.suggestedAgent).toBe("Team operations assistant");
    expect(contextActivityTypeLabel(collective, expected.activityTypes[0]!, "en", "team-space"))
      .toBe("Training session");
    expect(contextMemoryTypeLabel(collective, expected.memoryTypes[0]!, "en", "team-space"))
      .toBe("Playbook");
    expect(contextDecisionMethodLabel(collective, expected.decisionMethods[0]!, "en", "team-space"))
      .toBe("Coach review");
    expect(visibleActivityTypes(collective)).toEqual(expect.arrayContaining([...expected.activityTypes]));
    expect(visibleMemoryTypes(collective)).toEqual(expect.arrayContaining([...expected.memoryTypes]));
  });
});
