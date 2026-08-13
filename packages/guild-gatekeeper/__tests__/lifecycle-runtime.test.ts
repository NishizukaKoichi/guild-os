import { describe, expect, it } from "vitest";
import {
  GuildLifecycleRuntime,
  buildCanonicalMemoryReconfirmationPlan,
  buildOnboardingPlan,
  type ActorOnboardingSnapshot,
  type CanonicalMemoryAudienceSnapshot,
  type CanonicalMemoryRequirementSource,
  type ConnectionRevocationResult,
  type HandoverCreationResult,
  type InitialActivityRequirementSource,
  type LifecycleActorSnapshot,
  type LifecycleAtomicScope,
  type LifecycleChronicleEvent,
  type LifecycleRepository,
  type LifecycleRequirement,
  type LifecycleTransaction,
  type OffboardingPlan,
  type OffboardingReceipt,
  type OffboardingSeal,
  type OffboardingSnapshot,
} from "../src/lifecycle-runtime.js";

const NOW = "2026-08-14T04:00:00.000Z";
const IDS = {
  guild: "guild-1",
  manager: "actor-manager",
  human: "actor-human",
  agent: "actor-agent",
  successor: "actor-successor",
  other: "actor-other",
  roleStaff: "role-staff",
  roleManager: "role-manager",
  spaceA: "space-a",
  spaceB: "space-b",
  memoryA: "memory-a",
};

const CHRONICLE = {
  performedByActorId: IDS.manager,
  correlationId: "correlation-1",
  occurredAt: NOW,
  reason: "Lifecycle policy reconciliation",
  source: "lifecycle-test",
} as const;

function actor(
  overrides: Partial<LifecycleActorSnapshot> = {},
): LifecycleActorSnapshot {
  return {
    guildId: IDS.guild,
    actorId: IDS.human,
    kind: "human",
    identityOperational: true,
    membershipState: "joined",
    membershipOperational: true,
    lifecycleEpoch: 1,
    templateKey: "company",
    roleBindings: [{ roleId: IDS.roleStaff, spaceId: IDS.spaceA }],
    isRootOwner: false,
    ...overrides,
  };
}

function memory(
  overrides: Partial<CanonicalMemoryRequirementSource> = {},
): CanonicalMemoryRequirementSource {
  return {
    memoryId: IDS.memoryA,
    version: 1,
    title: "Safety manual",
    instructions: "Read and confirm the current version.",
    spaceId: IDS.spaceA,
    status: "active",
    layer: "canonical",
    governanceState: "canonical",
    applicability: {
      actorKinds: ["human", "agent"],
      templateKeys: ["company"],
      roleIds: [IDS.roleStaff],
    },
    ...overrides,
  };
}

function activity(
  overrides: Partial<InitialActivityRequirementSource> = {},
): InitialActivityRequirementSource {
  return {
    definitionKey: "first-shift",
    templateKey: "company",
    templateVersion: 3,
    title: "Complete the first shift checklist",
    instructions: "Work through the checklist with your manager.",
    activityType: "task",
    spaceId: IDS.spaceA,
    applicability: {
      actorKinds: ["human", "agent"],
      templateKeys: ["company"],
      roleIds: [IDS.roleStaff],
    },
    ...overrides,
  };
}

function onboardingSnapshot(
  overrides: Partial<ActorOnboardingSnapshot> = {},
): ActorOnboardingSnapshot {
  return {
    actor: actor(),
    canonicalMemories: [memory()],
    initialActivities: [activity()],
    existingRequirementKeys: [],
    ...overrides,
  };
}

function offboardingSnapshot(
  overrides: Partial<OffboardingSnapshot> = {},
): OffboardingSnapshot {
  return {
    actor: actor({ membershipState: "active" }),
    successor: actor({
      actorId: IDS.successor,
      membershipState: "active",
      roleBindings: [{ roleId: IDS.roleManager, spaceId: null }],
    }),
    accessTokenIds: ["token-1", "token-2"],
    connectorCredentialIds: ["credential-1"],
    scheduledRunIds: ["schedule-1"],
    activeAgentRunIds: ["run-1", "run-2"],
    pendingApprovalIds: ["approval-1"],
    openActivities: [{ resourceId: "activity-1", title: "Open work" }],
    ownedFiles: [{ resourceId: "file-1", title: "Owned file" }],
    governedDrafts: [
      { resourceId: "draft-1", title: "Draft policy", resourceType: "memory" },
      { resourceId: "draft-2", title: "Draft decision", resourceType: "decision" },
    ],
    ...overrides,
  };
}

type FailureStep = "stopActorAccess" | "revokeActorConnections" | "stopActorSchedules" |
  "killActorRuns" | "expireActorApprovals" | "createHandover" |
  "inspectOffboardingSeal" | "appendChronicle" | "saveOffboardingReceipt";

interface FakeState {
  requirementKeys: Set<string>;
  chronicleEvents: Map<string, LifecycleChronicleEvent>;
  receipts: Map<string, OffboardingReceipt>;
  identityOperational: boolean;
  membershipOperational: boolean;
  agentOperational: boolean;
  activeTokens: Set<string>;
  activeConnectorCredentials: Set<string>;
  activeSchedules: Set<string>;
  activeRuns: Set<string>;
  pendingApprovals: Set<string>;
  handoverItems: Set<string>;
  handoverId: string | null;
}

interface FakeRepositoryOptions {
  onboarding?: ActorOnboardingSnapshot;
  audience?: CanonicalMemoryAudienceSnapshot;
  offboarding?: OffboardingSnapshot;
  failAt?: FailureStep;
}

interface FakeStateView {
  requirementKeys: readonly string[];
  chronicleEvents: readonly LifecycleChronicleEvent[];
  receipts: readonly OffboardingReceipt[];
  identityOperational: boolean;
  membershipOperational: boolean;
  agentOperational: boolean;
  activeTokens: readonly string[];
  activeConnectorCredentials: readonly string[];
  activeSchedules: readonly string[];
  activeRuns: readonly string[];
  pendingApprovals: readonly string[];
  handoverItems: readonly string[];
  handoverId: string | null;
}

function sorted(values: Iterable<string>): readonly string[] {
  return [...values].sort();
}

function removeAll(target: Set<string>, values: readonly string[]): readonly string[] {
  const removed: string[] = [];
  for (const value of values) {
    if (target.delete(value)) removed.push(value);
  }
  return removed.sort();
}

function cloneFakeState(state: FakeState): FakeState {
  return {
    requirementKeys: new Set(state.requirementKeys),
    chronicleEvents: new Map(
      [...state.chronicleEvents].map(([key, event]) => [key, { ...event }]),
    ),
    receipts: new Map(
      [...state.receipts].map(([key, receipt]) => [key, { ...receipt }]),
    ),
    identityOperational: state.identityOperational,
    membershipOperational: state.membershipOperational,
    agentOperational: state.agentOperational,
    activeTokens: new Set(state.activeTokens),
    activeConnectorCredentials: new Set(state.activeConnectorCredentials),
    activeSchedules: new Set(state.activeSchedules),
    activeRuns: new Set(state.activeRuns),
    pendingApprovals: new Set(state.pendingApprovals),
    handoverItems: new Set(state.handoverItems),
    handoverId: state.handoverId,
  };
}

class FakeLifecycleTransaction implements LifecycleTransaction {
  readonly #state: FakeState;
  readonly #options: FakeRepositoryOptions;
  readonly #attempt: (step: string) => void;

  constructor(
    state: FakeState,
    options: FakeRepositoryOptions,
    attempt: (step: string) => void,
  ) {
    this.#state = state;
    this.#options = options;
    this.#attempt = attempt;
  }

  #step(step: FailureStep): void {
    this.#attempt(step);
    if (this.#options.failAt === step) throw new Error(`Injected failure at ${step}`);
  }

  async loadActorOnboarding(actorId: string): Promise<ActorOnboardingSnapshot> {
    this.#attempt("loadActorOnboarding");
    const snapshot = this.#options.onboarding;
    if (!snapshot || snapshot.actor.actorId !== actorId) throw new Error("Onboarding fixture missing.");
    return { ...snapshot, existingRequirementKeys: sorted(this.#state.requirementKeys) };
  }

  async loadCanonicalMemoryAudience(memoryId: string): Promise<CanonicalMemoryAudienceSnapshot> {
    this.#attempt("loadCanonicalMemoryAudience");
    const snapshot = this.#options.audience;
    if (!snapshot || snapshot.memory.memoryId !== memoryId) {
      throw new Error("Memory audience fixture missing.");
    }
    return { ...snapshot, existingRequirementKeys: sorted(this.#state.requirementKeys) };
  }

  async ensureOnboardingRequirements(
    requirements: readonly LifecycleRequirement[],
  ): Promise<readonly string[]> {
    this.#attempt("ensureOnboardingRequirements");
    const inserted: string[] = [];
    for (const requirement of requirements) {
      if (!this.#state.requirementKeys.has(requirement.idempotencyKey)) {
        this.#state.requirementKeys.add(requirement.idempotencyKey);
        inserted.push(requirement.idempotencyKey);
      }
    }
    await Promise.resolve();
    return inserted;
  }

  async loadOffboarding(
    actorId: string,
    successorActorId: string | null,
  ): Promise<OffboardingSnapshot> {
    this.#attempt("loadOffboarding");
    const snapshot = this.#options.offboarding;
    if (!snapshot || snapshot.actor.actorId !== actorId ||
        snapshot.successor?.actorId !== successorActorId) {
      throw new Error("Offboarding fixture missing.");
    }
    return {
      ...snapshot,
      actor: {
        ...snapshot.actor,
        identityOperational: this.#state.identityOperational,
        membershipOperational: this.#state.membershipOperational,
        membershipState: this.#state.membershipOperational ? snapshot.actor.membershipState : "left",
      },
      accessTokenIds: sorted(this.#state.activeTokens),
      connectorCredentialIds: sorted(this.#state.activeConnectorCredentials),
      scheduledRunIds: sorted(this.#state.activeSchedules),
      activeAgentRunIds: sorted(this.#state.activeRuns),
      pendingApprovalIds: sorted(this.#state.pendingApprovals),
    };
  }

  async findOffboardingReceipt(operationKey: string): Promise<OffboardingReceipt | null> {
    this.#attempt("findOffboardingReceipt");
    return this.#state.receipts.get(operationKey) ?? null;
  }

  async stopActorAccess(plan: OffboardingPlan) {
    this.#step("stopActorAccess");
    this.#state.identityOperational = false;
    this.#state.membershipOperational = false;
    if (plan.actorKind === "agent") this.#state.agentOperational = false;
    return {
      identityStopped: true,
      membershipStopped: true,
      agentProfileStopped: plan.actorKind === "agent",
    };
  }

  async revokeActorConnections(plan: OffboardingPlan): Promise<ConnectionRevocationResult> {
    this.#step("revokeActorConnections");
    return {
      accessTokenIds: removeAll(this.#state.activeTokens, plan.accessTokenIds),
      connectorCredentialIds: removeAll(
        this.#state.activeConnectorCredentials,
        plan.connectorCredentialIds,
      ),
    };
  }

  async stopActorSchedules(plan: OffboardingPlan): Promise<readonly string[]> {
    this.#step("stopActorSchedules");
    return removeAll(this.#state.activeSchedules, plan.scheduledRunIds);
  }

  async killActorRuns(plan: OffboardingPlan): Promise<readonly string[]> {
    this.#step("killActorRuns");
    return removeAll(this.#state.activeRuns, plan.activeAgentRunIds);
  }

  async expireActorApprovals(plan: OffboardingPlan): Promise<readonly string[]> {
    this.#step("expireActorApprovals");
    return removeAll(this.#state.pendingApprovals, plan.pendingApprovalIds);
  }

  async createHandover(plan: OffboardingPlan): Promise<HandoverCreationResult> {
    this.#step("createHandover");
    const itemKeys = plan.handoverItems.map((item) => item.idempotencyKey);
    for (const key of itemKeys) this.#state.handoverItems.add(key);
    this.#state.handoverId ??= `handover:${plan.actorId}:${plan.lifecycleEpoch}`;
    return { handoverId: this.#state.handoverId, itemKeys };
  }

  async inspectOffboardingSeal(_actorId: string): Promise<OffboardingSeal> {
    this.#step("inspectOffboardingSeal");
    return {
      identityOperational: this.#state.identityOperational,
      membershipOperational: this.#state.membershipOperational,
      agentOperational: this.#state.agentOperational,
      activeAccessTokenCount: this.#state.activeTokens.size,
      activeConnectorCredentialCount: this.#state.activeConnectorCredentials.size,
      activeScheduledRunCount: this.#state.activeSchedules.size,
      activeAgentRunCount: this.#state.activeRuns.size,
      pendingApprovalCount: this.#state.pendingApprovals.size,
    };
  }

  async appendChronicle(event: LifecycleChronicleEvent): Promise<void> {
    this.#step("appendChronicle");
    this.#state.chronicleEvents.set(event.idempotencyKey, event);
  }

  async saveOffboardingReceipt(receipt: OffboardingReceipt): Promise<void> {
    this.#step("saveOffboardingReceipt");
    this.#state.receipts.set(receipt.operationKey, receipt);
  }
}

class FakeLifecycleRepository implements LifecycleRepository {
  readonly #options: FakeRepositoryOptions;
  #state: FakeState;
  #tail: Promise<void> = Promise.resolve();
  readonly attempts: string[] = [];
  readonly scopes: LifecycleAtomicScope[] = [];

  constructor(options: FakeRepositoryOptions) {
    this.#options = options;
    const existing = options.onboarding?.existingRequirementKeys ??
      options.audience?.existingRequirementKeys ?? [];
    const offboarding = options.offboarding;
    this.#state = {
      requirementKeys: new Set(existing),
      chronicleEvents: new Map(),
      receipts: new Map(),
      identityOperational: offboarding?.actor.identityOperational ?? true,
      membershipOperational: offboarding?.actor.membershipOperational ?? true,
      agentOperational: offboarding?.actor.kind === "agent",
      activeTokens: new Set(offboarding?.accessTokenIds ?? []),
      activeConnectorCredentials: new Set(offboarding?.connectorCredentialIds ?? []),
      activeSchedules: new Set(offboarding?.scheduledRunIds ?? []),
      activeRuns: new Set(offboarding?.activeAgentRunIds ?? []),
      pendingApprovals: new Set(offboarding?.pendingApprovalIds ?? []),
      handoverItems: new Set(),
      handoverId: null,
    };
  }

  async transact<T>(
    scope: LifecycleAtomicScope,
    work: (transaction: LifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.#tail;
    let release = (): void => {
      throw new Error("Lifecycle transaction lock was not initialized.");
    };
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.scopes.push(scope);
    const draft = cloneFakeState(this.#state);
    try {
      const result = await work(new FakeLifecycleTransaction(
        draft,
        this.#options,
        (step) => this.attempts.push(step),
      ));
      this.#state = draft;
      return result;
    } finally {
      release();
    }
  }

  view(): FakeStateView {
    return {
      requirementKeys: sorted(this.#state.requirementKeys),
      chronicleEvents: [...this.#state.chronicleEvents.values()],
      receipts: [...this.#state.receipts.values()],
      identityOperational: this.#state.identityOperational,
      membershipOperational: this.#state.membershipOperational,
      agentOperational: this.#state.agentOperational,
      activeTokens: sorted(this.#state.activeTokens),
      activeConnectorCredentials: sorted(this.#state.activeConnectorCredentials),
      activeSchedules: sorted(this.#state.activeSchedules),
      activeRuns: sorted(this.#state.activeRuns),
      pendingApprovals: sorted(this.#state.pendingApprovals),
      handoverItems: sorted(this.#state.handoverItems),
      handoverId: this.#state.handoverId,
    };
  }
}

describe("Guild lifecycle planning", () => {
  it("filters onboarding by template, Role, Space, Actor kind, and Canonical state", () => {
    const snapshot = onboardingSnapshot({
      canonicalMemories: [
        memory({ memoryId: "include-memory" }),
        memory({ memoryId: "wrong-template", applicability: {
          actorKinds: ["human"], templateKeys: ["research"], roleIds: [IDS.roleStaff],
        } }),
        memory({ memoryId: "wrong-role", applicability: {
          actorKinds: ["human"], templateKeys: ["company"], roleIds: [IDS.roleManager],
        } }),
        memory({ memoryId: "wrong-space", spaceId: IDS.spaceB }),
        memory({ memoryId: "working-memory", layer: "working", governanceState: null }),
        memory({ memoryId: "archived-memory", status: "archived" }),
        memory({ memoryId: "agent-only", applicability: {
          actorKinds: ["agent"], templateKeys: ["company"], roleIds: [IDS.roleStaff],
        } }),
      ],
      initialActivities: [
        activity({ definitionKey: "include-activity" }),
        activity({ definitionKey: "research-activity", templateKey: "research" }),
        activity({ definitionKey: "manager-activity", applicability: {
          actorKinds: ["human"], templateKeys: ["company"], roleIds: [IDS.roleManager],
        } }),
        activity({ definitionKey: "other-space-activity", spaceId: IDS.spaceB }),
      ],
    });

    const plan = buildOnboardingPlan(snapshot);

    expect(plan.requirements.map((requirement) => requirement.kind)).toEqual([
      "initial_activity",
      "memory_confirmation",
    ]);
    expect(plan.requirements.map((requirement) => requirement.title)).toEqual([
      "Complete the first shift checklist",
      "Safety manual",
    ]);
  });

  it("creates reconfirmation only for the changed Memory version and its current audience", () => {
    const currentMemory = memory({ version: 2 });
    const eligible = actor({ actorId: "eligible", membershipState: "active" });
    const alreadyAssigned = actor({ actorId: "already-assigned", membershipState: "active" });
    const wrongTemplate = actor({
      actorId: "wrong-template",
      membershipState: "active",
      templateKey: "research",
    });
    const wrongSpace = actor({
      actorId: "wrong-space",
      membershipState: "active",
      roleBindings: [{ roleId: IDS.roleStaff, spaceId: IDS.spaceB }],
    });
    const snapshot: CanonicalMemoryAudienceSnapshot = {
      guildId: IDS.guild,
      memory: currentMemory,
      actors: [eligible, alreadyAssigned, wrongTemplate, wrongSpace],
      existingRequirementKeys: [
        `onboarding:${eligible.actorId}:memory:${currentMemory.memoryId}:v1`,
        `onboarding:${alreadyAssigned.actorId}:memory:${currentMemory.memoryId}:v2`,
      ],
    };

    const plan = buildCanonicalMemoryReconfirmationPlan(snapshot);

    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]).toMatchObject({
      actorId: eligible.actorId,
      memoryId: currentMemory.memoryId,
      memoryVersion: 2,
    });
  });

  it("applies a Guild-wide requirement without requiring a Space Role binding", () => {
    const plan = buildOnboardingPlan(onboardingSnapshot({
      actor: actor({ roleBindings: [] }),
      canonicalMemories: [memory({
        memoryId: "guild-wide-memory",
        spaceId: null,
        applicability: { actorKinds: ["human"], templateKeys: ["company"], roleIds: [] },
      })],
      initialActivities: [],
    }));

    expect(plan.requirements).toHaveLength(1);
    expect(plan.requirements[0]?.targetSpaceId).toBeNull();
  });
});

describe("GuildLifecycleRuntime", () => {
  it("does not duplicate onboarding assignments or Chronicle events under a race", async () => {
    const repository = new FakeLifecycleRepository({ onboarding: onboardingSnapshot() });
    const runtime = new GuildLifecycleRuntime(repository);

    const results = await Promise.all([
      runtime.synchronizeOnboarding({ guildId: IDS.guild, actorId: IDS.human, chronicle: CHRONICLE }),
      runtime.synchronizeOnboarding({ guildId: IDS.guild, actorId: IDS.human, chronicle: CHRONICLE }),
    ]);

    expect(results.map((result) => result.insertedRequirementKeys.length).sort()).toEqual([0, 2]);
    expect(repository.view().requirementKeys).toHaveLength(2);
    expect(repository.view().chronicleEvents).toHaveLength(1);
    expect(repository.scopes).toHaveLength(2);
    expect(repository.scopes.every((scope) =>
      scope.lockKeys.includes(`actor:${IDS.human}`))).toBe(true);
  });

  it("stops every access path and creates explicit Activity, file, and draft handovers", async () => {
    const repository = new FakeLifecycleRepository({ offboarding: offboardingSnapshot() });
    const runtime = new GuildLifecycleRuntime(repository);

    const receipt = await runtime.offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: CHRONICLE,
    });
    const state = repository.view();

    expect(receipt).toMatchObject({
      actorKind: "human",
      handoverItemCount: 4,
      revokedAccessTokenCount: 2,
      revokedConnectorCredentialCount: 1,
      stoppedScheduledRunCount: 1,
      killedAgentRunCount: 2,
      expiredApprovalCount: 1,
    });
    expect(state.identityOperational).toBe(false);
    expect(state.membershipOperational).toBe(false);
    expect(state.activeTokens).toEqual([]);
    expect(state.activeConnectorCredentials).toEqual([]);
    expect(state.activeSchedules).toEqual([]);
    expect(state.activeRuns).toEqual([]);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.handoverItems).toHaveLength(4);
    expect(state.chronicleEvents).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(repository.attempts).toEqual([
      "loadOffboarding",
      "findOffboardingReceipt",
      "stopActorAccess",
      "revokeActorConnections",
      "stopActorSchedules",
      "killActorRuns",
      "expireActorApprovals",
      "createHandover",
      "inspectOffboardingSeal",
      "appendChronicle",
      "saveOffboardingReceipt",
    ]);
  });

  it("rolls back all earlier stops, handovers, Chronicle events, and receipts on partial failure", async () => {
    const repository = new FakeLifecycleRepository({
      offboarding: offboardingSnapshot(),
      failAt: "killActorRuns",
    });
    const runtime = new GuildLifecycleRuntime(repository);

    await expect(runtime.offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: CHRONICLE,
    })).rejects.toThrow("Injected failure at killActorRuns");
    const state = repository.view();

    expect(repository.attempts).toEqual([
      "loadOffboarding",
      "findOffboardingReceipt",
      "stopActorAccess",
      "revokeActorConnections",
      "stopActorSchedules",
      "killActorRuns",
    ]);
    expect(state.identityOperational).toBe(true);
    expect(state.membershipOperational).toBe(true);
    expect(state.activeTokens).toEqual(["token-1", "token-2"]);
    expect(state.activeConnectorCredentials).toEqual(["credential-1"]);
    expect(state.activeSchedules).toEqual(["schedule-1"]);
    expect(state.activeRuns).toEqual(["run-1", "run-2"]);
    expect(state.pendingApprovals).toEqual(["approval-1"]);
    expect(state.handoverItems).toEqual([]);
    expect(state.chronicleEvents).toEqual([]);
    expect(state.receipts).toEqual([]);
  });

  it("stops an Agent profile and its active Runs", async () => {
    const agentSnapshot = offboardingSnapshot({
      actor: actor({
        actorId: IDS.agent,
        kind: "agent",
        membershipState: "active",
      }),
      activeAgentRunIds: ["agent-run-1", "agent-run-2"],
      openActivities: [],
      ownedFiles: [],
      governedDrafts: [],
    });
    const repository = new FakeLifecycleRepository({ offboarding: agentSnapshot });
    const runtime = new GuildLifecycleRuntime(repository);

    const receipt = await runtime.offboardActor({
      guildId: IDS.guild,
      actorId: IDS.agent,
      successorActorId: IDS.successor,
      chronicle: CHRONICLE,
    });

    expect(receipt.actorKind).toBe("agent");
    expect(receipt.killedAgentRunCount).toBe(2);
    expect(repository.view().agentOperational).toBe(false);
    expect(repository.view().activeRuns).toEqual([]);
  });

  it("returns one durable result when two offboarding requests race", async () => {
    const repository = new FakeLifecycleRepository({ offboarding: offboardingSnapshot() });
    const runtime = new GuildLifecycleRuntime(repository);
    const request = {
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: CHRONICLE,
    } as const;

    const [first, second] = await Promise.all([
      runtime.offboardActor(request),
      runtime.offboardActor(request),
    ]);

    expect(second).toEqual(first);
    expect(repository.view().receipts).toHaveLength(1);
    expect(repository.view().chronicleEvents).toHaveLength(1);
    expect(repository.attempts.filter((step) => step === "stopActorAccess")).toHaveLength(1);
    expect(repository.attempts.filter((step) => step === "createHandover")).toHaveLength(1);
  });

  it("requires complete Chronicle input before opening a transaction", async () => {
    const repository = new FakeLifecycleRepository({ onboarding: onboardingSnapshot() });
    const runtime = new GuildLifecycleRuntime(repository);

    await expect(runtime.synchronizeOnboarding({
      guildId: IDS.guild,
      actorId: IDS.human,
      chronicle: { ...CHRONICLE, reason: "" },
    })).rejects.toThrow("Chronicle reason is required");
    expect(repository.scopes).toEqual([]);
  });
});
