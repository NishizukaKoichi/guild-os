# ADR 0013: Use offline one-time codes for Break Glass ownership recovery

- Status: Accepted
- Date: 2026-08-12

## Context

The normal Root ownership transfer requires two active Humans. That is the correct daily handover
path, but it cannot recover a Guild when the current Root and every administrator are unavailable.
The product is purchaser-owned, so recovery also cannot depend on a seller account, seller API,
license server, or manually edited production row.

## Decision

- The active human Root generates ten independent 192-bit recovery codes in Settings. Plaintext is
  returned to that browser once; PostgreSQL stores only SHA-256 hashes and six-character hints.
- A code set names the global Role retained by the previous Root, a reason, an expiry of 7 to 730
  days, and a monotonically increasing generation. Creating a replacement immediately invalidates
  every older set, even when its unused hashes remain in append-only history.
- The purchaser stores plaintext codes offline in separate trusted custody. Codes are not included
  in repository files, Cloudflare variables, logs, Chronicle, database exports, or support systems.
- An authenticated active Human may recover with one current code. An authenticated Cloudflare OS
  account with no Guild Identity may also recover and becomes an active restricted Human. Existing
  disabled, suspended, departed, Agent, and Service identities are rejected with the same generic
  response as an invalid code.
- Recovery requires the exact Guild name, a reason, and a per-account rate limit. The current Root
  cannot use the procedure as a no-op.
- One PostgreSQL transaction consumes the selected code, invalidates its whole generation, changes
  Root ownership, grants the configured Role to the previous Root, supersedes every pending normal
  transfer, and appends mandatory Chronicle evidence. Deferred constraints reject partial or
  unaudited completion.
- Accepting a normal two-party Root transfer invalidates the current recovery-code generation in
  the same transaction and records that revocation. The new Root must create a new custody set;
  codes retained by the previous Root can never undo a completed handover.
- Chronicle records the actor, reason, categories of information viewed, and changes made. It never
  records the plaintext code or hash.
- Code sets, code payloads, and completed recovery records are append-only. The Root can revoke the
  current generation but cannot reactivate a historical one.

## Alternatives considered

- **Seller-operated recovery:** rejected because purchaser operation must survive the seller's
  absence and account closure.
- **Email reset link:** rejected because Guild authorization is bound to a Cloudflare OS account
  capability, and email delivery creates another external recovery dependency.
- **Database-console Root edit:** rejected because it bypasses Human eligibility, outgoing Role,
  invalidation, and Chronicle evidence.
- **Reusable recovery password:** rejected because compromise would remain useful indefinitely and
  use could not invalidate every sibling credential atomically.

## Consequences

Offline custody becomes an explicit purchaser responsibility. Losing every plaintext code while no
Root remains available requires restoring purchaser-controlled infrastructure and is not solvable by
the seller. Restoring an older database backup may restore an older active generation pointer; keep
Access restricted during restore and rotate codes immediately before reopening the Guild.

Migration `0024` is forward-only. Roll back application code by restoring a prior Worker version,
but correct schema behavior with a reviewed forward migration rather than editing or deleting the
recovery history.
