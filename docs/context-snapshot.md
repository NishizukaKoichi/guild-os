# Guild OS Context Snapshot

Updated: 2026-08-12

## Current goal

Build Guild OS as a self-owned organizational operating system where humans and AI agents share
governed memory, work, decisions, and an append-only history.

## Authoritative sources

- Product requirements: the Guild OS v1.0 specification agreed in the project conversation.
- Runtime behavior: the pinned `cloudflare-os` submodule and its source code.
- Deployment behavior: the tracked `deployment.jsonc` template, ignored or external purchaser
  configuration, `scripts/deploy.mjs`, and tests.
- Architecture decisions: `docs/adr/`.

When these disagree, executable code and a newer accepted ADR take precedence. A conflicting
product requirement must be resolved explicitly rather than silently weakened.

## Confirmed decisions

- Guild OS extends Cloudflare OS instead of rebuilding its agent workspace, Gadgets, Blueprints,
  Dynamic Worker isolation, or Gatekeeper approval model.
- The upstream Cloudflare OS commit is pinned as a Git submodule. Deployment-owned Workers and
  Gatekeepers live outside that submodule.
- One purchaser-controlled deployment represents one Guild. Spaces provide internal segmentation;
  later federation connects separate Guild deployments explicitly.
- PostgreSQL is the system of record for relational Guild data and Chronicle events. Workers reach
  it through Hyperdrive. R2 stores files; search indexes are derived data, never the source of truth.
- Cloudflare Access authenticates humans before application code. Guild authorization is still
  enforced on every data operation and is not delegated to frontend visibility controls.
- Cloudflare OS Gatekeepers remain the only path from agents and Gadgets to Guild data or external
  side effects.
- No central seller-operated API, licensing server, database, or mandatory subscription is allowed.

## Security invariants

- A Root Owner is always a human.
- An active Guild must retain at least one active Root Owner.
- An agent cannot grant permissions, change the Constitution, transfer ownership, or invoke Break
  Glass.
- Effective agent authority is the intersection of agent, requester, workflow, and connector
  authority.
- Context is permission-filtered before any text or metadata is supplied to a model.
- Every material mutation and every approved external action produces a Chronicle event.
- Level 2 actions require human approval by default. Level 3 actions require reauthentication and
  the Constitution's approval quorum.
- Every run has budget, duration, step, retry, and delegation limits plus a kill switch.

## Current implementation state

- Cloudflare OS Starter is cloned under the canonical Pensive workspace.
- Upstream Cloudflare OS is pinned at `bf7f762d7fa73553284d731ab6a978d3ea17be24`.
- Starter baseline tests pass locally on Node.js 22; Node.js 24 remains the supported release target.
- Guild domain policy, PostgreSQL persistence, migration tooling, and Guild Gatekeeper are
  implemented. The Gatekeeper requires explicit Workshop-admin initialization, serializes the
  first-Root claim in PostgreSQL, minimizes bootstrap data for nonmembers, supports one-time Human
  invitations and Membership lifecycle writes, and provides a sandboxed responsive management UI.
- PostgreSQL 17 integration verification applies migrations twice using a non-superuser owner, then
  proves tenant RLS isolation and Chronicle immutability. The same checks run in CI.
- Role/Space editors and governed Knowledge/Ask Guild are implemented. Knowledge includes immutable
  versions, human approval, multilingual content, R2 files, acknowledgement, retirement, citations,
  locale-aware SQL-before-model authorization, rate limiting, and durable file cleanup.
- Governed Work is implemented from Goal through Project, Quest, and Step. It includes bounded
  keyset lists, SQL-before-service authorization, legal status transitions, optimistic versions,
  hierarchical Space containment, active Human/Agent assignment, Inbox notification writes,
  Chronicle evidence, and responsive browser flows.
- Governed Decisions are implemented with bounded SQL-prefiltered reads, draft versioning,
  immutable proposals, Constitution-defined human quorum, evidence references, dissent,
  security-boundary-preserving supersession, Inbox fan-out, Chronicle evidence, and responsive
  browser flows.
- Governed Announcements, Inbox read state, Knowledge-update notifications, and Chronicle queries
  are implemented with SQL-before-service authorization, current-authority revocation, set-based
  fan-out, immutable payloads, keyset pagination, and responsive browser flows.
- Governed Agent execution is implemented for one deployment-owned Risk Level 2 HTTPS Webhook.
  It includes Cloudflare OS action approval, Guild Human quorum, permission-filtered discovery,
  immutable plans and authority snapshots, execution-time rechecks, HMAC and idempotency, hard
  limits, Cloudflare Workflows, transactional dispatch, Kill/offboarding cancellation, late-race
  audit evidence, management UI, and integration/browser tests.
- A purchaser-owned reference receiver provides HMAC verification, replay-window enforcement, and
  strongly consistent per-idempotency-key Durable Object storage for that Webhook.
- Constitution management is implemented as a Root-only, versioned, reason-required transaction.
  Role delegation, stale writes, forged SQL actors, invalid policy, and deletion are rejected at
  the database boundary; the responsive Settings UI exposes read-only policy to non-Root members.
- Root ownership handover is implemented as an expiring two-party transaction between active
  Humans. Proposal terms and the outgoing Role are frozen, direct Root replacement and unaudited
  transitions fail in PostgreSQL, and desktop/mobile browser tests cover propose, cancel, and
  acceptance from the successor's separate session.
- Purchaser-owned Break Glass recovery is implemented with one-time 192-bit offline codes,
  SHA-256-only storage, irreversible generation rotation/revocation, per-account rate limiting,
  active-Human enforcement, prior-Root Role preservation, pending-transfer supersession, mandatory
  disclosure/change Chronicle evidence, and desktop/mobile browser coverage.
- Context-bound Conversations are implemented for Knowledge, Work, Decisions, Announcements, and
  Agent Runs. Current subject authorization is applied before message text leaves PostgreSQL;
  Human mentions, Inbox delivery, append-only messages, audited lock/unlock, and redaction have
  PostgreSQL and Gatekeeper integration coverage. Knowledge, Quest, and Decision expose the shared
  responsive comments panel in the v1 UI.
- The Gatekeeper now separates liveness from database/schema readiness, denies unrelated HTTP
  paths, and emits bounded maintenance counts without Guild content or exception messages.
- Production operations are implemented as executable tools: exact database/TLS/RLS preflight,
  partial-to-complete Cloudflare resource locking, Git-annotated clean-source deploys, redacted
  release evidence, Access/receiver smoke evidence, Guild-scoped forced-RLS PostgreSQL export,
  binary-safe KV export, Cloudflare REST R2 export, Access snapshot validation, checksum
  verification, and non-destructive restore preparation. ADRs 0016 and 0027 record the
  purchaser-owned recovery boundary and default R2 transfer path.
- The root pnpm workspace and lockfile are the release dependency authority for the selected
  Cloudflare OS packages and Guild-owned packages. Supply-chain age policy, patched transitive
  overrides, peer validation, and high-severity audit are enforced before deployment without
  changing the pinned upstream submodule.
- The purchaser-owned production deployment is live behind Cloudflare Access. Root initialization,
  canonical Knowledge, comments, and cited Ask Guild answers have been verified against production.

## Release sequence

1. Deploy only a clean, pushed commit and verify every active Worker identifies that exact commit.
2. Record checksummed release and production-smoke evidence outside the source repository.
3. Capture a purchaser-owned encrypted backup, prepare an isolated restore, and compare Guild table
   counts plus Chronicle sequence before accepting the release.
