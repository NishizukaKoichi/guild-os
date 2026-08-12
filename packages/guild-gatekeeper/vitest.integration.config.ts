import { fileURLToPath } from "node:url";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [capnwebValidate()],
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL(
        "./__tests__/cloudflare-workers-node.ts",
        import.meta.url,
      )),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/*.integration.test.ts"],
  },
});
