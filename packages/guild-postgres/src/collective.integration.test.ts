import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createDeterministicCollectiveBlueprint,
  type ChronicleEvent,
  type Constitution,
} from "@guild-os/domain";
import { GuildCollectiveRepository } from "./collective.js";
import { GuildKnowledgeRepository } from "./knowledge.js";
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
  details: Readonly<Record<string, string>> = {},
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
    details: { source: "collective-integration-test", ...details },
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
    paused: randomUUID(),
    service: randomUUID(),
    guildActor: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    siblingSpace: randomUUID(),
    role: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Collective Test Guild",
      purpose: "Verify Actor-neutral primitives",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.role,
        name: "Participant",
        permissions: [
          "guild.read",
          "space.read",
          "actor.read",
          "memory.read",
          "memory.create",
          "activity.read",
          "activity.create",
        ],
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
       VALUES ($1, $5, 'human', 'Member', 'active'),
              ($2, $5, 'human', 'Paused member', 'disabled'),
              ($3, $5, 'service', 'Publishing service', 'active'),
              ($4, $5, 'guild', 'Partner collective', 'active')`,
      [ids.member, ids.paused, ids.service, ids.guildActor, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'suspended', 'internal', now()),
              ($1, $4, 'active', 'internal', now()),
              ($1, $5, 'active', 'internal', now())`,
      [ids.guild, ids.member, ids.paused, ids.service, ids.guildActor],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), ids.guild, ids.member, ids.role, ids.teamSpace],
    );
  });
  return ids;
}

function memoryContent(revision: string) {
  return {
    title: { en: "Shared field note" },
    summary: { en: `Verified observation ${revision}` },
    body: { en: `The team recorded this evidence during ${revision}.` },
    sourceIds: [] as string[],
  };
}

integration("Guild Collective repository", () => {
  it("versions purchaser Blueprints and applies Profiles without changing existing authority", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const blueprint = createDeterministicCollectiveBlueprint({
      locale: "en",
      answers: {
        purpose: "Coordinate a family household and preserve shared knowledge",
        participants: "Family members and a governed AI assistant",
        memoryIntent: "Care notes, household guides, and family history",
        activityIntent: "Plan care, household tasks, and family events",
        decisionStyle: "Family consent with responsible adult review",
      },
    });

    const before = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `SELECT role.id::text, role.name,
                COALESCE(array_agg(permission.permission ORDER BY permission.permission)
                  FILTER (WHERE permission.permission IS NOT NULL), '{}') AS permissions
           FROM roles role
           LEFT JOIN role_permissions permission
             ON permission.guild_id = role.guild_id AND permission.role_id = role.id
          WHERE role.guild_id = $1
          GROUP BY role.id, role.name
          ORDER BY role.id`,
        [ids.guild],
      ).then((result) => result.rows));

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      const saved = await repository.saveBlueprint({
        draft: blueprint,
        expectedVersion: null,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "collective.blueprint.created",
          "collective",
          ids.guild,
          { blueprintKey: blueprint.key },
        ),
      });
      expect(saved.version).toBe(1);
      await repository.configure({
        templateKey: "blank",
        blueprintKey: blueprint.key,
        vocabularyOverrides: {},
        onboardingAnswers: {
          purpose: "Stale previous purpose",
          participants: "Stale previous participants",
        },
        actorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "collective.configured", "collective", ids.guild),
      });
      expect((await repository.getSettings()).onboardingAnswers).toEqual(blueprint.onboardingAnswers);
      await repository.setSpaceBlueprint(
        ids.teamSpace,
        blueprint.key,
        ids.root,
        event(ids.guild, ids.root, "space.context_profile.changed", "space", ids.teamSpace),
      );
    });

    const edited = structuredClone(blueprint);
    edited.definition.name = "Family Commons";
    edited.definition.description = "A reviewed household Blueprint.";
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      const saved = await repository.saveBlueprint({
        draft: edited,
        expectedVersion: 1,
        actorId: ids.root,
        chronicleEvent: event(
          ids.guild,
          ids.root,
          "collective.blueprint.updated",
          "collective",
          ids.guild,
          { blueprintKey: blueprint.key },
        ),
      });
      expect(saved.version).toBe(2);
      expect(saved.definition.name).toBe("Family Commons");
      expect((await repository.getSettings()).blueprintKey).toBe(blueprint.key);
      expect(await repository.listBlueprints()).toHaveLength(1);
    });

    const after = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `SELECT role.id::text, role.name,
                COALESCE(array_agg(permission.permission ORDER BY permission.permission)
                  FILTER (WHERE permission.permission IS NOT NULL), '{}') AS permissions
           FROM roles role
           LEFT JOIN role_permissions permission
             ON permission.guild_id = role.guild_id AND permission.role_id = role.id
          WHERE role.guild_id = $1
          GROUP BY role.id, role.name
          ORDER BY role.id`,
        [ids.guild],
      ).then((result) => result.rows));
    expect(after).toEqual(before);

    const history = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query<{ version: number; name: string }>(
        `SELECT version, name
           FROM collective_template_versions
          WHERE guild_id = $1 AND template_key = $2
          ORDER BY version`,
        [ids.guild, blueprint.key],
      ).then((result) => result.rows));
    expect(history).toEqual([
      { version: 1, name: "Family Circle" },
      { version: 2, name: "Family Commons" },
    ]);

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `DELETE FROM collective_template_versions
          WHERE guild_id = $1 AND template_key = $2 AND version = 1`,
        [ids.guild, blueprint.key],
      ))).rejects.toThrow("append-only");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      connection.query(
        `UPDATE collective_templates
            SET system = true
          WHERE guild_id = $1 AND key = $2`,
        [ids.guild, blueprint.key],
      ))).rejects.toThrow("identity is immutable");
  });

  it("keeps Actor, Memory, Activity, template, and legacy compatibility boundaries coherent", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const memoryId = randomUUID();
    const hiddenMemoryId = randomUUID();
    const governedMemoryId = randomUUID();
    const activityId = randomUUID();
    const childActivityId = randomUUID();
    const hiddenActivityId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      await repository.configure({
        templateKey: "research",
        vocabularyOverrides: { activity: "Investigations" },
        onboardingAnswers: {
          purpose: "Test evidence together",
          participants: "Researchers and agents",
          memoryIntent: "Evidence and findings",
          activityIntent: "Studies and experiments",
          decisionStyle: "Peer review",
        },
        actorId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "collective.configured", "collective", ids.guild),
      });
      await repository.createMemory({
        id: memoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.teamSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: 0.75,
        changeNote: "Initial observation.",
        ...memoryContent("v1"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", memoryId),
      });
      await repository.createMemory({
        id: hiddenMemoryId,
        actorId: ids.root,
        ownerActorId: ids.root,
        spaceId: ids.siblingSpace,
        type: "research",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        confidence: null,
        changeNote: "Sibling evidence.",
        ...memoryContent("hidden"),
        chronicleEvent: event(ids.guild, ids.root, "memory.created", "memory", hiddenMemoryId),
      });
      await repository.createActivity({
        id: activityId,
        actorId: ids.root,
        parentActivityId: null,
        ownerActorId: ids.root,
        assigneeActorId: ids.service,
        spaceId: ids.teamSpace,
        type: "study",
        title: "Study collective memory",
        description: "Verify the neutral Activity model.",
        status: "proposed",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        sourceIds: [memoryId],
        startsAt: null,
        dueAt: null,
        position: 0,
        chronicleEvent: event(ids.guild, ids.root, "activity.created", "activity", activityId),
      });
      await repository.createActivity({
        id: childActivityId,
        actorId: ids.root,
        parentActivityId: activityId,
        ownerActorId: ids.root,
        assigneeActorId: null,
        spaceId: ids.teamSpace,
        type: "experiment",
        title: "Run the experiment",
        description: "A child can use a different Activity type.",
        status: "planned",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        sourceIds: [],
        startsAt: null,
        dueAt: null,
        position: 1,
        chronicleEvent: event(ids.guild, ids.root, "activity.created", "activity", childActivityId),
      });
      await repository.createActivity({
        id: hiddenActivityId,
        actorId: ids.root,
        parentActivityId: null,
        ownerActorId: ids.root,
        assigneeActorId: null,
        spaceId: ids.siblingSpace,
        type: "study",
        title: "Sibling study",
        description: "Must remain outside the Team context.",
        status: "planned",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        sourceIds: [],
        startsAt: null,
        dueAt: null,
        position: 0,
        chronicleEvent: event(ids.guild, ids.root, "activity.created", "activity", hiddenActivityId),
      });
    });

    const memberView = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      return {
        actors: await repository.listActors(),
        memories: await repository.listMemories(ids.member),
        search: await repository.searchAuthorizedMemories(ids.member, "shared field", "en"),
        activities: await repository.listActivities(ids.member),
        settings: await repository.getSettings(),
      };
    });
    expect(memberView.actors.items.map((actor) => actor.id)).toEqual(expect.arrayContaining([
      ids.root,
      ids.member,
      ids.paused,
      ids.service,
      ids.guildActor,
    ]));
    expect(memberView.memories.items.map((memory) => memory.id)).toEqual([memoryId]);
    expect(memberView.search.map((memory) => memory.id)).toEqual([memoryId]);
    expect(memberView.activities.items.map((activity) => activity.id)).toEqual(expect.arrayContaining([
      activityId,
      childActivityId,
    ]));
    expect(memberView.activities.items.map((activity) => activity.id)).not.toContain(hiddenActivityId);
    expect(memberView.settings).toMatchObject({
      templateKey: "research",
      templateVersion: 2,
      vocabularyOverrides: { activity: "Investigations" },
    });

    const version = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).saveMemory({
        memoryId,
        actorId: ids.root,
        expectedVersion: 1,
        changeNote: "Add the second observation.",
        ...memoryContent("v2"),
        chronicleEvent: event(ids.guild, ids.root, "memory.version.created", "memory", memoryId),
      }));
    expect(version).toBe(2);

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildCollectiveRepository(connection, ids.guild);
      const nextVersion = await repository.changeActivityStatus({
        activityId,
        actorId: ids.root,
        expectedVersion: 1,
        status: "active",
        chronicleEvent: event(ids.guild, ids.root, "activity.status.changed", "activity", activityId),
      });
      expect(nextVersion).toBe(2);
      expect(await repository.assignActivity({
        activityId,
        actorId: ids.root,
        expectedVersion: 2,
        assigneeActorId: ids.guildActor,
        chronicleEvent: event(ids.guild, ids.root, "activity.assigned", "activity", activityId),
      })).toBe(3);
      expect(await repository.assignActivity({
        activityId,
        actorId: ids.root,
        expectedVersion: 3,
        assigneeActorId: null,
        chronicleEvent: event(ids.guild, ids.root, "activity.assigned", "activity", activityId),
      })).toBe(4);
    });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).assignActivity({
        activityId,
        actorId: ids.root,
        expectedVersion: 4,
        assigneeActorId: ids.paused,
        chronicleEvent: event(ids.guild, ids.root, "activity.assigned", "activity", activityId),
      }))).rejects.toThrow("not operational");

    const invalidChildId = randomUUID();
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).createActivity({
        id: invalidChildId,
        actorId: ids.root,
        parentActivityId: activityId,
        ownerActorId: ids.root,
        assigneeActorId: null,
        spaceId: ids.siblingSpace,
        type: "study",
        title: "Invalid sibling child",
        description: "Must not broaden the parent Space.",
        status: "planned",
        visibility: "space",
        classification: "internal",
        allowedActorIds: [],
        sourceIds: [],
        startsAt: null,
        dueAt: null,
        position: 2,
        chronicleEvent: event(ids.guild, ids.root, "activity.created", "activity", invalidChildId),
      }))).rejects.toThrow("cannot broaden");

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildKnowledgeRepository(connection, ids.guild).createKnowledge({
        id: governedMemoryId,
        spaceId: ids.teamSpace,
        ownerIdentityId: ids.root,
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        reviewDueAt: null,
        changeNote: "Governed content stays governed.",
        ...memoryContent("governed"),
        chronicleEvent: event(ids.guild, ids.root, "knowledge.created", "knowledge", governedMemoryId),
      });
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildCollectiveRepository(connection, ids.guild).saveMemory({
        memoryId: governedMemoryId,
        actorId: ids.root,
        expectedVersion: 1,
        changeNote: "Bypass attempt.",
        ...memoryContent("bypass"),
        chronicleEvent: event(ids.guild, ids.root, "memory.version.created", "memory", governedMemoryId),
      }))).rejects.toThrow("approval workflow");
  });
});
