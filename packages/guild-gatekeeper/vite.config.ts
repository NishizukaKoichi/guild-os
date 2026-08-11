import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const packageDirectory = dirname(fileURLToPath(import.meta.url));

function emitAppText(): Plugin {
  return {
    name: "emit-guild-app-text",
    closeBundle() {
      const html = readFileSync(resolve(packageDirectory, "dist-app/app/index.html"), "utf8");
      const output = resolve(packageDirectory, "src/generated/app.txt");
      if (existsSync(output) && readFileSync(output, "utf8") === html) return;
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, html);
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), emitAppText()],
  build: {
    outDir: "dist-app",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: "app/index.html",
    },
  },
});
