import { describe, expect, it } from "vitest";
import type { GuildEnv } from "../src/config.js";
import {
  drainRetentionRuns,
  type RetentionDrainDependencies,
} from "../src/retention-adapter.js";
import type { RetentionRuntimeResult } from "../src/retention-runtime.js";

const env = {
  GUILD_ID: "11111111-1111-4111-8111-111111111111",
  HYPERDRIVE: { connectionString: "postgresql://example.invalid/guild" },
} as GuildEnv;

function dependenciesFor(
  outcomes: readonly RetentionRuntimeResult[],
  observedWorkerIds: string[],
): RetentionDrainDependencies {
  let index = 0;
  return {
    createRuntime(receivedEnv) {
      expect(receivedEnv).toBe(env);
      return {
        async runNext(workerId) {
          observedWorkerIds.push(workerId);
          return outcomes[index++] ?? { status: "idle" };
        },
      };
    },
    createWorkerId: () => "guild-retention:test-worker",
  };
}

describe("drainRetentionRuns", () => {
it("uses one stable worker identity and stops when idle", async () => {
  const observedWorkerIds: string[] = [];
  const result = await drainRetentionRuns(env, 5, dependenciesFor([
    {
      status: "completed",
      runId: "22222222-2222-4222-8222-222222222222",
      dryRun: true,
      candidateCount: 12,
      affectedCount: 0,
    },
    { status: "idle" },
  ], observedWorkerIds));

  expect(result).toEqual([{
    status: "completed",
    runId: "22222222-2222-4222-8222-222222222222",
    dryRun: true,
    candidateCount: 12,
    affectedCount: 0,
  }]);
  expect(observedWorkerIds).toEqual([
    "guild-retention:test-worker",
    "guild-retention:test-worker",
  ]);
});

it("stops after losing a lease", async () => {
  const observedWorkerIds: string[] = [];
  const result = await drainRetentionRuns(env, 5, dependenciesFor([
    {
      status: "lease_lost",
      runId: "22222222-2222-4222-8222-222222222222",
      category: "files",
    },
    {
      status: "completed",
      runId: "33333333-3333-4333-8333-333333333333",
      dryRun: false,
      candidateCount: 1,
      affectedCount: 1,
    },
  ], observedWorkerIds));

  expect(result).toEqual([{
    status: "lease_lost",
    runId: "22222222-2222-4222-8222-222222222222",
    category: "files",
  }]);
  expect(observedWorkerIds).toHaveLength(1);
});

it("rejects unsafe batch limits and blank worker identities", async () => {
  const observedWorkerIds: string[] = [];
  await expect(
    drainRetentionRuns(env, 0, dependenciesFor([], observedWorkerIds)),
  ).rejects.toThrow(/between 1 and 10/);
  await expect(
    drainRetentionRuns(env, 11, dependenciesFor([], observedWorkerIds)),
  ).rejects.toThrow(/between 1 and 10/);
  await expect(
    drainRetentionRuns(env, 1, {
      createRuntime: () => ({ runNext: async () => ({ status: "idle" }) }),
      createWorkerId: () => " ",
    }),
  ).rejects.toThrow(/worker ID is required/);
});
});
