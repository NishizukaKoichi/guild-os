# ADR 0020: Active Worker binding discovery

## Status

Accepted

## Context

Wrangler 4.118 provisions omitted KV and R2 bindings but does not write their generated identifiers
back into the temporary JSON configuration passed to `wrangler deploy`. Reading that file after a
successful first deployment therefore produces an unresolved lock even though Cloudflare has
created and bound the resources.

## Decision

After deployment, query each required Worker's active deployment and Version. Require exactly one
Version at 100 percent traffic and require its release message to match the full Git SHA being
deployed. Read KV namespace IDs and R2 bucket names from that Version's returned bindings, reject
configured-versus-deployed conflicts, and only then write `deployment.lock.json` atomically.

On a partial deployment failure, capture only bindings from Workers already running the attempted
release and leave unresolved values null. Release evidence and backups continue to reject a partial
lock.

## Alternatives

Parsing Wrangler console output was rejected because it is presentation text and has no stable
machine contract. Naming-based account searches were rejected because names are not authoritative
proof of the binding used by the active Worker.

## Risks and rollback

A breaking change to Wrangler's deployment or Version JSON will stop the deploy after Worker upload
instead of inventing resource identities. Roll back by pinning the prior compatible Wrangler or by
updating the parser with fixtures from the new documented output, then rerun the same Git release.
