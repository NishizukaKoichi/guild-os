import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

test("Root Owner updates the versioned Constitution and cannot delegate its authority", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Constitution", exact: true })).toBeVisible();
  await expect(page.locator(".constitution-summary dd").first()).toHaveText("1");
  await page.getByRole("button", { name: "Edit Constitution", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Update Constitution" });
  await dialog.getByLabel("Level 2 approvals").fill("2");
  await dialog.getByLabel("Level 3 approvals").fill("3");
  await dialog.getByLabel("Data retention days").fill("730");
  await dialog.getByLabel("Currency").fill("AUD");
  await dialog.getByLabel("Budget (minor units)").fill("2500");
  await dialog.getByLabel("Reason for change").fill(
    "Require stronger approval for externally visible Agent actions.",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".constitution-summary dd").first()).toHaveText("2");
  await expect(page.locator(".constitution-summary")).toContainText("2500 AUD");

  await page.getByRole("button", { name: "Create role", exact: true }).click();
  const roleDialog = page.getByRole("dialog", { name: "Create role" });
  await expect(roleDialog.getByText("constitution.update", { exact: true })).toHaveCount(0);
  await expect(roleDialog.getByText("break-glass.use", { exact: true })).toHaveCount(0);
  await roleDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Chronicle", exact: true }).click();
  await expect(page.getByText("constitution.updated", { exact: true })).toBeVisible();
  const constitutionEvent = page.locator(".chronicle-event").filter({
    hasText: "constitution.updated",
  }).first();
  await constitutionEvent.getByText("Evidence", { exact: true }).click();
  await expect(constitutionEvent.getByText(/Require stronger approval/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("Constitution remains readable but immutable for a non-Root member on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=member");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Constitution", exact: true })).toBeVisible();
  await expect(page.getByText("This policy is read-only for your current Guild identity.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Constitution", exact: true })).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});

test("Root Constitution editor remains usable in a mobile viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Constitution", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Update Constitution" });
  await expect(dialog.getByLabel("Level 2 approvals")).toBeVisible();
  await dialog.getByLabel("Reason for change").fill("Verify the mobile governance workflow.");
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
