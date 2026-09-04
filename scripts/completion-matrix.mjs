import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const statuses = new Set([
  "Implemented and verified", "Implemented but unverified", "Partially implemented",
  "Mock only", "Documented only", "Missing", "Blocked by legal review",
  "Blocked by external credential",
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function completionDeclarationReport(specification, matrix) {
  const sections = [...specification.matchAll(/^## (\d+)\. (.+)$/gm)]
    .map((match) => ({ section: Number(match[1]), title: match[2] }));
  if (sections.length !== 42 || sections.some((value, index) => value.section !== index + 1)) {
    throw new Error("The authoritative specification must retain all 42 ordered sections.");
  }
  const rows = [...matrix.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*(.+)\|\s*$/gm)]
    .map((match) => ({
      section: Number(match[1]), area: match[2].trim(),
      declaredStatus: match[3].trim(), evidenceAndGap: match[4].trim(),
    }));
  const ids = rows.map((row) => row.section);
  if (rows.length !== sections.length || new Set(ids).size !== sections.length ||
      sections.some(({ section }) => !ids.includes(section))) {
    throw new Error("Every specification section needs exactly one matrix row; no omissions or duplicates.");
  }
  for (const row of rows) {
    if (!statuses.has(row.declaredStatus)) {
      throw new Error(`Section ${row.section} uses an unsupported completion status.`);
    }
  }
  const openSections = rows.filter((row) => row.declaredStatus !== "Implemented and verified")
    .map((row) => row.section);
  return {
    format: "guild-os-completion-declarations/v1",
    evidenceClass: "documentation-only",
    specificationSha256: hash(specification),
    matrixSha256: hash(matrix),
    sectionCount: sections.length,
    rows,
    openSections,
    allRowsDeclareVerified: openSections.length === 0,
    productCompletionVerified: false,
    reason: "Declarations cannot attest independent purchaser, physical custody, professional review, CI, or production evidence.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("completion-matrix.mjs takes no arguments.");
    const docs = new URL("../docs/", import.meta.url);
    const specification = await readFile(new URL("product-specification.md", docs), "utf8");
    const matrix = await readFile(new URL("product-completion-matrix.md", docs), "utf8");
    console.log(JSON.stringify(completionDeclarationReport(specification, matrix), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Completion declaration check failed.");
    process.exitCode = 1;
  }
}
