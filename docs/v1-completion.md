# Guild OS v1.0 Completion Matrix

Updated: 2026-08-12

`Complete` means the behavior has executable unit, PostgreSQL/Gatekeeper integration, and browser
acceptance coverage, with representative production verification through the real Access,
Hyperdrive, R2, Workers AI, Workflow, and Webhook boundaries. Destructive recovery and two-account
authority cases are rehearsed in isolated acceptance environments instead of against live data.

| # | v1.0 acceptance condition | Status | Acceptance evidence | Release operation |
| --- | --- | --- | --- | --- |
| 1 | Create Guild and invite Humans | Complete | Explicit Workshop-admin bootstrap, serialized first-Root claim, privacy-minimized nonmember response, hashed one-time invitation, People UI, PostgreSQL/browser tests | Recheck Access and one invitation after identity-policy changes |
| 2 | Register Human, Agent, Service identities | Complete | Human invitation claim; Agent/Service creation; Role assignment; stop, suspend, and depart controls; integration and responsive browser tests | Recheck lifecycle after Role-schema changes |
| 3 | Enforce Role, Space, Permission before model context | Complete | Forced RLS, SQL prefilter plus domain recheck, wrong-Space/explicit-share/clearance leakage tests, and model-observation ordering test | Run DB preflight and Ask smoke for every release |
| 4 | Knowledge files, versions, approval, publish, deprecate | Complete | Immutable lifecycle, human-only approval, R2 two-phase upload and cleanup, sandboxed file-chooser E2E, and production canonical Knowledge verification | Recheck one R2 upload after storage-binding changes |
| 5 | Ask Guild with authorized citations | Complete | Canonical-only bounded context, Workers AI call, version citations, no-evidence response, rate limiting, leakage tests, and cited production answer | Recheck one cited answer after model changes |
| 6 | Goal, Project, Quest, Step assigned to Human/Agent | Complete | Database-enforced hierarchy/Space/version/assignment rules, notifications, Chronicle, integration tests, and full responsive E2E | Recheck representative assignment after schema changes |
| 7 | Agent Plan, approval, one external write | Complete | Cloudflare OS action staging, Guild Human quorum, current authority intersection, Workflow/outbox execution, signed idempotent Webhook, production delivery, and race tests | Recheck signed receiver path for every release |
| 8 | Formal Decision with evidence and approvals | Complete | Immutable proposal, Constitution quorum, append-only reviews, evidence/dissent/supersession rules, notifications, integration tests, and responsive E2E | Recheck representative approval after Constitution changes |
| 9 | Role/Space Announcement, Inbox, Knowledge notification | Complete | Immutable audience, set-based fan-out, deduplication, current-authority reads, integration tests, and responsive E2E | Recheck current-authority visibility after permission changes |
| 10 | Chronicle all important Human/Agent actions | Complete | Append-only forced-RLS history with lifecycle, approval, execution, Kill, offboarding, and late-delivery evidence plus searchable responsive UI | Compare sequence across every backup and restore |
| 11 | Human departure and Agent stop revoke access/tokens immediately | Complete | Transactional Identity disable, Connector revocation, run Kill, approval expiry, outbox cancellation, Workflow termination, and current-authority recheck | Rehearse in isolated acceptance after capability changes |
| 12 | Agent budget/time/step/retry limits and Kill Switch | Complete | Immutable intersected limits, runtime checks, zero-retry external write, atomic claim, Kill UI, dispatch exhaustion, and Kill-race tests | Rehearse timeout/Kill after Workflow changes |

## Current verified slice

- PostgreSQL 17 migrations are checksum-pinned and idempotent.
- Page load cannot create a Guild. Explicit initialization requires trusted Workshop-admin context
  and exact Guild-name confirmation, while a Guild-scoped advisory lock permits one Root winner.
  Nonmembers receive no Root, Constitution, ownership-transfer, or Agent-default bootstrap fields.
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
- Contextual Conversations resolve the current subject boundary before message text leaves
  PostgreSQL. Messages are append-only, Human mentions and Inbox delivery are set-based, and only
  authorized Humans can perform reason-required lock, unlock, or redaction. Chronicle stores the
  message digest rather than plaintext. Knowledge, Quest, and Decision comment flows have desktop
  and 390 px mobile browser coverage.
- Cloudflare OS and the management UI can discover only runnable Agent, Space, and Connector
  combinations. A Risk Level 2 plan enters durable approval before the fixed Webhook is called.
  Execution reloads both Human and Agent authority, intersects current and snapshotted limits,
  claims the run once, signs the exact request, and records the result. Dispatch exhaustion,
  stopped-Agent recheck, explicit Kill, Identity offboarding, and delivery-after-Kill races have
  PostgreSQL integration coverage.
- The optional reference receiver verifies exact signed bytes before parsing, rejects stale events,
  and gives each Guild/idempotency-key pair an independent SQLite-backed Durable Object. Unit tests
  cover forgery, replay-window, envelope mismatch, oversized input, exact duplicate, and conflict.
- Desktop plus 320 px and 390 px mobile action-first Home, progressive navigation, Team, AI Agents, Settings,
  invitation, uninvited, and suspended
  states plus the complete Knowledge, Ask, Goal-to-Step Work, Decision, Announcement, Inbox, and
  Chronicle and contextual Conversation paths have Playwright interaction and overflow checks.
- Production operations fail closed on a dirty source tree, submodule drift, PostgreSQL below 17,
  plaintext remote database connections, privileged database roles, migration checksum drift, or
  missing forced RLS. First-deploy KV/R2 identifiers survive a partial deploy in a purchaser-local
  lock. Release and smoke evidence are checksummed and stored outside the source template.
- The root frozen dependency graph covers both selected Cloudflare OS packages and Guild-owned
  Workers. High-severity audit, peer validation, affected upstream tests, and a 24-hour dependency
  release-age policy run in CI and before deploy. Purchaser configuration is ignored or external,
  owner-readable only, rejects secret-like keys, and is represented only by a hash in evidence.
- The backup command enforces a quiescent Chronicle boundary, exports PostgreSQL, binary-safe KV,
  R2, Access, active Worker versions, exact recovery configuration, and optional Context Artifacts,
  then verifies every checksum and object count. Restore preparation re-verifies the set and emits
  bounded Wrangler KV batches without mutating a target.

## Release acceptance

The matrix records product capability, not permission to skip release controls. Each production
release must still pass dependency audit, peer validation, typecheck/lint, build, unit and upstream
tests, PostgreSQL/Gatekeeper integration tests, desktop/mobile Playwright acceptance, exact-commit
Worker verification, production smoke, encrypted backup verification, and an isolated restore
rehearsal. Checksummed evidence belongs outside the source repository under purchaser custody.
