import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_GUILD_SCHEMA_CHECKSUM,
  CURRENT_GUILD_SCHEMA_MIGRATION,
} from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import {
  handleHealthRequest,
  handleGatekeeperRequest,
  runGuildMaintenance,
} from "../src/index.js";

const env = {} as GuildEnv;

describe("Guild Gatekeeper operations", () => {
  it("exposes only strict liveness and readiness endpoints", async () => {
    const health = await handleHealthRequest(
      new Request("https://gatekeeper.example/healthz"),
      env,
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      ok: true,
      service: "guild-gatekeeper",
    });
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");

    const missing = await handleHealthRequest(
      new Request("https://gatekeeper.example/anything-else"),
      env,
    );
    expect(missing.status).toBe(404);

    const invalidMethod = await handleHealthRequest(
      new Request("https://gatekeeper.example/readyz", { method: "POST" }),
      env,
    );
    expect(invalidMethod.status).toBe(405);
    expect(invalidMethod.headers.get("allow")).toBe("GET");
  });

  it("reports ready only for the exact application schema", async () => {
    const ready = await handleHealthRequest(
      new Request("https://gatekeeper.example/readyz"),
      env,
      async () => ({
        name: CURRENT_GUILD_SCHEMA_MIGRATION,
        checksum: CURRENT_GUILD_SCHEMA_CHECKSUM,
      }),
    );
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({
      ok: true,
      service: "guild-gatekeeper",
    });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stale = await handleHealthRequest(
      new Request("https://gatekeeper.example/readyz"),
      env,
      async () => ({
        name: CURRENT_GUILD_SCHEMA_MIGRATION,
        checksum: "0".repeat(64),
      }),
    );
    expect(stale.status).toBe(503);
    await expect(stale.json()).resolves.toEqual({
      ok: false,
      service: "guild-gatekeeper",
    });
    expect(error).toHaveBeenCalledWith(JSON.stringify({
      event: "guild.readiness",
      ok: false,
    }));
    error.mockRestore();
  });

  it("routes only signed Federation endpoints to the Federation runtime", async () => {
    const federation = vi.fn(async () => new Response("federation", { status: 202 }));
    const readiness = vi.fn(async () => ({
      name: CURRENT_GUILD_SCHEMA_MIGRATION,
      checksum: CURRENT_GUILD_SCHEMA_CHECKSUM,
    }));
    const response = await handleGatekeeperRequest(
      new Request("https://gatekeeper.example/api/federation/v1/deliveries", { method: "POST" }),
      env,
      { readinessProbe: readiness, handleFederation: federation },
    );
    expect(response.status).toBe(202);
    expect(federation).toHaveBeenCalledTimes(1);
    expect(readiness).not.toHaveBeenCalled();

    const missing = await handleGatekeeperRequest(
      new Request("https://gatekeeper.example/api/federation/v1/unknown", { method: "POST" }),
      env,
      { readinessProbe: readiness, handleFederation: federation },
    );
    expect(missing.status).toBe(404);
    expect(federation).toHaveBeenCalledTimes(1);
  });

  it("logs bounded maintenance counts without Guild content", async () => {
    const logs: string[] = [];
    const clock = [100, 135];
    const order: string[] = [];
    await runGuildMaintenance(env, {
      async deleteFiles() {
        order.push("files");
        return { expired: 3, claimed: 2, completed: 1, deferred: 1 };
      },
      async drainWorkflows() {
        order.push("workflows");
        return 4;
      },
      async drainEmbeddings() {
        order.push("embeddings");
        return 2;
      },
      async scanMemory() {
        order.push("memory-health");
        return { deterministic: 1, contradictions: 0 };
      },
      async drainExports() {
        order.push("exports");
        return { processed: 1, completed: 1, failed: 0, expired: 0 };
      },
      async drainAutomation() {
        order.push("automation");
        return [{ status: "dispatched", requestId: "request", agentRunId: "run", duplicate: false }];
      },
      async drainRetention() {
        order.push("retention");
        return [{
          status: "completed" as const,
          runId: "run",
          dryRun: true,
          candidateCount: 3,
          affectedCount: 0,
        }];
      },
      async drainFederation() {
        order.push("federation");
        return { status: "sent" as const, deliveryId: "delivery", remoteStatus: "accepted" as const };
      },
      now() {
        return clock.shift() ?? 135;
      },
      info(message) {
        logs.push(message);
      },
      error() {
        throw new Error("unexpected error log");
      },
    });

    expect(order).toEqual([
      "files",
      "workflows",
      "embeddings",
      "memory-health",
      "exports",
      "automation",
      "retention",
      "federation",
    ]);

    expect(logs).toEqual([JSON.stringify({
      event: "guild.maintenance",
      ok: true,
      durationMs: 35,
      files: { expired: 3, claimed: 2, completed: 1, deferred: 1 },
      workflowMessages: 4,
      embeddings: 2,
      memoryHealth: { deterministic: 1, contradictions: 0 },
      dataExports: { processed: 1, completed: 1, failed: 0, expired: 0 },
      automation: { processed: 1, dispatched: 1 },
      retention: { processed: 1, completed: 1, failed: 0, leaseLost: 0 },
      federation: { status: "sent" },
    })]);
  });

  it("logs only the error type when maintenance fails", async () => {
    const logs: string[] = [];
    await expect(runGuildMaintenance(env, {
      async deleteFiles() {
        throw new TypeError("private object title and secret token");
      },
      async drainWorkflows() {
        return 0;
      },
      async drainEmbeddings() {
        return 0;
      },
      async scanMemory() {
        return { deterministic: 0, contradictions: 0 };
      },
      async drainExports() {
        return { processed: 0, completed: 0, failed: 0, expired: 0 };
      },
      async drainAutomation() {
        return [{ status: "idle" }];
      },
      async drainRetention() {
        return [];
      },
      async drainFederation() {
        return { status: "idle" as const };
      },
      now: () => 100,
      info() {
        throw new Error("unexpected info log");
      },
      error(message) {
        logs.push(message);
      },
    })).rejects.toThrow("private object title");

    expect(logs).toEqual([JSON.stringify({
      event: "guild.maintenance",
      ok: false,
      durationMs: 0,
      errorType: "TypeError",
    })]);
    expect(logs[0]).not.toContain("private object title");
    expect(logs[0]).not.toContain("secret token");
  });
});
