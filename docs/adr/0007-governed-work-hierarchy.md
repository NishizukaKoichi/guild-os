# ADR 0007: Governed Work Hierarchy

Status: Accepted

Date: 2026-08-12

## Decision

PostgreSQL is the source of truth for Goal, Project, Quest, and Step. The hierarchy is fixed as
Goal -> Project -> Quest -> Step for v1. Each parent reference and creator is immutable, child Space
scope must remain inside its parent, status changes follow explicit transition maps, and every
material update increments an exact optimistic version. Database triggers enforce these rules even
when a caller bypasses the TypeScript service.

List queries apply active Membership, Role, Space ancestry, classification, visibility, ownership,
and explicit sharing before rows leave PostgreSQL. The Gatekeeper repeats domain authorization
before returning a projection or accepting a mutation. Lists use bounded keyset pagination rather
than unbounded reads or offset scans.

Only an active Human or an active Agent profile may receive a Quest or Step. The target must also
have `work.read` authority for that resource. Service identities cannot be assigned. A successful
assignment writes its Inbox notification and append-only Chronicle event in the same transaction as
the Work version update. Parent completion or cancellation is rejected while nonterminal children
remain.

## Alternatives considered

- A generic polymorphic `work_items` tree was rejected for v1 because it weakens foreign keys,
  lifecycle-specific constraints, and the readability expected by purchasers and coding agents.
- Frontend-only transition and assignment checks were rejected because direct RPC or database
  access would bypass them.
- Offset pagination and loading the entire Guild graph were rejected because response time and
  memory would grow with historical Work volume.

## Risks and rollback

Four tables create some repeated repository code, but keep each lifecycle and relationship explicit.
If later templates need arbitrary depth, introduce a reviewed projection or migration rather than
silently changing these contracts. The Work navigation and Gatekeeper methods can be rolled back to
the previous Worker version without deleting records. Migration `0011` is append-only and must never
be edited after application; corrections require a later migration.
