import type { Constitution } from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildPostgresRepository,
  withGuildTransaction,
  type GuildSetupState,
} from "@guild-os/postgres";
import APP_HTML from "./generated/app.txt";
import { makeChronicleEvent } from "./chronicle.js";
import { BUILTIN_ROLES, type GuildEnv } from "./config.js";

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
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootIdentityId,
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureGuildAccount(
  env: GuildEnv,
  accountId: string,
  isAdmin: boolean,
): Promise<GuildSetupState> {
  return withGuildTransaction(env.HYPERDRIVE.connectionString, env.GUILD_ID, async (connection) => {
    const repository = new GuildPostgresRepository(connection, env.GUILD_ID);
    let state = await repository.getSetupState(accountId);
    if (!state.initialized) {
      if (!isAdmin) {
        throw new Error("A Cloudflare OS administrator must initialize this Guild first.");
      }
      await repository.bootstrapGuild({
        guildId: env.GUILD_ID,
        name: env.GUILD_NAME,
        purpose: env.GUILD_PURPOSE,
        rootIdentityId: accountId,
        rootDisplayName: "Root Owner",
        rootSpaceId: crypto.randomUUID(),
        rootSpaceName: env.GUILD_ROOT_SPACE_NAME,
        constitution: defaultConstitution(env, accountId),
        roles: BUILTIN_ROLES.map((role) => ({ ...role, id: crypto.randomUUID() })),
        chronicleEvent: makeChronicleEvent(
          env.GUILD_ID,
          accountId,
          "guild.initialized",
          "guild",
          env.GUILD_ID,
          { source: "cloudflare-os-admin" },
        ),
      });
      state = await repository.getSetupState(accountId);
    }
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
