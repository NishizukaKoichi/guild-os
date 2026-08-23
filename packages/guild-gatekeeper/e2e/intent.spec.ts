import { expect, test, type Page } from "playwright/test";
import { COMPACT_NAVIGATION_MAX_WIDTH } from "../app/navigation";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function openAsk(page: Page) {
  const navigation = (page.viewportSize()?.width ?? 1_024) <= COMPACT_NAVIGATION_MAX_WIDTH
    ? page.locator(".mobile-tabbar")
    : page.locator(".sidebar");
  await navigation.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ask Guild", exact: true })).toBeVisible();
}

async function confirmNextAction(page: Page) {
  await page.getByRole("checkbox", {
    name: /I reviewed the next action and confirm this execution/,
  }).check();
  await page.getByRole("button", {
    name: /Execute next action|Check Agent result/,
  }).click();
}

test("keeps Ask read-only and executes an inspectable Plan one durable action at a time", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1_000 });
  await page.goto("?standalone=root");
  await openAsk(page);

  await page.getByRole("button", { name: "Act", exact: true }).click();
  await expect(page.getByText("No inspectable plans have been created yet.", { exact: true })).toBeVisible();

  await page.locator(".ask-mode-control").getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Question", { exact: true }).fill("How should we start a governed research request?");
  await page.getByRole("button", { name: "Get answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answer", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Turn this answer into a plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create an inspectable plan", exact: true })).toBeVisible();
  await expect(page.getByText("Authorized sources: 1", { exact: true })).toBeVisible();
  await page.locator("#ask-plan-objective")
    .fill("Create, verify, and route a governed research request");
  await page.getByRole("button", { name: "Create plan", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Inspect, confirm, then act", exact: true })).toBeVisible();
  await expect(page.getByText("Propose working memory", { exact: true })).toBeVisible();
  await expect(page.getByText("Create activity", { exact: true })).toBeVisible();
  await expect(page.getByText("Start governed Agent run", { exact: true })).toBeVisible();
  await expect(page.getByText("memory.create", { exact: true })).toBeVisible();
  await expect(page.getByText("activity.create", { exact: true })).toBeVisible();
  await expect(page.getByText("agent.run", { exact: true })).toBeVisible();
  await expect(page.getByText("Level 2 · Consequential or external write", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Required durable human approvals: 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires", { exact: true })).toBeVisible();
  await page.locator(".ask-intent-evidence summary").click();
  await expect(page.getByText("Research intake procedure", { exact: true })).toBeVisible();
  await expect(page.getByText("Research Synthesizer", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No provider cost", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/USD\s*0\.25/)).toBeVisible();
  await expect(page.getByText("45 seconds", { exact: true })).toBeVisible();
  await expect(page.getByText("Writes outside this collective", { exact: true })).toBeVisible();
  await expect(page.getByText("No automatic undo", { exact: true })).toBeVisible();

  const actions = page.locator(".intent-action");
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0).getByText("Pending", { exact: true })).toBeVisible();
  await expect(actions.nth(1).getByText("Pending", { exact: true })).toBeVisible();

  await confirmNextAction(page);
  await expect(page.getByText("One action succeeded. Review the next action before continuing.", { exact: true }))
    .toBeVisible();
  await expect(actions.nth(0).getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(actions.nth(1).getByText("Pending", { exact: true })).toBeVisible();

  await confirmNextAction(page);
  await expect(actions.nth(1).getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(actions.nth(2).getByText("Pending", { exact: true })).toBeVisible();

  await confirmNextAction(page);
  await expect(actions.nth(2).getByText("Agent running", { exact: true })).toBeVisible();
  await expect(page.getByText("The Agent run has its own approval gate", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check Agent result", exact: true })).toBeVisible();

  await confirmNextAction(page);
  await expect(page.getByText("The Agent run is still waiting or running. No duplicate run was created.", {
    exact: true,
  })).toBeVisible();
  await confirmNextAction(page);
  await expect(page.getByText("All actions completed", { exact: true })).toBeVisible();
  await expect(actions.nth(2).getByText("Succeeded", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps Plan inspection and Act confirmation usable on a phone viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await openAsk(page);

  await page.getByLabel("Question", { exact: true }).fill("What evidence should this study use?");
  await page.getByRole("button", { name: "Get answer", exact: true }).click();
  await page.getByRole("button", { name: "Turn this answer into a plan", exact: true }).click();
  await page.getByRole("button", { name: "Create plan", exact: true }).click();

  await expect(page.getByText("Propose working memory", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", {
    name: /I reviewed the next action and confirm this execution/,
  })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);

  await page.getByLabel("Language", { exact: true }).selectOption("ja");
  await expect(page.getByRole("heading", { name: "確認してから、一件ずつ実行", exact: true })).toBeVisible();
  await expect(page.getByText("作業用の記憶を提案", { exact: true })).toBeVisible();
  await page.getByLabel("言語", { exact: true }).selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "检查、确认，然后逐项执行", exact: true })).toBeVisible();
  await expect(page.getByText("提议工作记忆", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
