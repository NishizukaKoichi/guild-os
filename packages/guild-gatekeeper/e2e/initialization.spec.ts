import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function mountSandboxedStandaloneApp(
  page: Page,
  mode: "root" | "uninitialized-admin" | "uninitialized-member",
) {
  const appHtml = await readFile(resolve("dist-app/app/index.html"), "utf8");
  await page.goto(`?standalone=${mode}`);
  await page.evaluate(async ({ html, standaloneMode }) => {
    const { newMessagePortRpcSession, RpcStub, RpcTarget } = await import("/@id/capnweb");
    const { createDevelopmentApi } = await import("/app/dev-api.ts");
    const api = createDevelopmentApi(standaloneMode);
    const target = new Proxy(new (class extends RpcTarget {})(), {
      get(base, property, receiver) {
        if (property === "then") return undefined;
        const baseValue = Reflect.get(base, property, receiver);
        if (baseValue !== undefined) return baseValue;
        const value = Reflect.get(api, property);
        return typeof value === "function" ? value.bind(api) : value;
      },
    });
    const ui = new RpcStub(target);
    const host = new (class extends RpcTarget {
      get ui() {
        return ui;
      }
    })();
    window.addEventListener("message", (event) => {
      if (event.data?.type === "handshake" && event.ports[0]) {
        newMessagePortRpcSession(event.ports[0], host);
      }
    });

    const iframe = document.createElement("iframe");
    iframe.title = "Gatekeeper app";
    iframe.sandbox.add("allow-scripts", "allow-modals");
    iframe.style.cssText = "border:0;width:100%;height:900px";
    iframe.srcdoc = html;
    document.body.replaceChildren(iframe);
  }, { html: appHtml, standaloneMode: mode });
  return page.frameLocator('iframe[title="Gatekeeper app"]');
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

test("initializes inside the Cloudflare OS form-restricted sandbox", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const app = await mountSandboxedStandaloneApp(page, "uninitialized-admin");

  await app.getByLabel("Root Owner display name", { exact: true }).fill("Jordan Lee");
  await app.getByLabel("Type the Guild name to confirm", { exact: true })
    .fill("Commonweal Research Guild");
  await app.getByRole("button", {
    name: "Initialize and become Root Owner",
    exact: true,
  }).click();

  await expect(app.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("supports keyboard submission in the form-restricted sandbox", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const app = await mountSandboxedStandaloneApp(page, "uninitialized-admin");

  await app.getByLabel("Root Owner display name", { exact: true }).fill("Jordan Lee");
  const confirmation = app.getByLabel("Type the Guild name to confirm", { exact: true });
  await confirmation.fill("Commonweal Research Guild");
  await confirmation.press("Enter");

  await expect(app.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens the native Knowledge file chooser inside the Cloudflare OS sandbox", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const app = await mountSandboxedStandaloneApp(page, "root");

  await app.getByRole("button", { name: "Knowledge", exact: true }).click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await app.getByRole("button", { name: "Start revision", exact: true }).click();
  await expect(app.getByText("Draft", { exact: true }).first()).toBeVisible();

  const chooserPromise = page.waitForEvent("filechooser");
  await app.getByLabel("Upload", { exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "sandbox-upload.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("sandbox upload verification"),
  });

  await expect(app.getByText("File uploaded and verified.")).toBeVisible();
  await expect(app.getByText("sandbox-upload.txt")).toBeVisible();
  expect(errors).toEqual([]);
});
