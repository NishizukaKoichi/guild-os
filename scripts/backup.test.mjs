import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertQuiescentBoundary,
  DATABASE_BOUNDARY_SQL,
  exportR2BucketWithCloudflare,
  importAccessSnapshot,
  listCloudflarePages,
  listKvKeys,
  listR2Objects,
  parseBackupArguments,
  postgresConnectionEnvironment,
  pgDumpArguments,
  pgDumpEnvironment,
  prepareKvRestoreBatches,
  safeR2ObjectPath,
  verifyBackupDirectory,
  verifyPostgresDump,
} from "./backup.mjs";
import { sha256File, sha256Object } from "./ops-core.mjs";

test("backup quiescence checks the canonical file upload table", async () => {
  const pendingUploadQuery = DATABASE_BOUNDARY_SQL.match(
    /\(SELECT count\(\*\)::integer FROM ([a-z_]+)\s+WHERE guild_id = \$1 AND status = 'pending'\)/,
  );

  assert.equal(pendingUploadQuery?.[1], "files");
  assert.doesNotMatch(DATABASE_BOUNDARY_SQL, /FROM knowledge_files\b/);
});

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
    accessSnapshot: null,
    artifactsRepository: null,
  });
  assert.deepEqual(parseBackupArguments([
    "verify", "--", "--input", "/tmp/guild-backup",
  ]), {
    command: "verify",
    path: "/tmp/guild-backup",
    r2Remote: null,
    accessSnapshot: null,
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
    accessSnapshot: null,
    artifactsRepository: null,
    restoreOutput: "/tmp/guild-restore",
  });
  assert.deepEqual(parseBackupArguments([
    "create", "--output", "/tmp/guild-backup",
    "--access-snapshot", "/tmp/access.json",
    "--confirm-encrypted-destination",
  ]), {
    command: "create",
    path: "/tmp/guild-backup",
    r2Remote: null,
    accessSnapshot: "/tmp/access.json",
    artifactsRepository: null,
  });
  assert.throws(() => parseBackupArguments([
    "create", "--output", "/tmp/guild-backup", "--r2-remote", "r2",
  ]), /encrypted/i);
  assert.throws(() => parseBackupArguments([
    "create", "--output", "relative", "--r2-remote", "r2",
    "--confirm-encrypted-destination",
  ]), /absolute/i);
});

test("R2 inventory follows cursors and fails closed on unsafe local paths", async () => {
  const requests = [];
  const objects = await listR2Objects("account", "bucket", "secret-token", async (url, options) => {
    requests.push({ url, authorization: options.headers.authorization });
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json({
      success: true,
      errors: [],
      messages: [],
      result: cursor
        ? [{ key: "folder/two.txt", size: 2, etag: "etag-two" }]
        : [{ key: "one.txt", size: 1, etag: "etag-one" }],
      result_info: cursor
        ? { is_truncated: false, per_page: 1000 }
        : { is_truncated: true, cursor: "next", per_page: 1000 },
    });
  });

  assert.deepEqual(objects.map((object) => object.key), ["one.txt", "folder/two.txt"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].authorization, "Bearer secret-token");
  assert.doesNotMatch(JSON.stringify(objects), /secret-token/);
  assert.equal(safeR2ObjectPath("folder/file.txt"), "folder/file.txt");
  assert.throws(() => safeR2ObjectPath("../escape"), /safely/i);
  assert.throws(() => safeR2ObjectPath("folder//file"), /safely/i);
  assert.throws(() => safeR2ObjectPath("folder/file. "), /safely/i);
  const seen = new Set();
  safeR2ObjectPath("File.txt", seen);
  assert.throws(() => safeR2ObjectPath("file.txt", seen), /collide/i);
});

test("Cloudflare REST R2 export preserves bytes, metadata, and a stable inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-r2-export-test-"));
  const directory = join(root, "objects");
  const indexPath = join(root, "objects.index.jsonl");
  let lists = 0;
  try {
    const result = await exportR2BucketWithCloudflare({
      accountId: "account",
      bucket: "bucket",
      token: "secret-token",
      directory,
      indexPath,
      fetcher: async (url, options) => {
        if (url.endsWith("/objects?per_page=1000")) {
          lists += 1;
          return Response.json({
            success: true,
            errors: [],
            messages: [],
            result: [{
              key: "folder/report.txt",
              size: 5,
              etag: "5d41402abc4b2a76b9719d911017c592",
              last_modified: "2026-08-12T00:00:00Z",
              storage_class: "Standard",
              http_metadata: { contentType: "text/plain" },
              custom_metadata: { source: "test" },
            }],
            result_info: { is_truncated: false, per_page: 1000 },
          });
        }
        assert.match(url, /\/objects\/folder\/report\.txt$/);
        assert.equal(options.headers.authorization, "Bearer secret-token");
        return new Response("hello", {
          status: 200,
          headers: { etag: '"5d41402abc4b2a76b9719d911017c592"' },
        });
      },
    });

    assert.equal(lists, 2);
    assert.deepEqual(result, {
      objectCount: 1,
      bytes: 5,
      inventorySha256: result.inventorySha256,
      exportMethod: "cloudflare-rest",
    });
    assert.equal(await readFile(join(directory, "folder/report.txt"), "utf8"), "hello");
    const row = JSON.parse((await readFile(indexPath, "utf8")).trim());
    assert.equal(row.key, "folder/report.txt");
    assert.equal(row.httpMetadata.contentType, "text/plain");
    assert.equal(row.customMetadata.source, "test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewed Access snapshot must match the configured audience and exclude secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-access-snapshot-test-"));
  const source = join(root, "source.json");
  const output = join(root, "output.json");
  const snapshot = {
    application: { id: "app", aud: "audience", domain: "guild.example.com" },
    policies: [{ id: "policy", name: "Allow owners", include: [{ email: { email: "owner@example.com" } }] }],
  };
  try {
    await writeFile(source, JSON.stringify(snapshot));
    assert.deepEqual(await importAccessSnapshot({
      access: { audience: "audience" },
    }, source, output), {
      applicationId: "app",
      policyCount: 1,
      source: "operator-reviewed-snapshot",
    });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), snapshot);

    await writeFile(source, JSON.stringify({ ...snapshot, clientSecret: "do-not-copy" }));
    await assert.rejects(
      importAccessSnapshot({ access: { audience: "audience" } }, source, output),
      /secret-like/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    guildTableRows: { guilds: "1", identities: "4" },
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

test("PostgreSQL dump is explicitly Guild-scoped under forced RLS", () => {
  const output = "/encrypted/guild-os.sql";
  assert.deepEqual(pgDumpArguments(output), [
    "--format=plain",
    "--no-owner",
    "--no-acl",
    "--enable-row-security",
    "--column-inserts",
    "--rows-per-insert=100",
    "--file",
    output,
  ]);
  const inherited = process.env.PGOPTIONS;
  process.env.PGOPTIONS = "-c row_security=off";
  try {
    const environment = pgDumpEnvironment(
      "postgresql://runtime@example.invalid/guild_os?sslmode=verify-full",
      "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
    );
    assert.equal(environment.PGOPTIONS,
      "-c app.guild_id=018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a");
    assert.equal(environment.PGHOST, "example.invalid");
    assert.equal(environment.PGUSER, "runtime");
    assert.equal(environment.PGDATABASE, "guild_os");
    assert.equal(environment.PGSSLMODE, "verify-full");
    assert.equal(environment.PGPASSWORD, undefined);
    assert.throws(() => pgDumpEnvironment("postgresql://example", "not-a-uuid"), /Guild UUID/i);
    assert.throws(() => pgDumpEnvironment(
      "postgresql://runtime@example.invalid/guild_os?sslmode=require",
      "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
    ), /verify-full/i);
  } finally {
    if (inherited === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = inherited;
  }
});

test("PostgreSQL URL becomes bounded libpq variables without exposing it as one value", () => {
  assert.deepEqual(postgresConnectionEnvironment(
    "postgresql://user:p%40ss@[2001:db8::1]:5433/guild%20os?sslmode=verify-full&connect_timeout=10",
  ), {
    PGHOST: "2001:db8::1",
    PGPORT: "5433",
    PGUSER: "user",
    PGDATABASE: "guild os",
    PGPASSWORD: "p@ss",
    PGSSLMODE: "verify-full",
    PGCONNECT_TIMEOUT: "10",
  });
  assert.throws(() => postgresConnectionEnvironment(
    "postgresql://user:pass@example.invalid/db?options=-c%20row_security%3Doff",
  ), /unsupported/i);
  assert.throws(() => postgresConnectionEnvironment(
    "postgresql://user:pass@example.invalid/db?sslmode=require&sslmode=verify-full",
  ), /duplicate/i);
});

test("PostgreSQL dump verification requires RLS-safe INSERT statements", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-pg-dump-test-"));
  const path = join(root, "guild-os.sql");
  try {
    await writeFile(path, [
      "-- PostgreSQL database dump",
      "SET row_security = on;",
      "INSERT INTO public.guilds (id) VALUES ('018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a');",
      "",
    ].join("\n"));
    const result = await verifyPostgresDump(path);
    assert.equal(result.insertStatements, 1);
    assert.equal(result.rowSecurity, "enabled");

    await writeFile(path, "SET row_security = on;\nCOPY public.guilds (id) FROM stdin;\n");
    await assert.rejects(() => verifyPostgresDump(path), /COPY/i);
    await writeFile(path, "SET row_security = off;\nINSERT INTO public.guilds (id) VALUES ('x');\n");
    await assert.rejects(() => verifyPostgresDump(path), /disables row security/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    await mkdir(join(root, "postgres"));
    const kvPath = join(root, "kv/context.jsonl");
    const postgresPath = join(root, "postgres/guild-os.sql");
    await writeFile(kvPath, `${JSON.stringify({
      key: "binary",
      value: Buffer.from([0, 1, 2, 255]).toString("base64"),
      base64: true,
      metadata: { kind: "test" },
    })}\n`);
    await writeFile(postgresPath, [
      "SET row_security = on;",
      "INSERT INTO public.guilds (id) VALUES ('018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a');",
      "",
    ].join("\n"));
    const details = await stat(kvPath);
    const postgresDetails = await stat(postgresPath);
    const core = {
      format: "guild-os-backup/v2",
      complete: true,
      guildId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a",
      databaseBoundary: {
        chronicleSequence: "4",
        guildTableRows: { guilds: "1" },
      },
      stores: {
        postgres: {
          path: "postgres/guild-os.sql",
          scope: "guild-forced-rls",
          format: "plain-column-inserts",
          bytes: postgresDetails.size,
          insertStatements: 1,
          rowSecurity: "enabled",
        },
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
      }, {
        path: "postgres/guild-os.sql",
        bytes: postgresDetails.size,
        sha256: await sha256File(postgresPath),
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
