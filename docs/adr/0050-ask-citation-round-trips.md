# ADR 0050: Exact citations and transient Ask continuity

Status: Accepted

## Context

Navigation to Knowledge cleared the requested resource ID immediately after
the caller selected it. Tests with only one item concealed this defect: the
first item happened to be the requested citation. Returning from a citation
also unmounted Ask and lost the question, answer and draft objective.

## Decision

Pass the requested Knowledge ID through the navigation operation itself. Ask,
Memory, Work and Decisions use the same path. Opening the general Knowledge
navigation still clears the target. The target API rechecks authorization;
client routing is not a permission boundary.

Retain the question, answer and objective in a single in-memory session object
owned by App. Ask mounts from that object after a citation round trip. Do not
store this content in URLs, localStorage, sessionStorage or a seller service.
Every bootstrap/authentication reload replaces the object, so old asynchronous
work cannot repopulate a new authentication context. A full page reload clears
the content. Stored Plan proposals continue to use the existing server API.

Scrollable Plan content previews are keyboard-focusable, named regions; they
remain plain text and do not render arbitrary HTML.

## Verification and rollback

At 1440, 390 and 320 px, create an unrelated draft ahead of an existing canonical
source, Ask a question, open the canonical citation, return using browser Back,
and verify the question and answer remain. Verify browser storage excludes the
question and a full reload clears it. The development Ask fixture selects the
canonical source so the test can detect accidental first-item navigation.

No API, database, permission or persistent data changes are required. Reverting
the frontend restores the previous navigation behavior; no data migration or
cleanup is needed.
