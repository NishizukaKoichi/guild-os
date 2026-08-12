import { createRequire } from "node:module";
import { createReadStream, existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  assertCommand,
  assertResolvedResources,
  assertWorkerDeploymentsMatchRelease,
  captureWorkerDeployments,
  deploymentLockSnapshot,
  deploymentRecoveryConfiguration,
  deploymentResourceSummary,
  gitSourceSnapshot,
  migrationInventory,
  readResolvedDeployment,
  repositoryRoot,
  sha256File,
  sha256Object,
  writeAtomicJson,
} from "./ops-core.mjs";
import { assertVerifiedTlsConfiguration } from "./database-preflight.mjs";

const postgresRequire = createRequire(join(
  repositoryRoot,
  "packages/guild-postgres/package.json",
));
const { Client } = postgresRequire("pg");

const BACKUP_FORMAT = "guild-os-backup/v2";
const RESTORE_PLAN_FORMAT = "guild-os-restore-plan/v2";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const KV_CONCURRENCY = 4;
const R2_CONCURRENCY = 4;
const KV_RESTORE_BATCH_ENTRIES = 5_000;
const KV_RESTORE_BATCH_BYTES = 50 * 1024 * 1024;

class CloudflareRequestError extends Error {
  constructor(message, retryable) {
    super(message);
    this.name = "CloudflareRequestError";
    this.retryable = retryable;
  }
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseBackupArguments(args) {
  args = args.filter((argument) => argument !== "--");
  const command = args[0];
  if (!(["create", "verify", "prepare-restore"].includes(command))) {
    throw new Error("Use `backup.mjs create`, `backup.mjs verify`, or `backup.mjs prepare-restore`.");
  }
  const pathFlag = command === "create" ? "--output" : "--input";
  const path = valueAfter(args, pathFlag);
  if (!path || !isAbsolute(path)) {
    throw new Error(`${pathFlag} must be an absolute path outside the repository.`);
  }
  const valued = new Set([
    pathFlag,
    ...(command === "prepare-restore" ? ["--output"] : []),
    "--r2-remote",
    "--access-snapshot",
    "--artifacts-repository",
  ]);
  const boolean = new Set(["--confirm-encrypted-destination"]);
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (boolean.has(argument)) continue;
    if (!valued.has(argument)) throw new Error(`Unknown backup option: ${argument}`);
    index += 1;
  }
  if (command === "create" && !args.includes("--confirm-encrypted-destination")) {
    throw new Error(
      "Confirm that the destination is encrypted with --confirm-encrypted-destination.",
    );
  }
  const r2Remote = valueAfter(args, "--r2-remote");
  const accessSnapshot = valueAfter(args, "--access-snapshot");
  if (accessSnapshot && !isAbsolute(accessSnapshot)) {
    throw new Error("--access-snapshot must be an absolute path.");
  }
  const restoreOutput = command === "prepare-restore" ? valueAfter(args, "--output") : null;
  if (command === "prepare-restore" && (!restoreOutput || !isAbsolute(restoreOutput))) {
    throw new Error("prepare-restore requires an absolute --output path outside the repository.");
  }
  return {
    command,
    path,
    r2Remote,
    accessSnapshot,
    artifactsRepository: valueAfter(args, "--artifacts-repository"),
    ...(restoreOutput ? { restoreOutput } : {}),
  };
}

async function assertExternalPath(path, mustExist) {
  if (mustExist && !existsSync(path)) throw new Error(`Backup does not exist: ${path}`);
  if (!mustExist && existsSync(path)) throw new Error(`Backup output already exists: ${path}`);
  const repo = await realpath(repositoryRoot);
  const lexicalLocation = relative(repo, resolve(path));
  if (lexicalLocation === "" ||
      !lexicalLocation.startsWith("..") && !isAbsolute(lexicalLocation)) {
    throw new Error("Backup data must be stored outside the source repository.");
  }
  if (!mustExist) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const resolvedParent = await realpath(mustExist ? path : dirname(path));
  const candidate = mustExist ? resolvedParent : resolve(resolvedParent, basename(path));
  const location = relative(repo, candidate);
  if (location === "" || !location.startsWith("..") && !isAbsolute(location)) {
    throw new Error("Backup data must be stored outside the source repository.");
  }
}

function safeChildEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const name of [
    "DATABASE_URL",
    "GUILD_WEBHOOK_SIGNING_SECRET",
    "CF_AI_GATEWAY_API_TOKEN",
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_EMAIL",
    "PGAPPNAME",
    "PGCHANNELBINDING",
    "PGCONNECT_TIMEOUT",
    "PGDATABASE",
    "PGHOST",
    "PGHOSTADDR",
    "PGOPTIONS",
    "PGPASSWORD",
    "PGPORT",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLCERT",
    "PGSSLCRL",
    "PGSSLCRLDIR",
    "PGSSLKEY",
    "PGSSLMAXPROTOCOLVERSION",
    "PGSSLMINPROTOCOLVERSION",
    "PGSSLMODE",
    "PGSSLNEGOTIATION",
    "PGSSLPASSWORD",
    "PGSSLROOTCERT",
    "PGSSLSNI",
    "PGTARGETSESSIONATTRS",
    "PGUSER",
  ]) delete env[name];
  return { ...env, ...extra };
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? safeChildEnvironment(),
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 2_000);
    throw new Error(`${command} failed${detail ? `: ${detail}` : "."}`);
  }
  return String(result.stdout ?? "");
}

async function databaseBoundary(connectionString, guildId) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SELECT set_config('app.guild_id', $1, true)", [guildId]);
    const result = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM guilds WHERE id = $1) AS initialized,
         COALESCE((SELECT max(sequence) FROM chronicle_events WHERE guild_id = $1), 0)::text
           AS chronicle_sequence,
         (SELECT count(*)::integer FROM agent_runs
           WHERE guild_id = $1 AND status IN ('planning', 'awaiting_approval', 'running'))
           AS active_agent_runs,
         (SELECT count(*)::integer FROM outbox
           WHERE guild_id = $1 AND status IN ('pending', 'processing')) AS active_outbox_items,
         (SELECT count(*)::integer FROM knowledge_files
           WHERE guild_id = $1 AND status = 'pending') AS pending_file_uploads,
         (SELECT name FROM public.guild_schema_migrations
           ORDER BY name DESC LIMIT 1) AS latest_migration`,
      [guildId],
    );
    const guildTables = (await client.query(
      `SELECT class.relname AS table_name
         FROM pg_class class
         JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
         JOIN pg_attribute attribute ON attribute.attrelid = class.oid
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p')
          AND attribute.attname = 'guild_id'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY class.relname`,
    )).rows.map((table) => table.table_name);
    const unexpectedUnscopedTables = (await client.query(
      `SELECT class.relname AS table_name
         FROM pg_class class
         JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p')
          AND class.relname NOT IN ('guilds', 'guild_schema_migrations')
          AND NOT EXISTS (
            SELECT 1 FROM pg_attribute attribute
             WHERE attribute.attrelid = class.oid
               AND attribute.attname = 'guild_id'
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
          )
        ORDER BY class.relname`,
    )).rows.map((table) => table.table_name);
    if (unexpectedUnscopedTables.length) {
      throw new Error(
        `Guild backup found unscoped public tables: ${unexpectedUnscopedTables.join(", ")}.`,
      );
    }
    guildTables.unshift("guilds");
    const guildTableRows = {};
    for (const table of guildTables) {
      if (typeof table !== "string" || !/^[a-z][a-z0-9_]*$/.test(table)) {
        throw new Error("The database contains an unsafe Guild table name.");
      }
      const count = await client.query(`SELECT count(*)::text AS count FROM "${table}"`);
      guildTableRows[table] = count.rows[0]?.count ?? "0";
    }
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) throw new Error("The database boundary query returned no row.");
    return {
      initialized: row.initialized,
      chronicleSequence: row.chronicle_sequence,
      activeAgentRuns: row.active_agent_runs,
      activeOutboxItems: row.active_outbox_items,
      pendingFileUploads: row.pending_file_uploads,
      latestMigration: row.latest_migration,
      guildTableRows,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the first failure; the connection is discarded below.
    }
    throw error;
  } finally {
    await client.end();
  }
}

export function assertQuiescentBoundary(boundary, expectedMigration) {
  if (!boundary.initialized) throw new Error("The configured Guild is not initialized.");
  if (boundary.latestMigration !== expectedMigration) {
    throw new Error(
      `Database migration mismatch: expected ${expectedMigration}, got ${boundary.latestMigration ?? "none"}.`,
    );
  }
  if (boundary.activeAgentRuns || boundary.activeOutboxItems || boundary.pendingFileUploads) {
    throw new Error(
      "Backup requires zero active Agent Runs, pending/processing outbox items, and pending file uploads.",
    );
  }
}

export function pgDumpArguments(outputPath) {
  return [
    "--format=plain",
    "--no-owner",
    "--no-acl",
    "--enable-row-security",
    "--column-inserts",
    "--rows-per-insert=100",
    "--file",
    outputPath,
  ];
}

const POSTGRES_URI_ENVIRONMENT = new Map([
  ["application_name", "PGAPPNAME"],
  ["channel_binding", "PGCHANNELBINDING"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["hostaddr", "PGHOSTADDR"],
  ["sslcert", "PGSSLCERT"],
  ["sslcrl", "PGSSLCRL"],
  ["sslcrldir", "PGSSLCRLDIR"],
  ["sslkey", "PGSSLKEY"],
  ["ssl_max_protocol_version", "PGSSLMAXPROTOCOLVERSION"],
  ["ssl_min_protocol_version", "PGSSLMINPROTOCOLVERSION"],
  ["sslmode", "PGSSLMODE"],
  ["sslnegotiation", "PGSSLNEGOTIATION"],
  ["sslpassword", "PGSSLPASSWORD"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["sslsni", "PGSSLSNI"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"],
]);

export function postgresConnectionEnvironment(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL for backup.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash ||
      !url.username || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("DATABASE_URL must identify a PostgreSQL user, host, and database.");
  }
  const decode = (value, label) => {
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error(`DATABASE_URL contains invalid ${label} encoding.`);
    }
  };
  const env = {
    PGHOST: url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decode(url.username, "user"),
    PGDATABASE: decode(url.pathname.slice(1), "database"),
    ...(url.password ? { PGPASSWORD: decode(url.password, "password") } : {}),
  };
  const seen = new Set();
  for (const [name, value] of url.searchParams) {
    const target = POSTGRES_URI_ENVIRONMENT.get(name);
    if (!target || seen.has(name) || !value) {
      throw new Error(`DATABASE_URL contains an unsupported or duplicate parameter: ${name}`);
    }
    seen.add(name);
    env[target] = value;
  }
  return env;
}

export function pgDumpEnvironment(connectionString, guildId) {
  if (typeof connectionString !== "string" || !connectionString) {
    throw new Error("A PostgreSQL connection string is required for backup.");
  }
  if (typeof guildId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guildId)) {
    throw new Error("A valid Guild UUID is required for backup.");
  }
  assertVerifiedTlsConfiguration(connectionString);
  const path = process.env.PATH;
  return {
    ...(path ? { PATH: path } : {}),
    LANG: "C",
    ...postgresConnectionEnvironment(connectionString),
    PGOPTIONS: `-c app.guild_id=${guildId}`,
  };
}

export async function verifyPostgresDump(path) {
  const details = await lstat(path);
  if (!details.isFile() || !details.size) {
    throw new Error("PostgreSQL backup is not a nonempty regular file.");
  }
  let rowSecurityOn = 0;
  let inserts = 0;
  for await (const line of createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })) {
    if (line === "SET row_security = on;") rowSecurityOn += 1;
    if (/^SET row_security = off;/i.test(line)) {
      throw new Error("PostgreSQL backup disables row security.");
    }
    if (/^(?:\\?copy|COPY)\s/i.test(line)) {
      throw new Error("PostgreSQL backup contains COPY and cannot be restored through row security.");
    }
    if (/^INSERT INTO\s/i.test(line)) inserts += 1;
  }
  if (rowSecurityOn !== 1 || inserts < 1) {
    throw new Error("PostgreSQL backup is missing its row-security or INSERT boundary.");
  }
  return { bytes: details.size, insertStatements: inserts, rowSecurity: "enabled" };
}

async function cloudflareJson(path, token, options = {}, fetcher = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(`${CLOUDFLARE_API}${path}`, {
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(options.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new CloudflareRequestError(
          `Cloudflare API temporarily returned HTTP ${response.status}.`,
          true,
        );
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) {
        const codes = Array.isArray(body?.errors)
          ? body.errors.map((error) => error.code).filter(Boolean).join(",")
          : "unknown";
        throw new CloudflareRequestError(
          `Cloudflare API request failed with HTTP ${response.status} (${codes}).`,
          false,
        );
      }
      return body;
    } catch (error) {
      lastError = error;
      if (error instanceof CloudflareRequestError && !error.retryable) throw error;
      if (attempt < 2) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function cloudflareBytes(path, token, fetcher = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(`${CLOUDFLARE_API}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        throw new CloudflareRequestError(
          `Cloudflare KV temporarily returned HTTP ${response.status}.`,
          true,
        );
      }
      if (!response.ok) {
        throw new CloudflareRequestError(
          `Cloudflare KV read failed with HTTP ${response.status}.`,
          false,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (error instanceof CloudflareRequestError && !error.retryable) throw error;
      if (attempt < 2) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function encodeR2ObjectKey(key) {
  return key.split("/").map((segment) => encodeURIComponent(segment)
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

export function safeR2ObjectPath(key, seen = new Set()) {
  if (typeof key !== "string" || !key || Buffer.byteLength(key) > 1_024) {
    throw new Error("R2 returned an invalid object key.");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." ||
      /[. ]$/.test(segment) ||
      /[\\\u0000-\u001f\u007f]/.test(segment) || Buffer.byteLength(segment) > 240)) {
    throw new Error(`R2 object key cannot be represented safely in a backup tree: ${key}`);
  }
  const collisionKey = key.normalize("NFC").toLocaleLowerCase("en-US");
  if (seen.has(collisionKey)) {
    throw new Error(`R2 object keys collide on a case-insensitive backup volume: ${key}`);
  }
  seen.add(collisionKey);
  return key;
}

function validateR2Metadata(value, label, depth = 0) {
  if (value === undefined) return;
  if (depth > 4) throw new Error(`Cloudflare R2 ${label} is too deeply nested.`);
  if (value === null || typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((entry) => validateR2Metadata(entry, label, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error(`Cloudflare R2 returned invalid ${label}.`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || Buffer.byteLength(key) > 1_024) {
      throw new Error(`Cloudflare R2 returned invalid ${label}.`);
    }
    validateR2Metadata(entry, label, depth + 1);
  }
}

export async function listR2Objects(accountId, bucket, token, fetcher = fetch) {
  const objects = [];
  const keys = new Set();
  const cursors = new Set();
  let cursor = null;
  do {
    const query = new URLSearchParams({ per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const body = await cloudflareJson(
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects?${query}`,
      token,
      {},
      fetcher,
    );
    if (!Array.isArray(body.result)) throw new Error("Cloudflare R2 object list is invalid.");
    for (const object of body.result) {
      if (typeof object?.key !== "string" || !object.key ||
          !Number.isSafeInteger(object.size) || object.size < 0 ||
          typeof object.etag !== "string" || !object.etag) {
        throw new Error("Cloudflare R2 returned invalid object metadata.");
      }
      if (object.last_modified !== undefined &&
          (typeof object.last_modified !== "string" ||
            !Number.isFinite(Date.parse(object.last_modified)))) {
        throw new Error("Cloudflare R2 returned an invalid last-modified time.");
      }
      if (object.storage_class !== undefined && typeof object.storage_class !== "string") {
        throw new Error("Cloudflare R2 returned an invalid storage class.");
      }
      validateR2Metadata(object.http_metadata, "HTTP metadata");
      validateR2Metadata(object.custom_metadata, "custom metadata");
      if (keys.has(object.key)) throw new Error("Cloudflare R2 pagination returned a duplicate key.");
      keys.add(object.key);
      objects.push({
        key: object.key,
        size: object.size,
        etag: object.etag,
        ...(typeof object.last_modified === "string"
          ? { lastModified: object.last_modified }
          : {}),
        ...(typeof object.storage_class === "string"
          ? { storageClass: object.storage_class }
          : {}),
        ...(object.http_metadata && typeof object.http_metadata === "object"
          ? { httpMetadata: object.http_metadata }
          : {}),
        ...(object.custom_metadata && typeof object.custom_metadata === "object"
          ? { customMetadata: object.custom_metadata }
          : {}),
      });
    }
    const truncated = body.result_info?.is_truncated === true;
    cursor = truncated && typeof body.result_info?.cursor === "string" &&
      body.result_info.cursor ? body.result_info.cursor : null;
    if (truncated && !cursor) throw new Error("Cloudflare R2 omitted a required pagination cursor.");
    if (!body.result_info && body.result.length === 1_000) {
      throw new Error("Cloudflare R2 omitted pagination metadata for a full page.");
    }
    if (cursor && cursors.has(cursor)) throw new Error("Cloudflare R2 pagination cursor repeated.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return objects;
}

async function downloadR2Object(accountId, bucket, object, token, fetcher = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(
        `${CLOUDFLARE_API}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}` +
          `/objects/${encodeR2ObjectKey(object.key)}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            "if-none-match": `"guild-os-backup-never-match"`,
          },
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (response.status === 429 || response.status >= 500) {
        throw new CloudflareRequestError(
          `Cloudflare R2 temporarily returned HTTP ${response.status}.`,
          true,
        );
      }
      if (!response.ok) {
        throw new CloudflareRequestError(
          `Cloudflare R2 object read failed with HTTP ${response.status}.`,
          false,
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const responseEtag = response.headers.get("etag")?.replace(/^"|"$/g, "");
      if (bytes.byteLength !== object.size || responseEtag !== object.etag) {
        throw new CloudflareRequestError("Cloudflare R2 object changed while it was read.", true);
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (error instanceof CloudflareRequestError && !error.retryable) throw error;
      if (attempt < 2) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function listCloudflarePages(
  path,
  token,
  parameters = {},
  fetcher = fetch,
) {
  const perPage = 100;
  const results = [];
  const identities = new Set();
  for (let page = 1; page <= 1_000; page += 1) {
    const query = new URLSearchParams({
      ...parameters,
      page: String(page),
      per_page: String(perPage),
    });
    const body = await cloudflareJson(`${path}?${query}`, token, {}, fetcher);
    if (!Array.isArray(body.result)) throw new Error("Cloudflare paginated response is invalid.");
    for (const value of body.result) {
      const identity = typeof value?.id === "string" ? value.id : JSON.stringify(value);
      if (identities.has(identity)) {
        throw new Error("Cloudflare pagination returned a duplicate resource.");
      }
      identities.add(identity);
      results.push(value);
    }
    const totalPages = body.result_info?.total_pages;
    if (Number.isSafeInteger(totalPages)) {
      if (page >= totalPages) return results;
    } else if (body.result.length < perPage) {
      return results;
    }
  }
  throw new Error("Cloudflare pagination exceeded its safety limit.");
}

export async function listKvKeys(accountId, namespaceId, token, fetcher = fetch) {
  const keys = [];
  const names = new Set();
  const cursors = new Set();
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: "1000" });
    if (cursor) query.set("cursor", cursor);
    const body = await cloudflareJson(
      `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${query}`,
      token,
      {},
      fetcher,
    );
    if (!Array.isArray(body.result)) throw new Error("Cloudflare KV key list is invalid.");
    for (const key of body.result) {
      if (typeof key?.name !== "string") throw new Error("Cloudflare KV returned an invalid key.");
      if (names.has(key.name)) throw new Error("Cloudflare KV key pagination returned a duplicate.");
      names.add(key.name);
      keys.push({
        name: key.name,
        ...(typeof key.expiration === "number" ? { expiration: key.expiration } : {}),
        ...(key.metadata !== undefined ? { metadata: key.metadata } : {}),
      });
    }
    cursor = typeof body.result_info?.cursor === "string" && body.result_info.cursor
      ? body.result_info.cursor
      : null;
    if (cursor && cursors.has(cursor)) throw new Error("Cloudflare KV pagination cursor repeated.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return keys;
}

async function exportKvNamespace({ accountId, namespaceId, token, path, fetcher = fetch }) {
  const keys = await listKvKeys(accountId, namespaceId, token, fetcher);
  const file = await open(path, "wx", 0o600);
  let count = 0;
  let valueBytes = 0;
  let expiredDuringBackup = 0;
  try {
    for (let offset = 0; offset < keys.length; offset += KV_CONCURRENCY) {
      const batch = keys.slice(offset, offset + KV_CONCURRENCY);
      const values = await Promise.all(batch.map(async (key) => ({
        key,
        value: await cloudflareBytes(
          `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key.name)}`,
          token,
          fetcher,
        ),
      })));
      for (const { key, value } of values) {
        if (value === null) {
          expiredDuringBackup += 1;
          continue;
        }
        await file.write(`${JSON.stringify({
          key: key.name,
          value: value.toString("base64"),
          base64: true,
          ...(key.expiration !== undefined ? { expiration: key.expiration } : {}),
          ...(key.metadata !== undefined ? { metadata: key.metadata } : {}),
        })}\n`);
        count += 1;
        valueBytes += value.byteLength;
      }
    }
  } finally {
    await file.close();
  }
  return {
    namespaceId,
    keyCount: count,
    valueBytes,
    expiredDuringBackup,
    listedKeysSha256: sha256Object(keys),
  };
}

async function exportAccess(config, token, path, fetcher = fetch) {
  const apps = await listCloudflarePages(
    `/accounts/${config.accountId}/access/apps`,
    token,
    { aud: config.access.audience },
    fetcher,
  );
  const matches = apps.filter((app) => app?.aud === config.access.audience);
  if (matches.length !== 1 || typeof matches[0].id !== "string") {
    throw new Error("Exactly one Access application must match the configured audience.");
  }
  const app = matches[0];
  const policies = await listCloudflarePages(
    `/accounts/${config.accountId}/access/apps/${app.id}/policies`,
    token,
    {},
    fetcher,
  );
  if (!policies.length) {
    throw new Error("The Access application has no policies to back up.");
  }
  await writeAtomicJson(path, { application: app, policies });
  return { applicationId: app.id, policyCount: policies.length, source: "cloudflare-api" };
}

function assertNoSecretLikeKeys(value, path = "access snapshot") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretLikeKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:secret|token|password|private[_-]?key)/i.test(key)) {
      throw new Error(`Access snapshot contains a secret-like field at ${path}.${key}.`);
    }
    assertNoSecretLikeKeys(entry, `${path}.${key}`);
  }
}

function assertJsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

export async function importAccessSnapshot(config, sourcePath, outputPath) {
  const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
  assertJsonObject(snapshot, "Access snapshot");
  assertNoSecretLikeKeys(snapshot);
  const app = snapshot?.application;
  const policies = snapshot?.policies;
  if (!app || typeof app.id !== "string" || !app.id ||
      app.aud !== config.access.audience ||
      typeof app.domain !== "string" || !app.domain ||
      !Array.isArray(policies) || !policies.length ||
      policies.some((policy) => typeof policy?.id !== "string" || !policy.id)) {
    throw new Error("Access snapshot does not match the configured application audience.");
  }
  assertJsonObject(app, "Access application");
  policies.forEach((policy) => assertJsonObject(policy, "Access policy"));
  await writeAtomicJson(outputPath, snapshot);
  return {
    applicationId: app.id,
    policyCount: policies.length,
    source: "operator-reviewed-snapshot",
  };
}

async function* walkFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup tree contains a symbolic link: ${relativePath}`);
    if (entry.isDirectory()) yield* walkFiles(absolutePath, relativePath);
    else if (entry.isFile()) yield { absolutePath, relativePath };
    else throw new Error(`Backup tree contains an unsupported file: ${relativePath}`);
  }
}

async function indexFileTree(directory, indexPath) {
  const file = await open(indexPath, "wx", 0o600);
  let count = 0;
  let bytes = 0;
  try {
    for await (const item of walkFiles(directory)) {
      const details = await stat(item.absolutePath);
      const sha256 = await sha256File(item.absolutePath);
      await file.write(`${JSON.stringify({ path: item.relativePath, bytes: details.size, sha256 })}\n`);
      count += 1;
      bytes += details.size;
    }
  } finally {
    await file.close();
  }
  return { objectCount: count, bytes };
}

async function exportR2BucketWithRclone({ remote, bucket, directory, indexPath, rclone }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = `${remote}:${bucket}`;
  runChecked(rclone, [
    "copy", source, directory, "--metadata", "--checkers", "8", "--transfers", "4",
  ]);
  runChecked(rclone, ["check", source, directory, "--one-way", "--size-only"]);
  return { ...await indexFileTree(directory, indexPath), exportMethod: "rclone" };
}

export async function exportR2BucketWithCloudflare({
  accountId,
  bucket,
  token,
  directory,
  indexPath,
  fetcher = fetch,
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const before = await listR2Objects(accountId, bucket, token, fetcher);
  const seenPaths = new Set();
  const paths = before.map((object) => safeR2ObjectPath(object.key, seenPaths));
  const index = await open(indexPath, "wx", 0o600);
  let bytes = 0;
  try {
    for (let offset = 0; offset < before.length; offset += R2_CONCURRENCY) {
      const batch = before.slice(offset, offset + R2_CONCURRENCY);
      const downloads = await Promise.all(batch.map((object) =>
        downloadR2Object(accountId, bucket, object, token, fetcher)));
      for (let indexInBatch = 0; indexInBatch < batch.length; indexInBatch += 1) {
        const object = batch[indexInBatch];
        const data = downloads[indexInBatch];
        const relativePath = paths[offset + indexInBatch];
        const target = join(directory, relativePath);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, data, { flag: "wx", mode: 0o600 });
        await index.write(`${JSON.stringify({
          path: relativePath,
          key: object.key,
          bytes: data.byteLength,
          sha256: await sha256File(target),
          etag: object.etag,
          ...(object.lastModified ? { lastModified: object.lastModified } : {}),
          ...(object.storageClass ? { storageClass: object.storageClass } : {}),
          ...(object.httpMetadata ? { httpMetadata: object.httpMetadata } : {}),
          ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}),
        })}\n`);
        bytes += data.byteLength;
      }
    }
  } finally {
    await index.close();
  }
  const after = await listR2Objects(accountId, bucket, token, fetcher);
  if (sha256Object(after) !== sha256Object(before)) {
    throw new Error(`R2 bucket changed during backup: ${bucket}`);
  }
  return {
    objectCount: before.length,
    bytes,
    inventorySha256: sha256Object(before),
    exportMethod: "cloudflare-rest",
  };
}

async function exportArtifacts(repository, output) {
  if (!repository || !isAbsolute(repository)) {
    throw new Error("Enabled Context Artifacts requires --artifacts-repository with an absolute path.");
  }
  const root = runChecked("git", ["-C", repository, "rev-parse", "--show-toplevel"]).trim();
  const dirty = runChecked("git", ["-C", root, "status", "--porcelain=v1"]).trim();
  if (dirty) throw new Error("The Context Artifacts mirror must be clean before backup.");
  runChecked("git", ["-C", root, "bundle", "create", output, "--all"]);
  runChecked("git", ["bundle", "verify", output]);
  return { head: runChecked("git", ["-C", root, "rev-parse", "HEAD"]).trim() };
}

async function fileRecord(root, path) {
  const absolutePath = join(root, path);
  const details = await lstat(absolutePath);
  if (!details.isFile()) throw new Error(`Backup manifest input is not a regular file: ${path}`);
  return { path, bytes: details.size, sha256: await sha256File(absolutePath) };
}

async function hardenBackupTree(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup contains a symbolic link: ${path}`);
    if (entry.isDirectory()) {
      await chmod(path, 0o700);
      await hardenBackupTree(path);
    } else if (entry.isFile()) {
      await chmod(path, 0o600);
    } else {
      throw new Error(`Backup contains an unsupported filesystem entry: ${path}`);
    }
  }
}

async function writeBackupManifest(root, core) {
  const manifest = { ...core, manifestPayloadSha256: sha256Object(core) };
  const manifestPath = join(root, "manifest.json");
  await writeAtomicJson(manifestPath, manifest);
  const checksum = await sha256File(manifestPath);
  await writeFile(join(root, "manifest.sha256"), `${checksum}  manifest.json\n`, { mode: 0o600 });
  return manifest;
}

async function createBackup(options) {
  await assertExternalPath(options.path, false);
  const databaseUrl = process.env.DATABASE_URL;
  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for backup creation.");
  if (!cloudflareToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is required for KV, R2, and Access export.");
  }
  const config = await readResolvedDeployment();
  assertResolvedResources(config);
  const sourceSnapshot = gitSourceSnapshot({ requireClean: true });
  const migrations = await migrationInventory();
  const expectedMigration = migrations.at(-1)?.name;
  if (!expectedMigration) throw new Error("No Guild PostgreSQL migration was found.");

  const pgDump = process.env.PG_DUMP_BIN ?? "pg_dump";
  const psql = process.env.PSQL_BIN ?? "psql";
  const tools = {
    pgDump: assertCommand(pgDump),
    psql: assertCommand(psql),
    r2: options.r2Remote
      ? { method: "rclone", version: assertCommand(process.env.RCLONE_BIN ?? "rclone") }
      : { method: "cloudflare-rest", api: "v4" },
  };

  const boundaryBefore = await databaseBoundary(databaseUrl, config.guild.id);
  assertQuiescentBoundary(boundaryBefore, expectedMigration);
  await mkdir(options.path, { mode: 0o700 });
  try {
    for (const directory of ["postgres", "kv", "r2", "cloudflare", "artifacts"]) {
      await mkdir(join(options.path, directory), { mode: 0o700 });
    }

    const dumpPath = join(options.path, "postgres/guild-os.sql");
    runChecked(pgDump, pgDumpArguments(dumpPath), {
      env: pgDumpEnvironment(databaseUrl, config.guild.id),
    });
    const postgresDump = await verifyPostgresDump(dumpPath);

    const kvDefinitions = [
      ["context", config.context.kvNamespaceId],
      ["blueprints", config.resources.blueprintsKvNamespaceId],
      ["avatars", config.resources.avatarsKvNamespaceId],
    ];
    const kv = [];
    for (const [name, namespaceId] of kvDefinitions) {
      const path = join(options.path, `kv/${name}.jsonl`);
      kv.push({ name, path: `kv/${name}.jsonl`, ...await exportKvNamespace({
        accountId: config.accountId,
        namespaceId,
        token: cloudflareToken,
        path,
      }) });
    }

    const r2Definitions = [
      ["knowledge", config.resources.knowledgeFilesBucket],
      ["blueprints", config.resources.blueprintContentBucket],
    ];
    const r2 = [];
    for (const [name, bucket] of r2Definitions) {
      const directory = join(options.path, `r2/${name}`);
      const indexPath = join(options.path, `r2/${name}.index.jsonl`);
      r2.push({ name, bucket, path: `r2/${name}`, index: `r2/${name}.index.jsonl`,
        ...(options.r2Remote
          ? await exportR2BucketWithRclone({
            remote: options.r2Remote,
            bucket,
            directory,
            indexPath,
            rclone: process.env.RCLONE_BIN ?? "rclone",
          })
          : await exportR2BucketWithCloudflare({
            accountId: config.accountId,
            bucket,
            token: cloudflareToken,
            directory,
            indexPath,
          })) });
    }

    const accessPath = join(options.path, "cloudflare/access.json");
    const access = options.accessSnapshot
      ? await importAccessSnapshot(config, options.accessSnapshot, accessPath)
      : await exportAccess(config, cloudflareToken, accessPath);
    const deployments = captureWorkerDeployments(config);
    assertWorkerDeploymentsMatchRelease(deployments, sourceSnapshot.commit);
    await writeAtomicJson(join(options.path, "cloudflare/deployments.json"), deployments);
    await writeAtomicJson(
      join(options.path, "cloudflare/deployment-summary.json"),
      deploymentResourceSummary(config),
    );
    await writeAtomicJson(
      join(options.path, "cloudflare/deployment.lock.json"),
      deploymentLockSnapshot(config),
    );
    await writeAtomicJson(
      join(options.path, "cloudflare/deployment.resolved.json"),
      deploymentRecoveryConfiguration(config),
    );

    let artifacts = null;
    if (config.context.artifacts?.enabled) {
      const path = join(options.path, "artifacts/context.bundle");
      artifacts = { path: "artifacts/context.bundle",
        ...await exportArtifacts(options.artifactsRepository, path) };
    }

    const boundaryAfter = await databaseBoundary(databaseUrl, config.guild.id);
    assertQuiescentBoundary(boundaryAfter, expectedMigration);
    if (boundaryAfter.chronicleSequence !== boundaryBefore.chronicleSequence) {
      throw new Error("Guild data changed during backup; discard this copy and retry while access is restricted.");
    }
    if (sha256Object(boundaryAfter.guildTableRows) !== sha256Object(boundaryBefore.guildTableRows)) {
      throw new Error("Guild table counts changed during backup; discard this copy and retry while access is restricted.");
    }

    const filePaths = [
      "postgres/guild-os.sql",
      ...kv.map((entry) => entry.path),
      ...r2.map((entry) => entry.index),
      "cloudflare/access.json",
      "cloudflare/deployments.json",
      "cloudflare/deployment-summary.json",
      "cloudflare/deployment.lock.json",
      "cloudflare/deployment.resolved.json",
      ...(artifacts ? [artifacts.path] : []),
    ];
    const files = [];
    for (const path of filePaths) files.push(await fileRecord(options.path, path));
    const manifest = await writeBackupManifest(options.path, {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      complete: true,
      encryption: "destination-confirmed",
      guildId: config.guild.id,
      source: sourceSnapshot,
      migrations,
      tools,
      databaseBoundary: boundaryBefore,
      stores: {
        postgres: {
          path: "postgres/guild-os.sql",
          scope: "guild-forced-rls",
          format: "plain-column-inserts",
          ...postgresDump,
        },
        kv,
        r2,
        access: { path: "cloudflare/access.json", ...access },
        deployments: { path: "cloudflare/deployments.json", count: deployments.length },
        deploymentLock: { path: "cloudflare/deployment.lock.json" },
        deploymentConfiguration: { path: "cloudflare/deployment.resolved.json" },
        artifacts,
      },
      files,
    });
    await hardenBackupTree(options.path);
    await verifyBackupDirectory(options.path);
    return manifest;
  } catch (error) {
    await rm(options.path, { recursive: true, force: true });
    throw error;
  }
}

async function* readJsonLines(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    yield JSON.parse(line);
  }
}

function resolveBackupPath(root, value, label) {
  if (typeof value !== "string" || !value || isAbsolute(value) ||
      /[\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is not a safe relative backup path.`);
  }
  const base = resolve(root);
  const path = resolve(base, value);
  if (path === base || !path.startsWith(`${base}/`)) {
    throw new Error(`${label} escapes the backup root.`);
  }
  return path;
}

function validateGuildTableRows(value, required) {
  if (value === undefined && !required) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Object.keys(value).length) {
    throw new Error("Backup database boundary has invalid Guild table counts.");
  }
  for (const [table, count] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) ||
        typeof count !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(count)) {
      throw new Error("Backup database boundary has invalid Guild table counts.");
    }
  }
  return value;
}

async function verifyR2Tree(root, store) {
  const indexPath = resolveBackupPath(root, store?.index, "R2 index path");
  const base = resolveBackupPath(root, store?.path, "R2 object path");
  let count = 0;
  let bytes = 0;
  const seenPaths = new Set();
  for await (const record of readJsonLines(indexPath)) {
    if (typeof record?.path !== "string" ||
        !Number.isSafeInteger(record?.bytes) || record.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(record?.sha256 ?? "")) {
      throw new Error(`Invalid R2 index record in ${store.index}.`);
    }
    const relativePath = safeR2ObjectPath(record.path, seenPaths);
    if (store.exportMethod === "cloudflare-rest" && record.key !== relativePath) {
      throw new Error(`R2 key/path mismatch in ${store.index}.`);
    }
    const path = resolve(base, relativePath);
    if (path !== base && !path.startsWith(`${base}/`)) throw new Error("R2 index path escapes its store.");
    const details = await lstat(path);
    if (!details.isFile() || details.size !== record.bytes ||
        await sha256File(path) !== record.sha256) {
      throw new Error(`R2 object verification failed: ${store.name}/${record.path}`);
    }
    count += 1;
    bytes += details.size;
  }
  let actualCount = 0;
  for await (const _item of walkFiles(base)) actualCount += 1;
  if (count !== store.objectCount || count !== actualCount || bytes !== store.bytes) {
    throw new Error(`R2 inventory count mismatch for ${store.name}.`);
  }
}

export async function verifyBackupDirectory(root) {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== BACKUP_FORMAT || manifest.complete !== true) {
    throw new Error("This is not a complete Guild OS backup.");
  }
  const { manifestPayloadSha256, ...core } = manifest;
  if (manifestPayloadSha256 !== sha256Object(core)) {
    throw new Error("Backup manifest payload checksum does not match.");
  }
  const checksumLine = (await readFile(join(root, "manifest.sha256"), "utf8")).trim();
  if (checksumLine !== `${await sha256File(manifestPath)}  manifest.json`) {
    throw new Error("Backup manifest file checksum does not match.");
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.stores?.r2) ||
      !Array.isArray(manifest.stores?.kv)) {
    throw new Error("Backup manifest store inventory is invalid.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(manifest.guildId ?? "") ||
      manifest.stores?.postgres?.scope !== "guild-forced-rls" ||
      manifest.stores.postgres.format !== "plain-column-inserts" ||
      typeof manifest.databaseBoundary?.chronicleSequence !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(manifest.databaseBoundary.chronicleSequence)) {
    throw new Error("Backup PostgreSQL scope is invalid.");
  }
  validateGuildTableRows(manifest.databaseBoundary.guildTableRows, true);
  const manifestFilePaths = new Set();
  for (const file of manifest.files) {
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file?.sha256 ?? "")) {
      throw new Error("Backup manifest file record is invalid.");
    }
    if (manifestFilePaths.has(file.path)) {
      throw new Error("Backup manifest contains a duplicate file path.");
    }
    manifestFilePaths.add(file.path);
    const path = resolveBackupPath(root, file.path, "Backup manifest path");
    const details = await lstat(path);
    if (!details.isFile() || details.size !== file.bytes ||
        await sha256File(path) !== file.sha256) {
      throw new Error(`Backup file verification failed: ${file.path}`);
    }
  }
  const requiredFiles = [
    manifest.stores.postgres.path,
    ...manifest.stores.kv.map((store) => store?.path),
    ...manifest.stores.r2.map((store) => store?.index),
    manifest.stores.access?.path,
    manifest.stores.deployments?.path,
    manifest.stores.deploymentLock?.path,
    manifest.stores.deploymentConfiguration?.path,
    manifest.stores.artifacts?.path,
  ].filter(Boolean);
  if (requiredFiles.some((path) => !manifestFilePaths.has(path))) {
    throw new Error("Backup manifest omits a required store file.");
  }
  const postgresDump = await verifyPostgresDump(resolveBackupPath(
    root,
    manifest.stores.postgres.path,
    "PostgreSQL dump path",
  ));
  if (postgresDump.bytes !== manifest.stores.postgres.bytes ||
      postgresDump.insertStatements !== manifest.stores.postgres.insertStatements ||
      postgresDump.rowSecurity !== manifest.stores.postgres.rowSecurity) {
    throw new Error("Backup PostgreSQL dump boundary does not match its manifest.");
  }
  for (const store of manifest.stores.r2) await verifyR2Tree(root, store);
  for (const store of manifest.stores.kv) {
    if (!Number.isSafeInteger(store?.keyCount) || store.keyCount < 0 ||
        !Number.isSafeInteger(store?.valueBytes) || store.valueBytes < 0) {
      throw new Error("Backup KV inventory is invalid.");
    }
    let count = 0;
    let valueBytes = 0;
    const storePath = resolveBackupPath(root, store?.path, "KV export path");
    for await (const row of readJsonLines(storePath)) {
      if (typeof row?.key !== "string" || row.base64 !== true ||
          typeof row.value !== "string" || row.value.length % 4 !== 0 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.value)) {
        throw new Error(`KV export verification failed: ${store.name}`);
      }
      const value = Buffer.from(row.value, "base64");
      if (value.toString("base64") !== row.value) {
        throw new Error(`KV export contains noncanonical Base64: ${store.name}`);
      }
      count += 1;
      valueBytes += value.byteLength;
    }
    if (count !== store.keyCount || valueBytes !== store.valueBytes) {
      throw new Error(`KV export count mismatch: ${store.name}`);
    }
  }
  return manifest;
}

async function closeKvRestoreBatch(state) {
  if (!state.file) return null;
  await state.file.write("]\n");
  await state.file.close();
  const details = await stat(state.path);
  const result = {
    path: state.relativePath,
    entries: state.entries,
    bytes: details.size,
    sha256: await sha256File(state.path),
  };
  state.file = null;
  return result;
}

export async function prepareKvRestoreBatches(
  backupRoot,
  outputRoot,
  store,
  limits = {},
) {
  const maxEntries = limits.maxEntries ?? KV_RESTORE_BATCH_ENTRIES;
  const maxBytes = limits.maxBytes ?? KV_RESTORE_BATCH_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new Error("KV restore batch limits are invalid.");
  }
  const directory = join(outputRoot, "kv", store.name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const batches = [];
  const state = { file: null, path: "", relativePath: "", entries: 0, bytes: 1 };
  const openBatch = async () => {
    const name = `batch-${String(batches.length + 1).padStart(5, "0")}.json`;
    state.relativePath = `kv/${store.name}/${name}`;
    state.path = join(outputRoot, state.relativePath);
    state.file = await open(state.path, "wx", 0o600);
    state.entries = 0;
    state.bytes = 1;
    await state.file.write("[");
  };
  const finishBatch = async () => {
    const batch = await closeKvRestoreBatch(state);
    if (batch) batches.push(batch);
  };

  let entries = 0;
  for await (const row of readJsonLines(join(backupRoot, store.path))) {
    const encoded = JSON.stringify(row);
    const encodedBytes = Buffer.byteLength(encoded);
    if (encodedBytes + 2 > maxBytes) {
      throw new Error(`KV value is too large for a restore batch: ${store.name}`);
    }
    if (!state.file) await openBatch();
    const separatorBytes = state.entries ? 1 : 0;
    if (state.entries &&
        (state.entries >= maxEntries || state.bytes + separatorBytes + encodedBytes + 1 > maxBytes)) {
      await finishBatch();
      await openBatch();
    }
    await state.file.write(`${state.entries ? "," : ""}${encoded}`);
    state.entries += 1;
    state.bytes += separatorBytes + encodedBytes;
    entries += 1;
  }
  await finishBatch();
  if (entries !== store.keyCount) {
    throw new Error(`KV restore preparation count mismatch: ${store.name}`);
  }
  return {
    name: store.name,
    sourceNamespaceId: store.namespaceId,
    entries,
    batches,
  };
}

export async function prepareRestoreDirectory(backupRoot, outputRoot) {
  const manifest = await verifyBackupDirectory(backupRoot);
  await mkdir(outputRoot, { mode: 0o700 });
  try {
    const kv = [];
    for (const store of manifest.stores.kv) {
      kv.push(await prepareKvRestoreBatches(backupRoot, outputRoot, store));
    }
    const core = {
      format: RESTORE_PLAN_FORMAT,
      createdAt: new Date().toISOString(),
      sourceBackup: {
        path: backupRoot,
        guildId: manifest.guildId,
        createdAt: manifest.createdAt,
        manifestPayloadSha256: manifest.manifestPayloadSha256,
      },
      safety: {
        requiresEmptyTarget: true,
        requiresExplicitTargetResourceIds: true,
        mutatesCloudResources: false,
      },
      stores: {
        postgres: {
          ...manifest.stores.postgres,
          expectedGuildTableRows: manifest.databaseBoundary.guildTableRows,
          expectedChronicleSequence: manifest.databaseBoundary.chronicleSequence,
        },
        kv,
        r2: manifest.stores.r2.map((store) => ({
          name: store.name,
          sourcePath: join(backupRoot, store.path),
          sourceIndex: join(backupRoot, store.index),
          objectCount: store.objectCount,
          bytes: store.bytes,
          exportMethod: store.exportMethod,
          ...(store.inventorySha256
            ? { inventorySha256: store.inventorySha256 }
            : {}),
        })),
        access: manifest.stores.access,
        artifacts: manifest.stores.artifacts,
      },
    };
    const plan = { ...core, planPayloadSha256: sha256Object(core) };
    await writeAtomicJson(join(outputRoot, "restore-plan.json"), plan);
    await hardenBackupTree(outputRoot);
    return plan;
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseBackupArguments(process.argv.slice(2));
  if (options.command === "create") {
    const manifest = await createBackup(options);
    await chmod(options.path, 0o700);
    console.log(JSON.stringify({
      ok: true,
      output: options.path,
      guildId: manifest.guildId,
      chronicleSequence: manifest.databaseBoundary.chronicleSequence,
    }));
    return;
  }
  if (options.command === "prepare-restore") {
    await assertExternalPath(options.path, true);
    await assertExternalPath(options.restoreOutput, false);
    const input = await realpath(options.path);
    const outputParent = await realpath(dirname(options.restoreOutput));
    const output = resolve(outputParent, basename(options.restoreOutput));
    if (output.startsWith(`${input}/`) || input.startsWith(`${output}/`) || output === input) {
      throw new Error("Restore preparation output must be separate from its backup input.");
    }
    const plan = await prepareRestoreDirectory(input, output);
    console.log(JSON.stringify({
      ok: true,
      input,
      output,
      guildId: plan.sourceBackup.guildId,
      mutatesCloudResources: false,
    }));
    return;
  }
  await assertExternalPath(options.path, true);
  const manifest = await verifyBackupDirectory(options.path);
  console.log(JSON.stringify({
    ok: true,
    input: options.path,
    guildId: manifest.guildId,
    createdAt: manifest.createdAt,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Backup failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
