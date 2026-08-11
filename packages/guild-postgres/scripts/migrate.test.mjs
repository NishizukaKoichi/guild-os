import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations, migrationChecksum } from "./migrate.mjs";

test("migration checksums are deterministic and content-sensitive", () => {
  assert.equal(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 1"));
  assert.notEqual(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 2"));
});

test("migration files load in lexical order with SHA-256 checksums", async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.name), ["0001_guild_core.sql"]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[0].sql, /CREATE TABLE guilds/);
});
