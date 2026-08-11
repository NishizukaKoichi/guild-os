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

## Packages

| Package | Responsibility |
| --- | --- |
| `cloudflare-os/` | Pinned upstream Workshop, agents, Gadgets, Blueprints, and built-in Gatekeepers |
| `packages/guild-domain` | Types, validation, permissions, lifecycle invariants, and commands |
| `packages/guild-postgres` | SQL repository and transactional Chronicle outbox |
| `packages/guild-gatekeeper` | Agent/Gadget capability boundary and approval integration |

The current Guild management surface is bundled inside `guild-gatekeeper`. A separate API or console
package will be introduced only if the supported Gatekeeper UI boundary becomes insufficient. Empty
architectural placeholders are not created.

## Source-of-truth rules

- PostgreSQL owns Guild, Constitution, Spaces, Identities, Memberships, Roles, grants, Knowledge
  metadata and versions, Work, Decisions, Agent policies, Agent runs, and Chronicle events.
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

For an agent operation:

```text
effective authority =
  agent grants
  intersection requester grants
  intersection workflow grants
  intersection connector capability
```

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
