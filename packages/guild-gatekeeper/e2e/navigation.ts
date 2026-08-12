import type { Page } from "playwright/test";

export async function navigateToMore(page: Page, destination: "Activity" | "AI agents" | "Settings") {
  const mobileMenu = page.getByRole("button", { name: "Open navigation", exact: true });
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    const sidebarAlreadyOpen = await page.locator(".sidebar-open").isVisible();
    if (!sidebarAlreadyOpen) {
      await mobileMenu.waitFor({ state: "visible" });
      await mobileMenu.click();
    }
  }

  const more = page.locator(".nav-group-toggle").filter({ hasText: /^More$/ });
  await more.waitFor({ state: "visible" });
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  await page.getByRole("button", { name: destination, exact: true }).click();
}
