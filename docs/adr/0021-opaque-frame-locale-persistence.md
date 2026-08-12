# ADR 0021: Opaque-frame locale persistence

## Status

Accepted

## Context

Cloudflare OS intentionally renders Gatekeeper management applications in a sandboxed iframe
without `allow-same-origin`. Browsers deny `localStorage` access to that opaque origin. Direct
storage access during React initialization therefore prevented the entire Guild interface from
rendering.

## Decision

Treat browser locale storage as an optional cache. Catch both property-access and read/write
failures, default safely to English, and continue rendering. Once Guild bootstrap data is available,
use its `preferredLocale` as the authoritative value. Language changes in the persistent member UI
are written through the Guild API as well as to browser storage when available.

## Alternatives

Adding `allow-same-origin` to the host iframe was rejected because it weakens the upstream sandbox
boundary. Removing locale persistence was rejected because the preference is part of the member
profile and must survive a new browser session.

## Risks and rollback

A failed API write can leave the current frame showing a locale that is not retained. The next
bootstrap restores the last authoritative preference. Rollback is limited to the locale adapter and
does not require changing Cloudflare OS or stored Guild data.
