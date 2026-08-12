import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

test("starts from four plain-language outcomes and suggested questions", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");

  await expect(page.getByRole("heading", { name: "What would you like to do?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ask a question/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save knowledge/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Plan work/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review updates/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI agents", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Ask a question/ }).click();
  await page.getByRole("button", { name: "What should a new member read first?", exact: true }).click();
  await expect(page.getByLabel("Question", { exact: true })).toHaveValue("What should a new member read first?");
  expect(errors).toEqual([]);
});

test("keeps management out of the default member navigation", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("?standalone=member");

  await expect(page.getByRole("button", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI agents", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await page.locator(".nav-group-toggle").filter({ hasText: /^More$/ }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("uses a four-item mobile tab bar without horizontal overflow", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");

  const tabs = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(tabs.getByRole("button")).toHaveCount(4);
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await tabs.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(tabs).not.toBeVisible();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Knowledge", exact: true })).toBeVisible();
  await expect(tabs).toBeVisible();

  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
