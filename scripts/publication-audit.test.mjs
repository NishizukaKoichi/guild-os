import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  FALSE_POSITIVE_REGISTRY_FORMAT,
  GITLEAKS_VERSION,
  verifyReviewedFindings,
} from "./publication-audit.mjs";

const root = resolve(import.meta.dirname, "..");

async function fixture() {
  const registryDocument = JSON.parse(await readFile(
    resolve(root, "scripts/publication-false-positives.json"),
    "utf8",
  ));
  assert.equal(registryDocument.format, FALSE_POSITIVE_REGISTRY_FORMAT);
  assert.equal(registryDocument.scannerVersion, GITLEAKS_VERSION);
  const ignoredFingerprints = (await readFile(resolve(root, ".gitleaksignore"), "utf8"))
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const findings = registryDocument.entries.map((entry) => ({
    Fingerprint: entry.fingerprint,
    Commit: entry.commit,
    File: entry.file,
    StartLine: entry.line,
    RuleID: entry.ruleId,
    Secret: "REDACTED",
  }));
  return { registryDocument, ignoredFingerprints, findings };
}

function historicLine(commit, file, line) {
  return execFileSync("git", ["show", `${commit}:${file}`], {
    cwd: root,
    encoding: "utf8",
  }).trim().split(/\r?\n/)[line - 1];
}

test("review registry and ignore file bind the exact redacted synthetic findings", async () => {
  const { registryDocument, ignoredFingerprints, findings } = await fixture();
  const reviewed = verifyReviewedFindings({
    findings,
    registry: registryDocument.entries,
    ignoredFingerprints,
    historicLine,
  });
  assert.equal(reviewed.length, 4);
});

test("an unreviewed history finding fails closed", async () => {
  const { registryDocument, ignoredFingerprints, findings } = await fixture();
  const additional = {
    ...findings[0],
    Fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:new-file.ts:generic-api-key:1",
    Commit: "a".repeat(40),
    File: "new-file.ts",
    StartLine: 1,
  };
  assert.throws(() => verifyReviewedFindings({
    findings: [...findings, additional],
    registry: registryDocument.entries,
    ignoredFingerprints,
    historicLine,
  }), /unreviewed/);
});

test("a broad or missing ignore entry fails closed", async () => {
  const { registryDocument, ignoredFingerprints, findings } = await fixture();
  assert.throws(() => verifyReviewedFindings({
    findings,
    registry: registryDocument.entries,
    ignoredFingerprints: ignoredFingerprints.slice(1),
    historicLine,
  }), /exactly match/);
});

test("unredacted scanner output is never accepted", async () => {
  const { registryDocument, ignoredFingerprints, findings } = await fixture();
  findings[0].Secret = "not-redacted";
  assert.throws(() => verifyReviewedFindings({
    findings,
    registry: registryDocument.entries,
    ignoredFingerprints,
    historicLine,
  }), /metadata changed/);
});
