# ADR 0019: Verify database TLS at the client and server boundary

## Status

Accepted, 2026-08-12.

## Context

The production database preflight originally relied only on `pg_stat_ssl`. Managed PostgreSQL
proxies can terminate TLS before forwarding the connection to the database backend. Neon does
this, so the backend reports `ssl = false` even though the application-to-proxy connection is a
certificate-authorized TLS socket.

## Decision

Accept TLS evidence when either PostgreSQL reports SSL for the backend connection or
`node-postgres` exposes a socket with both `encrypted === true` and `authorized === true`.
Encryption without successful certificate authorization remains a production failure.

## Alternatives

Using only `pg_stat_ssl` rejects valid managed-proxy deployments. Trusting only URL parameters
would accept configurations that did not establish a verified TLS connection.

## Risks and rollback

This depends on the documented Node `TLSSocket` security state exposed through the current
`node-postgres` client. If that client shape changes, preflight fails closed. Roll back this commit
and require a provider whose backend reports TLS if client-side evidence can no longer be read.
