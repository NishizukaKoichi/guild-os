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

const postgresRequire = createRequire(join(
  repositoryRoot,
  "packages/guild-postgres/package.json",
));
const { Client } = postgresRequire("pg");

const BACKUP_FORMAT = "guild-os-backup/v1";
const RESTORE_PLAN_FORMAT = "guild-os-restore-plan/v1";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const KV_CONCURRENCY = 4;
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
  if (command === "create" && !r2Remote) throw new Error("create requires --r2-remote.");
  const restoreOutput = command === "prepare-restore" ? valueAfter(args, "--output") : null;
  if (command === "prepare-restore" && (!restoreOutput || !isAbsolute(restoreOutput))) {
    throw new Error("prepare-restore requires an absolute --output path outside the repository.");
  }
  return {
    command,
    path,
    r2Remote,
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
  const env = { ...process.env, ...extra };
  delete env.DATABASE_URL;
  delete env.GUILD_WEBHOOK_SIGNING_SECRET;
  delete env.CF_AI_GATEWAY_API_TOKEN;
  return env;
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
    await client.query("BEGIN READ ONLY");
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
  return { applicationId: app.id, policyCount: policies.length };
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

async function exportR2Bucket({ remote, bucket, directory, indexPath, rclone }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = `${remote}:${bucket}`;
  runChecked(rclone, [
    "copy", source, directory, "--metadata", "--checkers", "8", "--transfers", "4",
  ]);
  runChecked(rclone, ["check", source, directory, "--one-way", "--size-only"]);
  return indexFileTree(directory, indexPath);
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
  if (!cloudflareToken) throw new Error("CLOUDFLARE_API_TOKEN is required for KV and Access export.");
  const config = await readResolvedDeployment();
  assertResolvedResources(config);
  const migrations = await migrationInventory();
  const expectedMigration = migrations.at(-1)?.name;
  if (!expectedMigration) throw new Error("No Guild PostgreSQL migration was found.");

  const pgDump = process.env.PG_DUMP_BIN ?? "pg_dump";
  const pgRestore = process.env.PG_RESTORE_BIN ?? "pg_restore";
  const rclone = process.env.RCLONE_BIN ?? "rclone";
  const tools = {
    pgDump: assertCommand(pgDump),
    pgRestore: assertCommand(pgRestore),
    rclone: assertCommand(rclone),
  };

  const boundaryBefore = await databaseBoundary(databaseUrl, config.guild.id);
  assertQuiescentBoundary(boundaryBefore, expectedMigration);
  await mkdir(options.path, { mode: 0o700 });
  try {
    for (const directory of ["postgres", "kv", "r2", "cloudflare", "artifacts"]) {
      await mkdir(join(options.path, directory), { mode: 0o700 });
    }

    const dumpPath = join(options.path, "postgres/guild-os.dump");
    runChecked(pgDump, [
      "--format=custom", "--no-owner", "--no-acl", "--file", dumpPath,
    ], { env: safeChildEnvironment({ PGDATABASE: databaseUrl }) });
    const restoreList = runChecked(pgRestore, ["--list", dumpPath]);
    await writeFile(join(options.path, "postgres/guild-os.restore-list.txt"), restoreList, {
      mode: 0o600,
    });

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
        ...await exportR2Bucket({
          remote: options.r2Remote,
          bucket,
          directory,
          indexPath,
          rclone,
        }) });
    }

    const accessPath = join(options.path, "cloudflare/access.json");
    const access = await exportAccess(config, cloudflareToken, accessPath);
    const deployments = captureWorkerDeployments(config);
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

    const filePaths = [
      "postgres/guild-os.dump",
      "postgres/guild-os.restore-list.txt",
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
      source: gitSourceSnapshot({ requireClean: true }),
      migrations,
      tools,
      databaseBoundary: boundaryBefore,
      stores: {
        postgres: { path: "postgres/guild-os.dump" },
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

async function verifyR2Tree(root, store) {
  let count = 0;
  let bytes = 0;
  for await (const record of readJsonLines(join(root, store.index))) {
    if (typeof record?.path !== "string" || typeof record?.bytes !== "number" ||
        !/^[a-f0-9]{64}$/.test(record?.sha256 ?? "")) {
      throw new Error(`Invalid R2 index record in ${store.index}.`);
    }
    const path = resolve(root, store.path, record.path);
    const base = resolve(root, store.path);
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
  for await (const _item of walkFiles(join(root, store.path))) actualCount += 1;
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
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    if (path !== resolve(root) && !path.startsWith(`${resolve(root)}/`)) {
      throw new Error("Backup manifest path escapes its root.");
    }
    const details = await lstat(path);
    if (!details.isFile() || details.size !== file.bytes ||
        await sha256File(path) !== file.sha256) {
      throw new Error(`Backup file verification failed: ${file.path}`);
    }
  }
  for (const store of manifest.stores.r2) await verifyR2Tree(root, store);
  for (const store of manifest.stores.kv) {
    let count = 0;
    let valueBytes = 0;
    for await (const row of readJsonLines(join(root, store.path))) {
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
        postgres: manifest.stores.postgres,
        kv,
        r2: manifest.stores.r2.map((store) => ({
          name: store.name,
          sourcePath: join(backupRoot, store.path),
          objectCount: store.objectCount,
          bytes: store.bytes,
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
