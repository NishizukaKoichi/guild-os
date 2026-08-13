import { describe, expect, it } from "vitest";
import { assertRecentReauthentication } from "../src/reauthentication.js";

const NOW = Date.parse("2026-08-14T02:00:00.000Z");
const options = {
  now: NOW,
  missingMessage: "missing",
  expiredMessage: "expired",
};

describe("assertRecentReauthentication", () => {
  it("accepts and normalizes a verified login within five minutes", () => {
    expect(assertRecentReauthentication("2026-08-14T01:55:00.000Z", options))
      .toBe("2026-08-14T01:55:00.000Z");
  });

  it("rejects missing, stale, malformed, and materially future evidence", () => {
    expect(() => assertRecentReauthentication(null, options)).toThrow("missing");
    expect(() => assertRecentReauthentication("2026-08-14T01:54:59.999Z", options))
      .toThrow("expired");
    expect(() => assertRecentReauthentication("not-a-time", options)).toThrow("expired");
    expect(() => assertRecentReauthentication("2026-08-14T02:00:30.001Z", options))
      .toThrow("expired");
  });
});
