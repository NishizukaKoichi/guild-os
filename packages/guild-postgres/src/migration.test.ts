import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001_guild_core.sql", import.meta.url);
const productMigrationUrl = new URL("../migrations/0002_product_v1.sql", import.meta.url);
const governanceMigrationUrl = new URL("../migrations/0003_identity_governance.sql", import.meta.url);
const identityIntegrityMigrationUrl = new URL("../migrations/0004_identity_profile_integrity.sql", import.meta.url);

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

  it("adds the operational product aggregates with forced tenant isolation", async () => {
    const sql = await readFile(fileURLToPath(productMigrationUrl), "utf8");
    for (const table of [
      "guild_invitations",
      "announcements",
      "inbox_notifications",
      "knowledge_acknowledgements",
      "conversations",
      "conversation_messages",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("role_permissions_known_permission");
    expect(sql).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
  });

  it("enforces machine identity, Role, and Space invariants in PostgreSQL", async () => {
    const sql = await readFile(fileURLToPath(governanceMigrationUrl), "utf8");
    expect(sql).toContain("role_binding_machine_boundary");
    expect(sql).toContain("role_permission_set_nonempty");
    expect(sql).toContain("space_hierarchy_integrity");
    expect(sql).toContain("agent_profile_identity_kind");
    expect(sql).toContain("role_permissions_no_break_glass");
  });

  it("keeps Identity, Membership, and Agent profile state consistent", async () => {
    const sql = await readFile(fileURLToPath(identityIntegrityMigrationUrl), "utf8");
    expect(sql).toContain("agent_tool_ids_valid");
    expect(sql).toContain("identity_membership_pair");
    expect(sql).toContain("identity_agent_profile_pair");
  });
});
