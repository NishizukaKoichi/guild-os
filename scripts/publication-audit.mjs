import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GITLEAKS_VERSION = "8.30.1";
export const PUBLICATION_AUDIT_FORMAT = "guild-os-open-core-publication-audit/v1";
export const FALSE_POSITIVE_REGISTRY_FORMAT =
  "guild-os-publication-false-positive-registry/v1";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(repositoryRoot, "scripts/publication-false-positives.json");
const ignorePath = resolve(repositoryRoot, ".gitleaksignore");
const digestPattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(value, label, maximum = 2_000) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function requiredInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}

function checkedGit(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function scannerEnvironment() {
  const environment = { ...process.env };
  delete environment.GITLEAKS_CONFIG;
  delete environment.GITLEAKS_CONFIG_TOML;
  return environment;
}

function runScanner(binary, args, cwd = repositoryRoot) {
  return spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    env: scannerEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parseFinding(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gitleaks emitted an invalid finding.");
  }
  return {
    fingerprint: requiredText(value.Fingerprint, "Finding fingerprint"),
    commit: requiredText(value.Commit, "Finding commit", 40).toLowerCase(),
    file: requiredText(value.File, "Finding file"),
    line: requiredInteger(value.StartLine, "Finding line"),
    ruleId: requiredText(value.RuleID, "Finding rule"),
    secret: requiredText(value.Secret, "Redacted finding value"),
  };
}

function parseRegistry(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      value.format !== FALSE_POSITIVE_REGISTRY_FORMAT || value.scanner !== "gitleaks" ||
      value.scannerVersion !== GITLEAKS_VERSION || !Array.isArray(value.entries)) {
    throw new Error("Publication false-positive registry is invalid.");
  }
  const entries = value.entries.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Publication false-positive registry entry is invalid.");
    }
    const parsed = {
      fingerprint: requiredText(entry.fingerprint, "Registry fingerprint"),
      commit: requiredText(entry.commit, "Registry commit", 40).toLowerCase(),
      file: requiredText(entry.file, "Registry file"),
      line: requiredInteger(entry.line, "Registry line"),
      ruleId: requiredText(entry.ruleId, "Registry rule"),
      lineSha256: requiredText(entry.lineSha256, "Registry line checksum", 64).toLowerCase(),
      classification: requiredText(entry.classification, "Registry classification"),
      reason: requiredText(entry.reason, "Registry reason"),
    };
    if (!commitPattern.test(parsed.commit) || !digestPattern.test(parsed.lineSha256) ||
        parsed.classification !== "synthetic-test-fixture" ||
        !/(?:__tests__|\.test\.|\.integration\.test\.)/.test(parsed.file)) {
      throw new Error(`Registry entry is not a constrained synthetic test fixture: ${parsed.fingerprint}`);
    }
    const expectedFingerprint = `${parsed.commit}:${parsed.file}:${parsed.ruleId}:${parsed.line}`;
    if (parsed.fingerprint !== expectedFingerprint) {
      throw new Error(`Registry fingerprint fields disagree: ${parsed.fingerprint}`);
    }
    return parsed;
  });
  if (new Set(entries.map((entry) => entry.fingerprint)).size !== entries.length) {
    throw new Error("Publication false-positive registry contains a duplicate fingerprint.");
  }
  return entries;
}

export function verifyReviewedFindings({ findings, registry, ignoredFingerprints, historicLine }) {
  const parsedFindings = findings.map(parseFinding);
  const parsedRegistry = parseRegistry({
    format: FALSE_POSITIVE_REGISTRY_FORMAT,
    scanner: "gitleaks",
    scannerVersion: GITLEAKS_VERSION,
    entries: registry,
  });
  const expected = [...parsedRegistry.map((entry) => entry.fingerprint)].sort();
  const ignored = [...ignoredFingerprints].sort();
  const observed = [...parsedFindings.map((finding) => finding.fingerprint)].sort();
  if (JSON.stringify(ignored) !== JSON.stringify(expected)) {
    throw new Error(".gitleaksignore must exactly match the reviewed false-positive registry.");
  }
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error("Gitleaks found an unreviewed or no-longer-reproducible history finding.");
  }
  const findingsByFingerprint = new Map(parsedFindings.map((finding) => [finding.fingerprint, finding]));
  for (const entry of parsedRegistry) {
    const finding = findingsByFingerprint.get(entry.fingerprint);
    if (!finding || finding.secret !== "REDACTED" || finding.commit !== entry.commit ||
        finding.file !== entry.file || finding.line !== entry.line || finding.ruleId !== entry.ruleId) {
      throw new Error(`Reviewed finding metadata changed: ${entry.fingerprint}`);
    }
    if (sha256(historicLine(entry.commit, entry.file, entry.line)) !== entry.lineSha256) {
      throw new Error(`Reviewed historical line changed: ${entry.fingerprint}`);
    }
  }
  return parsedRegistry;
}

function historicLine(commit, file, line) {
  const source = checkedGit(["show", `${commit}:${file}`]);
  const value = source.split(/\r?\n/)[line - 1];
  if (value === undefined) throw new Error(`Reviewed historical line is missing: ${commit}:${file}:${line}`);
  return value;
}

function parseArguments(args) {
  const normalized = args.filter((argument) => argument !== "--");
  const known = new Set(["--output", "--gitleaks-bin"]);
  const result = {};
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (!known.has(name) || !value || value.startsWith("--")) {
      throw new Error(`Invalid publication-audit argument: ${name ?? "missing"}`);
    }
    result[name] = value;
  }
  const output = result["--output"];
  if (!output || !isAbsolute(output)) {
    throw new Error("--output must be an absolute JSON path outside the repository.");
  }
  return {
    output: resolve(output),
    gitleaksBinary: result["--gitleaks-bin"] ?? process.env.GITLEAKS_BIN ?? "gitleaks",
  };
}

async function assertNewExternalOutput(output) {
  if (existsSync(output)) throw new Error(`Publication evidence already exists: ${output}`);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const [root, parent] = await Promise.all([realpath(repositoryRoot), realpath(dirname(output))]);
  const location = relative(root, resolve(parent, basename(output)));
  if (location === "" || !location.startsWith("..") && !isAbsolute(location)) {
    throw new Error("Publication evidence must be stored outside the source repository.");
  }
}

function resolveScanner(binary) {
  if (binary.includes("/")) return resolve(binary);
  return execFileSync("which", [binary], { encoding: "utf8" }).trim();
}

function readReport(contents) {
  const value = JSON.parse(contents);
  if (!Array.isArray(value)) throw new Error("Gitleaks report must be an array.");
  return value;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await assertNewExternalOutput(options.output);
  if (checkedGit(["rev-parse", "--is-shallow-repository"]) !== "false") {
    throw new Error("Publication audit requires complete Git history, not a shallow checkout.");
  }
  if (checkedGit(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    throw new Error("Publication audit requires a clean tracked and untracked worktree.");
  }
  if (existsSync(resolve(repositoryRoot, ".gitleaks.toml"))) {
    throw new Error("Repository-local Gitleaks rule overrides require a reviewed audit change.");
  }

  const scanner = resolveScanner(options.gitleaksBinary);
  const versionResult = runScanner(scanner, ["version"]);
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== GITLEAKS_VERSION) {
    throw new Error(`Publication audit requires Gitleaks ${GITLEAKS_VERSION}.`);
  }
  const scannerSha256 = sha256(await readFile(scanner));
  const registryContents = await readFile(registryPath, "utf8");
  const registry = parseRegistry(JSON.parse(registryContents));
  const ignoredFingerprints = (await readFile(ignorePath, "utf8"))
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const temporary = await mkdtemp(resolve(tmpdir(), "guild-os-publication-audit-"));
  try {
    const mirror = resolve(temporary, "repository.git");
    const emptyIgnore = resolve(temporary, "empty.gitleaksignore");
    const unfilteredReport = resolve(temporary, "unfiltered.json");
    const filteredReport = resolve(temporary, "filtered.json");
    await writeFile(emptyIgnore, "", { mode: 0o600 });
    const common = [
      "git",
      "--no-banner",
      "--no-color",
      "--redact=100",
      "--max-archive-depth=2",
      "--max-decode-depth=5",
      "--report-format=json",
      "--log-level=error",
      "--log-opts=--all",
    ];
    execFileSync("git", ["clone", "--mirror", "--no-local", repositoryRoot, mirror], {
      cwd: temporary,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    // A worktree target loads its own .gitleaksignore even when the scanner starts elsewhere.
    // The complete bare mirror has the same refs and objects but no worktree-level allowlist.
    const unfiltered = runScanner(scanner, [
      ...common,
      `--gitleaks-ignore-path=${emptyIgnore}`,
      `--report-path=${unfilteredReport}`,
      mirror,
    ], temporary);
    if (![0, 1].includes(unfiltered.status)) {
      throw new Error(`Unfiltered Gitleaks history scan failed with exit ${unfiltered.status}.`);
    }
    const findings = readReport(await readFile(unfilteredReport, "utf8"));
    const reviewed = verifyReviewedFindings({
      findings,
      registry,
      ignoredFingerprints,
      historicLine,
    });
    const filtered = runScanner(scanner, [
      ...common,
      `--gitleaks-ignore-path=${ignorePath}`,
      `--report-path=${filteredReport}`,
      ".",
    ]);
    if (filtered.status !== 0) {
      throw new Error("Gitleaks found an unreviewed publication-history secret candidate.");
    }
    const effectiveFindings = readReport(await readFile(filteredReport, "utf8"));
    if (effectiveFindings.length !== 0) {
      throw new Error("Filtered Gitleaks report must contain zero findings.");
    }

    const payload = {
      format: PUBLICATION_AUDIT_FORMAT,
      auditedAt: new Date().toISOString(),
      repository: "NishizukaKoichi/guild-os",
      commit: checkedGit(["rev-parse", "HEAD"]),
      fullHistory: {
        shallow: false,
        commitCount: Number(checkedGit(["rev-list", "--all", "--count"])),
        objectCount: checkedGit(["rev-list", "--objects", "--all"]).split(/\r?\n/).filter(Boolean).length,
      },
      scanner: {
        name: "gitleaks",
        version: GITLEAKS_VERSION,
        binarySha256: scannerSha256,
        redactionPercent: 100,
        archiveDepth: 2,
        decodeDepth: 5,
        allRefs: true,
      },
      reviewRegistrySha256: sha256(registryContents),
      reviewedSyntheticFindings: reviewed,
      unreviewedFindings: 0,
      effectiveFindings: 0,
      secretsIncludedInEvidence: false,
      status: "passed",
    };
    const evidence = {
      ...payload,
      evidenceSha256: sha256(JSON.stringify(stableJson(payload))),
    };
    const temporaryOutput = `${options.output}.${process.pid}.tmp`;
    await writeFile(temporaryOutput, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o400,
      flag: "wx",
    });
    await rename(temporaryOutput, options.output);
    await chmod(options.output, 0o400);
    console.log(JSON.stringify({
      ok: true,
      output: options.output,
      commit: evidence.commit,
      historyCommits: evidence.fullHistory.commitCount,
      reviewedSyntheticFindings: evidence.reviewedSyntheticFindings.length,
      unreviewedFindings: evidence.unreviewedFindings,
      evidenceSha256: evidence.evidenceSha256,
    }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Open Core publication audit failed. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
