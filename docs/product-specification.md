# Guild OS Product Specification

Status: Authoritative

Updated: 2026-08-20

This document is the canonical product and implementation contract for Guild OS. When code,
README text, an ADR, a completion matrix, or an older acceptance document is narrower, this
document wins. Requirements may be implemented additively, but they must not be removed from the
completion boundary to match the current implementation.

`MVP complete`, `Core complete`, `CI green`, `release complete`, `local commit`, and `deployed`
describe milestones. None of them means the entire product is complete. Guild OS is technically
complete only when every requirement below is implemented and verified across the runtime,
authorization boundary, user journey, operations, distribution, and release evidence.

## 1. Product definition

Guild OS is an Actor-neutral Collective OS in which Humans, Agents, Services, and other Guilds
share governed Memory, Roles, Capabilities, Activity, Decisions, and History. It must support a
company, research collective, community, studio, school, household, NPO, cooperative, sports team,
civic body, DAO, open-source project, one Human with Agents, or an Agent-led Collective from one
neutral Core.

> **Guild OS — An operating system for human-AI collectives.**

The product name is Guild OS. A purchaser's Collective is displayed in its own language: Company,
Lab, Studio, Household, Collective, or a purchaser-defined term rather than an imposed `Guild`.

## 2. Product lines

- **Guild OS Core** is this `guild-os` repository and remains Apache-2.0 Open Core.
- **Guild OS Owned** is a separate `guild-os-distribution` repository containing the official
  customer-owned Distribution, Installer, Updater, signed releases, setup wizard, diagnostics,
  migration, backup/restore orchestration, and commercial documents.
- **Guild OS Care** is optional support and update service. Ending Care must not stop an installed
  runtime.

## 3. Ownership and costs

The purchaser owns and pays providers directly for Cloudflare, PostgreSQL, AI providers, domain,
data, Secrets, backups, and the deployed runtime. Seller accounts are limited to development, CI,
the synthetic demo, and distribution. One runtime deployment represents one independently owned
Collective. Multiple deployments may be managed together without sharing their data boundary.

## 4. Perpetual runtime and updates

An installed version remains usable after an update entitlement ends. Entitlement controls access
to new packages only. Runtime license checks, seller phone-home, seller kill switches, hidden
telemetry, or seller data access are prohibited. An offline entitlement may authorize downloads,
but expiry must never degrade an installed runtime or block export and recovery.

## 5. Open Core and Distribution boundary

The Apache Core and proprietary Distribution remain separate repositories. Distribution pins an
exact Core release or commit and preserves every Apache copyright, license, NOTICE, and modification
obligation for bundled Core material. Commercial-only assets use separable packages and documented
interfaces. Neither repository may contain purchaser data, seller or purchaser credentials, or a
private signing key.

The Distribution contains, at minimum, Installer, Updater, release bundle, deployment wizard,
diagnostics, entitlement, templates, docs, legal drafts, third-party notices, trademarks,
copyright records, and SBOM artifacts.

## 6. Legal and compliance artifacts

Distribution includes an EULA draft, trademark policy, contribution policy, third-party notices,
and SPDX or CycloneDX SBOM. Every unreviewed legal document is marked
`DRAFT - LEGAL REVIEW REQUIRED`. Release automation fails closed on unknown or commercially
incompatible dependency licenses. Legal review is an external sale-readiness gate and cannot be
replaced by an AI review.

## 7. First-run choices

The primary choices are Personal + AI, Company, Research, Community, and Other Collective.
Personal + AI is recommended and selected by default. Creator, Open Source, and Agent Collective
may remain advanced choices. Blank is an advanced fully manual path. Other Collective must never
fall through to Blank.

## 8. Purpose-first Collective Builder

Other Collective asks, in natural language:

1. Why does this Collective exist?
2. Who or what participates?
3. What should it remember?
4. What activities does it perform?
5. How does it decide?
6. What language, tone, or world should it use?
7. What may outward-facing AI do?
8. What must always require Human confirmation?

Answers must generate a reviewable Blueprint, not merely be stored. The Blueprint contains the
Collective name and purpose, vocabulary, visual theme, initial Spaces, Roles, Capabilities,
Membership labels, Memory types and workflows, Activity types and states, Decision methods,
approval policies, Home layout, recommended workflows and Agents, Agent capabilities and limits,
Connection suggestions, onboarding, offboarding, retention, and export policy. It can be edited,
saved, versioned, duplicated, exported, reused, and assigned at Guild or Space scope without code.

Applying a Profile or Blueprint must not mutate existing authority. Changes to Roles,
Capabilities, Constitution, approval policy, Connection scope, or Agent permissions require a
separate, explicit migration proposal with impact preview.

## 9. Purpose-first acceptance collectives

Family, school, sports team, NPO, DAO, cooperative, and civic community must each generate natural
names, Roles, Memory, Activity, Decisions, Home actions, and Agent proposals in browser E2E without
code edits or Blank setup. English, Japanese, and Simplified Chinese must work at 1440, 390, and
320 pixels.

## 10. Personal + AI

Personal + AI starts with display name, language, optional Collective name, and explicit Root
Custodian responsibility. It provisions one bounded Personal Assistant. Initial permissions may
cover authorized Memory search, summaries, drafts, Activity proposals, Plans, and internal
organization. Email, external posting, publication, payment, permission changes, deletion,
production deployment, and other external writes require a configured Connection and explicit
Human approval. Personal Memory is never ambiently shared with another Collective.

## 11. Neutral Core ontology

The canonical primitives are Collective, Actor, Membership, Space, Role, Capability, Policy,
Memory, Activity, Decision, Conversation, Connection, Automation, Run, Event, Federation Grant,
Template, and Context Profile. Actor kinds are `human`, `agent`, `service`, and `guild`, using one
Membership and authorization system. Canonical Membership states are `invited`, `joined`, `active`,
`paused`, `left`, and `blocked`; Profiles may display contextual labels. Roles are named Capability
sets rather than fixed Owner/Manager/Staff classes.

A Human Custodian may be required for billing, recovery, ownership transfer, or irreversible
governance. Custodian is separate from a Company Owner Role. Low-risk review and Agent coordination
must be policy-driven rather than universally Human-only.

## 12. Memory

Memory supports fact, document, conversation, event, experience, rule, decision, artifact,
research, data, manual, failure, learning, external source, Agent output, knowledge, and custom
types. It supports Canonical, Working, External, and Candidate layers, with type-appropriate
workflows rather than universal approval. Provenance, author Actor, linked Activity and Decision,
Space, visibility, confidence, version, validity, and history are retained. Stale, contradictory,
and unsourced Memory is surfaced for review. Ask cites exact versions and marks inference. Scope is
filtered before retrieval and model context construction.

## 13. Activity

One recursive Activity model supports task, project, quest, event, discussion, experiment, study,
campaign, ritual, session, creation, maintenance, investigation, mission, and custom types. It does
not force Goal/Project/Quest/Step depth. Parent, dependency, sequence, participants, assignees,
input/output Memory, Decision, deadline, state, and History are supported. Human, Agent, Service,
and Guild Actors can be assigned. Profiles define contextual names, states, and creation verbs.

## 14. Decision and governance

Decision methods include Custodian, Consent, Vote, Quorum Vote, Review, Editorial, Council,
Policy, Hybrid, Agent Proposal plus Human Approval, and Custom. A Decision retains proposal,
options, evidence, dissent, participants, method, outcome, linked Memory and Activity, and review
date. Significant decisions do not exist only in mutable chat. Constitution records purpose,
principles, Capabilities, decision policy, Agent limits, retention, departure, and Break Glass.

## 15. Standard experience

Primary navigation is Home, Ask, Members, Memory, Activity, and More. More contains permitted
Decisions, Spaces, History, Inbox, Approvals, Connections, Automations, Federation, Contribution,
Export, and Settings. Navigation visibility is never the authorization boundary. The interface
uses the active Profile's language and progressively discloses advanced settings. Empty states
offer one relevant next action.

## 16. Home

Home adapts to Role, Profile, Space, and current state. It shows today's Activity, items waiting for
the current Actor or an Agent, approvals, Agent Runs, Memory updates, risk, anomalies, and the next
recommended action. Its central intents are Ask, Remember, Start, and Review, ordered and named by
the active Profile.

## 17. Ask, Plan, and Act

Ask is read-only and searches authorized Memory, Members, Decisions, Activities, and History with
citations. Plan creates an inspectable proposal containing purpose, Memory used, changes, assignee,
Connection, cost, time, risk, approval, and rollback feasibility. It can propose Memory Candidates,
Activity drafts, Decisions, and Agent Runs. Act executes only an approved Plan after showing the
effect, delegated authority, Connection, cost, and reversibility. Result, evidence, cost, Memory,
tool, and approval are written to History.

## 18. Agents

An Agent is a Member with Purpose, Role, Capabilities, Space, model, Skills, Tools, Connections,
budget, token/time/step/retry/delegation limits, schedule, trigger, approval policy, and Kill Switch.
It cannot expand its own authority, and delegation cannot exceed the original scope or budget.
Risk levels are read, reversible internal write, external write, and critical/irreversible.
External and critical actions use policy approval, preview, reauthentication where required,
idempotency, and duplicate prevention.

## 19. Connections

Purchaser-owned Connections include Cloudflare OS Gatekeeper, MCP, HTTPS Webhook, Service Binding,
email, calendar, file storage, Git, external API, and model provider. Every Connection has a
Capability allowlist, scope, health, Secret reference, revocation, and History. Plain Secrets are
never stored in PostgreSQL or Git. Both Connection permission and Guild Capability must pass.

## 20. Automation

Automation supports scheduled Runs, event triggers, durable approval waits, bounded retry,
Agent-to-Agent delegation, deduplication, Kill, and offboarding cancellation. It is linked to Actor,
Activity, Connection, and Policy and prevents duplicate execution for one trigger.

## 21. Federation

Another Guild may be an Actor and may receive explicit Federation Grants for selected Memory,
Activity, and Decisions. Grants include scope, Capability, expiry, revocation, signed transport,
delivery history, and failures. Ambient sharing and cross-Guild search indexes are forbidden.
Revocation stops new access immediately; handling of previously delivered copies is stated when a
Grant is created.

## 22. Communication

Role- and Space-aware announcements, Inbox, and contextual conversations are supported. Private
messages do not enter Guild Memory by default. Explicit promotion to Memory, Activity, Decision,
Handover, or Announcement preserves source conversation, Actor, time, and provenance. Private
message plaintext is not copied indiscriminately into audit events.

## 23. Onboarding and offboarding

Onboarding is Profile-, Role-, and Space-aware and supports required Memory, confirmation, initial
Activity, learning progress, re-confirmation, invite, join, and activation. Offboarding consistently
stops sessions, tokens, Connection access, schedules, and Agent Runs; hands over Activity, files,
and drafts; and records History. Official shared output remains under Constitution policy. Personal
Data does not silently become Guild Data.

## 24. Contribution

Contribution is multidimensional evidence linked to Memory, Activity, improvement, Decision
evidence, support, Agent supervision, handover, and artifacts. It has correction requests and no
single personnel score. Speech volume, online time, and manager affinity are not contribution.

## 25. Data ownership

Data classes are Guild Data, Personal Data, Explicitly Shared Data, Connected Data, and Derived
Search Data. Vector indexes and embeddings are rebuildable derivatives, not the source of truth.
Personal Data is not ambiently shared with a Guild, and Guild Data is not ambiently exported to a
personal AI or another Guild.

## 26. Export, retention, and migration

Administrators can export JSON, Markdown, CSV, files, History, Relations, Roles, Spaces, Memory,
Activity, Decisions, Agent configuration, and non-secret Connection metadata. Plain Secrets are
excluded. Retention requires preview, counts, impact, reauthentication, apply, checkpoint, and
History; purge requires dry-run. R2 deletion failures use a visible retryable outbox.

## 27. Backup and restore

Backups go to purchaser-owned encrypted storage and cover PostgreSQL, R2, KV, Access settings,
Worker versions, deployment configuration, migrations, checksums, release commit, and optional
Context artifacts. Tool commit and deployed release commit are recorded separately. Restore is
prepared into new resources and never overwrites production without an explicit operation. Backup
verification and isolated restore rehearsal are release gates.

## 28. Internationalization and accessibility

English is the default. English, Japanese, and Simplified Chinese dictionaries are complete and
missing keys fail CI. User content is not automatically translated. Major journeys work at 1440,
390, and 320 pixels without accidental horizontal scroll, clipped dialogs, duplicate navigation,
or inaccessible operations. Keyboard, focus, ARIA, contrast, touch targets, and reduced motion meet
WCAG 2.2 AA expectations.

## 29. Commercial Installer

The official Installer runs locally or in a purchaser-owned environment and never sends Secrets to
the seller. It authenticates to purchaser Cloudflare, selects Account and Zone, verifies PostgreSQL
and required extensions, selects AI provider, stores Secrets safely, configures domain or
Workers.dev and Access, captures purpose, performs preflight and dry-run, deploys, initializes,
smoke-tests, stores recovery information, and emits a handover report. A nonfunctional one-click
button is prohibited.

## 30. Updater

Updater fetches a release, verifies its signature and exact commit, checks dependency and database
compatibility, verifies backup, dry-runs migrations, builds and deploys Workers, migrates the
database, runs authenticated smoke, stores evidence, and rolls back on failure. It enforces
manifest signatures, lockfiles, migration hashes, compatibility windows, and release evidence.
Expired update entitlement blocks only new release acquisition.

## 31. Commercial offering

Core is free and self-operated. Owned is a one-time customer-owned deployment with initial Profile,
Roles, Spaces, Agent, Connections, backup, and recovery. An optional annual Update Plan and optional
Care service may be offered. Account/provider moves are separately scoped migrations. Provider
fees are paid directly by the purchaser. Pricing documents remain drafts until market, legal, and
tax review; unlimited manual updates and perpetual free support are prohibited.

## 32. No seller runtime dependency

The standard product must not depend on a seller API, database, license server, AI proxy, Secrets,
monthly runtime check, kill switch, domain, or backup. An installed release continues operating if
the seller disappears.

## 33. Security baseline

Required controls include PostgreSQL forced RLS, a non-superuser runtime role without BYPASSRLS,
TLS `verify-full`, Guild isolation, SQL permission prefilter, pre-model scope exclusion, Secret
bindings, append-only History, immutable approval evidence, idempotent external writes, Kill
Switch, Break Glass, dependency and license audit, SBOM, signed releases, backup verification,
restore rehearsal, clean-commit deployment, and a pinned Cloudflare OS commit. Any temporary RLS
adjustment during migration is transaction-bounded, restored before commit, count-verified, and
fully rolled back on mismatch.

## 34. Explicit non-goals

Core does not recreate payroll, accounting, full CRM, video meetings, a complete email client,
employee surveillance, keystroke monitoring, screen recording, a single personnel score, Agent Root
acquisition, unapproved money transfer, unlimited Agent delegation, automatic Canonical promotion,
an all-Guild search index, seller-hosted lock-in SaaS, or a nonfunctional deploy button. External
services are integrated through Connections.

## 35. Current-state audit

Every implementation cycle verifies actual HEAD, local-only commits, uncommitted changes,
`origin/main`, submodule commit, production commit, database migrations, acceptance contract,
Core license, notices, commercial-separation documents, Personal Profile, Purpose-first Builder,
and Distribution repository. Local-only commits are preserved and commit IDs come from Git.

## 36. Product completion matrix

`docs/product-completion-matrix.md` classifies every requirement as Implemented and verified,
Implemented but unverified, Partially implemented, Mock only, Documented only, Missing, Blocked by
legal review, or Blocked by external credential. The matrix may become stricter as evidence is
found; it may not omit a requirement.

## 37. Safe implementation sequence

Work proceeds through audit, matrix, acceptance update, additive Core work, Personal + AI,
Purpose-first Builder, reusable templates, Ask/Plan/Act, Agents/Connections/Automation, Federation,
portability, compliance, separate Distribution, Installer, Updater, signed bundle, SBOM and legal
drafts, clean-room installation, update/rollback, backup/restore, E2E, i18n, mobile/accessibility,
commit, CI, staging, authenticated smoke, and only then an explicitly authorized production
release. Existing IDs, History, Memory, Activity, Roles, RLS, and migration safety are preserved.

## 38. Required verification

Unit, integration, PostgreSQL, and E2E evidence covers Personal + AI, Company, Research, Community,
unknown Collectives, Agent Collective, per-Space context, Ask/Plan/Act, Actor-neutral permissions,
commercial separation, customer-owned installation, expired update entitlement, backup/restore,
mobile, and all three locales. Existing tests cannot be removed merely to make the gate pass.

## 39. Technical completion

Technical completion requires every matrix row to be Implemented and verified, including the full
Builder, Personal Profile, functional Ask/Plan/Act, separate repositories, Apache compliance,
SBOM/license gate, clean-room customer-owned install, seller-independent runtime, expiry behavior,
signed update/backup/migration/smoke/rollback, export/restore, all automated tests, required
viewports/locales, CI, exact-commit evidence, authenticated staging smoke, and production backup and
smoke if production is released. Any omitted or unverified requirement means Guild OS is incomplete.

## 40. Sale readiness

Sale readiness is separate from technical completion. It additionally requires professional review
of the commercial license, trademarks, contribution rights, privacy, customer agreement, support,
pricing, refund, tax/invoicing, and security incident process. Before that review the required
status is: **Commercial distribution technically complete. Legal sale readiness pending
professional review.**

## 41. Final evidence report

The final report records audited branch/commits, gaps, acceptance updates, Core changes, Builder,
Personal Profile, Distribution structure, Installer, Updater, customer-ownership evidence,
entitlement expiry behavior, licenses/notices/SBOM, export/backup/migrations, test counts, CI URL,
commit IDs, push state, staging and production URLs, release evidence, compatibility layers, legal
review items, and every incomplete item. If anything remains incomplete, the report begins
`Guild OSは未完成です。`

## 42. Product promise

Guild OS Owned lets Humans and AI share Memory, Roles, Activity, and Decisions in a Collective OS
owned in the purchaser's own cloud. The system adapts its language, structure, workflows, and
Agents to the Collective's purpose. Membership can change while institutional Memory remains.
Cloud, data, AI, and Secrets remain purchaser-owned; installed versions continue without the
seller.

**The Collective does not conform to the system. The system changes shape to fit the Collective's
purpose and language, and the Collective owns that system.**
