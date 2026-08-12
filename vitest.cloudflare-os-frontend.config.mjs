import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import upstreamConfig from "./cloudflare-os/packages/workshop-frontend/vite.config.ts";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(repositoryRoot, "cloudflare-os/packages/workshop-frontend");

export default defineConfig(async (environment) => {
  const upstream = typeof upstreamConfig === "function"
    ? await upstreamConfig(environment)
    : await upstreamConfig;

  return mergeConfig(upstream, {
    root: frontendRoot,
    server: {
      fs: {
        allow: [repositoryRoot],
      },
    },
    test: {
      setupFiles: [resolve(repositoryRoot, "scripts/cloudflare-os-frontend-test-setup.mjs")],
    },
  });
});
