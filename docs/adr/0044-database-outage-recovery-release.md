# ADR 0044: Database-outage recovery releases remain code-only and rollback-safe

Status: Accepted

## Context

A database provider can suspend compute before Guild OS can run its normal database preflight,
verified backup, and authenticated smoke. Waiting for the provider to recover can leave two fixes
undeployed: a safer user-facing outage state and a lower-frequency maintenance schedule that prevents
the same quota incident from immediately recurring.

Skipping the database preflight for an ordinary release would weaken the release boundary. Deploying
only the Workshop would also leave the Workers on different release commits and make rollback evidence
ambiguous.

## Decision

The deploy tool supports `--database-outage-recovery` only together with
`--preserve-existing-secrets`. This path deploys every enabled Worker as one exact release, but it is
accepted only when all of the following are true:

- every active Worker is on one complete, annotated Guild OS release;
- the candidate descends from that active release;
- the root and pinned Cloudflare OS diffs contain only the reviewed outage UI, maintenance scheduling,
  tests, deployment tooling, notices, fixtures, and documentation;
- the two deployed runtime patches match the reviewed SHA-256 digests embedded in the release tool;
- PostgreSQL, domain, lockfile, backend, Context, and other protected runtime surfaces are unchanged;
- every required existing Secret binding is present without reading any Secret value;
- the active Worker version IDs remain unchanged after local verification and immediately before the
  first upload;
- a new mode-`0700` evidence directory outside the checkout records the base release, exact candidate,
  reviewed paths, and rollback points;
- any partial failure automatically rolls changed Workers back to the recorded versions and verifies
  each restored version.

The mode never migrates, writes, restores, replaces, or declares the database healthy. Its result
explicitly records `databaseChanged: false` and `databaseSmokePending: true`.

## Consequences

Users receive a non-sensitive retry state and the cost-bounded schedule can be active before database
compute returns. All Workers still identify one release and a failed attempt has machine-recorded
rollback evidence.

This is not a substitute for a database backup, normal deployment, or completion evidence. Once the
existing database is available, the operator must run the normal database preflight, create and verify
a backup, execute authenticated production smoke, and preserve that evidence. Any candidate outside
the hard-coded reviewed surface must wait for database recovery and use the normal release path.
