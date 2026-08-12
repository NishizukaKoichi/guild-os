# ADR 0028: Use an action-first, progressively disclosed interface

## Status

Accepted

## Context

Guild OS v1 exposed every major domain area as an equally weighted sidebar destination. The layout
was operationally complete, but a new member had to understand Knowledge, Work, Decisions, People,
Agents, Chronicle, Roles, and Spaces before knowing what to do. Home described security and data
boundaries instead of helping the person take a useful first action. Mobile repeated the desktop
drawer without persistent access to the few actions used every day.

The underlying governance model must remain explicit where a person reviews scope, authority, or an
external effect. Simplifying the entry experience must not turn navigation visibility into an
authorization boundary or remove evidence from sensitive operations.

## Decision

- Home starts from four plain-language intentions: ask a question, save knowledge, plan work, and
  review updates. It also reads existing permission-filtered APIs to show unread items, work
  assigned to the current Human, and Agent approvals without introducing a broader data endpoint.
- First-owner setup appears only while required foundations remain incomplete. Its steps link to
  shared Knowledge, a Human invitation, an Agent, and offline recovery codes.
- Navigation has three levels. Home, Ask, and Inbox are always primary. Knowledge, Work, and
  Decisions are a disclosed workspace. Team, AI Agents, Activity, and Settings are under More.
  Preboarding members see their workspace immediately; ordinary members do not see management
  destinations they cannot use.
- The mobile interface keeps Home, Ask, Inbox, and More in a stable four-item bottom bar. The full
  sidebar becomes inaccessible while closed so keyboard and assistive-technology users do not
  encounter duplicate controls.
- Empty collections explain the outcome and expose one permitted next action. Ask offers reusable
  example questions instead of an instructional paragraph alone.
- Entry copy uses plain language. Exact lifecycle, permission, classification, and approval terms
  remain visible in the detailed surfaces where they affect a governed action.
- Navigation visibility remains presentation only. Every API, PostgreSQL RLS rule, approval rule,
  and Chronicle boundary remains authoritative and unchanged.

## Alternatives considered

- A one-time product tour was rejected because it teaches the old information architecture and is
  easy to skip or forget.
- Removing Knowledge and Work from non-administrators was rejected because members still need their
  authorized material and assignments. Progressive disclosure preserves access without clutter.
- Replacing governed terms everywhere was rejected because approval screens must state the exact
  state and consequence a Human is authorizing.

## Consequences

The first screen is useful without training, while advanced administration remains reachable in two
actions. Home performs four bounded reads in parallel and treats an unavailable area as absent
rather than failing the whole screen. If a future aggregate endpoint is added, it must preserve the
same permission filtering before replacing those calls.

Regression coverage lives in `packages/guild-gatekeeper/e2e/usability.spec.ts`, alongside the full
governance workflows. Rollback is a normal Git revert of this ADR and the corresponding app-shell,
Home, empty-state, copy, style, and E2E changes; no schema or stored data changed.
