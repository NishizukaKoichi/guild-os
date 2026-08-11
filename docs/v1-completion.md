# Guild OS v1.0 Completion Matrix

Updated: 2026-08-12

No row is complete without an executable test and a production smoke check. `Partial` means the
foundation is implemented but the user-visible end-to-end requirement is not yet satisfied.

| # | v1.0 acceptance condition | Status | Current evidence | Remaining gate |
| --- | --- | --- | --- | --- |
| 1 | Create Guild and invite Humans | Partial | First Admin bootstrap; hashed one-time invitation; People UI; PostgreSQL replay test | Production Access/bootstrap/invitation smoke |
| 2 | Register Human, Agent, Service identities | Partial | Human invitation claim plus Agent and Service creation, Role assignment, stop/suspend/depart controls, PostgreSQL integration tests, responsive UI smoke | Production identity lifecycle smoke |
| 3 | Enforce Role, Space, Permission before model context | Partial | SQL prefilter plus domain recheck; wrong-Space, explicit-share, and clearance leakage integration tests; observation ordering test | Production Access/Workers AI smoke |
| 4 | Knowledge files, versions, approval, publish, deprecate | Partial | Immutable PostgreSQL lifecycle; human-only approval; R2 two-phase upload and durable cleanup; responsive lifecycle E2E | Production Hyperdrive/R2 lifecycle smoke |
| 5 | Ask Guild with authorized citations | Partial | Canonical-only search, bounded context, Workers AI call, version citations, no-evidence behavior, rate limit, and leakage tests | Production Workers AI citation smoke; derived semantic index remains post-MVP quality work |
| 6 | Goal, Project, Quest, Step assigned to Human/Agent | Partial | Relational schema | Commands, views, validation, assignment E2E |
| 7 | Agent Plan, approval, one external write | Not started | Risk/quorum and authority intersection policy | Workflow, connector, idempotent write, approval UI/E2E |
| 8 | Formal Decision with evidence and approvals | Partial | Relational schema | Commands, views, approval and supersession E2E |
| 9 | Role/Space Announcement, Inbox, Knowledge notification | Partial | Isolated tables and indexes | Commands, delivery fan-out, views, read state E2E |
| 10 | Chronicle all important Human/Agent actions | Partial | Immutable/RLS table; bootstrap/invitation/membership events | Chronicle query UI and complete action coverage assertions |
| 11 | Human departure and Agent stop revoke access/tokens immediately | Partial | Human, Agent, and Service lifecycle disables access; Agent stop revokes Connectors and kills unfinished runs in one transaction; PostgreSQL tests | Workflow cancellation and production cached-capability smoke |
| 12 | Agent budget/time/step/retry limits and Kill Switch | Partial | Domain and database limit policy, Agent configuration UI, and stopped-profile constraints | Runtime enforcement, Workflow termination, run-level kill UI, over-limit E2E |

## Current verified slice

- PostgreSQL 17 migrations are checksum-pinned and idempotent.
- Forced Guild row-level security blocks cross-Guild reads and writes.
- Root Owner cannot be disabled, suspended, departed, or replaced by an Agent.
- Space grants inherit to descendants, not siblings, without loading the whole Guild per request.
- One-time invitations reject replay; acceptance and lifecycle changes produce Chronicle events.
- Suspended and departed Humans immediately return no authorized Spaces.
- Custom Roles cannot contain Break Glass, become empty, or grant authority that the administrator
  does not hold globally. Machine identities cannot receive human-only permissions.
- Space ancestry, one-root topology, identity kind, Agent profile ownership, and active profile /
  Membership pairing are enforced in PostgreSQL as well as application code.
- Human, Agent, and Service management plus custom Role and Space administration have PostgreSQL
  integration coverage and responsive management screens.
- English, Japanese, and Simplified Chinese UI modes render without missing-key breakage.
- Pre-publication Knowledge security changes require authorization on old and proposed boundaries;
  publication locks that boundary, while files independently retain their upload-time boundary.
- Unauthorized Knowledge is removed in PostgreSQL and rechecked in the domain layer before Ask
  Guild invokes Workers AI. Prompt logs and model cache are disabled.
- Interrupted uploads and R2 deletion failures are retained in an idempotent outbox and retried by
  the Worker Cron Trigger.
- Desktop and 390 px mobile Home, People, Agents, Settings, invitation, uninvited, and suspended
  states plus the complete Knowledge and Ask path have Playwright interaction and overflow checks.
