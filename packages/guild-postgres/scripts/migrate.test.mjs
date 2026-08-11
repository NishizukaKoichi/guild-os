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
  ]);
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
  assert.match(migrations[0].sql, /CREATE TABLE guilds/);
  assert.match(migrations[1].sql, /CREATE TABLE guild_invitations/);
  assert.match(migrations[2].sql, /role_binding_machine_boundary/);
  assert.match(migrations[3].sql, /identity_agent_profile_pair/);
  assert.match(migrations[4].sql, /CREATE OR REPLACE FUNCTION/);
});
