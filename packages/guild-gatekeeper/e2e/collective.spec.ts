import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "playwright/test";
import { navigateTo, navigateToMore } from "./navigation";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
}

async function discardAndClose(page: Page, dialog: Locator): Promise<void> {
  page.once("dialog", (confirmation) => void confirmation.accept());
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

test("shows Human, Agent, Service, and Guild in one Members surface", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");

  await navigateTo(page, "members");
  const members = page.locator(".identity-table");
  await expect(members.getByText("Avery Morgan", { exact: true })).toBeVisible();
  await expect(members.getByText("Research Synthesizer", { exact: true })).toBeVisible();
  await expect(members.getByText("Open Archive Bridge", { exact: true })).toBeVisible();
  await expect(members.getByText("Fictional Coastal Observatory", { exact: true })).toBeVisible();

  const filters = page.locator(".members-heading-row .segmented-control");
  await expect(filters.getByRole("button")).toHaveCount(5);
  await expect(filters.getByRole("button", { name: "Researcher", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Research agent", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Research service", exact: true })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Research partner", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("orders Home intents and Agent guidance from the active Guild profile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");

  await expect(page.locator(".home-action-copy strong")).toHaveText([
    "Ask a question",
    "Start research",
    "Record findings",
    "Review updates",
  ]);
  await expect(page.getByRole("button", { name: /Agent runs in progress/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Memory reviews/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Runs needing attention/ })).toBeVisible();
  await navigateTo(page, "members");
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Agent name", { exact: true }))
    .toHaveValue("Research synthesizer");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

  await navigateToMore(page, "Settings");
  await page.locator("#collective-template").selectOption("template:company");
  await page.locator(".collective-settings").getByRole("button", { name: "Apply profile", exact: true }).click();
  await navigateTo(page, "home");
  await expect(page.locator(".home-action-copy strong")).toHaveText([
    "Review updates",
    "Start work",
    "Ask a question",
    "Document",
  ]);
  expect(errors).toEqual([]);
});

test("creates broad Memory and recursive Activity without the legacy hierarchy", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");

  await navigateTo(page, "memory");
  await expect(page.getByText("Signals from the fictional coastal habitat study", { exact: true })).toBeVisible();
  await expect(page.getByText("Governed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record findings", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Fictional migration observation");
  await dialog.getByLabel("Summary", { exact: true }).fill("A working observation for review.");
  await dialog.getByLabel("Content", { exact: true }).fill("The fictional sample suggests a repeatable pattern.");
  await dialog.getByLabel("Change note", { exact: true }).fill("Capture the initial observation.");
  await dialog.getByRole("button", { name: "Record findings", exact: true }).click();
  const memory = page.locator(".memory-row").filter({ hasText: "Fictional migration observation" });
  await expect(memory).toBeVisible();
  await memory.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit memory", exact: true });
  await expect(dialog).toBeVisible();
  await page.locator("#memory-summary").fill("A revised working observation for review.");
  await page.locator("#memory-change-note").fill("Clarify that review is pending.");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(memory.getByText("A revised working observation for review.", { exact: true })).toBeVisible();

  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start research", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Explore a fictional signal");
  await dialog.getByLabel("Description", { exact: true }).fill("Coordinate a neutral Activity without Goal or Project parents.");
  await dialog.getByLabel("Assigned to", { exact: true }).selectOption({ label: "Research Synthesizer" });
  await dialog.getByRole("button", { name: "Start research", exact: true }).click();
  const activity = page.locator(".activity-row").filter({ hasText: "Explore a fictional signal" });
  await expect(activity).toBeVisible();
  await activity.getByLabel("Status", { exact: true }).selectOption("planned");
  await expect(activity.locator(".status-pill")).toHaveText("Planned");
  await activity.getByRole("button", { name: "Start research", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Parent activity", { exact: true })).toHaveValue(/.+/);
  await dialog.getByLabel("Type", { exact: true }).selectOption("experiment");
  await dialog.getByLabel("Title", { exact: true }).fill("Run a fictional validation experiment");
  await dialog.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(page.getByText("Run a fictional validation experiment", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("switches purpose profiles and applies a complete Space Context Profile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Settings");

  const settings = page.locator(".collective-settings");
  const template = page.locator("#collective-template");
  const expected = [
    ["blank", "Members", "Memory", "Activity"],
    ["company", "People", "Knowledge", "Work"],
    ["community", "Members", "Shared memory", "Initiatives"],
    ["creator", "Collaborators", "Creative memory", "Creations"],
    ["open-source", "Contributors", "Project memory", "Issues and initiatives"],
    ["agent-collective", "Actors", "Collective memory", "Runs and activities"],
    ["research", "Researchers", "Research memory", "Studies"],
  ] as const;
  for (const [value, members, memory, activity] of expected) {
    await template.selectOption(`template:${value}`);
    await settings.getByRole("button", { name: "Apply profile", exact: true }).click();
    await expect(page.locator(".sidebar").getByRole("button", { name: members, exact: true })).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("button", { name: memory, exact: true })).toBeVisible();
    await expect(page.locator(".sidebar").getByRole("button", { name: activity, exact: true })).toBeVisible();
  }

  const researchSpace = settings.locator('select[data-space-name="Research"]');
  await researchSpace.selectOption("template:creator");
  await expect(researchSpace).toHaveValue("template:creator");

  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start research", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Study",
    "Experiment",
    "Investigation",
    "Discussion",
  ]);
  await dialog.getByRole("combobox", { name: "Space", exact: true }).selectOption({ label: "Research" });
  await expect(dialog.getByText("Creator Collective", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Editorial review", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Creation",
    "Project",
    "Session",
    "Campaign",
  ]);
  await discardAndClose(page, dialog);

  await navigateTo(page, "memory");
  await page.getByRole("button", { name: "Record findings", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Space", { exact: true }).selectOption({ label: "Research" });
  await expect(dialog.getByText("Creator Collective", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Editorial review", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Artifact",
    "Experience",
    "Document",
    "Learning",
  ]);
  await discardAndClose(page, dialog);

  await navigateTo(page, "members");
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Agent name", { exact: true })).toHaveValue("Research synthesizer");
  await dialog.getByRole("combobox", { name: "Space", exact: true }).selectOption({ label: "Research" });
  await expect(dialog.getByLabel("Agent name", { exact: true })).toHaveValue("Editing companion");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
});

test("creates, edits, reuses, and applies a Purpose Blueprint without changing Roles", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Settings");

  const settings = page.locator(".collective-settings");
  const roles = page.locator(".settings-section").filter({
    has: page.getByRole("heading", { name: "Roles", exact: true }),
  });
  const rolesBefore = await roles.textContent();
  await settings.getByRole("button", { name: "Create from purpose", exact: true }).click();
  const answers = {
    purpose: "Coordinate a community football team and its training",
    participants: "Players, coaches, volunteers, and a team assistant",
    memoryIntent: "Keep playbooks, training notes, and team history",
    activityIntent: "Run training, matches, and team events",
    decisionStyle: "Coach review with team consent for major changes",
    languageAndStyle: "Energetic, clear, and practical",
    agentIntent: "Prepare training plans and propose calendar updates",
    humanApprovalIntent: "External messages and team selection changes",
  };
  for (const [key, value] of Object.entries(answers)) {
    await settings.locator(`[data-onboarding-field="${key}"]`).fill(value);
  }
  await settings.locator('[data-blueprint-action="generate"]').click();
  const review = settings.locator('[data-blueprint-builder="review"]');
  await expect(review.locator(".blueprint-editor-overview input").first()).toHaveValue("Team Hub");
  await review.locator(".blueprint-editor-overview input").first().fill("Harbor Football Club");
  await review.locator("summary").filter({ hasText: "Roles and capabilities" }).click();
  await review.locator(".blueprint-editor-item").nth(2)
    .getByLabel("Capability level").selectOption("observe");
  await review.locator("summary").filter({ hasText: "Recommended AI assistant" }).click();
  await review.locator(".blueprint-permission-details summary").click();
  await expect(review.locator(".blueprint-permission-details")).toContainText("memory.read");
  await expect(review.locator(".blueprint-permission-details")).not.toContainText("activity.create");
  await review.locator('[data-blueprint-action="save"]').click();
  await expect(settings.getByText("Blueprint saved. It is now available for the Guild and its Spaces.", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export Blueprint: Harbor Football Club", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadPath!, "utf8")) as {
    format: string;
    blueprint: { definition: { name: string } };
  };
  expect(exported).toMatchObject({
    format: "guild-os-collective-blueprint",
    blueprint: { definition: { name: "Harbor Football Club" } },
  });

  await settings.getByRole("button", { name: "Duplicate Blueprint: Harbor Football Club", exact: true }).click();
  const duplicate = settings.locator('[data-blueprint-builder="review"]');
  await expect(duplicate.locator(".blueprint-editor-overview input").first()).toHaveValue("Copy of Harbor Football Club");
  await duplicate.locator(".blueprint-editor-overview input").first().fill("Harbor Football Club Copy");
  await duplicate.locator('[data-blueprint-action="save"]').click();
  await expect(settings.locator(".collective-blueprint-list strong").getByText("Harbor Football Club Copy", { exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "Review authority migration: Harbor Football Club", exact: true }).click();
  const authority = settings.locator('[data-blueprint-builder="authority"]');
  await expect(authority.getByRole("heading", { name: "Authority migration proposal", exact: true })).toBeVisible();
  await expect(authority).toContainText("Level 3 - critical authority change");
  await expect(authority.getByRole("button", { name: /apply/i })).toHaveCount(0);
  const authorityDownloadPromise = page.waitForEvent("download");
  await authority.locator('[data-blueprint-action="export-authority"]').click();
  const authorityDownload = await authorityDownloadPromise;
  const authorityPath = await authorityDownload.path();
  expect(authorityPath).not.toBeNull();
  const authorityExport = JSON.parse(await readFile(authorityPath!, "utf8")) as {
    format: string;
    proposal: { appliesAutomatically: boolean; riskLevel: number };
  };
  expect(authorityExport).toMatchObject({
    format: "guild-os-authority-migration-proposal",
    proposal: { appliesAutomatically: false, riskLevel: 3 },
  });
  await authority.getByRole("button", { name: "Close", exact: true }).click();

  const researchSpace = settings.locator('select[data-space-name="Research"]');
  await researchSpace.selectOption({ label: "Harbor Football Club" });
  await expect(researchSpace.locator("option:checked")).toHaveText("Harbor Football Club");

  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start research", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Space", exact: true }).selectOption({ label: "Research" });
  await expect(dialog.getByText("Harbor Football Club", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Training session",
    "Match",
    "Team event",
  ]);
  await discardAndClose(page, dialog);

  await navigateToMore(page, "Settings");
  await page.locator("#collective-template").selectOption({ label: "Harbor Football Club" });
  await settings.getByRole("button", { name: "Apply profile", exact: true }).click();
  await expect(page.locator(".topbar-context")).toContainText("Harbor Football Club");

  await settings.getByRole("button", { name: "Edit Blueprint: Harbor Football Club", exact: true }).click();
  const edit = settings.locator('[data-blueprint-builder="review"]');
  await edit.locator(".blueprint-editor-overview input").first().fill("Harbor Football Operations");
  await edit.locator('[data-blueprint-action="save"]').click();
  await expect(page.locator(".topbar-context")).toContainText("Harbor Football Operations");

  await expect(roles).toHaveText(rolesBefore ?? "");
  await expect(roles).not.toContainText("Club administrator");
  expect(errors).toEqual([]);
});

test("adapts activity, memory, membership, and Actor behavior to the selected purpose", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");

  async function applyTemplate(value: string) {
    await navigateToMore(page, "Settings");
    await page.locator("#collective-template").selectOption(`template:${value}`);
    await page.locator(".collective-settings").getByRole("button", { name: "Apply profile", exact: true }).click();
  }

  await applyTemplate("community");
  await navigateTo(page, "decisions");
  await page.locator(".page-header").getByRole("button", { name: "Create Decision", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create a Decision", exact: true });
  await expect(dialog.getByRole("button", { name: "Community vote", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Community vote", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Decision method", exact: true }))
    .toHaveValue("vote");
  await expect(dialog.getByRole("combobox", { name: "Decision method", exact: true }).locator("option")).toHaveText([
    "Consent",
    "Vote",
  ]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start an initiative", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Event",
    "Discussion",
    "Campaign",
    "Ritual",
  ]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await applyTemplate("creator");
  await navigateTo(page, "memory");
  await page.getByRole("button", { name: "Save an idea", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Save an idea", exact: true });
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option").first()).toHaveText("Artifact");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start creating", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Prepare a fictional release");
  await dialog.getByLabel("Assigned to", { exact: true }).selectOption({ label: "Open Archive Bridge" });
  await dialog.getByRole("button", { name: "Start creating", exact: true }).click();
  const creation = page.locator(".activity-row").filter({ hasText: "Prepare a fictional release" });
  await expect(creation).toContainText("Open Archive Bridge");

  await applyTemplate("agent-collective");
  await navigateTo(page, "members");
  const actors = page.locator(".identity-table");
  await expect(actors.getByText("Avery Morgan", { exact: true })).toHaveCount(0);
  await expect(actors.getByText("Research Synthesizer", { exact: true })).toBeVisible();
  await expect(page.locator(".members-heading-row").getByRole("button", { name: "Agent", exact: true })).toBeVisible();

  await applyTemplate("company");
  await navigateTo(page, "members");
  await expect(page.locator(".identity-table").getByText("Preboarding", { exact: true })).toBeVisible();
  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start work", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true }).locator("option")).toHaveText([
    "Project",
    "Task",
    "Maintenance",
    "Investigation",
  ]);
  expect(errors).toEqual([]);
});

test("keeps Ask, Plan, and Act as explicit safety modes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const modes = page.locator(".ask-mode-control");
  await expect(modes.getByRole("button")).toHaveCount(3);
  await modes.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shape the next move inside the Guild" })).toBeVisible();
  await modes.getByRole("button", { name: "Act", exact: true }).click();
  await expect(page.getByText(/External writes are never hidden inside a question/)).toBeVisible();
  await modes.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Question", { exact: true }).fill("What is the research intake procedure?");
  await page.getByRole("button", { name: "Get answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answer", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 320] as const) {
  test(`switches every collective profile without losing its vocabulary at ${width}px`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("?standalone=root");
    const expected = [
      ["blank", "Members", "Memory", "Activity"],
      ["company", "People", "Knowledge", "Work"],
      ["community", "Members", "Shared memory", "Initiatives"],
      ["creator", "Collaborators", "Creative memory", "Creations"],
      ["open-source", "Contributors", "Project memory", "Issues and initiatives"],
      ["agent-collective", "Actors", "Collective memory", "Runs and activities"],
      ["research", "Researchers", "Research memory", "Studies"],
    ] as const;

    for (const [value, members, memory, activity] of expected) {
      await navigateToMore(page, "Settings");
      await page.locator("#collective-template").selectOption(`template:${value}`);
      await page.locator(".collective-settings")
        .getByRole("button", { name: "Apply profile", exact: true }).click();
      expect(await page.locator(".mobile-tabbar .mobile-tab span").allTextContents()).toEqual([
        "Home",
        "Ask",
        "Members",
        "Memory",
        "Activity",
        "More",
      ]);
      const mobileLabelsFit = await page.locator(".mobile-tabbar .mobile-tab span").evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth));
      expect(mobileLabelsFit).toBe(true);
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      const sidebar = page.locator(".sidebar");
      await expect(sidebar.getByRole("button", { name: members, exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: memory, exact: true })).toBeVisible();
      await expect(sidebar.getByRole("button", { name: activity, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await page.locator(".sidebar").getByRole("button", { name: "Close navigation", exact: true }).click();
    expect(errors).toEqual([]);
  });

  test(`keeps the neutral primary journeys operable at ${width}px`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("?standalone=root");
    await expectNoHorizontalOverflow(page);

    await navigateTo(page, "memory");
    await expect(page.getByRole("heading", { name: "Research memory", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await navigateTo(page, "activity");
    await expect(page.getByRole("heading", { name: "Studies", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.locator(".page-header").getByRole("button", { name: "Start research", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await navigateTo(page, "members");
    await expect(page.getByRole("heading", { name: "Researchers", exact: true, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}
