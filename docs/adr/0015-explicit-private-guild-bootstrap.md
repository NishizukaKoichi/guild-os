# ADR 0015: Explicit and private Guild bootstrap

## Status

Accepted

## Context

Cloudflare OS creates an opaque account capability for each authenticated Workshop user. Earlier
Guild OS code initialized PostgreSQL as a side effect of opening the Guild application for the
first Workshop administrator. That made ownership depend on navigation timing and made a read-only
page load perform the most important governance mutation in a deployment.

The original bootstrap response also reused the member-shaped object for accounts that were not
Guild members. Even though later data operations were authorized, this exposed Root Owner and
Constitution metadata before invitation acceptance.

## Decision

- Opening Guild is read-only. An uninitialized deployment returns an `initialize` screen state.
- Only the administrator assertion supplied by the Cloudflare OS Workshop can enable the
  initialization command. A browser-provided administrator flag is never accepted.
- Initialization requires a Root display name, preferred locale, and an exact typed copy of the
  configured Guild name.
- PostgreSQL takes a Guild-scoped advisory transaction lock before checking and creating the Guild.
  Concurrent administrators therefore produce exactly one Root Owner; every loser is denied.
- Bootstrap responses are a discriminated union: `initialize`, `access`, or `member`.
- An initialized account without a usable Membership receives only the configured Guild display
  fields, its own account and Membership state, locale, and a masked Break Glass availability
  status. It does not receive Root identity, ownership-transfer, Constitution, or Agent defaults.
- Invitations remain the only normal path from an authenticated Workshop account to a Guild
  Membership. There is no shared bootstrap password or seller-controlled bypass.

## Consequences

The purchaser must keep the Cloudflare Access Allow policy and Workshop administrator list limited
to the intended first human owner until initialization succeeds. Initialization is deliberate and
auditable, while unknown and inactive accounts cannot use the bootstrap read to inventory internal
governance metadata.

Rollback is a code rollback only before initialization. After the Guild exists, ownership must be
changed through the governed two-party transfer or Break Glass process; operators must not delete
or rewrite the bootstrap rows.
