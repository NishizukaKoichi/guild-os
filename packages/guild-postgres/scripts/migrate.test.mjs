import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations, migrationChecksum } from "./migrate.mjs";

test("migration checksums are deterministic and content-sensitive", () => {
  assert.equal(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 1"));
  assert.notEqual(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 2"));
});

test("migration files load in lexical order with SHA-256 checksums", async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.name), [
    "0001_guild_core.sql",
    "0002_product_v1.sql",
    "0003_identity_governance.sql",
    "0004_identity_profile_integrity.sql",
    "0005_fix_identity_pair_triggers.sql",
    "0006_knowledge_lifecycle.sql",
    "0007_knowledge_file_version_reuse.sql",
    "0008_human_approval_boundary.sql",
    "0009_knowledge_file_policy_history.sql",
    "0010_published_knowledge_security_lock.sql",
    "0011_work_governance.sql",
    "0012_work_parent_concurrency.sql",
    "0013_decision_governance.sql",
    "0014_decision_approval_scale.sql",
    "0015_decision_terminal_integrity.sql",
    "0016_communications_and_chronicle.sql",
    "0017_chronicle_search_tokens.sql",
    "0018_archived_announcement_provenance.sql",
    "0019_agent_execution.sql",
    "0020_agent_execution_compatibility.sql",
    "0021_agent_approval_trigger_fix.sql",
  ]);
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
  assert.match(migrations[0].sql, /CREATE TABLE guilds/);
  assert.match(migrations[1].sql, /CREATE TABLE guild_invitations/);
  assert.match(migrations[2].sql, /role_binding_machine_boundary/);
  assert.match(migrations[3].sql, /identity_agent_profile_pair/);
  assert.match(migrations[4].sql, /CREATE OR REPLACE FUNCTION/);
  assert.match(migrations[5].sql, /CREATE TABLE knowledge_reviews/);
  assert.match(migrations[6].sql, /A file cannot cross Knowledge records/);
  assert.match(migrations[7].sql, /knowledge\.approve/);
  assert.match(migrations[11].sql, /Terminal Work requires every child Work item to be terminal/);
  assert.match(migrations[12].sql, /Decision approval quorum has not been reached/);
  assert.match(migrations[13].sql, /decisions_approval_count_check CHECK \(approval_count >= 0\)/);
  assert.match(migrations[14].sql, /A terminal Decision result is immutable/);
  assert.match(migrations[15].sql, /Inbox notification payload is immutable/);
  assert.match(migrations[16].sql, /translate\(action, '\._-'/);
  assert.match(migrations[17].sql, /OR status = 'archived'/);
  assert.match(migrations[18].sql, /Agent approval requires an authorized active Human/);
  assert.match(migrations[19].sql, /secret_was_cleared_on_revoke/);
  assert.match(migrations[20].sql, /IF TG_TABLE_NAME = 'approval_votes'/);
});
