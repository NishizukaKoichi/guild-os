# Bounded Verification and Acceptance Handoff

Date: 2026-09-05 (Australia/Sydney)

Guild OS remains incomplete. This document is a local engineering handoff, not a purchaser
attestation, signing activation, legal opinion, or permission to release.

## Identity and scope

- Canonical Core: `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os`, observed clean `main`.
- Base: `c7183f13219b47ab7bf00c2220e4976cb2dffa0f`.
- Dedicated branch: `wand/guild-verification-066a4878`.
- Worktree: `/Volumes/Pensive/Workspace/NishizukaKoichi/.worktrees/guild-os-wand-066a4878`.
- Pensive was mounted writable APFS on an external USB device; realpath and Git root matched.
- Upstream gitlink: `2328903878b8bb3d8e29af6187abe935a5738482`.
- Independent Distribution baseline: `d75ee8b8e124ec7ad28f927a7f5c21002a633c40`.
  Its pin is the Core base, not the local successor. Its original worktree was read only.
- Observed [Core CI 33397241955](https://github.com/NishizukaKoichi/guild-os/actions/runs/33397241955)
  succeeded for the base. This is not successor CI evidence.
- No push, merge, publication, deployment, billing, credential work, production DB access, or
  production permission changes are authorized. No other agent was started.

## Implemented contract repair

Restore accepted a checksummed smoke document after checking its source SHA and Worker names,
but did not bind it to the purchaser account, Guild, resolved configuration, or verified version
inventory. Names alone can collide across accounts and persist across releases.

Smoke now emits `target` and `deploymentVerification` within its existing v1 payload checksum.
Injected transport, source, or deployment fixtures always identify themselves as `injected-runner`
and cannot claim a live release verification. Restore requires the exact account, Guild, config
hash, Core SHA, live mode, and inventory checksum; every Worker must have one 100% active version.
Legacy records lacking these bindings fail closed. Regenerate them using the authorized live CLI.
Do not edit records or change their execution mode. Checksums provide consistency, not proof of
independent authorship; purchaser ownership and signing evidence remain separate requirements.

This is additive smoke output but intentionally stricter restore acceptance. There is no migration,
Runtime authorization change, or customer-data modification. Reverting the code commit restores the
previous behavior, but also restores the evidence gap; prefer recapturing smoke. Distribution must
review and pin the eventual released Core explicitly. No cross-repository propagation was done.

Browser evidence previously could reuse another checkout's server or time out after Vite silently
moved to a different port. `GUILD_E2E_PORT` now selects a validated dedicated port, Vite uses
`--strictPort`, and Playwright never reuses an unknown server. The default remains 4317; this task
uses 14317 without stopping the pre-existing process on 4317. No Runtime routing or UI behavior changed.

The pinned Cloudflare OS RPC suite had four unconditional skips for old timeout failures, not an
external-credential dependency. Replaying the unchanged cases without that suite-level skip passed.
Core now requires that replay in `test:cloudflare-os` and therefore in existing CI. A TypeScript AST
check locates only the exact suite call and refuses missing, disabled, extra, or narrowed cases.
The generated temporary test is removed after the run; tracked upstream source and gitlink stay
unchanged. Known negative-test RPC exceptions remain visible in logs; they are asserted expected
outcomes, not browser console errors. No timeout increase, forced click, retry increase, or suppressed
assertion was used to obtain a pass.

`pnpm completion:report` verifies all 42 specification sections have exactly one row with a
canonical status. It reports declarations and open sections without ever returning product
completion as verified. Existing tests now check this distinction even if all rows are marked green.

## Local verification and evidence

Ignored `.verification/commands.jsonl` records exact command arguments, times, exit codes and log
paths. `.verification/logs/` holds full results. `.verification/verification-summary.json` binds
the final committed source and log checksums; it is local evidence only. Do not put these artifacts
into a release bundle or promote them to purchaser evidence.

Validation uses pnpm 11.9.0, an allowlisted child environment without production credentials, and
worktree-local HOME, temporary directory, package caches, browsers, and generated output.
The first pnpm launch recursively dispatched through the older global launcher; only that owned
process tree was stopped, then the exact installed pnpm 11.9.0 executable was selected.
Initial gates used Node 22.13.0; final gates use isolated Node 24.13.0 to match CI's major version.
The E2E-config unit test explicitly enables Node's TypeScript stripping for compatibility with 22.

The full command set is:

```bash
pnpm install --frozen-lockfile
pnpm types:check
pnpm test
pnpm test:cloudflare-os
pnpm build
pnpm lint
pnpm audit:dependencies
pnpm peers:check
pnpm completion:report
pnpm check
pnpm --filter @guild-os/gatekeeper test:e2e
pnpm db:migrate
pnpm db:migrate
pnpm db:provision-runtime -- --allow-insecure-localhost
pnpm db:verify -- --allow-insecure-localhost
pnpm --filter @guild-os/postgres test:integration
pnpm --filter @guild-os/gatekeeper test:integration
```

Only `pnpm check` receives `fixtures/deployment.ci.jsonc`. Database commands use a newly initialized
PostgreSQL 18.6 fixture listening on loopback port 55439, never a shared or production database.
It contains only test data and password-free fixture roles. Runtime tests use a non-superuser,
non-BYPASSRLS role, not the cluster administrator. The cluster is stopped after validation; its
isolated files are retained. Local insecure transport proves neither production TLS nor credential
custody. `pnpm test` without a DB skips PostgreSQL cases; separate integration results are required.

pgvector v0.8.2 was built from `cab9da72c04353f143bb06b42ab70a403daac64a`. The corrected staging uses
`make -n install DESTDIR=...` before installation inside `.verification/pg-stage`. Its local control
file names `vector` rather than `$libdir/vector` to load the staged library without altering Core
migrations. PostgreSQL 18 supports independent extension locations through
[extension_control_path and dynamic_library_path](https://www.postgresql.org/docs/18/extend-pgxs.html).

The Distribution baseline is cloned with complete independent objects under ignored
`.verification/distribution`. `pnpm install --frozen-lockfile` and its full `pnpm verify:release`
run there with temporary output contained in this worktree. The resulting
`.verification/distribution-release.json` explicitly sets synthetic clean-room and ephemeral
signing to true, and independent purchaser, production signing, staging smoke, and production
changes to false. This does not test Distribution against the unpinned local successor.

### Observed local results

| Gate | Result and boundary |
| --- | --- |
| Install, typecheck, build, lint, dependency and peer audits | Passed; exact commands and exits are retained in the ignored command ledger |
| Core default tests | 376 passed; 73 DB-dependent cases skip here and run separately below |
| PostgreSQL and Gatekeeper integrations | 73 plus 35 passed on the new local fixture; 51 migrations and 96 forced-RLS tables verified |
| Cloudflare OS | 496 passed, including the required four-case RPC replay; the original skipped suite remains visible rather than being counted as coverage |
| Worker check | Passed with CI fixture configuration and dry-run only; nothing uploaded |
| Browser E2E | 74 passed, including the existing multilingual, mobile, accessibility, security and sandbox journeys |
| Independent visual/DOM check | Ten mode/viewport/language combinations had zero horizontal overflow and zero browser console/page errors; Root Home to Ask focused the input in one selection and browser Back restored Home |
| Regression reproduction | Original base failed 11 of 13 selected restore evidence assertions; the successor passes them, without replacing tracked files with baseline code |

Screenshots and DOM observations are in `.verification/screenshots/`. Modes are Root, member,
uninitialized admin and uninitialized member. Root English covers all five specified viewports;
Japanese and simplified Chinese additionally cover 320 px. No visual redesign was made in this
batch, so these are current-state observations, not a before/after UX improvement claim.

Upstream verification still emits compatibility warnings: four sharing assertions are currently
auto-awaited by Vitest 4, and the Worker Cap'n Web transform excludes thirteen files outside its
package directory. These warnings are retained in logs, not suppressed or claimed fixed. A later
upstream version needs an explicit pin review. Local browser checks did not reproduce console
errors. The post-commit full-history publication scan is a local secret audit, not publication;
its complete clone and output both remain within this worktree, outside each other's source tree.
The first unpublished local commit's history scan mistook the public upstream Git identifier next
to its provider label for an API key. Only the documentation label was changed and that unpublished
commit was amended. No scanner rule or reviewed-finding allowlist was broadened; the failed scan
and redacted diagnostic remain in local evidence. The abandoned commit is not a released version.

## Scope exception: local tool installation

The initial pgvector `make install prefix=...` ignored the requested prefix in the Homebrew PGXS
build and wrote outside the permitted worktree. Observed destinations were:

- `/opt/homebrew/lib/postgresql@18/vector.dylib`
- `/opt/homebrew/share/postgresql@18/extension/vector.control` and `vector--*.sql`
- `/opt/homebrew/include/postgresql@18/server/extension/vector/` headers

The vector control file was absent before the attempt; the previous state of every other target
was not captured, so restoration of every prior byte cannot be claimed. The complete install log
is `.verification/logs/vector-install.log`. `.verification/scope-exception.json` inventories 42
affected paths, sizes, modification times, hashes, and known/unknown previous state.
No automatic deletion or system cleanup was attempted:
those writes were outside scope, and deletion is also prohibited. A separately authorized local
operator must review the manifest before retaining or removing these exact files. Do not run a
broad Homebrew uninstall. The corrected build stages only within the worktree and verifies the
destination plan before writing. This exception must remain visible in the Wand result.

## Consolidated external acceptance window

These are parked exceptions, not new permission requests within this bounded task. Existing
Distribution runbooks and evidence schemas remain canonical; do not create a second installer,
forge approval records, or replace independent people with Codex or the founder.

| Gate | Who and device | Exact action after separately authorized scope | Detection and resume condition |
| --- | --- | --- | --- |
| Local tool-scope exception | Local operator or separately scoped local task; connected Mac required | Review the exact pgvector installation paths and hashes; decide retention or targeted restoration without deleting unrelated files | Audited outcome for only those paths; no package-wide uninstall |
| Candidate release | Release owner; phone approval is sufficient for authorization, build runner executes | Review local diff, authorize exact Core publication and separately reviewed Distribution pin; run exact-SHA CI before staging | Git-resolved candidate, matching pins, successful authoritative CI records; base CI alone is rejected |
| Signing custody | Named human custodian; primary secure machine plus two physically independent encrypted offline devices | Follow Distribution `docs/signing-key-custody.md`; create/verify backup attestations and activate release and entitlement trust separately | Signed active public trust and named activation matching the candidate; Codex, two folders, or two partitions cannot attest independence |
| Independent purchaser lifecycle | A real non-seller purchaser administrator; their machine/runner and cloud accounts, phone for provider consent where supported | Use acquired Installer v4, explicit Human initialization, successful Updater v3, acknowledged isolated `rollback-drill`, then new-resource restore and Human Break Glass recovery | Purchaser ownership outside seller inventory; live config/lock/source/smoke hashes, restored prior Worker versions, generated pre/post restore v2 finalized by Distribution |
| Professional review | Qualified reviewers and release owner; phone-capable document review is possible | Review license, trademark, contribution rights, privacy, tax/billing, customer terms, support, pricing, refund, incident response and LGPL obligations | Named scope/jurisdiction, exact document hashes and final approval records; no draft or AI-only substitution |
| Staging and production | Purchaser/release owner; phone authorization plus authorized runner | Verified pre-deploy backup, exact candidate staging, authenticated journeys; production only under explicit separate authority | Exact Worker versions, migration/RLS/TLS evidence and fresh target-bound smoke; local fixtures are never sufficient |

Only after these outcomes exist should the separately authorized release task invoke Distribution
`readiness:verify` using its existing `templates/commercial-readiness.request.example.json` schema.
It must independently validate authorship/ownership and all exact hashes. This task has no observer
that can detect physical-device actions or professional review; no automatic-resume claim is made.
Wand can re-observe this local commit and the documented evidence paths without another generic
"continue" request. A new instruction must explicitly identify any newly permitted external effects.
