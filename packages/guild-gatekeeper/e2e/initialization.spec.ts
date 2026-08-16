import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type FrameLocator, type Page } from "playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function fillInitialization(app: Page | FrameLocator) {
  await app.getByRole("button", { name: "Continue", exact: true }).click();
  await app.getByLabel("Root Owner display name", { exact: true }).fill("Jordan Lee");
  await app.getByRole("checkbox", { name: /I accept responsibility/ }).check();
}

async function finishInitialization(app: Page | FrameLocator) {
  await app.getByRole("button", { name: "Create Guild", exact: true }).click();
  await expect(app.getByRole("heading", { name: "Your Guild is ready", exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Open Guild OS", exact: true }).click();
}

interface BlueprintExample {
  name: string;
  locale: "en" | "ja" | "zh-CN";
  expectedName: string;
  answers: {
    purpose: string;
    participants: string;
    memoryIntent: string;
    activityIntent: string;
    decisionStyle: string;
  };
}

async function generateBlueprint(page: Page, example: BlueprintExample) {
  await page.locator(".access-language select").selectOption(example.locale);
  await page.locator('[data-template-choice="custom"]').click();
  await page.locator(".initialization-actions .primary-button").click();
  for (const [key, value] of Object.entries(example.answers)) {
    await page.locator(`[data-onboarding-field="${key}"]`).fill(value);
  }
  await page.locator('[data-blueprint-action="generate"]').click();
  const review = page.locator("[data-blueprint-review]");
  await expect(review).toBeVisible();
  await expect(review.locator(".blueprint-editor-overview input").first()).toHaveValue(example.expectedName);
  await expect(review.locator(".blueprint-editor-item")).not.toHaveCount(0);
  return review;
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

test("requires explicit Root acceptance before the Workshop administrator becomes Root", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("?standalone=uninitialized-admin");

  await expect(page.getByRole("heading", { name: "How will you use Guild OS?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Personal with AI/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Recommended for one person", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create Guild", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await fillInitialization(page);
  await finishInitialization(page);

  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-account")).toContainText("Root");
  await page.getByRole("button", { name: "People and AI", exact: true }).click();
  await expect(page.getByText(/Personal administrator/)).toBeVisible();
  await expect(page.getByText("Personal assistant", { exact: true })).toBeVisible();
  await expect(page.getByText(/Employee|Manager|Preboarding/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("turns the selected purpose into a complete initial context and Role preset", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("?standalone=uninitialized-admin");

  await page.getByRole("button", { name: /Research Collective/ }).click();
  const preview = page.locator(".initialization-profile-preview .context-profile-preview");
  await expect(preview.getByText("Research lead", { exact: true })).toBeVisible();
  await expect(preview.getByText("Researcher", { exact: true })).toBeVisible();
  await expect(preview.getByText("Reviewer", { exact: true })).toBeVisible();
  await expect(preview.getByText("Experiment", { exact: true }).first()).toBeVisible();
  await expect(preview.getByText("Research synthesizer", { exact: true })).toBeVisible();

  await fillInitialization(page);
  await finishInitialization(page);

  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Researchers", exact: true }).click();
  await expect(page.locator(".identity-table")).toContainText("Research lead");
  await expect(page.getByText(/Admin|Manager|Staff/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keeps purpose-first creation primary and raw Blank in advanced options", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("?standalone=uninitialized-admin");

  const customChoice = page.getByRole("button", { name: /Other \/ Build your own/ });
  await expect(customChoice).toBeVisible();
  await expect(page.getByRole("button", { name: /Blank Guild/ })).toBeHidden();
  await page.getByText("Advanced profiles", { exact: true }).click();
  await expect(page.getByRole("button", { name: /Blank Guild/ })).toBeVisible();
  expect(errors).toEqual([]);
});

const purposeExamples: readonly BlueprintExample[] = [
  {
    name: "family",
    locale: "ja",
    expectedName: "家族の共有室",
    answers: {
      purpose: "家族で暮らしと子育ての知恵を共有する",
      participants: "家族、親族、許可されたAIアシスタント",
      memoryIntent: "家族の予定、ケア、レシピ、約束、歴史を残す",
      activityIntent: "家事、ケア、予定、家族行事を一緒に進める",
      decisionStyle: "日常は家族の合意、重要事項は責任者が確認する",
    },
  },
  {
    name: "school",
    locale: "zh-CN",
    expectedName: "学习共同体",
    answers: {
      purpose: "为学校的学生、教师和课程保留共同知识",
      participants: "学生、教师、监护人和学习助手",
      memoryIntent: "保存课程、学习证据和学校指南",
      activityIntent: "开展课程、学习支持和评估",
      decisionStyle: "由教育者审核，重要事项交由教学委员会决定",
    },
  },
  {
    name: "sports team",
    locale: "en",
    expectedName: "Team Hub",
    answers: {
      purpose: "Coordinate a community football team and its training",
      participants: "Players, coaches, volunteers, and a team assistant",
      memoryIntent: "Keep playbooks, training notes, and team history",
      activityIntent: "Run training, matches, and team events",
      decisionStyle: "Coach review with team consent for major changes",
    },
  },
  {
    name: "NPO",
    locale: "ja",
    expectedName: "ミッション共同体",
    answers: {
      purpose: "非営利NPOのボランティアと公益事業を進める",
      participants: "スタッフ、ボランティア、受益者、支援Agent",
      memoryIntent: "事業ガイド、成果の証拠、方針を残す",
      activityIntent: "公益事業、キャンペーン、ボランティア活動を進める",
      decisionStyle: "共同体の合意を取り、重要事項は理事会が確認する",
    },
  },
  {
    name: "DAO",
    locale: "en",
    expectedName: "Decentralized Collective",
    answers: {
      purpose: "Run a DAO with transparent proposals and token voting",
      participants: "Human stewards, contributors, services, and governed Agents",
      memoryIntent: "Keep governance rules, proposals, votes, and collective history",
      activityIntent: "Run proposals, missions, and working-group sessions",
      decisionStyle: "Token voting with Human steward review for high-risk actions",
    },
  },
];

for (const example of purposeExamples) {
  test(`builds, reviews, and initializes an unknown ${example.name} without code`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("?standalone=uninitialized-admin");
    await generateBlueprint(page, example);
    await page.locator('[data-blueprint-action="accept"]').click();
    await page.locator("#initialization-owner-display-name").fill("Blueprint Owner");
    await page.locator(".initialization-ownership-confirmation input").check();
    await page.locator('[data-initialization-action="create"]').click();
    await expect(page.locator(".initialization-complete-panel")).toContainText(example.expectedName);
    await page.locator(".initialization-complete-action").click();
    await expect(page.locator(".topbar-context")).toContainText(example.expectedName);
    expect(errors).toEqual([]);
  });
}

for (const [locale, expectedName] of [
  ["en", "Family Circle"],
  ["ja", "家族の共有室"],
  ["zh-CN", "家庭共享空间"],
] as const) {
  test(`keeps the ${locale} Purpose-first Builder usable at 320px`, async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("?standalone=uninitialized-admin");
    await generateBlueprint(page, {
      name: `family-${locale}`,
      locale,
      expectedName,
      answers: locale === "ja" ? purposeExamples[0]!.answers : locale === "zh-CN" ? {
        purpose: "让家庭共同管理生活、照护和家庭决定",
        participants: "家庭成员与获授权的AI助手",
        memoryIntent: "保存照护记录、计划、知识和家庭历史",
        activityIntent: "共同处理家务、照护与家庭活动",
        decisionStyle: "日常事项采用家庭共识，重要事项由责任人审核",
      } : {
        purpose: "Help a family share care, plans, knowledge, and decisions",
        participants: "Family members and an authorized AI assistant",
        memoryIntent: "Keep care notes, plans, practical knowledge, and family history",
        activityIntent: "Coordinate household tasks, care, and family events",
        decisionStyle: "Family consent with responsible adult review for major changes",
      },
    });
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(errors).toEqual([]);
  });
}

test("does not expose initialization controls to a non-administrator on mobile", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("?standalone=uninitialized-member");

  await expect(page.getByRole("heading", {
    name: "Administrator initialization required",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Create Guild",
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

  await fillInitialization(app);
  await finishInitialization(app);

  await expect(app.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("supports keyboard submission in the form-restricted sandbox", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const app = await mountSandboxedStandaloneApp(page, "uninitialized-admin");

  await fillInitialization(app);
  await app.getByLabel("Root Owner display name", { exact: true }).press("Enter");

  await expect(app.getByRole("heading", { name: "Your Guild is ready", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("opens the native Knowledge file chooser inside the Cloudflare OS sandbox", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const app = await mountSandboxedStandaloneApp(page, "root");

  await app.locator(".nav-group-toggle").filter({ hasText: /^More$/ }).click();
  await app.getByRole("button", { name: "Canonical memory", exact: true }).click();
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
