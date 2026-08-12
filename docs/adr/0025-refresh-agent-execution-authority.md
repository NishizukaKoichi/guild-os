# ADR 0025: Refresh Agent execution authority after directory changes

Date: 2026-08-12

## Context

The Agents page loaded the Identity directory and Agent execution page independently. Stopping an
Agent refreshed its Membership row, but the execution panel retained its previous runnable-Agent
snapshot until a manual refresh. PostgreSQL still rejected execution after the stop, but the stale
button and selection misrepresented current authority.

## Decision

Any directory change reloads the Agent execution page and closes an open planning dialog. While
that reload is pending, runnable candidates already known to be inactive in the directory are
removed locally. The development API derives runnable candidates from the same active Identity,
Membership, and Agent-profile state used by production. The UI also explains when no valid
Agent-Space-Connector combination remains.

## Alternatives

- Rely only on execution-time rejection: rejected because disabled controls must reflect current
  authority even though the server remains the final enforcement point.
- Poll continuously: rejected because lifecycle mutations already provide a precise refresh event.

## Risk and rollback

Directory changes now cause one additional bounded execution-page read. Roll back this ADR and the
associated panel effect if that read becomes materially expensive, but retain server-side
execution-time authorization and replace the refresh with an explicit invalidation channel.
