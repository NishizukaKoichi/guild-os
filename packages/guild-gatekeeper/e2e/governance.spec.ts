import { expect, test, type Page } from "playwright/test";

const guildName = "Commonweal Research Guild";

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

test("current Root proposes and cancels a two-party ownership transfer with Chronicle evidence", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Root ownership", exact: true })).toBeVisible();
  await expect(page.locator(".ownership-summary")).toContainText("Avery Morgan");
  await page.getByRole("button", { name: "Propose transfer", exact: true }).click();

  const proposeDialog = page.getByRole("dialog", { name: "Propose Root ownership transfer" });
  await proposeDialog.getByLabel("Find an active Human", { exact: true }).fill("No");
  await proposeDialog.getByRole("button", { name: "Search", exact: true }).click();
  await proposeDialog.getByRole("combobox", { name: "Successor", exact: true }).selectOption({ label: "Noah Chen" });
  await proposeDialog.getByRole("combobox", { name: "Your Role after transfer", exact: true }).selectOption({ label: "Admin" });
  await proposeDialog.getByLabel("Reason for change", { exact: true }).fill(
    "Move final stewardship to the incoming Guild lead.",
  );
  await proposeDialog.getByLabel("Type the successor's display name to confirm", { exact: true }).fill("Noah Chen");
  await proposeDialog.getByRole("button", { name: "Propose transfer", exact: true }).click();

  await expect(proposeDialog).toHaveCount(0);
  await expect(page.locator(".ownership-summary")).toContainText("Avery Morgan");
  await expect(page.locator(".ownership-summary")).toContainText("Noah Chen");
  await expect(page.getByText(/remains inactive until the named successor accepts/)).toBeVisible();

  await page.getByRole("button", { name: "Cancel transfer", exact: true }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancel ownership transfer" });
  await cancelDialog.getByLabel("Reason for change", { exact: true }).fill("The handover plan changed.");
  await cancelDialog.getByLabel("Type the Guild name to confirm", { exact: true }).fill(guildName);
  await cancelDialog.getByRole("button", { name: "Cancel transfer", exact: true }).click();

  await expect(cancelDialog).toHaveCount(0);
  await expect(page.getByText("There is no pending Root ownership transfer.")).toBeVisible();
  await page.getByRole("button", { name: "Chronicle", exact: true }).click();
  await expect(page.getByText("root_ownership.transfer.proposed", { exact: true })).toBeVisible();
  await expect(page.getByText("root_ownership.transfer.cancelled", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("designated Human accepts Root ownership from a separate mobile session", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=transfer-target");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Root ownership", exact: true })).toBeVisible();
  await expect(page.locator(".ownership-summary")).toContainText("Avery Morgan");
  await expect(page.locator(".ownership-summary")).toContainText("Noah Chen");
  await page.getByRole("button", { name: "Accept ownership", exact: true }).click();

  const acceptDialog = page.getByRole("dialog", { name: "Accept Root ownership" });
  await acceptDialog.getByLabel("Reason for change", { exact: true }).fill(
    "I accept responsibility for the Guild Constitution and recovery controls.",
  );
  await acceptDialog.getByLabel("Type the Guild name to confirm", { exact: true }).fill(guildName);
  const viewportBeforeAccept = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewportBeforeAccept.scrollWidth).toBe(viewportBeforeAccept.clientWidth);
  await acceptDialog.getByRole("button", { name: "Accept ownership", exact: true }).click();

  await expect(acceptDialog).toHaveCount(0);
  await expect(page.locator(".ownership-summary")).toContainText("Noah Chen");
  await expect(page.getByText("There is no pending Root ownership transfer.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Emergency recovery", exact: true })).toBeVisible();
  await expect(page.locator(".recovery-summary")).toContainText("Inactive");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar-account")).toContainText("Root");
  await page.getByRole("button", { name: "Chronicle", exact: true }).click();
  await expect(page.getByText("root_ownership.transfer.accepted", { exact: true })).toBeVisible();
  await expect(page.getByText("break_glass.codes.revoked", { exact: true })).toBeVisible();
  const viewportAfterAccept = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewportAfterAccept.scrollWidth).toBe(viewportAfterAccept.clientWidth);
  expect(errors).toEqual([]);
});

test("Root rotates, stores, and revokes one-time emergency recovery codes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Emergency recovery", exact: true })).toBeVisible();
  await expect(page.locator(".recovery-summary")).toContainText("Ready");
  await page.getByRole("button", { name: "Rotate codes", exact: true }).click();

  const rotateDialog = page.getByRole("dialog", { name: "Generate emergency recovery codes" });
  await rotateDialog.getByRole("combobox", { name: "Previous Root Role" }).selectOption({ label: "Admin" });
  await rotateDialog.getByRole("combobox", { name: "Code expiry" }).selectOption("365");
  await rotateDialog.getByLabel("Reason for change").fill(
    "Rotate the offline custody set for the annual continuity review.",
  );
  await rotateDialog.getByLabel("Type the Guild name to confirm").fill(guildName);
  await rotateDialog.getByRole("button", { name: "Generate codes", exact: true }).click();

  const revealDialog = page.getByRole("dialog", { name: "Store these recovery codes now" });
  await expect(revealDialog.locator(".recovery-code-list li")).toHaveCount(10);
  await expect(revealDialog.locator(".recovery-code-list code").first()).toHaveText(/^gbr_[A-Za-z0-9_-]{32}$/);
  const downloadPromise = page.waitForEvent("download");
  await revealDialog.getByRole("button", { name: "Download text file", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("guild-os-recovery-generation-2.txt");
  await revealDialog.getByRole("button", { name: "I stored the codes", exact: true }).click();

  await expect(revealDialog).toHaveCount(0);
  await expect(page.locator(".recovery-summary")).toContainText("2");
  await page.getByRole("button", { name: "Revoke codes", exact: true }).click();
  const revokeDialog = page.getByRole("dialog", { name: "Revoke emergency recovery codes" });
  await revokeDialog.getByLabel("Reason for change").fill("Retire this custody set after verification.");
  await revokeDialog.getByLabel("Type the Guild name to confirm").fill(guildName);
  await revokeDialog.getByRole("button", { name: "Revoke codes", exact: true }).click();
  await expect(revokeDialog).toHaveCount(0);
  await expect(page.locator(".recovery-summary")).toContainText("Inactive");

  await page.getByRole("button", { name: "Chronicle", exact: true }).click();
  await expect(page.getByText("break_glass.codes.rotated", { exact: true })).toBeVisible();
  await expect(page.getByText("break_glass.codes.revoked", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("an authenticated unknown Human can use audited recovery on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=uninvited");

  await expect(page.getByRole("heading", { name: "Join this Guild", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Emergency recovery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Use emergency recovery" });
  await dialog.getByLabel("Recovery code").fill("gbr_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef");
  await dialog.getByLabel("Your Guild display name").fill("Offline Custodian");
  await dialog.getByLabel("Reason for change").fill(
    "All enrolled administrators are unavailable and offline custody was verified.",
  );
  await dialog.getByLabel("Type the Guild name to confirm").fill(guildName);
  await dialog.getByRole("button", { name: "Transfer Root ownership", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".sidebar-account")).toContainText("Root");
  await page.getByRole("button", { name: "Chronicle", exact: true }).click();
  await expect(page.getByText("break_glass.used", { exact: true })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});

test("an active non-Root Human can reach recovery without management authority", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=recovery-human");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("button", { name: "Edit Constitution", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Emergency recovery", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Emergency recovery", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Use emergency recovery" });
  await expect(dialog.getByLabel("Recovery code")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  expect(errors).toEqual([]);
});
