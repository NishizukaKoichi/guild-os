import { describe, expect, it } from "vitest";
import { normalizeRetentionPlan } from "../src/retention-service.js";

const NOW = Date.parse("2026-08-14T00:00:00.000Z");
const CUTOFF = "2026-07-15T00:00:00.000Z";

describe("normalizeRetentionPlan", () => {
  it("accepts a bounded dry run without requiring reauthentication or a preview", () => {
    expect(normalizeRetentionPlan({
      dryRun: true,
      cutoffAt: CUTOFF,
      actions: [
        { category: "memories", action: "archive" },
        { category: "files", action: "purge" },
      ],
      previewRunId: null,
      confirmation: "",
      idempotencyKey: "retention-preview-1",
    }, 30, NOW)).toMatchObject({
      dryRun: true,
      cutoffAt: CUTOFF,
    });
  });

  it("requires a matching preview and explicit irreversible confirmation", () => {
    const base = {
      dryRun: false,
      cutoffAt: CUTOFF,
      actions: [{ category: "files", action: "purge" }] as const,
      previewRunId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "retention-purge-1",
    };
    expect(() => normalizeRetentionPlan({ ...base, confirmation: "APPLY" }, 30, NOW))
      .toThrow(/Type PURGE/);
    expect(normalizeRetentionPlan({ ...base, confirmation: "PURGE" }, 30, NOW).confirmation)
      .toBe("PURGE");
  });

  it("rejects newer-than-policy, duplicate, and non-allowlisted operations", () => {
    expect(() => normalizeRetentionPlan({
      dryRun: true,
      cutoffAt: "2026-08-13T00:00:00.000Z",
      actions: [{ category: "memories", action: "retain" }],
      previewRunId: null,
      confirmation: "",
      idempotencyKey: "retention-new-data",
    }, 30, NOW)).toThrow(/newer than/);
    expect(() => normalizeRetentionPlan({
      dryRun: true,
      cutoffAt: CUTOFF,
      actions: [
        { category: "memories", action: "retain" },
        { category: "memories", action: "archive" },
      ],
      previewRunId: null,
      confirmation: "",
      idempotencyKey: "retention-duplicate",
    }, 30, NOW)).toThrow(/only once/);
    expect(() => normalizeRetentionPlan({
      dryRun: true,
      cutoffAt: CUTOFF,
      actions: [{ category: "decisions", action: "purge" }],
      previewRunId: null,
      confirmation: "",
      idempotencyKey: "retention-unsupported",
    }, 30, NOW)).toThrow(/not allowlisted/);
  });
});
