# ADR 0042: Safe in-place legacy upgrades

## Status

Accepted, 2026-08-24.

## Context

Early owner-controlled deployments used one PostgreSQL Runtime login as both schema owner and
application credential. ADR 0039 correctly separated management and Runtime for new installations,
but an existing deployment could not satisfy that boundary without hand-written production SQL.
The deployment tool also required every Secret value again during an update, even though Cloudflare
can preserve an existing Secret binding when deploying a new Worker Version.

Both gaps encourage unsafe workarounds: granting DDL to Runtime, putting a provider credential in
Hyperdrive, reading an existing Secret, or rotating a shared Webhook secret merely to update code.

## Decision

Provide one explicit `db:separate-legacy-roles` operation. A provider administrator supplies the
existing Runtime role and a separately created non-privileged management login. The operation
fails when either target role is privileged, the migration ledger is absent, a Guild OS object has
an unexpected owner, or Runtime owns anything outside the bounded Guild OS schemas, current
database, default privileges, and required extensions. It transfers ownership and restores
least-privilege Runtime grants in one transaction. The normal migration preflight and production
verifier remain mandatory afterward.

Provide `deploy -- --preserve-existing-secrets` for an in-place update. Before any Worker is changed,
the deployer lists binding names for every configured Worker and proves that all generated
`secrets.required` names already exist. No Secret value is read or written in this mode. First
deployment and intentional rotation continue to use restricted temporary Secret files.

The pre-deploy provider snapshot, active-release backup, exact migration prefix, clean Git commit,
Worker Version annotations, authenticated smoke, and rollback evidence remain release gates.

## Alternatives

Keeping a privileged Runtime role was rejected because forced RLS does not remove its DDL authority.
Hand-maintained ownership SQL was rejected because it is not testable or repeatable. Automatic
Secret rotation was rejected because it changes a shared external trust boundary without need.
Reading Secret values back is unavailable by design and would weaken custody.

## Risks and rollback

Ownership transfer can briefly affect grants if executed piecemeal, so the transfer, Runtime grants,
default privileges, and temporary role memberships share one transaction. Unexpected ownership
fails before `BEGIN`. Rollback is the transaction itself, followed by the provider snapshot if a
later migration must be abandoned.

Existing-Secret deployment depends on Cloudflare retaining bindings across Versions. The tool
checks every required name before any deploy and Wrangler validates `secrets.required`; a missing
binding stops the release. Rollback uses the recorded prior Worker Version IDs and does not rotate
the preserved Secret.
