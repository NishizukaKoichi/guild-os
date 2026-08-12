# ADR 0017: Authoritative release dependency lock

## Status

Accepted

## Context

Guild OS deploys a selected set of packages from the pinned Cloudflare OS submodule together with
Guild-owned Workers. Installing each repository independently produced two dependency graphs. The
submodule lock could retain a vulnerable transitive dependency even when the wrapper lock was
clean, while a deployment assembled artifacts from both installations. Updating the submodule
solely to change transitive dependencies would also combine a large upstream feature change with a
security maintenance change.

## Decision

- The repository-root `pnpm-workspace.yaml` lists every Cloudflare OS package that contributes to a
  Guild OS release. The root `pnpm-lock.yaml` is the only dependency lock used for installation,
  verification, build, and deploy.
- The Cloudflare OS gitlink remains the source-code pin. Its nested lockfile remains upstream data,
  but is not a Guild OS release input.
- Root overrides may pin patched transitive releases when the vulnerable package is not controlled
  by this repository. Every override must remain explicit, pass the complete affected build and
  test suites, and be reviewed again when the submodule advances.
- Automatic peer installation is disabled so each workspace package retains its declared type
  generation. The legacy Cloudflare test pool receives its compatible optional Workers type
  package through a narrowly scoped package extension.
- Installs reject dependencies published within 24 hours except the same Cloudflare build artifacts
  explicitly exempted by upstream. CI and the deploy command require zero high-severity audit
  findings and zero peer dependency issues.

## Alternatives considered

Updating the entire submodule was rejected because current upstream still retained the original
vulnerable package and introduced unrelated kernel changes. Mutating the submodule lock in place
was rejected because it would create an unreviewed forked source boundary and would still leave two
release graphs.

## Consequences

A single frozen install now reproduces the complete release. Upstream package additions must be
added to the root workspace before they can contribute to a build. When upgrading Cloudflare OS,
review the root overrides and package extension against the new upstream lock, run all Cloudflare
OS package tests touched by those controls, and remove pins that upstream no longer needs.

Rollback is the normal Git revert of this ADR, workspace configuration, and root lockfile together;
the pinned submodule commit is unchanged.
