import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function configuration(port) {
  const url = new URL("../packages/guild-gatekeeper/playwright.config.ts", import.meta.url).href;
  return spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    `const {default: config} = await import(${JSON.stringify(url)}); console.log(JSON.stringify(config));`,
  ], {
    encoding: "utf8",
    env: { ...process.env, GUILD_E2E_PORT: port },
  });
}

test("browser evidence targets a dedicated server without silent reuse or port fallback", () => {
  const result = configuration("14317");
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.use.baseURL, "http://127.0.0.1:14317/app/");
  assert.equal(config.webServer.url, "http://127.0.0.1:14317/app/?standalone=root");
  assert.match(config.webServer.command, /--port 14317 --strictPort$/);
  assert.equal(config.webServer.reuseExistingServer, false);
});

test("invalid port text is rejected before it reaches the server command", () => {
  for (const port of ["", "0", "80", "65536", "1.2", "14317;echo unsafe", "14317 --host 0.0.0.0"]) {
    const result = configuration(port);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GUILD_E2E_PORT must be an integer/);
  }
});
