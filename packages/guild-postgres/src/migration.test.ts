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
const decisionGovernanceMigrationUrl = new URL("../migrations/0013_decision_governance.sql", import.meta.url);
const decisionApprovalScaleMigrationUrl = new URL("../migrations/0014_decision_approval_scale.sql", import.meta.url);
const decisionTerminalIntegrityMigrationUrl = new URL("../migrations/0015_decision_terminal_integrity.sql", import.meta.url);
const communicationsMigrationUrl = new URL("../migrations/0016_communications_and_chronicle.sql", import.meta.url);
const chronicleSearchMigrationUrl = new URL("../migrations/0017_chronicle_search_tokens.sql", import.meta.url);
const announcementProvenanceMigrationUrl = new URL("../migrations/0018_archived_announcement_provenance.sql", import.meta.url);
const constitutionGovernanceMigrationUrl = new URL("../migrations/0022_constitution_governance.sql", import.meta.url);
const rootOwnershipTransferMigrationUrl = new URL("../migrations/0023_root_ownership_transfer.sql", import.meta.url);
const breakGlassRecoveryMigrationUrl = new URL("../migrations/0024_break_glass_recovery.sql", import.meta.url);
const conversationGovernanceMigrationUrl = new URL("../migrations/0025_context_bound_conversations.sql", import.meta.url);

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
    const decisionSql = await readFile(fileURLToPath(decisionGovernanceMigrationUrl), "utf8");
    expect(decisionSql).toContain("Decision options are immutable after proposal");
    expect(decisionSql).toContain("Decision approval requires an authorized active Human");
    expect(decisionSql).toContain("Decision approval quorum has not been reached");
    const decisionScaleSql = await readFile(fileURLToPath(decisionApprovalScaleMigrationUrl), "utf8");
    expect(decisionScaleSql).toContain("decisions_required_approvals_check CHECK (required_approvals > 0)");
    expect(decisionScaleSql).toContain("decisions_approval_count_check CHECK (approval_count >= 0)");
    const decisionTerminalSql = await readFile(fileURLToPath(decisionTerminalIntegrityMigrationUrl), "utf8");
    expect(decisionTerminalSql).toContain("A terminal Decision result is immutable");
    expect(decisionTerminalSql).toContain("must preserve the original security boundary");
    const communicationsSql = await readFile(fileURLToPath(communicationsMigrationUrl), "utf8");
    expect(communicationsSql).toContain("Published Announcement content and audience are immutable");
    expect(communicationsSql).toContain("Inbox notification payload is immutable");
    expect(communicationsSql).toContain("chronicle_search_idx");
    expect(communicationsSql).toContain("'announcement.manage'");
    const chronicleSearchSql = await readFile(fileURLToPath(chronicleSearchMigrationUrl), "utf8");
    expect(chronicleSearchSql).toContain("translate(action, '._-', '   ')");
    const announcementProvenanceSql = await readFile(
      fileURLToPath(announcementProvenanceMigrationUrl),
      "utf8",
    );
    expect(announcementProvenanceSql).toContain("OR status = 'archived'");
    expect(announcementProvenanceSql).toContain("published_at IS NULL AND expires_at > created_at");
    const constitutionSql = await readFile(
      fileURLToPath(constitutionGovernanceMigrationUrl),
      "utf8",
    );
    expect(constitutionSql).toContain("role_permissions_no_root_authority");
    expect(constitutionSql).toContain("app.actor_identity_id");
    expect(constitutionSql).toContain("Constitution version must increment exactly once");
    expect(constitutionSql).toContain("A Guild Constitution cannot be deleted");
    const rootOwnershipSql = await readFile(
      fileURLToPath(rootOwnershipTransferMigrationUrl),
      "utf8",
    );
    expect(rootOwnershipSql).toContain("Root ownership change requires an accepted two-party transfer");
    expect(rootOwnershipSql).toContain("Root ownership transfer requires an atomic Chronicle event");
    expect(rootOwnershipSql).toContain("A Role in a pending Root ownership transfer is immutable");
    expect(rootOwnershipSql).toContain("identities_active_human_name_search_idx");
    expect(rootOwnershipSql).toContain("root_owner_change_committed");
    const recoverySql = await readFile(
      fileURLToPath(breakGlassRecoveryMigrationUrl),
      "utf8",
    );
    expect(recoverySql).toContain("CREATE TABLE break_glass_code_sets");
    expect(recoverySql).toContain("CREATE TABLE break_glass_recoveries");
    expect(recoverySql).toContain("Break Glass recovery did not complete atomically");
    expect(recoverySql).toContain("Root ownership change requires one authorized governance path");
    expect(recoverySql).toContain("Root ownership change must invalidate existing Break Glass codes");
    expect(recoverySql).toContain("NEW.state = 'superseded'");
    const conversationSql = await readFile(
      fileURLToPath(conversationGovernanceMigrationUrl),
      "utf8",
    );
    expect(conversationSql).toContain("conversations_one_thread_per_subject_idx");
    expect(conversationSql).toContain("identity_can_access_conversation_subject");
    expect(conversationSql).toContain("Conversation mutation requires an atomic Chronicle event");
    expect(conversationSql).toContain("Conversation messages are append-only");
  });
});
