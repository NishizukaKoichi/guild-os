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

test("approves one external Agent action and kills another run", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Agent runs");

  await expect(page.getByRole("heading", { name: "Execution runs", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Publish the verified research completion event",
  })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("The endpoint, payload, authority, and limits are approved.");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByText("Succeeded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Execution completed", { exact: true })).toBeVisible();
  await expect(page.getByText(/HTTP status 202/)).toBeVisible();

  await page.getByRole("button", { name: "Plan action", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Objective").fill("Publish a governed demo handoff");
  await dialog.getByLabel("Expected outcome").fill("The fictional receiver records one signed handoff event.");
  await dialog.getByLabel("Event type").fill("guild.demo.handoff");
  await dialog.getByRole("button", { name: "Plan action", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Publish a governed demo handoff" })).toBeVisible();
  await expect(page.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Kill run", exact: true }).click();
  await expect(page.getByText("Killed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("The Agent run was killed and pending execution was cancelled.")).toBeVisible();

  const agentRow = page.locator(".identity-table .data-row").filter({ hasText: "Research Synthesizer" });
  page.once("dialog", (confirmation) => confirmation.accept());
  await agentRow.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(agentRow.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "No runnable Agent, Space, and active connector are available in your scope.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan action", exact: true })).toHaveCount(0);

  await agentRow.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(agentRow.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan action", exact: true })).toBeVisible();

  await page.getByLabel("Language").selectOption("ja");
  await expect(page.getByRole("heading", { name: "実行Run", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps Agent controls operable in a mobile viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Agent runs");
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Execution runs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();

  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
