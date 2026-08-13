import type {
  RetentionAction,
  RetentionActionKind,
  RetentionCategory,
  RetentionRun,
  RetentionRunDetail,
} from "@guild-os/postgres";
import { describe, expect, it } from "vitest";
import {
  GuildRetentionRuntime,
  RETENTION_SQL_ALLOWLIST,
  RetentionRuntimeError,
  type RetentionBatchCommit,
  type RetentionBatchInput,
  type RetentionClaimInput,
  type RetentionCompletionInput,
  type RetentionFailureInput,
  type RetentionRuntimeRepository,
} from "../src/retention-runtime.js";

const NOW = "2026-08-14T04:00:00.000Z";
const CUTOFF = "2026-08-01T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const FUTURE = "2027-01-01T00:00:00.000Z";
const GUILD_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const REQUESTER_ID = "30000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "40000000-0000-4000-8000-000000000001";

type DeparturePolicy = "retain_by_policy" | "archive" | "delete_after_retention";
type FakeCustody = "guild" | "personal" | "shared";
type FakeState = "active" | "completed" | "archived" | "deleted";

interface FakeResource {
  id: string;
  category: RetentionCategory;
  state: FakeState;
  custody: FakeCustody;
  ownerDeparted: boolean;
  updatedAt: string;
  retentionUntil: string | null;
  privatePlaintext?: string;
}

interface FakeChronicleEvent {
  action: "retention.category.checkpointed" | "retention.completed" | "retention.failed";
  category: RetentionCategory | null;
  candidateCount: number;
  affectedCount: number;
  errorCode: string | null;
}

interface FakeRepositoryOptions {
  resources?: readonly FakeResource[];
  dryRun?: boolean;
  actions?: readonly [RetentionCategory, RetentionActionKind][];
  departurePolicy?: DeparturePolicy;
  authorizationEvidence?: boolean;
  policyVersionCurrent?: boolean;
  transientFailures?: Readonly<Partial<Record<RetentionCategory, number>>>;
  failCategory?: RetentionCategory;
  failAfterMutation?: boolean;
  leakedFailureText?: string;
  loseLeaseCategory?: RetentionCategory;
}

function resource(
  idSuffix: number,
  category: RetentionCategory,
  state: FakeState,
  overrides: Partial<FakeResource> = {},
): FakeResource {
  return {
    id: `50000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
    category,
    state,
    custody: "guild",
    ownerDeparted: false,
    updatedAt: OLD,
    retentionUntil: null,
    ...overrides,
  };
}

function retentionAction(
  category: RetentionCategory,
  action: RetentionActionKind,
): RetentionAction {
  return {
    guildId: GUILD_ID,
    retentionRunId: RUN_ID,
    category,
    action,
    cutoffAt: CUTOFF,
    status: "pending",
    checkpointCursor: null,
    candidateCount: 0,
    affectedCount: 0,
    errorSummary: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function retentionRun(
  actions: readonly [RetentionCategory, RetentionActionKind][],
  dryRun: boolean,
  authorizationEvidence: boolean,
): RetentionRun {
  return {
    id: RUN_ID,
    guildId: GUILD_ID,
    requestedByActorId: REQUESTER_ID,
    dryRun,
    policyVersion: 7,
    categories: actions.map(([category]) => category),
    cutoffAt: CUTOFF,
    authorizationEvidenceId: authorizationEvidence && !dryRun
      ? "60000000-0000-4000-8000-000000000001"
      : null,
    plannedChronicleEventId: "70000000-0000-4000-8000-000000000001",
    terminalChronicleEventId: null,
    status: "queued",
    idempotencyKey: "retention-runtime-test",
    attemptCount: 0,
    leaseToken: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    resultSummary: null,
    errorSummary: null,
    completedAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function copyAction(action: RetentionAction): RetentionAction {
  return { ...action };
}

function copyRun(run: RetentionRun): RetentionRun {
  return {
    ...run,
    categories: [...run.categories],
    resultSummary: run.resultSummary === null ? null : { ...run.resultSummary },
  };
}

function copyResource(candidate: FakeResource): FakeResource {
  return { ...candidate };
}

class FakeRetentionRepository implements RetentionRuntimeRepository {
  readonly #departurePolicy: DeparturePolicy;
  readonly #authorizationEvidence: boolean;
  readonly #policyVersionCurrent: boolean;
  readonly #transientFailures: Map<RetentionCategory, number>;
  readonly #failCategory: RetentionCategory | null;
  readonly #failAfterMutation: boolean;
  readonly #leakedFailureText: string;
  readonly #loseLeaseCategory: RetentionCategory | null;
  #run: RetentionRun;
  #actions: RetentionAction[];
  #resources: FakeResource[];
  #claimed = false;

  readonly chronicle: FakeChronicleEvent[] = [];
  readonly r2DeletionQueue = new Set<string>();
  readonly checkpoints: RetentionCategory[] = [];
  readonly attempts = new Map<RetentionCategory, number>();
  heartbeatCount = 0;

  constructor(options: FakeRepositoryOptions = {}) {
    const actions = options.actions ?? [["memories", "retain"]];
    this.#run = retentionRun(
      actions,
      options.dryRun ?? false,
      options.authorizationEvidence ?? false,
    );
    this.#actions = actions.map(([category, action]) => retentionAction(category, action));
    this.#resources = (options.resources ?? []).map(copyResource);
    this.#departurePolicy = options.departurePolicy ?? "retain_by_policy";
    this.#authorizationEvidence = options.authorizationEvidence ?? false;
    this.#policyVersionCurrent = options.policyVersionCurrent ?? true;
    this.#transientFailures = new Map(
      Object.entries(options.transientFailures ?? {}) as [RetentionCategory, number][],
    );
    this.#failCategory = options.failCategory ?? null;
    this.#failAfterMutation = options.failAfterMutation ?? false;
    this.#leakedFailureText = options.leakedFailureText ?? "private secret must not escape";
    this.#loseLeaseCategory = options.loseLeaseCategory ?? null;
  }

  get detail(): RetentionRunDetail {
    return {
      run: copyRun(this.#run),
      actions: this.#actions.map(copyAction),
    };
  }

  get resources(): readonly FakeResource[] {
    return this.#resources.map(copyResource);
  }

  restoreArchived(category: "memories" | "activities"): void {
    this.#resources = this.#resources.map((candidate) => {
      if (candidate.category !== category || candidate.state !== "archived") return candidate;
      return {
        ...candidate,
        state: category === "memories" ? "active" : "completed",
      };
    });
  }

  async claimNext(input: RetentionClaimInput): Promise<RetentionRunDetail | null> {
    if (this.#claimed || this.#run.status !== "queued") return null;
    this.#claimed = true;
    this.#run = {
      ...this.#run,
      status: "processing",
      attemptCount: this.#run.attemptCount + 1,
      leaseToken: LEASE_TOKEN,
      leaseOwner: input.workerId,
      leaseExpiresAt: new Date(
        Date.parse(input.now) + input.leaseSeconds * 1_000,
      ).toISOString(),
      heartbeatAt: input.now,
      version: this.#run.version + 1,
    };
    return this.detail;
  }

  async processCategoryBatch(input: RetentionBatchInput): Promise<RetentionBatchCommit> {
    const actionIndex = this.#actions.findIndex((action) => action.category === input.category);
    const action = this.#actions[actionIndex];
    if (!action) throw new RetentionRuntimeError("invalid_claim", "Missing category.");
    this.attempts.set(input.category, (this.attempts.get(input.category) ?? 0) + 1);

    if (this.#loseLeaseCategory === input.category) {
      throw new RetentionRuntimeError("lease_lost", "Lease changed.");
    }
    this.#assertLease(input.leaseToken);
    if (!this.#policyVersionCurrent) {
      throw new RetentionRuntimeError("policy_changed", "Constitution changed.");
    }
    if (!this.#run.dryRun && action.action === "purge" && !this.#authorizationEvidence) {
      throw new RetentionRuntimeError(
        "authorization_evidence_missing",
        "Authorization is absent.",
      );
    }
    const transientRemaining = this.#transientFailures.get(input.category) ?? 0;
    if (transientRemaining > 0) {
      this.#transientFailures.set(input.category, transientRemaining - 1);
      throw new RetentionRuntimeError(
        "repository_transient",
        "Transient storage failure.",
        true,
      );
    }

    const beforeResources = this.#resources.map(copyResource);
    const beforeQueue = new Set(this.r2DeletionQueue);
    const beforeRun = copyRun(this.#run);
    const beforeAction = copyAction(action);
    const beforeChronicleLength = this.chronicle.length;
    const beforeCheckpointLength = this.checkpoints.length;
    try {
      this.heartbeatCount += 1;
      this.#run = {
        ...this.#run,
        heartbeatAt: input.now,
        leaseExpiresAt: new Date(
          Date.parse(input.now) + input.leaseSeconds * 1_000,
        ).toISOString(),
        version: this.#run.version + 1,
      };
      const eligible = this.#eligible(action).filter((candidate) =>
        action.checkpointCursor === null || candidate.id > action.checkpointCursor);

      let selected: readonly FakeResource[];
      let completed: boolean;
      let checkpointCursor = action.checkpointCursor;
      let batchAffectedCount = 0;
      if (this.#run.dryRun || action.action === "retain") {
        selected = eligible;
        completed = true;
        checkpointCursor = null;
      } else {
        selected = eligible.slice(0, input.batchSize);
        completed = selected.length < input.batchSize;
        checkpointCursor = selected.at(-1)?.id ?? checkpointCursor;
        const selectedIds = new Set(selected.map((candidate) => candidate.id));
        if (action.action === "archive") {
          this.#resources = this.#resources.map((candidate) =>
            selectedIds.has(candidate.id) ? { ...candidate, state: "archived" } : candidate);
        } else if (action.action === "purge") {
          for (const candidate of selected) this.r2DeletionQueue.add(candidate.id);
          this.#resources = this.#resources.filter((candidate) => !selectedIds.has(candidate.id));
        }
        batchAffectedCount = selected.length;
      }

      if (this.#failCategory === input.category) {
        if (this.#failAfterMutation) throw new Error(this.#leakedFailureText);
        throw new Error(this.#leakedFailureText);
      }

      const candidateCount = this.#run.dryRun || action.action === "retain"
        ? selected.length
        : action.candidateCount + selected.length;
      const affectedCount = this.#run.dryRun
        ? 0
        : action.affectedCount + batchAffectedCount;
      const updatedAction: RetentionAction = {
        ...action,
        status: completed ? "completed" : "processing",
        checkpointCursor,
        candidateCount,
        affectedCount,
        version: action.version + 1,
        updatedAt: input.now,
      };
      this.#actions[actionIndex] = updatedAction;
      this.checkpoints.push(action.category);
      this.chronicle.push({
        action: "retention.category.checkpointed",
        category: action.category,
        candidateCount: selected.length,
        affectedCount: batchAffectedCount,
        errorCode: null,
      });
      return {
        detail: this.detail,
        category: action.category,
        action: action.action,
        batchCandidateCount: selected.length,
        batchAffectedCount,
        r2DeletionQueueCount: action.action === "purge" ? selected.length : 0,
        completed,
      };
    } catch (error) {
      this.#resources = beforeResources;
      this.r2DeletionQueue.clear();
      for (const value of beforeQueue) this.r2DeletionQueue.add(value);
      this.#run = beforeRun;
      this.#actions[actionIndex] = beforeAction;
      this.chronicle.splice(beforeChronicleLength);
      this.checkpoints.splice(beforeCheckpointLength);
      throw error;
    }
  }

  async failRun(input: RetentionFailureInput): Promise<RetentionRun> {
    this.#assertLease(input.leaseToken);
    const actionIndex = this.#actions.findIndex((action) => action.category === input.category);
    const action = this.#actions[actionIndex];
    if (!action) throw new RetentionRuntimeError("invalid_claim", "Missing failure category.");
    const errorSummary = `retention_runtime:${input.errorCode}`;
    this.#actions[actionIndex] = {
      ...action,
      status: "failed",
      errorSummary,
      version: action.version + 1,
    };
    this.#run = {
      ...this.#run,
      status: "failed",
      errorSummary,
      completedAt: input.now,
      terminalChronicleEventId: "80000000-0000-4000-8000-000000000001",
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      version: this.#run.version + 1,
    };
    this.chronicle.push({
      action: "retention.failed",
      category: action.category,
      candidateCount: action.candidateCount,
      affectedCount: action.affectedCount,
      errorCode: input.errorCode,
    });
    return copyRun(this.#run);
  }

  async completeRun(input: RetentionCompletionInput): Promise<RetentionRun> {
    this.#assertLease(input.leaseToken);
    if (this.#actions.some((action) => action.status !== "completed")) {
      throw new Error("Incomplete categories cannot be completed.");
    }
    const candidateCount = this.#actions.reduce(
      (total, action) => total + action.candidateCount,
      0,
    );
    const affectedCount = this.#actions.reduce(
      (total, action) => total + action.affectedCount,
      0,
    );
    this.#run = {
      ...this.#run,
      status: "completed",
      resultSummary: { candidateCount, affectedCount, dryRun: this.#run.dryRun },
      completedAt: input.now,
      terminalChronicleEventId: "90000000-0000-4000-8000-000000000001",
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      version: this.#run.version + 1,
    };
    this.chronicle.push({
      action: "retention.completed",
      category: null,
      candidateCount,
      affectedCount,
      errorCode: null,
    });
    return copyRun(this.#run);
  }

  #assertLease(leaseToken: string): void {
    if (this.#run.status !== "processing" || this.#run.leaseToken !== leaseToken) {
      throw new RetentionRuntimeError("lease_lost", "Lease is not current.");
    }
  }

  #eligible(action: RetentionAction): FakeResource[] {
    const beforeCutoff = this.#resources.filter((candidate) =>
      candidate.category === action.category && candidate.updatedAt <= action.cutoffAt);
    if (action.action === "retain") return beforeCutoff.sort(compareResource);
    if (action.action === "archive") {
      if (action.category !== "memories" && action.category !== "activities") {
        throw new RetentionRuntimeError("unsupported_action", "Archive is unsupported.");
      }
      return beforeCutoff.filter((candidate) => {
        const stateEligible = action.category === "memories"
          ? candidate.state === "active"
          : candidate.state === "completed";
        return stateEligible && this.#custodyAllowsArchive(candidate);
      }).sort(compareResource);
    }
    if (action.category !== "files") {
      throw new RetentionRuntimeError("unsupported_action", "Purge is unsupported.");
    }
    return beforeCutoff.filter((candidate) =>
      candidate.state === "deleted" &&
      candidate.retentionUntil !== null && candidate.retentionUntil <= action.cutoffAt &&
      this.#custodyAllowsPurge(candidate)).sort(compareResource);
  }

  #custodyAllowsArchive(candidate: FakeResource): boolean {
    if (candidate.custody === "guild" || candidate.custody === "shared") return true;
    return candidate.ownerDeparted &&
      (this.#departurePolicy === "archive" ||
       this.#departurePolicy === "delete_after_retention");
  }

  #custodyAllowsPurge(candidate: FakeResource): boolean {
    if (candidate.custody === "guild" || candidate.custody === "shared") return true;
    return candidate.ownerDeparted && this.#departurePolicy === "delete_after_retention";
  }
}

function compareResource(left: FakeResource, right: FakeResource): number {
  return left.id.localeCompare(right.id);
}

function runtime(repository: RetentionRuntimeRepository, batchSize = 2): GuildRetentionRuntime {
  return new GuildRetentionRuntime(repository, {
    batchSize,
    leaseSeconds: 120,
    maxBatchRetries: 2,
    retryDelayMs: 0,
    now: () => NOW,
    sleep: async () => undefined,
  });
}

describe("GuildRetentionRuntime", () => {
  it("keeps dry-run count-only and does not expose or mutate private records", async () => {
    const secret = "private-message: do-not-log";
    const repository = new FakeRetentionRepository({
      dryRun: true,
      departurePolicy: "archive",
      actions: [["memories", "archive"]],
      resources: [
        resource(1, "memories", "active", { privatePlaintext: secret }),
        resource(2, "memories", "active", {
          custody: "personal",
          ownerDeparted: true,
          privatePlaintext: secret,
        }),
        resource(3, "memories", "active", {
          custody: "personal",
          ownerDeparted: false,
          privatePlaintext: secret,
        }),
      ],
    });

    await expect(runtime(repository).runNext("worker-dry-run")).resolves.toEqual({
      status: "completed",
      runId: RUN_ID,
      dryRun: true,
      candidateCount: 2,
      affectedCount: 0,
    });
    expect(repository.resources.map((candidate) => candidate.state)).toEqual([
      "active",
      "active",
      "active",
    ]);
    expect(JSON.stringify(repository.detail)).not.toContain(secret);
    expect(JSON.stringify(repository.chronicle)).not.toContain(secret);
    expect(repository.r2DeletionQueue.size).toBe(0);
  });

  it("archives in bounded reversible batches, checkpoints, heartbeats, and retries", async () => {
    const repository = new FakeRetentionRepository({
      actions: [["memories", "archive"]],
      departurePolicy: "archive",
      transientFailures: { memories: 1 },
      resources: [
        resource(1, "memories", "active"),
        resource(2, "memories", "active", {
          custody: "personal",
          ownerDeparted: true,
        }),
        resource(3, "memories", "active", {
          custody: "personal",
          ownerDeparted: false,
        }),
      ],
    });

    const result = await runtime(repository, 1).runNext("worker-archive");

    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      dryRun: false,
      candidateCount: 2,
      affectedCount: 2,
    });
    expect(repository.resources.map((candidate) => candidate.state)).toEqual([
      "archived",
      "archived",
      "active",
    ]);
    expect(repository.attempts.get("memories")).toBe(4);
    expect(repository.heartbeatCount).toBe(3);
    expect(repository.checkpoints).toEqual(["memories", "memories", "memories"]);

    repository.restoreArchived("memories");
    expect(repository.resources.map((candidate) => candidate.state)).toEqual([
      "active",
      "active",
      "active",
    ]);
  });

  it("purges only archived expired files and atomically queues their R2 deletion", async () => {
    const repository = new FakeRetentionRepository({
      actions: [["files", "purge"]],
      authorizationEvidence: true,
      departurePolicy: "delete_after_retention",
      resources: [
        resource(1, "files", "deleted", { retentionUntil: OLD }),
        resource(2, "files", "active", { retentionUntil: OLD }),
        resource(3, "files", "deleted", { retentionUntil: FUTURE }),
        resource(4, "files", "deleted", {
          custody: "personal",
          ownerDeparted: true,
          retentionUntil: OLD,
        }),
        resource(5, "files", "deleted", {
          custody: "personal",
          ownerDeparted: false,
          retentionUntil: OLD,
        }),
      ],
    });

    await expect(runtime(repository).runNext("worker-purge")).resolves.toEqual({
      status: "completed",
      runId: RUN_ID,
      dryRun: false,
      candidateCount: 2,
      affectedCount: 2,
    });
    expect(repository.resources.map((candidate) => candidate.id)).toEqual([
      resource(2, "files", "active").id,
      resource(3, "files", "deleted").id,
      resource(5, "files", "deleted").id,
    ]);
    expect([...repository.r2DeletionQueue].sort()).toEqual([
      resource(1, "files", "deleted").id,
      resource(4, "files", "deleted").id,
    ]);
  });

  it("requires current server evidence and honors Personal Data departure policy", async () => {
    const withoutEvidence = new FakeRetentionRepository({
      actions: [["files", "purge"]],
      departurePolicy: "delete_after_retention",
      resources: [resource(1, "files", "deleted", { retentionUntil: OLD })],
    });
    await expect(runtime(withoutEvidence).runNext("worker-no-evidence")).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failedCategory: "files",
      errorCode: "authorization_evidence_missing",
    });
    expect(withoutEvidence.resources).toHaveLength(1);
    expect(withoutEvidence.r2DeletionQueue.size).toBe(0);

    const retainPersonal = new FakeRetentionRepository({
      actions: [["files", "purge"]],
      authorizationEvidence: true,
      departurePolicy: "retain_by_policy",
      resources: [resource(2, "files", "deleted", {
        custody: "personal",
        ownerDeparted: true,
        retentionUntil: OLD,
      })],
    });
    await expect(runtime(retainPersonal).runNext("worker-personal-retain")).resolves.toMatchObject({
      status: "completed",
      candidateCount: 0,
      affectedCount: 0,
    });
    expect(retainPersonal.resources).toHaveLength(1);
  });

  it("rolls back a failed category, leaves later categories pending, and stores only safe errors", async () => {
    const secret = "postgres://user:password@private-host/internal";
    const repository = new FakeRetentionRepository({
      actions: [
        ["memories", "archive"],
        ["activities", "archive"],
        ["files", "retain"],
      ],
      failCategory: "activities",
      failAfterMutation: true,
      leakedFailureText: secret,
      resources: [
        resource(1, "memories", "active"),
        resource(2, "activities", "completed"),
        resource(3, "files", "active"),
      ],
    });

    await expect(runtime(repository).runNext("worker-failure")).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failedCategory: "activities",
      errorCode: "repository_failure",
    });
    expect(repository.resources.map((candidate) => candidate.state)).toEqual([
      "archived",
      "completed",
      "active",
    ]);
    expect(repository.detail.actions.map((action) => action.status)).toEqual([
      "completed",
      "failed",
      "pending",
    ]);
    expect(JSON.stringify(repository.detail)).not.toContain(secret);
    expect(JSON.stringify(repository.chronicle)).not.toContain(secret);
    expect(repository.chronicle.map((event) => event.action)).toEqual([
      "retention.category.checkpointed",
      "retention.failed",
    ]);
  });

  it("stops without terminal mutation when the lease is lost", async () => {
    const repository = new FakeRetentionRepository({
      actions: [["activities", "archive"]],
      loseLeaseCategory: "activities",
      resources: [resource(1, "activities", "completed")],
    });

    await expect(runtime(repository).runNext("worker-stale")).resolves.toEqual({
      status: "lease_lost",
      runId: RUN_ID,
      category: "activities",
    });
    expect(repository.detail.run.status).toBe("processing");
    expect(repository.detail.actions[0]?.status).toBe("pending");
    expect(repository.chronicle).toEqual([]);
  });

  it("fails closed when the Constitution version changes after planning", async () => {
    const repository = new FakeRetentionRepository({
      actions: [["memories", "archive"]],
      policyVersionCurrent: false,
      resources: [resource(1, "memories", "active")],
    });

    await expect(runtime(repository).runNext("worker-policy-change")).resolves.toEqual({
      status: "failed",
      runId: RUN_ID,
      failedCategory: "memories",
      errorCode: "policy_changed",
    });
    expect(repository.resources[0]?.state).toBe("active");
  });
});

describe("RETENTION_SQL_ALLOWLIST", () => {
  it("contains only explicit safe category/action pairs", () => {
    expect(Object.keys(RETENTION_SQL_ALLOWLIST)).toEqual([
      "memories",
      "activities",
      "decisions",
      "conversations",
      "files",
      "agent_runs",
      "chronicle",
    ]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.memories)).toEqual(["retain", "archive"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.activities)).toEqual(["retain", "archive"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.decisions)).toEqual(["retain"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.conversations)).toEqual(["retain"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.files)).toEqual(["retain", "purge"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.agent_runs)).toEqual(["retain"]);
    expect(Object.keys(RETENTION_SQL_ALLOWLIST.chronicle)).toEqual(["retain"]);
  });

  it("uses reversible transitions for archive and evidence-gated queued deletion for purge", () => {
    const memoryArchive = RETENTION_SQL_ALLOWLIST.memories.archive;
    const activityArchive = RETENTION_SQL_ALLOWLIST.activities.archive;
    const filePurge = RETENTION_SQL_ALLOWLIST.files.purge;

    expect(memoryArchive.reversibleArchive).toBe(true);
    expect(memoryArchive.mutationSql).toContain("SET status = 'archived'");
    expect(memoryArchive.mutationSql).not.toContain("DELETE FROM memories");
    expect(activityArchive.reversibleArchive).toBe(true);
    expect(activityArchive.mutationSql).toContain("activity.status = 'completed'");
    expect(activityArchive.mutationSql).not.toContain("DELETE FROM activities");

    expect(filePurge.requiresServerAuthorization).toBe(true);
    expect(filePurge.queuesR2Deletion).toBe(true);
    expect(filePurge.countSql).toContain("file_row.status = 'deleted'");
    expect(filePurge.countSql).toContain("custody.retention_until <=");
    expect(filePurge.mutationSql).toContain("server_authorization_evidence");
    expect(filePurge.mutationSql).toContain("INSERT INTO outbox");
    expect(filePurge.mutationSql).toContain("'knowledge.file.delete'");
    expect(filePurge.mutationSql).toContain("DELETE FROM files");
    expect(filePurge.mutationSql).not.toContain("conversation_messages.body");
    expect(filePurge.mutationSql).not.toContain("connectors.secret_reference");
  });
});
