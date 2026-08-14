import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withGuildTransaction } from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import { GuildManagementApiImpl } from "../src/management-api.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function guildEnv(guildId: string): GuildEnv {
  return {
    GUILD_ID: guildId,
    GUILD_NAME: "Private Governance Integration Guild",
    GUILD_PURPOSE: "Verify explicit private promotion and contribution correction governance.",
    GUILD_ROOT_SPACE_NAME: "Guild",
    GUILD_LEVEL2_QUORUM: "1",
    GUILD_LEVEL3_QUORUM: "2",
    GUILD_RETENTION_DAYS: "365",
    GUILD_WEBHOOK_CONNECTOR_ID: randomUUID(),
    GUILD_WEBHOOK_CONNECTOR_NAME: "Integration webhook",
    GUILD_WEBHOOK_URL: "https://hooks.example.test/guild-events",
    HYPERDRIVE: { connectionString: connectionString! },
  } as GuildEnv;
}

const collectiveSetup = {
  templateKey: "blank" as const,
  purpose: "Coordinate a neutral collective with explicit private boundaries.",
  participants: "Humans and bounded Agents.",
  memoryIntent: "Only deliberately shared knowledge enters Guild Memory.",
  activityIntent: "Governed work created from explicit proposals.",
  decisionStyle: "Human consent with auditable evidence.",
};

integration("private promotion and contribution management API", () => {
  it("promotes only for participants, omits plaintext from Chronicle, and reviews corrections", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const guildId = randomUUID();
    const rootId = randomUUID();
    const firstMemberId = randomUUID();
    const secondMemberId = randomUUID();
    const env = guildEnv(guildId);
    const verifiedAt = new Date().toISOString();
    const root = new GuildManagementApiImpl(env, rootId, true, verifiedAt);

    await root.initializeGuild({
      ...collectiveSetup,
      displayName: "Governance Root",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
    });
    const rootSpace = (await root.getDirectory()).spaces[0];
    if (!rootSpace) throw new Error("Root Space was not initialized.");
    const participantRoleId = await root.createRole({
      name: "Private participant",
      permissions: [
        "guild.read",
        "space.read",
        "message.read",
        "message.create",
        "memory.read",
        "memory.create",
        "contribution.read",
        "contribution.correct",
      ],
    });

    async function invite(identityId: string, displayName: string) {
      const invitation = await root.issueInvitation({
        inviteeLabel: displayName,
        roleId: participantRoleId,
        spaceId: rootSpace.id,
        initialMembershipState: "active",
        expiresInDays: 7,
      });
      const api = new GuildManagementApiImpl(env, identityId);
      await api.claimInvitation({ token: invitation.token, displayName, preferredLocale: "en" });
      return api;
    }

    const firstMember = await invite(firstMemberId, "First Participant");
    await invite(secondMemberId, "Second Participant");
    const privatePlaintext = "Promote this exact fictional finding only after participant consent.";
    const threadId = await firstMember.createPrivateThread({
      participantActorIds: [secondMemberId],
      spaceId: rootSpace.id,
      subject: "Fictional finding review",
      classification: "internal",
      body: privatePlaintext,
    });

    await expect(root.getPrivateThread(threadId)).rejects.toThrow();
    await root.beginEmergencyPrivateAccess({
      threadId,
      reason: "A verified continuity incident requires a bounded inspection.",
      intendedAccess: "Inspect only the first fictional message and account for the access.",
      durationMinutes: 5,
      confirmation: "BREAK GLASS",
    });
    const emergencyDetail = await root.getPrivateThread(threadId);
    expect(emergencyDetail.emergencyGrant?.status).toBe("active");
    expect(emergencyDetail.promotionKinds).toEqual([]);
    expect(emergencyDetail.promotions).toEqual([]);
    const source = emergencyDetail.messages[0];
    if (!source) throw new Error("Private source message was not created.");
    await expect(root.promotePrivateMessage({
      threadId,
      sourceMessageId: source.id,
      selectionStart: 0,
      selectionLength: source.body.length,
      idempotencyKey: randomUUID(),
      destination: {
        kind: "memory",
        spaceId: rootSpace.id,
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        locale: "en",
        memoryType: "knowledge",
        title: "Unauthorized emergency promotion",
        summary: "Break Glass must never confer publishing authority.",
      },
    })).rejects.toThrow(/participant|selection/i);

    const participantDetail = await firstMember.getPrivateThread(threadId);
    expect(participantDetail.promotionKinds).toContain("memory");
    const participantSource = participantDetail.messages[0];
    if (!participantSource) throw new Error("Participant source message was not created.");
    const promotionInput = {
      threadId,
      sourceMessageId: participantSource.id,
      selectionStart: 0,
      selectionLength: participantSource.body.length,
      idempotencyKey: randomUUID(),
      destination: {
        kind: "memory" as const,
        spaceId: rootSpace.id,
        visibility: "space" as const,
        classification: "internal" as const,
        allowedActorIds: [] as readonly string[],
        locale: "en" as const,
        memoryType: "knowledge" as const,
        title: "Promoted fictional finding",
        summary: "An explicit participant-owned Memory draft.",
      },
    };
    const promotion = await firstMember.promotePrivateMessage(promotionInput);
    const replay = await firstMember.promotePrivateMessage(promotionInput);
    expect(replay.id).toBe(promotion.id);
    expect((await firstMember.getPrivateThread(threadId)).promotions).toHaveLength(1);
    expect((await firstMember.getMemoryPage()).items).toContainEqual(expect.objectContaining({
      id: promotion.destinationDraftId,
      governanceState: "draft",
      body: { en: privatePlaintext },
    }));

    const auditDetails = await withGuildTransaction(connectionString, guildId, async (connection) =>
      (await connection.query<{ details: string }>(
        `SELECT details::text FROM chronicle_events
          WHERE guild_id = $1 AND id = $2 AND action = 'private_message.promoted'`,
        [guildId, promotion.chronicleEventId],
      )).rows[0]?.details ?? "");
    expect(auditDetails).toContain('"plaintextRecorded": false');
    expect(auditDetails).not.toContain(privatePlaintext);

    const correctionId = await firstMember.requestContributionCorrection({
      chronicleEventId: promotion.chronicleEventId,
      reason: "Clarify that this contribution created a draft and not Canonical Memory.",
    });
    const managerProfile = await root.getContributionProfile(firstMemberId);
    const pending = managerProfile.pendingCorrections.find((request) => request.id === correctionId);
    expect(pending).toBeDefined();
    if (!pending) throw new Error("Contribution correction was not visible to its manager.");
    const reviewed = await root.reviewContributionCorrection({
      requestId: pending.id,
      expectedVersion: pending.version,
      outcome: "accepted",
      reason: "The correction accurately distinguishes a governed draft from Canonical Memory.",
    });
    expect(reviewed).toMatchObject({ status: "accepted", reviewedByActorId: rootId, version: 2 });
    expect((await firstMember.getContributionProfile()).corrections).toContainEqual(
      expect.objectContaining({ id: correctionId, status: "accepted" }),
    );
  }, 30_000);
});
