import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ChronicleEvent,
  Constitution,
  EmergencyPrivateAccessGrant,
  OnboardingAssignment,
  OnboardingPath,
  OnboardingRequirement,
} from "@guild-os/domain";
import { GuildDirectoryRepository } from "./directory.js";
import { GuildFabricRepository } from "./fabric.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: ChronicleEvent["details"] = { source: "fabric-integration-test" },
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: actorId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details,
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1_000,
      maxTokens: 100_000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    outsider: randomUUID(),
    preboarding: randomUUID(),
    successor: randomUUID(),
    agent: randomUUID(),
    rootSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Fabric Test Guild",
      purpose: "Verify private communication and lifecycle boundaries",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Participant",
        permissions: [
          "guild.read", "space.read", "message.read", "message.create",
          "lifecycle.read", "contribution.read", "contribution.correct",
        ],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES
         ($1, $6, 'human', 'Member', 'active'),
         ($2, $6, 'human', 'Outsider', 'active'),
         ($3, $6, 'human', 'Preboarding member', 'active'),
         ($4, $6, 'human', 'Successor', 'active'),
         ($5, $6, 'agent', 'Lifecycle Agent', 'active')`,
      [ids.member, ids.outsider, ids.preboarding, ids.successor, ids.agent, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES
         ($1, $2, 'active', 'internal', now()),
         ($1, $3, 'active', 'internal', now()),
         ($1, $4, 'preboarding', 'internal', NULL),
         ($1, $5, 'active', 'internal', now()),
         ($1, $6, 'active', 'internal', now())`,
      [ids.guild, ids.member, ids.outsider, ids.preboarding, ids.successor, ids.agent],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       SELECT gen_random_uuid(), $1, candidate.identity_id, $2, NULL
         FROM unnest($3::uuid[]) AS candidate(identity_id)`,
      [ids.guild, ids.role, [ids.member, ids.outsider, ids.preboarding, ids.successor]],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Bounded lifecycle test agent', 'workers-ai/test', '{}', $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
  });
  return ids;
}

integration("Guild fabric repository", () => {
  it("keeps private plaintext participant-bound and records only message metadata in Chronicle", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const firstThread = randomUUID();
    const firstMessage = randomUUID();
    const secretBody = "Private operational detail that must never enter Chronicle.";
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.member]);
      await new GuildFabricRepository(connection, ids.guild).createPrivateThread({
        id: firstThread,
        actorId: ids.member,
        participantActorIds: [ids.successor],
        spaceId: null,
        subject: "Private coordination",
        classification: "confidential",
        initialMessageId: firstMessage,
        initialBody: secretBody,
        chronicleEvent: event(
          ids.guild,
          ids.member,
          "private_thread.created",
          "private_thread",
          firstThread,
          { messageId: firstMessage, plaintextRecorded: false },
        ),
      });
    });

    const participant = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.successor]);
      return new GuildFabricRepository(connection, ids.guild).getPrivateThread(ids.successor, firstThread);
    });
    expect(participant.messages.map((message) => message.body)).toEqual([secretBody]);

    const outsiderRows = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.outsider]);
      const repository = new GuildFabricRepository(connection, ids.guild);
      expect(await repository.listPrivateThreads(ids.outsider)).toEqual([]);
      await expect(repository.getPrivateThread(ids.outsider, firstThread)).rejects.toThrow(
        "not found or is not visible",
      );
      return connection.query<{ body: string }>(
        "SELECT body FROM private_messages WHERE guild_id = $1 AND thread_id = $2",
        [ids.guild, firstThread],
      );
    });
    expect(outsiderRows.rows).toEqual([]);

    const chronicleText = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ details: string }>(
        `SELECT details::text FROM chronicle_events
          WHERE guild_id = $1 AND subject_type = 'private_thread'`,
        [ids.guild],
      )).rows.map((row) => row.details).join("\n"));
    expect(chronicleText).not.toContain(secretBody);
    expect(chronicleText).toContain('"plaintextRecorded": false');

    const grantId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      const grant: EmergencyPrivateAccessGrant = {
        id: grantId,
        guildId: ids.guild,
        threadId: firstThread,
        grantedToActorId: ids.root,
        grantedByActorId: ids.root,
        reason: "Verified continuity emergency requiring evidence review.",
        intendedAccess: "Inspect only the messages required to restore operations.",
        viewedInformation: "",
        changesMade: "",
        status: "active",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        closedAt: null,
        version: 1,
        createdAt: new Date().toISOString(),
      };
      const repository = new GuildFabricRepository(connection, ids.guild);
      await repository.createEmergencyGrant(
        grant,
        event(ids.guild, ids.root, "private_access.break_glass.opened", "private_thread", firstThread),
      );
      expect((await repository.getPrivateThread(ids.root, firstThread)).messages[0]?.body).toBe(secretBody);
      await repository.closeEmergencyGrant(
        grantId,
        ids.root,
        "The first coordination message only.",
        "No changes were made.",
        event(ids.guild, ids.root, "private_access.break_glass.closed", "emergency_private_access", grantId),
      );
      await expect(repository.getPrivateThread(ids.root, firstThread)).rejects.toThrow(
        "not found or is not visible",
      );
    });
  });

  it("gates activation on onboarding and atomically revokes access while creating handover", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const pathId = randomUUID();
    const requirementId = randomUUID();
    const assignmentId = randomUUID();
    const now = new Date().toISOString();
    const path: OnboardingPath = {
      id: pathId, guildId: ids.guild, spaceId: null, templateKey: null,
      name: "Required orientation", description: "Complete before activation.", status: "active",
      createdByActorId: ids.root, version: 1, createdAt: now, updatedAt: now,
    };
    const requirement: OnboardingRequirement = {
      id: requirementId, guildId: ids.guild, pathId, kind: "checklist", resourceId: null,
      title: "Acknowledge the Constitution", instructions: "Confirm the governing policy.",
      required: true, position: 0, createdAt: now,
    };
    const assignment: OnboardingAssignment = {
      id: assignmentId, guildId: ids.guild, actorId: ids.preboarding, pathId,
      managerActorId: ids.root, status: "assigned", dueAt: null, completedAt: null,
      version: 1, createdAt: now, updatedAt: now,
    };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildFabricRepository(connection, ids.guild);
      await repository.createOnboardingPath(
        path,
        [requirement],
        event(ids.guild, ids.root, "onboarding.path.created", "onboarding_path", pathId),
      );
      await repository.assignOnboarding(
        assignment,
        event(ids.guild, ids.root, "onboarding.assigned", "onboarding_assignment", assignmentId),
      );
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDirectoryRepository(connection, ids.guild).changeMembership({
        actorIdentityId: ids.root,
        identityId: ids.preboarding,
        nextState: "active",
        chronicleEvent: event(ids.guild, ids.root, "membership.active", "identity", ids.preboarding),
      }))).rejects.toThrow("Preboarding requirements must be completed");

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildFabricRepository(connection, ids.guild).completeOnboardingRequirement(
        assignmentId,
        requirementId,
        ids.preboarding,
        "Acknowledged after review.",
        event(ids.guild, ids.preboarding, "onboarding.requirement.completed", "onboarding_assignment", assignmentId),
      );
      await new GuildDirectoryRepository(connection, ids.guild).changeMembership({
        actorIdentityId: ids.root,
        identityId: ids.preboarding,
        nextState: "active",
        chronicleEvent: event(ids.guild, ids.root, "membership.active", "identity", ids.preboarding),
      });
    });

    const activityId = randomUUID();
    const workflowId = randomUUID();
    const ruleId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO activities
           (id, guild_id, space_id, owner_actor_id, creator_actor_id, assignee_actor_id,
            type, title, description, status, visibility, classification)
         VALUES ($1, $2, NULL, $3, $4, $3, 'task', 'Open responsibility', '',
                 'active', 'guild', 'internal')`,
        [activityId, ids.guild, ids.member, ids.root],
      );
      await connection.query(
        `INSERT INTO workflow_definitions
           (id, guild_id, space_id, owner_actor_id, name, status, visibility)
         VALUES ($1, $2, $3, $4, 'Daily continuity check', 'active', 'space')`,
        [workflowId, ids.guild, ids.rootSpace, ids.root],
      );
      await connection.query(
        `INSERT INTO automation_rules
           (id, guild_id, workflow_id, agent_actor_id, created_by_actor_id,
            name, trigger_kind, trigger_expression, status)
         VALUES ($1, $2, $3, $4, $5, 'Daily continuity check', 'manual',
                 'manual', 'active')`,
        [ruleId, ids.guild, workflowId, ids.agent, ids.member],
      );
    });

    const handover = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildFabricRepository(connection, ids.guild);
      const result = await repository.offboardWithHandover(
        ids.member,
        ids.successor,
        ids.root,
        "Membership ended after an authorized transition.",
        event(ids.guild, ids.root, "lifecycle.offboarding.started", "identity", ids.member),
      );
      await new GuildDirectoryRepository(connection, ids.guild).changeMembership({
        actorIdentityId: ids.root,
        identityId: ids.member,
        nextState: "departed",
        chronicleEvent: event(ids.guild, ids.root, "membership.departed", "identity", ids.member),
      });
      return result;
    });
    expect(handover.items.map((item) => item.resourceId)).toContain(activityId);

    const state = await withGuildTransaction(connectionString, ids.guild, async (connection) => ({
      identity: (await connection.query<{ status: string }>(
        "SELECT status FROM identities WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.member],
      )).rows[0]?.status,
      membership: (await connection.query<{ state: string }>(
        "SELECT state FROM memberships WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, ids.member],
      )).rows[0]?.state,
      actorOperational: (await connection.query<{ operational: boolean }>(
        "SELECT operational FROM actor_memberships WHERE guild_id = $1 AND actor_id = $2",
        [ids.guild, ids.member],
      )).rows[0]?.operational,
      activity: (await connection.query<{ owner_actor_id: string; assignee_actor_id: string }>(
        "SELECT owner_actor_id::text, assignee_actor_id::text FROM activities WHERE guild_id = $1 AND id = $2",
        [ids.guild, activityId],
      )).rows[0],
      automation: (await connection.query<{ status: string }>(
        "SELECT status FROM automation_rules WHERE guild_id = $1 AND id = $2",
        [ids.guild, ruleId],
      )).rows[0]?.status,
    }));
    expect(state).toEqual({
      identity: "disabled",
      membership: "departed",
      actorOperational: false,
      activity: { owner_actor_id: ids.successor, assignee_actor_id: ids.successor },
      automation: "paused",
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildFabricRepository(connection, ids.guild);
      await repository.offboardWithHandover(
        ids.root,
        null,
        ids.successor,
        "Invalid attempt used to verify transaction rollback.",
        event(ids.guild, ids.successor, "lifecycle.offboarding.started", "identity", ids.root),
      );
      await new GuildDirectoryRepository(connection, ids.guild).changeMembership({
        actorIdentityId: ids.successor,
        identityId: ids.root,
        nextState: "departed",
        chronicleEvent: event(ids.guild, ids.successor, "membership.departed", "identity", ids.root),
      });
    })).rejects.toThrow();
    const rootHandovers = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM handover_cases WHERE guild_id = $1 AND departing_actor_id = $2",
        [ids.guild, ids.root],
      )).rows[0]?.count);
    expect(rootHandovers).toBe("0");
  });

  it("projects multidimensional contribution evidence and permits only self-correction", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const correctionId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      const repository = new GuildFabricRepository(connection, ids.guild);
      const profile = await repository.getContributionProfile(ids.root);
      expect(profile.facets).toHaveLength(6);
      expect(profile.evidence.some((item) => item.facet === "governance")).toBe(true);
      const evidenceEventId = profile.evidence[0]?.eventId;
      expect(evidenceEventId).toBeDefined();
      await repository.requestContributionCorrection({
        id: correctionId,
        subjectActorId: ids.root,
        requestedByActorId: ids.root,
        chronicleEventId: evidenceEventId ?? "",
        reason: "This evidence requires a clearer description.",
      }, event(ids.guild, ids.root, "contribution.correction.requested", "contribution_correction", correctionId));
    });
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.outsider]);
      const repository = new GuildFabricRepository(connection, ids.guild);
      await expect(repository.requestContributionCorrection({
        id: randomUUID(),
        subjectActorId: ids.root,
        requestedByActorId: ids.outsider,
        chronicleEventId: correctionId,
        reason: "An outsider cannot submit a correction for another Actor.",
      }, event(ids.guild, ids.outsider, "contribution.correction.requested", "contribution_correction", randomUUID())))
        .rejects.toThrow("only for their own Contribution Graph");
    });
  });
});
