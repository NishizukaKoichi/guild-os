import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

test("runs the governed Knowledge and Ask Guild path", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await page.getByRole("button", { name: "Create Knowledge", exact: true }).click();

  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Incident response guide");
  await dialog.getByLabel("Summary", { exact: true })
    .fill("How the Guild records and resolves operational incidents.");
  await dialog.getByLabel("Content", { exact: true })
    .fill("Record the incident, assign an owner, preserve evidence, and document the resolution.");
  await dialog.getByLabel("Change note", { exact: true })
    .fill("Create the first governed incident procedure.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Incident response guide" })).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator("select").first().selectOption("ja");
  await dialog.getByLabel("Title", { exact: true }).fill("インシデント対応手順");
  await dialog.getByLabel("Summary", { exact: true }).fill("業務上の問題を記録し解決する方法です。");
  await dialog.getByLabel("Content", { exact: true })
    .fill("問題を記録し、責任者を決め、証拠を保全して、解決内容を残します。");
  await dialog.getByLabel("Change note", { exact: true }).fill("日本語版を追加。");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("A new immutable draft version was saved.")).toBeVisible();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByLabel("Upload", { exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "incident-template.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("fictional demo incident template"),
  });
  await expect(page.getByText("File uploaded and verified.")).toBeVisible();
  await expect(page.getByText("incident-template.txt")).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByText("Proposed", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Review reason")
    .fill("Scope, ownership, and evidence handling are explicit.");
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Canonical", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm understood", exact: true }).click();
  await expect(page.getByText("Understanding confirmed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Question").fill("How do we handle an operational incident?");
  await page.getByRole("button", { name: "Get answer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible();
  await page.getByRole("button", { name: /Incident response guide/ }).click();
  await expect(page.getByRole("heading", { name: "Incident response guide" })).toBeVisible();

  await page.getByLabel("Language").selectOption("ja");
  await expect(page.getByRole("heading", { name: "インシデント対応手順" })).toBeVisible();
  await page.getByLabel("言語").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "インシデント対応手順" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the Knowledge workflow inside a mobile viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Research intake procedure" })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
