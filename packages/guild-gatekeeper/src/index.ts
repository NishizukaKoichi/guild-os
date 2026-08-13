export * from "./guild.js";
export { AgentExecutionWorkflow } from "./agent-workflow.js";
export {
  offboardLifecycleActor,
  reconcilePublishedCanonicalMemory,
  synchronizeLifecycleOnboarding,
  type LifecycleOffboardingResult,
  type OffboardLifecycleActorInput,
  type ReconcilePublishedCanonicalMemoryInput,
  type SynchronizeLifecycleOnboardingInput,
} from "./lifecycle-service.js";

import {
  CURRENT_GUILD_SCHEMA_CHECKSUM,
  CURRENT_GUILD_SCHEMA_MIGRATION,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import { drainKnowledgeFileDeletionQueue } from "./knowledge-service.js";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";
import { drainMemoryEmbeddingJobs, scanMemoryHealth } from "./memory-intelligence.js";
import { drainDataExportJobs } from "./portability-service.js";
import { drainAutomationRuns } from "./automation-adapter.js";
import { drainRetentionRuns } from "./retention-adapter.js";
import {
  drainGuildFederationOutbound,
  handleGuildFederationInbound,
} from "./federation-postgres-adapter.js";

const SERVICE_NAME = "guild-gatekeeper";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export interface GuildSchemaVersion {
  name: string;
  checksum: string;
}

export type ReadinessProbe = (env: GuildEnv) => Promise<GuildSchemaVersion | null>;

interface RequestDependencies {
  readinessProbe: ReadinessProbe;
  handleFederation(request: Request, env: GuildEnv): Promise<Response>;
}

const requestDependencies: RequestDependencies = {
  readinessProbe: readLatestGuildMigration,
  handleFederation: handleGuildFederationInbound,
};

export async function readLatestGuildMigration(env: GuildEnv): Promise<GuildSchemaVersion | null> {
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    async (connection) => {
      const result = await connection.query(
        `SELECT name, checksum
           FROM public.guild_schema_migrations
          ORDER BY name DESC
          LIMIT 1`,
      );
      const row = result.rows[0];
      return typeof row?.name === "string" && typeof row.checksum === "string"
        ? { name: row.name, checksum: row.checksum }
        : null;
    },
  );
}

function jsonResponse(body: Readonly<Record<string, unknown>>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, service: SERVICE_NAME }), {
    status: 405,
    headers: { ...JSON_HEADERS, allow: "GET" },
  });
}

export async function handleHealthRequest(
  request: Request,
  env: GuildEnv,
  readinessProbe: ReadinessProbe = readLatestGuildMigration,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== "/healthz" && path !== "/readyz") {
    return jsonResponse({ ok: false, service: SERVICE_NAME }, 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  if (path === "/healthz") return jsonResponse({ ok: true, service: SERVICE_NAME });

  try {
    const migration = await readinessProbe(env);
    const ready = migration?.name === CURRENT_GUILD_SCHEMA_MIGRATION &&
      migration.checksum === CURRENT_GUILD_SCHEMA_CHECKSUM;
    if (!ready) {
      console.error(JSON.stringify({ event: "guild.readiness", ok: false }));
    }
    return jsonResponse({ ok: ready, service: SERVICE_NAME }, ready ? 200 : 503);
  } catch {
    console.error(JSON.stringify({ event: "guild.readiness", ok: false }));
    return jsonResponse({ ok: false, service: SERVICE_NAME }, 503);
  }
}

export async function handleGatekeeperRequest(
  request: Request,
  env: GuildEnv,
  dependencies: RequestDependencies = requestDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/federation/v1/deliveries" ||
      path === "/api/federation/v1/revocations") {
    return dependencies.handleFederation(request, env);
  }
  return handleHealthRequest(request, env, dependencies.readinessProbe);
}

interface MaintenanceDependencies {
  deleteFiles: typeof drainKnowledgeFileDeletionQueue;
  drainWorkflows: typeof drainAgentWorkflowOutbox;
  drainEmbeddings: typeof drainMemoryEmbeddingJobs;
  scanMemory: typeof scanMemoryHealth;
  drainExports: typeof drainDataExportJobs;
  drainAutomation: typeof drainAutomationRuns;
  drainRetention: typeof drainRetentionRuns;
  drainFederation: typeof drainGuildFederationOutbound;
  now: () => number;
  info: (message: string) => void;
  error: (message: string) => void;
}

const maintenanceDependencies: MaintenanceDependencies = {
  deleteFiles: drainKnowledgeFileDeletionQueue,
  drainWorkflows: drainAgentWorkflowOutbox,
  drainEmbeddings: drainMemoryEmbeddingJobs,
  scanMemory: scanMemoryHealth,
  drainExports: drainDataExportJobs,
  drainAutomation: drainAutomationRuns,
  drainRetention: drainRetentionRuns,
  drainFederation: drainGuildFederationOutbound,
  now: Date.now,
  info: (message) => console.info(message),
  error: (message) => console.error(message),
};

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? name : "UnknownError";
}

export async function runGuildMaintenance(
  env: GuildEnv,
  dependencies: MaintenanceDependencies = maintenanceDependencies,
): Promise<void> {
  const startedAt = dependencies.now();
  try {
    const [files, workflowMessages, embeddings, memoryHealth, dataExports, automation, retention,
      federation] = await Promise.all([
      dependencies.deleteFiles(env),
      dependencies.drainWorkflows(env),
      dependencies.drainEmbeddings(env),
      dependencies.scanMemory(env),
      dependencies.drainExports(env),
      dependencies.drainAutomation(env),
      dependencies.drainRetention(env),
      dependencies.drainFederation(env),
    ]);
    dependencies.info(JSON.stringify({
      event: "guild.maintenance",
      ok: true,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      files,
      workflowMessages,
      embeddings,
      memoryHealth,
      dataExports,
      automation: {
        processed: automation.filter((item) => item.status !== "idle").length,
        dispatched: automation.filter((item) => item.status === "dispatched").length,
      },
      retention: {
        processed: retention.length,
        completed: retention.filter((item) => item.status === "completed").length,
        failed: retention.filter((item) => item.status === "failed").length,
        leaseLost: retention.filter((item) => item.status === "lease_lost").length,
      },
      federation: { status: federation.status },
    }));
  } catch (error) {
    dependencies.error(JSON.stringify({
      event: "guild.maintenance",
      ok: false,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      errorType: safeErrorType(error),
    }));
    throw error;
  }
}

export default {
  async fetch(request: Request, env: GuildEnv): Promise<Response> {
    return handleGatekeeperRequest(request, env);
  },
  async scheduled(
    _controller: ScheduledController,
    env: GuildEnv,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(runGuildMaintenance(env));
  },
} satisfies ExportedHandler<GuildEnv>;
