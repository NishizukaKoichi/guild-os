# ADR 0001: Build Guild OS on a pinned Cloudflare OS foundation

- Status: Accepted
- Date: 2026-08-12

## Context

Guild OS needs a secure agent workspace, isolated user-created applications, controlled access to
external systems, human approval, and auditability. Cloudflare OS already implements these runtime
capabilities and is published under Apache-2.0, but its August 2026 release is explicitly early
access and changes rapidly.

## Decision

Use `cloudflare/cloudflare-os-starter` as the deployment wrapper and retain
`cloudflare/cloudflare-os` as a commit-pinned submodule.

Guild-specific code belongs in wrapper-owned packages and communicates with Cloudflare OS through
service bindings and Gatekeeper contracts. Direct upstream changes are allowed only when a required
product behavior cannot be expressed across those boundaries. Such a change must be isolated in a
reviewable fork commit before release.

One deployment owns one Guild. The purchaser owns the Cloudflare account, PostgreSQL database,
domain, model credentials, R2 data, and deployment history.

## Alternatives considered

- Rebuild the agent runtime directly on Workers: rejected because it duplicates Cloudflare OS's
  isolation, approval, collaboration, and application-generation mechanisms.
- Modify the Cloudflare OS submodule in place: rejected because the resulting commit would not be
  fetchable by purchasers and upgrades would be difficult to audit.
- Operate all purchasers in one seller-owned multi-tenant service: rejected because it conflicts
  with self-ownership and creates permanent seller dependency.

## Consequences

- Upstream upgrades are deliberate: pin, review trust-boundary changes, test, then advance.
- Product-specific navigation may eventually require a small maintained upstream fork. It is not
  introduced until the supported Gatekeeper UI has been proven insufficient.
- PostgreSQL and Hyperdrive are additional purchaser-owned infrastructure beyond the current
  Starter defaults.
- Apache-2.0 notices and Cloudflare trademark boundaries must be preserved in distributed builds.

## Risks and rollback

Cloudflare OS is early access, so interfaces may change. Roll back by restoring the previous
submodule gitlink and redeploying the previously verified Worker versions. Guild migrations must be
forward-compatible or paired with an explicit database rollback procedure.

