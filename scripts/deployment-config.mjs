import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const deploymentTemplatePath = join(repositoryRoot, "deployment.jsonc");
export const deploymentLocalPath = join(repositoryRoot, "deployment.local.jsonc");

export function resolveDeploymentConfigPath({
  configuredPath = process.env.GUILD_OS_DEPLOYMENT_CONFIG,
  localPath = deploymentLocalPath,
  templatePath = deploymentTemplatePath,
  exists = existsSync,
} = {}) {
  const explicit = configuredPath?.trim();
  if (explicit) {
    if (!isAbsolute(explicit)) {
      throw new Error("GUILD_OS_DEPLOYMENT_CONFIG must be an absolute path.");
    }
    const path = resolve(explicit);
    if (!exists(path)) throw new Error("GUILD_OS_DEPLOYMENT_CONFIG does not exist.");
    return path;
  }
  return exists(localPath) ? resolve(localPath) : resolve(templatePath);
}

export function assertPrivateDeploymentConfig(path, templatePath = deploymentTemplatePath, fileMode) {
  if (resolve(path) === resolve(templatePath)) {
    throw new Error(
      "A live deploy requires deployment.local.jsonc or GUILD_OS_DEPLOYMENT_CONFIG; " +
      "do not commit purchaser configuration to deployment.jsonc.",
    );
  }
  const mode = fileMode ?? statSync(path).mode;
  if (process.platform !== "win32" && (mode & 0o077) !== 0) {
    throw new Error("The purchaser deployment configuration must have mode 0600.");
  }
}

export function deploymentConfigEvidenceLabel(path, {
  localPath = deploymentLocalPath,
  templatePath = deploymentTemplatePath,
} = {}) {
  const resolved = resolve(path);
  if (resolved === resolve(templatePath)) return "tracked-template";
  if (resolved === resolve(localPath)) return "purchaser-local";
  return "purchaser-external";
}
