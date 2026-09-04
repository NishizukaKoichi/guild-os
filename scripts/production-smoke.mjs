import { existsSync } from "node:fs";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertWorkerDeploymentsMatchRelease,
  assertResolvedResources,
  captureWorkerDeployments,
  canonicalWorkshopUrl,
  expectedAccountId,
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
  url = canonicalWorkshopUrl(url);
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
    authenticatedRedirectPolicy: "error",
  };

  const { clientId, clientSecret } = credentials;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("Set both CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET or neither.");
  }
  if (!clientId) return result;
  const authenticated = await fetchWithTimeout(url, {
    redirect: "error",
    headers: {
      "cf-access-client-id": clientId,
      "cf-access-client-secret": clientSecret,
    },
  }, fetcher);
  const body = await authenticated.text();
  if (authenticated.status !== 200 || authenticated.redirected ||
      (authenticated.url && canonicalWorkshopUrl(authenticated.url) !== url) || !/cloudflare os/i.test(body)) {
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

export async function captureWorkersDevRouting(config, fetcher = fetch) {
  if (config.workers.workshop.route?.workersDev !== true) return null;
  const accountId = expectedAccountId(config);
  const workerName = config.workers.workshop.name;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Workers.dev smoke requires a purchaser-owned API token to verify account routing.");
  async function read(path) {
    const response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`, {
      method: "GET", redirect: "error", headers: { authorization: `Bearer ${token}` },
    }, fetcher);
    const value = await response.json().catch(() => null);
    if (response.status !== 200 || value?.success !== true || !value.result) {
      throw new Error("Unable to verify the configured account's workers.dev routing.");
    }
    return value.result;
  }
  const subdomain = await read("workers/subdomain");
  const script = await read(`workers/scripts/${encodeURIComponent(workerName)}/subdomain`);
  const routing = { accountId, workerName, subdomain: subdomain.subdomain, enabled: script.enabled };
  productionUrls(config, undefined, routing);
  return routing;
}

export async function runProductionSmoke({
  config, workshopUrl, fetcher = fetch, deployments, sourceSnapshot,
} = {}) {
  const resolvedConfig = config ?? await readResolvedDeployment();
  assertResolvedResources(resolvedConfig);
  expectedAccountId(resolvedConfig);
  const source = sourceSnapshot ?? gitSourceSnapshot({ requireClean: true });
  const workshopRouting = await captureWorkersDevRouting(resolvedConfig, fetcher);
  const urls = productionUrls(resolvedConfig, workshopUrl, workshopRouting);
  const [workshop, receiver] = await Promise.all([
    smokeWorkshop(urls.workshop, resolvedConfig.access.issuer, {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    }, fetcher),
    urls.receiver ? smokeReceiver(urls.receiver, fetcher) : Promise.resolve(null),
  ]);
  const activeDeployments = deployments ?? captureWorkerDeployments(resolvedConfig);
  if (!deployments) {
    assertWorkerDeploymentsMatchRelease(activeDeployments, source.commit, resolvedConfig);
  }
  // Injected transport/source/deployments can exercise contracts, never attest a live release.
  const live = fetcher === fetch && deployments === undefined && sourceSnapshot === undefined;
  const core = {
    format: "guild-os-production-smoke/v1",
    checkedAt: new Date().toISOString(),
    source,
    target: {
      accountId: resolvedConfig.accountId,
      guildId: resolvedConfig.guild.id,
      configSha256: sha256Object(resolvedConfig),
    },
    deploymentVerification: {
      executionMode: live ? "live-cli" : "injected-runner",
      releaseCommit: live ? source.commit : null,
      inventorySha256: sha256Object(activeDeployments),
    },
    workshop,
    workshopRouting,
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
