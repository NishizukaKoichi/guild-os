import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const suiteTitle = "openGadget errors across native RPC and Cap'n Web";

export function requiredRpcSuite(source) {
  const file = ts.createSourceFile("rpc.test.ts", source, ts.ScriptTarget.Latest, true);
  const suites = [];
  let tests = 0;
  let disabledTests = false;
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(file);
      if (expression === "it") tests += 1;
      if (/^(it|test)\./.test(expression)) disabledTests = true;
      if (["describe", "describe.skip"].includes(expression) &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === suiteTitle) {
        suites.push(node.expression);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (suites.length !== 1 || tests !== 4 || disabledTests) {
    throw new Error("Pinned RPC suite changed; review its four required cases before updating this gate.");
  }
  const suite = suites[0];
  return source.slice(0, suite.getStart(file)) + "describe" + source.slice(suite.end);
}

export async function runRequiredRpcSuite() {
  const directory = resolve(root, "cloudflare-os/packages/workshop-backend/__integration__");
  const source = await readFile(resolve(directory, "open-gadget-rpc.test.ts"), "utf8");
  const name = `guild-required-rpc-${randomUUID()}.test.ts`;
  const path = resolve(directory, name);
  // Exercise the pinned upstream source without editing its tracked files or gitlink.
  await writeFile(path, requiredRpcSuite(source), { flag: "wx" });
  try {
    await new Promise((accept, reject) => {
      const child = spawn("pnpm", [
        "--filter", "@gadgets/workshop-backend", "exec", "vitest", "run",
        "--config", "vitest.integration.config.ts", `__integration__/${name}`,
      ], { cwd: root, env: process.env, stdio: "inherit", shell: false });
      child.once("error", reject);
      child.once("close", (code, signal) => code === 0 ? accept() :
        reject(new Error(`Required RPC suite failed (${signal ?? code}).`)));
    });
  } finally {
    await unlink(path);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("cloudflare-os-rpc.mjs takes no arguments.");
    await runRequiredRpcSuite();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Required RPC suite failed.");
    process.exitCode = 1;
  }
}
