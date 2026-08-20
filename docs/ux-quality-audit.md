# Guild OS UX quality audit

## Audit baseline

- Audited commit: `0e63675fd58f9ffd5248a53073368dbee527e2ca`
- Date: 2026-08-20
- Runtime: Node.js 24.12.0, pnpm 11.9.0, Chromium through Playwright 1.62.1
- Modes reviewed: `root`, `member`, `uninitialized-admin`, `uninitialized-member`,
  `uninvited`, `suspended`, and `departed`
- Viewports reviewed: 1440 x 1000, 1280 x 800, 768 x 1024, 390 x 844, and
  320 x 568
- Baseline validation: gatekeeper typecheck passed; 171 gatekeeper unit/app tests passed;
  all 59 existing E2E tests passed
- Review evidence: ignored screenshots and browser observations are stored under
  `packages/guild-gatekeeper/.ux-review/before/`

The audit used the checked-out implementation, rendered standalone application, and current tests
as the source of truth. It found no baseline console errors or unintended horizontal overflow at
the five required viewports. Passing tests did not cover several interaction defects below.

## Product experience principles

**Visual thesis.** Guild OS is a quiet operational workspace. Orientation, one clear action, readable
hierarchy, and explicit state take priority over decoration. Surfaces remain mostly flat and use
dividers, restrained green emphasis, and compact controls instead of gradients, glass effects,
oversized hero content, or nested cards.

**Content plan.** Every signed-in screen provides stable orientation, one global find-or-act entry,
a page purpose, and one dominant next action. Home begins with the four user intentions: ask,
remember, start, and review. Workspace and governance concepts are disclosed only when needed.

**Interaction thesis.** Navigation behaves like navigation: it has stable URLs, supports Back and
Forward, and restores a directly linked permitted page. `Command/Control + K` opens the same
find-or-act entry available by pointer or touch. Dialogs place focus inside, contain keyboard focus,
close safely with Escape, and return focus to their trigger. Motion is brief and optional.

## Findings and acceptance

### UX-01: In-app navigation has no browser history

- **Target user:** Every signed-in member
- **Screen:** Entire signed-in application
- **Goal:** Move between Home, Ask, Inbox, and work areas, then return or share a permitted page
- **Observed confusion:** Home to Ask did not change the URL or `history.length`. Browser Back left
  the application for `about:blank` rather than returning Home. Reload always returned Home.
- **Cause:** `App.tsx` stores the current page only in component state.
- **Severity:** Critical
- **Fix:** Add a small hash-history router that stores only non-sensitive page identifiers, validates
  permitted destinations, supports direct links, and keeps iframe/standalone query parameters intact.
- **Done when:** Back, Forward, reload, and direct links preserve permitted page navigation; unknown
  or unavailable routes recover to Home without exposing sensitive input in the URL.
- **Automated test:** `experience-quality.spec.ts` history, reload, and direct-route cases.

### UX-02: Navigation rules disagree across ADR, implementation, and tests

- **Target user:** New members and mobile users
- **Screen:** Desktop sidebar and mobile bottom navigation
- **Goal:** Find daily actions without learning the internal data model
- **Observed confusion:** ADR 0028 specifies Home, Ask, Inbox and a four-item mobile bar. The app
  instead promotes Members, template-specific Memory, and Activity, while Inbox is under More. The
  test named “four-item” asserts five buttons.
- **Cause:** The implementation evolved without updating the accepted information architecture.
- **Severity:** High
- **Fix:** Make Home, Ask, and Inbox the stable daily destinations; use Home, Ask, Inbox, More on
  mobile; group work and administration inside the disclosed navigation; update ADR and tests.
- **Done when:** Code, ADR, acceptance contract, and E2E assert the same labels, grouping, and four
  mobile destinations in all three languages.
- **Automated test:** Updated `usability.spec.ts` and `experience-quality.spec.ts` role/mobile cases.

### UX-03: There is no global find-or-act entry

- **Target user:** Returning members and keyboard users
- **Screen:** Every signed-in page
- **Goal:** Open an allowed page, ask, save Memory, start Activity, or review Inbox without retracing
  navigation
- **Observed confusion:** The only universal controls are the navigation drawer and language menu.
  Fast creation depends on first returning Home or knowing the destination page.
- **Cause:** Navigation and creation actions are implemented separately on each page.
- **Severity:** High
- **Fix:** Add one visible top-bar entry and `Command/Control + K`, populated from the same
  permission-aware destination and action registry as navigation.
- **Done when:** It filters allowed destinations, invokes ask/remember/start/review, supports full
  keyboard operation, closes with Escape, and returns focus to the opener.
- **Automated test:** Global-entry keyboard, filtering, role visibility, action, focus, and Escape cases.

### UX-04: Modal dialogs do not manage focus or Escape

- **Target user:** Keyboard and assistive-technology users
- **Screen:** Memory and Activity creation, plus shared modal surfaces
- **Goal:** Complete or cancel a focused task without interacting with the obscured page
- **Observed confusion:** Opening either creation dialog left focus on the button behind the dialog.
  Escape did not close it. Focus was not trapped or returned.
- **Cause:** Dialog markup has `aria-modal`, but no shared focus lifecycle or keyboard behavior.
- **Severity:** Critical
- **Fix:** Install one reusable dialog accessibility boundary for existing modal conventions: initial
  focus, Tab containment, Escape-to-cancel, background scroll protection, and focus restoration.
- **Done when:** All tested dialogs satisfy the focus lifecycle without weakening confirmation or
  authority checks.
- **Automated test:** Dialog initial focus, Tab loop, Escape, and focus-return cases plus axe scans.

### UX-05: Home can claim everything is clear when overview APIs failed

- **Target user:** Every signed-in member
- **Screen:** Home, “Needs your attention”
- **Goal:** Know whether there is nothing to do or whether the system could not check
- **Observed confusion:** Rejected overview calls produce `null` values, then the empty attention
  array renders “all caught up.” A connection or permission failure can therefore look like success.
- **Cause:** Partial failure is represented as absent data without a visible unavailable state.
- **Severity:** Critical
- **Fix:** Track failed regions, keep successful regions usable, show what could not be checked, and
  provide a bounded retry without failing Home.
- **Done when:** A failed source never produces a false clear state and retry does not erase the rest
  of Home.
- **Automated test:** Deterministic partial-failure fixture and Home recovery case.

### UX-06: Home attention destinations are not always the item being described

- **Target user:** Root Owners and reviewers
- **Screen:** Home attention list
- **Goal:** Open the approval, Agent run, or risk that needs action
- **Observed confusion:** Approval and Agent-run rows open the broad Members page rather than the
  relevant run/review surface.
- **Cause:** Home counts were added before precise destination mapping was established.
- **Severity:** High
- **Fix:** Route attention rows to the closest current operational surface and label the expected
  destination; do not display a row that is visible but unusable.
- **Done when:** Each row opens a screen where the named item can be processed.
- **Automated test:** Home attention destination cases for Root and ordinary member modes.

### UX-07: Invitation joining depends on manually handling an opaque token

- **Target user:** Invited Human
- **Screen:** Join this Guild
- **Goal:** Understand the invitation and join safely
- **Observed confusion:** The user must paste a 43-character token and is not told how expiry,
  prior use, or invalidity differs, nor exactly what to ask an administrator for.
- **Cause:** The access form exposes the raw credential workflow without a safe link handoff.
- **Severity:** High
- **Fix:** Accept a one-time token from the URL fragment, prefill it, immediately remove it from
  browser history, preserve one-time binding, and provide actionable invalid/expired/used guidance.
- **Done when:** A valid fragment prefill requires no copy/paste; the token is scrubbed; failures keep
  the display name and tell the user how to request a replacement invitation.
- **Automated test:** Prefill/scrub, invalid claim/focus, inactive membership, and successful join cases.

### UX-08: Initialization does not protect unsaved progress or foreground the creation summary

- **Target user:** First Root Owner
- **Screen:** Template, purpose builder, review, and owner confirmation
- **Goal:** Create a place while understanding what will exist and the meaning of Root ownership
- **Observed confusion:** In-screen Back keeps state, but browser navigation can discard it silently.
  On mobile, “what this creates” is initially hidden. The final screen emphasizes profile counts more
  than participants, Memory, Activity, decision method, Roles, and bounded Agent authority.
- **Cause:** The flow is a good profile selector but lacks navigation protection and a single
  plain-language creation receipt before the consequential confirmation.
- **Severity:** High
- **Fix:** Keep template-derived defaults, disclose optional details, show a plain-language creation
  summary, warn before leaving dirty setup state, validate inline, and focus the first invalid field.
- **Done when:** Only template, purpose, display name, and Root acceptance are required in the common
  flow; Back preserves values; leaving warns; mobile and keyboard setup complete end to end.
- **Automated test:** Updated initialization E2E across desktop/mobile/sandbox and three languages.

### UX-09: Loading, failure, and disabled states are inconsistent

- **Target user:** Every member, especially on slow or unreliable connections
- **Screen:** Collection pages and forms
- **Goal:** Predict whether an operation started, succeeded, can be retried, or is unavailable
- **Observed confusion:** Some pages use an inline spinner, some replace the entire region, some keep
  stale data, and disabled buttons generally do not explain why. Internal errors can be shown without
  a consistent recovery action.
- **Cause:** Each page implements state feedback independently.
- **Severity:** High
- **Fix:** Strengthen shared Notice, loading, EmptyState, and form-state conventions; preserve current
  content during refresh; announce async results; prevent duplicate submits; focus actionable errors.
- **Done when:** Tested primary journeys expose pending/success/error, preserve input on failure, and
  offer retry or administrator guidance where applicable.
- **Automated test:** Double-submit, validation focus, empty state, partial failure, and live-region cases.

### UX-10: Touch and modal layouts do not meet one consistent interaction target

- **Target user:** Mobile and motor-impaired users
- **Screen:** Global controls, navigation, dialogs, and row actions
- **Goal:** Operate the same model at 320 and 390 pixels without accidental taps or hidden controls
- **Observed confusion:** Common buttons are 36 to 42 pixels tall, below the intended 44-pixel target.
  Mobile dialogs are scrollable but their action placement and keyboard-safe visibility are not
  covered by tests.
- **Cause:** Component dimensions evolved per page.
- **Severity:** High
- **Fix:** Set shared interactive minimums, use four mobile tabs with safe-area padding, make dialog
  headers/actions stable on small screens, and test keyboard/touch viewports.
- **Done when:** Required viewports have no unintended horizontal overflow, primary targets are about
  44 pixels, and mobile creation/Plan/Act remain operable with the virtual keyboard area constrained.
- **Automated test:** Viewport matrix, bounding-box target checks, overflow, and mobile journey cases.

### UX-11: Accessibility regressions are not a release gate

- **Target user:** Keyboard and assistive-technology users
- **Screen:** Main modes and primary workflows
- **Goal:** Receive correct names, structure, focus, and asynchronous state
- **Observed confusion:** Existing E2E checks rendering and selected keyboard behavior but does not run
  an accessibility engine. Dialog defects passed all 59 tests.
- **Cause:** No axe integration or explicit critical/serious violation gate.
- **Severity:** Critical
- **Fix:** Add compatible axe Playwright checks and explicit keyboard/focus assertions for primary
  modes and pages.
- **Done when:** Critical and serious axe violations are zero on the tested routes; keyboard-only
  journeys, landmarks, live regions, dialog focus, and drawer visibility are deterministic.
- **Automated test:** `experience-quality.spec.ts` accessibility and keyboard sections.

### UX-12: The current tests certify a narrower experience than their names imply

- **Target user:** Maintainers and future development agents
- **Screen:** Release process
- **Goal:** Trust a green test run as evidence of the promised UX
- **Observed confusion:** The “four-item” mobile test expects five items; there are no assertions for
  history, direct links, global action entry, dialog focus, partial failure, or accessibility scans.
- **Cause:** Acceptance language and executable checks drifted apart.
- **Severity:** Critical
- **Fix:** Update existing tests instead of deleting them, add an objective experience-quality suite,
  and align ADR 0028 and `docs/full-spec-acceptance.md` with executable behavior.
- **Done when:** A green release run directly proves the navigation, operation-distance, responsive,
  multilingual, error, security-boundary, and accessibility claims.
- **Automated test:** The complete updated gatekeeper E2E suite and repository release gates.

## Security and governance boundary

All fixes in this audit are presentation and client-navigation changes over existing permission-
filtered APIs. Navigation visibility remains advisory. PostgreSQL RLS, Role/Space permissions,
approval quorum, Plan inspection, one-at-a-time Act confirmation, iframe/MessageChannel isolation,
`form-submit-bridge`, sandbox file selection, and Chronicle evidence remain authoritative.

No sensitive free text, invitation credential, approval payload, or recovery material may be added
to a route. Undo is added only where the backing operation is semantically reversible.

## Resolution and evidence

All twelve findings were addressed in the application rather than accepted as documentation-only
debt. No database schema, RLS policy, API authorization, approval quorum, Chronicle contract,
Cloudflare OS bridge, or sandbox boundary was weakened.

| Finding | Implemented result | Executable evidence |
| --- | --- | --- |
| UX-01 | Added validated hash navigation for permitted pages, with Back, Forward, reload, direct link, and safe Home fallback | `experience-quality.spec.ts`: linkable destinations and predictable browser history |
| UX-02 | Made Home, Ask, and Inbox primary; Workspace and More progressively disclose the remaining surfaces; mobile has exactly Home, Ask, Inbox, More | Updated `usability.spec.ts`, `navigation.ts`, and role/mobile experience cases |
| UX-03 | Added a visible permission-filtered Search or create entry with `Command/Control + K` | Global action filtering, invocation, Escape, and focus-return cases |
| UX-04 | Added one shared dialog focus manager and mobile drawer focus boundary | Dialog and drawer keyboard cases plus axe scans |
| UX-05 | Preserved successful Home regions, named failed sources, and added bounded retry | Deterministic `partial-failure` fixture and recovery case |
| UX-06 | Unread work opens Inbox; Agent approval, progress, and risk rows open and focus the Execution runs surface in one action | Exact-attention-surface E2E |
| UX-07 | Issued invitations use a one-time fragment link; the joining screen reads and immediately scrubs the token, then gives specific recovery guidance | Valid/invalid invitation and inactive-membership E2E |
| UX-08 | Common setup derives safe defaults, retains in-flow values, protects dirty navigation, explains the created structure, and requires explicit Root acceptance | Initialization desktop/mobile/keyboard/sandbox and three-language E2E |
| UX-09 | Shared Notice semantics announce state; primary create operations validate inline, focus errors, lock synchronously against double submit, confirm success, and preserve recoverable input | Validation, single-flight, success, empty, and partial-failure cases |
| UX-10 | Shared controls use a 44px minimum, mobile navigation respects safe areas, and dialogs remain bounded at 320px | Target-size and five-viewport overflow cases |
| UX-11 | Added `@axe-core/playwright`; critical and serious violations are release failures on primary, access, initialization, and dialog surfaces | Two automated axe cases in `experience-quality.spec.ts` |
| UX-12 | Added an objective experience suite without removing existing workflows; CI already runs the full gatekeeper E2E suite | 71 browser tests after implementation, including existing governance and sandbox regressions |

### Browser evidence

- Before: `packages/guild-gatekeeper/.ux-review/before/`
- After: `packages/guild-gatekeeper/.ux-review/after/`
- Each directory contains 35 full-page captures: seven user states at 1440 x 1000, 1280 x 800,
  768 x 1024, 390 x 844, and 320 x 568.
- Each directory contains `audit.json` with rendered heading, document width, viewport width, and
  captured console/page errors. The final capture reports no unintended horizontal overflow and no
  console or page errors across all 35 combinations.
- The final evidence also includes `command-menu-1440x1000.png`,
  `memory-dialog-390x844.png`, `initialization-review-390x844.png`, and
  `mobile-navigation-390x844.png` for the open interaction states.

The final browser journeys additionally cover Ask with citations, citation navigation, Ask to Plan,
one-at-a-time Act, Memory and Activity creation, Inbox handling, invitation acceptance, Root setup,
partial failure recovery, keyboard-only dialogs and navigation, all three locales, and Cloudflare OS
sandbox initialization and native file selection. These are interaction assertions, not screenshot
comparisons.

## Final local validation

Validation was repeated against the final working tree on 2026-08-20:

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile and supply-chain policy accepted |
| Gatekeeper `types:check` | Passed, including the single-file application build |
| Gatekeeper `test` | 171 passed |
| Gatekeeper `test:e2e` | 71 passed in Chromium |
| Repository `types:check` | Passed |
| Repository `test` | Passed; 311 executed tests passed, 71 PostgreSQL integration tests skipped because no local integration database was configured and this change does not alter the backend contract |
| Repository `build` | Passed; final single-file application is 1,183.46 kB, 280.13 kB gzip |
| Repository `lint` | Passed |
| `audit:dependencies` | Passed; no known high-or-higher vulnerability |
| `peers:check` | Passed; no peer dependency issue |
| `test:cloudflare-os` | Passed; 491 executed tests passed, four database-backed integration tests skipped |
| Browser capture audit | 35 final captures; zero horizontal-overflow, console-error, or page-error findings |

No production deployment or production data operation was performed. This audit certifies the local
UX implementation and regression evidence only; the repository production release gate still
requires its separately authorized deployment, CI, backup, and authenticated production smoke.
