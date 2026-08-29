# Third-Party Notices

Updated: 2026-08-16

This file records the direct third-party foundations currently known to the Guild OS source tree.
It does not replace the license text in [LICENSE](LICENSE), the license files shipped by dependencies,
or a release-specific dependency inventory.

## Repository license status

This checkout is distributed under the Apache License 2.0 in [LICENSE](LICENSE). Its Git history
began as the Cloudflare OS deployment starter and later added Guild OS code in the same licensed
repository. No path in this checkout is designated as proprietary or as a separately licensed
commercial component. Private repository visibility, authorship of a later file, or charging money
for a distribution does not by itself change that recorded license status.

## Cloudflare OS deployment starter

- Project: Cloudflare OS deployment starter
- Upstream source: <https://github.com/cloudflare/cloudflare-os-starter>
- License: Apache License 2.0
- Imported history: `838569f3bde8dadfc7f41cc8fdcd02e28fe6d0b7` through
  `93f14dfd68ed1c218d2a7c2168753a6d9b22e145`
- First Guild-specific commit: `52b79e1977ea260071f5e90316bc07ba7b51e327`

The inherited starter includes the deployment wrapper, repository scaffolding, selected operational
documentation and assets, and the original custom Gatekeeper and error reporter foundations. Later
Guild OS changes do not erase the provenance of retained or modified starter files.

## Cloudflare OS

- Project: Cloudflare OS
- Upstream source: <https://github.com/cloudflare/cloudflare-os>
- Purchaser-build fork: <https://github.com/NishizukaKoichi/cloudflare-os>
- Path: `cloudflare-os/` Git submodule
- License: Apache License 2.0; see `cloudflare-os/LICENSE`
- Reviewed upstream base: `bf7f762d7fa73553284d731ab6a978d3ea17be24`
- Current pinned fork commit: `2328903878b8bb3d8e29af6187abe935a5738482`

The fork currently adds these Guild OS security-boundary commits:

- `76c4ee4531243e13e5956170fbffc4a051b11746` - propagate verified reauthentication evidence
- `bba32ca8fab7b9925f5b1a3e7e36c4d37f788ff5` - bind step-up evidence to the Access login event
- `546c784d8401b832114f03bc52600b392bb31827` - replace raw management-app infrastructure errors
  with an accessible, retryable unavailable state while retaining private issue reporting
- `2328903878b8bb3d8e29af6187abe935a5738482` - keep handled Gatekeeper load failures out of the
  browser console while retaining bounded private issue reporting

Those modifications remain inside the Apache-licensed Cloudflare OS fork. A release must ship the
submodule license and must not describe the fork as exclusively proprietary Guild OS code.

## Package dependencies

The root `pnpm-lock.yaml` is the authoritative dependency graph for the release. Generate an exact
machine-readable inventory from the reviewed release checkout with:

```sh
pnpm licenses list --json > /absolute/path/outside-the-repository/dependency-licenses.json
```

Store that inventory with the release artifacts and preserve the applicable license and attribution
texts for dependencies actually included in the distributed source or object form. The inventory is
release-specific: do not copy an older result forward after changing `pnpm-lock.yaml`.

## Names and marks

Apache License 2.0 does not grant trademark rights. The Cloudflare name and inherited
`docs/assets/cloudflareOS.svg` asset may identify technical origin, but they must not be presented as
Guild OS ownership, Cloudflare endorsement, or the purchaser's product brand. A commercial Guild OS
distribution must use independently cleared customer-facing branding and retain factual attribution
separately.

## Distribution rule

Every source archive, installer payload, or object distribution containing this repository must
include at least:

- the root `LICENSE`;
- this notice file;
- `cloudflare-os/LICENSE` when the submodule or its built output is included;
- the release-specific dependency inventory and all other notices required by shipped dependencies;
- prominent modification notices where required by the applicable license.

See [Licensing and distribution](docs/licensing-and-distribution.md) for the product boundary and
[ADR 0038](docs/adr/0038-separate-commercial-distribution-from-apache-core.md) for the decision.
