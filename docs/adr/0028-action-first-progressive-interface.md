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
  A partial read failure is reported as unavailable and retryable; it must never be rendered as an
  all-clear result. Attention rows open the exact current handling surface and move keyboard focus
  to it.
- First-owner setup appears only while required foundations remain incomplete. Its steps link to
  shared Knowledge, a Human invitation, an Agent, and offline recovery codes.
- Navigation has two stable levels. Home, Ask, template-specific Members, Memory, and Activity are
  always primary because they are the everyday collective loop. Decisions, Canonical Memory,
  Structured Work, Inbox, Messages, Lifecycle, Contributions, Context, Chronicle, and Settings are
  disclosed under More. Operations appears there only when the current membership has a management
  capability.
  Settings remains readable by active members so Constitution and governance are transparent, while
  editing remains protected by API permissions and PostgreSQL RLS.
- The mobile interface keeps Home, Ask, Members, Memory, Activity, and More in a stable six-item
  bottom bar. Labels are template-specific and constrained without horizontal scrolling. The full
  sidebar becomes inaccessible while closed so keyboard and assistive-technology users do not
  encounter duplicate controls. The same compact navigation applies at 820px and below so tablet
  widths do not compress the fixed sidebar, global action, and language controls into an
  overflowing header.
- Every permitted page has a non-sensitive hash route. Browser Back, Forward, reload, and direct
  links therefore behave like navigation without putting free text, invitation credentials, or
  approval payloads in the route. Unknown or unavailable destinations recover to Home.
- A visible Search or create control and `Command/Control + K` open one permission-aware action
  menu. It can open permitted destinations, Ask, Memory creation, Activity creation, and Inbox.
- Existing dialogs share one accessibility lifecycle: initial focus, contained Tab order, Escape
  cancellation when safe, background scroll protection, and focus return. Dirty creation forms
  require an explicit discard choice, while consequential authority and external-effect checks
  remain in their governed confirmation surfaces.
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
actions. Home performs bounded reads in parallel and preserves successful regions when another
region fails. If a future aggregate endpoint is added, it must preserve the same permission
filtering and partial-failure semantics before replacing those calls.

Regression coverage lives in `packages/guild-gatekeeper/e2e/usability.spec.ts` and
`packages/guild-gatekeeper/e2e/experience-quality.spec.ts`, alongside the full governance
workflows. The experience suite checks route history, direct links, action distance, role filtering,
focus, draft protection, partial failures, invitation handoff, five viewports, three locales, and
critical/serious axe violations. Rollback is a normal Git revert of this ADR and the corresponding
app-shell, Home, access, initialization, shared state, style, and E2E changes; no schema or stored
data changed.
