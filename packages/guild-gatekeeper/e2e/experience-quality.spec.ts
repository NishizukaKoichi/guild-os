import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { COMPACT_NAVIGATION_MAX_WIDTH } from "../app/navigation";
import { navigateTo } from "./navigation";

const DEMO_INVITATION_TOKEN = "DemoOnlyTokenForVisualQualityReview1234567890A".slice(0, 43);

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
}

async function expectNoHighImpactAccessibilityViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    }));
  expect(violations).toEqual([]);
}

test("keeps destinations linkable and browser history predictable", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root#/home");

  await expect(page.getByRole("heading", { name: "Home", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Ask a question/ }).click();
  await expect(page).toHaveURL(/#\/ask$/);
  await expect(page.getByLabel("Question", { exact: true })).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole("heading", { name: "Home", exact: true, level: 1 })).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(/#\/ask$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ask Guild", exact: true, level: 1 })).toBeVisible();

  await page.goto("?standalone=root#/memory");
  await expect(page.getByRole("heading", { name: "Research memory", exact: true, level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows daily actions first and filters global actions by permission", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("?standalone=member#/home");

  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator("button[data-app-page='home']")).toBeVisible();
  await expect(sidebar.locator("button[data-app-page='ask']")).toBeVisible();
  await expect(sidebar.locator("button[data-app-page='members']")).toHaveCount(0);
  await expect(sidebar.locator("button[data-app-page='memory']")).toBeVisible();
  await expect(sidebar.locator("button[data-app-page='activity']")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "More", exact: true }).click();
  await expect(sidebar.locator("button[data-app-page='inbox']")).toBeVisible();
  await expect(sidebar.locator("button[data-app-page='operations']")).toHaveCount(0);
  await expect(page.locator(".home-action-grid > button")).toHaveCount(4);

  const trigger = page.getByRole("button", { name: "Search or create", exact: true });
  await trigger.focus();
  await page.keyboard.press("Control+K");
  const command = page.getByRole("dialog", { name: "Find or do something", exact: true });
  const search = command.getByRole("textbox");
  await expect(search).toBeFocused();
  await search.fill("Operations");
  await expect(command.getByText("No matching action", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await navigateTo(page, "settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Constitution", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("opens the exact attention surface in one action", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=root#/home");

  await page.getByRole("button", { name: /Agent actions awaiting approval/ }).click();
  await expect(page).toHaveURL(/#\/members$/);
  await expect(page.getByRole("heading", { name: "Execution runs", exact: true })).toBeFocused();

  await page.goBack();
  await page.getByRole("button", { name: /Unread updates/ }).click();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true, level: 1 })).toBeFocused();
  expect(errors).toEqual([]);
});

test("opens common actions globally and protects an unsaved draft", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=root#/home");
  const trigger = page.getByRole("button", { name: "Search or create", exact: true });
  await trigger.focus();
  await page.keyboard.press("Control+K");

  const command = page.getByRole("dialog", { name: "Find or do something", exact: true });
  await command.getByRole("textbox").fill("Record findings");
  await command.locator(".global-action-results button").first().click();
  await expect(page).toHaveURL(/#\/memory$/);

  const editor = page.getByRole("dialog", { name: "Record findings", exact: true });
  const title = editor.getByLabel("Title", { exact: true });
  await expect(title).toBeFocused();
  await title.fill("Unsaved fictional field note");

  page.once("dialog", (confirmation) => {
    expect(confirmation.message()).toBe("Discard the changes you have not saved?");
    void confirmation.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(title).toHaveValue("Unsaved fictional field note");

  page.once("dialog", (confirmation) => void confirmation.accept());
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Research memory", exact: true, level: 1 })).toBeFocused();
  expect(errors).toEqual([]);
});

test("validates, single-flights, and confirms Memory and Activity creation", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=root#/memory");
  await page.locator(".page-header").getByRole("button", { name: "Record findings", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Record findings", exact: true });
  await editor.getByRole("button", { name: "Record findings", exact: true }).click();
  await expect(editor.getByLabel("Title", { exact: true })).toBeFocused();

  const memoryTitle = "Single-flight fictional memory";
  await editor.getByLabel("Title", { exact: true }).fill(memoryTitle);
  await editor.getByLabel("Summary", { exact: true }).fill("A bounded test record.");
  await editor.getByLabel("Content", { exact: true }).fill("This content exists only in the local demo fixture.");
  await editor.getByRole("button", { name: "Record findings", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("Memory saved.", { exact: true })).toBeVisible();
  await expect(page.locator(".memory-row").filter({ hasText: memoryTitle })).toHaveCount(1);

  await navigateTo(page, "activity");
  await page.locator(".page-header").getByRole("button", { name: "Start research", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Start research", exact: true });
  await editor.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(editor.getByLabel("Title", { exact: true })).toBeFocused();
  const activityTitle = "Single-flight fictional activity";
  await editor.getByLabel("Title", { exact: true }).fill(activityTitle);
  await editor.getByLabel("Description", { exact: true }).fill("Verify one bounded local interaction.");
  await editor.getByRole("button", { name: "Start research", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("Activity started.", { exact: true })).toBeVisible();
  await expect(page.locator(".activity-row").filter({ hasText: activityTitle })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("keeps partial failures recoverable and empty states actionable", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=partial-failure#/home");
  await expect(page.getByText("Some Guild status could not be checked", { exact: true })).toBeVisible();
  await expect(page.getByText("You're up to date", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Some Guild status could not be checked", { exact: true })).toHaveCount(0);

  await page.goto("?standalone=empty#/memory");
  await expect(page.getByRole("heading", { name: "No memory yet", exact: true })).toBeVisible();
  await expect(page.getByText("Preserve the first useful fact, document, experience, or artifact.", { exact: true })).toBeVisible();
  await expect(page.locator(".empty-state-panel").getByRole("button", { name: "Record findings", exact: true })).toBeVisible();
  await navigateTo(page, "activity");
  await expect(page.getByRole("heading", { name: "No activity yet", exact: true })).toBeVisible();
  await expect(page.locator(".empty-state-panel").getByRole("button", { name: "Start research", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("accepts a private invitation link without exposing its token after load", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto(`?standalone=uninvited#invite=${DEMO_INVITATION_TOKEN}`);

  await expect(page).not.toHaveURL(/invite=/);
  await expect(page.getByText("The one-time invitation from your link is ready. Add your display name to join.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Display name", { exact: true })).toBeFocused();
  await page.getByLabel("Display name", { exact: true }).fill("Taylor Demo");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("heading", { name: "Home", exact: true, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);

  await page.goto(`?standalone=uninvited&case=invalid#invite=${"x".repeat(43)}`);
  await page.getByLabel("Display name", { exact: true }).fill("Taylor Demo");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByText("This invitation is not valid for this Guild.", { exact: true })).toBeVisible();
  await expect(page.locator(".access-panel [tabindex='-1']")
    .filter({ hasText: "This invitation could not be accepted" })).toBeFocused();
  expect(errors).toEqual([]);
});

test("explains restricted membership states without leaking internal errors", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("?standalone=suspended");
  await expect(page.getByRole("heading", { name: "Guild access is inactive", exact: true })).toBeVisible();
  await expect(page.getByText(/Ask a Guild administrator to review and restore/)).toBeVisible();
  await page.goto("?standalone=departed");
  await expect(page.getByText(/must issue a new invitation if you should rejoin/)).toBeVisible();
  await page.goto("?standalone=uninitialized-member");
  await expect(page.getByRole("heading", { name: "Administrator initialization required", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the mobile drawer modal, keyboard-safe, and reachable by touch", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=root#/home");

  const sidebar = page.locator(".sidebar");
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  await open.click();
  await expect(sidebar).toHaveAttribute("role", "dialog");
  await expect(sidebar.getByRole("button", { name: "Close navigation", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.closest(".sidebar") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const tabSizes = await page.locator(".mobile-tabbar .mobile-tab").evaluateAll((elements) =>
    elements.map((element) => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width })));
  expect(tabSizes.every((size) => size.height >= 44 && size.width >= 44)).toBe(true);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps all supported viewports and languages free of horizontal overflow", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("?standalone=root#/home");
    await expect(page.locator(".home-action-grid > button")).toHaveCount(4);
    if (viewport.width <= COMPACT_NAVIGATION_MAX_WIDTH) {
      await expect(page.locator(".mobile-tabbar")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    await navigateTo(page, "ask");
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 320, height: 568 });
  for (const [locale, homeTitle] of [["en", "Home"], ["ja", "ホーム"], ["zh-CN", "主页"]] as const) {
    await page.goto("?standalone=root#/home");
    await page.locator(".language-control select").selectOption(locale);
    await expect(page.getByRole("heading", { name: homeTitle, exact: true, level: 1 })).toBeVisible();
    const clippedMobileLabels = await page.locator(".mobile-tabbar .mobile-tab span").evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.textContent,
        availableWidth: element.clientWidth,
        requiredWidth: element.scrollWidth,
      })).filter((label) => label.requiredWidth > label.availableWidth));
    expect(clippedMobileLabels).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});

test("has no critical or serious accessibility violations on major surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root#/home");
  await expectNoHighImpactAccessibilityViolations(page);

  for (const destination of ["ask", "memory", "activity", "inbox", "settings"] as const) {
    await navigateTo(page, destination);
    await expectNoHighImpactAccessibilityViolations(page);
  }

  await navigateTo(page, "memory");
  await page.locator(".page-header").getByRole("button", { name: "Record findings", exact: true }).click();
  await expectNoHighImpactAccessibilityViolations(page);
});

test("has no critical or serious accessibility violations in access and initialization", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=uninvited");
  await expectNoHighImpactAccessibilityViolations(page);
  await page.goto("?standalone=uninitialized-admin");
  await expectNoHighImpactAccessibilityViolations(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expectNoHighImpactAccessibilityViolations(page);
});
