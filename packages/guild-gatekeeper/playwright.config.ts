import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4317/app/",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4317",
    url: "http://127.0.0.1:4317/app/?standalone=root",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
