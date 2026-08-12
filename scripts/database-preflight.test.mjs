import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDatabasePreflight,
  assertVerifiedTlsConfiguration,
  hasVerifiedClientTls,
} from "./database-preflight.mjs";

const migrations = [
  { name: "0001_initial.sql", checksum: "a".repeat(64) },
  { name: "0002_current.sql", checksum: "b".repeat(64) },
];

function snapshot() {
  return {
    serverVersionNum: 170_004,
    ssl: true,
    superuser: false,
    bypassRls: false,
    migrations: structuredClone(migrations),
    tables: [
      { name: "guild_schema_migrations", rls: false, forcedRls: false },
      { name: "guilds", rls: true, forcedRls: true },
      { name: "chronicle_events", rls: true, forcedRls: true },
    ],
  };
}

test("database preflight requires exact migrations and forced RLS", () => {
  assert.doesNotThrow(() => assertDatabasePreflight(snapshot(), migrations));
  assert.throws(() => assertDatabasePreflight({
    ...snapshot(),
    migrations: [{ ...migrations[0], checksum: "c".repeat(64) }, migrations[1]],
  }, migrations), /migration mismatch/i);
  assert.throws(() => assertDatabasePreflight({
    ...snapshot(),
    tables: [{ name: "guilds", rls: true, forcedRls: false }],
  }, migrations), /row-level security/i);
});

test("database preflight rejects privileged, old, or plaintext production connections", () => {
  assert.throws(() => assertDatabasePreflight({
    ...snapshot(),
    superuser: true,
  }, migrations), /superuser/i);
  assert.throws(() => assertDatabasePreflight({
    ...snapshot(),
    serverVersionNum: 160_010,
  }, migrations), /PostgreSQL 17/i);
  assert.throws(() => assertDatabasePreflight({
    ...snapshot(),
    ssl: false,
  }, migrations), /TLS/i);
  assert.doesNotThrow(() => assertDatabasePreflight({
    ...snapshot(),
    ssl: false,
  }, migrations, { allowInsecureLocalhost: true, localDatabase: true }));
});

test("client TLS evidence requires encryption and certificate authorization", () => {
  assert.equal(hasVerifiedClientTls({
    connection: { stream: { encrypted: true, authorized: true } },
  }), true);
  assert.equal(hasVerifiedClientTls({
    connection: { stream: { encrypted: true, authorized: false } },
  }), false);
  assert.equal(hasVerifiedClientTls({
    connection: { stream: { encrypted: false, authorized: true } },
  }), false);
  assert.equal(hasVerifiedClientTls({}), false);
});

test("production database URL requires explicit certificate verification", () => {
  assert.doesNotThrow(() => assertVerifiedTlsConfiguration(
    "postgresql://user:pass@example.invalid/guild_os?sslmode=verify-full",
  ));
  assert.throws(() => assertVerifiedTlsConfiguration(
    "postgresql://user:pass@example.invalid/guild_os?sslmode=require",
  ), /verify-full/i);
  assert.throws(() => assertVerifiedTlsConfiguration(
    "postgresql://user:pass@example.invalid/guild_os?sslmode=verify-full&uselibpqcompat=false",
  ), /verify-full/i);
  assert.doesNotThrow(() => assertVerifiedTlsConfiguration(
    "postgresql://user:pass@127.0.0.1/guild_os",
    { allowInsecureLocalhost: true },
  ));
});
