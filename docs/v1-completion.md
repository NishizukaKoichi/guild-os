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
| 6 | Goal, Project, Quest, Step assigned to Human/Agent | Partial | Domain lifecycle; database-enforced hierarchy, Space containment, optimistic versions, and Human/Agent assignment; permission-prefiltered services; responsive management UI; PostgreSQL, Gatekeeper, and full hierarchy E2E tests | Production Hyperdrive assignment and Chronicle smoke |
| 7 | Agent Plan, approval, one external write | Partial | Cloudflare OS action staging; separate Guild Human quorum; fixed signed Webhook; permission intersection at plan and execution; atomic claim; no unsafe write retry; Workflows/outbox; responsive approval/result E2E; PostgreSQL integration tests; bundled exact-byte HMAC/replay/idempotency receiver | Production Workflow, approval, receiver-signature, and idempotency smoke |
| 8 | Formal Decision with evidence and approvals | Partial | Permission-prefiltered commands and views; immutable proposal; Constitution quorum; append-only human reviews; same-option approval; evidence; dissent; exact-boundary supersession; PostgreSQL, Gatekeeper, and responsive E2E tests | Production Hyperdrive Decision lifecycle and notification smoke |
| 9 | Role/Space Announcement, Inbox, Knowledge notification | Partial | Human-only draft/publish/archive lifecycle; immutable audience; set-based Role/Space fan-out; deduplication; Knowledge-update fan-out; current-authority Inbox reads; responsive UI and E2E | Production Hyperdrive delivery and read-state smoke |
| 10 | Chronicle all important Human/Agent actions | Partial | Immutable/RLS table; resource-boundary snapshots; SQL-prefiltered search; Human lifecycle coverage; Agent plan, outer approval, Guild vote, claim, success/failure, dispatch exhaustion, Kill, offboarding, and late-delivery-race events | Production Chronicle correlation smoke |
| 11 | Human departure and Agent stop revoke access/tokens immediately | Partial | Identity disable, Agent stop, owned-Connector revocation, related-run Kill, pending approval expiry, outbox cancellation, Workflow termination enqueue, current-authority recheck, and per-run Chronicle in one transaction | Production cached-capability and active-Workflow termination smoke |
| 12 | Agent budget/time/step/retry limits and Kill Switch | Partial | Immutable run limits intersected with current Agent/Constitution limits; runtime checks; zero-retry v1 write; atomic claim; run-level Kill UI; Identity lifecycle Kill; dispatch exhaustion and Kill-race tests | Production timeout, Kill, and receiver-race smoke |

## Current verified slice

- PostgreSQL 17 migrations are checksum-pinned and idempotent.
- Forced Guild row-level security blocks cross-Guild reads and writes.
- Root Owner cannot be disabled, suspended, departed, or replaced by an Agent.
- Constitution changes are Root-only, expected-version guarded, reasoned, and atomically recorded
  in Chronicle. PostgreSQL rejects delegated update authority, actor forgery, invalid policy, and
  deletion; desktop and mobile browser tests cover editable and read-only states.
- Root ownership transfer requires an immutable proposal from the current Root and acceptance by
  the named active Human in a separate session. PostgreSQL rejects direct replacement, stale
  acceptance, unaudited transitions, Role mutation during a proposal, and history deletion; the
  outgoing Root retains the agreed Role.
- Break Glass recovery uses ten 192-bit one-time codes whose plaintext is shown only once and whose
  SHA-256 hashes are stored in PostgreSQL. Rotation, revocation, and successful use advance an
  irreversible generation pointer. Recovery is rate-limited, rejects inactive and machine
  Identities, preserves the old Root's configured Role, supersedes pending transfers, invalidates
  the whole generation, and requires an atomic `break_glass.used` Chronicle record. PostgreSQL and
  desktop/mobile browser tests cover enrolled and previously unknown Human recovery paths.
  A normal two-party Root transfer also invalidates the prior recovery generation atomically.
- Space grants inherit to descendants, not siblings, without loading the whole Guild per request.
- One-time invitations reject replay; acceptance and lifecycle changes produce Chronicle events.
- Suspended and departed Humans immediately return no authorized Spaces.
- Custom Roles cannot contain Constitution update or Break Glass authority, become empty, or grant
  authority that the administrator does not hold globally. Machine identities cannot receive
  human-only permissions.
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
- Goal, Project, Quest, and Step mutations enforce legal transitions and exact versions. A child
  cannot broaden its parent's Space, terminal parents require terminal children, and only active
  Humans or Agents with access to the Work resource can receive an assignment. Assignment
  notifications and Chronicle evidence commit with the Work mutation.
- Decision proposal freezes content, evidence, options, and its authorization boundary. Only
  eligible active Humans can add an append-only review, one option must independently reach the
  Constitution quorum, and terminal results cannot be rewritten. Supersession requires an approved
  replacement with the exact same boundary. Approver counting and Inbox fan-out remain set-based
  and are integration-tested above twenty eligible reviewers.
- Announcement publication freezes content and audience, then delivers recipient Inbox rows with a
  set-based, deduplicated SQL statement. Knowledge publication uses the same scalable delivery
  pattern. Inbox and Chronicle reads re-evaluate current Membership, Role, Space, clearance,
  visibility, ownership, and explicit sharing before rows leave PostgreSQL; revocation tests prove
  old notifications disappear without rewriting history.
- Cloudflare OS and the management UI can discover only runnable Agent, Space, and Connector
  combinations. A Risk Level 2 plan enters durable approval before the fixed Webhook is called.
  Execution reloads both Human and Agent authority, intersects current and snapshotted limits,
  claims the run once, signs the exact request, and records the result. Dispatch exhaustion,
  stopped-Agent recheck, explicit Kill, Identity offboarding, and delivery-after-Kill races have
  PostgreSQL integration coverage.
- The optional reference receiver verifies exact signed bytes before parsing, rejects stale events,
  and gives each Guild/idempotency-key pair an independent SQLite-backed Durable Object. Unit tests
  cover forgery, replay-window, envelope mismatch, oversized input, exact duplicate, and conflict.
- Desktop and 390 px mobile Home, People, Agents, Settings, invitation, uninvited, and suspended
  states plus the complete Knowledge, Ask, Goal-to-Step Work, Decision, Announcement, Inbox, and
  Chronicle paths have Playwright interaction and overflow checks.
