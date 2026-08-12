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

test("publishes a governed announcement and records delivery in Inbox and Chronicle", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByText("Adopt a citation requirement for Agent research", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(page.getByText("Inbox read state updated.", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Announcements", exact: true }).click();
  await page.getByRole("button", { name: "Create announcement", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Canonical Knowledge review starts Friday");
  await dialog.getByLabel("Message", { exact: true }).fill("Review the revised research intake procedure before the Friday session.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Canonical Knowledge review starts Friday" })).toBeVisible();
  await expect(page.getByText("Announcement draft created.", { exact: true })).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Announcement published and Inbox notifications delivered/)).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

  await page.getByRole("tab", { name: /^Notifications/ }).click();
  await expect(page.getByText("Research intake procedure", { exact: true })).toBeVisible();

  await navigateToMore(page, "Activity");
  await page.getByLabel("Search actions", { exact: true }).fill("published");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByText("announcement.published", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps Inbox, announcement editing, and Chronicle usable on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await page.getByRole("tab", { name: "Announcements", exact: true }).click();
  await page.getByRole("button", { name: "Create announcement", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  let viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await navigateToMore(page, "Activity");
  await expect(page.getByText("decision.proposed", { exact: true })).toBeVisible();
  viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
