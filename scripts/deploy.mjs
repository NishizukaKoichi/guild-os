import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentLockPath = join(root, "deployment.lock.json");
// One deployment per checkout; use separate worktrees for concurrent deploys.
const generatedName = "wrangler.prod.jsonc";
const generatedPaths = {
  workshop: join(root, "cloudflare-os/packages/workshop-backend", generatedName),
  context: join(root, "cloudflare-os/packages/gatekeeper-context", generatedName),
  guildGatekeeper: join(root, "packages/guild-gatekeeper", generatedName),
  webhookReceiver: join(root, "packages/webhook-receiver", generatedName),
  errorReporter: join(root, "packages/error-reporter", generatedName),
};
const defaultContextArtifactsNamespace = "gatekeeper-context-collections";

const requiredPaths = [
  "accountId",
  "workers.workshop.name",
  "workers.context.name",
  "workers.guildGatekeeper.name",
  "access.issuer",
  "access.audience",
  "access.admins",
  "aiGateway.enabled",
  "errorReporting.enabled",
  "referenceWebhook.enabled",
  "context.sharingDomain",
  "guild.id",
  "guild.name",
  "guild.purpose",
  "guild.rootSpaceName",
  "guild.level2ApprovalQuorum",
  "guild.level3ApprovalQuorum",
  "guild.dataRetentionDays",
  "guild.hyperdriveId",
  "guild.askModel",
  "guild.aiGatewayId",
  "guild.askRequestsPerMinute",
  "guild.recoveryAttemptsPerMinute",
  "guild.agentWorkflowName",
  "guild.webhook.connectorId",
  "guild.webhook.name",
  "guild.webhook.url",
  "observability.enabled",
  "observability.headSamplingRate",
  "observability.logs.invocationLogs",
  "observability.traces.enabled",
  "observability.traces.headSamplingRate",
];

const aiGatewayPaths = [
  "aiGateway.name",
  "aiGateway.accountId",
  "aiGateway.providers",
  "aiGateway.workersAi.mode",
];

const errorReportingPaths = [
  "workers.errorReporter.name",
  "errorReporting.environment",
];

const referenceWebhookPaths = [
  "workers.webhookReceiver.name",
];

const resourcePaths = [
  "context.kvNamespaceId",
  "resources.blueprintsKvNamespaceId",
  "resources.avatarsKvNamespaceId",
  "resources.blueprintContentBucket",
  "resources.knowledgeFilesBucket",
];

function configuredWorkerNames(config) {
  return Object.fromEntries(Object.entries(config.workers)
    .filter(([key]) =>
      (key !== "errorReporter" || config.errorReporting.enabled) &&
      (key !== "webhookReceiver" || config.referenceWebhook.enabled))
    .map(([key, worker]) => [key, worker.name]));
}

export function applyProvisioningLock(config, lock) {
  if (!lock) return config;
  if (lock.format !== "guild-os-deployment-lock/v1" ||
      lock.accountId !== config.accountId || lock.guildId !== config.guild.id) {
    throw new Error("deployment.lock.json does not belong to this account and Guild.");
  }
  const expectedWorkers = configuredWorkerNames(config);
  if (JSON.stringify(lock.workers) !== JSON.stringify(expectedWorkers)) {
    throw new Error("deployment.lock.json Worker names do not match deployment.jsonc.");
  }

  const resolved = structuredClone(config);
  const pairs = [
    ["context.kvNamespaceId", lock.resources.contextKvNamespaceId],
    ["resources.blueprintsKvNamespaceId", lock.resources.blueprintsKvNamespaceId],
    ["resources.avatarsKvNamespaceId", lock.resources.avatarsKvNamespaceId],
    ["resources.blueprintContentBucket", lock.resources.blueprintContentBucket],
    ["resources.knowledgeFilesBucket", lock.resources.knowledgeFilesBucket],
  ];
  for (const [path, lockedValue] of pairs) {
    if (lockedValue === undefined || lockedValue !== null &&
        (typeof lockedValue !== "string" || !lockedValue)) {
      throw new Error(`deployment.lock.json is missing ${path}.`);
    }
    if (lockedValue === null) continue;
    const configuredValue = valueAt(resolved, path);
    if (configuredValue !== null && configuredValue !== lockedValue) {
      throw new Error(`deployment.lock.json conflicts with deployment.jsonc at ${path}.`);
    }
    const keys = path.split(".");
    let target = resolved;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = lockedValue;
  }
  return resolved;
}

function generatedBinding(source, collection, binding, valueKey, allowIncomplete) {
  const entry = source?.[collection]?.find((candidate) => candidate.binding === binding);
  const value = entry?.[valueKey];
  if (allowIncomplete && (value === undefined || value === null)) return null;
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Wrangler did not persist ${binding} ${valueKey}; production resource identity is unknown.`,
    );
  }
  return value;
}

export function provisioningLockFromGenerated(config, generated, { allowIncomplete = false } = {}) {
  return {
    format: "guild-os-deployment-lock/v1",
    accountId: config.accountId,
    guildId: config.guild.id,
    workers: configuredWorkerNames(config),
    resources: {
      contextKvNamespaceId: generatedBinding(
        generated.context,
        "kv_namespaces",
        "CONTEXT_COLLECTIONS",
        "id",
        allowIncomplete,
      ),
      blueprintsKvNamespaceId: generatedBinding(
        generated.workshop,
        "kv_namespaces",
        "BLUEPRINTS",
        "id",
        allowIncomplete,
      ),
      avatarsKvNamespaceId: generatedBinding(
        generated.workshop,
        "kv_namespaces",
        "AVATARS",
        "id",
        allowIncomplete,
      ),
      blueprintContentBucket: generatedBinding(
        generated.workshop,
        "r2_buckets",
        "BLUEPRINT_CONTENT",
        "bucket_name",
        allowIncomplete,
      ),
      knowledgeFilesBucket: generatedBinding(
        generated.guildGatekeeper,
        "r2_buckets",
        "KNOWLEDGE_FILES",
        "bucket_name",
        allowIncomplete,
      ),
    },
  };
}

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

export function validateConfig(config) {
  const activePaths = [
    ...requiredPaths,
    ...(config.aiGateway?.enabled ? aiGatewayPaths : []),
    ...(config.errorReporting?.enabled ? errorReportingPaths : []),
    ...(config.referenceWebhook?.enabled ? referenceWebhookPaths : []),
  ];
  for (const path of activePaths) {
    const value = valueAt(config, path);
    if (value === undefined || value === null || value === "" || Array.isArray(value) && !value.length) {
      throw new Error(`Missing required deployment value: ${path}`);
    }
  }

  for (const path of resourcePaths) {
    const value = valueAt(config, path);
    if (value === undefined || value !== null && (typeof value !== "string" || !value)) {
      throw new Error(`Deployment resource must be null or a non-empty string: ${path}`);
    }
  }

  let activeConfig = !config.aiGateway.enabled
    ? { ...config, aiGateway: { enabled: false } }
    : config.aiGateway.workersAi.mode === "direct"
      ? { ...config, aiGateway: {
        ...config.aiGateway,
        workersAi: { mode: "direct" },
      } }
      : config;
  if (!config.errorReporting.enabled) {
    activeConfig = {
      ...activeConfig,
      workers: { ...activeConfig.workers, errorReporter: undefined },
      errorReporting: { enabled: false },
    };
  }
  if (!config.referenceWebhook.enabled) {
    activeConfig = {
      ...activeConfig,
      workers: { ...activeConfig.workers, webhookReceiver: undefined },
      referenceWebhook: { enabled: false },
    };
  }
  const placeholder = JSON.stringify(activeConfig).match(/<[^>]+>/)?.[0];
  if (placeholder) throw new Error(`Replace deployment placeholder ${placeholder}.`);

  const stringPaths = activePaths.filter((path) => ![
    "access.admins",
    "aiGateway.enabled",
    "aiGateway.providers",
    "errorReporting.enabled",
    "referenceWebhook.enabled",
    "observability.enabled",
    "observability.headSamplingRate",
    "observability.logs.invocationLogs",
    "observability.traces.enabled",
    "observability.traces.headSamplingRate",
    "guild.level2ApprovalQuorum",
    "guild.level3ApprovalQuorum",
    "guild.dataRetentionDays",
    "guild.askRequestsPerMinute",
    "guild.recoveryAttemptsPerMinute",
  ].includes(path));
  for (const path of stringPaths) {
    if (typeof valueAt(config, path) !== "string") {
      throw new Error(`Deployment value must be a string: ${path}`);
    }
  }

  if (!/^[a-f\d]{32}$/i.test(config.accountId) ||
      config.aiGateway.enabled && !/^[a-f\d]{32}$/i.test(config.aiGateway.accountId)) {
    throw new Error("Cloudflare account IDs must be 32 hexadecimal characters.");
  }
  if (!/^[a-f\d]{32}$/i.test(config.guild.hyperdriveId)) {
    throw new Error("Guild Hyperdrive ID must be 32 hexadecimal characters.");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.guild.agentWorkflowName)) {
    throw new Error("Guild Agent Workflow name must use lowercase letters, numbers, and hyphens.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(config.guild.webhook.connectorId)) {
    throw new Error("Guild Webhook Connector ID must be a UUID.");
  }
  if (typeof config.guild.webhook.name !== "string" ||
      !config.guild.webhook.name.trim() || config.guild.webhook.name.length > 200) {
    throw new Error("Guild Webhook name must contain 1-200 characters.");
  }
  const webhookUrl = new URL(config.guild.webhook.url);
  if (webhookUrl.protocol !== "https:" || webhookUrl.username || webhookUrl.password ||
      webhookUrl.search || webhookUrl.hash || config.guild.webhook.url.length > 2048) {
    throw new Error("Guild Webhook URL must be a credential-free HTTPS URL without query or hash.");
  }
  if (!/^@cf\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(config.guild.askModel)) {
    throw new Error("Guild Ask model must be a Workers AI @cf/provider/model identifier.");
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(config.guild.aiGatewayId)) {
    throw new Error("Guild AI Gateway ID must use letters, numbers, underscores, or hyphens.");
  }
  if (config.resources.knowledgeFilesBucket !== null &&
      !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(config.resources.knowledgeFilesBucket)) {
    throw new Error("Knowledge files R2 bucket must be a 3-63 character lowercase bucket name.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(config.guild.id)) {
    throw new Error("Guild ID must be a UUID.");
  }
  for (const path of [
    "guild.level2ApprovalQuorum",
    "guild.level3ApprovalQuorum",
    "guild.dataRetentionDays",
    "guild.askRequestsPerMinute",
    "guild.recoveryAttemptsPerMinute",
  ]) {
    const value = valueAt(config, path);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Guild deployment value must be a positive integer: ${path}`);
    }
  }
  if (config.guild.askRequestsPerMinute > 10_000) {
    throw new Error("Guild Ask request limit cannot exceed 10,000 requests per minute.");
  }
  if (config.guild.recoveryAttemptsPerMinute > 100) {
    throw new Error("Guild recovery attempt limit cannot exceed 100 attempts per minute.");
  }
  const workerNames = Object.entries(config.workers)
    .filter(([key]) =>
      (key !== "errorReporter" || config.errorReporting.enabled) &&
      (key !== "webhookReceiver" || config.referenceWebhook.enabled))
    .map(([, worker]) => worker.name);
  if (new Set(workerNames).size !== workerNames.length) {
    throw new Error("Every enabled Worker name must be unique.");
  }
  if (!workerNames.every((name) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name))) {
    throw new Error("Worker names must use lowercase letters, numbers, and hyphens.");
  }

  const route = config.workers.workshop.route;
  if (!route || Boolean(route.workersDev) === Boolean(route.customDomain)) {
    throw new Error("Set exactly one Workshop route: workersDev or customDomain.");
  }
  if (route.workersDev !== undefined && route.workersDev !== true) {
    throw new Error("Workshop workersDev must be boolean true when selected.");
  }
  if (route.customDomain !== undefined && typeof route.customDomain !== "string") {
    throw new Error("Workshop customDomain must be a string.");
  }
  const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (route.customDomain && !hostnamePattern.test(route.customDomain)) {
    throw new Error("Workshop customDomain must be a lowercase hostname.");
  }

  if (typeof config.referenceWebhook.enabled !== "boolean") {
    throw new Error("Reference Webhook enabled must be a boolean.");
  }
  if (config.referenceWebhook.enabled) {
    const receiverRoute = config.workers.webhookReceiver.route;
    if (!receiverRoute ||
        Boolean(receiverRoute.workersDev) === Boolean(receiverRoute.customDomain)) {
      throw new Error("Set exactly one Reference Webhook route: workersDev or customDomain.");
    }
    if (receiverRoute.workersDev !== undefined && receiverRoute.workersDev !== true) {
      throw new Error("Reference Webhook workersDev must be boolean true when selected.");
    }
    if (receiverRoute.customDomain !== undefined &&
        (typeof receiverRoute.customDomain !== "string" ||
         !hostnamePattern.test(receiverRoute.customDomain))) {
      throw new Error("Reference Webhook customDomain must be a lowercase hostname.");
    }
    if (webhookUrl.pathname !== "/guild-events") {
      throw new Error("The Reference Webhook URL path must be /guild-events.");
    }
    if (receiverRoute.customDomain && webhookUrl.hostname !== receiverRoute.customDomain) {
      throw new Error("The Reference Webhook URL and customDomain must use the same hostname.");
    }
  }

  const issuer = new URL(config.access.issuer);
  if (issuer.protocol !== "https:" ||
      issuer.origin !== config.access.issuer.replace(/\/$/, "")) {
    throw new Error("Cloudflare Access issuer must be an HTTPS origin only.");
  }
  if (!config.access.audience.trim() || config.access.audience !== config.access.audience.trim()) {
    throw new Error("Cloudflare Access audience must not be blank or padded with whitespace.");
  }
  if (!Array.isArray(config.access.admins) ||
      !config.access.admins.every((email) =>
        typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email))) {
    throw new Error("Every Access administrator must be an email address.");
  }

  if (typeof config.aiGateway.enabled !== "boolean") {
    throw new Error("AI Gateway enabled must be a boolean.");
  }
  if (config.aiGateway.enabled) {
    const providers = new Set(["anthropic", "openai", "google", "cloudflare"]);
    if (!Array.isArray(config.aiGateway.providers) ||
        !config.aiGateway.providers.every((provider) => providers.has(provider))) {
      throw new Error("AI Gateway providers must be anthropic, openai, google, or cloudflare.");
    }
    const workersAi = config.aiGateway.workersAi;
    if (!(["direct", "gateway"].includes(workersAi.mode))) {
      throw new Error("Workers AI mode must be direct or gateway.");
    }
    if (workersAi.mode === "gateway" &&
        (typeof workersAi.gateway !== "string" || !workersAi.gateway.trim())) {
      throw new Error("Workers AI gateway mode requires a gateway name string.");
    }
  }

  if (typeof config.errorReporting.enabled !== "boolean") {
    throw new Error("Error reporting enabled must be a boolean.");
  }
  const release = config.errorReporting.release;
  if (release !== null &&
      (typeof release !== "string" || !release.trim() || release !== release.trim())) {
    throw new Error("Error reporting release must be null or a non-padded string.");
  }

  const artifactsConfig = config.context.artifacts;
  if (artifactsConfig !== undefined &&
      (artifactsConfig === null || typeof artifactsConfig !== "object" ||
       Array.isArray(artifactsConfig))) {
    throw new Error("Context Artifacts configuration must be an object when present.");
  }
  const artifactsEnabled = artifactsConfig?.enabled;
  if (artifactsEnabled !== undefined && typeof artifactsEnabled !== "boolean") {
    throw new Error("Context Artifacts enabled must be a boolean.");
  }
  const artifactsNamespace = artifactsConfig?.namespace;
  if (artifactsNamespace !== undefined &&
      (typeof artifactsNamespace !== "string" ||
       !/^[a-z\d][a-z\d._-]*$/i.test(artifactsNamespace))) {
    throw new Error("Context Artifacts namespace must be omitted or start with a letter or number and use only letters, numbers, dots, underscores, and hyphens.");
  }

  const sampling = config.observability.headSamplingRate;
  if (typeof config.observability.enabled !== "boolean") {
    throw new Error("Observability enabled must be a boolean.");
  }
  if (typeof sampling !== "number" || sampling < 0 || sampling > 1) {
    throw new Error("Observability headSamplingRate must be between 0 and 1.");
  }
  if (typeof config.observability.logs.invocationLogs !== "boolean" ||
      typeof config.observability.traces.enabled !== "boolean") {
    throw new Error("Observability log and trace controls must be booleans.");
  }
  const traceSampling = config.observability.traces.headSamplingRate;
  if (typeof traceSampling !== "number" || traceSampling < 0 || traceSampling > 1) {
    throw new Error("Observability trace sampling must be between 0 and 1.");
  }
  return config;
}

export function deploymentSecretsFromEnvironment(config, env) {
  const webhookSigningSecret = env.GUILD_WEBHOOK_SIGNING_SECRET;
  if (typeof webhookSigningSecret !== "string" ||
      Buffer.byteLength(webhookSigningSecret, "utf8") < 32) {
    throw new Error(
      "GUILD_WEBHOOK_SIGNING_SECRET must be set to at least 32 bytes for deployment.",
    );
  }

  const secrets = {
    guildGatekeeper: { GUILD_WEBHOOK_SIGNING_SECRET: webhookSigningSecret },
    ...(config.referenceWebhook.enabled ? {
      webhookReceiver: { GUILD_WEBHOOK_SIGNING_SECRET: webhookSigningSecret },
    } : {}),
  };
  if (config.aiGateway.enabled) {
    const aiGatewayToken = env.CF_AI_GATEWAY_API_TOKEN;
    if (typeof aiGatewayToken !== "string" || !aiGatewayToken.trim()) {
      throw new Error("CF_AI_GATEWAY_API_TOKEN must be set when AI Gateway is enabled.");
    }
    secrets.workshop = { CF_AI_GATEWAY_API_TOKEN: aiGatewayToken };
  }
  return secrets;
}

function routeConfig(route) {
  return route.workersDev
    ? { workers_dev: true, routes: undefined }
    : { workers_dev: false, routes: [{ pattern: route.customDomain, custom_domain: true }] };
}

function setCommon(config, deployment, name, route = { workersDev: false }) {
  config.account_id = deployment.accountId;
  config.name = name;
  config.workers_dev = route.workersDev;
  delete config.routes;
  if (route.customDomain) Object.assign(config, routeConfig(route));
  config.observability = {
    ...config.observability,
    enabled: deployment.observability.enabled,
    head_sampling_rate: deployment.observability.headSamplingRate,
    logs: {
      ...config.observability?.logs,
      invocation_logs: deployment.observability.logs.invocationLogs,
    },
    traces: {
      ...config.observability?.traces,
      enabled: deployment.observability.traces.enabled,
      head_sampling_rate: deployment.observability.traces.headSamplingRate,
    },
  };
}

export function generateConfigs(config, bases) {
  validateConfig(config);
  const workshop = structuredClone(bases.workshop);
  const context = structuredClone(bases.context);
  const guildGatekeeper = structuredClone(bases.guildGatekeeper);
  const webhookReceiver = config.referenceWebhook.enabled
    ? structuredClone(bases.webhookReceiver)
    : undefined;
  const errorReporter = config.errorReporting.enabled
    ? structuredClone(bases.errorReporter)
    : undefined;

  setCommon(workshop, config, config.workers.workshop.name, config.workers.workshop.route);
  workshop.vars = {
    ADMINS: config.access.admins,
    CF_ACCESS_ISS: config.access.issuer.replace(/\/$/, ""),
    CF_ACCESS_AUD: config.access.audience,
  };
  if (config.aiGateway.enabled) {
    Object.assign(workshop.vars, {
      CF_AI_GATEWAY: config.aiGateway.name,
      CF_AI_GATEWAY_ACCOUNT_ID: config.aiGateway.accountId,
      CF_AI_GATEWAY_PROVIDERS: config.aiGateway.providers.join(","),
    });
    workshop.secrets = {
      ...workshop.secrets,
      required: [...new Set([
        ...(workshop.secrets?.required ?? []),
        "CF_AI_GATEWAY_API_TOKEN",
      ])],
    };
    if (config.aiGateway.workersAi.mode === "gateway") {
      workshop.vars.CF_AI_GATEWAY_WAI = config.aiGateway.workersAi.gateway;
    } else {
      workshop.vars.CF_AI_GATEWAY_WAI_DIRECT = "true";
    }
  }
  workshop.ai = { binding: "WORKERS_AI" };
  workshop.services = [
    ...(config.errorReporting.enabled ? [{
      binding: "ERROR_REPORTER",
      service: config.workers.errorReporter.name,
      entrypoint: "ErrorReporter",
      props: {
        service: config.workers.workshop.name,
        environment: config.errorReporting.environment,
        ...(config.errorReporting.release ? { release: config.errorReporting.release } : {}),
      },
    }] : []),
    {
      binding: "GATEKEEPER_CONTEXT",
      service: config.workers.context.name,
      entrypoint: "GatekeeperVendor",
      props: { sharingDomain: config.context.sharingDomain },
    },
    {
      binding: "GATEKEEPER_GUILD",
      service: config.workers.guildGatekeeper.name,
      entrypoint: "GatekeeperVendor",
    },
  ];
  workshop.kv_namespaces = [
    { binding: "BLUEPRINTS", ...(config.resources.blueprintsKvNamespaceId
      ? { id: config.resources.blueprintsKvNamespaceId } : {}) },
    { binding: "AVATARS", ...(config.resources.avatarsKvNamespaceId
      ? { id: config.resources.avatarsKvNamespaceId } : {}) },
  ];
  workshop.r2_buckets = [
    { binding: "BLUEPRINT_CONTENT", ...(config.resources.blueprintContentBucket
      ? { bucket_name: config.resources.blueprintContentBucket } : {}) },
  ];
  workshop.assets = {
    directory: "../workshop-frontend/dist",
    not_found_handling: "single-page-application",
    run_worker_first: ["/api", "/api/*", "/blueprint-screenshot/*"],
  };

  setCommon(context, config, config.workers.context.name);
  context.kv_namespaces = [
    { binding: "CONTEXT_COLLECTIONS", ...(config.context.kvNamespaceId
      ? { id: config.context.kvNamespaceId } : {}) },
  ];
  if (config.context.artifacts?.enabled ?? false) {
    context.artifacts = [{
      binding: "ARTIFACTS",
      namespace: config.context.artifacts?.namespace ?? defaultContextArtifactsNamespace,
    }];
  } else {
    delete context.artifacts;
  }

  setCommon(guildGatekeeper, config, config.workers.guildGatekeeper.name);
  guildGatekeeper.vars = {
    GUILD_ID: config.guild.id,
    GUILD_NAME: config.guild.name,
    GUILD_PURPOSE: config.guild.purpose,
    GUILD_ROOT_SPACE_NAME: config.guild.rootSpaceName,
    GUILD_LEVEL2_QUORUM: String(config.guild.level2ApprovalQuorum),
    GUILD_LEVEL3_QUORUM: String(config.guild.level3ApprovalQuorum),
    GUILD_RETENTION_DAYS: String(config.guild.dataRetentionDays),
    GUILD_ASK_MODEL: config.guild.askModel,
    GUILD_AI_GATEWAY_ID: config.guild.aiGatewayId,
    GUILD_WEBHOOK_CONNECTOR_ID: config.guild.webhook.connectorId,
    GUILD_WEBHOOK_CONNECTOR_NAME: config.guild.webhook.name,
    GUILD_WEBHOOK_URL: config.guild.webhook.url,
  };
  guildGatekeeper.secrets = {
    required: ["GUILD_WEBHOOK_SIGNING_SECRET"],
  };
  guildGatekeeper.hyperdrive = [{
    binding: "HYPERDRIVE",
    id: config.guild.hyperdriveId,
  }];
  guildGatekeeper.ai = { binding: "AI" };
  guildGatekeeper.r2_buckets = [{
    binding: "KNOWLEDGE_FILES",
    ...(config.resources.knowledgeFilesBucket
      ? { bucket_name: config.resources.knowledgeFilesBucket }
      : {}),
  }];
  const rateLimitNamespaceBase = Number.parseInt(
    config.guild.id.replaceAll("-", "").slice(0, 8),
    16,
  );
  guildGatekeeper.ratelimits = [
    {
      name: "ASK_RATE_LIMITER",
      namespace_id: String(rateLimitNamespaceBase + 1),
      simple: { limit: config.guild.askRequestsPerMinute, period: 60 },
    },
    {
      name: "RECOVERY_RATE_LIMITER",
      namespace_id: String(rateLimitNamespaceBase + 2),
      simple: { limit: config.guild.recoveryAttemptsPerMinute, period: 60 },
    },
  ];
  guildGatekeeper.workflows = [{
    name: config.guild.agentWorkflowName,
    binding: "AGENT_EXECUTION",
    class_name: "AgentExecutionWorkflow",
  }];
  guildGatekeeper.compatibility_flags = [...new Set([
    ...(guildGatekeeper.compatibility_flags ?? []),
    "global_fetch_strictly_public",
  ])];
  guildGatekeeper.triggers = { crons: ["*/5 * * * *"] };

  if (webhookReceiver) {
    setCommon(
      webhookReceiver,
      config,
      config.workers.webhookReceiver.name,
      config.workers.webhookReceiver.route,
    );
  }

  if (errorReporter) {
    setCommon(errorReporter, config, config.workers.errorReporter.name);
  }

  return {
    workshop,
    context,
    guildGatekeeper,
    ...(webhookReceiver && { webhookReceiver }),
    ...(errorReporter && { errorReporter }),
  };
}

async function readJsonc(path) {
  const errors = [];
  const result = parse(await readFile(path, "utf8"), errors);
  if (errors.length) {
    const where = relative(root, path) || path;
    throw new Error(`${where}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}`);
  }
  return result;
}

// Every validateConfig message names a config path, so say which file those paths live in.
async function readDeployment(path) {
  const config = await readJsonc(path);
  try {
    return validateConfig(config);
  } catch (error) {
    throw new Error(`${relative(root, path)}: ${error.message}`);
  }
}

async function readDeploymentLock() {
  if (!existsSync(deploymentLockPath)) return null;
  return readJsonc(deploymentLockPath);
}

async function persistDeploymentLock(config, allowIncomplete = false) {
  const deployed = {};
  for (const [name, path] of Object.entries(generatedPaths)) {
    if ((name === "webhookReceiver" && !config.referenceWebhook.enabled) ||
        (name === "errorReporter" && !config.errorReporting.enabled)) continue;
    deployed[name] = await readJsonc(path);
  }
  const lock = provisioningLockFromGenerated(config, deployed, { allowIncomplete });
  const temporaryPath = `${deploymentLockPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(lock, null, 2) + "\n", { mode: 0o600 });
  await rename(temporaryPath, deploymentLockPath);
  await chmod(deploymentLockPath, 0o600);
}

function sanitizedChildEnv(env) {
  const childEnv = { ...env };
  delete childEnv.DATABASE_URL;
  delete childEnv.GUILD_WEBHOOK_SIGNING_SECRET;
  delete childEnv.CF_AI_GATEWAY_API_TOKEN;
  delete childEnv.CF_ACCESS_CLIENT_ID;
  delete childEnv.CF_ACCESS_CLIENT_SECRET;
  return childEnv;
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: sanitizedChildEnv(process.env),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed before deployment.`);
  }
  return String(result.stdout ?? "");
}

export function assertDeployableGitState(status, submodules) {
  if (status.trim()) {
    throw new Error("Commit every source change before a production deployment.");
  }
  const invalid = submodules.trimEnd().split("\n").filter(Boolean)
    .filter((line) => !line.startsWith(" "));
  if (invalid.length) {
    throw new Error("Every Git submodule must be initialized at its recorded commit before deployment.");
  }
}

function releaseSource() {
  const status = capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const submodules = capture("git", ["submodule", "status", "--recursive"]);
  assertDeployableGitState(status, submodules);
  const commit = capture("git", ["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Git did not return a release commit.");
  return commit;
}

export function deploymentVersionArgs(commit) {
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("Release commit must be a full Git SHA.");
  return [
    "--strict",
    "--message", `Guild OS ${commit}`,
    "--tag", `guild-os-${commit.slice(0, 12)}`,
  ];
}

function run(args, cwd = root, env = process.env) {
  const result = spawnSync("pnpm", args, {
    cwd,
    env: sanitizedChildEnv(env),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const where = relative(root, cwd) || ".";
    throw new Error(`${where}: pnpm ${args.join(" ")} failed. Its output is above.`);
  }
}

function requireSubmodule() {
  if (!existsSync(join(root, "cloudflare-os/package.json"))) {
    throw new Error("CloudflareOS submodule is not initialized. Run git submodule update --init.");
  }
}

function build(config) {
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/gatekeeper-context", "build"]);
  run(["--dir", "packages/guild-gatekeeper", "run", "build"]);
  if (config.referenceWebhook.enabled) {
    run(["--dir", "packages/webhook-receiver", "run", "build"]);
  }
  if (config.errorReporting.enabled) {
    run(["--dir", "packages/error-reporter", "run", "build"]);
  }
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/workshop-frontend", "build"], root, {
    ...process.env,
    VITE_CF_ACCESS_MODE: "true",
  });
  run(["--dir", "cloudflare-os", "--filter", "@gadgets/workshop-backend", "build"]);
}

async function main() {
  requireSubmodule();
  const deployment = await readDeployment(join(root, "deployment.jsonc"));
  const config = applyProvisioningLock(deployment, await readDeploymentLock());
  const check = process.argv.includes("--check");
  const releaseCommit = check ? null : releaseSource();
  if (!check) {
    const { verifyProductionDatabase } = await import("./database-preflight.mjs");
    const result = await verifyProductionDatabase(process.env.DATABASE_URL);
    console.log(JSON.stringify({ event: "guild.database.preflight", ...result }));
  }
  // Validate every secret before any Worker is deployed. Dry runs intentionally remain secret-free.
  const deploymentSecrets = check
    ? undefined
    : deploymentSecretsFromEnvironment(config, process.env);
  const generated = generateConfigs(config, {
    workshop: await readJsonc(join(root, "cloudflare-os/packages/workshop-backend/wrangler.jsonc")),
    context: await readJsonc(join(root, "cloudflare-os/packages/gatekeeper-context/wrangler.jsonc")),
    guildGatekeeper: await readJsonc(join(root, "packages/guild-gatekeeper/wrangler.jsonc")),
    webhookReceiver: await readJsonc(join(root, "packages/webhook-receiver/wrangler.jsonc")),
    errorReporter: await readJsonc(join(root, "packages/error-reporter/wrangler.jsonc")),
  });

  let secretsDirectory;
  const secretFiles = {};
  let deploymentError = null;
  let deploymentStarted = false;
  try {
    for (const [name, generatedConfig] of Object.entries(generated)) {
      await writeFile(generatedPaths[name], JSON.stringify(generatedConfig, null, 2) + "\n");
    }
    run(["test"]);
    run(["lint"]);
    build(config);

    if (deploymentSecrets) {
      secretsDirectory = await mkdtemp(join(tmpdir(), "guild-os-secrets-"));
      await chmod(secretsDirectory, 0o700);
      for (const [name, secrets] of Object.entries(deploymentSecrets)) {
        const path = join(secretsDirectory, `${name}.json`);
        await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
        secretFiles[name] = path;
      }
    }

    const deployArgs = check ? ["--dry-run"] : deploymentVersionArgs(releaseCommit);
    const secretsArgs = (name) => secretFiles[name]
      ? ["--secrets-file", secretFiles[name]]
      : [];
    deploymentStarted = !check;
    if (config.referenceWebhook.enabled) {
      run(["exec", "wrangler", "deploy", "--config", generatedName,
        ...secretsArgs("webhookReceiver"), ...deployArgs],
      join(root, "packages/webhook-receiver"));
    }
    if (config.errorReporting.enabled) {
      run(["exec", "wrangler", "deploy", "--config", generatedName, ...deployArgs],
        join(root, "packages/error-reporter"));
    }
    run(["exec", "wrangler", "deploy", "--config", generatedName, ...deployArgs],
      join(root, "cloudflare-os/packages/gatekeeper-context"));
    run(["exec", "wrangler", "deploy", "--config", generatedName,
      ...secretsArgs("guildGatekeeper"), ...deployArgs],
      join(root, "packages/guild-gatekeeper"));
    run(["exec", "wrangler", "deploy", "--config", generatedName,
      ...secretsArgs("workshop"), ...deployArgs],
      join(root, "cloudflare-os/packages/workshop-backend"));
    if (!check) await persistDeploymentLock(config);
  } catch (error) {
    deploymentError = error;
    throw error;
  } finally {
    if (deploymentStarted && deploymentError) {
      try {
        await persistDeploymentLock(config, true);
      } catch {
        // Preserve the deployment failure. Wrangler may not have provisioned any resource yet.
      }
    }
    await Promise.all([
      ...Object.values(generatedPaths).map((path) => rm(path, { force: true })),
      ...(secretsDirectory ? [rm(secretsDirectory, { recursive: true, force: true })] : []),
    ]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    // One line, no stack: every failure here is a config or subprocess problem, not a script bug.
    console.error(`\nDeploy failed. ${error.message}`);
    process.exitCode = 1;
  }
}
