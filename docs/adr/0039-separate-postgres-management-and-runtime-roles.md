# ADR 0039: Separate PostgreSQL management and Runtime roles

## Status

Accepted, 2026-08-21.

## Context

Schema migration needs ownership and DDL authority, while Guild OS Runtime needs broad application
table DML behind forced RLS. A single connection role makes it possible for a managed-provider
owner capability or future DDL grant to reach every Worker through Hyperdrive.

## Decision

Use two purchaser-owned login roles. Operators use a non-superuser management role for migrations,
preflight, backup, and recovery. Hyperdrive and all integration tests use a separate Runtime role
without superuser, `BYPASSRLS`, role/database creation, replication, or schema-creation authority.
The Runtime role receives application-table DML, sequence use, governed-function execution, and
read-only migration-ledger access. `db:provision-runtime` applies these grants transactionally;
`db:verify` inspects both roles before deployment. Deployment credentials are removed from child
processes and never become Worker bindings.

## Alternatives

One schema-owner role is simpler but gives Runtime unnecessary DDL and managed-provider authority.
Per-table hand-maintained grants drift as additive migrations create tables and functions. A
database proxy alone does not remove PostgreSQL privileges from the credential it carries.

## Risks and rollback

New migrations must remain owned by the management role so its default privileges reach Runtime.
If provisioning fails, no Worker is deployed; correct the role at the provider and rerun the
idempotent command. Rollback is to point Hyperdrive at the prior verified Runtime credential, not
to grant schema ownership to Runtime.
