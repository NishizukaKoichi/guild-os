# ADR 0010: Governed Agent execution

- Status: Accepted
- Date: 2026-08-12

## Context

Guild OS must let a Cloudflare OS Agent perform at least one real external write without making the
model, browser, Durable Object, or Workflow the source of authority. A write can be duplicated by
retries, outlive a Human approval, race a Kill Switch, or continue after the requester or Agent has
lost Guild access. Runtime-provided URLs would also create an SSRF boundary.

## Decision

- PostgreSQL is the system of record for the immutable plan, authority snapshots, approval votes,
  execution state, usage, result, transactional outbox, and Chronicle.
- Cloudflare Workflows coordinates approval waits and execution. Workflow events are hints; every
  continuation reloads durable PostgreSQL state before acting.
- v1 exposes one deployment-owned HTTPS Webhook Connector. Its credential-free URL and secret
  reference are immutable database values provisioned from deployment configuration. Runtime input
  cannot select an arbitrary URL.
- A Cloudflare OS action approval opens the Guild approval request. It does not bypass the
  Constitution quorum. Only active Humans with `agent.approve` inside the exact resource boundary
  can cast append-only votes.
- Effective execution authority is rechecked at planning and immediately before delivery as the
  intersection of Agent, requester, Workflow, and Connector permissions. Current limits are
  intersected with the immutable run snapshot, so a later reduction takes effect immediately.
- The Worker makes one outbound delivery attempt with an HMAC signature, bounded timeout,
  redirect refusal, and an idempotency key. Automatic HTTP retries are disabled because a generic
  receiver cannot provide exactly-once semantics.
- Creating, signaling, and terminating Workflows uses a transactional PostgreSQL outbox. Exhausted
  dispatch retries fail the corresponding run and append Chronicle evidence atomically.
- Kill and Identity offboarding change PostgreSQL state first, expire pending approval, cancel
  pending start/signal messages, enqueue Workflow termination, and append Chronicle evidence in the
  same transaction. If an already-started HTTP request is accepted after Kill, the run remains
  `killed` and a deduplicated `agent.run.delivery_after_kill` event records the race.
- Cloudflare OS discovery returns only permission-filtered runnable Agents, Spaces, and Connectors.
  Catalog metadata grants no authority; execution performs the full checks again.

## Alternatives considered

- **Execute inside the Gatekeeper request:** rejected because approval waits, failure recovery, and
  cancellation need durable orchestration.
- **Let the model supply a URL:** rejected because it creates SSRF and credential-exfiltration risk.
- **Retry failed HTTP writes automatically:** rejected because a lost response can duplicate an
  irreversible effect. Receivers must persist the idempotency key.
- **Store run state only in Durable Objects:** rejected because relational authorization, audit,
  backup, and recovery require PostgreSQL as the authoritative record.

## Consequences

The receiver must implement signature verification and durable idempotency. Kill cannot retract an
HTTP request already accepted by a remote system, so compensating operations remain connector
specific. A new Connector ID and deployment is required to change the destination or rotate its
immutable configuration. Rollback consists of disabling the Connector, killing active runs,
rolling the Workers back, and retaining PostgreSQL/Chronicle records for audit.
