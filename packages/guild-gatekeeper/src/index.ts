export * from "./guild.js";
export { AgentExecutionWorkflow } from "./agent-workflow.js";

import {
  CURRENT_GUILD_SCHEMA_CHECKSUM,
  CURRENT_GUILD_SCHEMA_MIGRATION,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import { drainKnowledgeFileDeletionQueue } from "./knowledge-service.js";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";

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

interface MaintenanceDependencies {
  deleteFiles: typeof drainKnowledgeFileDeletionQueue;
  drainWorkflows: typeof drainAgentWorkflowOutbox;
  now: () => number;
  info: (message: string) => void;
  error: (message: string) => void;
}

const maintenanceDependencies: MaintenanceDependencies = {
  deleteFiles: drainKnowledgeFileDeletionQueue,
  drainWorkflows: drainAgentWorkflowOutbox,
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
    const [files, workflowMessages] = await Promise.all([
      dependencies.deleteFiles(env),
      dependencies.drainWorkflows(env),
    ]);
    dependencies.info(JSON.stringify({
      event: "guild.maintenance",
      ok: true,
      durationMs: Math.max(0, dependencies.now() - startedAt),
      files,
      workflowMessages,
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
    return handleHealthRequest(request, env);
  },
  async scheduled(
    _controller: ScheduledController,
    env: GuildEnv,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(runGuildMaintenance(env));
  },
} satisfies ExportedHandler<GuildEnv>;
