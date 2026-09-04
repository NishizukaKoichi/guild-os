# Restore Target Binding Follow-up

Date: 2026-09-05 (Australia/Sydney)

Guild OS remains incomplete. This is a bounded local correction of independent findings against
`e80c922a03aa8f39defaa1d99e591115a8401ea5`, on the same dedicated branch and worktree described in
[the handoff](bounded-verification-handoff.md). No original repository, provider, authorization,
credential, operating-system installation, or deployment is changed in this follow-up.

## Findings and repair

The first evidence repair was insufficient. Its checksum bound the declared account and config,
but `--url` could select an unrelated Workshop under the same Access issuer. Wrangler inventory
queries could also select an ambient account while the receipt named the configured account.
The two minimal regression tests both fail against the previous implementation. The independent
synthetic finding is retained at `.verification/independent/restore-review-hjzhe5/binding-findings.json`.

The correction makes these boundaries executable:

- Custom-domain smoke uses the exact configured HTTPS origin. `--url` is optional and may only
  repeat that same origin, with an optional trailing slash. Credentials, ports, paths, query,
  fragments, whitespace, normalized path tricks, and unrelated hosts are rejected before smoke.
- Workers.dev smoke reads the account subdomain and the named Worker's enabled subdomain state
  from account-scoped Cloudflare GET endpoints. It derives the canonical URL from those results;
  `--url` cannot select another worker or account subdomain. No guessed fallback is allowed.
- Workers.dev requires an existing purchaser-owned API token with permission to read those two
  resources. Missing permission/token fails closed; this implementation neither creates a token,
  broadens a policy, nor falls back to a seller account. Custom domains need no new routing query.
- Authenticated Workshop requests do not follow redirects, so a successful page at another
  destination cannot validate this Workshop or receive its service credentials via redirection.
- Both deployment status and version lookup receive a temporary non-secret Wrangler config with
  the exact `account_id`, plus the matching account environment variable. Conflicting modern or
  legacy account variables are rejected. The public API base is fixed and ambient environment
  selection is removed. Existing credentials are reused, never printed or persisted by this helper.
- Every inventory entry records its account. Release/backup/smoke verification requires the full
  configured Worker set, one nonempty version at 100% per Worker, matching returned version ID,
  and one exact Git release annotation. Missing, duplicate, foreign-account and split inventories fail.
- Restore verifies the same Workshop route, redirect policy, receiver URL and account-bound
  inventory before accepting the checksummed record. Old records must be recaptured, not relabeled.

## Actual CLI contract

The installed Wrangler 4.118.0 implementation selects `config.account_id` before the account
environment variable and cached account. Merely setting an environment variable is therefore
insufficient. Its deployment-status and version-view commands use the selected account in their
`/accounts/{account}/workers/scripts/{worker}/...` requests.

`scripts/account-cli.test.mjs` invokes that installed CLI, not a reimplementation. The test places
an account-B config in the process working directory, omits the incoming account variable, and
uses the production helper's explicit account-A config/environment. Only transport is redirected
to a loopback fixture. Both actual HTTP requests must target account A; unknown endpoints fail.
This proves CLI invocation behavior, not live provider permissions or independent ownership.

Reference sources, checked during this follow-up:

- [Wrangler environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
- [Account workers.dev subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/)
- [Worker subdomain status](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/)

## Verification and compatibility

The `binding-*` logs and command ledger under `.verification/` retain initial failures, repaired
tests, the complete local gate rerun, and current-commit evidence. The previous summary remains
unchanged; the follow-up has its own evidence JSON and patch, never overwrites prior receipts.
Unit tests cover alternate URLs, redirects, account mismatch, explicit config precedence,
missing routing metadata, wrong version IDs and restored evidence with recalculated checksums.
The formal local gate includes default tests, Worker dry runs, real isolated PostgreSQL tests,
Cloudflare OS integration, E2E, and the independently pinned Distribution rehearsal.

No Runtime schema, RLS, role, permission, API authorization, or user content changes. Internal
operations helpers now require a resolved config for release verification; Core callers are
updated together. Operational evidence is intentionally stricter. Distribution still pins the
old Core until a separately authorized review and release updates it. Reverting this commit
restores the evidence vulnerabilities; prefer fresh correctly scoped evidence over rollback.

The prior pgvector installation exception and its 42-path manifest remain intact and unresolved.
This follow-up reuses only the existing local fixture and staged extension; no OS installation or
cleanup is attempted. Independent purchaser lifecycle, physical signing custody, professional
review, successor CI and authenticated staging/production remain external acceptance gates as
listed with actors, devices and detection conditions in the original handoff. No new human
action or generic continuation request is needed to verify this local correction.
