# Guild OS Context Snapshot

Updated: 2026-08-24

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
- The Core GitHub repository is currently private. Public Open Core acquisition is an explicit
  external publication gate, not an achieved property of the license file alone.
- `guild-os-distribution` is a separate commercial repository containing Installer, Updater,
  entitlement, signed-release, diagnostics, compliance, readiness, and handover packages.
- One Runtime deployment represents one independently owned Collective.
- Purchasers own Cloudflare, PostgreSQL, model-provider, domain, Secret, backup, and data resources.
- Runtime has no seller API, license server, AI proxy, telemetry, backup, domain, or kill dependency.
- Expired update access may reject a new package; it cannot stop an installed Runtime.

## Core implementation state

- Cloudflare OS is pinned at `bba32ca8fab7b9925f5b1a3e7e36c4d37f788ff5`.
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
- Core now generates the independent restore proof through a two-phase, read-only verifier. The
  pre-recovery artifact compares live PostgreSQL, KV, R2, Worker inventory, and authenticated smoke
  against the selected backup and target; the post-recovery artifact adds Break Glass consumption,
  Root recovery, Chronicle ordering, post-recovery smoke, RPO, and measured RTO. Distribution accepts
  only that generated `guild-os-restore-verification/v1` artifact and finalizes it as purchaser-bound
  `guild-os-restore-rehearsal/v2`; legacy hand-authored v1 evidence is rejected.

## Verified local baseline

On 2026-08-24 the current release candidate passed Core typecheck, tests, build, lint, dependency
audit, Cloudflare OS boundary tests, and 73 Playwright E2E journeys. Database-backed integration
files that require a disposable PostgreSQL URL and Cloudflare OS external integration files without
credentials were skipped and remain separate gates.

The source-complete Distribution candidate passed typecheck, 49 tests, lint, compliance, build,
dependency audit, real Git-bundle clone/object verification, and a
deterministic clean-room chain covering install, update, backup, isolated restore preparation,
expired-entitlement denial, Runtime continuity, and handover Secret redaction. This is synthetic
evidence and is not an independent purchaser-account installation.

The last externally captured source-complete baseline before this document update passed exact-SHA
hosted CI: Core run [`32711005802`](https://github.com/NishizukaKoichi/guild-os/actions/runs/32711005802)
at `c9d875461c4cc4c8ca16b76a861cf2d76aec271d`, and Distribution run
[`32713696163`](https://github.com/NishizukaKoichi/guild-os-distribution/actions/runs/32713696163)
at `1304fbee8e4a1fe81f45e037961c3ae648521710`. Authenticated capture records are stored outside
both repositories with SHA-256
`dd4005388cd811790b06fe68cb804a8500d895e3f3583b6133826aa6e4e5ff74` and
`034a59c230af13b4ef70001464d7f6dbb7da2128b349d94828c1b14b7a0f2fce`. These records prove only
those SHAs; every later candidate requires a new hosted-CI capture rather than a document edit.

## Remaining completion gates

- With explicit owner authorization, publish the Apache Core repository or an equivalent source
  release and prove unauthenticated clean acquisition plus self-installation.
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
- Deploy production only with explicit authorization, a verified pre-deploy backup, exact-commit
  evidence, and authenticated post-deploy smoke.

Guild OS remains incomplete while any of these required matrix rows is not `Implemented and
verified`.
