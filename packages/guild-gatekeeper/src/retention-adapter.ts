import type { GuildEnv } from "./config.js";
import {
  GuildRetentionRuntime,
  PostgresRetentionRuntimeRepository,
  type RetentionRuntimeResult,
} from "./retention-runtime.js";

const DEFAULT_RETENTION_RUN_LIMIT = 1;
const MAX_RETENTION_RUN_LIMIT = 10;

interface RetentionRunner {
  runNext(workerId: string): Promise<RetentionRuntimeResult>;
}

export interface RetentionDrainDependencies {
  createRuntime(env: GuildEnv): RetentionRunner;
  createWorkerId(): string;
}

const retentionDrainDependencies: RetentionDrainDependencies = {
  createRuntime: (env) => new GuildRetentionRuntime(
    new PostgresRetentionRuntimeRepository({
      connectionString: env.HYPERDRIVE.connectionString,
      guildId: env.GUILD_ID,
    }),
  ),
  createWorkerId: () => `guild-retention:${crypto.randomUUID()}`,
};

export async function drainRetentionRuns(
  env: GuildEnv,
  limit = DEFAULT_RETENTION_RUN_LIMIT,
  dependencies: RetentionDrainDependencies = retentionDrainDependencies,
): Promise<readonly RetentionRuntimeResult[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RETENTION_RUN_LIMIT) {
    throw new Error(
      `Retention run limit must be between 1 and ${MAX_RETENTION_RUN_LIMIT}.`,
    );
  }

  const runtime = dependencies.createRuntime(env);
  const workerId = dependencies.createWorkerId();
  if (workerId.trim().length === 0) throw new Error("Retention worker ID is required.");

  const outcomes: RetentionRuntimeResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await runtime.runNext(workerId);
    if (outcome.status === "idle") break;
    outcomes.push(outcome);
    if (outcome.status === "lease_lost") break;
  }
  return outcomes;
}
