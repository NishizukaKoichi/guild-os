import assert from "node:assert/strict";
import test from "node:test";
import {
  activeWorkerReleaseCommit,
  assertResolvedResources,
  assertWorkerDeploymentsMatchRelease,
  deploymentLockSnapshot,
  deploymentRecoveryConfiguration,
  deploymentResourceSummary,
  productionUrls,
  sanitizeDeploymentStatus,
  sha256Object,
} from "./ops-core.mjs";
import { parseReleaseArguments } from "./release-manifest.mjs";

function config() {
  return {
    accountId: "0123456789abcdef0123456789abcdef",
    workers: {
      workshop: { name: "guild-workshop", route: { customDomain: "guild.example.com" } },
      context: { name: "guild-context" },
      guildGatekeeper: { name: "guild-gatekeeper" },
      webhookReceiver: {
        name: "guild-webhook",
        route: { customDomain: "hooks.example.com" },
      },
      errorReporter: { name: "guild-errors" },
    },
    access: {
      issuer: "https://private.cloudflareaccess.com",
      audience: "private-audience",
      admins: ["owner@example.com"],
    },
    aiGateway: { enabled: false },
    errorReporting: { enabled: true },
    referenceWebhook: { enabled: true },
    observability: { enabled: true },
    context: {
      sharingDomain: "production",
      kvNamespaceId: "11111111111111111111111111111111",
    },
    guild: {
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
      name: "Private Guild Name",
      purpose: "Private organizational purpose",
      hyperdriveId: "22222222222222222222222222222222",
      agentWorkflowName: "guild-agent-workflow",
      webhook: {
        connectorId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b",
        url: "https://hooks.example.com/guild-events",
      },
    },
    resources: {
      blueprintsKvNamespaceId: "33333333333333333333333333333333",
      avatarsKvNamespaceId: "44444444444444444444444444444444",
      blueprintContentBucket: "guild-blueprints",
      knowledgeFilesBucket: "guild-knowledge",
    },
  };
}

test("release resource summary excludes private labels and Access identities", () => {
  const input = config();
  const serialized = JSON.stringify(deploymentResourceSummary(input));

  assert.doesNotMatch(serialized, /owner@example\.com/);
  assert.doesNotMatch(serialized, /Private Guild Name/);
  assert.doesNotMatch(serialized, /Private organizational purpose/);
  assert.doesNotMatch(serialized, /private-audience/);
  assert.doesNotMatch(serialized, /private\.cloudflareaccess\.com/);
  assert.match(serialized, /administratorSetSha256/);
});

test("encrypted recovery configuration keeps required settings and rejects unknown fields", () => {
  const input = config();
  input.accidentalSecret = "must-not-be-copied";
  input.guild.accidentalSecret = "must-not-be-copied-either";
  const recovery = deploymentRecoveryConfiguration(input);
  const serialized = JSON.stringify(recovery);
  assert.equal(recovery.access.admins[0], "owner@example.com");
  assert.equal(recovery.guild.name, "Private Guild Name");
  assert.doesNotMatch(serialized, /must-not-be-copied/);
  assert.equal("accidentalSecret" in recovery, false);
  assert.equal("accidentalSecret" in recovery.guild, false);
});

test("active deployment evidence strips author identity and requires 100 percent traffic", () => {
  const sanitized = sanitizeDeploymentStatus("guild-workshop", {
    id: "deployment-id",
    created_on: "2026-08-12T00:00:00.000Z",
    author_email: "operator@example.com",
    source: "wrangler",
    versions: [{ version_id: "version-id", percentage: 100 }],
  });

  assert.equal(sanitized.deploymentId, "deployment-id");
  assert.deepEqual(sanitized.versions, [{ id: "version-id", percentage: 100 }]);
  assert.doesNotMatch(JSON.stringify(sanitized), /operator@example\.com/);
  assert.throws(() => sanitizeDeploymentStatus("guild-workshop", {
    versions: [{ version_id: "version-id", percentage: 50 }],
  }), /complete active deployment/i);
});

test("active Worker versions must identify the exact source release", () => {
  const deployments = [{
    workerName: "guild-workshop",
    versions: [{ id: "version-id", percentage: 100 }],
  }];
  const release = "0123456789abcdef0123456789abcdef01234567";
  const calls = [];
  assert.equal(assertWorkerDeploymentsMatchRelease(
    deployments,
    release,
    (command, args) => {
      calls.push([command, args]);
      return JSON.stringify({ annotations: { "workers/message": `Guild OS ${release}` } });
    },
  ), deployments);
  assert.deepEqual(calls[0][1], [
    "exec", "wrangler", "versions", "view", "version-id",
    "--name", "guild-workshop", "--json",
  ]);
  assert.throws(() => assertWorkerDeploymentsMatchRelease(
    deployments,
    release,
    () => JSON.stringify({ annotations: { "workers/message": "Guild OS stale" } }),
  ), /not running release/i);
});

test("active Workers expose one shared release for pre-deploy backups", () => {
  const release = "0123456789abcdef0123456789abcdef01234567";
  const deployments = ["workshop", "gatekeeper"].map((workerName, index) => ({
    workerName,
    versions: [{ id: `version-${index}`, percentage: 100 }],
  }));
  assert.equal(activeWorkerReleaseCommit(
    deployments,
    () => JSON.stringify({ annotations: { "workers/message": `Guild OS ${release}` } }),
  ), release);
  let call = 0;
  assert.throws(() => activeWorkerReleaseCommit(deployments, () => {
    call += 1;
    const active = call === 1 ? release : "abcdef0123456789abcdef0123456789abcdef01";
    return JSON.stringify({ annotations: { "workers/message": `Guild OS ${active}` } });
  }), /do not share one Guild OS release/i);
});

test("production resources and URLs must resolve explicitly", () => {
  const input = config();
  assert.doesNotThrow(() => assertResolvedResources(input));
  assert.deepEqual(productionUrls(input), {
    workshop: "https://guild.example.com",
    receiver: "https://hooks.example.com/healthz",
  });

  input.resources.knowledgeFilesBucket = null;
  assert.throws(() => assertResolvedResources(input), /unresolved/i);
});

test("deployment lock snapshots every purchaser-owned automatic resource", () => {
  const input = config();
  assert.deepEqual(deploymentLockSnapshot(input), {
    format: "guild-os-deployment-lock/v1",
    accountId: input.accountId,
    guildId: input.guild.id,
    workers: {
      workshop: input.workers.workshop.name,
      context: input.workers.context.name,
      guildGatekeeper: input.workers.guildGatekeeper.name,
      webhookReceiver: input.workers.webhookReceiver.name,
      errorReporter: input.workers.errorReporter.name,
    },
    resources: {
      contextKvNamespaceId: input.context.kvNamespaceId,
      blueprintsKvNamespaceId: input.resources.blueprintsKvNamespaceId,
      avatarsKvNamespaceId: input.resources.avatarsKvNamespaceId,
      blueprintContentBucket: input.resources.blueprintContentBucket,
      knowledgeFilesBucket: input.resources.knowledgeFilesBucket,
    },
  });
});

test("release argument parsing requires an external absolute output", () => {
  assert.deepEqual(parseReleaseArguments([
    "--", "--output", "/tmp/release.json", "--url", "https://guild.example.com", "--offline",
  ]), {
    output: "/tmp/release.json",
    workshopUrl: "https://guild.example.com",
    offline: true,
  });
  assert.throws(() => parseReleaseArguments(["--output", "release.json"]), /absolute/i);
  assert.throws(() => parseReleaseArguments([
    "--output", "/tmp/release.json", "--unknown",
  ]), /unknown/i);
});

test("canonical object hashing is independent of object key order", () => {
  assert.equal(sha256Object({ b: 2, a: { d: 4, c: 3 } }),
    sha256Object({ a: { c: 3, d: 4 }, b: 2 }));
});
