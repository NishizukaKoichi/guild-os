import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildPostgresRepository, withGuildTransaction } from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import { GuildWorkService } from "../src/work-service.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(guildId: string, actorIdentityId: string): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    actorIdentityId,
    action: "guild.initialized",
    subjectType: "guild",
    subjectId: guildId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "work-service-integration-test" },
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
      maxBudgetMinor: 1000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

integration("Guild Work service authorization boundary", () => {
  it("filters before returning, rejects privilege escalation, and commits assignment evidence", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = {
      guild: randomUUID(),
      root: randomUUID(),
      reader: randomUUID(),
      eligibleAgent: randomUUID(),
      deniedAgent: randomUUID(),
      service: randomUUID(),
      rootSpace: randomUUID(),
      teamSpace: randomUUID(),
      deniedSpace: randomUUID(),
      readerRole: randomUUID(),
      agentRole: randomUUID(),
    };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
        guildId: ids.guild,
        name: "Work Service Guild",
        purpose: "Verify Gatekeeper Work authorization",
        rootIdentityId: ids.root,
        rootDisplayName: "Human Root",
        rootSpaceId: ids.rootSpace,
        rootSpaceName: "Guild",
        constitution: constitution(ids.guild, ids.root),
        roles: [{
          id: ids.readerRole,
          name: "Scoped reader",
          permissions: ["guild.read", "space.read", "work.read", "inbox.read"],
        }, {
          id: ids.agentRole,
          name: "Scoped agent",
          permissions: ["guild.read", "space.read", "work.read"],
        }],
        chronicleEvent: event(ids.guild, ids.root),
      });
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $3, $4, 'Team', 'active'), ($2, $3, $4, 'Denied', 'active')`,
        [ids.teamSpace, ids.deniedSpace, ids.guild, ids.rootSpace],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $5, 'human', 'Scoped reader', 'active'),
                ($2, $5, 'agent', 'Eligible Agent', 'active'),
                ($3, $5, 'agent', 'Denied Agent', 'active'),
                ($4, $5, 'service', 'Webhook Service', 'active')`,
        [ids.reader, ids.eligibleAgent, ids.deniedAgent, ids.service, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'internal', now()),
                ($1, $3, 'active', 'internal', now()),
                ($1, $4, 'active', 'internal', now()),
                ($1, $5, 'active', 'internal', now())`,
        [ids.guild, ids.reader, ids.eligibleAgent, ids.deniedAgent, ids.service],
      );
      await connection.query(
        `INSERT INTO agent_profiles
           (guild_id, identity_id, instructions, model, tool_ids, limits, status)
         VALUES ($1, $2, 'Execute eligible work.', 'test/model', '{}',
                 '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
                 'active'),
                ($1, $3, 'Remain in denied scope.', 'test/model', '{}',
                 '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
                 'active')`,
        [ids.guild, ids.eligibleAgent, ids.deniedAgent],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5),
                ($6, $2, $7, $8, $5),
                ($9, $2, $10, $8, $11)`,
        [
          randomUUID(), ids.guild, ids.reader, ids.readerRole, ids.teamSpace,
          randomUUID(), ids.eligibleAgent, ids.agentRole,
          randomUUID(), ids.deniedAgent, ids.deniedSpace,
        ],
      );
    });
    const env = {
      GUILD_ID: ids.guild,
      HYPERDRIVE: { connectionString },
    } as GuildEnv;
    const root = new GuildWorkService(env, ids.root);
    const visibleGoal = await root.createGoal({
      spaceId: ids.teamSpace,
      title: "Visible Goal",
      description: "Visible only inside Team scope.",
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      sourceIds: [],
      targetAt: null,
    });
    const visibleProject = await root.createProject({
      goalId: visibleGoal,
      spaceId: ids.teamSpace,
      title: "Visible Project",
      description: "Project under visible Goal.",
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      sourceIds: [],
      dueAt: null,
    });
    const visibleQuest = await root.createQuest({
      projectId: visibleProject,
      spaceId: ids.teamSpace,
      title: "Visible Quest",
      description: "Quest under visible Project.",
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      sourceIds: [],
      assigneeIdentityId: ids.eligibleAgent,
      dueAt: null,
    });
    const visibleStep = await root.createStep({
      questId: visibleQuest,
      title: "Visible Step",
      description: "A governed unit of work.",
      assigneeIdentityId: ids.eligibleAgent,
    });
    const deniedGoal = await root.createGoal({
      spaceId: ids.deniedSpace,
      title: "DENIED_GOAL_MARKER",
      description: "Must never cross the Gatekeeper boundary.",
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      sourceIds: [],
      targetAt: null,
    });

    const reader = new GuildWorkService(env, ids.reader);
    const page = await reader.getPage();
    expect(page.goals.map((goal) => goal.id)).toEqual([visibleGoal]);
    expect(page.projects.map((project) => project.id)).toEqual([visibleProject]);
    expect(page.quests.map((quest) => quest.id)).toEqual([visibleQuest]);
    expect(JSON.stringify(page)).not.toContain("DENIED_GOAL_MARKER");
    expect(await reader.getQuestDetail(visibleQuest)).toMatchObject({
      quest: { id: visibleQuest, capabilities: { changeStatus: false, assign: false } },
      steps: [{ id: visibleStep }],
    });
    await expect(reader.getQuestDetail(deniedGoal)).rejects.toThrow();
    await expect(reader.changeStatus({
      kind: "quest",
      id: visibleQuest,
      expectedVersion: 1,
      status: "in_progress",
    })).rejects.toThrow();

    await expect(root.assign({
      kind: "quest",
      id: visibleQuest,
      expectedVersion: 1,
      assigneeIdentityId: ids.deniedAgent,
    })).rejects.toThrow();
    await expect(root.assign({
      kind: "quest",
      id: visibleQuest,
      expectedVersion: 1,
      assigneeIdentityId: ids.service,
    })).rejects.toThrow("active Human or Agent");

    const version = await root.assign({
      kind: "quest",
      id: visibleQuest,
      expectedVersion: 1,
      assigneeIdentityId: ids.reader,
    });
    expect(version).toBe(2);
    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const notifications = await connection.query<{ recipient_identity_id: string; resource_id: string }>(
        `SELECT recipient_identity_id::text, resource_id::text
           FROM inbox_notifications
          WHERE guild_id = $1 AND resource_id = $2`,
        [ids.guild, visibleQuest],
      );
      const events = await connection.query<{ action: string; subject_id: string }>(
        `SELECT action, subject_id::text
           FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2
          ORDER BY sequence`,
        [ids.guild, visibleQuest],
      );
      return { notifications: notifications.rows, events: events.rows };
    });
    expect(evidence.notifications).toHaveLength(2);
    expect(evidence.notifications.map((row) => row.recipient_identity_id).sort())
      .toEqual([ids.eligibleAgent, ids.reader].sort());
    expect(evidence.events.map((row) => row.action)).toEqual(["quest.created", "quest.assigned"]);
  });
});
