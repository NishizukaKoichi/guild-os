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
| Branch and HEAD | `main` at pushed restore-safe release commit `63de2470e6ec7e5c4783ed947e54de7c78534eee` before this evidence-only documentation update |
| Remote divergence | None at restore rehearsal time; `main` and `origin/main` both pointed to `63de2470e6ec7e5c4783ed947e54de7c78534eee` |
| Origin | `origin/main` contains the exact staging and restore source release `63de2470e6ec7e5c4783ed947e54de7c78534eee` |
| Local-only work | None in the Core staging source; purchaser-specific configuration and resource locks remain ignored outside the reusable source state |
| Worktree | Clean detached staging worktree at exact Core commit `63de2470e6ec7e5c4783ed947e54de7c78534eee`; the temporary restore worktree was removed after evidence capture and resource cleanup |
| Cloudflare OS | Pinned submodule `bba32ca8fab7b9925f5b1a3e7e36c4d37f788ff5` |
| Production | Existing purchaser deployment remains untouched; all five active Worker annotations point to Core commit `72301b3bd537655ef7f148837e52eee1b669caaf` |
| Staging database | Temporary Neon branch `br-plain-shadow-a7v9pgvf`; migrations `0001`-`0051`, PostgreSQL 18, TLS `verify-full`, forced RLS on 96 tables, and a separate least-privileged `guild_runtime_app` role verified. Human Access initialization then created one synthetic Personal Guild, one Human Root, one bounded Agent, two Services, six Roles, and 19 Chronicle events. |
| Real database tests | Runtime role passed 19 PostgreSQL files / 72 tests and 14 Gatekeeper files / 33 tests; schema-management credentials were not supplied to either integration suite |
| Production database | Existing production remains on its previous release boundary; no migration or credential change was made during staging preparation |
| Purchaser-owned staging | Five isolated staging Workers, dedicated Hyperdrive, KV, and R2 resources were deployed from exact Core commit `63de2470e6ec7e5c4783ed947e54de7c78534eee`; existing production Workers and data were untouched |
| Authenticated staging smoke | Passed. Unauthenticated traffic redirects to the configured Access tenant, a temporary scoped Service Token reached the Workshop, the reference receiver rejected unsigned writes, all five active Worker versions matched the exact release, and Human Google Access completed Personal-Guild initialization through the Cloudflare OS iframe and Hyperdrive. The temporary Service Auth policy and credential were then removed; the Human policy remains. Evidence is stored outside Git under `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os-staging-evidence/`. |
| Full-store restore rehearsal | Passed from the encrypted staging backup into a separate temporary Neon branch and newly created Hyperdrive, KV, R2, Access, Workflow, and five Worker resources. All 96 forced-RLS table counts matched, Chronicle restored through sequence `2888`, all five KV values and all three R2 objects matched exact hashes, authenticated smoke passed, and the real Break Glass Root-transfer flow completed. Measured RPO was zero for the verified backup and measured RTO was 40m 46.571s. Checksummed rehearsal and cleanup evidence is stored outside Git as `restore-63de247.rehearsal.json` and `restore-63de247.cleanup.json`. All temporary cloud resources and credentials were removed afterward. This proves owner-controlled isolated restore, not an independent purchaser-account installation. |
| Hosted CI | **Blocked by external account state**: Core Runtime-source run `32478728406` at `63de2470e6ec7e5c4783ed947e54de7c78534eee` and Distribution run `32479510084` at `f851b8870a9a7f7d8526214c68aee418fa4152df` both failed with zero executed steps because account billing or spending limits require owner action; local equivalent gates are green. Evidence-only documentation pushes fail at the same zero-step boundary until the account state changes. |
| Distribution repository | Separate Git root `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os-distribution`; pushed commit `f851b8870a9a7f7d8526214c68aee418fa4152df` pins Core `63de2470e6ec7e5c4783ed947e54de7c78534eee` and refreshes the signed release and compliance evidence |
| Distribution staging preflight | Passed against the owner-controlled staging Cloudflare account and least-privileged Neon Runtime role. Signed release `0.1.0-staging.20260821.2`, exact Core pin, TLS `verify-full`, all required Secret references, and an empty seller-runtime dependency set were verified. Checksummed evidence is stored outside Git under `/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os-staging-evidence/distribution-f851b88.preflight.json`. This does not replace an independent fresh-account installation. |
| Temporary rehearsal credentials | All four temporary Cloudflare API tokens, the Access Service Token, its three temporary policies, and the target-only Break Glass plaintext code were revoked or deleted after verification. Only the encrypted backup volume passphrase remains in purchaser-controlled Keychain custody. |
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
| 27 | Backup and restore | Implemented and verified | A complete encrypted backup of exact Core `63de2470e6ec7e5c4783ed947e54de7c78534eee` was verified and restored into isolated owner-controlled PostgreSQL, Hyperdrive, KV, R2, Access, Workflow, and Worker resources. All 96 forced-RLS table counts, Chronicle sequence `2888`, five KV value hashes, three R2 object hashes/metadata, authenticated smoke, and Break Glass Root recovery passed. RPO was zero for the verified set and RTO was 40m 46.571s; cleanup evidence proves temporary resources and credentials were removed. Independent-account ownership remains Section 3 and Installer evidence, not a missing restore behavior. |
| 28 | i18n and accessibility | Implemented and verified | English default, complete EN/JA/zh-CN dictionaries, missing-key test, axe, keyboard, and viewport E2E exist for the current UI. |
| 29 | Commercial Installer | Implemented but unverified | Signed-package `verify` now passes against the real staging Cloudflare account, Runtime-only PostgreSQL credentials, Access credentials, and final Distribution commit; `init`, `plan`, deploy, smoke, and sanitized handover also pass automated tests. A complete fresh independent purchaser Cloudflare/DB installation remains external-account blocked. |
| 30 | Updater | Implemented but unverified | Signed manifest, exact pins, compatibility, entitlement, backup, migration dry run, build/deploy/migrate/smoke, Worker rollback, and evidence are locally tested; a real purchaser update remains external-credential blocked. |
| 31 | Commercial offering | Implemented and verified | Owned, Update Plan, optional Care, custom migration, direct provider costs, and draft pricing/support boundaries are documented without Runtime price hardcoding. |
| 32 | Seller independence | Implemented and verified | Static boundary checks, empty seller-dependency manifests, local clean-room evidence, and expired-entitlement tests prove no standard Runtime call-home or seller kill dependency. |
| 33 | Security baseline | Implemented and verified | RLS, TLS, prefilter, Secrets, immutable evidence, idempotency, Kill, Break Glass, signed bundles, SBOM/license gate, rollback, and separate management/Runtime roles pass real PostgreSQL. Cloudflare Access denies unauthenticated traffic, the configured Human policy remains, Human initialization persisted through the Runtime Hyperdrive boundary, and all temporary API/Service credentials and Service Auth policies used for rehearsal were revoked afterward. |
| 34 | Explicit non-goals | Implemented and verified | Exclusions are documented and absent from the Core product surface. |
| 35 | Current-state audit | Implemented and verified | This matrix records Git, remote, submodule, production annotation, migration inventory, licensing, and Distribution state. |
| 36 | Gap Matrix and authoritative acceptance | Implemented and verified | The 42-section specification is the authority; this matrix and Full-Spec Acceptance include Core, Distribution, external validation, and legal gates without shrinking completion. |
| 37 | Safe implementation sequence | In progress | Core and Distribution implementation, local gates, push, isolated owner-controlled staging, exact-release evidence, Access smoke, Human initialization, signed Distribution, real-account Installer preflight, and isolated full-store restore are complete. Fresh independent-account Installer/Updater rehearsal remains. |
| 38 | Required test coverage | Implemented but unverified | Builder, Personal, profiles, Space context, Ask/Plan/Act, permissions, Distribution, expiry, rollback, restore preparation, i18n, mobile, accessibility, and all PostgreSQL/Gatekeeper integration tests pass. Real Access-protected cloud smoke, Personal initialization, Installer preflight, and full-store restore also pass; fresh-account clean-room Installer/Updater remains. |
| 39 | Technical completion | Missing | Independent-account clean-room install/update, hosted CI execution, production signing-key custody, and other rows marked unverified remain. |
| 40 | Sale readiness | Blocked by legal review | Professional legal, privacy, tax, pricing, refund, and support review cannot be replaced by implementation. |
| 41 | Final evidence report | Implemented but unverified | Exact pushed Core and Distribution commits, signed manifest, isolated staging resource/version evidence, Runtime-role database verification, Access smoke, Human initialization, Installer preflight, encrypted backup, isolated full-store restore, Break Glass recovery, RPO/RTO, and cleanup are recorded outside Git. Hosted CI is externally billing-blocked, and fresh-account installation/update plus formal production signing custody remain. |
| 42 | Final product promise | Implemented but unverified | The Core adapts to purpose and language and the Distribution owns the lifecycle without seller Runtime custody; deployed staging proves the Human/Agent/Access/Hyperdrive path and real-account preflight. An independent purchaser-account installation rehearsal is still required. |

## Completion rule

Guild OS remains incomplete while any row is not `Implemented and verified`. Legal sale readiness
remains a separate professional gate even after technical completion.
