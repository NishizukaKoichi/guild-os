import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSmokeArguments,
  smokeReceiver,
  smokeWorkshop,
  runProductionSmoke,
} from "./production-smoke.mjs";
import { sha256Object } from "./ops-core.mjs";

test("injected smoke records target binding but cannot claim live release verification", async () => {
  const config = {
    accountId: "a".repeat(32),
    guild: { id: "fixture-guild" },
    workers: { workshop: { name: "fixture-workshop", route: { customDomain: "guild.example.invalid" } } },
    access: { issuer: "https://team.cloudflareaccess.com" },
    context: { kvNamespaceId: "fixture-context" },
    resources: {
      blueprintsKvNamespaceId: "fixture-blueprints", avatarsKvNamespaceId: "fixture-avatars",
      blueprintContentBucket: "fixture-blueprints", knowledgeFilesBucket: "fixture-knowledge",
    },
    referenceWebhook: { enabled: false },
  };
  const deployments = [{ workerName: "fixture-workshop", versions: [{ id: "fixture", percentage: 100 }] }];
  const evidence = await runProductionSmoke({
    config,
    sourceSnapshot: { commit: "1".repeat(40) },
    deployments,
    fetcher: async (_url, options) => options.redirect === "manual"
      ? new Response(null, {
        status: 302,
        headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/fixture" },
      })
      : new Response("<title>Cloudflare OS</title>", { status: 200 }),
  });
  assert.deepEqual(evidence.target, {
    accountId: config.accountId, guildId: config.guild.id, configSha256: sha256Object(config),
  });
  assert.deepEqual(evidence.deploymentVerification, {
    executionMode: "injected-runner", releaseCommit: null, inventorySha256: sha256Object(deployments),
  });
  const { evidenceSha256, ...core } = evidence;
  assert.equal(evidenceSha256, sha256Object(core));
});

test("production smoke arguments require external evidence output", () => {
  assert.deepEqual(parseSmokeArguments([
    "--", "--output", "/tmp/smoke.json", "--url", "https://guild.example.com",
  ]), {
    output: "/tmp/smoke.json",
    workshopUrl: "https://guild.example.com",
  });
  assert.throws(() => parseSmokeArguments(["--output", "smoke.json"]), /absolute/i);
  assert.throws(() => parseSmokeArguments([
    "--output", "/tmp/smoke.json", "--skip-access",
  ]), /unknown/i);
});

test("Workshop smoke proves Access redirect and optional service-token reachability", async () => {
  const calls = [];
  const fetcher = async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/guild",
        },
      });
    }
    return new Response("<title>Cloudflare OS</title>", { status: 200 });
  };
  const result = await smokeWorkshop(
    "https://guild.example.com",
    "https://team.cloudflareaccess.com",
    { clientId: "client-id", clientSecret: "client-secret" },
    fetcher,
  );

  assert.equal(result.accessProtected, true);
  assert.equal(result.authenticatedServiceCheck, "passed");
  assert.equal(calls[1].headers["cf-access-client-id"], "client-id");
  assert.equal(calls[1].headers["cf-access-client-secret"], "client-secret");
  assert.doesNotMatch(JSON.stringify(result), /client-secret/);
});

test("Workshop smoke rejects an exposed application or unrelated redirect", async () => {
  await assert.rejects(() => smokeWorkshop(
    "https://guild.example.com",
    "https://team.cloudflareaccess.com",
    {},
    async () => new Response("public", { status: 200 }),
  ), /not demonstrably protected/i);
  await assert.rejects(() => smokeWorkshop(
    "https://guild.example.com",
    "https://team.cloudflareaccess.com",
    {},
    async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/cdn-cgi/access/login" },
    }),
  ), /not demonstrably protected/i);
});

test("receiver smoke verifies health headers and unsigned-request denial", async () => {
  let call = 0;
  const result = await smokeReceiver("https://hooks.example.com/healthz", async () => {
    call += 1;
    if (call === 1) {
      return Response.json({ ok: true, service: "guild-os-webhook-receiver" }, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
  });

  assert.equal(result.unsignedRequestRejected, true);
  assert.equal(call, 2);
});
