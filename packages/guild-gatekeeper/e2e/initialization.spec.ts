import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

test("requires explicit confirmation before the Workshop administrator becomes Root", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=uninitialized-admin");

  await expect(page.getByRole("heading", { name: "Initialize this Guild", exact: true })).toBeVisible();
  await page.getByLabel("Root Owner display name", { exact: true }).fill("Jordan Lee");
  await page.getByLabel("Type the Guild name to confirm", { exact: true })
    .fill("Commonweal Research Guild");
  await page.getByRole("button", {
    name: "Initialize and become Root Owner",
    exact: true,
  }).click();

  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByText("Human Root Owner", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("does not expose initialization controls to a non-administrator on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=uninitialized-member");

  await expect(page.getByRole("heading", {
    name: "Administrator initialization required",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Initialize and become Root Owner",
    exact: true,
  })).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
