import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(packageRoot, "migrations");

export function migrationChecksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

export async function loadMigrations(directory = migrationsDirectory) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    return { name, sql, checksum: migrationChecksum(sql) };
  }));
}

async function applyMigrations(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.guild_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of await loadMigrations()) {
      await client.query("BEGIN");
      try {
        await client.query("LOCK TABLE public.guild_schema_migrations IN EXCLUSIVE MODE");
        const existing = await client.query(
          "SELECT checksum FROM public.guild_schema_migrations WHERE name = $1",
          [migration.name],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== migration.checksum) {
            throw new Error(`Applied migration was modified: ${migration.name}`);
          }
          await client.query("COMMIT");
          continue;
        }
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO public.guild_schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        process.stdout.write(`Applied ${migration.name}\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const migrations = await loadMigrations();
  if (process.argv.includes("--dry-run")) {
    for (const migration of migrations) {
      process.stdout.write(`${migration.name} ${migration.checksum}\n`);
    }
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set DATABASE_URL to the purchaser-owned PostgreSQL connection string.");
  }
  await applyMigrations(connectionString);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Migration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
