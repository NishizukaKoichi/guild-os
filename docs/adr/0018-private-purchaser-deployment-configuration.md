# ADR 0018: Private purchaser deployment configuration

## Status

Accepted

## Context

The reusable template needs an annotated deployment configuration, but a real installation adds
administrator email addresses, Guild labels, hostnames, and stable cloud resource identifiers.
Committing those values would mix purchaser state into the sales source and conflict with the
requirement that production deploys originate from a clean reviewed commit. Environment variables
alone are a poor fit for the nested, non-secret configuration and make recovery harder.

## Decision

- Tracked `deployment.jsonc` remains a placeholder-only product template.
- An installation copies it to ignored `deployment.local.jsonc`, or sets
  `GUILD_OS_DEPLOYMENT_CONFIG` to an absolute file in a purchaser-owned encrypted operations area.
- All operational commands resolve the explicit absolute path first, then the local ignored file,
  then the tracked template for setup diagnostics. A live deploy rejects the tracked template.
- On POSIX systems a live deploy requires the purchaser file to have mode `0600`.
- Configuration validation recursively rejects secret-like keys. Database URLs, signing secrets,
  API tokens, credentials, and passwords remain process-only secret inputs.
- Release evidence records the configuration source class and SHA-256 only. It does not record the
  private file path, administrator identities, Guild labels, or plaintext configuration.

## Alternatives considered

Committing one production configuration was rejected because it leaks instance metadata into the
saleable source and makes clean-source deployment encourage unsafe behavior. Encoding every value
as an environment variable was rejected because it obscures the nested contract and weakens
backup, review, and migration workflows.

## Consequences

The purchaser must preserve the private configuration with `deployment.lock.json` in the encrypted
operations vault and verified backups. Losing it does not delete cloud state, but reconstruction
requires account inventory and recovery evidence. CI uses only `fixtures/deployment.ci.jsonc`, with
reserved domains and identities, to prove bundling without an installed instance.

Rollback is to restore the prior configuration resolver and explicitly review any production
metadata before tracking it; no database or cloud resource mutation is involved.
