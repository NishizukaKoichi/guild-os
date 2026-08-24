# Guild OS Full-Spec Acceptance

Updated: 2026-08-22

The authoritative requirements are in [the product specification](product-specification.md), and
their current evidence state is in [the product completion matrix](product-completion-matrix.md).
This document is the executable release contract for that complete specification. A feature is not
complete because a type, table, route, or mock exists. `Complete` requires the production data
boundary, authorization, user journey, automated acceptance evidence, operational documentation,
and deployed smoke evidence to agree.

The earlier twelve-item MVP remains a required subset, not the product completion boundary.

## Product contract

Guild OS is an Actor-neutral Collective OS in which Humans, Agents, Services, and other Guilds can
share governed Memory, Activity, Decisions, communication, Connections, execution, and History.
Cloudflare OS supplies the purchaser-owned agent and application runtime. Guild OS supplies the
collective system of record, permission context, policy, approval, and evidence.

One deployment is one independently owned Guild. Federation is explicit and revocable; it never
creates an implicit cross-Guild search index or shared seller-controlled tenant.

## Acceptance matrix

| Area | Required production behavior | Evidence required |
| --- | --- | --- |
| Sovereignty | Human Root Custodian, Constitution, two-party transfer, Break Glass, retention, public defaults, Agent limits, and departure policy | PostgreSQL invariants, isolated destructive rehearsal, Settings UI, Chronicle |
| Actors | Human, Agent, Service, and Guild use one Actor/Membership/Role/Capability path | Domain, RLS integration, unified Members E2E |
| Context Graph | Actors, Memory, Activity, Decisions, Events, and external sources can be linked and traversed without bypassing each subject boundary | Relation integrity, permission-prefiltered graph queries, UI and E2E |
| Memory | Canonical, Working, and External layers; candidates; versions; files; provenance; review; deprecation; stale and contradiction review | RLS/search tests, R2 tests, Ask citations, review UI |
| Semantic retrieval | Lexical plus semantic retrieval over authorized candidates only; vector data is a rebuildable derivative, never the source of truth | SQL-before-model/vector ordering tests, index rebuild runbook, production Ask smoke |
| Activity | Recursive typed Activity, dependencies, assignments, outcomes, and Template/Space-specific choices | Domain, PostgreSQL, Activity E2E |
| Decisions | Custodian, consent, vote, quorum vote, review, editorial, council, policy, hybrid, Agent proposal plus Human approval, and custom methods with evidence and append-only participation | Quorum/policy tests, Decisions E2E |
| Communication | Role/Space announcements, Inbox, contextual conversations, and explicit private messages that do not enter Guild Memory automatically | Current-authority read tests, privacy E2E, Chronicle without message plaintext |
| Onboarding | Template/Role/Space-aware pre-join journey, required Memory, confirmation, initial Activity, and progress | Assignment/update tests and onboarding E2E |
| Offboarding | Immediate access/token/schedule stop plus explicit handover of open Activity, owned files, and governed drafts | Atomic integration tests, handover UI, Chronicle |
| Contribution | Evidence-backed multidimensional Contribution Graph with correction requests; no single employee score | Event projection tests and responsive UI |
| Data ownership | Guild, Personal, and explicitly Shared data boundaries; export, backup, migration, and retention behavior | RLS tests, export verification, backup/restore rehearsal |
| Ask | Ask is read-only; Plan creates an inspectable proposal; Act uses policy and approval. It can find Memory/Members/Decisions and propose Memory, Activity, assignment, approval, and Connection actions. Every Act preview identifies the executing Actor, Connection, estimated provider cost and duration, internal or external effect, and rollback semantics | Intent/risk tests, prompt-boundary tests, Ask/Plan/Act E2E |
| Agents | Model, skills, tools, Connections, schedule, budget, tokens, time, steps, retry, delegation, approval, evidence, Kill, idempotency, and failed/near-limit attention | Four risk levels, limit/race tests, execution E2E |
| Connections | Multiple typed purchaser-owned Connections for Cloudflare OS Gatekeeper, MCP, HTTPS Webhook, Service Binding, Email, Calendar, File Storage, Git Repository, External API, and Model Provider, with scoped capabilities, purchaser Secret references, health, and revocation | Adapter contract tests, discovery filtering, Connections UI |
| Automation | Scheduled runs, event triggers, durable approval waits, bounded retries, and executable Agent-to-Agent delegation | Workflow tests, trigger deduplication, Kill/offboarding races |
| Federation | Another Guild can be an Actor; selected Memory, Activity, and Decisions can be shared through an explicit revocable federation grant | Cross-deployment contract, no-ambient-sharing tests, Federation UI |
| Templates and Purpose-first Builder | Personal with AI, Company, Community, Research, Creator, Open Source, Agent Collective, and Blank remain reusable presets. Other asks eight natural-language questions covering purpose, participants, Memory, Activity, Decisions, language/theme, outward AI actions, and mandatory Human confirmation. It generates a reviewable Blueprint containing name, purpose, vocabulary, visual theme, Spaces, Roles and Capabilities, Membership labels, Memory types/workflows, Activity types/states, Decision methods, approval policies, Home, Workflows, Agents, Agent capabilities/limits, Connection suggestions, onboarding, offboarding, retention, and export policy. A purchaser can edit, save, version, duplicate, export, reuse, and apply it without code, including Space overrides. Authority changes require a separate impact-reviewed migration proposal. Blank is advanced manual setup, never the fallback. | Domain/schema/API tests; family, school, sports team, NPO, DAO, cooperative, and civic-community browser journeys; English/Japanese/Simplified Chinese at 1440/390/320; explicit tests that generation and Profile assignment do not alter existing authority |
| Owned Distribution | A separate `guild-os-distribution` repository pins an exact Apache Core release and contains the official Installer, Updater, signed bundle, diagnostics, entitlement, compliance outputs, legal drafts, and handover material without importing private code into Core | Separate Git root, boundary tests, exact Core pin, package tests, bundle manifest, artifact inventory |
| Installer | A purchaser can preflight, configure, dry-run, migrate, deploy, authenticated-smoke, and receive recovery/handover evidence entirely in purchaser-owned infrastructure without sending Secrets to the seller. The purchaser owns the Access application and smoke Service Token; the Installer verifies those exact objects and creates only exact Human administrator and token-specific Service Auth policies. Explicit Human Root initialization remains first run, not an automated credential bypass. | Deterministic clean-room run, independent purchaser installation, Secret-leak test, Cloudflare REST contract, exact Access-policy test, failure cleanup, real smoke evidence hash, v3 installation evidence, sanitized handover report |
| Updater and entitlement | Signed exact-commit releases update in place only after compatibility, an old-Core backup, migration dry-run and preflight, backward-compatible additive migration, candidate build/deploy, authenticated smoke, and rollback preparation. Deployment lock and Worker Version IDs remain exact. Entitlement expiry blocks new downloads only and never affects installed runtime or export | Signature/tamper tests, expiry runtime test, successful update, failed-smoke Worker rollback, retained-schema evidence, release evidence |
| Signing-key custody | Release and entitlement use separate encrypted keys outside Git. Candidate keys require two signed offline-backup attestations from distinct observed filesystem devices, Human confirmation of independent physical failure boundaries, and named Human activation. The public trust state is signed by both keys; normal acquisition accepts active keys only, historical audit may explicitly accept retired keys, and revoked keys are always denied | File-permission, wrong-passphrase, repository-boundary, duplicate-device, primary-device, backup-attestation, trust-state tamper, activation, retirement, revocation, and historical-verification tests; sanitized operational evidence outside Git |
| Compliance | Core remains Apache-2.0. Distribution preserves all Core/submodule licenses and notices, generates SPDX or CycloneDX SBOM, inventories shipped components, and fails closed on unknown or disallowed licenses | Automated license/SBOM gate and bundle inspection; legal drafts marked for professional review |
| Seller independence | Installed runtime has no seller API, database, license, AI proxy, Secret, domain, backup, telemetry, or kill-switch dependency | Static boundary scan plus offline/expired-entitlement runtime acceptance |
| Commercial operations | Export, encrypted backup, isolated restore, customer-owned migration, support boundary, and optional Care are documented and operable without perpetual seller labor | Clean-room handover, backup/restore rehearsal, commercial draft docs, diagnostics |
| Sale readiness | Commercial license, trademarks, contribution rights, privacy, tax/invoicing, customer terms, support, pricing, refund, and incident process receive qualified professional review | Signed external review record; code or AI review alone is insufficient |
| Internationalization | English default with complete English, Japanese, and Simplified Chinese UI dictionaries; user content remains original unless explicitly translated | Missing-key test and three-locale E2E |
| Experience quality | Home exposes the four daily intentions before structure; permitted destinations support direct links, Back, Forward, and reload; one permission-aware Search or create entry works by pointer, touch, and `Command/Control + K`; initialization asks only for the selected starting profile, purpose, display name, and explicit Root acceptance in the common path; invitation links remove one-time credentials from the address after reading them; partial failures never produce a false all-clear; dialogs manage focus and unsaved drafts; all primary operations have pending, success, error, retry, and single-flight behavior appropriate to their effect | `experience-quality.spec.ts`; keyboard and focus assertions; critical/serious axe violations at zero; 1440 x 1000, 1280 x 800, 768 x 1024, 390 x 844, and 320 x 568 without unintended horizontal overflow; English, Japanese, and Simplified Chinese E2E; ignored before/after browser evidence documented in `docs/ux-quality-audit.md` |
| Operations | Purchaser-owned deploy, model/provider configuration, observability, export, backup, restore, rollback, and administrator handover | Clean-room setup, checksummed backup, isolated restore, release evidence |

The commercial readiness verifier is part of this acceptance boundary. It must reject synthetic or
injected Installer/Updater evidence, seller-owned Cloudflare accounts, owner-only restore
preparation, inactive signing custody, draft professional approvals, stale CI, and evidence from a
different commit. Passing local Core or Distribution tests is necessary but cannot satisfy those
external gates.

## Explicit exclusions

Guild OS does not implement payroll, accounting, CRM, video meetings, a complete email client,
employee surveillance, keystroke monitoring, a single personnel score, automatic Root acquisition,
unapproved transfer of money, unlimited delegation, or automatic promotion of model output to
Canonical Memory. Those are intentional product boundaries from the specification, not unfinished
features.

## Release gate

The full specification is complete only when every row above and every section of the product
completion matrix is `Implemented and verified`, every relevant local
gate passes, a clean commit is pushed, CI passes, a verified pre-deploy backup exists, migrations
and restore preparation pass, the exact commit is deployed, and authenticated production journeys
pass without modifying unrelated live data.

Fixed presets alone do not satisfy the Templates row. Guild OS may claim to be a general
Collective OS only when a collective absent from those presets can explain its purpose and create
its own structure and language without code.

Experience quality is a release gate, not a screenshot review. Existing browser workflows must not
be removed to make the suite pass. A release candidate must complete the Root, member, invitation,
initialization, Ask/Plan/Act, Memory, Activity, Inbox, error-recovery, mobile, keyboard, and sandbox
journeys with no page errors or console errors. Navigation visibility remains presentation only;
API permissions, PostgreSQL RLS, governance, and Chronicle remain the authority boundary.
