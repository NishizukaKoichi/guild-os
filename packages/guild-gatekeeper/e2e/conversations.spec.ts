import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

test("posts, mentions, locks, unlocks, and redacts a governed comment", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();

  const panel = page.locator(".conversation-panel");
  await expect(panel.getByRole("heading", { name: "Comments", exact: true })).toBeVisible();
  await expect(panel.getByText(
    "Please confirm that the ownership check is clear before the next review.",
    { exact: true },
  )).toBeVisible();

  await panel.getByLabel("Mention a Human", { exact: true }).fill("Mina");
  await panel.getByRole("option", { name: "Mina Park", exact: true }).click();
  await panel.getByLabel("Comment", { exact: true }).fill(
    "The ownership check is clear and ready for Human review.",
  );
  await panel.getByRole("button", { name: "Post", exact: true }).click();

  const posted = panel.locator(".conversation-message").last();
  await expect(posted).toBeVisible();
  await expect(posted.getByText(
    "The ownership check is clear and ready for Human review.",
    { exact: true },
  )).toBeVisible();
  await expect(posted.getByText("@Mina Park", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Lock comments", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Lock comments", exact: true });
  await dialog.getByLabel("Reason", { exact: true }).fill("Close discussion after review.");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(panel.getByText("This comment thread is locked.", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Comment", { exact: true })).toHaveCount(0);

  await panel.getByRole("button", { name: "Unlock comments", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Unlock comments", exact: true });
  await dialog.getByLabel("Reason", { exact: true }).fill("Reopen for a final correction.");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(panel.getByLabel("Comment", { exact: true })).toBeVisible();

  await posted.getByRole("button", { name: "Redact comment", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Redact comment", exact: true });
  await dialog.getByLabel("Reason", { exact: true }).fill("Remove superseded operational detail.");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(posted.getByText("Comment redacted", { exact: true })).toBeVisible();
  await expect(posted.getByText("Remove superseded operational detail.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps comments usable but moderation hidden for a member on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=member");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();

  const panel = page.locator(".conversation-panel");
  await expect(panel.getByRole("heading", { name: "Comments", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Lock comments", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Redact comment", exact: true })).toHaveCount(0);
  await panel.getByLabel("Comment", { exact: true }).fill("I completed the ownership review.");
  await panel.getByRole("button", { name: "Post", exact: true }).click();
  await expect(panel.getByText("I completed the ownership review.", { exact: true })).toBeVisible();

  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
