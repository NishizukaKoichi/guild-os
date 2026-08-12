import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_GUILD_SCHEMA_CHECKSUM,
  CURRENT_GUILD_SCHEMA_MIGRATION,
} from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import {
  handleHealthRequest,
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

  it("logs bounded maintenance counts without Guild content", async () => {
    const logs: string[] = [];
    const clock = [100, 135];
    await runGuildMaintenance(env, {
      async deleteFiles() {
        return { expired: 3, claimed: 2, completed: 1, deferred: 1 };
      },
      async drainWorkflows() {
        return 4;
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

    expect(logs).toEqual([JSON.stringify({
      event: "guild.maintenance",
      ok: true,
      durationMs: 35,
      files: { expired: 3, claimed: 2, completed: 1, deferred: 1 },
      workflowMessages: 4,
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
