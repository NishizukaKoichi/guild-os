import { existsSync } from "node:fs";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  captureWorkerDeployments,
  assertResolvedResources,
  deploymentLockPath,
  deploymentPath,
  deploymentResourceSummary,
  gitSourceSnapshot,
  migrationInventory,
  readResolvedDeployment,
  repositoryRoot,
  runCapture,
  sha256File,
  sha256Object,
  workerEntries,
  writeAtomicJson,
} from "./ops-core.mjs";
import { verifyProductionDatabase } from "./database-preflight.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseReleaseArguments(args) {
  args = args.filter((argument) => argument !== "--");
  const output = valueAfter(args, "--output");
  if (!output || !isAbsolute(output)) {
    throw new Error("--output must be an absolute JSON file path outside the repository.");
  }
  const known = new Set(["--output", "--url"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--offline") continue;
    if (!known.has(argument)) throw new Error(`Unknown release-manifest option: ${argument}`);
    index += 1;
  }
  return {
    output,
    workshopUrl: valueAfter(args, "--url"),
    offline: args.includes("--offline"),
  };
}

async function assertExternalNewFile(path) {
  if (existsSync(path) || existsSync(`${path}.sha256`)) {
    throw new Error(`Release evidence already exists: ${path}`);
  }
  const repo = await realpath(repositoryRoot);
  const lexicalLocation = relative(repo, resolve(path));
  if (lexicalLocation === "" ||
      !lexicalLocation.startsWith("..") && !isAbsolute(lexicalLocation)) {
    throw new Error("Release evidence must be stored outside the source repository.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(path));
  const location = relative(repo, resolve(parent, basename(path)));
  if (location === "" || !location.startsWith("..") && !isAbsolute(location)) {
    throw new Error("Release evidence must be stored outside the source repository.");
  }
}

function runtimeSnapshot() {
  return {
    node: process.version,
    pnpm: runCapture("pnpm", ["--version"]),
    wrangler: runCapture("pnpm", ["exec", "wrangler", "--version"]),
  };
}

export async function buildReleaseManifest({
  now = new Date(),
  offline = false,
  deployments,
  source,
  config,
  runtime,
  database,
  workshopUrl = null,
} = {}) {
  const resolvedConfig = config ?? await readResolvedDeployment();
  if (!offline) assertResolvedResources(resolvedConfig);
  const sourceSnapshot = source ?? gitSourceSnapshot({ requireClean: true });
  const migrations = await migrationInventory();
  const activeDeployments = deployments ?? (offline
    ? workerEntries(resolvedConfig).map(({ key, name }) => ({
      key,
      workerName: name,
      status: "not-queried",
    }))
    : captureWorkerDeployments(resolvedConfig));
  const databaseVerification = database ?? (offline
    ? { status: "not-queried" }
    : await verifyProductionDatabase(process.env.DATABASE_URL));
  const files = {
    packageLock: {
      path: "pnpm-lock.yaml",
      sha256: await sha256File(resolve(repositoryRoot, "pnpm-lock.yaml")),
    },
    deployment: {
      path: "deployment.jsonc",
      sha256: await sha256File(deploymentPath),
    },
    deploymentLock: existsSync(deploymentLockPath) ? {
      path: "deployment.lock.json",
      sha256: await sha256File(deploymentLockPath),
    } : null,
  };
  const generatedAt = now.toISOString();
  const core = {
    format: "guild-os-release-evidence/v1",
    generatedAt,
    releaseId: `${resolvedConfig.guild.id}:${sourceSnapshot.commit}:${generatedAt}`,
    source: sourceSnapshot,
    runtime: runtime ?? runtimeSnapshot(),
    database: databaseVerification,
    deployment: deploymentResourceSummary(resolvedConfig),
    workshopUrl,
    activeDeployments,
    migrations,
    files,
    verification: {
      localGatesRequired: [
        "pnpm test",
        "pnpm build",
        "pnpm lint",
        "PostgreSQL integration",
        "Gatekeeper integration",
        "Playwright E2E",
      ],
      cloudStateQueried: !offline,
    },
  };
  return { ...core, evidenceSha256: sha256Object(core) };
}

async function main() {
  const options = parseReleaseArguments(process.argv.slice(2));
  await assertExternalNewFile(options.output);
  const manifest = await buildReleaseManifest({
    offline: options.offline,
    workshopUrl: options.workshopUrl,
  });
  await writeAtomicJson(options.output, manifest, 0o400);
  const details = await stat(options.output);
  const checksum = await sha256File(options.output);
  const checksumPath = `${options.output}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${options.output.split("/").at(-1)}\n`, {
    mode: 0o400,
  });
  await chmod(checksumPath, 0o400);
  console.log(JSON.stringify({
    ok: true,
    output: options.output,
    bytes: details.size,
    sha256: checksum,
    cloudStateQueried: manifest.verification.cloudStateQueried,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Release evidence failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
