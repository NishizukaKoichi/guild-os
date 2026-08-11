# ADR 0002: PostgreSQL is the Guild system of record

- Status: Accepted
- Date: 2026-08-12

## Context

Guild membership, permissions, work, decisions, agent approvals, and audit events require relational
constraints and atomic multi-record changes. Cloudflare OS itself uses Durable Objects, KV, and R2,
but those stores should not become a second undocumented authority for Guild governance.

## Decision

Store canonical Guild state in purchaser-owned PostgreSQL and connect from Workers through
Hyperdrive using the Cloudflare-recommended `pg` driver. Every repository operation runs inside a
transaction that sets a transaction-local `app.guild_id`. PostgreSQL row-level security repeats the
application Guild boundary as defense in depth. The repository constructor accepts an opaque
transaction-scoped connection type, so normal TypeScript callers cannot construct it before the
transaction helper sets that boundary.

Chronicle rows are append-only. A business mutation, its Chronicle event, and any external-action
outbox entry commit in one transaction.

## Alternatives considered

- D1: simpler Cloudflare-only provisioning, but it weakens database portability and differs from
  the accepted PostgreSQL system-of-record architecture.
- Durable Object storage: appropriate for coordination and live state, but not the canonical
  relational model spanning governance, knowledge, work, and decisions.
- Direct PostgreSQL without Hyperdrive: portable but gives up Cloudflare-managed connection pooling
  and global query acceleration.

## Consequences

- A deployment needs a PostgreSQL database and Hyperdrive configuration in addition to Cloudflare
  OS's existing resources.
- Local integration tests need a PostgreSQL connection string; pure domain and transaction-boundary
  tests remain runnable without one.
- `pg` and `@types/pg` are added to the wrapper-owned persistence package.

## Risks and rollback

RLS depends on all application queries entering through the transaction helper. Tests assert query
ordering, and application code must not receive a raw connection. Roll back code and migrations only
before a migration reaches production; after production adoption, use a reviewed forward migration
that preserves Chronicle history.
