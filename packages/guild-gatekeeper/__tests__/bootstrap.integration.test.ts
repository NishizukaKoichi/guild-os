import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GuildOperationsRepository, withGuildTransaction } from "@guild-os/postgres";
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
    GUILD_ASK_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    GUILD_BOOTSTRAP_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
    GUILD_MODEL_PROVIDER_KIND: "workers_ai",
    GUILD_MODEL_PROVIDER_NAME: "Cloudflare Workers AI",
    GUILD_MODEL_PROVIDER_ENDPOINT: "",
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
  languageAndStyle: "Clear, neutral, and adaptable.",
  agentIntent: "Prepare reversible internal drafts from authorized context.",
  humanApprovalIntent: "External writes, deletion, and authority changes.",
};

integration("Guild bootstrap boundary", () => {
  it("provisions external operational routes without moving embedding off purchaser Workers AI", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const base = guildEnv(randomUUID());
    const env = {
      ...base,
      GUILD_ASK_MODEL: "purchaser-model",
      GUILD_MODEL_PROVIDER_KIND: "openai_compatible",
      GUILD_MODEL_PROVIDER_NAME: "Purchaser endpoint",
      GUILD_MODEL_PROVIDER_ENDPOINT: "https://models.example.test/v1",
      GUILD_MODEL_PROVIDER_TOKEN: "not-read-during-provisioning",
    } as GuildEnv;
    const rootId = randomUUID();
    await new GuildManagementApiImpl(env, rootId, true).initializeGuild({
      ...collectiveSetup,
      displayName: "Model Custodian",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
    });

    await withGuildTransaction(connectionString, env.GUILD_ID, async (connection) => {
      const repository = new GuildOperationsRepository(connection, env.GUILD_ID);
      const providers = await repository.listModelProviders();
      const routes = await repository.listModelRoutes();
      const ask = routes.find((route) => route.purpose === "ask");
      const embedding = routes.find((route) => route.purpose === "embedding");
      expect(providers.find((provider) => provider.id === ask?.providerId)).toMatchObject({
        kind: "openai_compatible",
        endpointUrl: "https://models.example.test/v1",
        secretReference: "GUILD_MODEL_PROVIDER_TOKEN",
        allowedModels: ["purchaser-model"],
        deploymentManaged: true,
      });
      expect(providers.find((provider) => provider.id === embedding?.providerId)).toMatchObject({
        kind: "workers_ai",
        secretReference: null,
        allowedModels: ["@cf/baai/bge-m3"],
        deploymentManaged: true,
      });
    });
  });

  it("reconciles missing deployment model routes for an active legacy Guild", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const env = guildEnv(randomUUID());
    const rootId = randomUUID();
    await new GuildManagementApiImpl(env, rootId, true).initializeGuild({
      ...collectiveSetup,
      displayName: "Legacy Root",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
    });

    await withGuildTransaction(connectionString, env.GUILD_ID, async (connection) => {
      await connection.query("DELETE FROM model_routes WHERE guild_id = $1", [env.GUILD_ID]);
      await connection.query("DELETE FROM model_providers WHERE guild_id = $1", [env.GUILD_ID]);
    });

    await expect(prepareGuildAccount(env, rootId)).resolves.toEqual({
      initialized: true,
      identityExists: true,
      membershipState: "active",
    });
    await withGuildTransaction(connectionString, env.GUILD_ID, async (connection) => {
      const repository = new GuildOperationsRepository(connection, env.GUILD_ID);
      const providers = await repository.listModelProviders();
      const routes = await repository.listModelRoutes();
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({
        name: "Cloudflare Workers AI",
        kind: "workers_ai",
        deploymentManaged: true,
        createdByActorId: rootId,
      });
      expect(routes.map((route) => route.purpose).sort()).toEqual([
        "act",
        "ask",
        "embedding",
        "plan",
        "review",
      ]);
    });
  });

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
      rootOwnershipAccepted: true,
    })).rejects.toThrow("Only a Cloudflare OS administrator");

    const root = new GuildManagementApiImpl(env, rootId, true);
    await expect(root.initializeGuild({
      ...collectiveSetup,
      displayName: "Purchaser Root",
      preferredLocale: "ja",
      rootOwnershipAccepted: false,
    })).rejects.toThrow("Root ownership must be accepted explicitly");
    const initialized = await root.initializeGuild({
      ...collectiveSetup,
      displayName: "Purchaser Root",
      preferredLocale: "ja",
      rootOwnershipAccepted: true,
      vocabularyOverrides: {
        members: "Contributors",
        memory: "Commons",
        activity: "Missions",
        decisions: "Agreements",
      },
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
    await expect(root.getCollectiveContext()).resolves.toMatchObject({
      template: { key: "blank" },
      labels: {
        members: "Contributors",
        memory: "Commons",
        activity: "Missions",
        decisions: "Agreements",
      },
      vocabularyOverrides: {
        members: "Contributors",
        memory: "Commons",
        activity: "Missions",
        decisions: "Agreements",
      },
    });

    const otherAdmin = new GuildManagementApiImpl(env, otherAdminId, true);
    await expect(otherAdmin.initializeGuild({
      ...collectiveSetup,
      displayName: "Racing Administrator",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
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
      rootOwnershipAccepted: true,
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

  it("assigns complete template onboarding on claim and adds Role-scoped paths atomically", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const env = guildEnv(randomUUID());
    const rootId = randomUUID();
    const memberId = randomUUID();
    const root = new GuildManagementApiImpl(env, rootId, true);
    await root.initializeGuild({
      ...collectiveSetup,
      displayName: "Lifecycle Custodian",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
    });

    const directory = await root.getDirectory();
    const rootSpace = directory.spaces[0];
    const participantRole = directory.roles.find((role) => role.name === "Participant");
    if (!rootSpace || !participantRole) throw new Error("Template defaults were not provisioned.");
    const invitation = await root.issueInvitation({
      inviteeLabel: "Preboarding participant",
      roleId: participantRole.id,
      spaceId: rootSpace.id,
      initialMembershipState: "preboarding",
      expiresInDays: 7,
    });
    const member = new GuildManagementApiImpl(env, memberId, false);
    await member.claimInvitation({
      token: invitation.token,
      displayName: "Preboarding Participant",
      preferredLocale: "en",
    });

    const initialPage = await member.getLifecyclePage();
    expect(initialPage.canManage).toBe(false);
    expect(initialPage.paths).toEqual([]);
    expect(initialPage.assignments).toEqual([]);
    expect(initialPage.myAssignments).toHaveLength(1);
    expect(initialPage.myAssignments[0]?.path.templateKey).toBe("blank");
    expect(initialPage.myAssignments[0]?.requirements.map((requirement) => requirement.kind))
      .toEqual(["memory", "acknowledgement", "activity"]);

    const firstRequirement = initialPage.myAssignments[0]?.requirements[0];
    const initialAssignment = initialPage.myAssignments[0]?.assignment;
    if (!firstRequirement || !initialAssignment) throw new Error("Onboarding was not assigned.");
    await member.completeOnboardingRequirement({
      assignmentId: initialAssignment.id,
      requirementId: firstRequirement.id,
      evidence: "Read and understood during integration verification.",
    });
    expect((await member.getLifecyclePage()).myAssignments[0]?.requirements[0]?.completedAt)
      .not.toBeNull();

    const specialistRoleId = await root.createRole({
      name: "Specialist participant",
      permissions: ["lifecycle.read", "memory.read", "activity.read"],
    });
    const specialistPathId = await root.createOnboardingPath({
      name: "Specialist orientation",
      description: "Role-specific operating boundary.",
      spaceId: rootSpace.id,
      roleIds: [specialistRoleId],
      requirements: [{
        kind: "checklist",
        resourceId: null,
        title: "Confirm the specialist boundary",
        instructions: "Acknowledge the additional Role scope.",
        required: true,
      }],
    });
    await root.assignRole({
      identityId: memberId,
      roleId: specialistRoleId,
      spaceId: rootSpace.id,
    });

    const roleChangedPage = await member.getLifecyclePage();
    expect(roleChangedPage.myAssignments.map((assignment) => assignment.path.id))
      .toEqual(expect.arrayContaining([initialAssignment.pathId, specialistPathId]));
    expect(roleChangedPage.myAssignments.find((assignment) =>
      assignment.path.id === specialistPathId)?.requirements.map((requirement) => requirement.kind))
      .toEqual(["checklist"]);

    const persisted = await withGuildTransaction(
      connectionString,
      env.GUILD_ID,
      async (connection) => (await connection.query<{
        assignment_count: string;
        member_activity_count: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM onboarding_assignments
             WHERE guild_id = $1 AND actor_id = $2) AS assignment_count,
           (SELECT count(*)::text FROM activities
             WHERE guild_id = $1 AND assignee_actor_id = $2) AS member_activity_count`,
        [env.GUILD_ID, memberId],
      )).rows[0],
    );
    expect(persisted).toEqual({ assignment_count: "2", member_activity_count: "1" });
  });
});
