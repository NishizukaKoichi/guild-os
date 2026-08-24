import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadMigrations } from "../packages/guild-postgres/scripts/migrate.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postgresRequire = createRequire(join(
  repositoryRoot,
  "packages/guild-postgres/package.json",
));
const { Client } = postgresRequire("pg");

function isLocalDatabase(connectionString) {
  const hostname = new URL(connectionString).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

export function assertVerifiedTlsConfiguration(connectionString, options = {}) {
  const parsed = new URL(connectionString);
  const localDatabase = isLocalDatabase(connectionString);
  if (localDatabase && options.allowInsecureLocalhost) return;
  if (parsed.searchParams.get("sslmode") !== "verify-full" ||
      parsed.searchParams.getAll("sslmode").length !== 1 ||
      parsed.searchParams.has("uselibpqcompat")) {
    throw new Error("Production DATABASE_URL must set exactly sslmode=verify-full.");
  }
}

export function hasVerifiedClientTls(client) {
  const stream = client?.connection?.stream;
  return stream?.encrypted === true && stream?.authorized === true;
}

export function assertRuntimeRoleName(roleName) {
  if (typeof roleName !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(roleName)) {
    throw new Error("GUILD_RUNTIME_DATABASE_ROLE must be a simple PostgreSQL role name.");
  }
}

export function assertLegacyRoleSeparationSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Legacy role separation could not inspect the database roles.");
  }
  if (!snapshot.adminRole || snapshot.adminRole === snapshot.managementRole ||
      snapshot.adminRole === snapshot.runtimeRole || !snapshot.adminCreateRole) {
    throw new Error("Legacy role separation requires a distinct provider administrator with CREATEROLE.");
  }
  for (const [label, role] of [
    ["management", snapshot.management],
    ["Runtime", snapshot.runtime],
  ]) {
    if (!role?.exists || !role.canLogin) {
      throw new Error(`The ${label} database role does not exist or cannot log in.`);
    }
    if (role.superuser || role.bypassRls || role.createRole || role.createDatabase ||
        role.replication || !Array.isArray(role.memberships) || role.memberships.length) {
      throw new Error(`The ${label} database role has privileged PostgreSQL authority.`);
    }
  }
  if (!snapshot.migrationLedgerExists || !snapshot.guildTableExists) {
    throw new Error("Legacy role separation requires an initialized Guild OS migration ledger.");
  }
  if (!Number.isSafeInteger(snapshot.applicationObjectCount) ||
      snapshot.applicationObjectCount < 1) {
    throw new Error("Legacy role separation found no Guild OS schema objects.");
  }
  if (!Number.isSafeInteger(snapshot.runtimeOwnedObjectCount) ||
      !Number.isSafeInteger(snapshot.managementOwnedObjectCount) ||
      snapshot.runtimeOwnedObjectCount + snapshot.managementOwnedObjectCount !==
        snapshot.applicationObjectCount) {
    throw new Error("Guild OS schema objects have an unexpected owner; no ownership was changed.");
  }
  if (!Number.isSafeInteger(snapshot.unexpectedRuntimeOwnedObjectCount) ||
      snapshot.unexpectedRuntimeOwnedObjectCount !== 0) {
    throw new Error("The legacy Runtime role owns objects outside the bounded Guild OS upgrade scope.");
  }
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== "string" || !identifier) {
    throw new Error("PostgreSQL identifier is required.");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function assertRuntimeRolePreflight(snapshot) {
  if (!snapshot || snapshot.exists !== true || snapshot.canLogin !== true) {
    throw new Error("The configured Runtime database role does not exist or cannot log in.");
  }
  if (snapshot.superuser || snapshot.bypassRls || snapshot.createRole ||
      snapshot.createDatabase || snapshot.replication) {
    throw new Error("The Runtime database role has privileged PostgreSQL authority.");
  }
  if (!snapshot.publicUsage || !snapshot.runtimeUsage || snapshot.publicCreate ||
      snapshot.runtimeCreate) {
    throw new Error("The Runtime database role has an unsafe schema boundary.");
  }
  if (!snapshot.ledgerRead || snapshot.ledgerWrite) {
    throw new Error("The Runtime database role requires read-only migration ledger access.");
  }
  if (!Number.isSafeInteger(snapshot.applicationTableCount) ||
      snapshot.applicationTableCount < 1 || !snapshot.applicationDml) {
    throw new Error("The Runtime database role is missing application table privileges.");
  }
  if (!snapshot.runtimeFunctionExecute) {
    throw new Error("The Runtime database role is missing governed function execution privileges.");
  }
}

export async function provisionRuntimeDatabaseRole(connectionString, roleName, options = {}) {
  assertRuntimeRoleName(roleName);
  assertVerifiedTlsConfiguration(connectionString, options);
  const client = options.client ?? new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  const runtimeRole = quoteIdentifier(roleName);
  await client.connect();
  try {
    await client.query("SET statement_timeout = '15s'");
    const identityResult = await client.query(`SELECT current_user AS management_role,
        current_database() AS database_name,
        runtime.rolname IS NOT NULL AS runtime_exists,
        COALESCE(runtime.rolcanlogin, false) AS runtime_can_login,
        COALESCE(runtime.rolsuper, false) AS runtime_superuser,
        COALESCE(runtime.rolbypassrls, false) AS runtime_bypass_rls,
        management.rolsuper AS management_superuser,
        management.rolbypassrls AS management_bypass_rls
      FROM pg_roles management
      LEFT JOIN pg_roles runtime ON runtime.rolname = $1
      WHERE management.rolname = current_user`, [roleName]);
    const identity = identityResult.rows[0];
    if (!identity || identity.management_superuser) {
      throw new Error("Runtime provisioning requires a non-superuser schema owner.");
    }
    if (!identity.runtime_exists || !identity.runtime_can_login ||
        identity.runtime_superuser || identity.runtime_bypass_rls) {
      throw new Error("The requested Runtime role is missing or privileged.");
    }
    const managementRole = quoteIdentifier(identity.management_role);
    const databaseName = quoteIdentifier(identity.database_name);
    await client.query("BEGIN");
    try {
      await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await client.query(`REVOKE CREATE ON SCHEMA public, guild_runtime FROM ${runtimeRole}`);
      await client.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${runtimeRole}`);
      await client.query(`GRANT USAGE ON SCHEMA public, guild_runtime TO ${runtimeRole}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole}`);
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.guild_schema_migrations FROM ${runtimeRole}`);
      await client.query(`GRANT SELECT ON TABLE public.guild_schema_migrations TO ${runtimeRole}`);
      await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${runtimeRole}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA guild_runtime TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA guild_runtime GRANT EXECUTE ON FUNCTIONS TO ${runtimeRole}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return { ok: true, runtimeRole: roleName };
  } finally {
    await client.end();
  }
}

export async function separateLegacyDatabaseRoles(
  connectionString,
  managementRoleName,
  runtimeRoleName,
  options = {},
) {
  assertRuntimeRoleName(managementRoleName);
  assertRuntimeRoleName(runtimeRoleName);
  if (managementRoleName === runtimeRoleName) {
    throw new Error("Management and Runtime database roles must be different.");
  }
  assertVerifiedTlsConfiguration(connectionString, options);
  const client = options.client ?? new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '30s'");
    const roleResult = await client.query(`SELECT
        current_user AS admin_role,
        current_database() AS database_name,
        admin.rolcreaterole AS admin_create_role,
        management.rolname IS NOT NULL AS management_exists,
        COALESCE(management.rolcanlogin, false) AS management_can_login,
        COALESCE(management.rolsuper, false) AS management_superuser,
        COALESCE(management.rolbypassrls, false) AS management_bypass_rls,
        COALESCE(management.rolcreaterole, false) AS management_create_role,
        COALESCE(management.rolcreatedb, false) AS management_create_database,
        COALESCE(management.rolreplication, false) AS management_replication,
        COALESCE((SELECT array_agg(parent.rolname::text ORDER BY parent.rolname::text)
          FROM pg_auth_members membership
          JOIN pg_roles parent ON parent.oid = membership.roleid
          WHERE membership.member = management.oid), '{}'::text[]) AS management_memberships,
        runtime.rolname IS NOT NULL AS runtime_exists,
        COALESCE(runtime.rolcanlogin, false) AS runtime_can_login,
        COALESCE(runtime.rolsuper, false) AS runtime_superuser,
        COALESCE(runtime.rolbypassrls, false) AS runtime_bypass_rls,
        COALESCE(runtime.rolcreaterole, false) AS runtime_create_role,
        COALESCE(runtime.rolcreatedb, false) AS runtime_create_database,
        COALESCE(runtime.rolreplication, false) AS runtime_replication,
        COALESCE((SELECT array_agg(parent.rolname::text ORDER BY parent.rolname::text)
          FROM pg_auth_members membership
          JOIN pg_roles parent ON parent.oid = membership.roleid
          WHERE membership.member = runtime.oid), '{}'::text[]) AS runtime_memberships,
        COALESCE(pg_has_role(current_user, management.oid, 'MEMBER'), false)
          AS admin_member_management,
        COALESCE(pg_has_role(current_user, runtime.oid, 'MEMBER'), false)
          AS admin_member_runtime,
        COALESCE(pg_has_role(current_user, management.oid, 'SET'), false)
          AS admin_set_management,
        COALESCE(pg_has_role(current_user, runtime.oid, 'SET'), false)
          AS admin_set_runtime,
        to_regclass('public.guild_schema_migrations') IS NOT NULL AS migration_ledger_exists,
        to_regclass('public.guilds') IS NOT NULL AS guild_table_exists
      FROM pg_roles admin
      LEFT JOIN pg_roles management ON management.rolname = $1
      LEFT JOIN pg_roles runtime ON runtime.rolname = $2
      WHERE admin.rolname = current_user`, [managementRoleName, runtimeRoleName]);
    const roles = roleResult.rows[0];
    if (!roles) throw new Error("Legacy role separation could not inspect the provider administrator.");
    const ownerResult = await client.query(`WITH application_objects AS (
        SELECT pg_get_userbyid(relation.relowner) AS owner
          FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname IN ('public', 'guild_runtime')
           AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        UNION ALL
        SELECT pg_get_userbyid(procedure.proowner) AS owner
          FROM pg_proc procedure
          JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         WHERE namespace.nspname = 'guild_runtime'
        UNION ALL
        SELECT pg_get_userbyid(type.typowner) AS owner
          FROM pg_type type
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
         WHERE namespace.nspname IN ('public', 'guild_runtime')
           AND type.typtype IN ('c', 'd', 'e', 'm', 'r')
           AND type.typisdefined
        UNION ALL
        SELECT pg_get_userbyid(namespace.nspowner) AS owner
          FROM pg_namespace namespace
         WHERE namespace.nspname = 'guild_runtime'
      )
      SELECT count(*)::integer AS application_object_count,
             count(*) FILTER (WHERE owner = $1)::integer AS management_owned_object_count,
             count(*) FILTER (WHERE owner = $2)::integer AS runtime_owned_object_count
        FROM application_objects`, [managementRoleName, runtimeRoleName]);
    const owners = ownerResult.rows[0];
    const ownershipScopeResult = await client.query(`WITH runtime_role AS (
        SELECT oid FROM pg_roles WHERE rolname = $1
      ), current_database_record AS (
        SELECT oid FROM pg_database WHERE datname = current_database()
      )
      SELECT count(*) FILTER (WHERE NOT (
        (dependency.classid = 'pg_class'::regclass AND EXISTS (
          SELECT 1 FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE relation.oid = dependency.objid
            AND namespace.nspname IN ('public', 'guild_runtime', 'pg_toast')
        )) OR
        (dependency.classid = 'pg_proc'::regclass AND EXISTS (
          SELECT 1 FROM pg_proc procedure
          JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
          WHERE procedure.oid = dependency.objid
            AND namespace.nspname = 'guild_runtime'
        )) OR
        (dependency.classid = 'pg_type'::regclass AND EXISTS (
          SELECT 1 FROM pg_type type
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
          WHERE type.oid = dependency.objid
            AND namespace.nspname IN ('public', 'guild_runtime', 'pg_toast')
        )) OR
        (dependency.classid = 'pg_namespace'::regclass AND EXISTS (
          SELECT 1 FROM pg_namespace namespace
          WHERE namespace.oid = dependency.objid
            AND namespace.nspname = 'guild_runtime'
        )) OR
        (dependency.classid = 'pg_extension'::regclass AND EXISTS (
          SELECT 1 FROM pg_extension extension
          WHERE extension.oid = dependency.objid
            AND extension.extname IN ('vector', 'pg_trgm', 'pgcrypto')
        )) OR
        (dependency.classid = 'pg_database'::regclass AND
          dependency.objid = (SELECT oid FROM current_database_record)) OR
        dependency.classid = 'pg_default_acl'::regclass
      ))::integer AS unexpected_runtime_owned_object_count
      FROM pg_shdepend dependency
      WHERE dependency.refobjid = (SELECT oid FROM runtime_role)
        AND dependency.deptype = 'o'
        AND (dependency.dbid = 0 OR
          dependency.dbid = (SELECT oid FROM current_database_record))`, [runtimeRoleName]);
    const ownershipScope = ownershipScopeResult.rows[0];
    const snapshot = {
      adminRole: roles.admin_role,
      adminCreateRole: roles.admin_create_role,
      adminMemberManagement: roles.admin_member_management,
      adminMemberRuntime: roles.admin_member_runtime,
      adminSetManagement: roles.admin_set_management,
      adminSetRuntime: roles.admin_set_runtime,
      databaseName: roles.database_name,
      managementRole: managementRoleName,
      runtimeRole: runtimeRoleName,
      management: {
        exists: roles.management_exists,
        canLogin: roles.management_can_login,
        superuser: roles.management_superuser,
        bypassRls: roles.management_bypass_rls,
        createRole: roles.management_create_role,
        createDatabase: roles.management_create_database,
        replication: roles.management_replication,
        memberships: roles.management_memberships,
      },
      runtime: {
        exists: roles.runtime_exists,
        canLogin: roles.runtime_can_login,
        superuser: roles.runtime_superuser,
        bypassRls: roles.runtime_bypass_rls,
        createRole: roles.runtime_create_role,
        createDatabase: roles.runtime_create_database,
        replication: roles.runtime_replication,
        memberships: roles.runtime_memberships,
      },
      migrationLedgerExists: roles.migration_ledger_exists,
      guildTableExists: roles.guild_table_exists,
      applicationObjectCount: owners?.application_object_count,
      managementOwnedObjectCount: owners?.management_owned_object_count,
      runtimeOwnedObjectCount: owners?.runtime_owned_object_count,
      unexpectedRuntimeOwnedObjectCount:
        ownershipScope?.unexpected_runtime_owned_object_count,
    };
    assertLegacyRoleSeparationSnapshot(snapshot);

    const managementRole = quoteIdentifier(managementRoleName);
    const runtimeRole = quoteIdentifier(runtimeRoleName);
    const adminRole = quoteIdentifier(snapshot.adminRole);
    const databaseName = quoteIdentifier(snapshot.databaseName);
    await client.query("BEGIN");
    try {
      if (!snapshot.adminSetManagement) {
        await client.query(`GRANT ${managementRole} TO ${adminRole} WITH SET TRUE`);
      }
      if (!snapshot.adminSetRuntime) {
        await client.query(`GRANT ${runtimeRole} TO ${adminRole} WITH SET TRUE`);
      }
      await client.query(`REASSIGN OWNED BY ${runtimeRole} TO ${managementRole}`);
      await client.query(`GRANT CONNECT, CREATE ON DATABASE ${databaseName} TO ${managementRole}`);
      await client.query(`GRANT USAGE, CREATE ON SCHEMA public, guild_runtime TO ${managementRole}`);
      await client.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ${runtimeRole}`);
      await client.query(`GRANT USAGE ON SCHEMA public, guild_runtime TO ${runtimeRole}`);
      await client.query(`REVOKE CREATE ON SCHEMA public, guild_runtime FROM ${runtimeRole}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole}`);
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.guild_schema_migrations FROM ${runtimeRole}`);
      await client.query(`GRANT SELECT ON TABLE public.guild_schema_migrations TO ${runtimeRole}`);
      await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${runtimeRole}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA guild_runtime TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${runtimeRole}`);
      await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${managementRole} IN SCHEMA guild_runtime GRANT EXECUTE ON FUNCTIONS TO ${runtimeRole}`);
      if (!snapshot.adminMemberManagement) {
        await client.query(`REVOKE ${managementRole} FROM ${adminRole}`);
      } else if (!snapshot.adminSetManagement) {
        await client.query(`GRANT ${managementRole} TO ${adminRole} WITH SET FALSE`);
      }
      if (!snapshot.adminMemberRuntime) {
        await client.query(`REVOKE ${runtimeRole} FROM ${adminRole}`);
      } else if (!snapshot.adminSetRuntime) {
        await client.query(`GRANT ${runtimeRole} TO ${adminRole} WITH SET FALSE`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return {
      ok: true,
      managementRole: managementRoleName,
      runtimeRole: runtimeRoleName,
      transferredObjectCount: snapshot.runtimeOwnedObjectCount,
      alreadySeparated: snapshot.runtimeOwnedObjectCount === 0,
    };
  } finally {
    await client.end();
  }
}

export function assertDatabasePreflight(snapshot, expectedMigrations, options = {}) {
  if (!Number.isSafeInteger(snapshot.serverVersionNum) || snapshot.serverVersionNum < 170_000) {
    throw new Error("Production requires PostgreSQL 17 or newer.");
  }
  if (!snapshot.ssl && !(options.allowInsecureLocalhost && options.localDatabase)) {
    throw new Error("Production PostgreSQL must use TLS.");
  }
  if (snapshot.superuser || (snapshot.bypassRls && !options.allowManagementBypassRls)) {
    throw new Error("The Guild database role must not be superuser or BYPASSRLS.");
  }
  if (!Array.isArray(snapshot.migrations) ||
      snapshot.migrations.length !== expectedMigrations.length) {
    throw new Error("The production migration set does not match this release.");
  }
  for (let index = 0; index < expectedMigrations.length; index += 1) {
    const actual = snapshot.migrations[index];
    const expected = expectedMigrations[index];
    if (actual?.name !== expected.name || actual?.checksum !== expected.checksum) {
      throw new Error(`Production migration mismatch at ${expected.name}.`);
    }
  }
  if (!Array.isArray(snapshot.tables) || !snapshot.tables.length) {
    throw new Error("The production Guild schema contains no application tables.");
  }
  const unsafe = snapshot.tables.filter((table) =>
    table.name !== "guild_schema_migrations" && (!table.rls || !table.forcedRls));
  if (unsafe.length) {
    throw new Error(`Forced row-level security is missing from ${unsafe[0].name}.`);
  }
}

const requiredExtensions = ["pg_trgm", "pgcrypto", "vector"];

export function assertMigrationReadiness(snapshot, expectedMigrations, options = {}) {
  if (!Number.isSafeInteger(snapshot.serverVersionNum) || snapshot.serverVersionNum < 170_000) {
    throw new Error("Production requires PostgreSQL 17 or newer.");
  }
  if (!snapshot.ssl && !(options.allowInsecureLocalhost && options.localDatabase)) {
    throw new Error("Production PostgreSQL must use TLS.");
  }
  if (snapshot.superuser || snapshot.bypassRls) {
    throw new Error("Migration readiness requires a non-superuser role without BYPASSRLS.");
  }
  if (!snapshot.databaseCreate || !snapshot.publicUsage || !snapshot.publicCreate) {
    throw new Error("Migration role is missing database or public schema creation privileges.");
  }
  if (!Array.isArray(snapshot.availableExtensions) ||
      requiredExtensions.some((name) => !snapshot.availableExtensions.includes(name))) {
    throw new Error("PostgreSQL must make pg_trgm, pgcrypto, and vector available before migration.");
  }
  if (!Array.isArray(snapshot.migrations) || snapshot.migrations.length > expectedMigrations.length) {
    throw new Error("The existing migration ledger is not a compatible prefix of this release.");
  }
  for (let index = 0; index < snapshot.migrations.length; index += 1) {
    const actual = snapshot.migrations[index];
    const expected = expectedMigrations[index];
    if (actual?.name !== expected?.name || actual?.checksum !== expected?.checksum) {
      throw new Error(`Existing migration mismatch at ${expected?.name ?? actual?.name ?? index}.`);
    }
  }
  if (!snapshot.migrationLedgerExists &&
      (snapshot.guildTableExists || snapshot.runtimeSchemaExists)) {
    throw new Error("Guild OS schema objects exist without a trusted migration ledger.");
  }
  if (snapshot.migrationLedgerExists &&
      ((snapshot.migrations.length === 0 && snapshot.guildTableExists) ||
       (snapshot.migrations.length > 0 && !snapshot.guildTableExists))) {
    throw new Error("Guild OS migration ledger and Core schema objects are inconsistent.");
  }
}

export async function verifyDatabaseMigrationReadiness(connectionString, options = {}) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DATABASE_URL is required for migration readiness verification.");
  }
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }
  assertVerifiedTlsConfiguration(connectionString, options);
  const client = options.client ?? new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '15s'");
    const identityResult = await client.query(`SELECT
        current_setting('server_version_num')::integer AS server_version_num,
        COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
        role.rolsuper AS superuser,
        role.rolbypassrls AS bypass_rls,
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
        has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
        has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
        to_regclass('public.guild_schema_migrations') IS NOT NULL AS migration_ledger_exists,
        to_regclass('public.guilds') IS NOT NULL AS guild_table_exists,
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'guild_runtime') AS runtime_schema_exists
      FROM pg_roles role
      WHERE role.rolname = current_user`);
    const identity = identityResult.rows[0];
    if (!identity) throw new Error("The migration database role could not be inspected.");
    const migrationResult = identity.migration_ledger_exists
      ? await client.query(`SELECT name, checksum
          FROM public.guild_schema_migrations
          ORDER BY name`)
      : { rows: [] };
    const extensionResult = await client.query(`SELECT name
        FROM pg_available_extensions
        WHERE name = ANY($1::text[])
        ORDER BY name`, [requiredExtensions]);
    const expectedMigrations = await loadMigrations();
    const snapshot = {
      serverVersionNum: identity.server_version_num,
      ssl: identity.ssl || hasVerifiedClientTls(client),
      superuser: identity.superuser,
      bypassRls: identity.bypass_rls,
      databaseCreate: identity.database_create,
      publicUsage: identity.public_usage,
      publicCreate: identity.public_create,
      migrationLedgerExists: identity.migration_ledger_exists,
      guildTableExists: identity.guild_table_exists,
      runtimeSchemaExists: identity.runtime_schema_exists,
      migrations: migrationResult.rows,
      availableExtensions: extensionResult.rows.map((row) => row.name),
    };
    assertMigrationReadiness(snapshot, expectedMigrations, {
      allowInsecureLocalhost: options.allowInsecureLocalhost === true,
      localDatabase: isLocalDatabase(connectionString),
    });
    return {
      ok: true,
      postgresMajor: Math.floor(snapshot.serverVersionNum / 10_000),
      tls: snapshot.ssl,
      appliedMigrationCount: snapshot.migrations.length,
      pendingMigrationCount: expectedMigrations.length - snapshot.migrations.length,
      freshDatabase: !snapshot.migrationLedgerExists,
    };
  } finally {
    await client.end();
  }
}

export async function verifyProductionDatabase(connectionString, options = {}) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DATABASE_URL is required for production database verification.");
  }
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }
  assertVerifiedTlsConfiguration(connectionString, options);
  const client = options.client ?? new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '15s'");
    const identityResult = await client.query(`SELECT
        current_setting('server_version_num')::integer AS server_version_num,
        COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
        role.rolsuper AS superuser,
        role.rolbypassrls AS bypass_rls
      FROM pg_roles role
      WHERE role.rolname = current_user`);
    const migrationResult = await client.query(`SELECT name, checksum
        FROM public.guild_schema_migrations
        ORDER BY name`);
    const tableResult = await client.query(`SELECT
        relation.relname AS name,
        relation.relrowsecurity AS rls,
        relation.relforcerowsecurity AS forced_rls
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
      ORDER BY relation.relname`);
    let runtimeRole = null;
    if (options.runtimeRoleName) {
      assertRuntimeRoleName(options.runtimeRoleName);
      const runtimeResult = await client.query(`SELECT
          role.rolname IS NOT NULL AS role_exists,
          COALESCE(role.rolcanlogin, false) AS can_login,
          COALESCE(role.rolsuper, false) AS superuser,
          COALESCE(role.rolbypassrls, false) AS bypass_rls,
          COALESCE(role.rolcreaterole, false) AS create_role,
          COALESCE(role.rolcreatedb, false) AS create_database,
          COALESCE(role.rolreplication, false) AS replication,
          has_schema_privilege(role.oid, 'public', 'USAGE') AS public_usage,
          has_schema_privilege(role.oid, 'public', 'CREATE') AS public_create,
          has_schema_privilege(role.oid, 'guild_runtime', 'USAGE') AS runtime_usage,
          has_schema_privilege(role.oid, 'guild_runtime', 'CREATE') AS runtime_create,
          has_table_privilege(role.oid, 'public.guild_schema_migrations', 'SELECT') AS ledger_read,
          has_table_privilege(role.oid, 'public.guild_schema_migrations', 'INSERT,UPDATE,DELETE') AS ledger_write,
          (SELECT count(*)::integer FROM pg_class relation
             JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
              AND relation.relname <> 'guild_schema_migrations') AS application_table_count,
          COALESCE((SELECT bool_and(has_table_privilege(role.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE'))
             FROM pg_class relation
             JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
              AND relation.relname <> 'guild_schema_migrations'), false) AS application_dml,
          COALESCE((SELECT bool_and(has_function_privilege(role.oid, procedure.oid, 'EXECUTE'))
             FROM pg_proc procedure
             JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
            WHERE namespace.nspname = 'guild_runtime'), false) AS runtime_function_execute
        FROM (SELECT 1) marker
        LEFT JOIN pg_roles role ON role.rolname = $1`, [options.runtimeRoleName]);
      runtimeRole = runtimeResult.rows[0];
      assertRuntimeRolePreflight({
        exists: runtimeRole?.role_exists,
        canLogin: runtimeRole?.can_login,
        superuser: runtimeRole?.superuser,
        bypassRls: runtimeRole?.bypass_rls,
        createRole: runtimeRole?.create_role,
        createDatabase: runtimeRole?.create_database,
        replication: runtimeRole?.replication,
        publicUsage: runtimeRole?.public_usage,
        publicCreate: runtimeRole?.public_create,
        runtimeUsage: runtimeRole?.runtime_usage,
        runtimeCreate: runtimeRole?.runtime_create,
        ledgerRead: runtimeRole?.ledger_read,
        ledgerWrite: runtimeRole?.ledger_write,
        applicationTableCount: runtimeRole?.application_table_count,
        applicationDml: runtimeRole?.application_dml,
        runtimeFunctionExecute: runtimeRole?.runtime_function_execute,
      });
    }
    const identity = identityResult.rows[0];
    if (!identity) throw new Error("The database role could not be inspected.");
    const snapshot = {
      serverVersionNum: identity.server_version_num,
      // Proxies such as Neon terminate TLS before the PostgreSQL backend, so pg_stat_ssl can
      // report false even when node-postgres has a verified TLS socket to the proxy.
      ssl: identity.ssl || hasVerifiedClientTls(client),
      superuser: identity.superuser,
      bypassRls: identity.bypass_rls,
      migrations: migrationResult.rows,
      tables: tableResult.rows.map((row) => ({
        name: row.name,
        rls: row.rls,
        forcedRls: row.forced_rls,
      })),
    };
    const expectedMigrations = await loadMigrations();
    assertDatabasePreflight(snapshot, expectedMigrations, {
      allowInsecureLocalhost: options.allowInsecureLocalhost === true,
      allowManagementBypassRls: Boolean(options.runtimeRoleName),
      localDatabase: isLocalDatabase(connectionString),
    });
    return {
      ok: true,
      postgresMajor: Math.floor(snapshot.serverVersionNum / 10_000),
      tls: snapshot.ssl,
      migrationCount: snapshot.migrations.length,
      rlsTableCount: snapshot.tables.filter((table) =>
        table.name !== "guild_schema_migrations" && table.rls && table.forcedRls).length,
      runtimeRole: options.runtimeRoleName ?? null,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const known = new Set([
    "--allow-insecure-localhost",
    "--pre-migration",
    "--provision-runtime",
    "--separate-legacy-roles",
  ]);
  for (const argument of process.argv.slice(2).filter((value) => value !== "--")) {
    if (!known.has(argument)) throw new Error(`Unknown database verification option: ${argument}`);
  }
  const options = {
    allowInsecureLocalhost: process.argv.includes("--allow-insecure-localhost"),
    runtimeRoleName: process.env.GUILD_RUNTIME_DATABASE_ROLE,
  };
  const operationFlags = ["--pre-migration", "--provision-runtime", "--separate-legacy-roles"]
    .filter((flag) => process.argv.includes(flag));
  if (operationFlags.length > 1) {
    throw new Error("Run migration readiness, legacy role separation, and Runtime provisioning as separate operations.");
  }
  if (process.argv.includes("--separate-legacy-roles")) {
    const separated = await separateLegacyDatabaseRoles(
      process.env.DATABASE_URL,
      process.env.GUILD_MANAGEMENT_DATABASE_ROLE,
      process.env.GUILD_RUNTIME_DATABASE_ROLE,
      options,
    );
    console.log(JSON.stringify(separated));
    return;
  }
  if (process.argv.includes("--pre-migration")) {
    const readiness = await verifyDatabaseMigrationReadiness(process.env.DATABASE_URL, options);
    console.log(JSON.stringify(readiness));
    return;
  }
  if (process.argv.includes("--provision-runtime")) {
    const provisioned = await provisionRuntimeDatabaseRole(
      process.env.DATABASE_URL,
      process.env.GUILD_RUNTIME_DATABASE_ROLE,
      options,
    );
    console.log(JSON.stringify(provisioned));
  }
  const result = await verifyProductionDatabase(process.env.DATABASE_URL, options);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Database verification failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
