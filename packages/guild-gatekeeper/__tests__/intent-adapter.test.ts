import { describe, expect, it } from "vitest";
import type { Constitution } from "@guild-os/domain";
import type { IntentProposalDetail, StoredIntentAction } from "../src/intent-service.js";
import {
  intentEvidenceFromAsk,
  intentProposalForUi,
  type IntentProposalUiContext,
} from "../src/intent-adapter.js";

const IDS = {
  guild: "00000000-0000-4000-8000-000000000101",
  actor: "00000000-0000-4000-8000-000000000102",
  space: "00000000-0000-4000-8000-000000000103",
  proposal: "00000000-0000-4000-8000-000000000104",
  memory: "00000000-0000-4000-8000-000000000105",
  activity: "00000000-0000-4000-8000-000000000106",
  assignee: "00000000-0000-4000-8000-000000000107",
  decision: "00000000-0000-4000-8000-000000000108",
  agent: "00000000-0000-4000-8000-000000000109",
  run: "00000000-0000-4000-8000-000000000110",
};

const NOW = "2026-08-14T00:00:00.000Z";

function actionBase(position: number, riskLevel: 0 | 1 | 2 | 3) {
  return {
    guildId: IDS.guild,
    proposalId: IDS.proposal,
    position,
    riskLevel,
    status: "pending" as const,
    attemptCount: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    resourceType: null,
    resourceId: null,
    agentRunId: null,
    result: null,
    errorSummary: null,
    version: 1,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function proposal(expiresAt = "2026-08-15T00:00:00.000Z"): IntentProposalDetail {
  const actions: StoredIntentAction[] = [{
    ...actionBase(0, 1),
    kind: "memory.propose",
    action: {
      memoryId: IDS.memory,
      spaceId: IDS.space,
      request: { title: { en: "Draft the shared method" } },
    },
  }, {
    ...actionBase(1, 1),
    kind: "activity.create",
    action: {
      activityId: IDS.activity,
      spaceId: IDS.space,
      request: { title: "Verify the method" },
    },
  }, {
    ...actionBase(2, 1),
    kind: "activity.assign",
    action: {
      activityId: IDS.activity,
      assigneeActorId: IDS.assignee,
      expectedVersion: 1,
    },
  }, {
    ...actionBase(3, 1),
    kind: "decision.propose",
    action: {
      decisionId: IDS.decision,
      spaceId: IDS.space,
      request: { title: "Adopt the verified method" },
    },
  }, {
    ...actionBase(4, 2),
    kind: "agent.run",
    action: {
      agentRunId: IDS.run,
      agentActorId: IDS.agent,
      spaceId: IDS.space,
      request: { plan: { objective: "Publish the approved result" } },
    },
  }];
  return {
    id: IDS.proposal,
    guildId: IDS.guild,
    spaceId: IDS.space,
    createdByActorId: IDS.actor,
    locale: "en",
    objective: "Turn the approved method into governed work",
    status: "ready",
    actionCount: actions.length,
    evidence: [{
      sourceType: "memory",
      sourceId: IDS.memory,
      label: "Approved method",
      metadata: { version: 2 },
    }],
    maximumRiskLevel: 2,
    authorizationSnapshot: {
      actorId: IDS.actor,
      permissions: ["memory.create", "activity.create", "activity.assign", "decision.propose", "agent.run"],
      spaceIds: [IDS.space],
      constitutionVersion: 7,
      capturedAt: NOW,
    },
    requestHash: "a".repeat(64),
    expiresAt,
    completedAt: null,
    errorSummary: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    actions,
  };
}

function context(): IntentProposalUiContext {
  const constitution: Constitution = {
    guildId: IDS.guild,
    version: 7,
    level2ApprovalQuorum: 2,
    level3ApprovalQuorum: 3,
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
    agentPolicy: {
      level0Automatic: true,
      level1Automatic: false,
      level2HumanApproval: true,
      level3MultiHumanApproval: true,
    },
    updatedByIdentityId: IDS.actor,
    updatedAt: NOW,
  };
  return {
    constitution,
    actorNames: new Map([
      [IDS.assignee, "Human reviewer"],
      [IDS.agent, "Publishing Agent"],
    ]),
    activityNames: new Map([[IDS.activity, "Verify the method"]]),
  };
}

describe("intent management adapter presentation", () => {
  it("carries authorized Ask evidence without accepting client authority fields", () => {
    const evidence = intentEvidenceFromAsk({
      answer: "Use the approved method. [C1]",
      inferred: false,
      citations: [{
        resourceType: "memory",
        resourceId: IDS.memory,
        memoryId: IDS.memory,
        knowledgeId: IDS.memory,
        governed: true,
        version: 2,
        title: "Approved method",
        summary: "The current canonical method.",
        spaceId: IDS.space,
      }],
    });

    expect(evidence).toEqual([expect.objectContaining({
      sourceType: "memory",
      sourceId: IDS.memory,
      label: "Approved method",
      metadata: expect.objectContaining({ version: 2, governed: true }),
    })]);
    expect(JSON.stringify(evidence)).not.toContain("permissions");
    expect(JSON.stringify(evidence)).not.toContain("authority");
  });

  it("exposes every immutable action with risk, target, permission, approval, and retry state", () => {
    const ui = intentProposalForUi(proposal(), context(), new Date(NOW));

    expect(ui.actions).toHaveLength(5);
    expect(ui.actions.map((action) => action.kind)).toEqual([
      "memory.propose",
      "activity.create",
      "activity.assign",
      "decision.propose",
      "agent.run",
    ]);
    expect(ui.actions[2]).toMatchObject({
      resourceLabel: "Verify the method",
      agentName: "Human reviewer",
      requiredPermission: "activity.assign",
      explicitConfirmationRequired: true,
      attemptCount: 0,
      estimatedCostMinor: 0,
      effectScope: "guild",
      rollbackKind: "reversible",
    });
    expect(ui.actions[4]).toMatchObject({
      riskLevel: 2,
      agentName: "Publishing Agent",
      durableHumanApprovals: 2,
      reauthenticationRequired: false,
      requiredPermission: "agent.run",
      executingActorId: IDS.agent,
      estimatedCostMinor: null,
      estimatedDurationSeconds: null,
      effectScope: "guild",
      rollbackKind: "compensating_action",
    });
    expect(ui.nextActionPosition).toBe(0);
    expect(ui.canAct).toBe(true);
  });

  it("fails the display closed once a nonterminal proposal passes its immutable expiry", () => {
    const ui = intentProposalForUi(
      proposal("2026-08-13T23:59:59.000Z"),
      context(),
      new Date(NOW),
    );

    expect(ui.status).toBe("expired");
    expect(ui.canAct).toBe(false);
  });
});
