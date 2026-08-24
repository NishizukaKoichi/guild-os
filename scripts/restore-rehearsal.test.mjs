import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseRestoreVerificationArguments,
  RESTORE_PRE_RECOVERY_FORMAT,
  RESTORE_VERIFICATION_FORMAT,
  verifyRestorePostRecovery,
  verifyRestorePreRecovery,
} from "./restore-rehearsal.mjs";
import { sha256Object, sha256Text } from "./ops-core.mjs";

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";
const coreCommit = "1".repeat(40);
const coreTree = "2".repeat(40);
const cloudflareOsCommit = "3".repeat(40);
const databaseUrl = "postgresql://restore@example.invalid/guild?sslmode=verify-full";

function config() {
  return {
    accountId: "a".repeat(32),
    guild: { id: guildId },
    context: { kvNamespaceId: "context-namespace" },
    resources: {
      blueprintsKvNamespaceId: "blueprints-namespace",
      avatarsKvNamespaceId: "avatars-namespace",
      knowledgeFilesBucket: "knowledge-bucket",
      blueprintContentBucket: "blueprints-bucket",
    },
    workers: {
      workshop: { name: "test-workshop" },
      context: { name: "test-context" },
      guildGatekeeper: { name: "test-gatekeeper" },
      webhookReceiver: { name: "test-webhook" },
      errorReporter: { name: "test-errors" },
    },
    errorReporting: { enabled: true },
    referenceWebhook: { enabled: true },
  };
}

function source() {
  return {
    commit: coreCommit,
    tree: coreTree,
    submodules: [{ path: "cloudflare-os", commit: cloudflareOsCommit }],
  };
}

function targetEvidence() {
  return {
    accountId: "a".repeat(32),
    deploymentConfig: {
      label: "fixture",
      fileSha256: "4".repeat(64),
      resolvedSha256: "5".repeat(64),
    },
    deploymentLockSha256: "6".repeat(64),
    database: {
      hostSha256: "7".repeat(64),
      databaseSha256: "8".repeat(64),
      userSha256: "9".repeat(64),
    },
    kv: {
      context: "context-namespace",
      blueprints: "blueprints-namespace",
      avatars: "avatars-namespace",
    },
    r2: {
      knowledge: "knowledge-bucket",
      blueprints: "blueprints-bucket",
    },
  };
}

async function fixture(root) {
  await mkdir(join(root, "kv"), { recursive: true });
  await mkdir(join(root, "r2"), { recursive: true });
  const kvValue = Buffer.from("restored-value");
  await writeFile(join(root, "kv/context.jsonl"), `${JSON.stringify({
    key: "example",
    value: kvValue.toString("base64"),
    base64: true,
    metadata: { kind: "fixture" },
  })}\n`);
  const r2Value = Buffer.from("restored-object");
  await writeFile(join(root, "r2/knowledge.index.jsonl"), `${JSON.stringify({
    path: "manual/example.txt",
    key: "manual/example.txt",
    bytes: r2Value.byteLength,
    sha256: sha256Text(r2Value),
    httpMetadata: { contentType: "text/plain" },
  })}\n`);
  const manifest = {
    format: "guild-os-backup/v2",
    complete: true,
    guildId,
    createdAt: "2026-08-24T00:00:00.000Z",
    manifestPayloadSha256: "a".repeat(64),
    source: { commit: "b".repeat(40) },
    databaseBoundary: {
      chronicleSequence: "100",
      guildTableRows: { guilds: "1", chronicle_events: "100" },
    },
    stores: {
      kv: [{
        name: "context",
        path: "kv/context.jsonl",
        keyCount: 1,
        valueBytes: kvValue.byteLength,
      }],
      r2: [{
        name: "knowledge",
        index: "r2/knowledge.index.jsonl",
        objectCount: 1,
        bytes: r2Value.byteLength,
      }],
    },
  };
  const planCore = {
    format: "guild-os-restore-plan/v2",
    createdAt: "2026-08-24T00:01:00.000Z",
    sourceBackup: {
      path: root,
      guildId,
      manifestPayloadSha256: manifest.manifestPayloadSha256,
    },
    safety: {
      requiresEmptyTarget: true,
      requiresExplicitTargetResourceIds: true,
      mutatesCloudResources: false,
    },
    stores: {
      postgres: {
        expectedChronicleSequence: "100",
        expectedGuildTableRows: manifest.databaseBoundary.guildTableRows,
      },
    },
  };
  const plan = { ...planCore, planPayloadSha256: sha256Object(planCore) };
  return { manifest, plan, kvValue, r2Value };
}

function smoke(checkedAt) {
  return {
    checkedAt,
    evidenceFileSha256: "c".repeat(64),
    evidencePayloadSha256: "d".repeat(64),
    accessProtection: "passed",
    serviceAuthentication: "passed",
    webhookHealth: "passed",
    unsignedWebhookRejected: true,
    workerInventorySha256: "e".repeat(64),
  };
}

test("restore verification arguments require an explicit phase and absolute paths", () => {
  assert.deepEqual(parseRestoreVerificationArguments([
    "pre",
    "--backup", "/backup",
    "--restore-plan", "/plan",
    "--smoke", "/smoke.json",
    "--output", "/pre.json",
  ]), {
    command: "pre",
    backup: "/backup",
    "restore-plan": "/plan",
    smoke: "/smoke.json",
    output: "/pre.json",
  });
  assert.throws(() => parseRestoreVerificationArguments([
    "post", "--pre", "relative.json", "--smoke", "/smoke.json", "--output", "/post.json",
  ]), /absolute path/);
  assert.throws(() => parseRestoreVerificationArguments(["verify"]), /pre.*post/);
});

test("pre-recovery verification compares live database, KV, R2, and authenticated smoke", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-restore-pre-test-"));
  try {
    const data = await fixture(root);
    const evidence = await verifyRestorePreRecovery({
      databaseUrl,
      cloudflareToken: "fixture-token",
      backupDirectory: root,
      restorePlanPath: join(root, "restore-plan.json"),
      smokeEvidencePath: join(root, "smoke.json"),
    }, {
      backupVerifier: async () => data.manifest,
      planReader: async () => ({
        plan: data.plan,
        path: join(root, "restore-plan.json"),
        fileSha256: "f".repeat(64),
      }),
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      databaseBoundaryReader: async () => ({
        chronicleSequence: "100",
        guildTableRows: { guilds: "1", chronicle_events: "100" },
      }),
      listKvKeys: async () => [{ name: "example", metadata: { kind: "fixture" } }],
      readKvValue: async () => data.kvValue,
      listR2Objects: async () => [{
        key: "manual/example.txt",
        size: data.r2Value.byteLength,
        etag: "fixture-etag",
        httpMetadata: { contentType: "text/plain" },
      }],
      readR2Object: async () => data.r2Value,
      smokeVerifier: async () => smoke("2026-08-24T00:10:00.000Z"),
      executionMode: "injected-runner",
      now: () => new Date("2026-08-24T00:11:00.000Z"),
    });
    assert.equal(evidence.format, RESTORE_PRE_RECOVERY_FORMAT);
    assert.equal(evidence.externalCloudQueried, false);
    assert.equal(evidence.verification.database.rowCountMismatches, 0);
    assert.equal(evidence.verification.kv.stores[0].entries, 1);
    assert.equal(evidence.verification.r2.stores[0].objects, 1);
    assert.equal(evidence.status, "passed");
    const { evidenceSha256, ...payload } = evidence;
    assert.equal(evidenceSha256, sha256Object(payload));

    await assert.rejects(() => verifyRestorePreRecovery({
      databaseUrl,
      cloudflareToken: "fixture-token",
      backupDirectory: root,
      restorePlanPath: join(root, "restore-plan.json"),
      smokeEvidencePath: join(root, "smoke.json"),
    }, {
      backupVerifier: async () => data.manifest,
      planReader: async () => ({ plan: data.plan, path: "fixture", fileSha256: "f".repeat(64) }),
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      databaseBoundaryReader: async () => ({
        chronicleSequence: "100",
        guildTableRows: { guilds: "2", chronicle_events: "100" },
      }),
      listKvKeys: async () => [],
      readKvValue: async () => data.kvValue,
      listR2Objects: async () => [],
      readR2Object: async () => data.r2Value,
      smokeVerifier: async () => smoke("2026-08-24T00:10:00.000Z"),
    }), /table counts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-recovery verification binds the same target and proves atomic Human Root recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-os-restore-post-test-"));
  try {
    const data = await fixture(root);
    const pre = await verifyRestorePreRecovery({
      databaseUrl,
      cloudflareToken: "fixture-token",
      backupDirectory: root,
      restorePlanPath: join(root, "restore-plan.json"),
      smokeEvidencePath: join(root, "smoke.json"),
    }, {
      backupVerifier: async () => data.manifest,
      planReader: async () => ({ plan: data.plan, path: "fixture", fileSha256: "f".repeat(64) }),
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      databaseBoundaryReader: async () => ({
        chronicleSequence: "100",
        guildTableRows: { guilds: "1", chronicle_events: "100" },
      }),
      listKvKeys: async () => [{ name: "example", metadata: { kind: "fixture" } }],
      readKvValue: async () => data.kvValue,
      listR2Objects: async () => [{
        key: "manual/example.txt",
        size: data.r2Value.byteLength,
        etag: "fixture-etag",
        httpMetadata: { contentType: "text/plain" },
      }],
      readR2Object: async () => data.r2Value,
      smokeVerifier: async () => smoke("2026-08-24T00:10:00.000Z"),
      now: () => new Date("2026-08-24T00:11:00.000Z"),
    });
    const prePath = join(root, "pre.json");
    await writeFile(prePath, `${JSON.stringify(pre, null, 2)}\n`);
    const recoveryRow = {
      recovery_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a11",
      code_set_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a12",
      code_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a13",
      completed_at: new Date("2026-08-24T00:15:00.000Z"),
      new_root_identity_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a14",
      generation: 1,
      consumed_at: new Date("2026-08-24T00:15:00.000Z"),
      consumed_by_identity_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a14",
      current_code_set_id: null,
      configuration_version: 2,
      root_owner_identity_id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a14",
      root_kind: "human",
      root_status: "active",
      root_membership_state: "active",
      codes_consumed: 1,
      break_glass_used_sequence: "101",
      break_glass_used_at: new Date("2026-08-24T00:15:00.000Z"),
      current_chronicle_sequence: "101",
    };
    const evidence = await verifyRestorePostRecovery({
      databaseUrl,
      preRecoveryEvidencePath: prePath,
      smokeEvidencePath: join(root, "post-smoke.json"),
    }, {
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      recoveryBoundaryReader: async () => ({
        row: recoveryRow,
        codeColumns: ["id", "guild_id", "code_set_id", "code_hash", "code_hint", "consumed_at"],
      }),
      smokeVerifier: async () => smoke("2026-08-24T00:20:00.000Z"),
      now: () => new Date("2026-08-24T00:21:00.000Z"),
    });
    assert.equal(evidence.format, RESTORE_VERIFICATION_FORMAT);
    assert.equal(evidence.verification.recovery.codeGenerationInvalidated, true);
    assert.equal(evidence.verification.recovery.newRootActorKind, "human");
    assert.equal(evidence.recoveryObjectives.rpo.valueSeconds, 0);
    assert.equal(evidence.recoveryObjectives.rto.valueSeconds, 1140);

    await assert.rejects(() => verifyRestorePostRecovery({
      databaseUrl,
      preRecoveryEvidencePath: prePath,
      smokeEvidencePath: join(root, "post-smoke.json"),
    }, {
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      recoveryBoundaryReader: async () => ({
        row: { ...recoveryRow, completed_at: new Date("2026-08-24T00:05:00.000Z") },
        codeColumns: ["code_hash"],
      }),
      smokeVerifier: async () => smoke("2026-08-24T00:20:00.000Z"),
    }), /does not bracket/);

    const tampered = JSON.parse(await readFile(prePath, "utf8"));
    tampered.target.accountId = "f".repeat(32);
    await writeFile(prePath, `${JSON.stringify(tampered)}\n`);
    await assert.rejects(() => verifyRestorePostRecovery({
      databaseUrl,
      preRecoveryEvidencePath: prePath,
      smokeEvidencePath: join(root, "post-smoke.json"),
    }, {
      config: config(),
      source: source(),
      targetEvidence: targetEvidence(),
      recoveryBoundaryReader: async () => ({ row: recoveryRow, codeColumns: ["code_hash"] }),
      smokeVerifier: async () => smoke("2026-08-24T00:20:00.000Z"),
    }), /Pre-recovery verification evidence is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
