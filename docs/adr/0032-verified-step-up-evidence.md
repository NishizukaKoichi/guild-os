# ADR 0032: High-Risk Actions Use Verified Authentication Evidence

Date: 2026-08-14

## Status

Accepted

## Context

Emergency private-message access and Level 3 Agent approvals require recent Human
reauthentication. The management UI previously supplied its own current timestamp. That proved
only when the browser created a request, not when the identity provider authenticated the Human.
A modified client could therefore manufacture the evidence.

Cloudflare Access already verifies the identity session and exposes its login event through the
Access identity endpoint. The `iat` on an application JWT cannot be used directly because Access
may refresh that token from an older global SSO session. The Guild Gatekeeper is opened through the
Workshop, so the verified login event must cross that capability boundary explicitly.

## Decision

The purchaser-owned Cloudflare OS dependency exposes a nullable `verifiedAuthenticatedAt` value in
`AppUiContext`. After verifying the application JWT, the Workshop uses that same token to retrieve
the Access identity record, matches it to the verified email, and derives the evidence from the
identity record's login timestamp. Bearer/session-token authentication and failed identity lookups
supply `null` because possession or issuance of an application token does not prove recent Human
reauthentication.

Guild OS ignores timestamps supplied by its iframe. Emergency private access and Level 3 Agent
approval use only the server-provided evidence and reject missing, stale, or future timestamps.
The Cloudflare OS source is pinned to the purchaser-owned fork so the exact dependency commit is
fetchable by clean builds without depending on an unpushable local submodule commit.

## Alternatives Considered

- Trust the browser timestamp. Rejected because it is not authentication evidence.
- Add a seller-operated reauthentication service. Rejected because it violates purchaser
  sovereignty and creates an external availability dependency.
- Build a separate password or TOTP system inside Guild OS. Rejected because it duplicates the
  configured identity provider and increases credential custody.

## Risks And Rollback

Cloudflare OS updates must be merged into the purchaser fork until the context field is available
upstream. The fork keeps `cloudflare/cloudflare-os` as `upstream` and contains a small isolated
commit. Rollback is to pin the prior upstream commit and disable Level 3 and emergency private
access; falling back to a client timestamp is not an acceptable rollback.
