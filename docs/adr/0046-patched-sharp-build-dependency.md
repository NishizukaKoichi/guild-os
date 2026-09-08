# ADR 0046: Patch the transitive image-processing dependency

Date: 2026-09-09

## Decision

Resolve all sharp versions below 0.35.4 to 0.35.4 in the root workspace. Keep the
existing Wrangler, Miniflare, application packages and Cloudflare OS source pin.

## Evidence

The required fresh release audit rejected the previously accepted lockfile after
GHSA-rgj7-g3m4-5g8c entered the advisory database on 2026-09-08. The upstream fix is
sharp 0.35.4 with patched bundled libheif. The vulnerable dependency is used by
the local Worker toolchain; this does not establish exploitation of the deployed
Worker. Source: https://github.com/advisories/GHSA-rgj7-g3m4-5g8c

## Alternatives and risk

Ignoring development dependencies would weaken the release gate. Updating every
Cloudflare tool is unnecessary for this fix. A patch override preserves the
current tool versions; regenerated peer-resolution keys in the lockfile are
package-manager output, not intentional framework upgrades.

## Verification and rollback

Require the high-severity audit, full Core and Cloudflare OS suites, typecheck,
build, Worker dry-run and browser tests. Preserve exact-release evidence outside
Git. No database migration, data deletion, authentication change or password is
required by this dependency update.

Remove the override only once all consumers resolve a patched version naturally.
Do not restore the known-vulnerable dependency to fix an unrelated build failure;
inspect compatibility and choose another patched version instead.
