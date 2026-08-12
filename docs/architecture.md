# Guild OS Architecture

## Product boundary

Guild OS is the organizational layer. Cloudflare OS is the agent and user-program runtime beneath
it. The two layers communicate through explicit capabilities rather than shared ambient authority.

```text
Human
  -> Cloudflare Access
  -> Cloudflare OS Workshop
  -> Guild Gatekeeper
  -> Guild Policy Engine
  -> PostgreSQL through Hyperdrive
  -> R2 / derived search indexes

Agent or Gadget
  -> resource-scoped Gatekeeper capability
  -> requester + agent + workflow + connector policy intersection
  -> observation authorization or queued action approval
  -> domain transaction + Chronicle event
```

## Ownership model

One deployment is one Guild. This makes the Cloudflare account and database a hard tenant boundary,
not merely an application filter. A Guild may contain hierarchical Spaces. Cross-Guild exchange is
later implemented as an explicit, revocable federation connector.

Opening the application is read-only. Before the Guild exists, the account-bound management API
returns a minimal `initialize` state. Only a trusted Workshop administrator can submit the explicit
initialization command, and PostgreSQL serializes contenders with a Guild-scoped advisory lock.
After initialization, bootstrap responses are split into `access` and `member` shapes. Unknown,
invited-but-unclaimed, suspended, and departed accounts do not receive Root Owner, Constitution,
ownership-transfer, or Agent policy metadata.

## Canonical Collective substrate

The persisted core is deliberately smaller than any one organization type:

```text
Guild
|- Actors and Guild-scoped Memberships
|- Spaces
|- Roles and Capabilities
|- Memory
|- Activity
|- Decisions and Conversations
|- Connections and Runs
|- Events
`- Templates and Vocabulary Profiles
```

An Actor is a global subject of kind `human`, `agent`, `service`, or `guild`. A Membership places
that Actor inside a Guild with neutral state, clearance, operational status, Roles, and Space
scope. Human, Agent, Service, and Guild profiles extend the same Actor; they do not create parallel
member systems. A separate active Human Custodian remains mandatory for platform recovery and
irreversible governance, but Company ownership is not a core Role.

Memory stores broad durable context and may have no governance workflow. The Canonical Knowledge
workflow is one governed Memory view. Activity is recursive and typed; it does not require a fixed
Goal -> Project -> Quest -> Step depth and may be assigned to any active operational Actor. The
effect of an assignment is still constrained by that Actor's Capability, Space, Connection, risk,
and approval policy.

Templates configure initial Roles, vocabulary, Memory and Activity types, decision methods,
workflows, dashboard intentions, and a suggested Agent. They do not branch the database schema or
authorization semantics. Blank is the default. A Space can select a different Vocabulary Profile,
so multiple operating cultures can coexist inside one Guild.

## Packages

| Package | Responsibility |
| --- | --- |
| `cloudflare-os/` | Pinned upstream Workshop, agents, Gadgets, Blueprints, and built-in Gatekeepers |
| `packages/guild-domain` | Types, validation, permissions, lifecycle invariants, and commands |
| `packages/guild-postgres` | SQL repositories, migrations, transactional Chronicle, and outbox |
| `packages/guild-gatekeeper` | Agent/Gadget capability boundary, management API, and management UI |

The current Guild management surface is bundled inside `guild-gatekeeper`. A separate API or console
package will be introduced only if the supported Gatekeeper UI boundary becomes insufficient. Empty
architectural placeholders are not created.

Management responsibilities stay separated inside those packages: domain validation and permission
delegation are framework independent; PostgreSQL administration owns Role, Space, Actor, and
Membership transactions; the Gatekeeper validates transport input and authorizes each operation;
React pages and dialogs only call typed management methods. Adding a later module does not require
placing its conditions in a central page or a shared untyped data client.

Constitution governance follows the same boundary. `guild-domain/governance.ts` defines valid
policy and Root-only Role invariants; `guild-postgres/governance.ts` owns optimistic versioning and
the atomic Chronicle write; `guild-gatekeeper/management-api.ts` authenticates the current Root
Owner and validates transport input; `ConstitutionManager.tsx` is presentation only. PostgreSQL
also requires a transaction-local Root actor and rejects deletion, delegated update authority,
invalid limits, or a version that does not advance exactly once.

Root ownership transfer is a separate governance transaction, not a Role operation. The current
Root creates an immutable, expiring proposal for one active Human and selects the global Role that
will remain after handover. The named Human accepts from a different account session. PostgreSQL
changes the Root, grants the outgoing Role, resolves the proposal, sends the private notification,
and records Chronicle evidence atomically. Deferred constraints reject a transfer mutation without
its matching event and reject a direct Root update that did not finish an accepted proposal.

Break Glass is isolated in `guild-postgres/recovery.ts`, typed through the management contract, and
rendered by `RecoveryManager.tsx`. The Worker generates plaintext codes and returns them once; the
repository accepts hashes only. A versioned PostgreSQL pointer selects the sole current generation.
Recovery creates or validates one active Human, replaces Root, preserves the prior Root's Role,
supersedes pending transfers, consumes one code, invalidates the generation, and writes Chronicle
in one transaction. Database triggers recognize exactly one Root-change path: accepted two-party
transfer or completed Break Glass recovery. A normal transfer also invalidates the previous Root's
current recovery generation atomically before the ownership change can commit.

The fixed Work hierarchy is a compatibility workflow. `guild-domain/work.ts` owns lifecycle validation,
`guild-postgres/work.ts` owns bounded queries and atomic mutations, `guild-gatekeeper/work-service.ts`
owns request validation plus authorization, and the Work page owns presentation state only. Goal,
Project, Quest, and Step use exact-version optimistic concurrency. PostgreSQL independently prevents
parent reassignment, Space-scope broadening, invalid transitions, and nonmaterial version bumps.
Assignments in that compatibility workflow remain limited to active Humans and Agents. New neutral
Activity uses `guild-domain/collective.ts`, `guild-postgres/collective.ts`, and
`guild-gatekeeper/collective-service.ts`; it supports arbitrary recursive depth and any active
operational Actor assignee without weakening execution policy.

Decisions follow the same module boundary. `guild-domain/decision.ts` owns content, lifecycle, and
review validation; `guild-postgres/decision.ts` owns permission-prefiltered keyset reads and atomic
proposal, review, and supersession transactions; `guild-gatekeeper/decision-service.ts` validates
transport input and repeats domain authorization; the Decisions page owns presentation only.
Proposal freezes content, evidence, options, and the authorization boundary. Only authorized active
Humans can review, and approval requires the Constitution quorum to converge on one option.
Notifications are inserted with one set-based query rather than one application call per approver.

Communications follow the same module boundary. `guild-domain/announcement.ts` owns Announcement
content and lifecycle validation; `guild-postgres/announcement.ts`, `inbox.ts`, and
`chronicle-query.ts` own permission-prefiltered keyset reads and atomic writes;
`guild-gatekeeper/communication-service.ts` validates transport input and repeats domain
authorization; the Inbox and Chronicle pages own presentation state only. Announcement publication
freezes the audience, inserts recipient notifications with one deduplicated SQL statement, and
records Chronicle evidence in the same transaction. Inbox and Chronicle rows retain the source
security boundary but always require the reader's current Membership, Role, Space, and clearance.

Contextual Conversations use `guild-domain/conversation.ts`, `guild-postgres/conversation.ts`, and
`guild-gatekeeper/conversation-service.ts`. One thread is bound to one governed record and inherits
that record's current authorization boundary. PostgreSQL filters the subject before returning a
message body, validates all Human mentions in one query, and pairs posting or moderation with an
exact Chronicle event. `CommentsPanel.tsx` is reusable presentation attached to Knowledge, Quest,
and Decision views; the service contract also supports Goals, Projects, Steps, Announcements, and
Agent Runs without adding a central condition-heavy chat module.

Agent execution follows the same boundary. `guild-domain/agent.ts` validates plans, transitions,
JSON bounds, usage, and limit intersection; `guild-postgres/agent-run.ts` owns immutable plans,
append-only votes, authority snapshots, run state, Chronicle, and the transactional Workflow
outbox; `guild-gatekeeper/agent-service.ts` performs plan-time and execution-time authorization;
`agent-workflow.ts` coordinates durable waits and one external attempt; `agent-webhook.ts` owns the
fixed signed transport; and the Agent page owns presentation only. Cloudflare OS action approval and
Guild quorum are separate gates. Workflow events never substitute for PostgreSQL state.

The optional `packages/webhook-receiver` Worker is intentionally outside the Gatekeeper process so
the v1 action crosses a real HTTPS boundary. It authenticates exact request bytes and delegates each
Guild/idempotency-key pair to its own SQLite-backed Durable Object. This removes a single-Guild
serialization bottleneck while making duplicate claims strongly consistent. Deployments can replace
that module with another owned receiver without changing Agent policy or Run state.

## Source-of-truth rules

- PostgreSQL owns Guild, Constitution, Actors, Guild Memberships, Spaces, Roles, Capabilities,
  Memory and versions, Activity, Decisions, Conversations, Connections, Runs, Events, and Template
  settings. Legacy Identity, Knowledge, and fixed Work tables are temporary compatibility sources
  mirrored into that substrate.
- R2 owns immutable file bodies addressed by checksums. PostgreSQL stores their metadata and links.
- Vectorize or `pgvector` is a rebuildable search index. Search results are filtered by authorized
  Guild, Space, visibility, classification, and lifecycle state before model context construction.
- Durable Objects coordinate live sessions, collaborative state, run leases, and idempotency. They
  do not become an undocumented second system of record.
- Workflows coordinate long-running runs and approval waits. Domain state changes still commit
  through the Guild API and produce Chronicle events.

## Request authorization

Every operation receives an actor identity and an immutable request context. The policy engine
checks membership state, Space scope, role grants, resource visibility, and operation risk.

For an Agent operation, the requester may be a Human or another active Agent:

```text
effective authority =
  agent grants
  intersection requester grants
  intersection workflow grants
  intersection connector capability
```

Every Agent in a delegation chain must remain active and independently authorized. Human-only
Custodianship, Role/Capability changes, approval, recovery, and Kill authority never become
delegable merely because an Agent is a Member.

The frontend may hide unavailable commands for usability, but backend authorization remains the
enforcement point.

## Transaction and audit rule

A material mutation and its Chronicle record are written in one PostgreSQL transaction. External
side effects use an idempotency key and a transactional outbox entry. A worker executes the outbox
only after the required approval is durable, then records the result as a new event. Existing
Chronicle rows are never updated to rewrite history.

## Upgrade rule

The `cloudflare-os` gitlink is part of every release. Advancing it requires reviewing authentication,
Gatekeeper, sandbox, sharing, model-context, storage, and deployment changes, followed by the full
local test matrix. Production upgrades never track an unpinned branch.
