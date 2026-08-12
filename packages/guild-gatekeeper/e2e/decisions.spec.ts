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

test("creates, proposes, and records a Human Decision approval", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Decisions");
  await expect(page.getByRole("heading", {
    name: "Adopt a citation requirement for Agent research",
  })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Canonical citations make Agent findings independently reviewable.");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create Decision", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Adopt a weekly Knowledge review");
  await dialog.getByLabel("Proposal", { exact: true })
    .fill("Choose whether each Space reviews changed Canonical Knowledge every week.");
  await dialog.getByLabel("Rationale", { exact: true })
    .fill("Regular review keeps current operating practice aligned with formal memory.");
  await dialog.getByLabel("Option name").nth(0).fill("Adopt weekly review");
  await dialog.getByLabel("Option details").nth(0).fill("Managers review changed Knowledge each Friday.");
  await dialog.getByLabel("Option name").nth(1).fill("Keep monthly review");
  await dialog.getByLabel("Option details").nth(1).fill("Retain the current monthly cadence.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adopt a weekly Knowledge review" })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Submit for approval", exact: true }).click();
  await expect(page.getByText("Awaiting approval", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("The weekly cadence has a clear owner and boundary.");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.getByText("Human review recorded in Chronicle.")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Language").selectOption("ja");
  await expect(page.getByRole("heading", { name: "意思決定", exact: true })).toBeVisible();
  await page.getByLabel("言語").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "意思決定", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps Decision review operable in a mobile viewport", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root");
  await navigateToMore(page, "Decisions");
  await expect(page.locator(".sidebar-scrim")).toHaveCount(0);
  await expect(page.getByRole("heading", {
    name: "Adopt a citation requirement for Agent research",
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
