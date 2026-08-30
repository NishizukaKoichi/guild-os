# Guild OS Context Snapshot

Updated: 2026-08-30

## Current goal

Guild OS is an Actor-neutral Collective OS whose Apache Core and purchaser-owned commercial
Distribution remain operationally independent from the seller. Humans, Agents, Services, and other
Guilds share governed Memory, Activity, Roles, Decisions, Connections, and append-only History.

## Authority

1. [Product specification](product-specification.md) is the requirement authority.
2. [Full-spec acceptance](full-spec-acceptance.md) defines executable release evidence.
3. [Product completion matrix](product-completion-matrix.md) records verified and blocked state.
4. Code, migrations, tests, deployment configuration, and accepted ADRs define actual behavior.

`v1-completion.md` is only a compatibility index. It cannot narrow the specification or turn a
local, Core-only, synthetic, or seller-owned rehearsal into product completion.

This document deliberately does not name its own Git SHA. Release automation must obtain the exact
commit from Git, bind it to Worker versions and signed manifests, and verify hosted CI for that SHA.

## Repository and ownership boundaries

- `guild-os` is the Apache-2.0 Core and includes the pinned Cloudflare OS submodule.
- The Core GitHub repository is public under Apache-2.0. Distribution readiness verifies this
  boundary through a credential-free recursive clone, frozen install, typecheck, and build for the
  exact release commit; a license file or authenticated checkout alone is not sufficient.
- Publication additionally requires a clean, complete-history Gitleaks 8.30.1 audit. Four
  historical generic-key matches are line-hash-bound synthetic test fixtures; any changed or new
  finding fails closed and audit evidence contains no candidate Secret values.
- `guild-os-distribution` is a separate commercial repository containing Installer, Updater,
  entitlement, signed-release, diagnostics, compliance, readiness, and handover packages.
- One Runtime deployment represents one independently owned Collective.
- Purchasers own Cloudflare, PostgreSQL, model-provider, domain, Secret, backup, and data resources.
- Runtime has no seller API, license server, AI proxy, telemetry, backup, domain, or kill dependency.
- Expired update access may reject a new package; it cannot stop an installed Runtime.

## Core implementation state

- Cloudflare OS is pinned at `2328903878b8bb3d8e29af6187abe935a5738482`.
- PostgreSQL 17+ is supported. The current immutable inventory contains migrations `0001` through
  `0051`; management and Runtime roles remain separate and Runtime uses forced RLS.
- Human, Agent, Service, and Guild use one Actor/Membership/Role/Capability/Space substrate.
- Personal + AI is the guided default. Company, Research, Community, advanced presets, Blank, and
  the Purpose-first Other Builder use the same neutral Core.
- Family, school, sports team, NPO, DAO, cooperative, and civic-community Blueprints are generated
  without code or Blank fallback and are covered in browser acceptance.
- Memory, recursive Activity, Decisions, Conversations, onboarding/offboarding, Contribution,
  Connections, Automation, Federation, export, retention, backup, restore preparation, Ask/Plan/Act,
  Agent limits, approval, Kill, and Chronicle are implemented behind database authorization.
- Purpose-first Blueprint generation and embeddings use purchaser-owned Workers AI. Operational
  Ask, Plan, Act, and review may use Workers AI or one purchaser-owned OpenAI-compatible endpoint.
  The only deployment-level external-model token binding is `GUILD_MODEL_PROVIDER_TOKEN`.
- Deployment exposes `db:preflight` for a fresh database or an exact migration-prefix upgrade. It
  checks PostgreSQL version, TLS, role privileges, required extensions, migration hashes, and
  schema/ledger consistency before mutation.
- ADR 0044 adds a fail-closed database-outage release path for the exact reviewed recovery UI and
  maintenance-cost patches. It preserves existing Secrets, hashes the two Runtime diffs, records all
  prior Worker Versions, rejects database/domain/backend changes, and automatically rolls a partial
  deployment back. It never substitutes for database backup or smoke.

## Distribution implementation state

- The deployment wizard stores Secret reference names, exact purchaser IDs, ownership confirmations,
  an absolute encrypted backup destination, and either Workers AI or an external model endpoint.
- Interactive Installer and Updater prompts collect only missing Secrets without echo and retain
  them in process memory. Dry-run remains Secret-free.
- The purchaser creates the Cloudflare Access application and smoke Service Token. The Installer
  verifies exact audience, domain, token, and creates only exact Human administrator and
  token-specific Service Auth policies.
- Fresh install refuses pre-existing configured Worker names. Failure removes only Workers and
  Access policies created by that attempt; additive database schema and purchaser data are retained
  and identified in v4 installation evidence.
- Signed release format v2 contains complete local Git bundles for the exact Core and Cloudflare OS
  commits. Staging proves both bundles with an isolated clone, exact-commit assertion, and strict
  object verification. Installer and Updater do not clone or fetch source from a seller repository.
- Staging generates seven required executable CLI launchers. The signed manifest verifies their
  presence and mode, and CI installs the acquired release directory before starting every launcher.
- Installed state v3 stores the exact Core pin, signed local-source hashes, Worker Version inventory,
  and purchaser-bound deployment lock without Secret values.
- Updater v3 verifies the purchaser-retained source for the installed release before contacting
  purchaser services, uses that installed Core for backup verification, archives and verifies the
  candidate source before mutation, applies only declared backward-compatible additive migrations,
  and restores recorded Worker Versions after a post-deployment failure.
- Installer and Updater require real Core production-smoke evidence and bind its SHA-256 into their
  own evidence. Commercial readiness also binds their candidate-source hashes to the exact signed
  manifest and rejects seller-network acquisition. Synthetic fixture smoke cannot pass.
- The fail-closed readiness verifier keeps local rehearsal, independent purchaser deployment,
  signing custody, hosted CI, restore, and professional approval as separate evidence classes. Its
  authenticated CI capture command writes only an exact successful GitHub Actions run to evidence
  storage outside Git.
- Commercial readiness request/report v2 additionally requires machine-generated Open Core
  acquisition evidence and re-executes the complete credential-free HTTPS clone, exact Core and
  Cloudflare OS checkout, strict object verification, frozen install, typecheck, and build. It fails
  if anonymous acquisition stops working; no checksum-only or hand-authored record can bypass the
  live recheck.
- Core now generates the independent restore proof through a two-phase, read-only verifier. The
  pre-recovery artifact compares live PostgreSQL, KV, R2, Worker inventory, and authenticated smoke
  against the selected backup and target; the post-recovery artifact adds Break Glass consumption,
  Root recovery, Chronicle ordering, post-recovery smoke, RPO, and measured RTO. Distribution accepts
  only that generated `guild-os-restore-verification/v1` artifact and finalizes it as purchaser-bound
  `guild-os-restore-rehearsal/v2`; legacy hand-authored v1 evidence is rejected.

## Verified local baseline

On 2026-08-30 the current audited Core outage-release candidate
`2ae4f50751b907cf0e6aad817d675bc368dd8382` passed local typecheck, tests, build, lint, dependency
audit, peer-dependency checks, the complete dry-run build check, Cloudflare OS boundary tests, and
74 Playwright E2E journeys. The E2E set covers desktop, tablet, 390 px and 320 px mobile, English,
Japanese, Simplified Chinese, accessibility, Purpose-first generation, Ask/Plan/Act, and the
Cloudflare OS sandbox boundary. Database-backed integration files that require a disposable
PostgreSQL URL and Cloudflare OS external integration files without credentials were skipped and
remain separate gates.

GitHub Actions run `33257911887` independently repeated complete-history scanning, dependency
integrity, builds, tests, lint/types, every production Worker bundle, all 74 browser journeys, and
non-superuser PostgreSQL migration/RLS/Runtime-role verification for exact candidate
`2ae4f50751b907cf0e6aad817d675bc368dd8382`. The successful exact-SHA capture is retained outside
Git in the owner-controlled incident evidence set.

An audited 2026-08-30 Core documentation successor
`e34e2a01bfd596c55ca32430b097347839299391` added the exact outage deployment record and
documentation-authority regression without changing the deployed Runtime. GitHub Actions run
`33258923163` repeated the full gate successfully for that exact historical successor.

The matching audited Distribution baseline
`5452d35536505fd9c1efb7f650ccd9678c4442ad` pinned that Core successor and Cloudflare OS
`2328903878b8bb3d8e29af6187abe935a5738482`. Its single local/hosted release-gate implementation
passed typecheck, 55 tests, lint, compliance, reproducible SBOM drift detection, build, dependency
audit, real Git-bundle clone/object verification, deterministic clean-room install/update/backup
and restore preparation, ephemeral release signing, staged-package installation, and all seven
acquired CLI launchers. Mode-`0600` external evidence binds the exact three historical commits and
manifest hash. This is synthetic evidence and is not an independent purchaser-account installation
or production signing record.

Distribution GitHub Actions run `33259701128`, attempt 2, completed the same release gate
successfully at that exact commit after the account owner raised the exhausted Actions budget. The
machine-generated exact-SHA record is retained outside Git with the Core CI capture; the earlier
zero-step attempt is retained as outage history rather than treated as a source-test failure.

Exact-SHA hosted CI and anonymous Open Core acquisition records are captured from GitHub into
owner-controlled evidence outside both repositories. This snapshot deliberately records earlier
verified baselines instead of claiming to identify a mutable current Distribution HEAD: every later
candidate requires new CI and anonymous acquisition evidence for its exact Core, Distribution, and
Cloudflare OS commits.

## Current owner-production incident

The 2026-08-29 authenticated production audit reached Cloudflare Access successfully, but the Guild
application could not open its PostgreSQL session. Private Worker and provider evidence identified a
database compute-quota exhaustion, not an authentication, RLS, migration, or frontend failure. The
existing database remains unavailable, so authenticated Guild journeys are still blocked until its
service is restored.

All five production Workers now run the exact code-only recovery release
`2ae4f50751b907cf0e6aad817d675bc368dd8382`. Its mode-`0600` external evidence records base release
`2f5106dbbef14fd029979d3c0447458e3d7a3429`, exact reviewed Runtime patch hashes, existing-Secret
verification, rollback points, five active versions, and `databaseChanged: false`. Maintenance
reconciliation remains hourly and its database-backed jobs remain sequential; user-requested
dispatch remains immediate. A fresh authenticated browser verified the accessible unavailable state,
heading focus, and working retry action at desktop, 390 px, and 320 px. A fresh tab and the retry path
both produced zero browser-console errors and did not expose the provider quota message. Anonymous
Workshop access still redirects to Cloudflare Access and the direct Gatekeeper health URL remains
unavailable.

An exact-release production-smoke record was also generated from a clean detached worktree at
`2ae4f50751b907cf0e6aad817d675bc368dd8382` with the recorded Cloudflare OS submodule. It confirms
that all five active Workers are 100% on Versions annotated with that same release, unauthenticated
Workshop access returns the expected Access redirect, Webhook health returns 200 with no-store and
nosniff headers, and an unsigned Webhook request is rejected. No Access service credential was
configured for this run, so it does not claim an authenticated Guild journey.

This is deployed outage evidence, not normal production acceptance. The database preflight, complete
backup, release evidence, and end-to-end authenticated Guild smoke remain pending until the same
existing database resumes service.

## Remaining completion gates

- Install into a genuinely independent purchaser-owned Cloudflare, PostgreSQL, AI, Access, backup,
  and domain boundary; capture live v4 Installer evidence and Human first-run initialization.
- Run one successful live update and one deliberately failed authenticated-smoke update proving all
  previous Worker Versions were restored.
- Execute the generated two-phase restore verifier against a full independent purchaser-owned
  target, complete Break Glass recovery, and finalize the resulting purchaser-bound v2 evidence.
- Activate production release and entitlement signing custody with two physically independent
  offline devices and named Human approval.
- Obtain professional approval for commercial license, trademark, contribution rights, privacy,
  tax/billing, customer agreement, support, pricing, refund, incident response, and transitive LGPL
  obligations.
- Restore the same existing production database service, run its preflight, create and verify a
  complete backup, and capture exact-release authenticated Guild smoke. Do not replace it with an
  empty database.
Guild OS remains incomplete while any of these required matrix rows is not `Implemented and
verified`.
