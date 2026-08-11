import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildDecisionRepository, type DecisionOptionWrite } from "./decision.js";
import { GuildPostgresRepository } from "./repository.js";
import { withGuildTransaction } from "./transaction.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    actorIdentityId,
    action,
    subjectType: "decision",
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "decision-integration-test" },
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
    manager1: randomUUID(),
    manager2: randomUUID(),
    reader: randomUUID(),
    agent: randomUUID(),
    service: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    siblingSpace: randomUUID(),
    managerRole: randomUUID(),
    readerRole: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Decision Guild",
      purpose: "Verify governed organizational decisions",
      rootIdentityId: ids.root,
      rootDisplayName: "Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [
        {
          id: ids.managerRole,
          name: "Decision manager",
          permissions: [
            "guild.read",
            "space.read",
            "decision.read",
            "decision.propose",
            "decision.approve",
            "inbox.read",
          ],
        },
        {
          id: ids.readerRole,
          name: "Decision contributor",
          permissions: ["guild.read", "space.read", "decision.read", "decision.propose"],
        },
      ],
      chronicleEvent: {
        ...event(ids.guild, ids.root, "guild.initialized", ids.guild),
        subjectType: "guild",
      },
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, 'Team', 'active'), ($4, $2, $3, 'Sibling', 'active')`,
      [ids.teamSpace, ids.guild, ids.rootSpace, ids.siblingSpace],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $6, 'human', 'Manager One', 'active'),
              ($2, $6, 'human', 'Manager Two', 'active'),
              ($3, $6, 'human', 'Reader', 'active'),
              ($4, $6, 'agent', 'Decision Agent', 'active'),
              ($5, $6, 'service', 'Decision Service', 'active')`,
      [ids.manager1, ids.manager2, ids.reader, ids.agent, ids.service, ids.guild],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'internal', now()),
              ($1, $3, 'active', 'internal', now()),
              ($1, $4, 'active', 'internal', now()),
              ($1, $5, 'active', 'internal', now()),
              ($1, $6, 'active', 'internal', now())`,
      [ids.guild, ids.manager1, ids.manager2, ids.reader, ids.agent, ids.service],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Draft decision plans only.', 'test/model', '{}',
               '{"currency":"USD","maxBudgetMinor":100,"maxDurationSeconds":60,"maxSteps":5,"maxRetries":1,"maxDelegationDepth":0}',
               'active')`,
      [ids.guild, ids.agent],
    );
    await connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5),
              ($6, $2, $7, $4, $5),
              ($8, $2, $9, $10, $5),
              ($11, $2, $12, $10, $5),
              ($13, $2, $14, $10, $5)`,
      [
        randomUUID(), ids.guild, ids.manager1, ids.managerRole, ids.teamSpace,
        randomUUID(), ids.manager2,
        randomUUID(), ids.reader, ids.readerRole,
        randomUUID(), ids.agent,
        randomUUID(), ids.service,
      ],
    );
  });
  return ids;
}

function options(): [DecisionOptionWrite, DecisionOptionWrite] {
  return [
    { id: randomUUID(), label: "Adopt", description: "Adopt the proposal.", position: 0 },
    { id: randomUUID(), label: "Keep current", description: "Keep the current policy.", position: 1 },
  ];
}

integration("Guild Decision repository", () => {
  it("scopes, freezes, approves, supersedes, notifies, and audits Decisions", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const decisionId = randomUUID();
    const hiddenDecisionId = randomUUID();
    const decisionOptions = options();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildDecisionRepository(connection, ids.guild);
      await repository.createDecision({
        id: decisionId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Adopt the incident response policy",
        description: "Choose whether the Guild adopts the proposed response policy.",
        rationale: "The current process does not define escalation ownership.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: "2030-01-01T00:00:00.000Z",
        options: decisionOptions,
        chronicleEvent: event(ids.guild, ids.root, "decision.created", decisionId),
      });
      await repository.createDecision({
        id: hiddenDecisionId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.siblingSpace,
        title: "Sibling-only policy",
        description: "This Decision must not be visible in the Team Space.",
        rationale: "The policy belongs to another Space.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: null,
        options: options(),
        chronicleEvent: event(ids.guild, ids.root, "decision.created", hiddenDecisionId),
      });
    });

    const readerPage = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).listDecisions(ids.reader));
    expect(readerPage.items.map((decision) => decision.id)).toEqual([decisionId]);

    const preboardingId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $2, 'human', 'Preboarding Reader', 'active')`,
        [preboardingId, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance)
         VALUES ($1, $2, 'preboarding', 'internal')`,
        [ids.guild, preboardingId],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), ids.guild, preboardingId, ids.readerRole, ids.teamSpace],
      );
    });
    const preboardingPage = await withGuildTransaction(
      connectionString,
      ids.guild,
      async (connection) => new GuildDecisionRepository(
        connection,
        ids.guild,
      ).listDecisions(preboardingId),
    );
    expect(preboardingPage.items).toEqual([]);

    const version2 = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).saveDraft({
        id: decisionId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Adopt the incident escalation policy",
        description: "Choose whether the Guild adopts the proposed escalation policy.",
        rationale: "The current process does not define escalation ownership.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: "2030-01-01T00:00:00.000Z",
        options: decisionOptions,
        chronicleEvent: event(ids.guild, ids.root, "decision.draft.updated", decisionId),
      }));
    expect(version2).toBe(2);

    const version3 = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).propose({
        id: decisionId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        requiredApprovals: 2,
        chronicleEvent: event(ids.guild, ids.root, "decision.proposed", decisionId),
      }));
    expect(version3).toBe(3);

    const proposedEvidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const detail = await new GuildDecisionRepository(connection, ids.guild).getDetail(decisionId);
      const recipients = await connection.query<{ recipient_identity_id: string }>(
        `SELECT recipient_identity_id::text
           FROM inbox_notifications
          WHERE guild_id = $1 AND resource_type = 'decision' AND resource_id = $2
          ORDER BY recipient_identity_id`,
        [ids.guild, decisionId],
      );
      return { detail, recipients: recipients.rows.map((row) => row.recipient_identity_id) };
    });
    expect(proposedEvidence.detail.decision.status).toBe("proposed");
    expect(proposedEvidence.detail.options).toHaveLength(2);
    expect(proposedEvidence.recipients.sort()).toEqual([ids.root, ids.manager1, ids.manager2].sort());

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE decision_options SET label = 'Tampered' WHERE guild_id = $1 AND id = $2",
        [ids.guild, decisionOptions[0].id],
      );
    })).rejects.toThrow("immutable after proposal");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE decisions
            SET status = 'approved', selected_option_id = $3, decided_at = now(), version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, decisionId, decisionOptions[0].id],
      );
    })).rejects.toThrow("quorum has not been reached");

    for (const actorIdentityId of [ids.agent, ids.service, ids.reader]) {
      await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
        await new GuildDecisionRepository(connection, ids.guild).review({
          id: decisionId,
          expectedVersion: 3,
          actorIdentityId,
          verdict: "approve",
          selectedOptionId: decisionOptions[0].id,
          reason: "Unauthorized approval attempt.",
          chronicleEvent: event(ids.guild, actorIdentityId, "decision.reviewed", decisionId),
        });
      })).rejects.toThrow("authorized active Human");
    }

    const firstReview = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).review({
        id: decisionId,
        expectedVersion: 3,
        actorIdentityId: ids.manager1,
        verdict: "approve",
        selectedOptionId: decisionOptions[0].id,
        reason: "The ownership model is explicit.",
        chronicleEvent: event(ids.guild, ids.manager1, "decision.reviewed", decisionId),
      }));
    expect(firstReview).toEqual({ version: 4, status: "proposed", approvalCount: 1 });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).review({
        id: decisionId,
        expectedVersion: 3,
        actorIdentityId: ids.manager2,
        verdict: "approve",
        selectedOptionId: decisionOptions[0].id,
        reason: "This request used a stale version.",
        chronicleEvent: event(ids.guild, ids.manager2, "decision.reviewed", decisionId),
      }))).rejects.toThrow("changed since it was loaded");

    const secondReview = await withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).review({
        id: decisionId,
        expectedVersion: 4,
        actorIdentityId: ids.manager2,
        verdict: "approve",
        selectedOptionId: decisionOptions[0].id,
        reason: "The escalation policy is ready for adoption.",
        chronicleEvent: event(ids.guild, ids.manager2, "decision.reviewed", decisionId),
      }));
    expect(secondReview).toEqual({ version: 5, status: "approved", approvalCount: 2 });

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE decision_approvals SET reason = 'Rewritten' WHERE guild_id = $1 AND decision_id = $2",
        [ids.guild, decisionId],
      );
    })).rejects.toThrow("append-only");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "DELETE FROM decision_approvals WHERE guild_id = $1 AND decision_id = $2",
        [ids.guild, decisionId],
      );
    })).rejects.toThrow("append-only");
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        "UPDATE decisions SET approval_count = 99, version = version + 1 WHERE guild_id = $1 AND id = $2",
        [ids.guild, decisionId],
      );
    })).rejects.toThrow("terminal Decision result is immutable");

    const crossBoundaryId = randomUUID();
    const crossBoundaryOptions = options();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildDecisionRepository(connection, ids.guild);
      await repository.createDecision({
        id: crossBoundaryId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.siblingSpace,
        title: "Sibling replacement policy",
        description: "This approved Decision belongs to a different security boundary.",
        rationale: "The database must reject this as a replacement for Team policy.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: null,
        options: crossBoundaryOptions,
        chronicleEvent: event(ids.guild, ids.root, "decision.created", crossBoundaryId),
      });
      await repository.propose({
        id: crossBoundaryId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        requiredApprovals: 1,
        chronicleEvent: event(ids.guild, ids.root, "decision.proposed", crossBoundaryId),
      });
      await repository.review({
        id: crossBoundaryId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        verdict: "approve",
        selectedOptionId: crossBoundaryOptions[0].id,
        reason: "Approve the sibling policy within its own boundary.",
        chronicleEvent: event(ids.guild, ids.root, "decision.reviewed", crossBoundaryId),
      });
    });
    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) =>
      new GuildDecisionRepository(connection, ids.guild).supersede({
        id: decisionId,
        replacementDecisionId: crossBoundaryId,
        expectedVersion: 5,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "decision.superseded", decisionId),
      }))).rejects.toThrow("preserve the original security boundary");

    const replacementId = randomUUID();
    const replacementOptions = options();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const repository = new GuildDecisionRepository(connection, ids.guild);
      await repository.createDecision({
        id: replacementId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Replace the incident escalation policy",
        description: "Adopt the revised incident escalation policy.",
        rationale: "The revision adds an after-hours escalation path.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: null,
        options: replacementOptions,
        chronicleEvent: event(ids.guild, ids.root, "decision.created", replacementId),
      });
      await repository.propose({
        id: replacementId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        requiredApprovals: 1,
        chronicleEvent: event(ids.guild, ids.root, "decision.proposed", replacementId),
      });
      await repository.review({
        id: replacementId,
        expectedVersion: 2,
        actorIdentityId: ids.root,
        verdict: "approve",
        selectedOptionId: replacementOptions[0].id,
        reason: "The revision is ready.",
        chronicleEvent: event(ids.guild, ids.root, "decision.reviewed", replacementId),
      });
      const supersededVersion = await repository.supersede({
        id: decisionId,
        replacementDecisionId: replacementId,
        expectedVersion: 5,
        actorIdentityId: ids.root,
        chronicleEvent: event(ids.guild, ids.root, "decision.superseded", decisionId),
      });
      expect(supersededVersion).toBe(6);
    });

    const finalEvidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const detail = await new GuildDecisionRepository(connection, ids.guild).getDetail(decisionId);
      const actions = await connection.query<{ action: string }>(
        "SELECT action FROM chronicle_events WHERE guild_id = $1 ORDER BY sequence",
        [ids.guild],
      );
      return { detail, actions: actions.rows.map((row) => row.action) };
    });
    expect(finalEvidence.detail.decision.status).toBe("superseded");
    expect(finalEvidence.detail.decision.supersededByDecisionId).toBe(replacementId);
    expect(finalEvidence.detail.approvals).toHaveLength(2);
    expect(finalEvidence.actions).toContain("decision.proposed");
    expect(finalEvidence.actions).toContain("decision.reviewed");
    expect(finalEvidence.actions).toContain("decision.superseded");

    await expect(withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `UPDATE decisions
            SET superseded_by_decision_id = $3, version = version + 1
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, decisionId, decisionId],
      );
    })).rejects.toThrow("terminal Decision result is immutable");
  });

  it("supports approval groups larger than twenty with one set-based notification write", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = await fixture();
    const additionalApprovers = Array.from({ length: 22 }, () => randomUUID());
    const bindingIds = additionalApprovers.map(() => randomUUID());
    const decisionId = randomUUID();

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         SELECT member.id, $2, 'human', 'Scale Approver ' || member.ordinality, 'active'
           FROM unnest($1::uuid[]) WITH ORDINALITY AS member(id, ordinality)`,
        [additionalApprovers, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         SELECT $2, member.id, 'active', 'internal', now()
           FROM unnest($1::uuid[]) AS member(id)`,
        [additionalApprovers, ids.guild],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         SELECT pair.binding_id, $3, pair.identity_id, $4, $5
           FROM unnest($1::uuid[], $2::uuid[]) AS pair(identity_id, binding_id)`,
        [additionalApprovers, bindingIds, ids.guild, ids.managerRole, ids.teamSpace],
      );
      const repository = new GuildDecisionRepository(connection, ids.guild);
      await repository.createDecision({
        id: decisionId,
        actorIdentityId: ids.root,
        ownerIdentityId: ids.root,
        spaceId: ids.teamSpace,
        title: "Approve the large-Guild operating model",
        description: "Verify that Decision governance scales beyond a twenty-person approver group.",
        rationale: "Approval group size must follow Guild policy rather than a demo-era limit.",
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        sourceIds: [],
        reviewAt: null,
        options: options(),
        chronicleEvent: event(ids.guild, ids.root, "decision.created", decisionId),
      });
      await repository.propose({
        id: decisionId,
        expectedVersion: 1,
        actorIdentityId: ids.root,
        requiredApprovals: 21,
        chronicleEvent: event(ids.guild, ids.root, "decision.proposed", decisionId),
      });
    });

    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const decision = await new GuildDecisionRepository(connection, ids.guild).getDecision(decisionId);
      const notifications = await connection.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM inbox_notifications
          WHERE guild_id = $1 AND resource_type = 'decision' AND resource_id = $2`,
        [ids.guild, decisionId],
      );
      return { decision, notificationCount: notifications.rows[0]?.count };
    });
    expect(evidence.decision.requiredApprovals).toBe(21);
    expect(evidence.notificationCount).toBe(25);
  });
});
