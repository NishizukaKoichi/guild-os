import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { captureWorkerDeployments, assertWorkerDeploymentsMatchRelease } from "../ops-core.mjs";

const config = JSON.parse(process.env.GUILD_ACCOUNT_FIXTURE);
const release = "1".repeat(40);
const wrangler = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
// Only the transport is redirected to the loopback fixture; the actual installed CLI resolves
// account/config precedence and produces JSON. This can never be operational evidence.
const runner = (command, args, options) => {
  assert.equal(command, "pnpm");
  assert.deepEqual(args.slice(0, 2), ["exec", "wrangler"]);
  assert.equal(options.env.CLOUDFLARE_API_BASE_URL, "https://api.cloudflare.com/client/v4");
  return execFileSync(process.execPath, [wrangler, ...args.slice(2)], {
    cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
    env: { ...options.env, CLOUDFLARE_API_BASE_URL: process.env.GUILD_FIXTURE_API },
    stdio: ["ignore", "pipe", "pipe"],
  });
};
const inventory = captureWorkerDeployments(config, runner);
assertWorkerDeploymentsMatchRelease(inventory, release, config, runner);
console.log(JSON.stringify({ fixtureOnly: true, inventory }));
