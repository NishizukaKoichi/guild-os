import {
  COLLECTIVE_TEMPLATES,
  HUMAN_ONLY_PERMISSIONS,
  type CollectiveOnboardingAnswers,
} from "@guild-os/domain";
import { describe, expect, it } from "vitest";
import {
  buildTemplateProvisioningPlan,
  type TemplateProvisioningIds,
} from "../src/template-provisioning.js";

const answers: CollectiveOnboardingAnswers = {
  purpose: "Coordinate a shared mission",
  participants: "Humans and governed Agents",
  memoryIntent: "Evidence and operating knowledge",
  activityIntent: "Reviewable work",
  decisionStyle: "Human approval",
};

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function ids(roleCount: number, workflowCount: number, hasAgent: boolean): TemplateProvisioningIds {
  return {
    roles: Array.from({ length: roleCount }, (_, index) => uuid(10 + index)),
    agentRole: hasAgent ? uuid(30) : null,
    agent: hasAgent ? uuid(31) : null,
    accessVerifierRole: uuid(32),
    accessVerifierService: uuid(33),
    federationRuntimeRole: uuid(34),
    federationRuntimeService: uuid(35),
    workflows: Array.from({ length: workflowCount }, (_, index) => uuid(40 + index)),
    welcomeKnowledge: uuid(50),
    welcomeKnowledgeReview: uuid(51),
    initialActivity: uuid(52),
    onboardingPath: uuid(53),
    onboardingRequirements: [uuid(54), uuid(55), uuid(56)],
  };
}

describe("Template provisioning", () => {
  for (const template of COLLECTIVE_TEMPLATES) {
    it(`materializes roles, work, Memory, onboarding, and Agent defaults for ${template.key}`, () => {
      const plan = buildTemplateProvisioningPlan(
        template,
        answers,
        ids(template.roles.length, template.workflows.length, template.suggestedAgent !== null),
      );

      expect(plan.templateKey).toBe(template.key);
      expect(plan.bootstrapRoles.slice(0, template.roles.length).map((role) => role.name))
        .toEqual(template.roles.map((role) => role.name));
      expect(plan.workflows).toHaveLength(template.workflows.length);
      expect(plan.workflows.map((workflow) => workflow.name))
        .toEqual(template.workflows.map((workflow) => workflow.name));
      expect(plan.welcomeKnowledge.body).toContain(answers.purpose);
      expect(plan.initialActivity.type).toBe(template.activityTypes[0]);
      expect(plan.onboarding.requirements.map((requirement) => requirement.kind))
        .toEqual(["memory", "acknowledgement", "activity"]);
      expect(plan.onboarding.requirements[0]?.resourceId).toBe(plan.welcomeKnowledge.id);
      expect(plan.onboarding.requirements[2]?.resourceId).toBe(plan.initialActivity.id);
      expect(plan.accessVerifier.displayName).toBe("Cloudflare Access verifier");
      expect(plan.bootstrapRoles.find((role) => role.id === plan.accessVerifier.roleId)?.permissions)
        .toEqual(["data.read"]);
      expect(plan.federationRuntime.displayName).toBe("Guild Federation runtime");
      expect(plan.bootstrapRoles.find((role) => role.id === plan.federationRuntime.roleId)?.permissions)
        .toEqual(["federation.read"]);

      if (template.suggestedAgent === null) {
        expect(plan.suggestedAgent).toBeNull();
        expect(plan.bootstrapRoles).toHaveLength(template.roles.length + 2);
      } else {
        expect(plan.suggestedAgent?.displayName).toBe(template.suggestedAgent);
        expect(plan.suggestedAgent?.toolIds).toContain("memory_search");
        expect(plan.suggestedAgent?.toolIds).toContain("activity_draft");
        expect(plan.suggestedAgent?.toolIds.includes("agent_delegate"))
          .toBe(template.key === "agent-collective");
        const role = plan.bootstrapRoles.find((candidate) =>
          candidate.id === plan.suggestedAgent?.roleId);
        expect(role).toBeDefined();
        expect(role?.permissions.length).toBeGreaterThan(0);
        expect(role?.permissions.some((permission) => HUMAN_ONLY_PERMISSIONS.has(permission)))
          .toBe(false);
      }
    });
  }

  it("adds bounded delegation only to the Agent Collective preset", () => {
    for (const template of COLLECTIVE_TEMPLATES) {
      const plan = buildTemplateProvisioningPlan(
        template,
        answers,
        ids(template.roles.length, template.workflows.length, template.suggestedAgent !== null),
      );
      for (const workflow of plan.workflows) {
        expect(workflow.allowedActionKinds.includes("agent_delegate"))
          .toBe(template.key === "agent-collective");
      }
    }
  });
});
