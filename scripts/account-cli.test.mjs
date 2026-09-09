import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("installed Wrangler targets the explicit account despite a different ambient configuration", { timeout: 45_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "guild-os-cli-binding-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "home"));
  const accountId = "a".repeat(32);
  const config = { accountId, workers: { workshop: { name: "fixture-workshop" } } };
  await writeFile(join(directory, "wrangler.json"), JSON.stringify({ account_id: "b".repeat(32) }));
  const paths = [];
  const server = createServer((request, response) => {
    paths.push({ method: request.method, url: request.url });
    let result;
    if (request.url === `/client/v4/accounts/${accountId}/workers/scripts/fixture-workshop/deployments`) {
      result = { deployments: [{ id: "fixture-deployment", versions: [{ version_id: "fixture-version", percentage: 100 }] }] };
    } else if (request.url === `/client/v4/accounts/${accountId}/workers/scripts/fixture-workshop/versions/fixture-version`) {
      result = { id: "fixture-version", annotations: { "workers/message": `Guild OS ${"1".repeat(40)}` } };
    } else {
      response.writeHead(404).end(JSON.stringify({ success: false }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/account-cli-runner.mjs", import.meta.url))], {
    cwd: directory, stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH, HOME: join(directory, "home"), TMPDIR: directory,
      XDG_CONFIG_HOME: join(directory, "home"), XDG_CACHE_HOME: join(directory, "home"),
      CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false",
      WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
      CLOUDFLARE_API_TOKEN: ["synthetic", "fixture", "only"].join("-"),
      GUILD_ACCOUNT_FIXTURE: JSON.stringify(config),
      GUILD_FIXTURE_API: `http://127.0.0.1:${server.address().port}/client/v4`,
    },
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).fixtureOnly, true);
  assert.deepEqual(paths, [
    { method: "GET", url: `/client/v4/accounts/${accountId}/workers/scripts/fixture-workshop/deployments` },
    { method: "GET", url: `/client/v4/accounts/${accountId}/workers/scripts/fixture-workshop/versions/fixture-version` },
  ]);
});
