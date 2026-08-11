import { describe, expect, it } from "vitest";
import {
  assertAnnouncementContent,
  assertAnnouncementExpiry,
  assertAnnouncementStatus,
  assertAnnouncementTransition,
} from "./announcement.js";

describe("Announcement governance", () => {
  it("accepts the v1 lifecycle", () => {
    expect(() => assertAnnouncementStatus("published")).not.toThrow();
    expect(() => assertAnnouncementTransition("draft", "published")).not.toThrow();
    expect(() => assertAnnouncementTransition("published", "archived")).not.toThrow();
  });

  it("rejects rewriting a published Announcement", () => {
    expect(() => assertAnnouncementTransition("published", "draft")).toThrow(
      "Announcement cannot transition",
    );
  });

  it("validates content and expiry", () => {
    expect(() => assertAnnouncementContent("", "Body")).toThrow();
    expect(() => assertAnnouncementContent("Title", "Body")).not.toThrow();
    expect(() => assertAnnouncementExpiry("not-a-date")).toThrow();
    expect(() => assertAnnouncementExpiry("2030-01-01T00:00:00.000Z")).not.toThrow();
  });
});
