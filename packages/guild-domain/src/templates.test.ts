import { describe, expect, it } from "vitest";
import {
  COLLECTIVE_TEMPLATE_KEYS,
  COLLECTIVE_TEMPLATES,
  type CollectiveTemplate,
} from "./index.js";

const EXPECTED_DASHBOARD_INTENTS = [
  "ask",
  "remember",
  "start",
  "review",
  "members",
] as const;

function expectUnique(values: readonly string[], label: string): void {
  expect(new Set(values).size, `${label} contains duplicate values`).toBe(values.length);
}

function expectNonBlank(value: string, label: string): void {
  expect(value.trim(), `${label} must not be blank`).not.toBe("");
}

function roleSignature(template: CollectiveTemplate): string {
  return JSON.stringify(template.roles
    .map((role) => ({
      name: role.name,
      capabilities: [...role.capabilities].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name)));
}

function workflowSignature(template: CollectiveTemplate): string {
  return JSON.stringify(template.workflows
    .map((workflow) => ({
      key: workflow.key,
      activityType: workflow.activityType,
      memoryType: workflow.memoryType,
      decisionMethod: workflow.decisionMethod,
    }))
    .sort((left, right) => left.key.localeCompare(right.key)));
}

describe("Collective template acceptance", () => {
  it("ships every supported Context Profile in its canonical order", () => {
    expect(COLLECTIVE_TEMPLATES.map(({ key }) => key)).toEqual(COLLECTIVE_TEMPLATE_KEYS);
    expectUnique(COLLECTIVE_TEMPLATES.map(({ key }) => key), "template keys");
  });

  it.each(COLLECTIVE_TEMPLATES)("keeps $key complete and internally consistent", (template) => {
    expectNonBlank(template.name, `${template.key}.name`);
    expectNonBlank(template.description, `${template.key}.description`);

    const labels = Object.entries(template.labels);
    expect(labels).toHaveLength(19);
    for (const [key, value] of labels) {
      expectNonBlank(value, `${template.key}.labels.${key}`);
    }

    expect(template.roles.length, `${template.key}.roles`).toBeGreaterThanOrEqual(3);
    expectUnique(template.roles.map(({ name }) => name), `${template.key}.roles`);
    for (const role of template.roles) {
      expectNonBlank(role.name, `${template.key}.role.name`);
      expect(role.capabilities.length, `${template.key}.${role.name}.capabilities`).toBeGreaterThan(0);
      expectUnique([...role.capabilities], `${template.key}.${role.name}.capabilities`);
    }

    expect(template.activityTypes.length, `${template.key}.activityTypes`).toBeGreaterThan(0);
    expect(template.memoryTypes.length, `${template.key}.memoryTypes`).toBeGreaterThan(0);
    expect(template.decisionMethods.length, `${template.key}.decisionMethods`).toBeGreaterThan(0);
    expectUnique([...template.activityTypes], `${template.key}.activityTypes`);
    expectUnique([...template.memoryTypes], `${template.key}.memoryTypes`);
    expectUnique([...template.decisionMethods], `${template.key}.decisionMethods`);

    expect([...template.dashboardIntents].sort()).toEqual([...EXPECTED_DASHBOARD_INTENTS].sort());
    expectUnique([...template.dashboardIntents], `${template.key}.dashboardIntents`);

    if (template.key === "blank") {
      expect(template.workflows).toEqual([]);
      expect(template.suggestedAgent).toBeNull();
    } else {
      expect(template.workflows.length, `${template.key}.workflows`).toBeGreaterThan(0);
      expectNonBlank(template.suggestedAgent ?? "", `${template.key}.suggestedAgent`);
    }

    expectUnique(template.workflows.map(({ key }) => key), `${template.key}.workflows`);
    for (const workflow of template.workflows) {
      expectNonBlank(workflow.key, `${template.key}.workflow.key`);
      expectNonBlank(workflow.name, `${template.key}.${workflow.key}.name`);
      expect(
        workflow.activityType !== null ||
          workflow.memoryType !== null ||
          workflow.decisionMethod !== null,
        `${template.key}.${workflow.key} must configure at least one behavior`,
      ).toBe(true);
      if (workflow.activityType !== null) {
        expect(template.activityTypes).toContain(workflow.activityType);
      }
      if (workflow.memoryType !== null) {
        expect(template.memoryTypes).toContain(workflow.memoryType);
      }
      if (workflow.decisionMethod !== null) {
        expect(template.decisionMethods).toContain(workflow.decisionMethod);
      }
    }
  });

  it("gives every profile a distinct operating model, not only different labels", () => {
    const signatures = {
      roles: COLLECTIVE_TEMPLATES.map(roleSignature),
      activityTypes: COLLECTIVE_TEMPLATES.map((template) => JSON.stringify([...template.activityTypes].sort())),
      memoryTypes: COLLECTIVE_TEMPLATES.map((template) => JSON.stringify([...template.memoryTypes].sort())),
      decisionMethods: COLLECTIVE_TEMPLATES.map((template) => JSON.stringify([...template.decisionMethods].sort())),
      workflows: COLLECTIVE_TEMPLATES.map(workflowSignature),
      dashboardIntents: COLLECTIVE_TEMPLATES.map((template) => JSON.stringify(template.dashboardIntents)),
      suggestedAgent: COLLECTIVE_TEMPLATES.map((template) => template.suggestedAgent ?? "<none>"),
    };

    const duplicates: string[] = [];
    for (const [dimension, values] of Object.entries(signatures)) {
      const profilesBySignature = new Map<string, string[]>();
      values.forEach((signature, index) => {
        const profiles = profilesBySignature.get(signature) ?? [];
        profiles.push(COLLECTIVE_TEMPLATES[index]!.key);
        profilesBySignature.set(signature, profiles);
      });
      for (const profiles of profilesBySignature.values()) {
        if (profiles.length > 1) duplicates.push(`${dimension}: ${profiles.join(", ")}`);
      }
    }
    expect(duplicates, "Every profile dimension must carry a distinct operating choice").toEqual([]);
  });
});
