# ADR 0034: Pin the patched Nano ID build dependency

Date: 2026-08-14

## Decision

The root workspace overrides vulnerable `nanoid` versions below `3.3.18` with `3.3.18`.

## Why

The frozen build and test graph resolved `postcss` through Vite to `nanoid 3.3.17`. That release is
affected by GHSA-2v37-7h3g-55p8 and caused the required high-severity dependency gate to fail.
The override applies the smallest patched release without changing application behavior or replacing
the existing Vite toolchain.

## Alternatives considered

Upgrading every Vite consumer and the vendored Cloudflare OS packages together would create a much
larger compatibility surface. Ignoring a development-path advisory would weaken the release gate.

## Risk and rollback

The risk is limited to build-tool compatibility and is covered by the full build and upstream test
suite. Remove the override after every direct dependency naturally resolves to a patched version;
reinstall dependencies and require a clean high-severity audit before committing that rollback.
