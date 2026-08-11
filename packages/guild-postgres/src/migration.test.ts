import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001_guild_core.sql", import.meta.url);

describe("Guild PostgreSQL migration", () => {
  it("covers every v1 aggregate and applies Guild row-level security", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
    const tables = [
      "guilds",
      "identities",
      "constitutions",
      "spaces",
      "memberships",
      "roles",
      "knowledge",
      "knowledge_versions",
      "goals",
      "projects",
      "quests",
      "steps",
      "decisions",
      "agent_profiles",
      "agent_runs",
      "approval_requests",
      "connectors",
      "relations",
      "chronicle_events",
      "outbox",
    ];
    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("guild_runtime.current_guild_id()");
  });

  it("makes Chronicle immutable and external writes idempotent", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON chronicle_events");
    expect(sql).toContain("UNIQUE (guild_id, idempotency_key)");
  });
});
