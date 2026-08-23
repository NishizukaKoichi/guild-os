import type { Page } from "playwright/test";
import { COMPACT_NAVIGATION_MAX_WIDTH, type AppPage } from "../app/navigation";

const MORE_PAGES: ReadonlySet<AppPage> = new Set([
  "decisions",
  "knowledge",
  "work",
  "inbox",
  "messages",
  "lifecycle",
  "contributions",
  "context",
  "chronicle",
  "operations",
  "settings",
]);

export async function navigateTo(page: Page, destination: AppPage): Promise<void> {
  const mobile = (page.viewportSize()?.width ?? 1_024) <= COMPACT_NAVIGATION_MAX_WIDTH;
  const sidebar = page.locator(".sidebar");

  if (mobile && !(await sidebar.evaluate((element) => element.classList.contains("sidebar-open")))) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await sidebar.waitFor({ state: "visible" });
  }

  if (MORE_PAGES.has(destination)) {
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
