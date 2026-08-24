import { createRequire } from "node:module";
import { createReadStream, existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  cloudflareBytes,
  databaseBoundary,
  downloadR2Object,
  listKvKeys,
  listR2Objects,
  verifyBackupDirectory,
} from "./backup.mjs";
import { assertVerifiedTlsConfiguration } from "./database-preflight.mjs";
import {
  deploymentLockPath,
  deploymentResourceSummary,
  gitSourceSnapshot,
  readResolvedDeployment,
  repositoryRoot,
  selectedDeploymentConfig,
  sha256File,
  sha256Object,
  sha256Text,
  writeAtomicJson,
} from "./ops-core.mjs";

const postgresRequire = createRequire(join(
  repositoryRoot,
  "packages/guild-postgres/package.json",
));
const { Client } = postgresRequire("pg");

export const RESTORE_PRE_RECOVERY_FORMAT = "guild-os-restore-verification-pre/v1";
export const RESTORE_VERIFICATION_FORMAT = "guild-os-restore-verification/v1";
const RESTORE_PLAN_FORMAT = "guild-os-restore-plan/v2";
const PRODUCTION_SMOKE_FORMAT = "guild-os-production-smoke/v1";
const digestPattern = /^[0-9a-f]{64}$/i;
const commitPattern = /^[0-9a-f]{40}$/i;

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseRestoreVerificationArguments(args) {
  args = args.filter((argument) => argument !== "--");
  const command = args[0];
  const definitions = command === "pre"
    ? ["--backup", "--restore-plan", "--smoke", "--output"]
    : command === "post"
      ? ["--pre", "--smoke", "--output"]
      : null;
  if (!definitions) {
    throw new Error("Use `restore-rehearsal.mjs pre` or `restore-rehearsal.mjs post`.");
  }
  for (let index = 1; index < args.length; index += 2) {
    const argument = args[index];
    if (!definitions.includes(argument)) {
      throw new Error(`Unknown restore verification option: ${argument ?? "missing"}`);
    }
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
  }
  const values = Object.fromEntries(definitions.map((name) => [name.slice(2), valueAfter(args, name)]));
  for (const [name, value] of Object.entries(values)) {
    if (!value || !isAbsolute(value)) {
      throw new Error(`--${name} must be an absolute path.`);
    }
  }
  return { command, ...values };
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

function commit(value, label) {
  if (typeof value !== "string" || !commitPattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toLowerCase();
}

async function* readJsonLines(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function resolveContained(root, candidate, label) {
  if (typeof candidate !== "string" || !candidate || isAbsolute(candidate)) {
    throw new Error(`${label} is not a relative path.`);
  }
  const base = resolve(root);
  const path = resolve(base, candidate);
  if (path === base || !path.startsWith(`${base}/`)) throw new Error(`${label} escapes its root.`);
  return path;
}

async function assertExternalNewFile(path) {
  if (existsSync(path) || existsSync(`${path}.sha256`)) {
    throw new Error(`Restore verification evidence already exists: ${path}`);
  }
  const repo = await realpath(repositoryRoot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(path));
  const location = relative(repo, resolve(parent, basename(path)));
  if (location === "" || !location.startsWith("..") && !isAbsolute(location)) {
    throw new Error("Restore verification evidence must be stored outside the source repository.");
  }
}

async function writeEvidence(path, evidence) {
  await assertExternalNewFile(path);
  await writeAtomicJson(path, evidence, 0o400);
  const checksum = await sha256File(path);
  const checksumPath = `${path}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${basename(path)}\n`, { mode: 0o400 });
  await chmod(checksumPath, 0o400);
  return { output: path, bytes: (await stat(path)).size, sha256: checksum };
}

export async function readVerifiedRestorePlan(inputPath, manifest, backupDirectory) {
  const details = await stat(inputPath);
  const path = details.isDirectory() ? join(inputPath, "restore-plan.json") : inputPath;
  const plan = object(JSON.parse(await readFile(path, "utf8")), "Restore plan");
  if (plan.format !== RESTORE_PLAN_FORMAT) throw new Error("Restore plan format is unsupported.");
  const { planPayloadSha256, ...core } = plan;
  if (digest(planPayloadSha256, "Restore plan payload checksum") !== sha256Object(core)) {
    throw new Error("Restore plan payload checksum does not match.");
  }
  const source = object(plan.sourceBackup, "Restore plan source");
  const postgres = object(object(plan.stores, "Restore stores").postgres, "Restore PostgreSQL store");
  const safety = object(plan.safety, "Restore plan safety");
  if (source.guildId !== manifest.guildId ||
      source.manifestPayloadSha256 !== manifest.manifestPayloadSha256 ||
      postgres.expectedChronicleSequence !== manifest.databaseBoundary.chronicleSequence ||
      sha256Object(postgres.expectedGuildTableRows) !==
        sha256Object(manifest.databaseBoundary.guildTableRows) ||
      safety.requiresEmptyTarget !== true || safety.requiresExplicitTargetResourceIds !== true ||
      safety.mutatesCloudResources !== false) {
    throw new Error("Restore plan is not bound to the verified backup and safe isolated-restore contract.");
  }
  if (typeof source.path === "string") {
    const recorded = resolve(source.path);
    const supplied = resolve(backupDirectory);
    if (recorded !== supplied) {
      throw new Error("Restore plan points to a different backup directory.");
    }
  }
  timestamp(plan.createdAt, "Restore plan creation time");
  return { plan, path, fileSha256: await sha256File(path) };
}

function activeWorkerNames(config) {
  return Object.entries(config.workers)
    .filter(([key]) =>
      (key !== "errorReporter" || config.errorReporting.enabled) &&
      (key !== "webhookReceiver" || config.referenceWebhook.enabled))
    .map(([, worker]) => worker.name)
    .sort();
}

export async function verifyProductionSmokeEvidence(path, config, expectedCommit) {
  const raw = await readFile(path, "utf8");
  const evidence = object(JSON.parse(raw), "Production smoke evidence");
  const { evidenceSha256, ...core } = evidence;
  if (evidence.format !== PRODUCTION_SMOKE_FORMAT ||
      digest(evidenceSha256, "Production smoke payload checksum") !== sha256Object(core)) {
    throw new Error("Production smoke evidence checksum is invalid.");
  }
  const source = object(evidence.source, "Production smoke source");
  if (commit(source.commit, "Production smoke Core commit") !== expectedCommit) {
    throw new Error("Production smoke does not use the exact Core candidate commit.");
  }
  const workshop = object(evidence.workshop, "Production smoke Workshop result");
  if (workshop.accessProtected !== true || workshop.authenticatedServiceCheck !== "passed") {
    throw new Error("Production smoke did not prove Access protection and service authentication.");
  }
  const receiver = evidence.receiver === null ? null : object(evidence.receiver, "Production smoke receiver");
  if (config.referenceWebhook.enabled &&
      (receiver?.status !== 200 || receiver?.unsignedRequestRejected !== true ||
       receiver?.noStore !== true || receiver?.nosniff !== true)) {
    throw new Error("Production smoke did not prove the reference Webhook boundary.");
  }
  if (!Array.isArray(evidence.activeDeployments)) {
    throw new Error("Production smoke has no active deployment inventory.");
  }
  const observedWorkers = evidence.activeDeployments.map((entry) =>
    object(entry, "Production smoke deployment").workerName).sort();
  if (sha256Object(observedWorkers) !== sha256Object(activeWorkerNames(config))) {
    throw new Error("Production smoke deployments do not match the restore target configuration.");
  }
  return {
    checkedAt: timestamp(evidence.checkedAt, "Production smoke check time"),
    evidenceFileSha256: sha256Text(raw),
    evidencePayloadSha256: evidenceSha256,
    accessProtection: "passed",
    serviceAuthentication: "passed",
    webhookHealth: config.referenceWebhook.enabled ? "passed" : "not-configured",
    unsignedWebhookRejected: config.referenceWebhook.enabled ? true : null,
    workerInventorySha256: sha256Object(observedWorkers),
  };
}

function targetStoreMap(config) {
  return {
    kv: {
      context: config.context.kvNamespaceId,
      blueprints: config.resources.blueprintsKvNamespaceId,
      avatars: config.resources.avatarsKvNamespaceId,
    },
    r2: {
      knowledge: config.resources.knowledgeFilesBucket,
      blueprints: config.resources.blueprintContentBucket,
    },
  };
}

async function defaultTargetEvidence(config, databaseUrl) {
  const selection = selectedDeploymentConfig();
  const parsed = new URL(databaseUrl);
  return {
    accountId: config.accountId,
    deploymentConfig: {
      label: selection.evidenceLabel,
      fileSha256: await sha256File(selection.path),
      resolvedSha256: deploymentResourceSummary(config).configSha256,
    },
    deploymentLockSha256: await sha256File(deploymentLockPath),
    database: {
      hostSha256: sha256Text(parsed.hostname),
      databaseSha256: sha256Text(decodeURIComponent(parsed.pathname.replace(/^\//, ""))),
      userSha256: sha256Text(decodeURIComponent(parsed.username)),
    },
    ...targetStoreMap(config),
  };
}

function assertMatchingRows(expected, observed) {
  const keys = Object.keys(expected).sort();
  const observedKeys = Object.keys(observed).sort();
  const mismatches = keys.filter((key) => observed[key] !== expected[key]);
  if (sha256Object(keys) !== sha256Object(observedKeys) || mismatches.length > 0) {
    throw new Error("Restored PostgreSQL table counts do not match the verified backup.");
  }
  return {
    forcedRlsTablesCompared: keys.length,
    rowCountMismatches: 0,
    expectedRowsSha256: sha256Object(expected),
    observedRowsSha256: sha256Object(observed),
  };
}

async function defaultReadKv({ accountId, namespaceId, key, token }) {
  return cloudflareBytes(
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    token,
  );
}

export async function verifyKvStores({
  backupDirectory,
  stores,
  target,
  accountId,
  token,
  listKeys = listKvKeys,
  readValue = defaultReadKv,
}) {
  const results = [];
  for (const store of stores) {
    const namespaceId = target[store.name];
    if (typeof namespaceId !== "string") throw new Error(`No target KV namespace for ${store.name}.`);
    const expected = [];
    for await (const rowValue of readJsonLines(resolveContained(
      backupDirectory,
      store.path,
      `KV backup path for ${store.name}`,
    ))) {
      const row = object(rowValue, `KV backup row for ${store.name}`);
      if (typeof row.key !== "string" || row.base64 !== true || typeof row.value !== "string") {
        throw new Error(`KV backup row is invalid for ${store.name}.`);
      }
      expected.push(row);
    }
    expected.sort((left, right) => left.key.localeCompare(right.key));
    const live = (await listKeys(accountId, namespaceId, token))
      .slice().sort((left, right) => left.name.localeCompare(right.name));
    if (sha256Object(live.map((entry) => entry.name)) !==
        sha256Object(expected.map((entry) => entry.key))) {
      throw new Error(`Restored KV key inventory does not match: ${store.name}.`);
    }
    const records = [];
    let valueBytes = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      const observed = live[index];
      const wantedMetadata = {
        ...(wanted.expiration !== undefined ? { expiration: wanted.expiration } : {}),
        ...(wanted.metadata !== undefined ? { metadata: wanted.metadata } : {}),
      };
      const observedMetadata = {
        ...(observed.expiration !== undefined ? { expiration: observed.expiration } : {}),
        ...(observed.metadata !== undefined ? { metadata: observed.metadata } : {}),
      };
      if (sha256Object(wantedMetadata) !== sha256Object(observedMetadata)) {
        throw new Error(`Restored KV metadata does not match: ${store.name}/${wanted.key}.`);
      }
      const wantedBytes = Buffer.from(wanted.value, "base64");
      const observedBytes = await readValue({ accountId, namespaceId, key: wanted.key, token });
      if (!Buffer.isBuffer(observedBytes) || !observedBytes.equals(wantedBytes)) {
        throw new Error(`Restored KV value does not match: ${store.name}/${wanted.key}.`);
      }
      valueBytes += observedBytes.byteLength;
      records.push({
        key: wanted.key,
        bytes: observedBytes.byteLength,
        sha256: sha256Text(observedBytes),
        metadataSha256: sha256Object(wantedMetadata),
      });
    }
    if (expected.length !== store.keyCount || valueBytes !== store.valueBytes) {
      throw new Error(`Restored KV totals do not match: ${store.name}.`);
    }
    results.push({
      name: store.name,
      namespaceId,
      entries: expected.length,
      valueBytes,
      inventorySha256: sha256Object(records),
      status: "passed",
    });
  }
  return results;
}

async function defaultReadR2({ accountId, bucket, object, token }) {
  return downloadR2Object(accountId, bucket, object, token);
}

export async function verifyR2Stores({
  backupDirectory,
  stores,
  target,
  accountId,
  token,
  listObjects = listR2Objects,
  readObject = defaultReadR2,
}) {
  const results = [];
  for (const store of stores) {
    const bucket = target[store.name];
    if (typeof bucket !== "string") throw new Error(`No target R2 bucket for ${store.name}.`);
    const expected = [];
    for await (const recordValue of readJsonLines(resolveContained(
      backupDirectory,
      store.index,
      `R2 backup index for ${store.name}`,
    ))) {
      const record = object(recordValue, `R2 backup record for ${store.name}`);
      const key = typeof record.key === "string" ? record.key : record.path;
      if (typeof key !== "string" || !Number.isSafeInteger(record.bytes) || record.bytes < 0 ||
          typeof record.sha256 !== "string" || !digestPattern.test(record.sha256)) {
        throw new Error(`R2 backup record is invalid for ${store.name}.`);
      }
      expected.push({ ...record, key });
    }
    expected.sort((left, right) => left.key.localeCompare(right.key));
    const live = (await listObjects(accountId, bucket, token))
      .slice().sort((left, right) => left.key.localeCompare(right.key));
    if (sha256Object(live.map((entry) => entry.key)) !==
        sha256Object(expected.map((entry) => entry.key))) {
      throw new Error(`Restored R2 object inventory does not match: ${store.name}.`);
    }
    const records = [];
    let bytes = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const wanted = expected[index];
      const observed = live[index];
      if (observed.size !== wanted.bytes) {
        throw new Error(`Restored R2 object size does not match: ${store.name}/${wanted.key}.`);
      }
      for (const [expectedName, observedName] of [
        ["storageClass", "storageClass"],
        ["httpMetadata", "httpMetadata"],
        ["customMetadata", "customMetadata"],
      ]) {
        if (wanted[expectedName] !== undefined &&
            sha256Object(wanted[expectedName]) !== sha256Object(observed[observedName])) {
          throw new Error(`Restored R2 metadata does not match: ${store.name}/${wanted.key}.`);
        }
      }
      const data = await readObject({ accountId, bucket, object: observed, token });
      if (!Buffer.isBuffer(data) || data.byteLength !== wanted.bytes ||
          sha256Text(data) !== wanted.sha256) {
        throw new Error(`Restored R2 object does not match: ${store.name}/${wanted.key}.`);
      }
      bytes += data.byteLength;
      records.push({ key: wanted.key, bytes: data.byteLength, sha256: wanted.sha256 });
    }
    if (expected.length !== store.objectCount || bytes !== store.bytes) {
      throw new Error(`Restored R2 totals do not match: ${store.name}.`);
    }
    results.push({
      name: store.name,
      bucket,
      objects: expected.length,
      bytes,
      inventorySha256: sha256Object(records),
      status: "passed",
    });
  }
  return results;
}

function sourceEvidence(source) {
  const cloudflareOs = source.submodules?.find((entry) => entry.path === "cloudflare-os");
  if (!cloudflareOs) throw new Error("The Core source has no pinned cloudflare-os submodule.");
  return {
    coreCommit: commit(source.commit, "Core source commit"),
    coreTree: commit(source.tree, "Core source tree"),
    cloudflareOsCommit: commit(cloudflareOs.commit, "Cloudflare OS source commit"),
  };
}

export async function verifyRestorePreRecovery(input, dependencies = {}) {
  const executionMode = dependencies.executionMode ?? "injected-runner";
  const now = dependencies.now ?? (() => new Date());
  const databaseUrl = input.databaseUrl;
  const token = input.cloudflareToken;
  if (!databaseUrl || !token) throw new Error("PostgreSQL and Cloudflare purchaser credentials are required.");
  assertVerifiedTlsConfiguration(databaseUrl);
  const backupVerifier = dependencies.backupVerifier ?? verifyBackupDirectory;
  const manifest = await backupVerifier(input.backupDirectory);
  const planReader = dependencies.planReader ?? readVerifiedRestorePlan;
  const { plan, fileSha256: restorePlanFileSha256 } = await planReader(
    input.restorePlanPath,
    manifest,
    input.backupDirectory,
  );
  const config = dependencies.config ?? await readResolvedDeployment();
  if (config.guild.id !== manifest.guildId) {
    throw new Error("Restore target Guild does not match the verified backup.");
  }
  const source = sourceEvidence(dependencies.source ?? gitSourceSnapshot({ requireClean: true }));
  const target = dependencies.targetEvidence ?? await defaultTargetEvidence(config, databaseUrl);
  const readBoundary = dependencies.databaseBoundaryReader ?? databaseBoundary;
  const boundary = await readBoundary(databaseUrl, config.guild.id);
  const rows = assertMatchingRows(
    manifest.databaseBoundary.guildTableRows,
    boundary.guildTableRows,
  );
  if (boundary.chronicleSequence !== manifest.databaseBoundary.chronicleSequence) {
    throw new Error("Restored Chronicle boundary does not match the verified backup.");
  }
  const stores = targetStoreMap(config);
  const kv = await verifyKvStores({
    backupDirectory: input.backupDirectory,
    stores: manifest.stores.kv,
    target: stores.kv,
    accountId: config.accountId,
    token,
    listKeys: dependencies.listKvKeys,
    readValue: dependencies.readKvValue,
  });
  const r2 = await verifyR2Stores({
    backupDirectory: input.backupDirectory,
    stores: manifest.stores.r2,
    target: stores.r2,
    accountId: config.accountId,
    token,
    listObjects: dependencies.listR2Objects,
    readObject: dependencies.readR2Object,
  });
  const smokeVerifier = dependencies.smokeVerifier ?? verifyProductionSmokeEvidence;
  const smoke = await smokeVerifier(input.smokeEvidencePath, config, source.coreCommit);
  if (Date.parse(plan.createdAt) < Date.parse(manifest.createdAt) ||
      Date.parse(smoke.checkedAt) < Date.parse(plan.createdAt)) {
    throw new Error("Restore evidence is not ordered from backup through plan to initial smoke.");
  }
  const core = {
    format: RESTORE_PRE_RECOVERY_FORMAT,
    generatedAt: now().toISOString(),
    executionMode,
    externalCloudQueried: executionMode === "live-cli",
    source: {
      ...source,
      guildId: manifest.guildId,
      backupSourceCoreCommit: commit(manifest.source.commit, "Backup source Core commit"),
      backupCreatedAt: timestamp(manifest.createdAt, "Backup creation time"),
      backupManifestPayloadSha256: digest(
        manifest.manifestPayloadSha256,
        "Backup manifest payload checksum",
      ),
      restorePlanCreatedAt: timestamp(plan.createdAt, "Restore plan creation time"),
      restorePlanPayloadSha256: digest(plan.planPayloadSha256, "Restore plan payload checksum"),
      restorePlanFileSha256,
    },
    target,
    verification: {
      backupManifestChecksum: "passed",
      restorePlanChecksum: "passed",
      database: {
        ...rows,
        expectedChronicleSequence: manifest.databaseBoundary.chronicleSequence,
        restoredChronicleSequence: boundary.chronicleSequence,
        status: "passed",
      },
      kv: { status: "passed", stores: kv, inventorySha256: sha256Object(kv) },
      r2: { status: "passed", stores: r2, inventorySha256: sha256Object(r2) },
      authenticatedSmoke: smoke,
    },
    recoveryBaseline: {
      chronicleSequence: boundary.chronicleSequence,
      capturedAt: now().toISOString(),
    },
    mutatesDatabase: false,
    mutatesCloudResources: false,
    productionChanged: false,
    plaintextSecretsIncluded: false,
    status: "passed",
  };
  return { ...core, evidenceSha256: sha256Object(core) };
}

export const BREAK_GLASS_RECOVERY_BOUNDARY_SQL = `WITH latest_recovery AS (
  SELECT recovery.*
    FROM break_glass_recoveries recovery
   WHERE recovery.guild_id = $1 AND recovery.state = 'completed'
   ORDER BY recovery.completed_at DESC, recovery.id DESC
   LIMIT 1
), used_event AS (
  SELECT event.sequence, event.occurred_at
    FROM chronicle_events event
    JOIN latest_recovery recovery
      ON event.guild_id = recovery.guild_id
     AND event.action = 'break_glass.used'
     AND event.subject_type = 'break_glass_recovery'
     AND event.subject_id = recovery.id
   ORDER BY event.sequence DESC
   LIMIT 1
)
SELECT recovery.id AS recovery_id,
       recovery.code_set_id,
       recovery.code_id,
       recovery.completed_at,
       recovery.new_root_identity_id,
       code_set.generation,
       code.consumed_at,
       code.consumed_by_identity_id,
       configuration.current_code_set_id,
       configuration.version AS configuration_version,
       guild_row.root_owner_identity_id,
       identity_row.kind AS root_kind,
       identity_row.status AS root_status,
       membership_row.state AS root_membership_state,
       (SELECT count(*)::integer FROM break_glass_codes generation_code
         WHERE generation_code.guild_id = recovery.guild_id
           AND generation_code.code_set_id = recovery.code_set_id
           AND generation_code.consumed_at IS NOT NULL) AS codes_consumed,
       event.sequence::text AS break_glass_used_sequence,
       event.occurred_at AS break_glass_used_at,
       COALESCE((SELECT max(sequence) FROM chronicle_events WHERE guild_id = $1), 0)::text
         AS current_chronicle_sequence
  FROM latest_recovery recovery
  JOIN break_glass_code_sets code_set
    ON code_set.guild_id = recovery.guild_id AND code_set.id = recovery.code_set_id
  JOIN break_glass_codes code
    ON code.guild_id = recovery.guild_id AND code.id = recovery.code_id
  JOIN break_glass_configurations configuration ON configuration.guild_id = recovery.guild_id
  JOIN guilds guild_row ON guild_row.id = recovery.guild_id
  JOIN identities identity_row
    ON identity_row.guild_id = recovery.guild_id AND identity_row.id = recovery.new_root_identity_id
  JOIN memberships membership_row
    ON membership_row.guild_id = recovery.guild_id
   AND membership_row.identity_id = recovery.new_root_identity_id
  JOIN used_event event ON true`;

export async function breakGlassRecoveryBoundary(connectionString, guildId) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SELECT set_config('app.guild_id', $1, true)", [guildId]);
    const result = await client.query(BREAK_GLASS_RECOVERY_BOUNDARY_SQL, [guildId]);
    const columns = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'break_glass_codes'
        ORDER BY ordinal_position`,
    )).rows.map((row) => row.column_name);
    await client.query("COMMIT");
    return { row: result.rows[0] ?? null, codeColumns: columns };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the first read failure.
    }
    throw error;
  } finally {
    await client.end();
  }
}

function validatePreEvidence(value) {
  const evidence = object(value, "Pre-recovery evidence");
  const { evidenceSha256, ...core } = evidence;
  if (evidence.format !== RESTORE_PRE_RECOVERY_FORMAT ||
      digest(evidenceSha256, "Pre-recovery payload checksum") !== sha256Object(core) ||
      evidence.status !== "passed" || evidence.productionChanged !== false ||
      evidence.plaintextSecretsIncluded !== false) {
    throw new Error("Pre-recovery verification evidence is invalid.");
  }
  return evidence;
}

function validateRecoveryBoundary(boundary, baseline) {
  const row = boundary.row;
  if (!row) throw new Error("No completed Break Glass recovery exists on the restore target.");
  const prohibitedColumns = boundary.codeColumns.filter((name) =>
    name === "code" || /plaintext|secret/i.test(name));
  if (prohibitedColumns.length > 0) {
    throw new Error("Break Glass storage contains a plaintext-capable code column.");
  }
  const usedSequence = String(row.break_glass_used_sequence ?? "");
  const currentSequence = String(row.current_chronicle_sequence ?? "");
  if (!/^(?:0|[1-9][0-9]*)$/.test(usedSequence) ||
      !/^(?:0|[1-9][0-9]*)$/.test(currentSequence) ||
      BigInt(usedSequence) <= BigInt(baseline) || BigInt(currentSequence) < BigInt(usedSequence) ||
      row.root_owner_identity_id !== row.new_root_identity_id ||
      row.consumed_by_identity_id !== row.new_root_identity_id || row.consumed_at === null ||
      row.current_code_set_id !== null || row.root_kind !== "human" ||
      row.root_status !== "active" || row.root_membership_state !== "active" ||
      row.codes_consumed !== 1 || row.configuration_version !== row.generation + 1) {
    throw new Error("Break Glass recovery did not satisfy the atomic Human Root recovery boundary.");
  }
  return {
    status: "passed",
    recoveryCompleted: true,
    recoveryId: row.recovery_id,
    codeSetId: row.code_set_id,
    generation: row.generation,
    codesConsumed: row.codes_consumed,
    codeGenerationInvalidated: true,
    plaintextCodeColumns: 0,
    plaintextCodeRetained: false,
    newRootIdentityId: row.new_root_identity_id,
    newRootActorKind: row.root_kind,
    newRootIdentityStatus: row.root_status,
    newRootMembershipState: row.root_membership_state,
    completedAt: timestamp(
      row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
      "Break Glass completion time",
    ),
    chronicle: {
      baselineSequence: baseline,
      breakGlassUsedSequence: usedSequence,
      currentSequence,
      breakGlassUsedAt: timestamp(
        row.break_glass_used_at instanceof Date
          ? row.break_glass_used_at.toISOString()
          : row.break_glass_used_at,
        "Break Glass Chronicle time",
      ),
    },
  };
}

function sameTarget(left, right) {
  return sha256Object(left) === sha256Object(right);
}

export async function verifyRestorePostRecovery(input, dependencies = {}) {
  const executionMode = dependencies.executionMode ?? "injected-runner";
  const now = dependencies.now ?? (() => new Date());
  if (!input.databaseUrl) throw new Error("The purchaser PostgreSQL credential is required.");
  assertVerifiedTlsConfiguration(input.databaseUrl);
  const preRaw = await readFile(input.preRecoveryEvidencePath, "utf8");
  const pre = validatePreEvidence(JSON.parse(preRaw));
  const config = dependencies.config ?? await readResolvedDeployment();
  const source = sourceEvidence(dependencies.source ?? gitSourceSnapshot({ requireClean: true }));
  if (pre.source.coreCommit !== source.coreCommit ||
      pre.source.cloudflareOsCommit !== source.cloudflareOsCommit ||
      pre.source.guildId !== config.guild.id) {
    throw new Error("Post-recovery verification does not use the pre-recovery candidate and Guild.");
  }
  const target = dependencies.targetEvidence ?? await defaultTargetEvidence(config, input.databaseUrl);
  if (!sameTarget(pre.target, target)) {
    throw new Error("Post-recovery verification points to a different restore target.");
  }
  const recoveryReader = dependencies.recoveryBoundaryReader ?? breakGlassRecoveryBoundary;
  const boundary = await recoveryReader(input.databaseUrl, config.guild.id);
  const recovery = validateRecoveryBoundary(boundary, pre.recoveryBaseline.chronicleSequence);
  const smokeVerifier = dependencies.smokeVerifier ?? verifyProductionSmokeEvidence;
  const smoke = await smokeVerifier(input.smokeEvidencePath, config, source.coreCommit);
  if (Date.parse(pre.verification.authenticatedSmoke.checkedAt) > Date.parse(recovery.completedAt) ||
      Date.parse(smoke.checkedAt) < Date.parse(recovery.completedAt)) {
    throw new Error("Authenticated smoke evidence does not bracket the completed Break Glass recovery.");
  }
  const rtoSeconds = (Date.parse(smoke.checkedAt) - Date.parse(pre.source.restorePlanCreatedAt)) / 1000;
  if (!Number.isFinite(rtoSeconds) || rtoSeconds <= 0) {
    throw new Error("Restore rehearsal did not produce a positive measured RTO.");
  }
  const core = {
    format: RESTORE_VERIFICATION_FORMAT,
    generatedAt: now().toISOString(),
    executionMode,
    externalCloudQueried: executionMode === "live-cli" && pre.externalCloudQueried === true,
    source: pre.source,
    target,
    preRecoveryEvidence: pre,
    preRecoveryEvidenceFileSha256: sha256Text(preRaw),
    verification: {
      database: pre.verification.database,
      kv: pre.verification.kv,
      r2: pre.verification.r2,
      initialAuthenticatedSmoke: pre.verification.authenticatedSmoke,
      recovery,
      postRecoveryAuthenticatedSmoke: smoke,
    },
    recoveryObjectives: {
      rpo: {
        valueSeconds: 0,
        basis: "Every verified backup database row boundary, KV value, and R2 object matched before recovery.",
      },
      rto: {
        valueSeconds: rtoSeconds,
        from: pre.source.restorePlanCreatedAt,
        to: smoke.checkedAt,
        basis: "Restore plan creation to successful post-recovery authenticated smoke.",
      },
    },
    mutatesDatabase: false,
    mutatesCloudResources: false,
    productionChanged: false,
    plaintextSecretsIncluded: false,
    status: "passed",
  };
  return { ...core, evidenceSha256: sha256Object(core) };
}

async function main() {
  const options = parseRestoreVerificationArguments(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for restore verification.");
  if (options.command === "pre") {
    const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!cloudflareToken) throw new Error("CLOUDFLARE_API_TOKEN is required for pre-recovery verification.");
    const evidence = await verifyRestorePreRecovery({
      databaseUrl,
      cloudflareToken,
      backupDirectory: options.backup,
      restorePlanPath: options["restore-plan"],
      smokeEvidencePath: options.smoke,
    }, { executionMode: "live-cli" });
    console.log(JSON.stringify({ ok: true, ...await writeEvidence(options.output, evidence) }));
    return;
  }
  const evidence = await verifyRestorePostRecovery({
    databaseUrl,
    preRecoveryEvidencePath: options.pre,
    smokeEvidencePath: options.smoke,
  }, { executionMode: "live-cli" });
  console.log(JSON.stringify({ ok: true, ...await writeEvidence(options.output, evidence) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Restore verification failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
