import { defineConfig } from "playwright/test";

const portText = process.env.GUILD_E2E_PORT ?? "4317";
const port = Number(portText);
if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("GUILD_E2E_PORT must be an integer from 1024 through 65535.");
}
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Cold single-file transforms and full axe scans can exceed 30 seconds under parallel load.
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `${origin}/app/`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/app/?standalone=root`,
    // Never certify another checkout's already-running development server.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
