import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildCollectiveRepository } from "./collective.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction, type GuildTransactionConnection } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorId: string,
  action: string,
  subjectId: string,
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
    subjectType: "activity",
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "activity-graph-integration-test" },
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
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    hiddenSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Activity Graph Test Guild",
      purpose: "Verify Activity dependency and outcome integrity",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Participant",
        permissions: ["guild.read", "space.read", "activity.read", "activity.create"],
      }],
      chronicleEvent: {
        ...event(ids.guild, ids.root, "guild.initialized", ids.guild),
        subjectType: "guild",
      },
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'), ($4, $2, $3, 'Hidden', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.hiddenSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $2, 'human', 'Member', 'active')`,
      [ids.member, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now())`,
      [ids.guild, ids.member],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), ids.guild, ids.member, ids.role, ids.teamSpace],
    );
  });
  return ids;
}

async function createActivity(
  connection: GuildTransactionConnection,
  ids: Awaited<ReturnType<typeof fixture>>,
  input: {
    id: string;
    title: string;
    status?: "proposed" | "planned" | "ready" | "active";
    spaceId?: string;
  },
) {
  await new GuildCollectiveRepository(connection, ids.guild).createActivity({
    id: input.id,
    actorId: ids.root,
    parentActivityId: null,
    spaceId: input.spaceId ?? ids.teamSpace,
    ownerActorId: ids.root,
    assigneeActorId: null,
    type: "task",
    title: input.title,
    description: `${input.title} description`,
    status: input.status ?? "planned",
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    sourceIds: [],
    startsAt: null,
    dueAt: null,
    position: 0,
    chronicleEvent: event(ids.guild, ids.root, "activity.created", input.id),
  });
}

integration("Activity dependency graph and outcomes", () => {
  it("rejects self edges, duplicates, cross-Guild endpoints, and ordering cycles in PostgreSQL", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const [activityA, activityB, activityC] = [randomUUID(), randomUUID(), randomUUID()];
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, { id: activityA, title: "Activity A" });
      await createActivity(connection, ids, { id: activityB, title: "Activity B" });
      await createActivity(connection, ids, { id: activityC, title: "Activity C" });
    });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      await repository.addActivityDependency({
        id: randomUUID(), activityId: activityA, dependsOnActivityId: activityB,
        kind: "blocks", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activityA),
      });
      await repository.addActivityDependency({
        id: randomUUID(), activityId: activityB, dependsOnActivityId: activityC,
        kind: "follows", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activityB),
      });
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: activityC, dependsOnActivityId: activityA,
        kind: "blocks", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activityC),
      }))).rejects.toThrow("cycle");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: activityC, dependsOnActivityId: activityC,
        kind: "follows", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activityC),
      }))).rejects.toThrow("itself");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: activityA, dependsOnActivityId: activityB,
        kind: "blocks", actorId: ids.root, expectedVersion: 2,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activityA),
      }))).rejects.toThrow("already active");

    const other = await fixture();
    const foreignActivity = randomUUID();
    await withGuildTransaction(connectionString, other.guild, (connection) =>
      createActivity(connection, other, { id: foreignActivity, title: "Foreign Activity" }));
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO activity_dependencies
           (id, guild_id, activity_id, depends_on_activity_id, kind,
            created_by_actor_id, updated_by_actor_id)
         VALUES ($1, $2, $3, $4, 'blocks', $5, $5)`,
        [randomUUID(), ids.guild, activityC, foreignActivity, ids.root],
      );
    })).rejects.toThrow("does not exist in this Guild");
  });

  it("omits an edge entirely when either endpoint is outside the Actor's readable boundary", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const visibleActivity = randomUUID();
    const hiddenActivity = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, { id: visibleActivity, title: "Visible Activity" });
      await createActivity(connection, ids, {
        id: hiddenActivity,
        title: "Hidden Activity title must never leak",
        spaceId: ids.hiddenSpace,
      });
      await new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: visibleActivity, dependsOnActivityId: hiddenActivity,
        kind: "relates_to", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", visibleActivity),
      });
    });

    const memberGraph = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild)
        .listActivityGraphs(ids.member, [visibleActivity]));
    expect(memberGraph.get(visibleActivity)).toEqual({
      dependencies: [], dependents: [], outcome: null,
    });

    const rootGraph = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild)
        .listActivityGraphs(ids.root, [visibleActivity]));
    expect(rootGraph.get(visibleActivity)?.dependencies[0]?.dependsOnActivity.title)
      .toBe("Hidden Activity title must never leak");
  });

  it("blocks progress until every active blocking predecessor is completed", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const predecessor = randomUUID();
    const dependent = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, {
        id: predecessor, title: "Complete evidence", status: "active",
      });
      await createActivity(connection, ids, { id: dependent, title: "Publish result" });
      await new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: dependent, dependsOnActivityId: predecessor,
        kind: "blocks", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", dependent),
      });
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).changeActivityStatus({
        activityId: dependent, actorId: ids.root, expectedVersion: 2, status: "ready",
        chronicleEvent: event(ids.guild, ids.root, "activity.status.changed", dependent),
      }))).rejects.toThrow("incomplete blocking predecessor");

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      const completion = await repository.completeActivity({
        activityId: predecessor,
        actorId: ids.root,
        expectedVersion: 1,
        summary: "The evidence review completed successfully.",
        evidenceSourceIds: [],
        chronicleEvent: event(ids.guild, ids.root, "activity.completed", predecessor),
      });
      expect(completion.activityVersion).toBe(2);
      expect(await repository.changeActivityStatus({
        activityId: dependent, actorId: ids.root, expectedVersion: 2, status: "ready",
        chronicleEvent: event(ids.guild, ids.root, "activity.status.changed", dependent),
      })).toBe(3);
    });
  });

  it("records a versioned completion outcome and rejects update, delete, or outcome-free completion", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const activityId = randomUUID();
    const missingOutcomeId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, { id: activityId, title: "Complete safely", status: "active" });
      await createActivity(connection, ids, {
        id: missingOutcomeId, title: "Cannot bypass outcome", status: "active",
      });
      const result = await new GuildCollectiveRepository(connection, ids.guild).completeActivity({
        activityId,
        actorId: ids.root,
        expectedVersion: 1,
        summary: "A durable result with evidence was recorded.",
        evidenceSourceIds: [],
        chronicleEvent: event(ids.guild, ids.root, "activity.completed", activityId),
      });
      expect(result.outcome).toMatchObject({
        activityId,
        version: 1,
        activityVersion: 2,
        completedByActorId: ids.root,
      });
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE activity_outcomes SET summary = 'tampered' WHERE guild_id = $1 AND activity_id = $2",
        [ids.guild, activityId],
      );
    })).rejects.toThrow("append-only");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "DELETE FROM activity_outcomes WHERE guild_id = $1 AND activity_id = $2",
        [ids.guild, activityId],
      );
    })).rejects.toThrow("append-only");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE activities SET status = 'completed', version = version + 1 WHERE guild_id = $1 AND id = $2",
        [ids.guild, missingOutcomeId],
      );
    })).rejects.toThrow("requires an append-only outcome");

    const chronicles = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 AND subject_id = $2 ORDER BY sequence",
        [ids.guild, activityId],
      ));
    expect(chronicles.rows.map((row) => row.action)).toContain("activity.completed");
  });

  it("uses Activity and edge versions to reject stale writers while retaining every edge version", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const activity = randomUUID();
    const predecessor = randomUUID();
    const secondPredecessor = randomUUID();
    let dependencyId = "";
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, { id: activity, title: "Versioned Activity" });
      await createActivity(connection, ids, { id: predecessor, title: "First predecessor" });
      await createActivity(connection, ids, { id: secondPredecessor, title: "Second predecessor" });
      const result = await new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: activity, dependsOnActivityId: predecessor,
        kind: "relates_to", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activity),
      });
      dependencyId = result.dependency.id;
      expect(result.activityVersion).toBe(2);
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
        id: randomUUID(), activityId: activity, dependsOnActivityId: secondPredecessor,
        kind: "follows", actorId: ids.root, expectedVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activity),
      }))).rejects.toThrow("changed since it was loaded");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).removeActivityDependency({
        dependencyId, activityId: activity, actorId: ids.root,
        expectedVersion: 2, expectedDependencyVersion: 2,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.removed", activity),
      }))).rejects.toThrow("dependency changed since it was loaded");

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      const removed = await repository.removeActivityDependency({
        dependencyId, activityId: activity, actorId: ids.root,
        expectedVersion: 2, expectedDependencyVersion: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.removed", activity),
      });
      expect(removed).toMatchObject({ activityVersion: 3, dependency: { version: 2, status: "revoked" } });
      const restored = await repository.addActivityDependency({
        id: randomUUID(), activityId: activity, dependsOnActivityId: predecessor,
        kind: "relates_to", actorId: ids.root, expectedVersion: 3,
        chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", activity),
      });
      expect(restored).toMatchObject({ activityVersion: 4, dependency: { version: 3, status: "active" } });
      const history = await connection.query<{ version: number; status: string }>(
        `SELECT version, status FROM activity_dependency_versions
          WHERE guild_id = $1 AND dependency_id = $2 ORDER BY version`,
        [ids.guild, dependencyId],
      );
      expect(history.rows).toEqual([
        { version: 1, status: "active" },
        { version: 2, status: "revoked" },
        { version: 3, status: "active" },
      ]);
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE activity_dependency_versions SET status = 'revoked'
          WHERE guild_id = $1 AND dependency_id = $2 AND version = 1`,
        [ids.guild, dependencyId],
      );
    })).rejects.toThrow("append-only");

    const dependencyChronicle = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => (await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2
            AND action LIKE 'activity.dependency.%'
          ORDER BY sequence`,
        [ids.guild, activity],
      )).rows.map((row) => row.action),
    );
    expect(dependencyChronicle).toEqual([
      "activity.dependency.added",
      "activity.dependency.removed",
      "activity.dependency.added",
    ]);

    const racedActivity = randomUUID();
    const racedPredecessorA = randomUUID();
    const racedPredecessorB = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await createActivity(connection, ids, { id: racedActivity, title: "Concurrent Activity" });
      await createActivity(connection, ids, {
        id: racedPredecessorA, title: "Concurrent predecessor A",
      });
      await createActivity(connection, ids, {
        id: racedPredecessorB, title: "Concurrent predecessor B",
      });
    });
    const raced = await Promise.allSettled([
      withGuildTransaction(connectionString, ids.guild, async (connection) =>
        new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
          id: randomUUID(), activityId: racedActivity,
          dependsOnActivityId: racedPredecessorA, kind: "relates_to",
          actorId: ids.root, expectedVersion: 1,
          chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", racedActivity),
        })),
      withGuildTransaction(connectionString, ids.guild, async (connection) =>
        new GuildCollectiveRepository(connection, ids.guild).addActivityDependency({
          id: randomUUID(), activityId: racedActivity,
          dependsOnActivityId: racedPredecessorB, kind: "relates_to",
          actorId: ids.root, expectedVersion: 1,
          chronicleEvent: event(ids.guild, ids.root, "activity.dependency.added", racedActivity),
        })),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
    const racedState = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const activityRow = await connection.query<{ version: number }>(
        "SELECT version FROM activities WHERE guild_id = $1 AND id = $2",
        [ids.guild, racedActivity],
      );
      const edgeRows = await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM activity_dependencies
          WHERE guild_id = $1 AND activity_id = $2 AND status = 'active'`,
        [ids.guild, racedActivity],
      );
      return {
        version: activityRow.rows[0]?.version,
        edgeCount: Number(edgeRows.rows[0]?.count ?? 0),
      };
    });
    expect(racedState).toEqual({ version: 2, edgeCount: 1 });
  });
});
