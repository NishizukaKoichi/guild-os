import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GuildEnv } from "../src/config.js";
import { prepareGuildAccount } from "../src/bootstrap.js";
import { GuildManagementApiImpl } from "../src/management-api.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function guildEnv(guildId: string): GuildEnv {
  return {
    GUILD_ID: guildId,
    GUILD_NAME: "Bootstrap Privacy Guild",
    GUILD_PURPOSE: "Verify explicit purchaser-owned initialization.",
    GUILD_ROOT_SPACE_NAME: "Guild",
    GUILD_LEVEL2_QUORUM: "1",
    GUILD_LEVEL3_QUORUM: "2",
    GUILD_RETENTION_DAYS: "365",
    GUILD_WEBHOOK_CONNECTOR_ID: randomUUID(),
    GUILD_WEBHOOK_CONNECTOR_NAME: "Approved test webhook",
    GUILD_WEBHOOK_URL: "https://hooks.example.com/guild-events",
    HYPERDRIVE: { connectionString: connectionString! },
  } as GuildEnv;
}

const collectiveSetup = {
  templateKey: "blank" as const,
  purpose: "Preserve shared context without assuming a company.",
  participants: "Humans, agents, services, and partner Guilds.",
  memoryIntent: "Facts, experiences, decisions, and artifacts.",
  activityIntent: "Any shared activity chosen by the participants.",
  decisionStyle: "Consent with explicit review for high-impact actions.",
};

integration("Guild bootstrap boundary", () => {
  it("requires an explicit Workshop administrator and minimizes pre-membership state", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const env = guildEnv(randomUUID());
    const rootId = randomUUID();
    const otherAdminId = randomUUID();
    const visitorId = randomUUID();
    const visitor = new GuildManagementApiImpl(env, visitorId, false);

    await expect(prepareGuildAccount(env, visitorId)).resolves.toEqual({
      initialized: false,
      identityExists: false,
      membershipState: null,
    });
    const before = await visitor.getBootstrap();
    expect(before).toEqual({
      screen: "initialize",
      initialized: false,
      canInitialize: false,
      guildId: env.GUILD_ID,
      guildName: env.GUILD_NAME,
      guildPurpose: env.GUILD_PURPOSE,
      accountId: visitorId,
      identityExists: false,
      membershipState: null,
      preferredLocale: "en",
    });
    await expect(visitor.initializeGuild({
      ...collectiveSetup,
      displayName: "Unauthorized Human",
      preferredLocale: "en",
      confirmation: env.GUILD_NAME,
    })).rejects.toThrow("Only a Cloudflare OS administrator");

    const root = new GuildManagementApiImpl(env, rootId, true);
    await expect(root.initializeGuild({
      ...collectiveSetup,
      displayName: "Purchaser Root",
      preferredLocale: "ja",
      confirmation: "wrong Guild",
    })).rejects.toThrow("Guild name exactly");
    const initialized = await root.initializeGuild({
      ...collectiveSetup,
      displayName: "Purchaser Root",
      preferredLocale: "ja",
      confirmation: env.GUILD_NAME,
    });
    expect(initialized).toMatchObject({
      screen: "member",
      initialized: true,
      accountId: rootId,
      rootOwner: true,
      rootOwnerIdentityId: rootId,
      rootOwnerDisplayName: "Purchaser Root",
      preferredLocale: "ja",
      membershipState: "active",
    });

    const otherAdmin = new GuildManagementApiImpl(env, otherAdminId, true);
    await expect(otherAdmin.initializeGuild({
      ...collectiveSetup,
      displayName: "Racing Administrator",
      preferredLocale: "en",
      confirmation: env.GUILD_NAME,
    })).rejects.toThrow("already initialized by another administrator");

    const restricted = await visitor.getBootstrap();
    expect(restricted).toMatchObject({
      screen: "access",
      initialized: true,
      canInitialize: false,
      identityExists: false,
      membershipState: null,
    });
    const serialized = JSON.stringify(restricted);
    expect(serialized).not.toContain("Purchaser Root");
    expect(serialized).not.toContain("rootOwnerIdentityId");
    expect(serialized).not.toContain("constitution");
    expect(serialized).not.toContain("agentDefaults");
  });

  it("returns only Space-scoped collective context to an invited member", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const env = guildEnv(randomUUID());
    const rootId = randomUUID();
    const memberId = randomUUID();
    const root = new GuildManagementApiImpl(env, rootId, true);
    await root.initializeGuild({
      ...collectiveSetup,
      displayName: "Collective Custodian",
      preferredLocale: "en",
      confirmation: env.GUILD_NAME,
    });
    const rootSpace = (await root.getDirectory()).spaces[0];
    if (!rootSpace) throw new Error("Root Space was not created.");
    const visibleSpaceId = await root.createSpace({
      name: "Visible Lab",
      parentSpaceId: rootSpace.id,
    });
    const childSpaceId = await root.createSpace({
      name: "Visible Lab Archive",
      parentSpaceId: visibleSpaceId,
    });
    const hiddenSpaceId = await root.createSpace({
      name: "Hidden Council",
      parentSpaceId: rootSpace.id,
    });
    const roleId = await root.createRole({
      name: "Scoped participant",
      permissions: [
        "guild.read",
        "space.read",
        "template.read",
        "memory.read",
        "activity.read",
      ],
    });
    const invitation = await root.issueInvitation({
      inviteeLabel: "Scoped member",
      roleId,
      spaceId: visibleSpaceId,
      initialMembershipState: "active",
      expiresInDays: 7,
    });
    const member = new GuildManagementApiImpl(env, memberId, false);
    await member.claimInvitation({
      token: invitation.token,
      displayName: "Scoped Member",
      preferredLocale: "en",
    });

    const context = await member.getCollectiveContext();
    expect(context.spaces.map((space) => space.id)).toEqual(expect.arrayContaining([
      visibleSpaceId,
      childSpaceId,
    ]));
    expect(context.spaces.map((space) => space.id)).not.toEqual(expect.arrayContaining([
      rootSpace.id,
      hiddenSpaceId,
    ]));
    expect(context.spaces.every((space) => !space.canConfigure)).toBe(true);
    expect(context.canConfigure).toBe(false);
    expect(context.canConfigureSpaces).toBe(false);
  });
});
