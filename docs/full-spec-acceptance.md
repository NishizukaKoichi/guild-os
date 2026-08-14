# Guild OS Full-Spec Acceptance

Updated: 2026-08-14

This document is the release contract for the complete Guild OS specification. A feature is not
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
| Decisions | Custodian, consent, vote, review, editorial, policy, and hybrid methods with evidence and append-only participation | Quorum/policy tests, Decisions E2E |
| Communication | Role/Space announcements, Inbox, contextual conversations, and explicit private messages that do not enter Guild Memory automatically | Current-authority read tests, privacy E2E, Chronicle without message plaintext |
| Onboarding | Template/Role/Space-aware pre-join journey, required Memory, confirmation, initial Activity, and progress | Assignment/update tests and onboarding E2E |
| Offboarding | Immediate access/token/schedule stop plus explicit handover of open Activity, owned files, and governed drafts | Atomic integration tests, handover UI, Chronicle |
| Contribution | Evidence-backed multidimensional Contribution Graph with correction requests; no single employee score | Event projection tests and responsive UI |
| Data ownership | Guild, Personal, and explicitly Shared data boundaries; export, backup, migration, and retention behavior | RLS tests, export verification, backup/restore rehearsal |
| Ask | Ask is read-only; Plan creates an inspectable proposal; Act uses policy and approval. It can find Memory/Members/Decisions and propose Memory, Activity, assignment, approval, and Connection actions | Intent/risk tests, prompt-boundary tests, Ask/Plan/Act E2E |
| Agents | Model, skills, tools, Connections, schedule, budget, tokens, time, steps, retry, delegation, approval, evidence, Kill, idempotency, and failed/near-limit attention | Four risk levels, limit/race tests, execution E2E |
| Connections | Multiple typed purchaser-owned Connections, including Cloudflare OS Gatekeepers/MCP and fixed HTTPS Webhooks, with scoped capabilities and revocation | Adapter contract tests, discovery filtering, Connections UI |
| Automation | Scheduled runs, event triggers, durable approval waits, bounded retries, and executable Agent-to-Agent delegation | Workflow tests, trigger deduplication, Kill/offboarding races |
| Federation | Another Guild can be an Actor; selected Memory, Activity, and Decisions can be shared through an explicit revocable federation grant | Cross-deployment contract, no-ambient-sharing tests, Federation UI |
| Templates | Personal with AI, Company, Community, Research, Creator, Open Source, Agent Collective, and Blank configure vocabulary, Roles, choices, methods, workflows, onboarding, Home, and suggested Agents; Personal is the guided default and Spaces may override | All-profile and first-run unit/E2E at 1440/390/320 |
| Internationalization | English default with complete English, Japanese, and Simplified Chinese UI dictionaries; user content remains original unless explicitly translated | Missing-key test and three-locale E2E |
| Operations | Purchaser-owned deploy, model/provider configuration, observability, export, backup, restore, rollback, and administrator handover | Clean-room setup, checksummed backup, isolated restore, release evidence |

## Explicit exclusions

Guild OS does not implement payroll, accounting, CRM, video meetings, a complete email client,
employee surveillance, keystroke monitoring, a single personnel score, automatic Root acquisition,
unapproved transfer of money, unlimited delegation, or automatic promotion of model output to
Canonical Memory. Those are intentional product boundaries from the specification, not unfinished
features.

## Release gate

The full specification is complete only when every row above is implemented, every relevant local
gate passes, a clean commit is pushed, CI passes, a verified pre-deploy backup exists, migrations
and restore preparation pass, the exact commit is deployed, and authenticated production journeys
pass without modifying unrelated live data.
