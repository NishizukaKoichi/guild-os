import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { activeWorkerReleaseCommit, assertWorkerInventory, captureWorkerDeployments, productionUrls } from "./ops-core.mjs";
import { captureWorkersDevRouting, runProductionSmoke, smokeWorkshop } from "./production-smoke.mjs";

const accountId = "a".repeat(32);
const config = {
  accountId,
  workers: { workshop: { name: "fixture-workshop", route: { customDomain: "expected.example.invalid" } } },
  referenceWebhook: { enabled: false },
};

test("an unrelated Workshop URL cannot be attached to a configured target", () => {
  assert.throws(() => productionUrls(config, "https://unrelated.example.invalid"), /Workshop/);
});

test("inventory capture pins the account in both environment and explicit Wrangler configuration", () => {
  let calls = 0;
  let path;
  const deployments = captureWorkerDeployments(config, (_command, args, options) => {
    calls += 1;
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
    const index = args.indexOf("--config");
    assert.ok(index >= 0, "a shell account alone loses to ambient Wrangler configuration");
    path = args[index + 1];
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { account_id: accountId });
    assert.equal(options.env.CLOUDFLARE_ENV, undefined);
    assert.equal(options.env.CLOUDFLARE_API_BASE_URL, "https://api.cloudflare.com/client/v4");
    return JSON.stringify({ id: "fixture-deployment", versions: [{ version_id: "fixture-version", percentage: 100 }] });
  });
  assert.equal(calls, 1);
  assert.equal(deployments[0].accountId, accountId);
  assert.equal(existsSync(path), false);
});

function environment(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}

test("only an exact canonical same-target HTTPS override is accepted", () => {
  assert.equal(productionUrls(config, "https://expected.example.invalid/").workshop, "https://expected.example.invalid");
  for (const value of ["http://expected.example.invalid", "https://expected.example.invalid:444",
    "https://expected.example.invalid:443", "https://user@expected.example.invalid",
    "https://expected.example.invalid/path", "https://expected.example.invalid/../",
    "https://expected.example.invalid?", "https://expected.example.invalid#",
    "https://expected.example.invalid.evil.invalid", " https://expected.example.invalid",
    "https://expected.example.invalid\\", "https://expected.example.invalid/%2e%2e"]) {
    assert.throws(() => productionUrls(config, value), /Workshop/);
  }
  assert.throws(() => productionUrls({ ...config, workers: { workshop: { name: "fixture", route: {} } } }), /route/);
});

test("wrong account contexts and unbound inventories fail before any CLI call", (t) => {
  const inventory = [{ accountId, workerName: "fixture-workshop", versions: [{ id: "fixture-version", percentage: 100 }] }];
  const never = () => { assert.fail("no CLI call is allowed"); };
  for (const changed of [[], [{ ...inventory[0], accountId: undefined }],
    [{ ...inventory[0], accountId: "b".repeat(32) }], [...inventory, ...inventory],
    [{ ...inventory[0], versions: [{ id: "", percentage: 100 }] }]]) {
    assert.throws(() => activeWorkerReleaseCommit(changed, config, never));
  }
  environment(t, "CLOUDFLARE_ACCOUNT_ID", "b".repeat(32));
  assert.throws(() => captureWorkerDeployments(config, never), /conflicts/);
  assert.throws(() => assertWorkerInventory(config, inventory), /conflicts/);
});

test("legacy wrong account contexts also fail closed", (t) => {
  environment(t, "CF_ACCOUNT_ID", "b".repeat(32));
  assert.throws(() => captureWorkerDeployments(config, () => assert.fail("no CLI")), /conflicts/);
});

test("version lookup rejects a wrong response ID and always pins its account", () => {
  const inventory = [{ accountId, workerName: "fixture-workshop", versions: [{ id: "fixture-version", percentage: 100 }] }];
  assert.throws(() => activeWorkerReleaseCommit(inventory, config, (_command, args, options) => {
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
    assert.equal(JSON.parse(readFileSync(args.at(-1), "utf8")).account_id, accountId);
    return JSON.stringify({ id: "other-version", annotations: { "workers/message": `Guild OS ${"1".repeat(40)}` } });
  }), /different or unresolved/);
});

const workersDev = { ...config, workers: { workshop: { name: "fixture-workshop", route: { workersDev: true } } } };
const routing = { accountId, workerName: "fixture-workshop", enabled: true, subdomain: "purchaser" };

test("workers.dev requires an account-bound enabled route, never a caller-guessed subdomain", () => {
  const url = "https://fixture-workshop.purchaser.workers.dev";
  assert.equal(productionUrls(workersDev, `${url}/`, routing).workshop, url);
  for (const proof of [undefined, { ...routing, accountId: "b".repeat(32) },
    { ...routing, workerName: "other" }, { ...routing, enabled: false },
    { ...routing, subdomain: "purchaser.workers.dev.evil" }]) {
    assert.throws(() => productionUrls(workersDev, url, proof), /verified account/);
  }
  assert.throws(() => productionUrls(workersDev, "https://fixture-workshop.other.workers.dev", routing), /exact configured route/);
});

test("workers.dev routing is read from fixed account-scoped API paths without redirects", async (t) => {
  environment(t, "CLOUDFLARE_API_TOKEN", ["synthetic", "fixture", "only"].join("-"));
  const calls = [];
  const result = await captureWorkersDevRouting(workersDev, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    return Response.json({ success: true, result: calls.length === 1 ? { subdomain: "purchaser" } : { enabled: true } });
  });
  assert.deepEqual(result, routing);
  assert.deepEqual(calls, [
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/fixture-workshop/subdomain`,
  ]);
  assert.doesNotMatch(JSON.stringify(result), /synthetic/);
  await assert.rejects(() => captureWorkersDevRouting(workersDev, async () => Response.json({ success: false })), /Unable to verify/);
});

test("workers.dev has no fallback when account routing credentials or metadata are unavailable", async (t) => {
  environment(t, "CLOUDFLARE_API_TOKEN", undefined);
  await assert.rejects(() => captureWorkersDevRouting(workersDev, () => assert.fail("no request")), /API token/);
});

test("authenticated Workshop redirects are rejected without forwarding service credentials", async () => {
  let calls = 0;
  await assert.rejects(() => smokeWorkshop("https://expected.example.invalid", "https://team.cloudflareaccess.com",
    { clientId: "fixture", clientSecret: "fixture" }, async (_url, options) => {
      calls += 1;
      assert.equal(options.redirect, calls === 1 ? "manual" : "error");
      return new Response(null, { status: 302, headers: { location: calls === 1
        ? "https://team.cloudflareaccess.com/cdn-cgi/access/login/fixture" : "https://other.example.invalid" } });
    }), /service-token Workshop smoke failed/);
  assert.equal(calls, 2);
});

test("invalid target overrides fail before a smoke HTTP request", async () => {
  const input = { ...config, context: { kvNamespaceId: "fixture" }, resources: {
    blueprintsKvNamespaceId: "fixture", avatarsKvNamespaceId: "fixture",
    blueprintContentBucket: "fixture", knowledgeFilesBucket: "fixture",
  } };
  await assert.rejects(() => runProductionSmoke({ config: input,
    workshopUrl: "https://other.example.invalid", sourceSnapshot: { commit: "1".repeat(40) },
    fetcher: async () => assert.fail("no smoke request"), deployments: [],
  }), /exact configured route/);
});
