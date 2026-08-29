import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { chmod, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, printParseErrorCode } from "jsonc-parser";
import { applyProvisioningLock, validateConfig } from "./deploy.mjs";
import {
  deploymentConfigEvidenceLabel,
  resolveDeploymentConfigPath,
} from "./deployment-config.mjs";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const deploymentLockPath = join(repositoryRoot, "deployment.lock.json");

export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Object(value) {
  return sha256Text(JSON.stringify(stableJson(value)));
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

export async function readJsonc(path) {
  const errors = [];
  const value = parse(await readFile(path, "utf8"), errors);
  if (errors.length) {
    throw new Error(
      `${relative(repositoryRoot, path)}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`,
    );
  }
  return value;
}

export async function readResolvedDeployment() {
  const deployment = validateConfig(await readJsonc(resolveDeploymentConfigPath()));
  const lock = existsSync(deploymentLockPath) ? await readJsonc(deploymentLockPath) : null;
  return applyProvisioningLock(deployment, lock);
}

export function selectedDeploymentConfig() {
  const path = resolveDeploymentConfigPath();
  return { path, evidenceLabel: deploymentConfigEvidenceLabel(path) };
}

export function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 2_000);
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }
  const output = String(result.stdout ?? "");
  return options.preserveLeading ? output.trimEnd() : output.trim();
}

export function assertCommand(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Required command is not installed: ${command}`);
  }
  if (result.error) throw result.error;
  return String(result.stdout || result.stderr || "").trim().split("\n")[0];
}

export function gitSourceSnapshot({ requireClean = true } = {}) {
  const status = runCapture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (requireClean && status) {
    throw new Error("The Git worktree must be clean before producing release evidence.");
  }
  const submodules = runCapture(
    "git",
    ["submodule", "status", "--recursive"],
    { preserveLeading: true },
  );
  const unpinned = submodules.split("\n").filter(Boolean)
    .filter((line) => !line.startsWith(" "));
  if (unpinned.length) {
    throw new Error("Every Git submodule must be initialized at the recorded commit.");
  }
  return {
    commit: runCapture("git", ["rev-parse", "HEAD"]),
    tree: runCapture("git", ["rev-parse", "HEAD^{tree}"]),
    branch: runCapture("git", ["branch", "--show-current"]),
    commitTime: runCapture("git", ["show", "-s", "--format=%cI", "HEAD"]),
    dirty: Boolean(status),
    submodules: submodules.split("\n").filter(Boolean).map((line) => {
      const match = line.match(/^ ([0-9a-f]{40}) (\S+)(?: \(.+\))?$/i);
      if (!match) throw new Error(`Unexpected Git submodule status: ${line}`);
      return { path: match[2], commit: match[1] };
    }),
  };
}

export async function migrationInventory() {
  const directory = join(repositoryRoot, "packages/guild-postgres/migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    const details = await stat(path);
    return { name, bytes: details.size, sha256: await sha256File(path) };
  }));
}

export function deploymentResourceSummary(config) {
  return {
    format: "guild-os-deployment-summary/v1",
    configSha256: sha256Object(config),
    accountId: config.accountId,
    workers: Object.fromEntries(Object.entries(config.workers)
      .filter(([key]) =>
        (key !== "errorReporter" || config.errorReporting.enabled) &&
        (key !== "webhookReceiver" || config.referenceWebhook.enabled))
      .map(([key, worker]) => [key, {
        name: worker.name,
        ...(worker.route ? { route: worker.route } : {}),
      }])),
    access: {
      issuerSha256: sha256Text(config.access.issuer),
      audienceSha256: sha256Text(config.access.audience),
      administratorCount: config.access.admins.length,
      administratorSetSha256: sha256Object([...config.access.admins].sort()),
    },
    context: {
      sharingDomain: config.context.sharingDomain,
      kvNamespaceId: config.context.kvNamespaceId,
      artifacts: config.context.artifacts ?? { enabled: false },
    },
    guild: {
      id: config.guild.id,
      nameSha256: sha256Text(config.guild.name),
      purposeSha256: sha256Text(config.guild.purpose),
      hyperdriveId: config.guild.hyperdriveId,
      agentWorkflowName: config.guild.agentWorkflowName,
      maintenanceCron: config.guild.maintenanceCron ?? "0 * * * *",
      webhookConnectorId: config.guild.webhook.connectorId,
      webhookOrigin: new URL(config.guild.webhook.url).origin,
    },
    resources: structuredClone(config.resources),
    capabilities: {
      aiGateway: config.aiGateway.enabled,
      errorReporting: config.errorReporting.enabled,
      referenceWebhook: config.referenceWebhook.enabled,
      observability: structuredClone(config.observability),
    },
  };
}

export function deploymentRecoveryConfiguration(config) {
  return {
    accountId: config.accountId,
    workers: Object.fromEntries(Object.entries(config.workers)
      .filter(([key]) =>
        (key !== "errorReporter" || config.errorReporting.enabled) &&
        (key !== "webhookReceiver" || config.referenceWebhook.enabled))
      .map(([key, worker]) => [key, {
        name: worker.name,
        ...(worker.route ? { route: structuredClone(worker.route) } : {}),
      }])),
    access: {
      issuer: config.access.issuer,
      audience: config.access.audience,
      admins: [...config.access.admins],
    },
    aiGateway: structuredClone(config.aiGateway),
    context: {
      sharingDomain: config.context.sharingDomain,
      kvNamespaceId: config.context.kvNamespaceId,
      ...(config.context.artifacts ? { artifacts: structuredClone(config.context.artifacts) } : {}),
    },
    guild: {
      id: config.guild.id,
      name: config.guild.name,
      purpose: config.guild.purpose,
      rootSpaceName: config.guild.rootSpaceName,
      level2ApprovalQuorum: config.guild.level2ApprovalQuorum,
      level3ApprovalQuorum: config.guild.level3ApprovalQuorum,
      dataRetentionDays: config.guild.dataRetentionDays,
      hyperdriveId: config.guild.hyperdriveId,
      askModel: config.guild.askModel,
      aiGatewayId: config.guild.aiGatewayId,
      askRequestsPerMinute: config.guild.askRequestsPerMinute,
      recoveryAttemptsPerMinute: config.guild.recoveryAttemptsPerMinute,
      agentWorkflowName: config.guild.agentWorkflowName,
      maintenanceCron: config.guild.maintenanceCron ?? "0 * * * *",
      webhook: {
        connectorId: config.guild.webhook.connectorId,
        name: config.guild.webhook.name,
        url: config.guild.webhook.url,
      },
    },
    errorReporting: structuredClone(config.errorReporting),
    referenceWebhook: structuredClone(config.referenceWebhook),
    resources: structuredClone(config.resources),
    observability: structuredClone(config.observability),
  };
}

export function workerEntries(config) {
  return Object.entries(config.workers)
    .filter(([key]) =>
      (key !== "errorReporter" || config.errorReporting.enabled) &&
      (key !== "webhookReceiver" || config.referenceWebhook.enabled))
    .map(([key, worker]) => ({ key, name: worker.name }));
}

export function deploymentLockSnapshot(config) {
  assertResolvedResources(config);
  return {
    format: "guild-os-deployment-lock/v1",
    accountId: config.accountId,
    guildId: config.guild.id,
    workers: Object.fromEntries(workerEntries(config).map(({ key, name }) => [key, name])),
    resources: {
      contextKvNamespaceId: config.context.kvNamespaceId,
      blueprintsKvNamespaceId: config.resources.blueprintsKvNamespaceId,
      avatarsKvNamespaceId: config.resources.avatarsKvNamespaceId,
      blueprintContentBucket: config.resources.blueprintContentBucket,
      knowledgeFilesBucket: config.resources.knowledgeFilesBucket,
    },
  };
}

export function assertResolvedResources(config) {
  const values = {
    "context.kvNamespaceId": config.context.kvNamespaceId,
    "resources.blueprintsKvNamespaceId": config.resources.blueprintsKvNamespaceId,
    "resources.avatarsKvNamespaceId": config.resources.avatarsKvNamespaceId,
    "resources.blueprintContentBucket": config.resources.blueprintContentBucket,
    "resources.knowledgeFilesBucket": config.resources.knowledgeFilesBucket,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => typeof value !== "string" || !value)
    .map(([path]) => path);
  if (missing.length) {
    throw new Error(
      `Production resources are unresolved (${missing.join(", ")}). Run one deployment to create deployment.lock.json.`,
    );
  }
}

export function sanitizeDeploymentStatus(workerName, value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.versions)) {
    throw new Error(`Cloudflare returned an invalid deployment status for ${workerName}.`);
  }
  const versions = value.versions.map((version) => {
    if (typeof version?.version_id !== "string" ||
        typeof version?.percentage !== "number") {
      throw new Error(`Cloudflare returned an invalid active version for ${workerName}.`);
    }
    return { id: version.version_id, percentage: version.percentage };
  });
  if (!versions.length || versions.reduce((sum, version) => sum + version.percentage, 0) !== 100) {
    throw new Error(`${workerName} does not have a complete active deployment.`);
  }
  return {
    workerName,
    deploymentId: typeof value.id === "string" ? value.id : null,
    createdOn: typeof value.created_on === "string" ? value.created_on : null,
    source: typeof value.source === "string" ? value.source : null,
    versions,
  };
}

export function captureWorkerDeployments(config, runner = runCapture) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.GUILD_WEBHOOK_SIGNING_SECRET;
  delete env.CF_AI_GATEWAY_API_TOKEN;
  return workerEntries(config).map(({ key, name }) => {
    const output = runner("pnpm", [
      "exec", "wrangler", "deployments", "status", "--name", name, "--json",
    ], { env: { ...env, ...(process.env.CLOUDFLARE_API_TOKEN
      ? { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
      : {}) } });
    return { key, ...sanitizeDeploymentStatus(name, JSON.parse(output)) };
  });
}

export function activeWorkerReleaseCommit(deployments, runner = runCapture) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.GUILD_WEBHOOK_SIGNING_SECRET;
  delete env.CF_AI_GATEWAY_API_TOKEN;
  delete env.CF_ACCESS_CLIENT_ID;
  delete env.CF_ACCESS_CLIENT_SECRET;
  const releases = new Set();
  for (const deployment of deployments) {
    if (!Array.isArray(deployment?.versions) || deployment.versions.length !== 1 ||
        deployment.versions[0]?.percentage !== 100 ||
        typeof deployment.versions[0]?.id !== "string") {
      throw new Error(`${deployment?.workerName ?? "Worker"} is not on one complete active version.`);
    }
    const version = JSON.parse(runner("pnpm", [
      "exec", "wrangler", "versions", "view", deployment.versions[0].id,
      "--name", deployment.workerName, "--json",
    ], { env: { ...env, ...(process.env.CLOUDFLARE_API_TOKEN
      ? { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
      : {}) } }));
    const match = /^Guild OS ([a-f0-9]{40})$/i.exec(
      version?.annotations?.["workers/message"] ?? "",
    );
    if (!match) {
      throw new Error(`${deployment.workerName} does not identify one Guild OS release.`);
    }
    releases.add(match[1].toLowerCase());
  }
  if (releases.size !== 1) {
    throw new Error("Active Workers do not share one Guild OS release.");
  }
  return [...releases][0];
}

export function assertWorkerDeploymentsMatchRelease(deployments, releaseCommit, runner = runCapture) {
  if (!/^[a-f0-9]{40}$/i.test(releaseCommit ?? "")) {
    throw new Error("A full release commit is required to verify active Worker versions.");
  }
  let activeRelease;
  try {
    activeRelease = activeWorkerReleaseCommit(deployments, runner);
  } catch (error) {
    throw new Error(`Workers are not running release ${releaseCommit}. ${error.message}`);
  }
  if (activeRelease !== releaseCommit.toLowerCase()) {
    throw new Error(`Workers are not running release ${releaseCommit}.`);
  }
  return deployments;
}

export function productionUrls(config, workshopOverride) {
  const workshop = workshopOverride ?? (config.workers.workshop.route.customDomain
    ? `https://${config.workers.workshop.route.customDomain}`
    : null);
  const receiver = config.referenceWebhook.enabled
    ? config.guild.webhook.url.replace(/\/guild-events$/, "/healthz")
    : null;
  if (!workshop) {
    throw new Error("Pass --url for a workers.dev Workshop deployment.");
  }
  return { workshop, receiver };
}

export async function writeAtomicJson(path, value, mode = 0o600) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode });
  await rename(temporary, path);
  await chmod(path, mode);
}
