import { expect, test, type Page } from "playwright/test";
import type { AppPage } from "../app/navigation";
import { navigateTo } from "./navigation";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
}

async function openMorePage(page: Page, label: string) {
  const destinations: Record<string, AppPage> = {
    "Private messages": "messages",
    "Joining & handovers": "lifecycle",
    Contributions: "contributions",
    "Context graph": "context",
    Operations: "operations",
  };
  const destination = destinations[label];
  if (!destination) throw new Error(`Unknown navigation destination: ${label}`);
  await navigateTo(page, destination);
}

test("keeps private conversation out of Guild Memory until an explicit promotion", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await openMorePage(page, "Private messages");

  await expect(page.getByRole("heading", { name: "Private messages", exact: true })).toBeVisible();
  await page.getByLabel("Reply", { exact: true }).fill("Promote only this reviewed fictional note.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".private-message-list")
    .getByText("Promote only this reviewed fictional note.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Promote to Guild record", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: "Create a Guild record", exact: true });
  await expect(dialog.getByText("Memory draft", { exact: true })).toBeVisible();
  await dialog.getByLabel("Summary", { exact: true })
    .fill("A reviewed fictional note promoted by an explicit Human action.");
  await dialog.getByRole("button", { name: "Create record", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Promoted records", exact: true })).toBeVisible();
  await expect(page.getByText("Memory draft", { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("renders and changes the Context Graph, Memory review, and Personal sharing boundary", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await openMorePage(page, "Context graph");

  await expect(page.getByRole("heading", { name: "Context graph", exact: true })).toBeVisible();
  await expect(page.getByText("Supports", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add relationship", exact: true }).first().click();
  let dialog = page.getByRole("dialog", { name: "Connect two records", exact: true });
  await dialog.getByLabel("Why are these records related?", { exact: true })
    .fill("The fictional source gives accountable context to the selected work record.");
  await dialog.getByRole("button", { name: "Add relationship", exact: true }).click();
  await expect(page.getByText("The relationship was added to the Context Graph.", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Resolve Memory review", exact: true });
  await dialog.getByLabel("Resolution and evidence", { exact: true })
    .fill("The fictional sampling method was checked against the current Canonical Memory.");
  await dialog.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByText("The Memory review was resolved.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Share with Guild", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Share Personal Data", exact: true });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Share with Guild", exact: true }).click();
  await expect(page.getByText(
    "The selected Personal Data is now explicitly shared with this Guild.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("Shared explicitly", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("shows all three onboarding requirements and preserves each completion", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=member");
  await openMorePage(page, "Joining & handovers");

  await expect(page.getByRole("heading", { name: "Your onboarding", exact: true })).toBeVisible();
  await expect(page.getByText("Read the research purpose and ethics policy", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirm the research operating boundary", { exact: true })).toBeVisible();
  await expect(page.getByText("Complete the first guided study", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Mark complete", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("creates and assigns a reusable Role and Space-aware onboarding path", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await openMorePage(page, "Joining & handovers");

  await page.getByRole("button", { name: "Create onboarding path", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create onboarding path", exact: true });
  await dialog.getByLabel("Path name", { exact: true }).fill("Field methods orientation");
  await dialog.getByLabel("Purpose and expected outcome", { exact: true })
    .fill("Prepare a fictional field researcher for the Research Space.");
  await dialog.locator("select").first().selectOption({ label: "Research" });
  await dialog.getByRole("checkbox", { name: "Member", exact: true }).check();
  await dialog.getByPlaceholder("Requirement title", { exact: true })
    .fill("Confirm the field method boundary");
  await dialog.getByPlaceholder("Instructions", { exact: true })
    .fill("Acknowledge the current method before active field work.");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Field methods orientation", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Assign onboarding", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Assign onboarding", exact: true });
  await dialog.locator("select").nth(0).selectOption({ label: "Mina Park" });
  await dialog.locator("select").nth(1).selectOption({ label: "Field methods orientation" });
  await dialog.getByRole("button", { name: "Assign onboarding", exact: true }).click();
  const assignment = page.locator(".lifecycle-table .data-row")
    .filter({ hasText: "Field methods orientation" });
  await expect(assignment).toContainText("Mina Park");
  await expect(assignment).toContainText("0/1");
  expect(errors).toEqual([]);
});

test("requests and reviews evidence-backed Contribution corrections without a score", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await openMorePage(page, "Contributions");

  await expect(page.getByText("Evidence, not surveillance.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request correction", exact: true }).first().click();
  let dialog = page.getByRole("dialog", { name: "Request correction", exact: true });
  await dialog.getByLabel("What is inaccurate or missing?", { exact: true })
    .fill("This fictional event needs a clearer outcome boundary.");
  await dialog.getByRole("button", { name: "Submit correction request", exact: true }).click();
  await expect(page.getByText("This fictional event needs a clearer outcome boundary.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("Pending review", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Review contribution correction", exact: true });
  await dialog.getByLabel("Review reason", { exact: true })
    .fill("The correction accurately separates completed review from pending synthesis.");
  await dialog.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("operates purchaser-owned Connections, Automation, Federation, Models, exports, and retention", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=root");
  await openMorePage(page, "Operations");

  await page.getByRole("button", { name: "Check health for Fictional research webhook", exact: true }).click();
  await expect(page.getByText("Connection healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Adapter result: ok", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discover allowed capabilities for Fictional research webhook", exact: true }).click();
  await expect(page.getByText("1 allowed capabilities discovered", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  const connectionForm = page.locator(".content-section").filter({
    has: page.getByRole("heading", { name: "Create a connection", exact: true }),
  });
  await expect(connectionForm.getByRole("combobox", { name: "Connection type", exact: true })
    .locator("option")).toContainText([
    "HTTPS webhook", "MCP server", "Cloudflare service binding",
  ]);
  await connectionForm.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("tab", { name: "Automation", exact: true }).click();
  await expect(page.getByText("Review new observation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const runForm = page.locator(".content-section").filter({
    has: page.getByRole("heading", { name: "Start a manual run", exact: true }),
  });
  await runForm.getByLabel("Objective", { exact: true })
    .fill("Prepare a fictional bounded observation review");
  await runForm.getByRole("button", { name: "Start run", exact: true }).click();
  const runHistory = page.locator(".content-section").filter({
    has: page.getByRole("heading", { name: "Run history", exact: true }),
  });
  await expect(runHistory.locator(".data-row")).toHaveCount(1);
  await expect(runHistory.locator(".data-row").first()).toContainText("Manual");
  await expect(runHistory.locator(".data-row").first()).toContainText("Queued");

  await page.getByRole("tab", { name: "Federation", exact: true }).click();
  await expect(page.getByText("Example Field Collective", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explicit grants", exact: true })).toBeVisible();
  await expect(page.getByText("Read", { exact: true }).first()).toBeVisible();

  await page.getByRole("tab", { name: "AI models", exact: true }).click();
  await expect(page.getByText("Cloudflare Workers AI", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("@cf/meta/llama-3.1-8b-instruct-fast", { exact: true }).first())
    .toBeVisible();

  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Owned data", exact: true })).toBeVisible();
  await expect(page.getByText("84", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Create export", exact: true }).click();
  const exportSection = page.locator(".content-section").filter({
    has: page.getByRole("heading", { name: "Export and migration", exact: true }),
  });
  await expect(exportSection.locator(".data-row")).toHaveCount(1);
  await expect(exportSection.locator(".data-row").first()).toContainText("Ready");
  await expect(exportSection.locator(".data-row").first()).toContainText("SHA-256 verified");
  await page.getByRole("button", { name: "Create preview", exact: true }).click();
  const retentionHistory = page.locator(".content-section").filter({
    has: page.getByRole("heading", { name: "Retention history", exact: true }),
  });
  await expect(retentionHistory.getByText("Dry-run preview", { exact: true })).toBeVisible();
  await expect(retentionHistory.getByText(/candidates/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 320] as const) {
  test(`keeps every full-spec management surface usable at ${width}px`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("?standalone=root");
    const destinations = [
      ["Private messages", "Private messages"],
      ["Joining & handovers", "Joining & handovers"],
      ["Contributions", "Contributions"],
      ["Context graph", "Context graph"],
      ["Operations", "Operations"],
    ] as const;
    for (const [destination, heading] of destinations) {
      await openMorePage(page, destination);
      await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    expect(errors).toEqual([]);
  });
}
