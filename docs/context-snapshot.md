# Guild OS Context Snapshot

Updated: 2026-08-31

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

## Verified Core and Distribution baseline

On 2026-08-31 the exact Core candidate resolved from Git passed local typecheck, tests, build, lint,
dependency audit, peer-dependency checks, the complete dry-run build check, Cloudflare OS boundary
tests, and 74 Playwright E2E journeys. The E2E set covers desktop, tablet, 390 px and 320 px mobile,
English, Japanese, Simplified Chinese, accessibility, Purpose-first generation, Ask/Plan/Act, and
the Cloudflare OS sandbox boundary.

Exact-SHA Core CI evidence independently repeated complete-history scanning, dependency integrity,
builds, tests, lint/types, every production Worker bundle, all 74 browser journeys, and non-superuser
PostgreSQL migration/RLS/Runtime-role verification for that candidate. The successful run ID and
commit are retained outside Git in owner-controlled evidence and rechecked through GitHub rather
than copied into this self-changing document.

The separate Distribution's single local/hosted release gate passed typecheck, 62 tests, lint,
compliance, reproducible SBOM drift detection, build, dependency audit, real Git-bundle clone/object
verification, deterministic clean-room install/update/backup and restore preparation, ephemeral
release signing, staged-package installation, and all seven acquired CLI launchers. A matching
candidate now pins this audited Core documentation lineage and has repeated the local release gate,
exact-SHA hosted CI, and anonymous acquisition. This synthetic evidence is not an independent
purchaser installation or production signing record.

Exact-SHA hosted CI and anonymous Open Core acquisition records are captured from GitHub into
owner-controlled evidence outside both repositories. This snapshot deliberately does not identify a
mutable current Distribution HEAD: every candidate must bind its exact Core, Distribution, and
Cloudflare OS commits through external evidence.

## Current owner-production evidence

The existing production PostgreSQL service remains in place; it was not replaced with an empty
database. Before the 2026-08-31 Runtime deployment, the owner-controlled operations workspace created
and verified a complete PostgreSQL, KV, R2, and Access backup. Production preflight then confirmed
PostgreSQL 18, verified TLS, all 51 migrations, and forced RLS on all 96 protected tables.

All five production Workers run the exact Git-resolved Core candidate recorded in external release
evidence. Exact-SHA Core CI evidence passed the complete hosted gate, including 74 Playwright journeys
and the disposable PostgreSQL migration, forced-RLS, non-superuser management, and Runtime-role
suites. External mode-`0600` production evidence binds that release to the five active Worker
Versions, database preflight, the verified backup, the Cloudflare Access boundary, Webhook health and
signature rejection, and machine smoke. The earlier narrowly scoped Service Auth policy and token were
removed after authenticated smoke, the stale credential received the Access redirect instead of
application access, and the local credential file was deleted. The configured Human policy remained.

A separate authenticated Human browser journey verified Home, grounded Ask with a versioned citation,
an inspectable fallback Plan, explicit one-action confirmation, successful Act, the resulting Working
Memory, and matching append-only History events. English, Japanese, and Simplified Chinese switched in
the deployed UI without missing-key output. Desktop 1440 px, mobile 390 px, and minimum-width 320 px
each exposed the four primary actions with zero horizontal overflow; the 320 px page could scroll its
last content above the fixed navigation. The complete browser journey produced zero console errors.

This is current owner-controlled production evidence. It closes the database-restoration and normal
production-smoke gap, but it is not an independent purchaser installation, independent signing-custody
record, or professional legal approval.

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
Guild OS remains incomplete while any of these required matrix rows is not `Implemented and
verified`.
