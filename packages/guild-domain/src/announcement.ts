import { ANNOUNCEMENT_STATUSES, ANNOUNCEMENT_TRANSITIONS } from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type { AnnouncementStatus } from "./types.js";
import { assertNonBlank } from "./validation.js";

export function assertAnnouncementStatus(value: string): asserts value is AnnouncementStatus {
  if (!(ANNOUNCEMENT_STATUSES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Announcement status is invalid.");
  }
}

export function assertAnnouncementTransition(
  current: AnnouncementStatus,
  next: AnnouncementStatus,
): void {
  if (current === next) return;
  const allowed = ANNOUNCEMENT_TRANSITIONS[current] as readonly AnnouncementStatus[];
  if (!allowed.includes(next)) {
    throw new GuildDomainError(
      "INVALID_ANNOUNCEMENT_TRANSITION",
      `Announcement cannot transition from ${current} to ${next}.`,
    );
  }
}

export function assertAnnouncementContent(title: string, body: string): void {
  assertNonBlank(title, "Announcement title", 200);
  assertNonBlank(body, "Announcement body", 10_000);
}

export function assertAnnouncementExpiry(expiresAt: string | null): void {
  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
    throw new GuildDomainError("INVALID_INPUT", "Announcement expiry is invalid.");
  }
}
