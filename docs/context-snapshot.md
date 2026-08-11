# Guild OS Context Snapshot

Updated: 2026-08-12

## Current goal

Build Guild OS as a self-owned organizational operating system where humans and AI agents share
governed memory, work, decisions, and an append-only history.

## Authoritative sources

- Product requirements: the Guild OS v1.0 specification agreed in the project conversation.
- Runtime behavior: the pinned `cloudflare-os` submodule and its source code.
- Deployment behavior: this repository's `deployment.jsonc`, `scripts/deploy.mjs`, and tests.
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
  implemented. The Gatekeeper includes safe first-admin bootstrap, one-time Human invitations,
  Membership lifecycle writes, and a sandboxed responsive management UI.
- PostgreSQL 17 integration verification applies migrations twice using a non-superuser owner, then
  proves tenant RLS isolation and Chronicle immutability. The same checks run in CI.
- Role/Space editors and governed Knowledge/Ask Guild are implemented. Knowledge includes immutable
  versions, human approval, multilingual content, R2 files, acknowledgement, retirement, citations,
  SQL-before-model authorization, rate limiting, and durable file cleanup.
- Governed Work is implemented from Goal through Project, Quest, and Step. It includes bounded
  keyset lists, SQL-before-service authorization, legal status transitions, optimistic versions,
  hierarchical Space containment, active Human/Agent assignment, Inbox notification writes,
  Chronicle evidence, and responsive browser flows.
- Governed Decisions are implemented with bounded SQL-prefiltered reads, draft versioning,
  immutable proposals, Constitution-defined human quorum, evidence references, dissent,
  security-boundary-preserving supersession, Inbox fan-out, Chronicle evidence, and responsive
  browser flows.
- Inbox/Announcement/Chronicle screens and Agent write workflows are not yet implemented.
- No Cloudflare resources have been created or deployed.

## Next sequence

1. Add Inbox, Announcement, and Chronicle product flows.
2. Add one Level 2 Agent write workflow with durable approval,
   idempotency, limits, and a kill switch.
3. Verify the complete owner-to-agent demo before production deployment.
