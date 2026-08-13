import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildPostgresRepository, withGuildTransaction } from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import { GuildDecisionService } from "../src/decision-service.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(guildId: string, actorIdentityId: string): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorIdentityId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId,
    action: "guild.initialized",
    subjectType: "guild",
    subjectId: guildId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "decision-service-integration-test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 2,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
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

function decisionInput(spaceId: string, title: string) {
  return {
    spaceId,
    method: "consent" as const,
    title,
    description: `Choose the governed outcome for ${title}.`,
    rationale: "The Guild needs a durable decision with explicit evidence and approval.",
    visibility: "space" as const,
    classification: "internal" as const,
    allowedIdentityIds: [] as string[],
    sourceIds: [] as string[],
    reviewAt: null,
    options: [
      { label: "Adopt", description: "Adopt the proposal." },
      { label: "Keep current", description: "Keep the current policy." },
    ],
  };
}

integration("Guild Decision service authorization boundary", () => {
  it("filters before returning and enforces Human quorum and supersession scope", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = {
      guild: randomUUID(),
      root: randomUUID(),
      teamManager: randomUUID(),
      siblingManager: randomUUID(),
      contributor: randomUUID(),
      agent: randomUUID(),
      rootSpace: randomUUID(),
      teamSpace: randomUUID(),
      siblingSpace: randomUUID(),
      managerRole: randomUUID(),
      contributorRole: randomUUID(),
    };
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
        guildId: ids.guild,
        name: "Decision Service Guild",
        purpose: "Verify Gatekeeper Decision authorization",
        rootIdentityId: ids.root,
        rootDisplayName: "Human Root",
        rootSpaceId: ids.rootSpace,
        rootSpaceName: "Guild",
        constitution: constitution(ids.guild, ids.root),
        roles: [{
          id: ids.managerRole,
          name: "Decision manager",
          permissions: [
            "guild.read", "space.read", "decision.read", "decision.propose",
            "decision.approve", "inbox.read",
          ],
        }, {
          id: ids.contributorRole,
          name: "Decision contributor",
          permissions: ["guild.read", "space.read", "decision.read", "decision.propose"],
        }],
        chronicleEvent: event(ids.guild, ids.root),
      });
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $3, $4, 'Team', 'active'), ($2, $3, $4, 'Sibling', 'active')`,
        [ids.teamSpace, ids.siblingSpace, ids.guild, ids.rootSpace],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $5, 'human', 'Team Manager', 'active'),
                ($2, $5, 'human', 'Sibling Manager', 'active'),
                ($3, $5, 'human', 'Contributor', 'active'),
                ($4, $5, 'agent', 'Decision Agent', 'active')`,
        [ids.teamManager, ids.siblingManager, ids.contributor, ids.agent, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'internal', now()),
                ($1, $3, 'active', 'internal', now()),
                ($1, $4, 'active', 'internal', now()),
                ($1, $5, 'active', 'internal', now())`,
        [ids.guild, ids.teamManager, ids.siblingManager, ids.contributor, ids.agent],
      );
      await connection.query(
        `INSERT INTO agent_profiles
           (guild_id, identity_id, instructions, model, tool_ids, limits, status)
         VALUES ($1, $2, 'Draft Decision options only.', 'test/model', '{}',
                 '{"currency":"USD","maxBudgetMinor":100,"maxTokens":100000,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
                 'active')`,
        [ids.guild, ids.agent],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5),
                ($6, $2, $7, $4, $8),
                ($9, $2, $10, $11, $5),
                ($12, $2, $13, $11, $5)`,
        [
          randomUUID(), ids.guild, ids.teamManager, ids.managerRole, ids.teamSpace,
          randomUUID(), ids.siblingManager, ids.siblingSpace,
          randomUUID(), ids.contributor, ids.contributorRole,
          randomUUID(), ids.agent,
        ],
      );
    });

    const env = {
      GUILD_ID: ids.guild,
      HYPERDRIVE: { connectionString },
    } as GuildEnv;
    const root = new GuildDecisionService(env, ids.root);
    const teamManager = new GuildDecisionService(env, ids.teamManager);
    const siblingManager = new GuildDecisionService(env, ids.siblingManager);
    const contributor = new GuildDecisionService(env, ids.contributor);
    const agent = new GuildDecisionService(env, ids.agent);

    const teamDecisionId = await root.create(decisionInput(ids.teamSpace, "TEAM_DECISION_MARKER"));
    const hiddenDecisionId = await root.create(
      decisionInput(ids.siblingSpace, "SIBLING_DECISION_SECRET_MARKER"),
    );
    const page = await teamManager.getPage();
    expect(page.items.map((decision) => decision.id)).toEqual([teamDecisionId]);
    expect(JSON.stringify(page)).not.toContain("SIBLING_DECISION_SECRET_MARKER");
    await expect(teamManager.getDecision(hiddenDecisionId)).rejects.toThrow();

    await expect(teamManager.saveDraft({
      ...decisionInput(ids.siblingSpace, "Move outside the Team boundary"),
      decisionId: teamDecisionId,
      expectedVersion: 1,
    })).rejects.toThrow();

    expect(await root.propose({ decisionId: teamDecisionId, expectedVersion: 1 })).toBe(2);
    const proposed = await teamManager.getDecision(teamDecisionId);
    expect(proposed.decision.requiredApprovals).toBe(2);
    expect(proposed.decision.capabilities.review).toBe(true);
    const selectedOptionId = proposed.options[0]!.id;

    await expect(contributor.review({
      decisionId: teamDecisionId,
      expectedVersion: 2,
      verdict: "approve",
      selectedOptionId,
      reason: "I do not have approval authority.",
    })).rejects.toThrow();
    await expect(agent.review({
      decisionId: teamDecisionId,
      expectedVersion: 2,
      verdict: "approve",
      selectedOptionId,
      reason: "An Agent cannot cast a governance vote.",
    })).rejects.toThrow();

    expect(await teamManager.review({
      decisionId: teamDecisionId,
      expectedVersion: 2,
      verdict: "approve",
      selectedOptionId,
      reason: "The Team boundary and evidence are explicit.",
    })).toEqual({ version: 3, status: "proposed", approvalCount: 1 });
    expect(await root.review({
      decisionId: teamDecisionId,
      expectedVersion: 3,
      verdict: "approve",
      selectedOptionId,
      reason: "The proposal is ready to become Guild policy.",
    })).toEqual({ version: 4, status: "approved", approvalCount: 2 });

    expect(await root.propose({ decisionId: hiddenDecisionId, expectedVersion: 1 })).toBe(2);
    const hiddenOptionId = (await siblingManager.getDecision(hiddenDecisionId)).options[0]!.id;
    await siblingManager.review({
      decisionId: hiddenDecisionId,
      expectedVersion: 2,
      verdict: "approve",
      selectedOptionId: hiddenOptionId,
      reason: "The sibling Space approves this policy.",
    });
    await root.review({
      decisionId: hiddenDecisionId,
      expectedVersion: 3,
      verdict: "approve",
      selectedOptionId: hiddenOptionId,
      reason: "The sibling policy is approved.",
    });
    await expect(root.supersede({
      decisionId: teamDecisionId,
      replacementDecisionId: hiddenDecisionId,
      expectedVersion: 4,
    })).rejects.toThrow("preserve the original security boundary");

    const replacementId = await root.create(
      decisionInput(ids.teamSpace, "Replacement Team policy"),
    );
    await root.propose({ decisionId: replacementId, expectedVersion: 1 });
    const replacementOptionId = (await teamManager.getDecision(replacementId)).options[0]!.id;
    await teamManager.review({
      decisionId: replacementId,
      expectedVersion: 2,
      verdict: "approve",
      selectedOptionId: replacementOptionId,
      reason: "The replacement preserves the Team boundary.",
    });
    await root.review({
      decisionId: replacementId,
      expectedVersion: 3,
      verdict: "approve",
      selectedOptionId: replacementOptionId,
      reason: "The replacement is approved.",
    });
    expect(await root.supersede({
      decisionId: teamDecisionId,
      replacementDecisionId: replacementId,
      expectedVersion: 4,
    })).toBe(5);

    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const events = await connection.query<{ action: string }>(
        `SELECT action FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2 ORDER BY sequence`,
        [ids.guild, teamDecisionId],
      );
      const notifications = await connection.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM inbox_notifications
          WHERE guild_id = $1 AND resource_id = $2`,
        [ids.guild, teamDecisionId],
      );
      return { events: events.rows.map((row) => row.action), notifications: notifications.rows[0]?.count };
    });
    expect(evidence.events).toEqual([
      "decision.created",
      "decision.proposed",
      "decision.reviewed",
      "decision.reviewed",
      "decision.superseded",
    ]);
    expect(evidence.notifications).toBe(3);
  });
});
