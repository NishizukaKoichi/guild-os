import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "jsonc-parser";
import {
  applyProvisioningLock,
  assertDatabaseOutageReleaseChanges,
  assertDatabaseOutageRuntimePatchHashes,
  assertExistingSecretBindings,
  assertDeployableGitState,
  deploymentVersionArgs,
  deploymentSecretsFromEnvironment,
  generateConfigs,
  outageRollbackArgs,
  parseWranglerSecretList,
  provisioningLockFromGenerated,
  provisioningLockFromWorkerVersions,
  releaseCommitFromWorkerVersion,
  requiredSecretBindings,
  validateConfig,
} from "./deploy.mjs";

const validConfig = {
  accountId: "0123456789abcdef0123456789abcdef",
  workers: {
    workshop: { name: "acme-cloudflare-os", route: { customDomain: "os.example.com" } },
    context: { name: "acme-cloudflare-os-context" },
    guildGatekeeper: { name: "acme-guild-os-gatekeeper" },
    webhookReceiver: {
      name: "acme-guild-os-webhook",
      route: { customDomain: "hooks.example.com" },
    },
    errorReporter: { name: "acme-cloudflare-os-errors" },
  },
  access: {
    issuer: "https://acme.cloudflareaccess.com",
    audience: "access-audience",
    admins: ["admin@example.com"],
  },
  aiGateway: {
    enabled: true,
    name: "cloudflare-os",
    accountId: "fedcba9876543210fedcba9876543210",
    providers: ["anthropic", "cloudflare"],
    workersAi: { mode: "gateway", gateway: "cloudflare-os-workers-ai" },
  },
  context: {
    sharingDomain: "production",
    kvNamespaceId: "context-kv-id",
    artifacts: { enabled: true, namespace: "acme-context-collections" },
  },
  guild: {
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
    name: "Acme Guild",
    purpose: "Coordinate Acme people and agents.",
    rootSpaceName: "Acme",
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 2555,
    hyperdriveId: "abcdef0123456789abcdef0123456789",
    bootstrapModel: "@cf/meta/llama-3.1-8b-instruct-fast",
    modelProvider: {
      kind: "workers_ai",
      name: "Cloudflare Workers AI",
      endpoint: null,
    },
    askModel: "@cf/meta/llama-3.1-8b-instruct-fast",
    aiGatewayId: "default",
    askRequestsPerMinute: 20,
    recoveryAttemptsPerMinute: 5,
    agentWorkflowName: "acme-guild-agent-execution",
    maintenanceCron: "0 * * * *",
    webhook: {
      connectorId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b",
      name: "Approved operations webhook",
      url: "https://hooks.example.com/guild-events",
    },
  },
  errorReporting: { enabled: true, environment: "production", release: "abc123" },
  referenceWebhook: { enabled: true },
  resources: {
    blueprintsKvNamespaceId: "blueprints-kv-id",
    avatarsKvNamespaceId: "avatars-kv-id",
    blueprintContentBucket: "cloudflare-os-blueprints",
    knowledgeFilesBucket: "acme-guild-knowledge",
  },
  observability: {
    enabled: true,
    headSamplingRate: 0.5,
    logs: { invocationLogs: false },
    traces: { enabled: true, headSamplingRate: 0.25 },
  },
};

async function baseConfigs() {
  return {
    workshop: await baseConfig("../cloudflare-os/packages/workshop-backend/wrangler.jsonc"),
    context: await baseConfig("../cloudflare-os/packages/gatekeeper-context/wrangler.jsonc"),
    guildGatekeeper: await baseConfig("../packages/guild-gatekeeper/wrangler.jsonc"),
    webhookReceiver: await baseConfig("../packages/webhook-receiver/wrangler.jsonc"),
    errorReporter: {
      name: "error-reporter",
      observability: { enabled: true, logs: { invocation_logs: false } },
    },
  };
}

async function baseConfig(path) {
  return parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("rejects deployment placeholders", () => {
  const placeholder = structuredClone(validConfig);
  placeholder.accountId = "<CLOUDFLARE_ACCOUNT_ID>";
  assert.throws(() => validateConfig(placeholder), /placeholder/i);
});

test("rejects secret-like keys anywhere in deployment configuration", () => {
  const nested = structuredClone(validConfig);
  nested.guild.webhook.signingSecret = "do-not-store-this";
  assert.throws(() => validateConfig(nested), /secret-like deployment key.*signingSecret/i);

  const database = structuredClone(validConfig);
  database.guild.databaseUrl = "postgresql://example.invalid/guild";
  assert.throws(() => validateConfig(database), /secret-like deployment key.*databaseUrl/i);
});

test("rejects destructive or malformed deployment values", () => {
  const duplicateWorkers = structuredClone(validConfig);
  duplicateWorkers.workers.context.name = duplicateWorkers.workers.workshop.name;
  assert.throws(() => validateConfig(duplicateWorkers), /unique/i);

  const stringBoolean = structuredClone(validConfig);
  stringBoolean.observability.enabled = "true";
  assert.throws(() => validateConfig(stringBoolean), /boolean/i);

  const invalidDomain = structuredClone(validConfig);
  invalidDomain.workers.workshop.route.customDomain = "os.example.com/path";
  assert.throws(() => validateConfig(invalidDomain), /hostname/i);

  const numericGateway = structuredClone(validConfig);
  numericGateway.aiGateway.workersAi.gateway = 42;
  assert.throws(() => validateConfig(numericGateway), /gateway name/i);

  const issuerWithPath = structuredClone(validConfig);
  issuerWithPath.access.issuer += "/team";
  assert.throws(() => validateConfig(issuerWithPath), /issuer.*origin/i);

  const blankAudience = structuredClone(validConfig);
  blankAudience.access.audience = "   ";
  assert.throws(() => validateConfig(blankAudience), /audience/i);

  const paddedAudience = structuredClone(validConfig);
  paddedAudience.access.audience = " access-audience ";
  assert.throws(() => validateConfig(paddedAudience), /audience/i);

  const malformedAdmin = structuredClone(validConfig);
  malformedAdmin.access.admins = ["bad-address"];
  assert.throws(() => validateConfig(malformedAdmin), /email/i);

  const malformedGuildId = structuredClone(validConfig);
  malformedGuildId.guild.id = "not-a-uuid";
  assert.throws(() => validateConfig(malformedGuildId), /Guild ID.*UUID/i);

  const malformedHyperdriveId = structuredClone(validConfig);
  malformedHyperdriveId.guild.hyperdriveId = "not-an-id";
  assert.throws(() => validateConfig(malformedHyperdriveId), /Hyperdrive ID/i);

  const invalidQuorum = structuredClone(validConfig);
  invalidQuorum.guild.level3ApprovalQuorum = 0;
  assert.throws(() => validateConfig(invalidQuorum), /positive integer/i);

  const invalidAskLimit = structuredClone(validConfig);
  invalidAskLimit.guild.askRequestsPerMinute = 0;
  assert.throws(() => validateConfig(invalidAskLimit), /positive integer/i);

  const excessiveAskLimit = structuredClone(validConfig);
  excessiveAskLimit.guild.askRequestsPerMinute = 10_001;
  assert.throws(() => validateConfig(excessiveAskLimit), /cannot exceed/i);

  const invalidRecoveryLimit = structuredClone(validConfig);
  invalidRecoveryLimit.guild.recoveryAttemptsPerMinute = 0;
  assert.throws(() => validateConfig(invalidRecoveryLimit), /positive integer/i);

  const excessiveRecoveryLimit = structuredClone(validConfig);
  excessiveRecoveryLimit.guild.recoveryAttemptsPerMinute = 101;
  assert.throws(() => validateConfig(excessiveRecoveryLimit), /recovery attempt limit/i);

  const unsafeWebhook = structuredClone(validConfig);
  unsafeWebhook.guild.webhook.url = "http://127.0.0.1/internal";
  assert.throws(() => validateConfig(unsafeWebhook), /Webhook URL.*HTTPS/i);

  const invalidExternalModel = structuredClone(validConfig);
  invalidExternalModel.guild.modelProvider = {
    kind: "openai_compatible",
    name: "Purchaser Model",
    endpoint: "http://models.example.com/v1",
  };
  invalidExternalModel.guild.askModel = "owned-model";
  assert.throws(() => validateConfig(invalidExternalModel), /Model endpoint.*HTTPS/i);

  const invalidWorkersModel = structuredClone(validConfig);
  invalidWorkersModel.guild.askModel = "not-a-workers-ai-model";
  assert.throws(() => validateConfig(invalidWorkersModel), /Workers AI.*identifier/i);

  const malformedWorkflow = structuredClone(validConfig);
  malformedWorkflow.guild.agentWorkflowName = "Bad Workflow";
  assert.throws(() => validateConfig(malformedWorkflow), /Workflow name/i);

  const malformedMaintenanceCron = structuredClone(validConfig);
  malformedMaintenanceCron.guild.maintenanceCron = "@hourly\nSECRET=value";
  assert.throws(() => validateConfig(malformedMaintenanceCron), /maintenance Cron/i);

  const invalidTraceSampling = structuredClone(validConfig);
  invalidTraceSampling.observability.traces.headSamplingRate = 2;
  assert.throws(() => validateConfig(invalidTraceSampling), /sampling/i);

  const stringArtifactsEnabled = structuredClone(validConfig);
  stringArtifactsEnabled.context.artifacts.enabled = "true";
  assert.throws(() => validateConfig(stringArtifactsEnabled), /Artifacts enabled.*boolean/i);

  const nullArtifactsConfig = structuredClone(validConfig);
  nullArtifactsConfig.context.artifacts = null;
  assert.throws(() => validateConfig(nullArtifactsConfig), /Artifacts configuration.*object/i);

  const arrayArtifactsConfig = structuredClone(validConfig);
  arrayArtifactsConfig.context.artifacts = [];
  assert.throws(() => validateConfig(arrayArtifactsConfig), /Artifacts configuration.*object/i);

  const nullArtifactsNamespace = structuredClone(validConfig);
  nullArtifactsNamespace.context.artifacts.namespace = null;
  assert.throws(() => validateConfig(nullArtifactsNamespace), /namespace must be omitted/i);

  const invalidArtifactsNamespace = structuredClone(validConfig);
  invalidArtifactsNamespace.context.artifacts.namespace = "context/collections";
  assert.throws(() => validateConfig(invalidArtifactsNamespace), /namespace must be omitted/i);
});

test("requires deployment secrets before any live deploy", () => {
  assert.throws(
    () => deploymentSecretsFromEnvironment(validConfig, {}),
    /GUILD_WEBHOOK_SIGNING_SECRET.*32 bytes/i,
  );
  assert.throws(
    () => deploymentSecretsFromEnvironment(validConfig, {
      GUILD_WEBHOOK_SIGNING_SECRET: "too-short",
    }),
    /GUILD_WEBHOOK_SIGNING_SECRET.*32 bytes/i,
  );
  assert.throws(
    () => deploymentSecretsFromEnvironment(validConfig, {
      GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    }),
    /CF_AI_GATEWAY_API_TOKEN.*enabled/i,
  );
});

test("returns only secrets required by the active deployment", () => {
  assert.deepEqual(deploymentSecretsFromEnvironment(validConfig, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    CF_AI_GATEWAY_API_TOKEN: "cloudflare-api-token",
    UNRELATED_SECRET: "must-not-be-forwarded",
  }), {
    guildGatekeeper: { GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32) },
    webhookReceiver: { GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32) },
    workshop: { CF_AI_GATEWAY_API_TOKEN: "cloudflare-api-token" },
  });

  const withoutAi = structuredClone(validConfig);
  withoutAi.aiGateway.enabled = false;
  assert.deepEqual(deploymentSecretsFromEnvironment(withoutAi, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
  }), {
    guildGatekeeper: { GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32) },
    webhookReceiver: { GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32) },
  });
});

test("verifies existing required Secret names without reading Secret values", async () => {
  const generated = generateConfigs(validConfig, await baseConfigs());
  const required = requiredSecretBindings(generated);
  assert.deepEqual(required, {
    workshop: ["CF_AI_GATEWAY_API_TOKEN"],
    guildGatekeeper: ["GUILD_WEBHOOK_SIGNING_SECRET"],
    webhookReceiver: ["GUILD_WEBHOOK_SIGNING_SECRET"],
  });
  const listed = parseWranglerSecretList(JSON.stringify([
    { name: "GUILD_WEBHOOK_SIGNING_SECRET", type: "secret_text" },
    { name: "GUILD_WEBHOOK_SIGNING_SECRET", type: "secret_text" },
  ]));
  assert.deepEqual(listed, ["GUILD_WEBHOOK_SIGNING_SECRET"]);
  assert.doesNotThrow(() => assertExistingSecretBindings(required, {
    workshop: ["CF_AI_GATEWAY_API_TOKEN"],
    guildGatekeeper: listed,
    webhookReceiver: listed,
  }));
  assert.throws(() => assertExistingSecretBindings(required, {
    workshop: ["CF_AI_GATEWAY_API_TOKEN"],
    guildGatekeeper: listed,
    webhookReceiver: [],
  }), /webhookReceiver.*GUILD_WEBHOOK_SIGNING_SECRET/i);
  assert.throws(() => parseWranglerSecretList("not-json"), /invalid Secret binding list/i);
});

test("generates Access-mode Workshop, Context, and Guild Gatekeeper configs", async () => {
  const generated = generateConfigs(validConfig, await baseConfigs());

  assert.equal(generated.workshop.name, "acme-cloudflare-os");
  assert.deepEqual(generated.workshop.routes, [
    { pattern: "os.example.com", custom_domain: true },
  ]);
  assert.deepEqual(generated.workshop.vars.ADMINS, ["admin@example.com"]);
  assert.equal(generated.workshop.vars.CF_ACCESS_ISS, validConfig.access.issuer);
  assert.equal(generated.workshop.vars.CF_ACCESS_AUD, validConfig.access.audience);
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY, "cloudflare-os");
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_PROVIDERS, "anthropic,cloudflare");
  assert.deepEqual(generated.workshop.secrets, { required: ["CF_AI_GATEWAY_API_TOKEN"] });
  assert.deepEqual(generated.workshop.ai, { binding: "WORKERS_AI" });
  assert.deepEqual(generated.workshop.services, [
    {
      binding: "ERROR_REPORTER",
      service: "acme-cloudflare-os-errors",
      entrypoint: "ErrorReporter",
      props: { service: "acme-cloudflare-os", environment: "production", release: "abc123" },
    },
    {
      binding: "GATEKEEPER_CONTEXT",
      service: "acme-cloudflare-os-context",
      entrypoint: "GatekeeperVendor",
      props: { sharingDomain: "production" },
    },
    {
      binding: "GATEKEEPER_GUILD",
      service: "acme-guild-os-gatekeeper",
      entrypoint: "GatekeeperVendor",
    },
  ]);
  assert.deepEqual(generated.workshop.assets, {
    directory: "../workshop-frontend/dist",
    not_found_handling: "single-page-application",
      run_worker_first: ["/api", "/api/*", "/blueprint-screenshot/*"],
  });
  assert.deepEqual(generated.workshop.kv_namespaces, [
    { binding: "BLUEPRINTS", id: "blueprints-kv-id" },
    { binding: "AVATARS", id: "avatars-kv-id" },
  ]);
  assert.equal(generated.workshop.r2_buckets[0].bucket_name, "cloudflare-os-blueprints");
  assert.equal(generated.context.name, "acme-cloudflare-os-context");
  assert.equal(generated.context.kv_namespaces[0].id, "context-kv-id");
  assert.deepEqual(generated.context.artifacts, [{
    binding: "ARTIFACTS",
    namespace: "acme-context-collections",
  }]);
  assert.equal(generated.guildGatekeeper.name, "acme-guild-os-gatekeeper");
  assert.deepEqual(generated.guildGatekeeper.vars, {
    GUILD_ID: validConfig.guild.id,
    GUILD_NAME: "Acme Guild",
    GUILD_PURPOSE: "Coordinate Acme people and agents.",
    GUILD_ROOT_SPACE_NAME: "Acme",
    GUILD_LEVEL2_QUORUM: "1",
    GUILD_LEVEL3_QUORUM: "2",
    GUILD_RETENTION_DAYS: "2555",
    GUILD_ASK_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    GUILD_BOOTSTRAP_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    GUILD_MODEL_PROVIDER_KIND: "workers_ai",
    GUILD_MODEL_PROVIDER_NAME: "Cloudflare Workers AI",
    GUILD_MODEL_PROVIDER_ENDPOINT: "",
    GUILD_AI_GATEWAY_ID: "default",
    GUILD_WEBHOOK_CONNECTOR_ID: validConfig.guild.webhook.connectorId,
    GUILD_WEBHOOK_CONNECTOR_NAME: "Approved operations webhook",
    GUILD_WEBHOOK_URL: "https://hooks.example.com/guild-events",
  });
  assert.deepEqual(generated.guildGatekeeper.secrets, {
    required: ["GUILD_WEBHOOK_SIGNING_SECRET"],
  });
  assert.deepEqual(generated.guildGatekeeper.hyperdrive, [{
    binding: "HYPERDRIVE",
    id: validConfig.guild.hyperdriveId,
  }]);
  assert.deepEqual(generated.guildGatekeeper.ai, { binding: "AI" });
  assert.deepEqual(generated.guildGatekeeper.r2_buckets, [{
    binding: "KNOWLEDGE_FILES",
    bucket_name: "acme-guild-knowledge",
  }]);
  assert.deepEqual(generated.guildGatekeeper.ratelimits, [
    {
      name: "ASK_RATE_LIMITER",
      namespace_id: "26156863",
      simple: { limit: 20, period: 60 },
    },
    {
      name: "RECOVERY_RATE_LIMITER",
      namespace_id: "26156864",
      simple: { limit: 5, period: 60 },
    },
  ]);
  assert.deepEqual(generated.guildGatekeeper.workflows, [{
    name: "acme-guild-agent-execution",
    binding: "AGENT_EXECUTION",
    class_name: "AgentExecutionWorkflow",
  }]);
  assert.equal(
    generated.guildGatekeeper.compatibility_flags.includes("global_fetch_strictly_public"),
    true,
  );
  assert.deepEqual(generated.guildGatekeeper.triggers, { crons: ["0 * * * *"] });
  assert.equal(generated.webhookReceiver.name, "acme-guild-os-webhook");
  assert.deepEqual(generated.webhookReceiver.routes, [
    { pattern: "hooks.example.com", custom_domain: true },
  ]);
  assert.deepEqual(generated.webhookReceiver.secrets, {
    required: ["GUILD_WEBHOOK_SIGNING_SECRET"],
  });
  assert.deepEqual(generated.webhookReceiver.exports, {
    WebhookReceipt: { type: "durable-object", storage: "sqlite" },
  });
  assert.equal(generated.errorReporter.name, "acme-cloudflare-os-errors");
  assert.deepEqual(generated.workshop.observability.logs, {
    invocation_logs: false,
  });
  assert.deepEqual(generated.workshop.observability.traces, {
    enabled: true,
    head_sampling_rate: 0.25,
  });
  assert.equal(generated.workshop.services.some(
    (service) => service.binding === "FRONTEND_ERROR_REPORTER"), false);
  assert.equal(generated.workshop.ratelimits, undefined);
});

test("deploys an external OpenAI-compatible Model with a fixed Secret binding", async () => {
  const config = structuredClone(validConfig);
  config.guild.askModel = "purchaser-owned-model";
  config.guild.modelProvider = {
    kind: "openai_compatible",
    name: "Purchaser-owned Model endpoint",
    endpoint: "https://models.example.com/v1",
  };
  assert.throws(() => deploymentSecretsFromEnvironment(config, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    CF_AI_GATEWAY_API_TOKEN: "cloudflare-api-token",
  }), /GUILD_MODEL_PROVIDER_TOKEN/);

  const generated = generateConfigs(config, await baseConfigs());
  assert.equal(generated.guildGatekeeper.vars.GUILD_ASK_MODEL, "purchaser-owned-model");
  assert.equal(generated.guildGatekeeper.vars.GUILD_MODEL_PROVIDER_KIND, "openai_compatible");
  assert.equal(generated.guildGatekeeper.vars.GUILD_MODEL_PROVIDER_ENDPOINT, "https://models.example.com/v1");
  assert.deepEqual(generated.guildGatekeeper.secrets.required, [
    "GUILD_WEBHOOK_SIGNING_SECRET",
    "GUILD_MODEL_PROVIDER_TOKEN",
  ]);
  assert.deepEqual(deploymentSecretsFromEnvironment(config, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    GUILD_MODEL_PROVIDER_TOKEN: "purchaser-owned-token",
    CF_AI_GATEWAY_API_TOKEN: "cloudflare-api-token",
  }).guildGatekeeper, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    GUILD_MODEL_PROVIDER_TOKEN: "purchaser-owned-token",
  });
});

test("omits disabled backend error reporting", async () => {
  const config = structuredClone(validConfig);
  config.errorReporting = {
    enabled: false,
    environment: "<ENVIRONMENT>",
    release: "<RELEASE>",
  };

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.errorReporter, undefined);
  assert.equal(generated.workshop.services.some(
    (service) => service.binding === "ERROR_REPORTER"), false);
});

test("omits the optional reference Webhook receiver", async () => {
  const config = structuredClone(validConfig);
  config.referenceWebhook.enabled = false;
  config.workers.webhookReceiver = {
    name: "<WEBHOOK_RECEIVER_WORKER_NAME>",
    route: { customDomain: "<WEBHOOK_RECEIVER_DOMAIN>" },
  };

  const generated = generateConfigs(config, await baseConfigs());
  const secrets = deploymentSecretsFromEnvironment(config, {
    GUILD_WEBHOOK_SIGNING_SECRET: "w".repeat(32),
    CF_AI_GATEWAY_API_TOKEN: "cloudflare-api-token",
  });

  assert.equal(generated.webhookReceiver, undefined);
  assert.equal(secrets.webhookReceiver, undefined);
});

test("omits dormant AI Gateway configuration", async () => {
  const config = structuredClone(validConfig);
  config.aiGateway = {
    enabled: false,
    name: "<AI_GATEWAY_NAME>",
    accountId: "<AI_GATEWAY_ACCOUNT_ID>",
    providers: [],
    workersAi: { mode: "gateway", gateway: "<WORKERS_AI_GATEWAY_NAME>" },
  };

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.workshop.vars.CF_AI_GATEWAY, undefined);
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_ACCOUNT_ID, undefined);
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_PROVIDERS, undefined);
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_WAI, undefined);
  assert.equal(generated.workshop.secrets, undefined);
});

test("ignores the gateway name in direct Workers AI mode", async () => {
  const config = structuredClone(validConfig);
  config.aiGateway.workersAi = { mode: "direct", gateway: "<UNUSED_GATEWAY_NAME>" };

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_WAI_DIRECT, "true");
  assert.equal(generated.workshop.vars.CF_AI_GATEWAY_WAI, undefined);
});

test("uses the default Context Artifacts namespace when omitted", async () => {
  const config = structuredClone(validConfig);
  delete config.context.artifacts.namespace;

  const generated = generateConfigs(config, await baseConfigs());

  assert.deepEqual(generated.context.artifacts, [{
    binding: "ARTIFACTS",
    namespace: "gatekeeper-context-collections",
  }]);
});

test("omits disabled Context Artifacts configuration", async () => {
  const config = structuredClone(validConfig);
  config.context.artifacts = {};
  const bases = await baseConfigs();
  bases.context.artifacts = [{ binding: "ARTIFACTS", namespace: "upstream-default" }];

  const generated = generateConfigs(config, bases);

  assert.equal(generated.context.artifacts, undefined);
});

test("defaults Context Artifacts to disabled when configuration is omitted", async () => {
  const config = structuredClone(validConfig);
  delete config.context.artifacts;

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.context.artifacts, undefined);
});

test("generates binding-only storage for automatic provisioning", async () => {
  const config = structuredClone(validConfig);
  config.context.kvNamespaceId = null;
  config.resources = {
    blueprintsKvNamespaceId: null,
    avatarsKvNamespaceId: null,
    blueprintContentBucket: null,
    knowledgeFilesBucket: null,
  };

  const generated = generateConfigs(config, await baseConfigs());

  assert.deepEqual(generated.workshop.kv_namespaces, [
    { binding: "BLUEPRINTS" },
    { binding: "AVATARS" },
  ]);
  assert.deepEqual(generated.workshop.r2_buckets, [{ binding: "BLUEPRINT_CONTENT" }]);
  assert.deepEqual(generated.context.kv_namespaces, [{ binding: "CONTEXT_COLLECTIONS" }]);
  assert.deepEqual(generated.guildGatekeeper.r2_buckets, [{ binding: "KNOWLEDGE_FILES" }]);
});

test("captures and reapplies automatically provisioned resource identities", async () => {
  const automatic = structuredClone(validConfig);
  automatic.context.kvNamespaceId = null;
  automatic.resources = {
    blueprintsKvNamespaceId: null,
    avatarsKvNamespaceId: null,
    blueprintContentBucket: null,
    knowledgeFilesBucket: null,
  };
  const generated = generateConfigs(automatic, await baseConfigs());
  generated.context.kv_namespaces[0].id = "context-kv-id";
  generated.workshop.kv_namespaces[0].id = "blueprints-kv-id";
  generated.workshop.kv_namespaces[1].id = "avatars-kv-id";
  generated.workshop.r2_buckets[0].bucket_name = "cloudflare-os-blueprints";
  generated.guildGatekeeper.r2_buckets[0].bucket_name = "acme-guild-knowledge";

  const lock = provisioningLockFromGenerated(automatic, generated);
  const resolved = applyProvisioningLock(automatic, lock);

  assert.deepEqual(lock, {
    format: "guild-os-deployment-lock/v1",
    accountId: automatic.accountId,
    guildId: automatic.guild.id,
    workers: {
      workshop: "acme-cloudflare-os",
      context: "acme-cloudflare-os-context",
      guildGatekeeper: "acme-guild-os-gatekeeper",
      webhookReceiver: "acme-guild-os-webhook",
      errorReporter: "acme-cloudflare-os-errors",
    },
    resources: {
      contextKvNamespaceId: "context-kv-id",
      blueprintsKvNamespaceId: "blueprints-kv-id",
      avatarsKvNamespaceId: "avatars-kv-id",
      blueprintContentBucket: "cloudflare-os-blueprints",
      knowledgeFilesBucket: "acme-guild-knowledge",
    },
  });
  assert.equal(resolved.context.kvNamespaceId, "context-kv-id");
  assert.deepEqual(resolved.resources, validConfig.resources);
});

test("captures provisioned resources from the active release bindings", () => {
  const automatic = structuredClone(validConfig);
  automatic.context.kvNamespaceId = null;
  automatic.resources = {
    blueprintsKvNamespaceId: null,
    avatarsKvNamespaceId: null,
    blueprintContentBucket: null,
    knowledgeFilesBucket: null,
  };
  const releaseCommit = "0123456789abcdef0123456789abcdef01234567";
  const version = (bindings) => ({
    annotations: { "workers/message": `Guild OS ${releaseCommit}` },
    resources: { bindings },
  });

  const lock = provisioningLockFromWorkerVersions(automatic, {
    context: version([{
      name: "CONTEXT_COLLECTIONS",
      type: "kv_namespace",
      namespace_id: "context-kv-id",
    }]),
    workshop: version([
      { name: "BLUEPRINTS", type: "kv_namespace", namespace_id: "blueprints-kv-id" },
      { name: "AVATARS", type: "kv_namespace", namespace_id: "avatars-kv-id" },
      { name: "BLUEPRINT_CONTENT", type: "r2_bucket", bucket_name: "cloudflare-os-blueprints" },
    ]),
    guildGatekeeper: version([{
      name: "KNOWLEDGE_FILES",
      type: "r2_bucket",
      bucket_name: "acme-guild-knowledge",
    }]),
  }, { releaseCommit });

  assert.deepEqual(lock.resources, {
    contextKvNamespaceId: "context-kv-id",
    blueprintsKvNamespaceId: "blueprints-kv-id",
    avatarsKvNamespaceId: "avatars-kv-id",
    blueprintContentBucket: "cloudflare-os-blueprints",
    knowledgeFilesBucket: "acme-guild-knowledge",
  });
});

test("rejects stale releases and conflicting deployed resources", () => {
  const releaseCommit = "0123456789abcdef0123456789abcdef01234567";
  const versions = {
    context: {
      annotations: { "workers/message": "Guild OS ffffffffffffffffffffffffffffffffffffffff" },
      resources: { bindings: [] },
    },
  };
  assert.throws(
    () => provisioningLockFromWorkerVersions(validConfig, versions, { releaseCommit }),
    /not running release/i,
  );

  versions.context.annotations["workers/message"] = `Guild OS ${releaseCommit}`;
  versions.context.resources.bindings = [{
    name: "CONTEXT_COLLECTIONS",
    type: "kv_namespace",
    namespace_id: "different-context-kv-id",
  }];
  assert.throws(
    () => provisioningLockFromWorkerVersions(validConfig, versions, { releaseCommit }),
    /conflicts/i,
  );
});

test("rejects stale, conflicting, or incomplete provisioning locks", () => {
  const lock = {
    format: "guild-os-deployment-lock/v1",
    accountId: validConfig.accountId,
    guildId: validConfig.guild.id,
    workers: {
      workshop: "acme-cloudflare-os",
      context: "acme-cloudflare-os-context",
      guildGatekeeper: "acme-guild-os-gatekeeper",
      webhookReceiver: "acme-guild-os-webhook",
      errorReporter: "acme-cloudflare-os-errors",
    },
    resources: {
      contextKvNamespaceId: "context-kv-id",
      blueprintsKvNamespaceId: "blueprints-kv-id",
      avatarsKvNamespaceId: "avatars-kv-id",
      blueprintContentBucket: "cloudflare-os-blueprints",
      knowledgeFilesBucket: "acme-guild-knowledge",
    },
  };

  const wrongGuild = structuredClone(lock);
  wrongGuild.guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9f";
  assert.throws(() => applyProvisioningLock(validConfig, wrongGuild), /does not belong/i);

  const conflict = structuredClone(lock);
  conflict.resources.knowledgeFilesBucket = "different-bucket";
  assert.throws(() => applyProvisioningLock(validConfig, conflict), /conflicts/i);

  const incomplete = structuredClone(lock);
  delete incomplete.resources.avatarsKvNamespaceId;
  assert.throws(() => applyProvisioningLock(validConfig, incomplete), /missing/i);
});

test("retains partial first-deploy resource identities without inventing missing IDs", async () => {
  const automatic = structuredClone(validConfig);
  automatic.context.kvNamespaceId = null;
  automatic.resources = {
    blueprintsKvNamespaceId: null,
    avatarsKvNamespaceId: null,
    blueprintContentBucket: null,
    knowledgeFilesBucket: null,
  };
  const generated = generateConfigs(automatic, await baseConfigs());
  generated.context.kv_namespaces[0].id = "context-created-before-failure";

  const partial = provisioningLockFromGenerated(automatic, generated, {
    allowIncomplete: true,
  });
  assert.deepEqual(partial.resources, {
    contextKvNamespaceId: "context-created-before-failure",
    blueprintsKvNamespaceId: null,
    avatarsKvNamespaceId: null,
    blueprintContentBucket: null,
    knowledgeFilesBucket: null,
  });
  const resumed = applyProvisioningLock(automatic, partial);
  assert.equal(resumed.context.kvNamespaceId, "context-created-before-failure");
  assert.equal(resumed.resources.knowledgeFilesBucket, null);
  assert.throws(
    () => provisioningLockFromGenerated(automatic, generated),
    /production resource identity is unknown/i,
  );
});

test("production deploys require a clean pinned Git source and annotate every Worker version", () => {
  assert.doesNotThrow(() => assertDeployableGitState(
    "",
    " bf7f762d7fa73553284d731ab6a978d3ea17be24 cloudflare-os\n",
  ));
  assert.throws(() => assertDeployableGitState(" M README.md\n", ""), /commit every/i);
  assert.throws(() => assertDeployableGitState(
    "",
    "+bf7f762d7fa73553284d731ab6a978d3ea17be24 cloudflare-os\n",
  ), /submodule/i);
  assert.deepEqual(
    deploymentVersionArgs("0123456789abcdef0123456789abcdef01234567"),
    [
      "--strict",
      "--message", "Guild OS 0123456789abcdef0123456789abcdef01234567",
      "--tag", "guild-os-0123456789ab",
    ],
  );
});

test("database-outage releases are limited to the reviewed recovery surfaces", () => {
  const rootChanges = [
    "THIRD_PARTY_NOTICES.md",
    "cloudflare-os",
    "deployment.jsonc",
    "docs/deployment.md",
    "fixtures/deployment.ci.jsonc",
    "packages/guild-gatekeeper/__tests__/health.test.ts",
    "packages/guild-gatekeeper/src/index.ts",
    "scripts/deploy.mjs",
  ];
  const cloudflareChanges = [
    "packages/workshop-frontend/src/GatekeeperAppPage.test.tsx",
    "packages/workshop-frontend/src/GatekeeperAppPage.tsx",
  ];
  assert.deepEqual(
    assertDatabaseOutageReleaseChanges(rootChanges, cloudflareChanges),
    { rootChanges, cloudflareChanges },
  );
  assert.throws(
    () => assertDatabaseOutageReleaseChanges(
      [...rootChanges, "packages/guild-postgres/src/schema.ts"],
      cloudflareChanges,
    ),
    /protected source/i,
  );
  assert.throws(
    () => assertDatabaseOutageReleaseChanges(rootChanges, [
      ...cloudflareChanges,
      "packages/workshop-backend/src/index.ts",
    ]),
    /protected Cloudflare OS surface/i,
  );
  assert.throws(
    () => assertDatabaseOutageReleaseChanges(
      rootChanges.filter((path) => path !== "cloudflare-os"),
      [],
    ),
    /recovery UI release/i,
  );
  assert.deepEqual(assertDatabaseOutageRuntimePatchHashes({
    guildGatekeeper: "74ab919158d9ad250d4b570374a81945c085f2ff6dfc63f8f02311aff0c40406",
    workshopFrontend: "6b7a873b9349413725784ec93cb9809969eff7e35331db6b68edef270b0bd12c",
  }), {
    guildGatekeeper: "74ab919158d9ad250d4b570374a81945c085f2ff6dfc63f8f02311aff0c40406",
    workshopFrontend: "6b7a873b9349413725784ec93cb9809969eff7e35331db6b68edef270b0bd12c",
  });
  assert.throws(() => assertDatabaseOutageRuntimePatchHashes({
    guildGatekeeper: "0".repeat(64),
    workshopFrontend: "6b7a873b9349413725784ec93cb9809969eff7e35331db6b68edef270b0bd12c",
  }), /unreviewed guildGatekeeper runtime patch/i);
});

test("database-outage rollback points require exact release evidence", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const versionId = "31aa25f1-8bad-4583-b51f-deb71f9d1748";
  assert.equal(releaseCommitFromWorkerVersion({
    id: versionId,
    annotations: { "workers/message": `Guild OS ${commit}` },
  }), commit);
  assert.deepEqual(outageRollbackArgs(versionId, "guild-os", commit), [
    "exec", "wrangler", "rollback", versionId,
    "--name", "guild-os",
    "--config", "wrangler.prod.jsonc",
    "--message", `Automatic rollback from Guild OS ${commit}`,
    "--yes",
  ]);
  assert.throws(() => releaseCommitFromWorkerVersion({
    id: versionId,
    annotations: { "workers/message": "unreviewed build" },
  }), /complete Guild OS release/i);
  assert.throws(
    () => outageRollbackArgs("not-a-version", "guild-os", commit),
    /version ID/i,
  );
});
