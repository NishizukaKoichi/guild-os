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
  and identified in v3 installation evidence.
- Installed state v2 stores the exact Core pin, Worker Version inventory, and purchaser-bound
  deployment lock without Secret values.
- Updater uses the installed Core for backup verification, the candidate Core for preflight and
  deployment, applies only declared backward-compatible additive migrations, and restores recorded
  Worker Versions after a post-deployment failure.
- Installer and Updater require real Core production-smoke evidence and bind its SHA-256 into their
  own evidence. Synthetic fixture smoke cannot pass commercial readiness.
- The fail-closed readiness verifier keeps local rehearsal, independent purchaser deployment,
  signing custody, hosted CI, restore, and professional approval as separate evidence classes.

## Verified local baseline

On 2026-08-24 the current release candidate passed Core typecheck, tests, build, lint, dependency
audit, Cloudflare OS boundary tests, and 73 Playwright E2E journeys. Database-backed integration
files that require a disposable PostgreSQL URL and Cloudflare OS external integration files without
credentials were skipped and remain separate gates.

The Distribution passed typecheck, 38 tests, lint, compliance, build, dependency audit, and a
deterministic clean-room chain covering install, update, backup, isolated restore preparation,
expired-entitlement denial, Runtime continuity, and handover Secret redaction. This is synthetic
evidence and is not an independent purchaser-account installation.

## Remaining completion gates

- Push the exact Core and Distribution release-candidate commits and obtain green hosted CI for
  each exact SHA.
- Install into a genuinely independent purchaser-owned Cloudflare, PostgreSQL, AI, Access, backup,
  and domain boundary; capture live v3 Installer evidence and Human first-run initialization.
- Run one successful live update and one deliberately failed authenticated-smoke update proving all
  previous Worker Versions were restored.
- Perform a full restore into an independent purchaser-owned target, not only owner-controlled or
  synthetic restore preparation.
- Activate production release and entitlement signing custody with two physically independent
  offline devices and named Human approval.
- Obtain professional approval for commercial license, trademark, contribution rights, privacy,
  tax/billing, customer agreement, support, pricing, refund, incident response, and transitive LGPL
  obligations.
- Deploy production only with explicit authorization, a verified pre-deploy backup, exact-commit
  evidence, and authenticated post-deploy smoke.

Guild OS remains incomplete while any of these required matrix rows is not `Implemented and
verified`.
