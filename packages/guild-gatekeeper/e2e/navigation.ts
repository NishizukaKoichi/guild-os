import type { Page } from "playwright/test";

export async function navigateToMore(
  page: Page,
  destination: "History" | "Agent runs" | "Inbox" | "Decisions" | "Settings" | "Canonical memory" | "Structured work",
) {
  const mobileMenu = page.getByRole("button", { name: "Open navigation", exact: true });
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    const sidebarAlreadyOpen = await page.locator(".sidebar-open").isVisible();
    if (!sidebarAlreadyOpen) {
      await mobileMenu.waitFor({ state: "visible" });
      await mobileMenu.click();
    }
  }

  if (destination === "Agent runs") {
    await page.getByRole("button", { name: "Researchers", exact: true }).click();
    return;
  }

  const more = page.locator(".nav-group-toggle").filter({ hasText: /^More$/ });
  await more.waitFor({ state: "visible" });
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  const label = destination === "History"
    ? "Research history"
    : destination === "Decisions"
      ? "Research decisions"
      : destination;
  await page.getByRole("button", { name: label, exact: true }).click();
}
