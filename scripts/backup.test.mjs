import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertQuiescentBoundary,
  listCloudflarePages,
  listKvKeys,
  parseBackupArguments,
  prepareKvRestoreBatches,
  verifyBackupDirectory,
} from "./backup.mjs";
import { sha256File, sha256Object } from "./ops-core.mjs";

test("backup arguments require an external absolute encrypted destination", () => {
  assert.deepEqual(parseBackupArguments([
    "create",
    "--output", "/tmp/guild-backup",
    "--r2-remote", "r2",
    "--confirm-encrypted-destination",
  ]), {
    command: "create",
    path: "/tmp/guild-backup",
    r2Remote: "r2",
    artifactsRepository: null,
  });
  assert.deepEqual(parseBackupArguments([
    "verify", "--", "--input", "/tmp/guild-backup",
  ]), {
    command: "verify",
    path: "/tmp/guild-backup",
    r2Remote: null,
    artifactsRepository: null,
  });
  assert.deepEqual(parseBackupArguments([
    "prepare-restore",
    "--input", "/tmp/guild-backup",
    "--output", "/tmp/guild-restore",
  ]), {
    command: "prepare-restore",
    path: "/tmp/guild-backup",
    r2Remote: null,
    artifactsRepository: null,
    restoreOutput: "/tmp/guild-restore",
  });
  assert.throws(() => parseBackupArguments([
    "create", "--output", "/tmp/guild-backup", "--r2-remote", "r2",
  ]), /encrypted/i);
  assert.throws(() => parseBackupArguments([
    "create", "--output", "relative", "--r2-remote", "r2",
    "--confirm-encrypted-destination",
  ]), /absolute/i);
});

test("Cloudflare authorization failures are not retried", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return Response.json({ success: false, errors: [{ code: 10_000 }] }, { status: 403 });
  };
  await assert.rejects(
    listKvKeys("account", "namespace", "invalid-token", fetcher),
    /HTTP 403 \(10000\)/,
  );
  assert.equal(calls, 1);
});

test("Cloudflare configuration export follows every numbered page", async () => {
  const pages = [];
  const values = await listCloudflarePages(
    "/accounts/account/access/apps",
    "token",
    { aud: "audience" },
    async (url) => {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get("page"));
      pages.push(page);
      assert.equal(parsed.searchParams.get("aud"), "audience");
      return Response.json({
        success: true,
        result: [{ id: `app-${page}` }],
        result_info: { page, total_pages: 2 },
      });
    },
  );
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(values, [{ id: "app-1" }, { id: "app-2" }]);
});

test("restore preparation emits bounded Wrangler KV bulk files", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-restore-batch-test-"));
  const backup = join(root, "backup");
  const output = join(root, "output");
  try {
    await mkdir(join(backup, "kv"), { recursive: true });
    await mkdir(output);
    const rows = [
      { key: "one", value: "MQ==", base64: true },
      { key: "two", value: "Mg==", base64: true, metadata: { type: "text" } },
      { key: "three", value: "Mw==", base64: true, expiration: 2_000_000_000 },
    ];
    await writeFile(
      join(backup, "kv/context.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );

    const result = await prepareKvRestoreBatches(backup, output, {
      name: "context",
      path: "kv/context.jsonl",
      namespaceId: "source-namespace",
      keyCount: rows.length,
    }, { maxEntries: 2, maxBytes: 4096 });

    assert.equal(result.entries, 3);
    assert.equal(result.batches.length, 2);
    assert.deepEqual(
      JSON.parse(await readFile(join(output, result.batches[0].path), "utf8")),
      rows.slice(0, 2),
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(output, result.batches[1].path), "utf8")),
      rows.slice(2),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup boundary rejects in-flight work and schema drift", () => {
  const boundary = {
    initialized: true,
    chronicleSequence: "10",
    activeAgentRuns: 0,
    activeOutboxItems: 0,
    pendingFileUploads: 0,
    latestMigration: "0025_context_bound_conversations.sql",
  };
  assert.doesNotThrow(() => assertQuiescentBoundary(
    boundary,
    "0025_context_bound_conversations.sql",
  ));
  assert.throws(() => assertQuiescentBoundary({
    ...boundary,
    activeAgentRuns: 1,
  }, boundary.latestMigration), /zero active Agent Runs/i);
  assert.throws(() => assertQuiescentBoundary(
    boundary,
    "0026_future.sql",
  ), /migration mismatch/i);
});

test("KV inventory follows cursors and preserves metadata without secrets", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json({
      success: true,
      result: cursor ? [{ name: "second", expiration: 2 }] : [{
        name: "first",
        metadata: { contentType: "image/png" },
      }],
      result_info: cursor ? {} : { cursor: "next-page" },
    });
  };

  const keys = await listKvKeys("account", "namespace", "secret-token", fetcher);

  assert.deepEqual(keys, [
    { name: "first", metadata: { contentType: "image/png" } },
    { name: "second", expiration: 2 },
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].authorization, "Bearer secret-token");
  assert.doesNotMatch(JSON.stringify(keys), /secret-token/);
});

test("backup verification detects payload and file tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-backup-test-"));
  try {
    await mkdir(join(root, "kv"));
    const kvPath = join(root, "kv/context.jsonl");
    await writeFile(kvPath, `${JSON.stringify({
      key: "binary",
      value: Buffer.from([0, 1, 2, 255]).toString("base64"),
      base64: true,
      metadata: { kind: "test" },
    })}\n`);
    const details = await stat(kvPath);
    const core = {
      format: "guild-os-backup/v1",
      complete: true,
      guildId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
      stores: {
        kv: [{
          name: "context",
          path: "kv/context.jsonl",
          keyCount: 1,
          valueBytes: 4,
        }],
        r2: [],
      },
      files: [{
        path: "kv/context.jsonl",
        bytes: details.size,
        sha256: await sha256File(kvPath),
      }],
    };
    const manifest = { ...core, manifestPayloadSha256: sha256Object(core) };
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(
      join(root, "manifest.sha256"),
      `${await sha256File(manifestPath)}  manifest.json\n`,
    );

    await assert.doesNotReject(() => verifyBackupDirectory(root));
    await writeFile(kvPath, "tampered\n");
    await assert.rejects(() => verifyBackupDirectory(root), /verification failed/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
