import { expect, test, type Page } from "playwright/test";
import { navigateToMore } from "./navigation";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function acceptConfirmation(page: Page): Promise<void> {
  page.once("dialog", (dialog) => dialog.accept());
}

test("runs a complete Goal to Step workflow", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Structured work");
  await expect(page.getByRole("heading", { name: "Verify the onboarding research request" })).toBeVisible();

  await page.getByRole("button", { name: "Create Goal", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Launch the evidence review practice");
  await dialog.getByLabel("Description", { exact: true }).fill("Make every operational review traceable to approved Knowledge.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Launch the evidence review practice", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create Project", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Pilot evidence reviews");
  await dialog.getByLabel("Description", { exact: true }).fill("Run a fictional end-to-end review with an accountable owner.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Pilot evidence reviews", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create Quest", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Review the fictional intake packet");
  await dialog.getByLabel("Description", { exact: true }).fill("Compare the packet with canonical procedure and record cited findings.");
  await dialog.getByLabel("Assignee").selectOption({ label: "Research Synthesizer" });
  await dialog.getByLabel("Source Knowledge IDs").fill("018f1f3e-7b5a-7d40-8f43-4fe1dc555aa3");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review the fictional intake packet" })).toBeVisible();

  await page.getByRole("button", { name: "Add Step", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Submit a cited review");
  await dialog.getByLabel("Description", { exact: true }).fill("Attach each finding to approved Knowledge.");
  await dialog.getByLabel("Assignee").selectOption({ label: "Research Synthesizer" });
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  const step = page.locator(".work-step-row").filter({ hasText: "Submit a cited review" });
  await expect(step).toBeVisible();
  await acceptConfirmation(page);
  await step.getByLabel("Change status").selectOption("completed");
  await expect(step.getByLabel("Change status")).toHaveValue("completed");

  const questStatus = page.locator(".work-detail-header").getByLabel("Change status");
  await questStatus.selectOption("in_progress");
  await expect(questStatus).toHaveValue("in_progress");
  await acceptConfirmation(page);
  await questStatus.selectOption("completed");
  await expect(questStatus).toHaveValue("completed");

  const project = page.locator(".work-outline-row").filter({ hasText: "Pilot evidence reviews" });
  await project.getByLabel("Change status").selectOption("active");
  await acceptConfirmation(page);
  await project.getByLabel("Change status").selectOption("completed");
  await expect(project.getByLabel("Change status")).toHaveValue("completed");

  const goal = page.locator(".work-outline-row").filter({ hasText: "Launch the evidence review practice" });
  await goal.getByLabel("Change status").selectOption("active");
  await acceptConfirmation(page);
  await goal.getByLabel("Change status").selectOption("completed");
  await expect(goal.getByLabel("Change status")).toHaveValue("completed");

  await page.getByRole("button", { name: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa3" }).click();
  await expect(page.getByRole("heading", { name: "Research intake procedure" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the Work hierarchy operable in a mobile viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await navigateToMore(page, "Structured work");
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Verify the onboarding research request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Step", exact: true })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
