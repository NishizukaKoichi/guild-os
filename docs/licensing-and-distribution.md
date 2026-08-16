# Licensing and Distribution

Updated: 2026-08-16

## Status

This document defines the technical and product boundary selected for future Guild OS sales. It is
not a commercial license and is not legal advice. A qualified open-source licensing professional
must review the final commercial terms, contributor rights, notices, trademarks, and shipped
artifact set before any public commercial release.

The current repository remains Apache-2.0. Do not replace [the existing license](../LICENSE), add a
contradictory proprietary header, or represent this checkout as closed source without that review.

## Product promise

Guild OS uses a purchaser-owned deployment model:

- one deployment represents one independently owned Guild;
- the purchaser owns the Cloudflare account, PostgreSQL database, model-provider accounts, domain,
  credentials, data, backups, and deployment history;
- the installed release does not call a seller API or license server to keep operating;
- the purchaser pays Cloudflare, database, model, domain, and other provider charges directly;
- expiry of an update entitlement must not disable an installed release or block data export;
- paid support is optional and is not required for ordinary operation, recovery, or migration.

This avoids a seller-funded multi-tenant runtime and avoids making the seller permanently responsible
for every purchaser's infrastructure or AI usage.

## Current legal and provenance boundary

The current tree contains three relevant classes of material:

| Class | Current treatment | Evidence |
| --- | --- | --- |
| Cloudflare OS starter history | Apache-2.0 foundation retained and modified in this repository | Git history through `93f14df`, root `LICENSE` |
| Cloudflare OS fork | Commit-pinned Apache-2.0 submodule with two Guild OS security changes | `cloudflare-os/`, its `LICENSE`, pinned gitlink |
| Guild OS additions in this tree | Distributed as part of this Apache-2.0 repository | Root `LICENSE`, repository history |

Authorship and license are separate questions. Koichi-authored files may be identifiable in Git, but
their inclusion in this repository does not create a proprietary boundary. Existing Apache grants
must be treated as continuing for versions already distributed under those terms. See
[Third-Party Notices](../THIRD_PARTY_NOTICES.md) for the direct provenance snapshot.

## Target repository topology

Future commercial distribution work must use separate repositories and credentials:

```text
guild-os
  Apache-2.0 runtime core and purchaser-owned deployment tooling
  No purchaser data, commercial entitlement logic, or seller runtime dependency

guild-os-distribution
  Separate private product repository, not yet created
  Seller-authored installer shell, signed release catalog, independently authored Blueprint packs,
  product documentation, brand assets, and download/update delivery
  Final license is counsel-reviewed before content is offered

purchaser-instance
  Purchaser-owned private configuration and operations record
  Cloudflare, PostgreSQL, models, domain, Secrets, backups, release evidence, and local extensions

guild-os-demo
  Seller-owned disposable demonstration only
  Synthetic data, hard budgets, no purchaser production data
```

The current `guild-os` repository does not become proprietary merely because a separate commercial
distribution repository exists. Any Apache source or object copied into a paid bundle remains
subject to Apache requirements and ships with its license and notices.

## Allowed commercial layer

The separate distribution product may contain newly authored, separable assets such as:

- a self-service installation experience that orchestrates documented core interfaces;
- signed release metadata and a purchaser-verifiable update catalog;
- independently authored Blueprint catalogs, examples, prompts, guides, and training material;
- Guild OS brand assets and marketplace presentation material;
- download entitlement and update-delivery automation that is not required at runtime;
- optional, explicitly scoped support or partner-service materials.

Do not copy an existing Apache installer, module, Blueprint, document, or modified core file into the
commercial repository and relabel it as proprietary. When a new component links to or aggregates
the core, record the interface and obtain legal review before deciding its license. Technical
separation is necessary for a clean boundary but does not by itself decide copyright status.

## Runtime and update contract

The recommended commercial offer is an owned release, not a hosted SaaS tenancy:

1. A purchaser obtains one tested release and deploys it into purchaser-owned accounts.
2. The installed version remains usable without an active seller account or subscription.
3. An optional time-bounded update entitlement grants access to newer tested releases and migration
   material; expiry affects new downloads only.
4. Update installation runs in place against purchaser-owned infrastructure after backup, dry-run,
   migration validation, deployment, smoke test, and rollback preparation.
5. Provider usage never flows through seller-funded Cloudflare, database, or model credentials.
6. Optional Care is a separate, bounded service or partner offering. It is not part of the core
   operating dependency and must not be promised as unlimited custom work.

The seller may authenticate access to a download portal, but released runtime code must not phone
home for permission, degrade after entitlement expiry, or prevent purchaser-controlled export and
recovery.

## Self-service requirement

The default sale must be operable without individual seller labor. Before calling the commercial
distribution ready, the separate product must provide:

- preflight checks for Cloudflare, PostgreSQL, domain, Access, model, and backup prerequisites;
- guided purchaser-owned credential entry without committing secret values;
- deterministic installation from a signed, immutable core commit;
- automatic generation of non-secret deployment and rollback evidence;
- actionable failure messages and a clean retry path;
- complete administrator handover, export, restore, migration, and AI-customization guides;
- a synthetic acceptance run proving setup without access to a seller account;
- a support boundary that routes product defects to releases and documentation rather than promising
  per-purchaser customization.

Until this exists, sales language must describe the product as a source distribution with a reviewed
deployment runbook, not as one-click installation.

## Release compliance gate

For every core release or commercial bundle:

1. Freeze the exact root commit and Cloudflare OS gitlink.
2. Run all repository build, test, lint, type, security, database, browser, and dry-run gates.
3. Generate the dependency license inventory from the same lockfile and environment used to build.
4. Record every source and object component included in the bundle.
5. Include root and submodule licenses, third-party notices, dependency notices, and modification
   notices required by the shipped set.
6. Verify that customer-facing assets do not imply Cloudflare endorsement or ownership.
7. Verify that the bundle contains no seller credential, purchaser data, local instance file, or
   runtime call-home dependency.
8. Have the first public commercial terms and every material boundary change reviewed by qualified
   counsel.
9. Preserve the reviewed manifest and artifact checksums with release evidence.

Commercial readiness is blocked if component provenance is unknown, a required notice is missing,
or the commercial license attempts to restrict rights already granted for an Apache component.

## Change rules for developers and AI agents

- Put reusable runtime fixes in `guild-os` and accept that they follow its current Apache license.
- Put future commercial-only material in the separate distribution repository only after its license
  and contributor policy exist.
- Communicate through versioned files, schemas, commands, and network contracts; do not import private
  distribution source into the core.
- Never place purchaser Secrets, data, instance configuration, or support exports in either template
  repository.
- Record the source, author, license, and intended distribution for every imported asset before
  merging it.
- Do not accept external contributions to a commercial-only component without a signed contributor
  agreement or another counsel-approved rights process.
- Treat a proposed license change, repository visibility change, public release, marketplace upload,
  or bundled third-party binary as a review gate, not a routine refactor.

## Rollback

If the commercial boundary proves unclear, stop distribution and keep development in this Apache
repository. Remove only unshipped commercial packaging; do not rewrite history, delete attribution,
or claim that an existing Apache grant was withdrawn. Purchaser instances continue running the last
installed release under its shipped terms.
