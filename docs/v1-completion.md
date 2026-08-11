# Guild OS v1.0 Completion Matrix

Updated: 2026-08-12

No row is complete without an executable test and a production smoke check. `Partial` means the
foundation is implemented but the user-visible end-to-end requirement is not yet satisfied.

| # | v1.0 acceptance condition | Status | Current evidence | Remaining gate |
| --- | --- | --- | --- | --- |
| 1 | Create Guild and invite Humans | Partial | First Admin bootstrap; hashed one-time invitation; People UI; PostgreSQL replay test | Production Access/bootstrap/invitation smoke |
| 2 | Register Human, Agent, Service identities | Partial | Domain/schema support all three; Human claim flow works | Agent and Service creation/stop UI and tests |
| 3 | Enforce Role, Space, Permission before model context | Partial | Domain intersection tests; bounded PostgreSQL Space query; immediate suspension denial | Resource queries and Ask context-builder leakage test |
| 4 | Knowledge files, versions, approval, publish, deprecate | Partial | Schema and lifecycle policy | Repository, R2, UI, complete lifecycle E2E |
| 5 | Ask Guild with authorized citations | Not started | Authorization filter primitive only | Search index, context builder, model call, citations, denial test |
| 6 | Goal, Project, Quest, Step assigned to Human/Agent | Partial | Relational schema | Commands, views, validation, assignment E2E |
| 7 | Agent Plan, approval, one external write | Not started | Risk/quorum and authority intersection policy | Workflow, connector, idempotent write, approval UI/E2E |
| 8 | Formal Decision with evidence and approvals | Partial | Relational schema | Commands, views, approval and supersession E2E |
| 9 | Role/Space Announcement, Inbox, Knowledge notification | Partial | Isolated tables and indexes | Commands, delivery fan-out, views, read state E2E |
| 10 | Chronicle all important Human/Agent actions | Partial | Immutable/RLS table; bootstrap/invitation/membership events | Chronicle query UI and complete action coverage assertions |
| 11 | Human departure and Agent stop revoke access/tokens immediately | Partial | Human lifecycle disables access, revokes Connectors, kills runs; PostgreSQL test | Agent stop path, Workflow termination, production cached-capability smoke |
| 12 | Agent budget/time/step/retry limits and Kill Switch | Partial | Domain limit policy and run columns | Durable enforcement, Workflow termination, UI, over-limit E2E |

## Current verified slice

- PostgreSQL 17 migrations are checksum-pinned and idempotent.
- Forced Guild row-level security blocks cross-Guild reads and writes.
- Root Owner cannot be disabled, suspended, departed, or replaced by an Agent.
- Space grants inherit to descendants, not siblings, without loading the whole Guild per request.
- One-time invitations reject replay; acceptance and lifecycle changes produce Chronicle events.
- Suspended and departed Humans immediately return no authorized Spaces.
- English, Japanese, and Simplified Chinese UI modes render without missing-key breakage.
- Desktop and 390 px mobile Home, People, invitation, uninvited, and suspended states have Playwright
  interaction and overflow checks.
