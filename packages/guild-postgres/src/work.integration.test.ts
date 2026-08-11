import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";
import { GuildWorkRepository } from "./work.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "work-integration-test" },
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

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
  const ids = {
    guild: randomUUID(),
    root: randomUUID(),
    member: randomUUID(),
    agent: randomUUID(),
    service: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    siblingSpace: randomUUID(),
    workRole: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Work Guild",
      purpose: "Verify governed Work",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.workRole,
        name: "Worker",
        permissions: ["guild.read", "space.read", "work.read", "work.create", "work.assign", "inbox.read"],
      }],
      chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'), ($4, $2, $3, 'Sibling', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.siblingSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $4, 'human', 'Member', 'active'),
              ($2, $4, 'agent', 'Agent', 'active'),
              ($3, $4, 'service', 'Service', 'active')`,
      [ids.member, ids.agent, ids.service, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now())`,
      [ids.guild, ids.member, ids.agent, ids.service],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Execute assigned test Steps.', 'test/model', '{}',
               '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
               'active')`,
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $4, $5)`,
      [randomUUID(), ids.guild, ids.member, ids.workRole, ids.teamSpace, randomUUID(), ids.agent],
    );
  });
  return ids;
}

integration("Guild Work repository", () => {
  it("creates, scopes, assigns, progresses, notifies, and audits a complete Work hierarchy", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const goalId = randomUUID();
    const projectId = randomUUID();
    const questId = randomUUID();
    const stepId = randomUUID();
    const hiddenGoalId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildWorkRepository(connection, ids.guild);
      await repository.createGoal({
        id: goalId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Ship the governed Work demo",
        description: "Complete one auditable hierarchy.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        targetAt: "2030-01-01T00:00:00.000Z",
        chronicleEvent: event(ids.guild, ids.root, "goal.created", "goal", goalId),
      });
      await repository.createProject({
        id: projectId,
        goalId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Implement Work",
        description: "Build and verify Work.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        dueAt: null,
        chronicleEvent: event(ids.guild, ids.root, "project.created", "project", projectId),
      });
      await repository.createQuest({
        id: questId,
        projectId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        assigneeIdentityId: ids.member,
        spaceId: ids.teamSpace,
        title: "Verify the Work flow",
        description: "Run the acceptance path.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        dueAt: null,
        chronicleEvent: event(ids.guild, ids.root, "quest.created", "quest", questId),
      });
      await repository.createStep({
        id: stepId,
        questId,
        actorIdentityId: ids.root,
        assigneeIdentityId: ids.agent,
        title: "Run the verification",
        description: "Execute the bounded test.",
        chronicleEvent: event(ids.guild, ids.root, "step.created", "step", stepId),
      });
      await repository.createGoal({
        id: hiddenGoalId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.siblingSpace,
        title: "Sibling secret",
        description: "Must not appear in Team results.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        targetAt: null,
        chronicleEvent: event(ids.guild, ids.root, "goal.created", "goal", hiddenGoalId),
      });
    });

    const memberView = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildWorkRepository(connection, ids.guild);
      return {
        goals: await repository.listGoals(ids.member),
        projects: await repository.listProjects(ids.member),
        quests: await repository.listQuests(ids.member),
        steps: await repository.listSteps(questId),
      };
    });
    expect(memberView.goals.items.map((goal) => goal.id)).toEqual([goalId]);
    expect(memberView.projects.items.map((project) => project.id)).toEqual([projectId]);
    expect(memberView.quests.items.map((quest) => quest.id)).toEqual([questId]);
    expect(memberView.steps.map((step) => step.id)).toEqual([stepId]);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE projects SET status = 'cancelled', version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, projectId],
      );
    })).rejects.toThrow("every child Work item to be terminal");

    const invalidProjectId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildWorkRepository(connection, ids.guild).createProject({
        id: invalidProjectId,
        goalId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.siblingSpace,
        title: "Invalid sibling",
        description: "Must fail.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        dueAt: null,
        chronicleEvent: event(ids.guild, ids.root, "project.created", "project", invalidProjectId),
      });
    })).rejects.toThrow("cannot broaden");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildWorkRepository(connection, ids.guild).assignQuest({
        id: questId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        assigneeIdentityId: ids.service,
        chronicleEvent: event(ids.guild, ids.root, "quest.assigned", "quest", questId),
      });
    })).rejects.toThrow("active Human or Agent");

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildWorkRepository(connection, ids.guild);
      await repository.updateGoalStatus({
        id: goalId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        status: "active",
        chronicleEvent: event(ids.guild, ids.root, "goal.status.changed", "goal", goalId),
      });
      await repository.updateProjectStatus({
        id: projectId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        status: "active",
        chronicleEvent: event(ids.guild, ids.root, "project.status.changed", "project", projectId),
      });
      await repository.updateQuestStatus({
        id: questId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        status: "in_progress",
        chronicleEvent: event(ids.guild, ids.root, "quest.status.changed", "quest", questId),
      });
      await repository.updateStepStatus({
        id: stepId,
        expectedVersion: 1,
        actorIdentityId: ids.agent,
        status: "completed",
        chronicleEvent: event(ids.guild, ids.agent, "step.status.changed", "step", stepId),
      });
      await repository.updateQuestStatus({
        id: questId,
        expectedVersion: 2,
        actorIdentityId: ids.member,
        status: "completed",
        chronicleEvent: event(ids.guild, ids.member, "quest.status.changed", "quest", questId),
      });
      await repository.updateProjectStatus({
        id: projectId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        status: "completed",
        chronicleEvent: event(ids.guild, ids.root, "project.status.changed", "project", projectId),
      });
      await repository.updateGoalStatus({
        id: goalId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        status: "completed",
        chronicleEvent: event(ids.guild, ids.root, "goal.status.changed", "goal", goalId),
      });
    });

    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const statuses = await connection.query<{
        goal_status: string;
        project_status: string;
        quest_status: string;
        step_status: string;
      }>(
        `SELECT g.status AS goal_status, p.status AS project_status,
                q.status AS quest_status, s.status AS step_status
           FROM goals g JOIN projects p ON p.guild_id = g.guild_id AND p.goal_id = g.id
           JOIN quests q ON q.guild_id = p.guild_id AND q.project_id = p.id
           JOIN steps s ON s.guild_id = q.guild_id AND s.quest_id = q.id
          WHERE g.guild_id = $1 AND g.id = $2`,
        [ids.guild, goalId],
      );
      const notifications = await connection.query<{ recipient_identity_id: string }>(
        "SELECT recipient_identity_id::text FROM inbox_notifications WHERE guild_id = $1 ORDER BY recipient_identity_id",
        [ids.guild],
      );
      const actions = await connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 ORDER BY sequence",
        [ids.guild],
      );
      return { statuses: statuses.rows[0], notifications: notifications.rows, actions: actions.rows };
    });
    expect(evidence.statuses).toEqual({
      goal_status: "completed",
      project_status: "completed",
      quest_status: "completed",
      step_status: "completed",
    });
    expect(evidence.notifications.map((row) => row.recipient_identity_id).sort())
      .toEqual([ids.agent, ids.member].sort());
    expect(evidence.actions.map((row) => row.action)).toContain("quest.status.changed");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE projects SET status = 'active', version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, projectId],
      );
    })).rejects.toThrow("Terminal Work cannot accept or reactivate child Work");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE goals SET title = 'Tampered' WHERE guild_id = $1 AND id = $2",
        [ids.guild, goalId],
      );
    })).rejects.toThrow("version must increment");
  });

  it("rejects Chronicle evidence that names a different Work subject", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const goalId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildWorkRepository(connection, ids.guild).createGoal({
        id: goalId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Audited Goal",
        description: "The event must identify this Goal.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        targetAt: null,
        chronicleEvent: event(ids.guild, ids.root, "goal.created", "goal", randomUUID()),
      });
    })).rejects.toThrow("actor, or subject boundary");
  });
});
