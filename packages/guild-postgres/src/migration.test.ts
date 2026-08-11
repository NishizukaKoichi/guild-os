import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001_guild_core.sql", import.meta.url);
const productMigrationUrl = new URL("../migrations/0002_product_v1.sql", import.meta.url);
const governanceMigrationUrl = new URL("../migrations/0003_identity_governance.sql", import.meta.url);
const identityIntegrityMigrationUrl = new URL("../migrations/0004_identity_profile_integrity.sql", import.meta.url);
const knowledgeMigrationUrl = new URL("../migrations/0006_knowledge_lifecycle.sql", import.meta.url);
const knowledgeFileReuseMigrationUrl = new URL("../migrations/0007_knowledge_file_version_reuse.sql", import.meta.url);
const humanApprovalMigrationUrl = new URL("../migrations/0008_human_approval_boundary.sql", import.meta.url);
const knowledgeFilePolicyMigrationUrl = new URL("../migrations/0009_knowledge_file_policy_history.sql", import.meta.url);
const knowledgeSecurityLockMigrationUrl = new URL("../migrations/0010_published_knowledge_security_lock.sql", import.meta.url);
const workGovernanceMigrationUrl = new URL("../migrations/0011_work_governance.sql", import.meta.url);
const workConcurrencyMigrationUrl = new URL("../migrations/0012_work_parent_concurrency.sql", import.meta.url);

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

  it("keeps Knowledge versions, reviews, and file boundaries durable", async () => {
    const sql = await readFile(fileURLToPath(knowledgeMigrationUrl), "utf8");
    expect(sql).toContain("knowledge_one_working_version_idx");
    expect(sql).toContain("knowledge_version_immutable_content");
    expect(sql).toContain("knowledge_review_no_update_or_delete");
    expect(sql).toContain("knowledge_file_boundary");
    expect(sql).toContain("ALTER TABLE knowledge_reviews FORCE ROW LEVEL SECURITY");
    const reuseSql = await readFile(fileURLToPath(knowledgeFileReuseMigrationUrl), "utf8");
    expect(reuseSql).toContain("A file cannot cross Knowledge records");
    const approvalSql = await readFile(fileURLToPath(humanApprovalMigrationUrl), "utf8");
    expect(approvalSql).toContain("'knowledge.approve', 'decision.approve'");
    const policySql = await readFile(fileURLToPath(knowledgeFilePolicyMigrationUrl), "utf8");
    expect(policySql).toContain("immutable security boundary from its original upload");
    expect(policySql).toContain("A file cannot cross Knowledge records");
    const securityLockSql = await readFile(fileURLToPath(knowledgeSecurityLockMigrationUrl), "utf8");
    expect(securityLockSql).toContain("Published Knowledge security boundary is immutable");
    const workSql = await readFile(fileURLToPath(workGovernanceMigrationUrl), "utf8");
    expect(workSql).toContain("Child Work cannot broaden its parent Space boundary");
    expect(workSql).toContain("Work can be assigned only to an active Human or Agent");
    expect(workSql).toContain("Work version must increment exactly once");
    const concurrencySql = await readFile(fileURLToPath(workConcurrencyMigrationUrl), "utf8");
    expect(concurrencySql).toContain("Terminal Work cannot accept or reactivate child Work");
    expect(concurrencySql).toContain("Terminal Work requires every child Work item to be terminal");
  });
});
