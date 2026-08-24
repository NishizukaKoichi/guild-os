# ADR 0040: Generate and bind independent restore evidence

Status: Accepted and implemented on 2026-08-24

## Context

The commercial completion contract requires a full restore in an independently controlled
purchaser environment. Backup verification and restore-plan generation do not prove that the live
PostgreSQL, KV, R2, Access-protected Runtime, Chronicle, or Break Glass boundary was restored.
Earlier `guild-os-restore-rehearsal/v1` records could summarize those checks but did not require the
checks to be produced by a supported verifier.

## Decision

Core provides two read-only commands. The pre-recovery command compares the verified backup with
the live isolated target and records PostgreSQL, KV, R2, Worker inventory, and authenticated smoke.
After a Human performs Break Glass through the protected Runtime, the post-recovery command proves
code consumption, generation invalidation, active Human Root state, Chronicle ordering,
post-recovery smoke, and measured RPO/RTO.

Guild OS Owned accepts only the generated `guild-os-restore-verification/v1` technical structure
and finalizes `guild-os-restore-rehearsal/v2`. Readiness rechecks its exact purchaser config,
ownership-attestation file, live Installer-evidence file, deployment lock, candidate commits, and
declared seller-account boundary. Legacy v1 summaries and restore preparation remain insufficient.

The verifier does not restore data, perform Break Glass, change production, or store credentials.
Evidence stays outside Git in purchaser-controlled encrypted storage. A checksum detects later
modification but is not a remote-attestation system; purchaser custody and independent execution
remain required operational evidence.

## Alternatives considered

- Keep a manual checklist and signed narrative. Rejected because pass fields could drift from the
  live stores and candidate release.
- Use one script that restores data and performs recovery. Rejected because it would combine
  mutation authority with release verification and enlarge the blast radius.

## Consequences and rollback

The process has a deliberate Human boundary between pre- and post-recovery verification and adds
no database migration or Runtime dependency. Existing v1 records remain historical evidence but no
longer satisfy commercial readiness. Reverting the tooling requires reverting both Core commands
and Distribution v2 validation together; readiness must fail closed while either side is absent.
