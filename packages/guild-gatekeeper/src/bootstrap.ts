import {
  collectiveTemplate,
  type AppLocale,
  type CollectiveOnboardingAnswers,
  type CollectiveTemplateKey,
  type Constitution,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildCollectiveRepository,
  GuildPostgresRepository,
  withGuildTransaction,
  type GuildSetupState,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import APP_HTML from "./generated/app.txt";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";

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
): Promise<GuildSetupState> {
  if (!isAdmin) {
    throw new Error("Only a Cloudflare OS administrator can initialize this Guild.");
  }
  return withGuildTransaction(env.HYPERDRIVE.connectionString, env.GUILD_ID, async (connection) => {
    const repository = new GuildPostgresRepository(connection, env.GUILD_ID);
    let state = await repository.getSetupState(accountId);
    if (!state.initialized) {
      const template = collectiveTemplate(templateKey);
      await repository.bootstrapGuild({
        guildId: env.GUILD_ID,
        name: env.GUILD_NAME,
        purpose: env.GUILD_PURPOSE,
        rootIdentityId: accountId,
        rootDisplayName: displayName,
        rootPreferredLocale: preferredLocale,
        rootSpaceId: crypto.randomUUID(),
        rootSpaceName: env.GUILD_ROOT_SPACE_NAME,
        constitution: defaultConstitution(env, accountId),
        roles: template.roles.map((role) => ({
          id: crypto.randomUUID(),
          name: role.name,
          permissions: role.capabilities,
        })),
        chronicleEvent: makeChronicleEvent(
          env.GUILD_ID,
          accountId,
          "guild.initialized",
          "guild",
          env.GUILD_ID,
          { source: "cloudflare-os-admin" },
        ),
      });
      await new GuildCollectiveRepository(connection, env.GUILD_ID).configure({
        templateKey,
        vocabularyOverrides: {},
        onboardingAnswers,
        actorId: accountId,
        chronicleEvent: makeChronicleEvent(
          env.GUILD_ID,
          accountId,
          "collective.configured",
          "collective",
          env.GUILD_ID,
          { templateKey, source: "initialization" },
        ),
      });
      state = await repository.getSetupState(accountId);
    }
    if (!state.identityExists || state.membershipState !== "active") {
      throw new Error("This Guild was already initialized by another administrator.");
    }
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
