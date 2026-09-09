# ADR 0051: Read Memory without edit permission

Status: Accepted

## Context

The Memory list displayed titles and summaries but exposed body content only
through its editor. A member with read permission and no edit capability could
not read a non-governed Memory's full content in the normal interface, although
the permission-filtered API already returned that content.

## Decision

Give each non-governed Memory a native expandable Content section containing
the existing authorized body, visibility and classification. Render body text
literally, preserve line breaks and wrap long words. Use a native keyboard
operable disclosure with a 44 px target. Governed Knowledge retains its
dedicated version/review workflow.

Ask and Home descriptions in all three UI languages now refer to authorized
information, not exclusively canonical records. Production citations can also
include permitted Working Memory; those drafts must not be described as
approved merely because they appear in an answer.

This does not fetch additional records, grant editing, change authorization,
expose another Actor's private content, or mutate saved data. The server-side
Memory page remains the data access boundary.

## Verification and rollback

Read-only member browser tests at 1440, 390 and 320 px open Content with the
keyboard, verify the body, assert there is no Edit action, switch EN/JA/zh-CN,
and check for horizontal overflow and console/page errors. Existing security
and governance tests remain mandatory.

No API or database migration is required. The display-only change can be
reverted without data cleanup.
