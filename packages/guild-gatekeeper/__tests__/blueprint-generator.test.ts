import { describe, expect, it } from "vitest";
import { blueprintCapabilities, type CollectiveOnboardingAnswers } from "@guild-os/domain";
import { generatePurposeBlueprint, parseModelBlueprint } from "../src/blueprint-generator.js";

const answers: CollectiveOnboardingAnswers = {
  purpose: "Coordinate a neighborhood seed library",
  participants: "Gardeners, schools, volunteers, and an AI assistant",
  memoryIntent: "Seed provenance, growing notes, and seasonal history",
  activityIntent: "Exchange seeds, run workshops, and maintain the collection",
  decisionStyle: "Member consent with steward review for safety",
  languageAndStyle: "Warm, practical, and welcoming",
  agentIntent: "Prepare workshop drafts and propose calendar updates",
  humanApprovalIntent: "External messages, deletion, and member authority changes",
};

function modelCandidate() {
  return {
    name: "Seed Commons",
    description: "A shared operating home for a neighborhood seed library.",
    labels: {
      members: "Gardeners", member: "Gardener", human: "Person", agent: "AI helper",
      service: "Connected service", guildActor: "Partner garden", memory: "Seed library",
      memoryItem: "Seed record", remember: "Add seed knowledge", activity: "Seasonal work",
      activityItem: "Garden action", startActivity: "Start garden action", decisions: "Commons decisions",
      decision: "Commons decision", history: "Season log", join: "Join", leave: "Leave",
      participant: "Gardener", coordinator: "Seed steward",
    },
    roles: [
      { key: "steward", name: "Seed steward", description: "Coordinates the library.", capabilityBundle: "coordinate" },
      { key: "gardener", name: "Gardener", description: "Contributes seeds and knowledge.", capabilityBundle: "participate" },
      { key: "observer", name: "Observer", description: "Reads shared records.", capabilityBundle: "observe" },
    ],
    spaces: [
      { key: "library", name: "Seed library", description: "The shared collection.", parentKey: null },
      { key: "workshops", name: "Workshops", description: "Learning events.", parentKey: null },
    ],
    memoryTypes: [
      { type: "custom:seed_record", label: "Seed record", description: "Provenance and care." },
      { type: "custom:growing_note", label: "Growing note", description: "Seasonal evidence." },
    ],
    activityTypes: [
      { type: "custom:seed_exchange", label: "Seed exchange", description: "Exchange activity.", states: ["proposed", "planned", "active", "completed", "archived"] },
      { type: "custom:workshop", label: "Workshop", description: "Learning session.", states: ["proposed", "planned", "active", "completed", "archived"] },
    ],
    decisionMethods: [
      { key: "commons-consent", label: "Commons consent", description: "Seek consent.", method: "consent" },
    ],
    dashboardIntents: ["ask", "start", "remember", "review", "members"],
    workflows: [
      { key: "exchange-review", name: "Exchange review", description: "Review each exchange.", activityType: "custom:seed_exchange", memoryType: "custom:seed_record", decisionMethodKey: "commons-consent" },
    ],
    suggestedAgent: { name: "Seed librarian", purpose: "Find authorized seed knowledge.", roleKey: "gardener", toolIds: ["memory_search", "activity_draft"] },
  };
}

describe("Blueprint model boundary", () => {
  it("derives Capabilities server-side from model-selected bundles", () => {
    const result = parseModelBlueprint(
      { locale: "en", answers },
      { response: JSON.stringify(modelCandidate()) },
      "custom-seed-commons",
    );
    expect(result.generationMode).toBe("model-assisted");
    expect(result.definition.roles[0]?.capabilities).toEqual(blueprintCapabilities("coordinate"));
    expect(result.definition.suggestedAgent?.permissions).not.toContain("template.manage");
  });

  it("falls back to a complete deterministic Blueprint on invalid model output", async () => {
    const result = await generatePurposeBlueprint("en", answers, async () => ({
      ...modelCandidate(),
      roles: [{ key: "root", name: "Root", description: "Escalate", capabilityBundle: "root" }],
    }));
    expect(result.generationMode).toBe("deterministic");
    expect(result.generationWarnings).toEqual(["model-fallback"]);
    expect(result.definition.roles.length).toBeGreaterThanOrEqual(3);
  });
});
