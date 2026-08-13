# Guild OS v1.0 Completion Matrix

Updated: 2026-08-14

`Complete` means the behavior has executable unit, PostgreSQL/Gatekeeper integration, and browser
acceptance coverage, with representative production verification through the real Access,
Hyperdrive, R2, Workers AI, Workflow, and Webhook boundaries. Destructive recovery and two-account
authority cases are rehearsed in isolated acceptance environments instead of against live data.

## Full-spec capability acceptance

| Area | Status | Acceptance evidence | Release operation |
| --- | --- | --- | --- |
| Sovereignty | Complete | Human Root Custodian, versioned Constitution, two-party transfer, one-use Break Glass, Root invariants, and Chronicle integration/E2E | Rehearse transfer and recovery with two synthetic Humans |
| Actors | Complete | Human, Agent, Service, and Guild share Actor/Membership/Role/Capability tables, services, and Members UI | Recheck invitation and every Actor kind after identity changes |
| Context Graph | Complete | Boundary-aware relations among Actors, Memory, Activity, Decisions, Events, Files, Connections, and external sources | Traverse an allowed and denied relation in smoke |
| Memory | Complete | Canonical/Working/External layers, candidates, immutable versions, provenance, files, review signals, deprecation, and Personal/Shared custody | Recheck one complete governed Memory lifecycle |
| Semantic retrieval | Complete | SQL authorization before hybrid lexical/vector ranking, exact-version citations, personal exclusion, lexical fallback, and rebuild runbook | Drain embeddings and run authorized/denied Ask smoke |
| Activity | Complete | Recursive typed Activity, dependencies, assignments, outcomes, Space containment, and optimistic concurrency | Create a Template-specific Activity and dependency |
| Decisions | Complete | Custodian, consent, vote, review, editorial, policy, and hybrid methods with immutable evidence and participation | Recheck one quorum result and dissent |
| Communication | Complete | Role/Space Announcements, current-authority Inbox, contextual Conversations, private messages, and explicit provenance-preserving promotion | Verify private text is absent from Chronicle and retrieval until promotion |
| Onboarding | Complete | Template/Role/Space paths, multiple required Memory/confirmation/Activity items, progress, and activation | Complete a three-requirement Preboarding journey |
| Offboarding | Complete | Atomic access denial, token/Connection/schedule/approval/run stop, outbox cancellation, and explicit handover | Rehearse one Human departure and one Agent stop |
| Contribution | Complete | Event-derived multidimensional evidence, no composite employee score, and correction request/review UI | Submit and resolve a synthetic correction |
| Data ownership | Complete | Guild/Personal/Shared boundaries, logical export, complete backup, restore preparation, retention preview/apply, and purge evidence | Verify checksums and isolated restore preparation |
| Ask / Plan / Act | Complete | Read-only Ask, inspectable Plan, policy-gated Act, proposal creation, approval request, assignment, and Connection action | Complete one read, reversible plan, and approved external action |
| Agents | Complete | Model, Skills, Tools, Connections, schedules, intersected budget/token/time/step/retry/delegation limits, four risk levels, Kill, idempotency, and Home attention for failed or near-limit Runs | Rehearse Level 2, Level 3, timeout, duplicate, and Kill paths |
| Connections | Complete | Purchaser-owned MCP, Gatekeeper API, HTTPS Webhook, and Service Binding configuration, allowlists, health, discovery, invocation, and revocation | Test every enabled production adapter with synthetic data |
| Automation | Complete | Cron and event triggers, durable waits, bounded retry, deduplication, Agent delegation, Kill, and offboarding cancellation | Trigger one schedule and one event in acceptance |
| Federation | Complete | Guild Actor, explicit grant, signed transport, durable delivery, selected resource publication, and revocation | Exchange and revoke one synthetic resource grant |
| Templates | Complete | Blank, Company, Community, Research, Creator, Open Source, and Agent Collective configure Roles, vocabulary, choices, methods, workflows, onboarding, Home, and suggested Agents; Spaces override | Browser acceptance at 1440, 390, and 320 pixels |
| Internationalization | Complete | English default, complete English/Japanese/Simplified Chinese UI dictionaries, persisted choice, and original-language user content | Switch all three languages in browser acceptance |
| Operations | Complete | Purchaser-owned deploy, model and Connection setup, observability, export, retention, backup, restore, rollback, and handover runbooks | Preserve exact-commit release, backup, smoke, and restore evidence externally |

## Collective substrate acceptance

The compatibility layer preserves existing IDs and Company workflows while new code targets the
neutral Actor, Membership, Memory, Activity, Decision, Connection, Run, and Event substrate. Blank
is the default Template; Company is one editable preset. Compatibility removal remains governed by
the migration runbook and is not a v1 release shortcut.

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
- Human, Agent, Service, and Guild Actor management plus custom Role and Space administration have PostgreSQL
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
- Desktop plus 320 px and 390 px mobile action-first Home, Ask, Members, Memory, Activity, More, and Settings,
  invitation, uninvited, and suspended
  states plus the complete Canonical Knowledge, recursive Activity, Goal-to-Step Work compatibility,
  Decision, Announcement, Inbox, and
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
