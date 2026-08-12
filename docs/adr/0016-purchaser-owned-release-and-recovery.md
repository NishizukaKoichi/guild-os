# ADR 0016: Purchaser-owned release and recovery evidence

## Status

Accepted

## Context

Wrangler can automatically provision KV namespaces and R2 buckets on first deploy. It writes their
identifiers back to the generated configuration file. Guild OS generated those files temporarily,
then deleted them, so a later deploy could accidentally create replacement resources. A Git commit
also does not prove which Worker versions were active, whether Access protected the Workshop, or
whether PostgreSQL, KV, R2, and Access could be recovered together.

The product has no seller-operated control plane. Recovery evidence must therefore remain usable by
the purchaser even if the seller, source marketplace, or original development machine disappears.

## Decision

- The first live deploy captures automatically provisioned resource identities in a mode-`0600`
  `deployment.lock.json`. Every later deploy verifies the account, Guild, Worker names, and resources
  against that lock and fails on drift.
- The lock is purchaser-instance state. It is ignored by the reusable source template and retained
  in the purchaser's encrypted operations vault and backup set.
- A live deploy requires a clean Git tree and the recorded Cloudflare OS submodule commit. Every
  Worker Version receives the full Git SHA as its message and a short-SHA release tag.
- Release evidence records source, migration hashes, non-secret deployment hashes and resource IDs,
  active Worker Version IDs, and required gates. Personal names, Access email addresses, secret
  values, and Guild labels are omitted or hashed.
- A complete backup is one quiescent boundary across PostgreSQL, KV, R2, Access configuration,
  Worker deployment state, and optional Context Artifacts. It is written only outside the source
  tree to an operator-confirmed encrypted destination and verified before success is reported.
- Restore preparation verifies the backup again and converts binary-safe KV JSONL into bounded
  Wrangler bulk files. It never mutates cloud resources. Actual restoration targets newly created,
  explicitly named purchaser-owned resources.
- Automated production smoke proves that the Workshop is Access-protected and that the reference
  receiver is healthy and rejects unsigned writes. Human workflows remain an explicit acceptance
  record because they cannot be truthfully inferred from HTTP status alone.

## Consequences

A purchaser must preserve instance evidence separately from the reusable Git template. Losing both
the lock and every verified backup makes resource discovery a manual Cloudflare-account recovery
task. Backups need a brief write-restricted window because Guild OS intentionally has no global
distributed snapshot transaction across PostgreSQL, KV, and R2.

The tooling refuses to overwrite evidence, deploy dirty source, silently reuse a lock from another
Guild, or run a destructive restore. Operators retain explicit control over billing, DNS, Access,
database creation, secret rotation, and final cutover.
