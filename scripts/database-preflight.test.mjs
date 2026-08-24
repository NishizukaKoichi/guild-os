import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDatabasePreflight,
  assertLegacyRoleSeparationSnapshot,
  assertMigrationReadiness,
  assertRuntimeRoleName,
  assertRuntimeRolePreflight,
  assertVerifiedTlsConfiguration,
  hasVerifiedClientTls,
  provisionRuntimeDatabaseRole,
  separateLegacyDatabaseRoles,
  verifyDatabaseMigrationReadiness,
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

function runtimeSnapshot() {
  return {
    exists: true,
    canLogin: true,
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDatabase: false,
    replication: false,
    publicUsage: true,
    publicCreate: false,
    runtimeUsage: true,
    runtimeCreate: false,
    ledgerRead: true,
    ledgerWrite: false,
    applicationTableCount: 10,
    applicationDml: true,
    runtimeFunctionExecute: true,
  };
}

function legacyRoleSeparationSnapshot() {
  return {
    adminRole: "provider_admin",
    adminCreateRole: true,
    managementRole: "guild_schema_manager",
    runtimeRole: "guild_runtime_app",
    management: {
      exists: true,
      canLogin: true,
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      memberships: [],
    },
    runtime: {
      exists: true,
      canLogin: true,
      superuser: false,
      bypassRls: false,
      createRole: false,
      createDatabase: false,
      replication: false,
      memberships: [],
    },
    migrationLedgerExists: true,
    guildTableExists: true,
    applicationObjectCount: 12,
    managementOwnedObjectCount: 0,
    runtimeOwnedObjectCount: 12,
    unexpectedRuntimeOwnedObjectCount: 0,
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
    bypassRls: true,
  }, migrations), /BYPASSRLS/i);
  assert.doesNotThrow(() => assertDatabasePreflight({
    ...snapshot(),
    bypassRls: true,
  }, migrations, { allowManagementBypassRls: true }));
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

function migrationReadinessSnapshot(overrides = {}) {
  return {
    serverVersionNum: 170_004,
    ssl: true,
    superuser: false,
    bypassRls: false,
    databaseCreate: true,
    publicUsage: true,
    publicCreate: true,
    migrationLedgerExists: true,
    guildTableExists: true,
    runtimeSchemaExists: true,
    migrations: [structuredClone(migrations[0])],
    availableExtensions: ["pg_trgm", "pgcrypto", "vector"],
    ...overrides,
  };
}

test("migration readiness accepts fresh databases and exact migration prefixes", () => {
  assert.doesNotThrow(() => assertMigrationReadiness(migrationReadinessSnapshot(), migrations));
  assert.doesNotThrow(() => assertMigrationReadiness(migrationReadinessSnapshot({
    migrationLedgerExists: false,
    guildTableExists: false,
    runtimeSchemaExists: false,
    migrations: [],
  }), migrations));
  assert.throws(() => assertMigrationReadiness(migrationReadinessSnapshot({
    migrations: [{ ...migrations[0], checksum: "c".repeat(64) }],
  }), migrations), /migration mismatch/i);
  assert.throws(() => assertMigrationReadiness(migrationReadinessSnapshot({
    migrationLedgerExists: false,
    migrations: [],
  }), migrations), /without a trusted migration ledger/i);
  assert.throws(() => assertMigrationReadiness(migrationReadinessSnapshot({
    migrations: [],
  }), migrations), /ledger and Core schema objects are inconsistent/i);
  assert.throws(() => assertMigrationReadiness(migrationReadinessSnapshot({
    guildTableExists: false,
  }), migrations), /ledger and Core schema objects are inconsistent/i);
  assert.throws(() => assertMigrationReadiness(migrationReadinessSnapshot({
    availableExtensions: ["pg_trgm", "pgcrypto"],
  }), migrations), /vector/i);
});

test("migration readiness inspects the live connection without requiring completed schema", async () => {
  const queries = [];
  const client = {
    connection: { stream: { encrypted: true, authorized: true } },
    async connect() {},
    async end() {},
    async query(statement) {
      queries.push(statement);
      if (statement.includes("current_setting('server_version_num')")) {
        return { rows: [{
          server_version_num: 170_004,
          ssl: false,
          superuser: false,
          bypass_rls: false,
          database_create: true,
          public_usage: true,
          public_create: true,
          migration_ledger_exists: false,
          guild_table_exists: false,
          runtime_schema_exists: false,
        }] };
      }
      if (statement.includes("pg_available_extensions")) {
        return { rows: [{ name: "pg_trgm" }, { name: "pgcrypto" }, { name: "vector" }] };
      }
      return { rows: [] };
    },
  };
  const result = await verifyDatabaseMigrationReadiness(
    "postgresql://guild_app@127.0.0.1/guild_os",
    { allowInsecureLocalhost: true, client },
  );
  assert.equal(result.freshDatabase, true);
  assert.equal(result.appliedMigrationCount, 0);
  assert.equal(result.pendingMigrationCount > 0, true);
  assert.equal(queries.some((statement) => statement.includes("guild_schema_migrations\n")), false);
});

test("Runtime role preflight enforces least privilege and application access", () => {
  assert.doesNotThrow(() => assertRuntimeRoleName("guild_runtime_app"));
  assert.throws(() => assertRuntimeRoleName("Guild Runtime"), /simple PostgreSQL role name/i);
  assert.doesNotThrow(() => assertRuntimeRolePreflight(runtimeSnapshot()));
  assert.throws(() => assertRuntimeRolePreflight({
    ...runtimeSnapshot(),
    bypassRls: true,
  }), /privileged/i);
  assert.throws(() => assertRuntimeRolePreflight({
    ...runtimeSnapshot(),
    publicCreate: true,
  }), /schema boundary/i);
  assert.throws(() => assertRuntimeRolePreflight({
    ...runtimeSnapshot(),
    ledgerWrite: true,
  }), /migration ledger/i);
  assert.throws(() => assertRuntimeRolePreflight({
    ...runtimeSnapshot(),
    applicationDml: false,
  }), /application table privileges/i);
});

test("Runtime provisioning applies least-privilege grants in one transaction", async () => {
  const statements = [];
  const client = {
    async connect() {},
    async end() {},
    async query(statement) {
      statements.push(statement);
      if (statement.includes("current_user AS management_role")) {
        return { rows: [{
          management_role: "guild_app",
          database_name: "guild_os",
          runtime_exists: true,
          runtime_can_login: true,
          runtime_superuser: false,
          runtime_bypass_rls: false,
          management_superuser: false,
          management_bypass_rls: false,
        }] };
      }
      return { rows: [] };
    },
  };
  await provisionRuntimeDatabaseRole(
    "postgresql://guild_app:secret@127.0.0.1/guild_os",
    "guild_runtime_app",
    { allowInsecureLocalhost: true, client },
  );
  assert.equal(statements.includes("BEGIN"), true);
  assert.equal(statements.includes("COMMIT"), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(statements.some((statement) => statement.includes(
    "REVOKE ALL PRIVILEGES ON TABLE public.guild_schema_migrations FROM \"guild_runtime_app\"",
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    "ALTER DEFAULT PRIVILEGES FOR ROLE \"guild_app\"",
  )), true);
});

test("legacy role separation rejects privileged or unexpectedly owned targets", () => {
  assert.doesNotThrow(() => assertLegacyRoleSeparationSnapshot(
    legacyRoleSeparationSnapshot(),
  ));
  assert.throws(() => assertLegacyRoleSeparationSnapshot({
    ...legacyRoleSeparationSnapshot(),
    management: { ...legacyRoleSeparationSnapshot().management, bypassRls: true },
  }), /privileged/i);
  assert.throws(() => assertLegacyRoleSeparationSnapshot({
    ...legacyRoleSeparationSnapshot(),
    management: {
      ...legacyRoleSeparationSnapshot().management,
      memberships: ["provider_superuser"],
    },
  }), /privileged/i);
  assert.throws(() => assertLegacyRoleSeparationSnapshot({
    ...legacyRoleSeparationSnapshot(),
    managementOwnedObjectCount: 1,
    runtimeOwnedObjectCount: 10,
  }), /unexpected owner/i);
  assert.throws(() => assertLegacyRoleSeparationSnapshot({
    ...legacyRoleSeparationSnapshot(),
    unexpectedRuntimeOwnedObjectCount: 1,
  }), /outside the bounded Guild OS upgrade scope/i);
});

test("legacy role separation transfers ownership and preserves Runtime access atomically", async () => {
  const statements = [];
  const client = {
    async connect() {},
    async end() {},
    async query(statement) {
      statements.push(statement);
      if (statement.includes("current_user AS admin_role")) {
        return { rows: [{
          admin_role: "provider_admin",
          database_name: "guild_os",
          admin_create_role: true,
          management_exists: true,
          management_can_login: true,
          management_superuser: false,
          management_bypass_rls: false,
          management_create_role: false,
          management_create_database: false,
          management_replication: false,
          management_memberships: [],
          runtime_exists: true,
          runtime_can_login: true,
          runtime_superuser: false,
          runtime_bypass_rls: false,
          runtime_create_role: false,
          runtime_create_database: false,
          runtime_replication: false,
          runtime_memberships: [],
          admin_member_management: false,
          admin_member_runtime: true,
          admin_set_management: false,
          admin_set_runtime: false,
          migration_ledger_exists: true,
          guild_table_exists: true,
        }] };
      }
      if (statement.includes("WITH application_objects AS")) {
        return { rows: [{
          application_object_count: 120,
          management_owned_object_count: 0,
          runtime_owned_object_count: 120,
        }] };
      }
      if (statement.includes("WITH runtime_role AS")) {
        return { rows: [{ unexpected_runtime_owned_object_count: 0 }] };
      }
      return { rows: [] };
    },
  };
  const result = await separateLegacyDatabaseRoles(
    "postgresql://provider_admin:secret@127.0.0.1/guild_os",
    "guild_schema_manager",
    "guild_runtime_app",
    { allowInsecureLocalhost: true, client },
  );
  assert.deepEqual(result, {
    ok: true,
    managementRole: "guild_schema_manager",
    runtimeRole: "guild_runtime_app",
    transferredObjectCount: 120,
    alreadySeparated: false,
  });
  assert.equal(statements.includes("BEGIN"), true);
  assert.equal(statements.includes("COMMIT"), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(statements.some((statement) => statement.includes(
    'REASSIGN OWNED BY "guild_runtime_app" TO "guild_schema_manager"',
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    'REVOKE CREATE ON SCHEMA public, guild_runtime FROM "guild_runtime_app"',
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    'ALTER DEFAULT PRIVILEGES FOR ROLE "guild_schema_manager"',
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    'REVOKE "guild_schema_manager" FROM "provider_admin"',
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    'GRANT "guild_runtime_app" TO "provider_admin" WITH SET FALSE',
  )), true);
  assert.equal(statements.some((statement) => statement.includes(
    'REVOKE "guild_runtime_app" FROM "provider_admin"',
  )), false);
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
