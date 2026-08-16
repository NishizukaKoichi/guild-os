# ADR 0038: Separate commercial distribution from the Apache core

- Status: Accepted
- Date: 2026-08-16

## Context

Guild OS is intended to be sold as purchaser-owned software rather than operated as a seller-funded
multi-tenant SaaS. Purchasers must be able to keep an installed release running in their own
Cloudflare, PostgreSQL, model, domain, and storage accounts without seller infrastructure or ongoing
support.

The current repository descends from the Cloudflare OS deployment starter, contains contributions
from Cloudflare authors, includes a modified Apache-licensed Cloudflare OS submodule, and has an
Apache License 2.0 at its root. Later Guild OS code was added inside that same licensed history.
Replacing the root license or declaring selected current directories proprietary would create an
unclear and potentially invalid boundary.

## Decision

Keep the current `guild-os` repository as the Apache-2.0 runtime core and purchaser-owned deployment
tooling. Do not add runtime license enforcement, seller-funded provider credentials, purchaser data,
or proprietary-only source to this repository.

Create future commercial distribution material only in a separate private repository after its
license, contributor policy, and third-party treatment receive qualified legal review. That
repository may package independently authored installation, update-delivery, Blueprint, educational,
and brand assets around immutable Guild OS core releases. Any Apache component included in a paid
bundle retains its license and notices.

An update entitlement may control access to future downloads, but it cannot disable an installed
release, block export or recovery, or become a runtime dependency. Optional support remains a
separate bounded offer and is not required for normal operation.

The exact boundary and release gate are recorded in
[Licensing and distribution](../licensing-and-distribution.md). Direct third-party foundations are
recorded in [Third-Party Notices](../../THIRD_PARTY_NOTICES.md).

## Alternatives considered

- **Replace the current root license with a proprietary license:** rejected because existing Apache
  history, external contributions, the starter foundation, and the submodule make a blanket change
  unsafe without rights analysis and legal review.
- **Keep everything Apache and sell mandatory implementation support:** rejected as the default model
  because it makes revenue depend on continuing seller labor and weakens the self-service product
  goal.
- **Host every purchaser in a seller Cloudflare account:** rejected because seller costs and liability
  scale with purchaser usage and the deployment no longer remains independently owned.

## Consequences

- Existing and future core changes made in this repository remain under its recorded Apache terms.
- The commercial product sells a tested owned distribution, independently authored product assets,
  and optional access to future releases; it cannot claim exclusive rights over Apache components.
- The commercial and core repositories need explicit versioned contracts and separate credentials,
  build outputs, issue intake, and release manifests.
- Public commercial release remains gated on provenance inventory, notices, trademark review, final
  license text, and contributor-rights review by qualified counsel.
- Purchaser infrastructure and AI consumption are billed directly to the purchaser.

## Risks and rollback

Commercial assets may accidentally derive from or copy Apache files, or a bundle may omit required
notices. Prevent this with separate repositories, source manifests, exact release inventories, and
review of every cross-boundary import. If provenance is unclear, stop the commercial bundle and ship
only the reviewed Apache core. Never roll back by removing attribution or attempting to withdraw
rights from an already distributed Apache version.
