import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requiredRpcSuite } from "./cloudflare-os-rpc.mjs";

const source = await readFile(new URL(
  "../cloudflare-os/packages/workshop-backend/__integration__/open-gadget-rpc.test.ts", import.meta.url,
), "utf8");

test("required RPC gate changes only the skipped suite invocation, not tests or upstream files", () => {
  const required = requiredRpcSuite(source);
  assert.equal(required, source.replace("describe.skip(", "describe("));
  assert.equal(requiredRpcSuite(required), required);
});

test("required RPC gate refuses missing, duplicated, disabled, or narrowed cases", () => {
  assert.throws(() => requiredRpcSuite(source.replace("describe.skip", "describe.only")));
  assert.throws(() => requiredRpcSuite(`${source}\n${source}`));
  assert.throws(() => requiredRpcSuite(source.replace('it("retains', 'it.skip("retains')));
  assert.throws(() => requiredRpcSuite(source.replace('it("retains', 'other("retains')));
});
