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
  assert.match(matrix, /62 Distribution tests/);
  assert.match(snapshot, /passed typecheck, 62 tests/);
  assert.match(matrix, /This matrix deliberately does not name a mutable Distribution HEAD/);
  assert.match(matrix, /a repository document is not current-candidate CI evidence/);
  assert.match(snapshot, /Exact-SHA Core CI evidence independently repeated/);
  assert.match(matrix, /All five Workers run the exact Git-resolved Core candidate recorded in external release evidence/);
  assert.match(matrix, /existing production PostgreSQL service remains in place without replacement/);
  assert.match(matrix, /PostgreSQL 18[\s\S]*all 51 migrations[\s\S]*all 96 protected tables/);
  assert.match(matrix, /Human browser completed grounded Ask with citation[\s\S]*matching History/);
  assert.match(snapshot, /Exact-SHA Core CI evidence passed the complete[\s\S]*hosted gate/);
  assert.match(snapshot, /English, Japanese, and Simplified Chinese switched[\s\S]*zero console errors/);
  assert.match(snapshot, /Service Auth policy and token were\s+removed[\s\S]*stale credential received the Access redirect/);
  assert.match(matrix, /temporary smoke policy and token were removed[\s\S]*Human policy remained/);
  assert.match(snapshot, /Distribution's single local\/hosted release gate passed typecheck, 62 tests/);
  assert.match(snapshot, /does not identify a[\s\S]*mutable current Distribution HEAD/);
  assert.doesNotMatch(matrix, /The current Distribution candidate pins|Current `[0-9a-f]{7,40}` pins Core/);
  assert.doesNotMatch(matrix, /still starts zero hosted steps|exact hosted CI remains externally blocked/);
  assert.doesNotMatch(snapshot, /Resolve the GitHub account billing\/spending gate/);
  assert.doesNotMatch(matrix, /Distribution `9e9c21e6`/);
  assert.doesNotMatch(snapshot, /Distribution `9e9c21e6490/);
  assert.doesNotMatch(matrix, /Core run `33253591545`/);
  assert.doesNotMatch(snapshot, /GitHub Actions run `33253591545`/);
  assert.doesNotMatch(matrix, /Core run `33255163020`/);
  assert.doesNotMatch(snapshot, /GitHub Actions run `33255163020`/);
  assert.doesNotMatch(matrix, /6204f1f0ed47df58a35cdc52b6fd618d0674bc39|33307079363/);
  assert.doesNotMatch(snapshot, /6204f1f0ed47df58a35cdc52b6fd618d0674bc39|33307079363/);
  assert.match(specification, /complete local Git source archives/);
  assert.match(acceptance, /No seller source fetch is allowed/);
  assert.match(acceptance, /Open Core access/);
  assert.match(acceptance, /complete anonymous clone\/install\/build/);
  assert.match(acceptance, /acquired-package CLI smoke/);
  assert.match(matrix, /Apache Core as `PUBLIC` and the commercial Distribution as `PRIVATE`/);
  assert.match(matrix, /live credential-free public Core capture also completed/);
  assert.doesNotMatch(readme, /GitHub repository is currently private/);
  assert.match(matrix, /source-complete signed release v2/);
  assert.match(matrix, /current Core branch SHA must always come from Git and exact external CI evidence/);
  assert.match(matrix, /generated two-phase read-only verifier/);
  assert.match(snapshot, /legacy hand-authored v1 evidence is rejected/);
  assert.doesNotMatch(matrix, /\b(?:38|46|49|50|52|55) Distribution tests\b/);
  assert.doesNotMatch(snapshot, /\b(?:38|46|49|50|52|55) tests\b/);

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
