# ADR 0009: Governed Communications and Chronicle Queries

Status: Accepted

Date: 2026-08-12

## Decision

PostgreSQL is the source of truth for Announcements, Inbox notifications, and Chronicle events.
Announcements are drafts until an authorized active Human publishes them. Draft edits use exact-
version optimistic concurrency. Publication freezes content and audience, writes recipient Inbox
rows with one set-based statement, and appends Chronicle evidence in the same transaction. Published
Announcements may be archived but cannot be rewritten. `announcement.manage` is human-only.

An Announcement audience is the intersection of its Guild, Space ancestry, optional target Role,
visibility, classification, explicit Identity shares, active Identity state, and `preboarding` or
`active` Membership. The publisher is excluded from its own delivery. Fan-out uses a stable
deduplication key so a retried publication cannot create duplicate notifications. Knowledge
publication uses the same set-based pattern to notify every currently authorized Human without an
application-level member cap.

Inbox and Chronicle rows retain a security-boundary snapshot from the originating resource. Read
queries first require current active Identity and Membership state, then apply current Role, Space,
classification, visibility, ownership, and explicit-share authorization to that snapshot in SQL.
The Gatekeeper repeats domain authorization before returning results. Losing a Role or Membership
therefore hides old notifications and events immediately; historical rows remain durable for an
authorized auditor. Inbox titles, bodies, resource links, recipient, kind, deduplication key, and
security snapshot are immutable. Only the recipient's read timestamp can change.

Chronicle is append-only and keyset-paginated by its monotonic sequence. Search is a derived
PostgreSQL text index over normalized action and subject-type tokens. Filters for actor, subject,
and time are applied together with authorization in SQL. Arbitrary event details remain bounded to
flat primitive evidence and are never used as an authorization source.

## Alternatives considered

- Browser-only notification state was rejected because it cannot provide durable delivery,
  cross-device read state, or revocation after a permission change.
- Per-recipient application loops were rejected because they scale linearly in network round trips
  and can leave partially delivered audiences. One SQL insert keeps delivery atomic and bounded.
- Returning all Chronicle rows and filtering in React was rejected because denied evidence would
  cross the server boundary and pagination could leak row counts.
- Recomputing visibility only from the current source row was rejected because source deletion or
  later scope changes would make the historical event impossible to authorize consistently.
- Copying resource content into Chronicle search was rejected for v1 because an audit index should
  not become an ungoverned secondary content store.

## Risks and rollback

Security snapshots intentionally preserve the boundary at event time, while current Role and
Membership checks still revoke access. A later migration that needs content search must build a
permission-filtered derived index and must not mutate Chronicle rows. The Inbox and Chronicle pages
can be removed from navigation and the previous Worker restored without deleting records.
Migrations `0016`, `0017`, and `0018` are append-only and must never be edited after application;
corrections require a later migration. Migration `0018` preserves the distinction between an
unpublished archived draft and a previously published archived Announcement.
