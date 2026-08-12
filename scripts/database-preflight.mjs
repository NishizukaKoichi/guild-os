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

export function assertDatabasePreflight(snapshot, expectedMigrations, options = {}) {
  if (!Number.isSafeInteger(snapshot.serverVersionNum) || snapshot.serverVersionNum < 170_000) {
    throw new Error("Production requires PostgreSQL 17 or newer.");
  }
  if (!snapshot.ssl && !(options.allowInsecureLocalhost && options.localDatabase)) {
    throw new Error("Production PostgreSQL must use TLS.");
  }
  if (snapshot.superuser || snapshot.bypassRls) {
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
      localDatabase: isLocalDatabase(connectionString),
    });
    return {
      ok: true,
      postgresMajor: Math.floor(snapshot.serverVersionNum / 10_000),
      tls: snapshot.ssl,
      migrationCount: snapshot.migrations.length,
      rlsTableCount: snapshot.tables.filter((table) =>
        table.name !== "guild_schema_migrations" && table.rls && table.forcedRls).length,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const known = new Set(["--allow-insecure-localhost"]);
  for (const argument of process.argv.slice(2).filter((value) => value !== "--")) {
    if (!known.has(argument)) throw new Error(`Unknown database verification option: ${argument}`);
  }
  const result = await verifyProductionDatabase(process.env.DATABASE_URL, {
    allowInsecureLocalhost: process.argv.includes("--allow-insecure-localhost"),
  });
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
