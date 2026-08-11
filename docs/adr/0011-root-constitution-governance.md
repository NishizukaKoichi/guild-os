# ADR 0011: Keep Constitution authority with the human Root Owner

- Status: Accepted
- Date: 2026-08-12

## Context

The Constitution controls approval quorum, data retention, and default Agent limits. Treating
`constitution.update` as an ordinary Role permission would let an administrator delegate the power
that bounds administrators and Agents. Concurrent edits could also silently overwrite a newer
policy, while an unaudited edit would make later Decisions and Agent approvals difficult to explain.

## Decision

- `constitution.update` and `break-glass.use` are Root-only authorities. They cannot be stored in a
  Role, including the built-in Admin Role.
- The current active human Root Owner is the only Identity allowed to update the Constitution.
  Gatekeeper authorization, the repository, and PostgreSQL each enforce this independently.
- Every update requires the expected Constitution version and increments it exactly once. A stale
  editor must reload instead of overwriting a newer policy.
- Every update requires a nonblank reason. The policy mutation and its `constitution.updated`
  Chronicle event commit in one transaction.
- PostgreSQL checks the transaction-local actor, Root identity, active Human and Membership state,
  version increment, quorum ordering, bounded quorum and retention values, and Agent-limit shape.
  Constitution deletion and Guild reassignment are rejected.
- Migration `0022_constitution_governance.sql` removes historical delegated update grants. A Role
  whose only grant was `constitution.update` receives `constitution.read` first so the upgrade does
  not create an invalid empty Role.

## Alternatives considered

- **Allow Admins to update the Constitution:** rejected because the governed Role hierarchy could
  rewrite its own governing limits.
- **Protect only the Settings button:** rejected because direct RPC and future service paths would
  remain authorized.
- **Last-write-wins updates:** rejected because two valid Root sessions could erase each other's
  policy decisions without evidence.

## Consequences

Routine administrators can read policy but cannot change it. Root absence therefore requires an
explicit ownership transfer or the separately audited Break Glass recovery path; ordinary Role
assignment is not a substitute. An application rollback can restore the prior UI and API, but the
database constraint is rolled back only through a new reviewed forward migration. Existing
Constitution versions and Chronicle evidence are retained.
