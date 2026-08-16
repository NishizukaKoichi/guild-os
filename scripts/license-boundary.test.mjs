import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifests = [
  "package.json",
  "packages/error-reporter/package.json",
  "packages/guild-domain/package.json",
  "packages/guild-gatekeeper/package.json",
  "packages/guild-postgres/package.json",
  "packages/webhook-receiver/package.json",
];

async function readRepositoryFile(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

test("the current core and its private packages declare Apache-2.0", async () => {
  for (const path of packageManifests) {
    const manifest = JSON.parse(await readRepositoryFile(path));
    assert.equal(manifest.private, true, `${path} must remain non-publishable by default`);
    assert.equal(manifest.license, "Apache-2.0", `${path} must declare the repository license`);
  }
});

test("the direct-foundation notice tracks the exact Cloudflare OS gitlink", async () => {
  const gitlinkRow = execFileSync("git", ["ls-files", "--stage", "cloudflare-os"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const gitlink = gitlinkRow.match(/^160000 ([a-f0-9]{40}) 0\tcloudflare-os$/)?.[1];
  assert.ok(gitlink, "cloudflare-os must remain a commit-pinned Git submodule");
  const submoduleHead = execFileSync("git", ["-C", "cloudflare-os", "rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  assert.equal(submoduleHead, gitlink, "the submodule worktree must match the recorded gitlink");

  const [rootLicense, submoduleLicense, notices] = await Promise.all([
    readRepositoryFile("LICENSE"),
    readRepositoryFile("cloudflare-os/LICENSE"),
    readRepositoryFile("THIRD_PARTY_NOTICES.md"),
  ]);

  assert.match(rootLicense, /Apache License\s+Version 2\.0/);
  assert.match(submoduleLicense, /Apache License\s+Version 2\.0/);
  assert.match(notices, new RegExp(gitlink));
  assert.match(notices, /cloudflare\/cloudflare-os-starter/);
  assert.match(notices, /cloudflare\/cloudflare-os/);
});
