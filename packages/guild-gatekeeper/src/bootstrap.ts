import {
  assertCollectiveBlueprintDraft,
  blueprintToCollectiveTemplate,
  collectiveTemplate,
  type AppLocale,
  type CollectiveOnboardingAnswers,
  type CollectiveBlueprintDraft,
  type CollectiveTemplateKey,
  type CollectiveTemplateLabels,
  type Constitution,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildCollectiveRepository,
  GuildPostgresRepository,
  GuildOperationsRepository,
  withGuildTransaction,
  type GuildSetupState,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import APP_HTML from "./generated/app.txt";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import {
  buildTemplateProvisioningPlan,
  provisionBlueprintSpaces,
  provisionTemplateDefaults,
} from "./template-provisioning.js";

function integerSetting(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultConstitution(env: GuildEnv, rootIdentityId: string): Constitution {
  return {
    guildId: env.GUILD_ID,
    version: 1,
    level2ApprovalQuorum: integerSetting(env.GUILD_LEVEL2_QUORUM, "Level 2 quorum"),
    level3ApprovalQuorum: integerSetting(env.GUILD_LEVEL3_QUORUM, "Level 3 quorum"),
    dataRetentionDays: integerSetting(env.GUILD_RETENTION_DAYS, "Retention days"),
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1_000,
      maxTokens: 100_000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    principles: "",
    publicScope: "",
    membershipPolicy: {
      preboardingRequired: true,
      departureMode: "revoke_then_handover",
    },
    dataPolicy: {
      defaultVisibility: "guild",
      defaultClassification: "internal",
      personalDataOnDeparture: "retain_by_policy",
      crossGuildSharing: "explicit_only",
    },
    agentPolicy: {
      level0Automatic: true,
      level1Automatic: false,
      level2HumanApproval: true,
      level3MultiHumanApproval: true,
    },
    externalSharingPolicy: {
      enabled: false,
      requireHumanApproval: true,
    },
    updatedByIdentityId: rootIdentityId,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureDeploymentWebhook(
  env: GuildEnv,
  connection: GuildTransactionConnection,
): Promise<void> {
  const root = (await connection.query<{ root_owner_identity_id: string }>(
    "SELECT root_owner_identity_id::text FROM guilds WHERE id = $1",
    [env.GUILD_ID],
  )).rows[0];
  if (!root) throw new Error("Guild Root Owner is unavailable after initialization.");
  await new GuildAgentRunRepository(connection, env.GUILD_ID).ensureDeploymentWebhook({
    id: env.GUILD_WEBHOOK_CONNECTOR_ID,
    name: env.GUILD_WEBHOOK_CONNECTOR_NAME,
    endpointUrl: env.GUILD_WEBHOOK_URL,
    rootOwnerIdentityId: root.root_owner_identity_id,
    chronicleEvent: makeChronicleEvent(
      env.GUILD_ID,
      root.root_owner_identity_id,
      "connector.provisioned",
      "connector",
      env.GUILD_WEBHOOK_CONNECTOR_ID,
      { source: "deployment-config" },
    ),
  });
}

async function ensureDefaultModelRoutes(
  env: GuildEnv,
  connection: GuildTransactionConnection,
  rootActorId: string,
): Promise<void> {
  const repository = new GuildOperationsRepository(connection, env.GUILD_ID);
  const askModel = env.GUILD_ASK_MODEL?.trim() || "@cf/meta/llama-3.1-8b-instruct-fast";
  let provider = (await repository.listModelProviders()).find((candidate) =>
    candidate.kind === "workers_ai" && candidate.deploymentManaged);
  if (!provider) {
    const providerId = crypto.randomUUID();
    provider = await repository.createModelProvider({
      id: providerId,
      name: "Cloudflare Workers AI",
      kind: "workers_ai",
      endpointUrl: null,
      secretReference: null,
      allowedModels: [...new Set([askModel, "@cf/baai/bge-m3"])],
      deploymentManaged: true,
      createdByActorId: rootActorId,
      actorId: rootActorId,
      chronicleEvent: makeChronicleEvent(
        env.GUILD_ID, rootActorId, "model.provider_provisioned", "model_provider", providerId,
        { source: "deployment-config" },
      ),
    });
  }
  const routes = await repository.listModelRoutes();
  const defaults = [
    { purpose: "ask" as const, model: askModel, maxTokens: 2_048, cache: false },
    { purpose: "plan" as const, model: askModel, maxTokens: 4_096, cache: false },
    { purpose: "act" as const, model: askModel, maxTokens: 2_048, cache: false },
    { purpose: "review" as const, model: askModel, maxTokens: 2_048, cache: false },
    { purpose: "embedding" as const, model: "@cf/baai/bge-m3", maxTokens: 512, cache: true },
  ];
  for (const item of defaults) {
    if (routes.some((route) => route.purpose === item.purpose)) continue;
    const routeId = crypto.randomUUID();
    await repository.createModelRoute({
      id: routeId,
      purpose: item.purpose,
      providerId: provider.id,
      primaryModel: item.model,
      fallbackModel: null,
      maxTokens: item.maxTokens,
      dailyBudgetMinor: 0,
      cacheEnabled: item.cache,
      status: "active",
      updatedByActorId: rootActorId,
      actorId: rootActorId,
      chronicleEvent: makeChronicleEvent(
        env.GUILD_ID, rootActorId, "model.route_provisioned", "model_route", routeId,
        { purpose: item.purpose, source: "deployment-config" },
      ),
    });
  }
}

export async function prepareGuildAccount(
  env: GuildEnv,
  accountId: string,
): Promise<GuildSetupState> {
  return withGuildTransaction(env.HYPERDRIVE.connectionString, env.GUILD_ID, async (connection) => {
    return new GuildPostgresRepository(connection, env.GUILD_ID).getSetupState(accountId);
  });
}

export async function initializeGuildAccount(
  env: GuildEnv,
  accountId: string,
  isAdmin: boolean,
  displayName: string,
  preferredLocale: AppLocale,
  templateKey: CollectiveTemplateKey,
  onboardingAnswers: CollectiveOnboardingAnswers,
  vocabularyOverrides: Partial<CollectiveTemplateLabels> = {},
  blueprint?: CollectiveBlueprintDraft,
): Promise<GuildSetupState> {
  if (!isAdmin) {
    throw new Error("Only a Cloudflare OS administrator can initialize this Guild.");
  }
  return withGuildTransaction(env.HYPERDRIVE.connectionString, env.GUILD_ID, async (connection) => {
    const repository = new GuildPostgresRepository(connection, env.GUILD_ID);
    let state = await repository.getSetupState(accountId);
    if (!state.initialized) {
      if (blueprint) {
        assertCollectiveBlueprintDraft(blueprint);
        if (templateKey !== "blank") {
          throw new Error("A custom Blueprint must initialize on the neutral Blank Template.");
        }
        if ((Object.keys(onboardingAnswers) as (keyof CollectiveOnboardingAnswers)[])
          .some((key) => blueprint.onboardingAnswers[key] !== onboardingAnswers[key])) {
          throw new Error("Blueprint answers must match the reviewed initialization answers.");
        }
      }
      const template = blueprint
        ? blueprintToCollectiveTemplate(blueprint)
        : collectiveTemplate(templateKey);
      const rootSpaceId = crypto.randomUUID();
      const constitution = defaultConstitution(env, accountId);
      const provisioning = buildTemplateProvisioningPlan(
        template,
        onboardingAnswers,
        undefined,
        blueprint?.definition.suggestedAgent?.permissions,
      );
      const created = await repository.bootstrapGuild({
        guildId: env.GUILD_ID,
        name: env.GUILD_NAME,
        purpose: env.GUILD_PURPOSE,
        rootIdentityId: accountId,
        rootDisplayName: displayName,
        rootPreferredLocale: preferredLocale,
        rootSpaceId,
        rootSpaceName: env.GUILD_ROOT_SPACE_NAME,
        constitution,
        roles: provisioning.bootstrapRoles,
        chronicleEvent: makeChronicleEvent(
          env.GUILD_ID,
          accountId,
          "guild.initialized",
          "guild",
          env.GUILD_ID,
          { source: "cloudflare-os-admin" },
        ),
      });
      if (created) {
        const collective = new GuildCollectiveRepository(connection, env.GUILD_ID);
        if (blueprint) {
          await collective.saveBlueprint({
            draft: blueprint,
            expectedVersion: null,
            actorId: accountId,
            chronicleEvent: makeChronicleEvent(
              env.GUILD_ID,
              accountId,
              "collective.blueprint.created",
              "collective",
              env.GUILD_ID,
              {
                blueprintKey: blueprint.key,
                generationMode: blueprint.generationMode,
                authorityChanged: false,
                source: "initialization",
              },
            ),
          });
        }
        await collective.configure({
          templateKey,
          blueprintKey: blueprint?.key ?? null,
          vocabularyOverrides,
          onboardingAnswers,
          actorId: accountId,
          chronicleEvent: makeChronicleEvent(
            env.GUILD_ID,
            accountId,
            "collective.configured",
            "collective",
            env.GUILD_ID,
            { templateKey, blueprintKey: blueprint?.key ?? null, source: "initialization" },
          ),
        });
        await provisionTemplateDefaults(connection, {
          guildId: env.GUILD_ID,
          rootActorId: accountId,
          rootSpaceId,
          locale: preferredLocale,
          model: env.GUILD_ASK_MODEL,
          agentLimits: constitution.agentDefaults,
          plan: provisioning,
        });
        if (blueprint) {
          await provisionBlueprintSpaces(connection, {
            guildId: env.GUILD_ID,
            rootActorId: accountId,
            rootSpaceId,
            blueprintKey: blueprint.key,
            spaces: blueprint.definition.spaces,
          });
        }
      }
      state = await repository.getSetupState(accountId);
    }
    if (!state.identityExists || state.membershipState !== "active") {
      throw new Error("This Guild was already initialized by another administrator.");
    }
    await ensureDefaultModelRoutes(env, connection, accountId);
    await ensureDeploymentWebhook(env, connection);
    return state;
  });
}

export function renderGuildPage(env: GuildEnv, state: GuildSetupState): string {
  const status = state.membershipState ?? "not enrolled";
  return APP_HTML
    .replaceAll("__GUILD_NAME__", escapeHtml(env.GUILD_NAME))
    .replaceAll("__GUILD_PURPOSE__", escapeHtml(env.GUILD_PURPOSE))
    .replaceAll("__MEMBERSHIP_STATE__", escapeHtml(status));
}
