# ADR 0005: Enforce identity administration at domain, API, and database boundaries

Status: Accepted

## Decision

Expose Human, Agent, and Service administration through typed Gatekeeper operations backed by
transactional PostgreSQL repositories. Keep Role and Space management in the same authorization
boundary, but isolate their validation, persistence, and UI components.

An administrator can delegate only permissions that they hold globally. Break Glass is never a
Role permission. Agent and Service identities cannot receive human-only permissions. PostgreSQL
constraint triggers repeat the application invariants for Role contents, Space topology, immutable
Identity kinds, Agent profile ownership and limits, and active Agent Membership pairing.

Every material change and its Chronicle event commit in one Guild-scoped transaction. Suspending or
departing a machine Identity also revokes its Connector secrets and unfinished Agent runs in that
transaction.

## Why

UI-only controls and application-only validation leave direct SQL, future modules, and accidental
API changes able to manufacture privilege escalation or orphaned identities. A typed management
surface remains understandable to purchasers and AI development tools while database constraints
preserve critical invariants across every caller.

## Alternatives considered

- Encode administration only in React: rejected because hidden buttons do not authorize requests.
- Rely only on Gatekeeper checks: rejected because migrations, maintenance scripts, and future
  services also write canonical data.
- Use a generic policy DSL: deferred because it adds an unfamiliar framework before the fixed v1
  Role and Space model requires one.

## Risks and rollback

Deferred PostgreSQL triggers make bulk imports stricter and require complete Identity,
Membership, and profile tuples by transaction commit. Importers must use a transaction and produce
a valid final state. Application behavior can roll back to the previous Worker version, but applied
migrations are immutable; database rollback uses a reviewed forward migration that preserves
Chronicle history and never weakens existing tenant isolation.
