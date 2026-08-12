# ADR 0022: Keep the Gatekeeper sandbox closed and bridge form submission

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Cloudflare OS hosts Gatekeeper applications in an opaque-origin iframe with `allow-scripts` and
`allow-modals`, but deliberately without `allow-forms`. This prevents browser-native form
submission. Guild OS forms use React `onSubmit` handlers for RPC mutations, so an ordinary submit
button was blocked by the browser before React received the event in the production sandbox.

## Decision

Guild OS installs one capture-phase form-submit bridge inside its own bundled application. A
trusted left-click on an enabled submit control, or Enter in a single-line input, performs native
constraint validation and dispatches a cancellable `SubmitEvent` to the owning form. Existing React
handlers remain the only place that constructs or sends RPC mutations.

The Cloudflare OS iframe keeps its existing sandbox. We do not add `allow-forms` or
`allow-same-origin`, and the embedded application still has no network access. Browser E2E tests
mount the production single-file bundle inside the same form-restricted sandbox and cover mouse and
keyboard submission.

## Alternatives

- Add `allow-forms` to Cloudflare OS: rejected because it weakens an upstream security boundary and
  would require a private upstream modification.
- Replace every form with an unrelated button handler: rejected because it duplicates validation,
  harms keyboard semantics, and creates inconsistent extension patterns.

## Risks and rollback

Future form controls must use native submit controls so they inherit the bridge. The bridge does not
handle Enter in textareas because that key must remain available for multiline input. Roll back by
reverting this ADR and the bridge only if Cloudflare OS later exposes a reviewed native form-submit
capability and the sandbox E2E is updated first.
