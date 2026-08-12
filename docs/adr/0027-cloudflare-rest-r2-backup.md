# ADR 0027: Cloudflare REST R2 and forced-RLS backup

## Status

Accepted

## Context

The first recovery implementation required `rclone` plus a separately generated R2 S3 access key.
That is a sound bulk-transfer path, but it adds local software, long-lived credentials, and manual
configuration to every purchaser deployment. Cloudflare's current REST API supports cursor-based
R2 [object listing](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/)
and [object download](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/get/)
using an ordinary scoped Cloudflare API token.

Access configuration has a separate permission boundary. A token that can deploy Workers and read
KV/R2 may not be allowed to read Access applications and policies.

PostgreSQL forced RLS creates a second recovery constraint. PostgreSQL's
[`pg_dump` documentation](https://www.postgresql.org/docs/current/app-pgdump.html) states that
`--enable-row-security` can export the rows visible to the configured Guild, while `COPY FROM`
cannot restore through row security. A custom-format archive therefore does not provide the
required non-bypass restore path.

## Decision

- Backups use the Cloudflare REST API as the default R2 export path. The script reads every cursor
  page, validates keys and metadata, downloads with bounded concurrency, verifies size and ETag,
  hashes each local object, and compares the complete inventory before and after export.
- Object keys must map safely and uniquely onto a case-insensitive backup filesystem. Unsafe path
  segments and Unicode/case collisions fail the backup instead of silently overwriting data.
- `rclone` remains an explicit optional path for large stores via `--r2-remote`.
- Access is still exported directly when the token has Access read permission. A separately
  reviewed `--access-snapshot` is accepted when that permission is intentionally split; its
  audience must match deployment configuration and secret-like keys are rejected recursively.
- PostgreSQL is exported as plain SQL with column-name `INSERT`s, `row_security=on`, and the Guild
  UUID in `app.guild_id`. Connection fields are passed as bounded libpq environment variables so a
  complete credential URL is not exposed in process arguments. Restore uses `psql` in one
  transaction with the same Guild UUID.

## Consequences

Small purchaser deployments can create complete R2 backups with one scoped Cloudflare token and no
S3 credentials. Large deployments retain a proven parallel bulk-transfer option. Access cannot be
silently omitted: operators either grant read-only API scope or supply a validated non-secret
snapshot. Rollback is to pass an existing `rclone` remote and omit `--access-snapshot`.
The SQL dump is larger and slower than a custom archive, but it is restorable without granting the
application role `BYPASSRLS`; this security property takes precedence for the one-Guild deployment
model.
