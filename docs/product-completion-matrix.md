# Guild OS Product Completion Matrix

Updated: 2026-08-21

Authority: [Product specification](product-specification.md)

This is an evidence register, not a marketing checklist. `Implemented and verified` requires the
real data and authorization boundary plus automated or operational evidence. A row remains partial
when one required behavior is absent, even if most of the area exists.

## Audit snapshot

| Fact | Evidence at audit start |
| --- | --- |
| Core repository | `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os` |
| Branch and HEAD | `main` at `6f3a82d7387d9e6357661c0311403ef92e817b82` before the Runtime-role release commit |
| Remote divergence | `6f3a82d7387d9e6357661c0311403ef92e817b82` was pushed; the Runtime-role release change is intentionally uncommitted until all gates complete |
| Origin | `origin/main` at `6f3a82d7387d9e6357661c0311403ef92e817b82` |
| Local-only work | Separate PostgreSQL management/Runtime role provisioning, deploy preflight, CI coverage, and operating documentation |
| Worktree | Modified only by the audited Runtime-role release change |
| Cloudflare OS | Pinned submodule `bba32ca8fab7b9925f5b1a3e7e36c4d37f788ff5` |
| Production | Existing purchaser deployment remains untouched; all five active Worker annotations point to Core commit `72301b3bd537655ef7f148837e52eee1b669caaf` |
| Staging database | Temporary schema-only Neon branch `br-plain-shadow-a7v9pgvf`; migrations `0001`-`0050`, PostgreSQL 18, TLS `verify-full`, forced RLS on 96 tables, and a separate least-privileged `guild_runtime_app` role verified |
| Real database tests | Runtime role passed 19 PostgreSQL files / 72 tests and 14 Gatekeeper files / 33 tests; schema-management credentials were not supplied to either integration suite |
| Production database | Existing production remains on its previous release boundary; no migration or credential change was made during staging preparation |
| Production authenticated smoke | **Blocked by external credential**: no Access service-token environment was present |
| Distribution repository | Missing at audit start; now created as the separate Git root `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os-distribution` |
| Core license | Apache License 2.0 retained; direct Cloudflare OS notices present |

## Canonical requirements

| Section | Area | Current status | Evidence and remaining gap |
| ---: | --- | --- | --- |
| 1 | Product definition | Implemented and verified | Actor-neutral types, UI profiles, README, ADR 0029, and Core tests exist. |
| 2 | Product lines | Implemented and verified | Apache Core remains separate from the new Owned Distribution Git root; optional Care and perpetual-runtime boundaries are documented. |
| 3 | Purchaser ownership and direct costs | Implemented but unverified | Deployment config and runbooks use purchaser resources; no fresh independent-account clean-room evidence. |
| 4 | Perpetual runtime and update entitlement | Implemented and verified | Offline signed entitlement gates only new package acquisition; expiry and tamper tests prove installed-runtime continuity without a seller network. |
| 5 | Open Core and Distribution boundary | Implemented and verified | Separate Git roots, exact Core pin, static contamination checks, Apache notices, and package tests enforce the boundary. |
| 6 | EULA, trademark, contribution, notices, SBOM | Blocked by legal review | Technical drafts, CycloneDX SBOM, generated notices, and a fail-closed license gate exist. Final EULA, trademark, privacy, tax, and contribution-rights approval requires qualified professionals; the transitive LGPL libvips obligation is explicitly held for review. |
| 7 | First-run choices | Implemented and verified | Personal default plus Company, Research, Community, guided Other, and advanced profiles have E2E coverage. |
| 8 | Purpose-first Builder | Implemented and verified | Eight answers generate the complete schema-v2 Blueprint; full review/edit/save/version/duplicate/export/reuse/Space override and separate Level 3 authority-migration proposal are tested. |
| 9 | Unknown-Collective E2E | Implemented and verified | Family, school, sports team, NPO, DAO, cooperative, and civic-community journeys pass without code or Blank fallback; EN/JA/zh-CN at 320px also pass. |
| 10 | Personal + AI | Implemented and verified | Guided minimal setup, bounded assistant, and no external-write defaults are covered by domain, bootstrap, and E2E tests. |
| 11 | Core ontology | Implemented and verified | Neutral Actor/Membership/Role/Capability/Space substrate and compatibility layer exist with forced RLS tests. |
| 12 | Memory | Implemented and verified | Neutral Memory, governed Knowledge, provenance, semantic/lexical prefilter, versioned citations, review, and stale/contradiction candidates exist. |
| 13 | Activity | Implemented and verified | Recursive typed Activity and compatibility workflows exist with integration and E2E coverage. |
| 14 | Decision and governance | Implemented and verified | Every authoritative method is first-class, with additive fail-closed database compatibility, Constitution, transfer, Break Glass, evidence, and quorum tests. |
| 15 | Standard navigation and contextual language | Implemented and verified | Permission-aware Home/Ask/Members/Memory/Activity/More navigation, contextual vocabulary, direct links, history, and responsive navigation are covered by E2E. |
| 16 | Home | Implemented and verified | Permission-aware action-first Home, attention, partial failure, Agents, updates, and risks have E2E coverage. |
| 17 | Ask / Plan / Act | Implemented and verified | Read-only Ask, citations, inspectable proposals, one-at-a-time execution, Actor/Connection, cost/time estimate, effect scope, approval, and rollback semantics are represented and tested. |
| 18 | Agent | Implemented and verified | Limits, policy intersection, approvals, delegation, Kill, idempotency, authority recheck, and execution evidence exist. |
| 19 | Connections | Implemented and verified | Cloudflare OS Gatekeeper, MCP, HTTPS Webhook, Service Binding, Email, Calendar, File Storage, Git Repository, External API, and Model Provider use scoped purchaser-owned adapters, Secret references, health, and revocation. |
| 20 | Automation | Implemented and verified | Schedules, event triggers, waits, retry, delegation, deduplication, Kill, and offboarding cancellation exist. |
| 21 | Federation | Implemented and verified | Explicit grants, selected-resource scope, signed delivery, revocation, delivery history, and no ambient index exist. |
| 22 | Communication | Implemented and verified | Announcements, Inbox, conversations, private promotion with provenance, and privacy-minimized Chronicle exist. |
| 23 | Onboarding and offboarding | Implemented and verified | Role/Space onboarding and transactional offboarding/handover are integration-tested. |
| 24 | Contribution | Implemented and verified | Evidence-backed multidimensional records and correction requests exist; no single score. |
| 25 | Data ownership classes | Implemented and verified | Guild/Personal/Shared/Connected/Derived boundaries and prefiltered search are represented and tested. |
| 26 | Export, retention, migration | Implemented and verified | Logical export, retention dry-run/apply/checkpoints, reauthentication, Chronicle, and R2 outbox are implemented and tested. |
| 27 | Backup and restore | Implemented but unverified | Complete Core tooling and Distribution backup verification/isolated restore preparation tests exist; a real purchaser-owned PostgreSQL/R2/KV restore rehearsal for the final Core commit is still required. |
| 28 | i18n and accessibility | Implemented and verified | English default, complete EN/JA/zh-CN dictionaries, missing-key test, axe, keyboard, and viewport E2E exist for the current UI. |
| 29 | Commercial Installer | Implemented but unverified | Signed-package `init`, `verify`, `plan`, and `deploy` flows, purchaser account verification, preflight, smoke, and sanitized handover are locally tested; a real fresh purchaser Cloudflare/DB installation remains external-credential blocked. |
| 30 | Updater | Implemented but unverified | Signed manifest, exact pins, compatibility, entitlement, backup, migration dry run, build/deploy/migrate/smoke, Worker rollback, and evidence are locally tested; a real purchaser update remains external-credential blocked. |
| 31 | Commercial offering | Implemented and verified | Owned, Update Plan, optional Care, custom migration, direct provider costs, and draft pricing/support boundaries are documented without Runtime price hardcoding. |
| 32 | Seller independence | Implemented and verified | Static boundary checks, empty seller-dependency manifests, local clean-room evidence, and expired-entitlement tests prove no standard Runtime call-home or seller kill dependency. |
| 33 | Security baseline | Implemented but unverified | RLS, TLS, prefilter, Secrets, immutable evidence, idempotency, Kill, Break Glass, signed bundles, SBOM/license gate, rollback, and separate management/Runtime database roles pass real PostgreSQL; authenticated cloud staging remains. |
| 34 | Explicit non-goals | Implemented and verified | Exclusions are documented and absent from the Core product surface. |
| 35 | Current-state audit | Implemented and verified | This matrix records Git, remote, submodule, production annotation, migration inventory, licensing, and Distribution state. |
| 36 | Gap Matrix and authoritative acceptance | Implemented and verified | The 42-section specification is the authority; this matrix and Full-Spec Acceptance include Core, Distribution, external validation, and legal gates without shrinking completion. |
| 37 | Safe implementation sequence | In progress | Core and Distribution implementation, local gates, and separate commits are complete; credential-bound cloud installation, staging, and release stages remain. |
| 38 | Required test coverage | Implemented but unverified | Builder, Personal, profiles, Space context, Ask/Plan/Act, permissions, Distribution, expiry, rollback, restore preparation, i18n, mobile, accessibility, and all PostgreSQL/Gatekeeper integration tests pass. Real cloud clean-room and authenticated smoke remain. |
| 39 | Technical completion | Missing | Multiple required rows are partial/missing/unverified and staging evidence is absent. |
| 40 | Sale readiness | Blocked by legal review | Professional legal, privacy, tax, pricing, refund, and support review cannot be replaced by implementation. |
| 41 | Final evidence report | Implemented but unverified | Exact local Core and Distribution commits, test evidence, and the pinned Core release are recorded; push/CI, purchaser-owned staging, and authenticated smoke evidence are not available. |
| 42 | Final product promise | Implemented but unverified | The Core adapts to purpose and language and the Distribution owns the lifecycle without seller runtime custody; the complete promise still needs a real independent installation rehearsal. |

## Completion rule

Guild OS remains incomplete while any row is not `Implemented and verified`. Legal sale readiness
remains a separate professional gate even after technical completion.
