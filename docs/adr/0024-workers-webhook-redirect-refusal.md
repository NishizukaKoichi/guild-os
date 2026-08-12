# ADR 0024: Refuse Webhook redirects with Workers-compatible manual handling

**Status:** Accepted  
**Date:** 2026-08-12

## Context

The governed Agent Webhook sender used the browser Fetch value `redirect: "error"` to prevent an
approved request from being forwarded to a different destination. Cloudflare Workers rejects that
value before issuing the request because the edge runtime implements only `follow` and `manual`.

## Decision

Webhook delivery uses `redirect: "manual"` and accepts only HTTP 2xx responses. Every 3xx response
is rejected explicitly, so the Worker never follows an unapproved location while remaining
compatible with the production runtime. The receiver endpoint is still immutable deployment
configuration, HTTPS-only, credential-free, and rechecked when a run is claimed.

A unit regression verifies both the Workers-compatible request option and explicit 3xx rejection.
The complete approved production Workflow is rerun after deployment.

## Alternatives

- Follow redirects: rejected because approval applies to the configured endpoint, not a destination
  selected later by a remote response.
- Keep `redirect: "error"`: rejected because Cloudflare Workers fails before network delivery.

## Risks and rollback

Some legitimate third-party endpoints use redirects. Purchasers must configure their final HTTPS
endpoint directly; this is intentional. Roll back only by reverting this ADR and sender change
together after confirming a replacement still prevents cross-origin redirection.
