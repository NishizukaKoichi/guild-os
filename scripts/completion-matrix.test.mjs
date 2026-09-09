import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { completionDeclarationReport } from "./completion-matrix.mjs";

const specification = await readFile(new URL("../docs/product-specification.md", import.meta.url), "utf8");
const matrix = await readFile(new URL("../docs/product-completion-matrix.md", import.meta.url), "utf8");

test("all authoritative sections remain represented without promoting declarations into evidence", () => {
  const report = completionDeclarationReport(specification, matrix);
  assert.equal(report.sectionCount, 42);
  assert.equal(report.rows.length, 42);
  assert.equal(report.evidenceClass, "documentation-only");
  assert.equal(report.productCompletionVerified, false);
  assert.ok(report.openSections.includes(39));
  assert.ok(report.openSections.includes(40));
});

test("a missing, duplicate, extra, or noncanonical-status row fails closed", () => {
  const firstRow = matrix.split("\n").find((line) => /^\| 1 \|/.test(line));
  assert.ok(firstRow);
  for (const changed of [
    matrix.replace(firstRow, ""), `${matrix}\n${firstRow}\n`,
    `${matrix}\n| 43 | Extra | Missing | No evidence |\n`,
    matrix.replace(firstRow, firstRow.replace("Implemented and verified", "Done enough")),
  ]) {
    assert.throws(() => completionDeclarationReport(specification, changed));
  }
});

test("narrowing the specification or marking all rows verified cannot certify the product", () => {
  assert.throws(() => completionDeclarationReport(specification.replace("## 42.", "### 42."), matrix));
  const allGreen = matrix.replace(/^(\|\s*\d+\s*\|[^|]+\|)[^|]+\|/gm, "$1 Implemented and verified |");
  const report = completionDeclarationReport(specification, allGreen);
  assert.equal(report.allRowsDeclareVerified, true);
  assert.equal(report.productCompletionVerified, false);
});
