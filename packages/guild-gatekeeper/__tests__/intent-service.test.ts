import { describe, expect, it, vi } from "vitest";
import type { Permission } from "@guild-os/domain";
import {
  GuildIntentService,
  IntentActionExecutionError,
  createModelIntentPlanner,
  type ActIntentInput,
  type IntentActAuthority,
  type IntentAuthorityPort,
  type IntentExecutionPorts,
  type IntentPlanAuthority,
  type IntentProposalDetail,
  type IntentProposalStore,
  type PlanFromAskInput,
  type StoredIntentAction,
} from "../src/intent-service.js";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const IDS = {
  guild: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  space: "00000000-0000-4000-8000-000000000003",
  proposal: "00000000-0000-4000-8000-000000000004",
  agent: "00000000-0000-4000-8000-000000000005",
  workflow: "00000000-0000-4000-8000-000000000006",
};

type CreateProposalInput = Parameters<IntentProposalStore["createProposal"]>[0];
type ClaimInput = Parameters<IntentProposalStore["claimNextAction"]>[0];
type RequeueInput = Parameters<IntentProposalStore["requeueAction"]>[0];
type SucceedInput = Parameters<IntentProposalStore["succeedAction"]>[0];
type FailInput = Parameters<IntentProposalStore["failAction"]>[0];
type StageInput = Parameters<IntentProposalStore["stageAgentAction"]>[0];
type ReconcileInput = Parameters<IntentProposalStore["reconcileStagedAgentRun"]>[0];

function storedAction(
  input: CreateProposalInput["actions"][number],
  guildId: string,
  proposalId: string,
  position: number,
): StoredIntentAction {
  const common = {
    guildId,
    proposalId,
    position,
    riskLevel: input.riskLevel,
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  switch (input.kind) {
    case "memory.propose": return { ...common, kind: input.kind, action: input.action };
    case "activity.create": return { ...common, kind: input.kind, action: input.action };
    case "activity.assign": return { ...common, kind: input.kind, action: input.action };
    case "decision.propose": return { ...common, kind: input.kind, action: input.action };
    case "agent.run": return { ...common, kind: input.kind, action: input.action };
  }
}

function replaceAction(
  proposal: IntentProposalDetail,
  position: number,
  replacement: StoredIntentAction,
): IntentProposalDetail {
  return {
    ...proposal,
    actions: proposal.actions.map((action) => action.position === position ? replacement : action),
    version: proposal.version + 1,
    updatedAt: NOW.toISOString(),
  };
}

class FakeIntentStore implements IntentProposalStore {
  readonly guildId: string;
  proposal: IntentProposalDetail | null = null;
  agentTerminalState: "running" | "succeeded" | "failed" = "running";
  readonly chronicleActions: string[] = [];

  constructor(guildId: string) {
    this.guildId = guildId;
  }

  async findProposal(
    id: string,
    access: Parameters<IntentProposalStore["findProposal"]>[1],
  ): Promise<IntentProposalDetail | null> {
    if (!this.proposal || this.proposal.id !== id ||
        this.proposal.createdByActorId !== access.actorId) return null;
    return this.proposal;
  }

  async createProposal(input: CreateProposalInput) {
    if (this.proposal) return { created: false, proposal: this.proposal };
    const maximumRiskLevel = Math.max(...input.actions.map((action) => action.riskLevel)) as 0 | 1 | 2 | 3;
    this.proposal = {
      id: input.id,
      guildId: this.guildId,
      spaceId: input.spaceId,
      createdByActorId: input.createdByActorId,
      locale: input.locale,
      objective: input.objective,
      status: "ready",
      actionCount: input.actions.length,
      evidence: input.evidence,
      maximumRiskLevel,
      authorizationSnapshot: input.authorizationSnapshot,
      requestHash: input.requestHash,
      expiresAt: input.expiresAt,
      completedAt: null,
      errorSummary: null,
      version: 1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      actions: input.actions.map((action, position) =>
        storedAction(action, this.guildId, input.id, position)),
    };
    this.chronicleActions.push(input.chronicleEvent.action);
    return { created: true, proposal: this.proposal };
  }

  async claimNextAction(input: ClaimInput) {
    const proposal = this.#requireProposal(input.proposalId);
    if (proposal.status === "expired") return { state: "expired" as const, proposal };
    const action = proposal.actions.find((candidate) =>
      candidate.status === "pending" && proposal.actions
        .filter((prior) => prior.position < candidate.position)
        .every((prior) => prior.status === "succeeded"));
    if (!action) return { state: "empty" as const, proposal };
    const claimed = {
      ...action,
      status: "processing" as const,
      attemptCount: action.attemptCount + 1,
      leaseToken: input.leaseToken,
      leaseExpiresAt: new Date(NOW.valueOf() + input.leaseSeconds * 1_000).toISOString(),
      startedAt: action.startedAt ?? NOW.toISOString(),
      version: action.version + 1,
    } as StoredIntentAction;
    this.proposal = {
      ...replaceAction(proposal, action.position, claimed),
      status: "executing",
    };
    this.chronicleActions.push(input.chronicleEvent.action);
    return { state: "claimed" as const, proposal: this.proposal, action: claimed };
  }

  async requeueAction(input: RequeueInput): Promise<StoredIntentAction> {
    const { proposal, action } = this.#leased(input.proposalId, input.position, input.leaseToken);
    const requeued = {
      ...action,
      status: "pending" as const,
      leaseToken: null,
      leaseExpiresAt: null,
      errorSummary: input.errorSummary,
      version: action.version + 1,
    } as StoredIntentAction;
    this.proposal = replaceAction(proposal, action.position, requeued);
    this.chronicleActions.push(input.chronicleEvent.action);
    return requeued;
  }

  async succeedAction(input: SucceedInput): Promise<IntentProposalDetail> {
    const { proposal, action } = this.#leased(input.proposalId, input.position, input.leaseToken);
    const succeeded = {
      ...action,
      status: "succeeded" as const,
      leaseToken: null,
      leaseExpiresAt: null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result,
      finishedAt: NOW.toISOString(),
      version: action.version + 1,
    } as StoredIntentAction;
    let updated = replaceAction(proposal, action.position, succeeded);
    if (updated.actions.every((candidate) => candidate.status === "succeeded")) {
      updated = { ...updated, status: "completed", completedAt: NOW.toISOString() };
    }
    this.proposal = updated;
    this.chronicleActions.push(input.chronicleEvent.action);
    return updated;
  }

  async failAction(input: FailInput): Promise<IntentProposalDetail> {
    const { proposal, action } = this.#leased(input.proposalId, input.position, input.leaseToken);
    const actions = proposal.actions.map((candidate): StoredIntentAction => {
      if (candidate.position === action.position) {
        return {
          ...candidate,
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          errorSummary: input.errorSummary,
          finishedAt: NOW.toISOString(),
          version: candidate.version + 1,
        } as StoredIntentAction;
      }
      if (candidate.position > action.position && ["pending", "processing", "staged"].includes(candidate.status)) {
        return {
          ...candidate,
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          finishedAt: NOW.toISOString(),
          version: candidate.version + 1,
        } as StoredIntentAction;
      }
      return candidate;
    });
    this.proposal = {
      ...proposal,
      status: "failed",
      actions,
      errorSummary: input.errorSummary,
      completedAt: NOW.toISOString(),
      version: proposal.version + 1,
    };
    this.chronicleActions.push(input.chronicleEvent.action);
    return this.proposal;
  }

  async stageAgentAction(input: StageInput): Promise<StoredIntentAction> {
    const { proposal, action } = this.#leased(input.proposalId, input.position, input.leaseToken);
    if (action.kind !== "agent.run") throw new Error("Expected Agent action.");
    const staged: StoredIntentAction = {
      ...action,
      status: "staged",
      leaseToken: null,
      leaseExpiresAt: null,
      resourceType: "agent_run",
      resourceId: input.agentRunId,
      agentRunId: input.agentRunId,
      version: action.version + 1,
    };
    this.proposal = replaceAction(proposal, action.position, staged);
    this.chronicleActions.push(input.chronicleEvent.action);
    return staged;
  }

  async reconcileStagedAgentRun(input: ReconcileInput) {
    const proposal = this.#requireProposal(input.proposalId);
    const action = proposal.actions[input.position];
    if (!action || action.kind !== "agent.run" || action.status !== "staged") {
      throw new Error("Expected staged Agent action.");
    }
    if (this.agentTerminalState === "running") {
      return { state: "pending" as const, proposal, action };
    }
    if (this.agentTerminalState === "failed") {
      const failed: StoredIntentAction = {
        ...action,
        status: "failed",
        errorSummary: "Agent run failed.",
        finishedAt: NOW.toISOString(),
        version: action.version + 1,
      };
      this.proposal = {
        ...replaceAction(proposal, action.position, failed),
        status: "failed",
        completedAt: NOW.toISOString(),
        errorSummary: "Agent run failed.",
      };
      this.chronicleActions.push(input.chronicleEvent.action);
      return { state: "failed" as const, proposal: this.proposal, action: failed };
    }
    const succeeded: StoredIntentAction = {
      ...action,
      status: "succeeded",
      result: { agentRunId: action.action.agentRunId, runStatus: "succeeded" },
      finishedAt: NOW.toISOString(),
      version: action.version + 1,
    };
    const updated = replaceAction(proposal, action.position, succeeded);
    this.proposal = updated.actions.every((candidate) => candidate.status === "succeeded")
      ? { ...updated, status: "completed", completedAt: NOW.toISOString() }
      : updated;
    this.chronicleActions.push(input.chronicleEvent.action);
    return { state: "succeeded" as const, proposal: this.proposal, action: succeeded };
  }

  #requireProposal(id: string): IntentProposalDetail {
    if (!this.proposal || this.proposal.id !== id) throw new Error("Proposal not found.");
    return this.proposal;
  }

  #leased(proposalId: string, position: number, token: string) {
    const proposal = this.#requireProposal(proposalId);
    const action = proposal.actions[position];
    if (!action || action.status !== "processing" || action.leaseToken !== token) {
      throw new Error("Lease lost.");
    }
    return { proposal, action };
  }
}

class FakeAuthority implements IntentAuthorityPort {
  permissions: Permission[] = ["memory.create", "activity.create", "agent.run"];
  actionAuthorized = true;
  approvalStatus: IntentActAuthority["approval"] extends infer T
    ? T extends { status: infer S } ? S : never
    : never = "approved";

  async loadPlanAuthority(input: PlanFromAskInput): Promise<IntentPlanAuthority> {
    return {
      revision: "authority-1",
      guildId: input.guildId,
      actorId: input.actorId,
      actorActive: true,
      membershipOperational: true,
      permissions: this.permissions,
      spaceIds: [IDS.space],
      constitutionVersion: 1,
      capturedAt: NOW.toISOString(),
    };
  }

  async authorizePlannedAction(): Promise<boolean> {
    return this.actionAuthorized;
  }

  async loadActAuthority(input: Parameters<IntentAuthorityPort["loadActAuthority"]>[0]): Promise<IntentActAuthority> {
    return {
      revision: "authority-1",
      guildId: input.proposal.guildId,
      actorId: input.actorId,
      actorActive: true,
      membershipOperational: true,
      permissions: this.permissions,
      spaceIds: [IDS.space],
      constitutionVersion: 1,
      actionAuthorized: this.actionAuthorized,
      approval: {
        proposalId: input.proposal.id,
        requestHash: input.proposal.requestHash,
        status: this.approvalStatus,
        approvedRiskLevel: 3,
        constitutionVersion: 1,
        revision: "approval-1",
        expiresAt: "2026-08-15T00:00:00.000Z",
      },
    };
  }
}

function memoryRequest(title: string) {
  return {
    spaceId: IDS.space,
    type: "agent_output",
    title: { en: title },
    summary: { en: `Summary for ${title}` },
    body: { en: `Body for ${title}` },
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    sourceIds: [],
    confidence: null,
    custody: "guild",
    layer: "working",
    provenance: { source: "intent-test" },
    lastVerifiedAt: null,
    changeNote: "Create an inspectable draft.",
  };
}

function memoryModelPlan(titles: readonly string[]): unknown {
  return {
    actions: titles.map((title) => ({
      kind: "memory.propose",
      riskLevel: 1,
      request: memoryRequest(title),
    })),
  };
}

function agentModelPlan(): unknown {
  return {
    actions: [{
      kind: "agent.run",
      riskLevel: 1,
      agentActorId: IDS.agent,
      request: {
        spaceId: IDS.space,
        plan: {
          objective: "Draft a review Activity",
          expectedOutcome: "One review Activity draft exists.",
          steps: ["Create the bounded draft"],
          connectorId: null,
          questId: null,
          action: {
            kind: "activity_draft",
            title: "Review the Plan",
            description: "Review the Agent result.",
            activityType: "task",
          },
          estimatedUsage: {
            budgetMinor: 0,
            tokens: 100,
            durationSeconds: 10,
            steps: 1,
            retries: 0,
            delegationDepth: 0,
          },
        },
        visibility: "space",
        classification: "internal",
        allowedIdentityIds: [],
        workflowPermissions: ["activity.create"],
        workflowDefinitionId: IDS.workflow,
      },
    }],
  };
}

function planInput(overrides: Partial<PlanFromAskInput> = {}): PlanFromAskInput {
  return {
    mode: "plan",
    requestId: IDS.proposal,
    guildId: IDS.guild,
    actorId: IDS.actor,
    spaceId: IDS.space,
    locale: "en",
    objective: "Turn the Ask result into an inspectable draft",
    ask: {
      query: "What should the new handbook contain?",
      answer: "Use the approved opening checklist and explain each handoff.",
      evidence: [{
        sourceType: "memory",
        sourceId: "00000000-0000-4000-8000-000000000010",
        label: "Opening checklist",
        metadata: { version: 2 },
      }],
    },
    allowedActionKinds: ["memory.propose", "activity.create", "agent.run"],
    availableAgents: [{ actorId: IDS.agent, displayName: "Draft Agent", spaceIds: [IDS.space] }],
    ...overrides,
  };
}

function actInput(overrides: Partial<ActIntentInput> = {}): ActIntentInput {
  return {
    mode: "act",
    guildId: IDS.guild,
    actorId: IDS.actor,
    proposalId: IDS.proposal,
    ...overrides,
  };
}

interface HarnessOptions {
  plannerResult?: unknown;
  plannerFailure?: unknown;
  maxAttempts?: number;
}

function harness(options: HarnessOptions = {}) {
  const store = new FakeIntentStore(IDS.guild);
  const authority = new FakeAuthority();
  const planner = {
    plan: vi.fn(async () => {
      if (options.plannerFailure !== undefined) throw options.plannerFailure;
      return options.plannerResult ?? memoryModelPlan(["Opening handbook"]);
    }),
  };
  const ports: IntentExecutionPorts = {
    memory: {
      propose: vi.fn(async (input) => ({ resourceId: input.resourceId, result: { created: true } })),
    },
    activity: {
      create: vi.fn(async (input) => ({ resourceId: input.resourceId, result: { created: true } })),
      assign: vi.fn(async (input) => ({ resourceId: input.resourceId, result: { version: 2 } })),
    },
    decision: {
      propose: vi.fn(async (input) => ({ resourceId: input.resourceId, result: { proposed: true } })),
    },
    agent: {
      createGovernedRun: vi.fn(async (input) => input.requestId),
    },
  };
  const service = new GuildIntentService(store, authority, ports, {
    planner,
    plannerTimeoutMs: 1_000,
    defaultProposalTtlSeconds: 3_600,
    defaultLeaseSeconds: 60,
    maxAttempts: options.maxAttempts ?? 3,
    now: () => NOW,
  });
  return { service, store, authority, planner, ports };
}

describe("GuildIntentService", () => {
  it("requests schema-bound Workers AI output and includes the safe Memory example", async () => {
    const runner = vi.fn(async () => memoryModelPlan(["Schema-bound output"]));
    const planner = createModelIntentPlanner(runner);

    await planner.plan({
      objective: "Preserve the onboarding answer for review.",
      locale: "en",
      ask: planInput().ask,
      spaceId: IDS.space,
      allowedActionKinds: ["memory.propose", "agent.run"],
      availableAgents: [{ actorId: IDS.agent, displayName: "Review Agent", spaceIds: [IDS.space] }],
    }, new AbortController().signal);

    const request = runner.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(request).toMatchObject({
      max_tokens: 2_048,
      response_format: {
        type: "json_schema",
        json_schema: {
          required: ["actions"],
          additionalProperties: false,
        },
      },
    });
    const messages = request.messages as Array<{ role: string; content: string }>;
    const userInput = JSON.parse(messages[1]?.content ?? "{}") as {
      constraints?: { safeMemoryFallback?: { kind?: string; request?: { layer?: string } } };
    };
    expect(userInput.constraints?.safeMemoryFallback).toMatchObject({
      kind: "memory.propose",
      request: { layer: "working" },
    });

    const responseFormat = request.response_format as {
      json_schema?: {
        properties?: {
          actions?: {
            items?: { oneOf?: Array<{ properties?: { request?: { required?: string[] } } }> };
          };
        };
      };
    };
    const actionSchemas = responseFormat.json_schema?.properties?.actions?.items?.oneOf ?? [];
    const memorySchema = actionSchemas.find((schema) =>
      schema.properties?.request?.required?.includes("changeNote"));
    expect(memorySchema?.properties?.request?.required).toEqual(expect.arrayContaining([
      "spaceId",
      "type",
      "title",
      "summary",
      "body",
      "visibility",
      "classification",
      "layer",
      "changeNote",
    ]));
  });

  it("describes every required Activity create field in the model response schema", async () => {
    const runner = vi.fn(async () => memoryModelPlan(["Schema-bound output"]));
    const planner = createModelIntentPlanner(runner);

    await planner.plan({
      objective: "Create one internal Activity draft.",
      locale: "en",
      ask: planInput().ask,
      spaceId: IDS.space,
      allowedActionKinds: ["activity.create"],
      availableAgents: [],
    }, new AbortController().signal);

    const request = runner.mock.calls[0]?.[1] as {
      response_format?: {
        json_schema?: {
          properties?: {
            actions?: { items?: { properties?: { request?: { required?: string[] } } } };
          };
        };
      };
    };
    expect(request.response_format?.json_schema?.properties?.actions?.items?.properties?.request?.required)
      .toEqual([
        "parentActivityId",
        "spaceId",
        "assigneeActorId",
        "type",
        "title",
        "description",
        "status",
        "visibility",
        "classification",
        "allowedActorIds",
        "sourceIds",
        "startsAt",
        "dueAt",
        "position",
      ]);
  });

  it("rejects an unsupported model action without persisting or executing it", async () => {
    const { service, store, ports } = harness({
      plannerResult: { actions: [{ kind: "shell.exec", riskLevel: 3, request: {} }] },
    });

    await expect(service.planFromAsk(planInput())).rejects.toMatchObject({
      code: "invalid_plan",
    });
    expect(store.proposal).toBeNull();
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("uses a deterministic Memory proposal when the configured planner is unavailable", async () => {
    const { service, store, ports } = harness({ plannerFailure: new Error("model offline") });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
  });

  it("uses a deterministic Memory proposal when the model returns no actions", async () => {
    const { service, store, ports } = harness({ plannerResult: { actions: [] } });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("unwraps a structured Workers AI JSON Mode response", async () => {
    const { service, store, ports } = harness({
      plannerResult: { response: memoryModelPlan(["Wrapped output"]), usage: { total_tokens: 10 } },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "model" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
  });

  it("uses the safe fallback for an empty structured Workers AI response", async () => {
    const { service, store, ports } = harness({
      plannerResult: { response: { actions: [] }, usage: { total_tokens: 10 } },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("uses the safe fallback when a supported model action omits its request envelope", async () => {
    const { service, store, ports } = harness({
      plannerResult: {
        response: {
          actions: [{
            kind: "memory.propose",
            riskLevel: 1,
            title: "Fields were placed outside request",
          }],
        },
      },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("uses the safe fallback when JSON Mode returns non-JSON text", async () => {
    const { service, store, ports } = harness({
      plannerResult: { response: "JSON Mode could not produce a valid response." },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("uses the safe fallback for a malformed request inside a known action envelope", async () => {
    const { service, store, ports } = harness({
      plannerResult: {
        actions: [{ kind: "memory.propose", riskLevel: 1, request: {} }],
      },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("uses the safe fallback for a malformed Agent request inside a known action envelope", async () => {
    const { service, store, ports } = harness({
      plannerResult: {
        actions: [{
          kind: "agent.run",
          riskLevel: 1,
          agentActorId: IDS.agent,
          request: {},
        }],
      },
    });

    const result = await service.planFromAsk(planInput());

    expect(result).toMatchObject({ created: true, source: "deterministic_fallback" });
    expect(result.proposal.actions).toHaveLength(1);
    expect(result.proposal.actions[0]).toMatchObject({ kind: "memory.propose", status: "pending" });
    expect(store.chronicleActions).toEqual(["intent.proposal.created"]);
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("rejects a malformed model proposal instead of hiding it behind a fallback", async () => {
    const { service, store, ports } = harness({ plannerResult: { summary: "No action shape" } });

    await expect(service.planFromAsk(planInput())).rejects.toMatchObject({
      code: "invalid_plan",
    });
    expect(store.proposal).toBeNull();
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(ports.agent.createGovernedRun).not.toHaveBeenCalled();
  });

  it("rechecks current authority and fails closed when permission changed after Plan", async () => {
    const { service, store, authority, ports } = harness();
    await service.planFromAsk(planInput());
    authority.permissions = [];

    const outcome = await service.actOnce(actInput());

    expect(outcome).toMatchObject({ status: "failed", errorCode: "permission_lost" });
    expect(store.proposal?.actions[0]?.status).toBe("failed");
    expect(ports.memory.propose).not.toHaveBeenCalled();
    expect(store.chronicleActions).toContain("intent.action.failed");
  });

  it("allows only one execution when two Act calls race for the same action", async () => {
    const { service, ports } = harness();
    await service.planFromAsk(planInput());
    let signalStarted: (() => void) | undefined;
    let releaseExecution: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseExecution = resolve; });
    vi.mocked(ports.memory.propose).mockImplementationOnce(async (input) => {
      signalStarted?.();
      await release;
      return { resourceId: input.resourceId, result: { created: true } };
    });

    const first = service.actOnce(actInput({
      leaseToken: "00000000-0000-4000-8000-000000000020",
    }));
    await started;
    const second = await service.actOnce(actInput({
      leaseToken: "00000000-0000-4000-8000-000000000021",
    }));
    expect(second).toEqual({ status: "busy", proposalId: IDS.proposal });
    releaseExecution?.();
    await expect(first).resolves.toMatchObject({ status: "completed" });
    expect(ports.memory.propose).toHaveBeenCalledTimes(1);
    expect(ports.memory.propose).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringContaining(`intent:${IDS.guild}:${IDS.proposal}:0:`),
    }));
  });

  it("keeps prior success and fails the remaining Plan after a partial failure", async () => {
    const { service, store, ports } = harness({
      plannerResult: memoryModelPlan(["First draft", "Second draft"]),
    });
    await service.planFromAsk(planInput());
    vi.mocked(ports.memory.propose)
      .mockResolvedValueOnce({
        resourceId: store.proposal?.actions[0]?.kind === "memory.propose"
          ? store.proposal.actions[0].action.memoryId
          : "",
        result: { created: true },
      })
      .mockRejectedValueOnce(new IntentActionExecutionError(
        "validation_rejected",
        "Draft did not pass the current validator.",
        false,
      ));

    await expect(service.actOnce(actInput())).resolves.toMatchObject({ status: "action_succeeded", position: 0 });
    await expect(service.actOnce(actInput())).resolves.toMatchObject({
      status: "failed",
      errorCode: "validation_rejected",
    });
    expect(store.proposal?.actions.map((action) => action.status)).toEqual(["succeeded", "failed"]);
    expect(store.proposal?.status).toBe("failed");
  });

  it("requeues retryable failures only up to the configured durable attempt limit", async () => {
    const { service, store, ports } = harness({ maxAttempts: 2 });
    await service.planFromAsk(planInput());
    vi.mocked(ports.memory.propose).mockRejectedValue(new IntentActionExecutionError(
      "dependency_timeout",
      "Temporary dependency timeout.",
      true,
    ));

    await expect(service.actOnce(actInput())).resolves.toMatchObject({
      status: "retry_scheduled",
      attempt: 1,
      errorCode: "dependency_timeout",
    });
    await expect(service.actOnce(actInput())).resolves.toMatchObject({
      status: "failed",
      errorCode: "dependency_timeout",
    });
    expect(store.proposal?.status).toBe("failed");
    expect(ports.memory.propose).toHaveBeenCalledTimes(2);
  });

  it("stages an Agent action through the governed port and later reconciles completion", async () => {
    const { service, store, ports } = harness({ plannerResult: agentModelPlan() });
    await service.planFromAsk(planInput({ allowedActionKinds: ["agent.run"] }));

    const staged = await service.actOnce(actInput());
    expect(staged).toMatchObject({ status: "agent_staged", position: 0 });
    expect(ports.agent.createGovernedRun).toHaveBeenCalledWith(expect.objectContaining({
      agentIdentityId: IDS.agent,
      riskLevel: 1,
      origin: "plan",
      workflowDefinitionId: IDS.workflow,
    }));
    expect(store.proposal?.actions[0]?.status).toBe("staged");

    await expect(service.actOnce(actInput())).resolves.toEqual({
      status: "agent_waiting",
      proposalId: IDS.proposal,
      position: 0,
    });
    store.agentTerminalState = "succeeded";
    await expect(service.actOnce(actInput())).resolves.toMatchObject({ status: "completed" });
    expect(store.proposal?.status).toBe("completed");
    expect(store.chronicleActions).toContain("intent.action.reconciled");
  });
});
