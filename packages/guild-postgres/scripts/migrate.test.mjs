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
});
