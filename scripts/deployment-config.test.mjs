import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateDeploymentConfig,
  deploymentConfigEvidenceLabel,
  resolveDeploymentConfigPath,
} from "./deployment-config.mjs";

test("selects an explicit absolute purchaser configuration first", () => {
  const selected = resolveDeploymentConfigPath({
    configuredPath: "/private/guild/deployment.jsonc",
    localPath: "/repo/deployment.local.jsonc",
    templatePath: "/repo/deployment.jsonc",
    exists: (path) => path === "/private/guild/deployment.jsonc",
  });
  assert.equal(selected, "/private/guild/deployment.jsonc");
  assert.equal(deploymentConfigEvidenceLabel(selected, {
    localPath: "/repo/deployment.local.jsonc",
    templatePath: "/repo/deployment.jsonc",
  }), "purchaser-external");
});

test("uses the ignored local configuration before the tracked template", () => {
  const selected = resolveDeploymentConfigPath({
    configuredPath: "",
    localPath: "/repo/deployment.local.jsonc",
    templatePath: "/repo/deployment.jsonc",
    exists: (path) => path === "/repo/deployment.local.jsonc",
  });
  assert.equal(selected, "/repo/deployment.local.jsonc");
  assert.equal(deploymentConfigEvidenceLabel(selected, {
    localPath: "/repo/deployment.local.jsonc",
    templatePath: "/repo/deployment.jsonc",
  }), "purchaser-local");
});

test("falls back to the template only for setup and dry-run diagnostics", () => {
  const selected = resolveDeploymentConfigPath({
    configuredPath: undefined,
    localPath: "/repo/deployment.local.jsonc",
    templatePath: "/repo/deployment.jsonc",
    exists: () => false,
  });
  assert.equal(selected, "/repo/deployment.jsonc");
  assert.throws(
    () => assertPrivateDeploymentConfig(selected, "/repo/deployment.jsonc", 0o100600),
    /live deploy requires deployment\.local\.jsonc/i,
  );
});

test("requires owner-only permissions for purchaser configuration", () => {
  assert.doesNotThrow(() => assertPrivateDeploymentConfig(
    "/repo/deployment.local.jsonc",
    "/repo/deployment.jsonc",
    0o100600,
  ));
  assert.throws(() => assertPrivateDeploymentConfig(
    "/repo/deployment.local.jsonc",
    "/repo/deployment.jsonc",
    0o100644,
  ), /mode 0600/i);
});

test("rejects ambiguous or missing explicit configuration paths", () => {
  assert.throws(() => resolveDeploymentConfigPath({
    configuredPath: "private/deployment.jsonc",
    exists: () => true,
  }), /absolute path/i);
  assert.throws(() => resolveDeploymentConfigPath({
    configuredPath: "/missing/deployment.jsonc",
    exists: () => false,
  }), /does not exist/i);
});
