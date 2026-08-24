# ADR 0041: Scan complete Core history before publication

## Status

Accepted on 2026-08-24.

## Context

Changing the Apache Core repository from private to public exposes every branch and Git object that
GitHub publishes, not only the current checkout. Current-file scans, a clean build, and an Apache
license do not prove that an earlier commit never contained a Secret. Conversely, suppressing every
generic scanner match without review could hide a real credential.

The current complete history produces four Gitleaks generic-key matches. Each is a deterministic
test-only value or Secret Binding reference. None has a provider credential prefix or production
source path. The reviewed historical line is bound by Commit, path, line number, rule, and SHA-256;
the value itself is not copied into the review registry or audit evidence.

## Decision

Open Core publication requires Gitleaks 8.30.1 over all reachable Git history with archive depth two,
decode depth five, and 100 percent redaction. CI downloads the official Linux release archive and
verifies its pinned GitHub release checksum before execution. A shallow checkout is rejected.

`.gitleaksignore` may contain only fingerprints present in
`scripts/publication-false-positives.json`. The audit first scans without the ignore file and requires
the exact reviewed set, verifies each historical line checksum, then scans with the ignore file and
requires zero effective findings. A new finding, broad ignore, changed line, different scanner
version, dirty worktree, repository-local rule override, or unredacted report fails closed.

Publication evidence is owner-only JSON outside Git. It records the exact Core Commit, history size,
scanner binary checksum, review-registry checksum, reviewed fingerprints, and zero unreviewed
findings. It never contains candidate Secret values.

## Initial publication record

On 2026-08-24 the repository owner explicitly authorized public Apache-2.0 visibility for
`NishizukaKoichi/guild-os`. Immediately before the change, Core
`126dd6c079e7b0f1df412b8954ea363729844426` passed the complete-history gate over 88 commits with
four exact reviewed synthetic fixtures and zero unreviewed or effective findings. After the change,
an anonymous recursive HTTPS clone independently passed strict Git verification, frozen install,
typecheck, and build. The commercial Distribution remained private and no production Runtime was
deployed.

This record authorizes no later release by implication. Every new reachable Core commit must pass the
history audit, exact-SHA hosted CI, and anonymous acquisition gate again.

## Alternatives

- Scanning only `HEAD` was rejected because publication exposes historical objects.
- Deleting all synthetic fixtures was rejected because the historical objects would still exist.
- Rewriting history was rejected because it would invalidate existing Commit, CI, bundle, migration,
  and release evidence without improving safety for reviewed test-only values.
- A broad regex allowlist was rejected because it could conceal future credentials.

## Risk and rollback

Gitleaks is one control, not proof that no conceivable sensitive information exists. The release
owner must still review repository identity, fixture content, licenses, and intended visibility.
Remove a fingerprint only after the corresponding history is no longer published; adding one
requires a new line-bound review and decision record. Never rewrite shared history solely to make
this gate pass without a separate migration and evidence invalidation plan.
