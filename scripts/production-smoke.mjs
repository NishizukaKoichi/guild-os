import { existsSync } from "node:fs";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertResolvedResources,
  captureWorkerDeployments,
  gitSourceSnapshot,
  productionUrls,
  readResolvedDeployment,
  repositoryRoot,
  sha256File,
  sha256Object,
  writeAtomicJson,
} from "./ops-core.mjs";

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseSmokeArguments(args) {
  args = args.filter((argument) => argument !== "--");
  const output = valueAfter(args, "--output");
  if (!output || !isAbsolute(output)) {
    throw new Error("--output must be an absolute JSON file path outside the repository.");
  }
  const known = new Set(["--output", "--url"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!known.has(argument)) throw new Error(`Unknown production-smoke option: ${argument}`);
    index += 1;
  }
  return { output, workshopUrl: valueAfter(args, "--url") };
}

async function assertExternalNewFile(path) {
  if (existsSync(path) || existsSync(`${path}.sha256`)) {
    throw new Error(`Production smoke evidence already exists: ${path}`);
  }
  const repo = await realpath(repositoryRoot);
  const lexicalLocation = relative(repo, resolve(path));
  if (lexicalLocation === "" ||
      !lexicalLocation.startsWith("..") && !isAbsolute(lexicalLocation)) {
    throw new Error("Production smoke evidence must be stored outside the source repository.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(path));
  const location = relative(repo, resolve(parent, basename(path)));
  if (location === "" || !location.startsWith("..") && !isAbsolute(location)) {
    throw new Error("Production smoke evidence must be stored outside the source repository.");
  }
}

async function fetchWithTimeout(url, options = {}, fetcher = fetch) {
  return fetcher(url, {
    ...options,
    headers: {
      "user-agent": "guild-os-production-smoke/1",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

function accessRedirectAccepted(response, issuer) {
  if (![301, 302, 303, 307, 308].includes(response.status)) return false;
  const location = response.headers.get("location");
  if (!location) return false;
  const target = new URL(location, issuer);
  return target.origin === new URL(issuer).origin &&
    target.pathname.includes("/cdn-cgi/access/");
}

export async function smokeWorkshop(url, issuer, credentials = {}, fetcher = fetch) {
  const unauthenticated = await fetchWithTimeout(url, { redirect: "manual" }, fetcher);
  if (!accessRedirectAccepted(unauthenticated, issuer)) {
    throw new Error(
      `Workshop is not demonstrably protected by Cloudflare Access (HTTP ${unauthenticated.status}).`,
    );
  }
  const result = {
    url,
    unauthenticatedStatus: unauthenticated.status,
    accessProtected: true,
    authenticatedServiceCheck: "not-configured",
  };

  const { clientId, clientSecret } = credentials;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("Set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET or neither.");
  }
  if (!clientId) return result;
  const authenticated = await fetchWithTimeout(url, {
    redirect: "follow",
    headers: {
      "cf-access-client-id": clientId,
      "cf-access-client-secret": clientSecret,
    },
  }, fetcher);
  const body = await authenticated.text();
  if (authenticated.status !== 200 || !/cloudflare os/i.test(body)) {
    throw new Error(
      `Access service-token Workshop smoke failed (HTTP ${authenticated.status}).`,
    );
  }
  return { ...result, authenticatedServiceCheck: "passed" };
}

export async function smokeReceiver(healthUrl, fetcher = fetch) {
  const health = await fetchWithTimeout(healthUrl, { redirect: "error" }, fetcher);
  const healthBody = await health.json().catch(() => null);
  if (health.status !== 200 || healthBody?.ok !== true ||
      healthBody?.service !== "guild-os-webhook-receiver" ||
      health.headers.get("cache-control") !== "no-store" ||
      health.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("Reference Webhook health response is invalid.");
  }

  const timestamp = new Date().toISOString();
  const unsigned = await fetchWithTimeout(healthUrl.replace(/\/healthz$/, "/guild-events"), {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `smoke-unsigned-${Date.now()}`,
      "x-guild-event": "smoke.unsigned",
      "x-guild-timestamp": timestamp,
    },
    body: "{}",
  }, fetcher);
  if (unsigned.status !== 401) {
    throw new Error(`Reference Webhook accepted an unsigned request (HTTP ${unsigned.status}).`);
  }
  return {
    healthUrl,
    status: health.status,
    noStore: true,
    nosniff: true,
    unsignedRequestRejected: true,
  };
}

export async function runProductionSmoke({ config, workshopUrl, fetcher = fetch, deployments } = {}) {
  const resolvedConfig = config ?? await readResolvedDeployment();
  assertResolvedResources(resolvedConfig);
  const urls = productionUrls(resolvedConfig, workshopUrl);
  const [workshop, receiver] = await Promise.all([
    smokeWorkshop(urls.workshop, resolvedConfig.access.issuer, {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    }, fetcher),
    urls.receiver ? smokeReceiver(urls.receiver, fetcher) : Promise.resolve(null),
  ]);
  const activeDeployments = deployments ?? captureWorkerDeployments(resolvedConfig);
  const core = {
    format: "guild-os-production-smoke/v1",
    checkedAt: new Date().toISOString(),
    source: gitSourceSnapshot({ requireClean: true }),
    workshop,
    receiver,
    activeDeployments,
    residualManualChecks: [
      "Human Access login and explicit Guild initialization",
      "Invitation claim from a second Human session",
      "Knowledge, Ask, Work, Decision, Inbox, Chronicle, and Agent approval flow",
      "Root transfer and separately authenticated Break Glass rehearsal",
      "390px and desktop visual review in the deployed Workshop",
    ],
  };
  return { ...core, evidenceSha256: sha256Object(core) };
}

async function main() {
  const options = parseSmokeArguments(process.argv.slice(2));
  await assertExternalNewFile(options.output);
  const evidence = await runProductionSmoke({ workshopUrl: options.workshopUrl });
  await writeAtomicJson(options.output, evidence, 0o400);
  const details = await stat(options.output);
  const checksum = await sha256File(options.output);
  const checksumPath = `${options.output}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${basename(options.output)}\n`, { mode: 0o400 });
  await chmod(checksumPath, 0o400);
  console.log(JSON.stringify({
    ok: true,
    output: options.output,
    bytes: details.size,
    sha256: checksum,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Production smoke failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
