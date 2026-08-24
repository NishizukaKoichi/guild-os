import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function document(path) {
  return readFile(resolve(root, path), "utf8");
}

test("product documents keep one authority and the implemented Distribution boundary", async () => {
  const [readme, architecture, licensing, adr, restoreAdr, publicationAdr, specification, acceptance,
    v1, matrix, snapshot] =
    await Promise.all([
    document("README.md"),
    document("docs/architecture.md"),
    document("docs/licensing-and-distribution.md"),
    document("docs/adr/0038-separate-commercial-distribution-from-apache-core.md"),
    document("docs/adr/0040-generate-and-bind-independent-restore-evidence.md"),
    document("docs/adr/0041-full-history-publication-secret-gate.md"),
    document("docs/product-specification.md"),
    document("docs/full-spec-acceptance.md"),
    document("docs/v1-completion.md"),
    document("docs/product-completion-matrix.md"),
    document("docs/context-snapshot.md"),
  ]);

  assert.match(specification, /^Status: Authoritative$/m);
  assert.match(acceptance, /authoritative requirements are in \[the product specification\]/i);
  assert.match(v1, /not a completion authority/i);
  assert.match(readme, /separate Guild OS Owned Distribution/);
  assert.match(architecture, /`guild-os-distribution` repository/);
  assert.match(licensing, /Separate commercial product repository/);
  assert.match(adr, /Implemented: 2026-08-24/);
  assert.match(restoreAdr, /ownership-attestation file, live Installer-evidence file, deployment lock/);
  assert.match(publicationAdr, /repository owner explicitly authorized public Apache-2.0 visibility/);
  assert.match(publicationAdr, /anonymous recursive HTTPS clone independently passed/);
  assert.match(matrix, /50 Distribution tests/);
  assert.match(snapshot, /passed typecheck, 50 tests/);
  assert.match(specification, /complete local Git source archives/);
  assert.match(acceptance, /No seller source fetch is allowed/);
  assert.match(acceptance, /Open Core access/);
  assert.match(acceptance, /complete anonymous clone\/install\/build/);
  assert.match(acceptance, /acquired-package CLI smoke/);
  assert.match(matrix, /Apache Core as `PUBLIC` and the commercial Distribution as `PRIVATE`/);
  assert.match(matrix, /live credential-free public Core capture also completed/);
  assert.doesNotMatch(readme, /GitHub repository is currently private/);
  assert.match(matrix, /source-complete signed release v2/);
  assert.match(matrix, /current release SHA must always come from Git/);
  assert.match(matrix, /generated two-phase read-only verifier/);
  assert.match(snapshot, /legacy hand-authored v1 evidence is rejected/);
  assert.doesNotMatch(matrix, /\b(?:38|46|49) Distribution tests\b/);
  assert.doesNotMatch(snapshot, /\b(?:38|46|49) tests\b/);

  for (const [name, contents] of [
    ["README", readme],
    ["architecture", architecture],
    ["licensing", licensing],
    ["ADR 0038", adr],
  ]) {
    assert.doesNotMatch(contents, /distribution repository,? not yet created/i, `${name} is stale`);
    assert.doesNotMatch(contents, /future commercial (?:packaging|distribution|installation)/i,
      `${name} incorrectly describes the implemented Distribution as future work`);
  }
});
