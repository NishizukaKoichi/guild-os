import type { Page } from "playwright/test";
import type { AppPage } from "../app/navigation";

const WORKSPACE_PAGES: ReadonlySet<AppPage> = new Set([
  "memory",
  "activity",
  "decisions",
  "knowledge",
  "work",
]);

const MORE_PAGES: ReadonlySet<AppPage> = new Set([
  "members",
  "messages",
  "lifecycle",
  "contributions",
  "context",
  "chronicle",
  "operations",
  "settings",
]);

export async function navigateTo(page: Page, destination: AppPage): Promise<void> {
  const mobile = (page.viewportSize()?.width ?? 1_024) <= 760;
  const sidebar = page.locator(".sidebar");

  if (mobile && !(await sidebar.evaluate((element) => element.classList.contains("sidebar-open")))) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await sidebar.waitFor({ state: "visible" });
  }

  if (WORKSPACE_PAGES.has(destination)) {
    const workspace = sidebar.locator(".nav-section-workspace > .nav-group-toggle");
    await workspace.waitFor({ state: "visible" });
    if (await workspace.getAttribute("aria-expanded") !== "true") await workspace.click();
  } else if (MORE_PAGES.has(destination)) {
    const more = sidebar.locator(".nav-section-more > .nav-group-toggle");
    await more.waitFor({ state: "visible" });
    if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  }

  await sidebar.locator(`button[data-app-page="${destination}"]`).click();
}

export async function navigateToMore(
  page: Page,
  destination: "History" | "Agent runs" | "Inbox" | "Decisions" | "Settings" | "Canonical memory" | "Structured work",
) {
  const pageByDestination = {
    History: "chronicle",
    "Agent runs": "members",
    Inbox: "inbox",
    Decisions: "decisions",
    Settings: "settings",
    "Canonical memory": "knowledge",
    "Structured work": "work",
  } as const satisfies Record<typeof destination, AppPage>;
  await navigateTo(page, pageByDestination[destination]);
}
