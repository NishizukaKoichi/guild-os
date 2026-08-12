# ADR 0026: Use a native Knowledge file-control activation surface

Date: 2026-08-12

## Context

The Knowledge upload control rendered a button whose click handler invoked `input.click()` on a
visually hidden file input. That indirection can lose trusted user activation inside a sandboxed
Gatekeeper iframe or browser automation environment, leaving the file chooser unopened even though
the upload service and R2 binding are healthy.

## Decision

The styled Upload control now contains a native file input positioned across the complete visible
control. Pointer and keyboard activation therefore target the browser file control directly. The
existing `File` validation, bounded byte conversion, governed API call, PostgreSQL metadata, R2
verification, and input reset remain unchanged.

The browser test opens the real file chooser from the accessible Upload control before attaching
its synthetic file, so future regressions cannot pass by calling `setInputFiles` on a hidden input.

## Alternatives

- Keep the programmatic `input.click()` bridge: rejected because it depends on user-activation
  propagation across the sandbox boundary.
- Add a custom upload endpoint outside the Gatekeeper RPC: rejected because it would duplicate
  authorization and weaken the single governed write path.

## Risk and rollback

The transparent native input must continue to cover only the Upload control. Visual and mobile E2E
tests guard layout and accessibility. Rollback is the prior button implementation, but only after a
replacement proves trusted file-chooser activation in the deployed sandbox.
