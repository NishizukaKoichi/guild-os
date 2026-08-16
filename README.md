# Guild OS

Guild OS is an Actor-neutral Collective OS where Humans, Agents, Services, and other Guilds share
Memory, Activity, Roles, Decisions, and History. Company is one optional Template, not the core
model. Guild OS extends the open-source
[Cloudflare OS](https://github.com/cloudflare/cloudflare-os) instead of rebuilding its agent
workspace, Gadgets, Blueprints, sandboxing, or Gatekeeper approval system.

This repository is self-hosted. Each purchaser deploys it to their own Cloudflare account, connects
their own PostgreSQL database and model providers, and owns every stored object and credential.
There is no seller-operated API, licensing server, or required subscription.

This checkout is currently distributed under Apache License 2.0. Future commercial packaging is a
separate product boundary; it does not relicense this source tree or add a runtime call-home
dependency. Read [Licensing and distribution](docs/licensing-and-distribution.md) and
[Third-Party Notices](THIRD_PARTY_NOTICES.md) before creating or selling a bundle.

> [!IMPORTANT]
> Cloudflare OS is early-access software. This repository pins a reviewed upstream commit and never
> follows an unpinned branch in production.

## Release status

This checkout implements the Guild OS v1.0 full-spec product surface. A purchaser release is
acceptable only when the
[full-spec acceptance contract](docs/full-spec-acceptance.md), the local gates, the target database
preflight, deployment evidence, restore rehearsal, and production smoke all pass for the same
reviewed commit.

Capability areas present in the codebase include:

- Pinned Cloudflare OS Starter deployment wrapper
- Global Actor plus Guild-scoped Membership for Human, Agent, Service, and Guild Actor kinds
- Neutral Membership lifecycle and Role/Capability engine with hierarchical Space scopes
- Personal with AI, Company, Community, Research, Creator, Open Source, Agent Collective, and
  Blank Templates
- Purpose-first **Other / Build your own** setup that turns five natural-language answers into a
  complete, editable Blueprint for vocabulary, Roles, Spaces, Memory, Activity, Decisions, Home,
  Workflows, and a bounded Agent proposal
- Guild-scoped, immutable Blueprint versions with code-free editing and reuse at Guild or Space
  level; applying one to an operating Guild never rewrites existing authority
- Guild and per-Space Context Profiles for labels, creation choices, Decision methods,
  workflows, dashboard order, and suggested Agents
- Root Owner and private-data invariants
- Root-only, versioned Constitution management with mandatory Chronicle reasons
- Two-party, expiring Root ownership transfer with outgoing Role preservation and atomic Chronicle
- Purchaser-owned Break Glass recovery with one-time offline codes, whole-generation invalidation,
  rate limiting, previous-Root Role preservation, and mandatory Chronicle disclosure
- Agent/requester/workflow/connector permission intersection
- Knowledge lifecycle and risk-based approval rules
- Agent budget, model-token, duration, step, retry, and delegation limits
- PostgreSQL schema for Guild v1 entities
- PostgreSQL row-level Guild isolation
- Append-only Chronicle and idempotent external-action outbox
- Hyperdrive transaction boundary
- Guild Gatekeeper with explicit administrator-confirmed bootstrap, privacy-minimized nonmember
  responses, one-time invitation binding, observation approval, and permission-filtered discovery
- Action-first, role-aware Home and progressive navigation with a four-item mobile tab bar
- Sandboxed, mobile-responsive Members, invitation, lifecycle, and Settings UI
- Unified Human, Agent, Service, and Guild Actor registration, filtering, Role assignment, and controls
- Broad versioned Memory for facts, documents, events, experiences, rules, artifacts, research,
  data, failures, learning, external sources, Agent output, and governed Knowledge
- Recursive typed Activity with optional parent, any operational Actor assignee, status, timing,
  Space, and Memory sources; no mandatory Goal/Project/Quest/Step depth
- Custom Role and hierarchical Space administration with database-enforced invariants
- Governed Knowledge creation, immutable versions, human review, publication, deprecation,
  acknowledgement, and multilingual content
- R2 attachments with per-file authorization, checksums, two-phase upload, and durable cleanup
- Ask Guild over SQL-prefiltered authorized Memory with exact-version citations and per-Actor rate limits;
  governed Knowledge contributes only its approved Canonical version
- Governed Goal, Project, Quest, and Step planning with status lifecycles, Human/Agent assignment,
  Inbox notifications, optimistic concurrency, and Chronicle evidence
- Governed Decisions with evidence, immutable proposals, Constitution-defined human approval
  quorum, dissent records, and security-boundary-preserving supersession
- Governed Role/Space Announcements with immutable publication, set-based recipient delivery,
  deduplicated Inbox notifications, and recipient-controlled read state
- Context-bound Conversations with current-authority reads, active-Human mentions, audited
  lock/unlock and redaction, Inbox delivery, and reusable Knowledge, Quest, and Decision comments
- Permission-prefiltered Chronicle search with actor, subject, date, and normalized action filters
- Governed Risk Level 2 Agent plans with Cloudflare OS approval, Guild quorum, immutable authority
  snapshots, execution-time permission rechecks, and Cloudflare Workflows
- Fixed deployment-owned HTTPS Webhook Connector with HMAC signatures, idempotency keys, redirect
  refusal, bounded execution, and no unsafe automatic write retry
- Optional purchaser-owned reference Webhook receiver with exact-byte HMAC verification, five-minute
  replay rejection, and strongly consistent SQLite Durable Object idempotency
- Run-level Kill Switch, Identity-offboarding cancellation, exhausted-dispatch failure handling, and
  post-Kill delivery-race Chronicle evidence
- Permission-filtered Agent/Space/Connector discovery for Cloudflare OS and a responsive run,
  approval, result, usage, and Kill management surface
- English-first UI with Japanese and Simplified Chinese dictionaries and persisted language choice
- Transactional Membership lifecycle with immediate data denial, connector revocation, and Chronicle
  evidence
- Strict Gatekeeper liveness/readiness, bounded maintenance metrics, reproducible resource locking,
  whole-system backup/restore preparation, release evidence, and Access production smoke tooling

The completed full-spec surface also includes:

- permission-prefiltered hybrid lexical and pgvector retrieval, with vectors kept as a rebuildable
  derivative and automatic lexical fallback;
- explicit private-message promotion into Memory, Activity, Decision, or Handover with provenance;
- Role- and Space-aware onboarding, atomic offboarding and handover, and evidence-backed
  Contribution correction requests;
- purchaser-configured Connections with remote capability allowlists, health checks, discovery,
  revocation, and governed invocation for MCP, Gatekeeper API, HTTPS Webhook, and Service Binding;
- durable scheduled and event-triggered Automation, bounded Agent delegation, and Kill handling;
- explicit Federation grants, signed inbound/outbound transport, durable delivery, revocation, and
  selected Memory, Activity, and Decision publication;
- administrator data export plus retention preview, exact-plan apply, reauthentication, history,
  checkpoints, and R2 deletion-outbox visibility.

Intentional product boundaries remain explicit. OAuth Connections perform metadata discovery but
not authorization-code exchange; direct database and storage action adapters are unsupported; a
custom Service Binding still requires a real purchaser deployment binding. Provider-route daily
budgets are policy metadata, while enforced cost and execution bounds come from the Guild
Constitution, Agent profile, immutable Run limits, and purchaser provider account. Do not bypass
these boundaries with direct database edits or undocumented Worker bindings.

## Architecture

```text
Cloudflare Access
  -> pinned Cloudflare OS Workshop
  -> Guild Gatekeeper
  -> Guild policy engine
  -> PostgreSQL through Hyperdrive
  -> Chronicle + transactional outbox
```

Cloudflare OS remains a Git submodule. Guild-owned packages live outside it:

| Path | Responsibility |
| --- | --- |
| `packages/guild-domain` | Framework-independent types, validation, permissions, and governance |
| `packages/guild-postgres` | Schema, migration runner, transaction helper, and repository |
| `packages/guild-gatekeeper` | Cloudflare OS capability and management-UI boundary |
| `packages/webhook-receiver` | Optional external-write receiver and durable replay protection |
| `packages/error-reporter` | Private structured backend error events |

### Compatibility window

`actors`, `actor_memberships`, `memories`, and `activities` are the canonical neutral substrate.
The previous `identities`/`memberships`, governed `knowledge`, and fixed
`goals`/`projects`/`quests`/`steps` tables remain as explicit compatibility views and workflows.
Migrations preserve UUIDs and mirror legacy writes into the canonical tables. New neutral features
must target Actor, Memory, and Activity; compatibility removal is governed by
[the migration runbook](docs/collective-migration.md), not by an ad hoc table drop.

See [architecture](docs/architecture.md), [Context Profiles](docs/context-profiles.md),
[security](docs/security.md), and the [accepted decisions](docs/adr/).

Purchaser operations documentation:

| Runbook | Purpose |
| --- | --- |
| [Production deployment](docs/deployment.md) | Clean-room setup, purchaser infrastructure, release, smoke, and rollback |
| [Connections and Agent providers](docs/connections-and-agent-providers.md) | Model routes, Secret references, MCP, Gatekeeper, Webhook, and Service Binding allowlists |
| [Semantic Memory](docs/semantic-memory.md) | Permission ordering, pgvector operations, monitoring, rebuild, fallback, and rollback |
| [Data ownership and retention](docs/data-ownership-and-retention.md) | Custody classes, export scope, retention dry-runs, evidence, and purge boundaries |
| [Backup and recovery](docs/backup-and-recovery.md) | Complete backup, isolated restore, disaster recovery, and migration |
| [Administrator handover](docs/admin-handover.md) | Asset transfer, Root succession, offboarding, and acceptance record |
| [Licensing and distribution](docs/licensing-and-distribution.md) | Apache core provenance, future commercial boundary, self-service updates, and release compliance |

## Prerequisites

- Node.js 24
- pnpm 11
- A purchaser-owned Cloudflare account
- A purchaser-owned PostgreSQL database reachable by Hyperdrive
- PostgreSQL `vector` and `pg_trgm` extensions enabled once by a database administrator before the
  application-role migration
- Workers, KV, R2, Browser Rendering, Dynamic Worker Loaders, and a Workers AI binding for the
  deployment fallback
- A Cloudflare Access self-hosted application for the Workshop hostname

Model routes may use purchaser-owned Workers AI or an OpenAI-compatible HTTPS provider. Provider
credentials remain Worker Secret bindings; only their binding names are stored in PostgreSQL. The
fixed governed Agent write path uses the configured signed Webhook after approval. Read
[Connections and Agent providers](docs/connections-and-agent-providers.md) before adding a provider
or external action.

## Local setup

```sh
git submodule sync --recursive
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm peers:check
pnpm types:check
pnpm test
pnpm test:cloudflare-os
pnpm build
pnpm lint
```

The root `pnpm-lock.yaml` is the authoritative dependency graph for both Guild-owned packages and
the Cloudflare OS packages used in the release. Do not install the submodule as a second workspace.
Node.js 24 and pnpm 11 are the supported release toolchain.
The non-secret `fixtures/deployment.ci.jsonc` exists only for deterministic Wrangler dry-runs; it
uses reserved example values and is never a production configuration.

## PostgreSQL

Create a blank PostgreSQL database. Before the restricted application role runs migrations, a
provider administrator must enable the two reviewed extensions in that database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

No application runtime role should receive extension-management or superuser authority. Then run
migrations with the application connection string supplied only through the process environment:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm db:migrate
unset DATABASE_URL
```

To inspect migration filenames and hashes without connecting:

```sh
pnpm --filter @guild-os/postgres migrate --dry-run
```

The runner records SHA-256 hashes in `public.guild_schema_migrations` and refuses to continue if an
already-applied migration was modified.

Before production deploy, verify the actual target without changing it:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm db:verify
unset DATABASE_URL
```

This requires PostgreSQL 17+, TLS, a non-superuser role without `BYPASSRLS`, the exact migration
set and checksums for the release, and forced RLS on every Guild table. Plaintext localhost is
available only for explicit local diagnostics with `--allow-insecure-localhost`.

CI enables `vector` and `pg_trgm` as a database administrator, then applies every migration twice
to an ephemeral PostgreSQL 18 database owned by a non-superuser. It verifies Guild RLS isolation,
Root Owner integrity, Chronicle immutability, and the semantic-search schema. For local integration
verification, supply a migrated, disposable test database; these commands mutate it:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm --filter @guild-os/postgres test:integration
pnpm --filter @guild-os/gatekeeper test:integration
unset DATABASE_URL
pnpm --filter @guild-os/gatekeeper test:e2e
```

Create a Hyperdrive configuration for the migrated database from the Cloudflare dashboard. Copy the
32-character Hyperdrive configuration ID; database credentials do not belong in this repository.

## Deployment configuration

Copy the annotated template to the ignored purchaser configuration, then edit the copy:

```sh
cp deployment.jsonc deployment.local.jsonc
chmod 600 deployment.local.jsonc
```

1. Set the Cloudflare account and Worker names.
2. Set the Workshop custom domain or use `workersDev` for evaluation.
3. Set the Cloudflare Access issuer, audience, and narrow administrator list.
4. Generate a stable Guild UUID with `node -e "console.log(crypto.randomUUID())"`.
5. Set the Guild name, purpose, first Space, approval quorums, retention period, and Hyperdrive ID.
6. Select the Workers AI model, AI Gateway ID, per-Identity Ask Guild rate limit, and emergency
   recovery attempt limit.
7. Set a unique Agent Workflow name and a new Webhook Connector UUID, name, and fixed HTTPS URL.
8. Leave the Knowledge R2 bucket `null` for automatic provisioning or provide an owned bucket name.

Provide the Webhook signing secret only for the live deploy. It must contain at least 32 random
bytes and must never be stored in either deployment JSONC file or a tracked environment file. Enter
values only into hidden shell prompts; the names below are Secret references, not values:

```sh
read -r -s GUILD_WEBHOOK_SIGNING_SECRET
export GUILD_WEBHOOK_SIGNING_SECRET
read -r -s DATABASE_URL
export DATABASE_URL
pnpm deploy
unset DATABASE_URL GUILD_WEBHOOK_SIGNING_SECRET
```

`scripts/deploy.mjs` validates every required secret before deploying any Worker, writes only the
required values to mode-`0600` temporary files for Wrangler's `--secrets-file` option, removes the
files in a `finally` block, and strips those values from child-process environments. When AI Gateway
is enabled, provide `CF_AI_GATEWAY_API_TOKEN` the same way. `pnpm check` never requires secrets.

Commands prefer `deployment.local.jsonc`. For an encrypted configuration stored elsewhere, set
`GUILD_OS_DEPLOYMENT_CONFIG` to its absolute path. A live deploy refuses the tracked template so
purchaser emails, Guild labels, domains, and resource identifiers never need to enter source
history.

The first live deploy stores automatically provisioned KV/R2 identities in the ignored
`deployment.lock.json`; preserve that purchaser-instance file outside the sales template. Live
deploys require a clean commit and pinned submodule and annotate every Worker Version with that Git
SHA. See the deployment runbook for immutable release and smoke evidence commands.

The receiving service must verify the signature and persist the idempotency key before applying an
effect. See the [Agent Webhook contract](docs/agent-webhook.md).

Opening **Guild** never initializes the database as a page-load side effect. On an uninitialized
deployment, a Workshop administrator chooses how the Guild will be used, enters the human Root
display name, explicitly accepts Root responsibility, and submits **Create Guild**. Personal with
AI is the recommended default and provisions a bounded Personal assistant. **Other / Build your
own** asks five plain-language questions, generates a schema-validated operating Blueprint, and
requires the administrator to review and edit the complete proposal before initialization. Raw
Blank remains the advanced fully manual choice. PostgreSQL serializes
competing attempts, so only one human account can become Root Owner. Keep the Access policy and
Workshop administrator list restricted to that intended person until initialization is complete.

The Root Owner then issues a high-entropy, one-time invitation from **Members**. A recipient's stable
Cloudflare OS account capability is bound to the selected Role, Space, and initial Membership state
only after that token is claimed. The database stores only the token's SHA-256 hash. Accounts that
are not usable Guild members receive no Root identity, Constitution, ownership-transfer, or Agent
configuration in the bootstrap response.

Root ownership is not assigned through Roles. In **Settings**, the current Root proposes a named
active Human and chooses the Role retained after handover. That Human accepts from their own
session. PostgreSQL rejects a direct replacement, expired acceptance, mutable proposal terms, and
any transition without its Chronicle event.

For loss of every administrator, **Settings > Emergency recovery** generates ten one-time offline
codes. Plaintext appears once and never enters PostgreSQL, Git, Cloudflare variables, or Chronicle.
Store codes under separate purchaser custody. Using one current code from an authenticated account
changes Root atomically, preserves the configured Role for the prior Root, invalidates the full
generation, and records the incident. See [backup and recovery](docs/backup-and-recovery.md).

The authoritative release scope and remaining acceptance gates are tracked in the
[full-spec acceptance contract](docs/full-spec-acceptance.md).

## Verification and deployment

Local gates:

```sh
pnpm build
pnpm test
pnpm lint
pnpm types:check
```

After replacing every active deployment placeholder:

```sh
pnpm check
```

`pnpm check` builds every Worker and performs Wrangler dry runs. Actual deployment is a separate,
explicit operation:

```sh
pnpm exec wrangler login
# Set the required deployment secrets as described above, then:
pnpm deploy
```

No Cloudflare resources are created by the test, build, lint, or typecheck commands.
Follow the complete [deployment runbook](docs/deployment.md); a successful CLI deploy alone is not
a production acceptance result.

Purchaser-owned backup and recovery commands are:

```sh
pnpm backup:create -- --output /absolute/encrypted/path \
  --confirm-encrypted-destination
pnpm backup:verify -- --input /absolute/backup/path
pnpm restore:prepare -- --input /absolute/backup/path --output /absolute/restore/path
```

They capture and verify a Guild-scoped forced-RLS PostgreSQL SQL dump, binary KV, R2, Access,
Worker versions, and optional Context Artifacts without storing secrets. R2 uses the Cloudflare
REST API by default; `--r2-remote` selects an optional configured `rclone` path for large stores.
`restore:prepare` generates bounded KV bulk files and never mutates cloud state. Full requirements
and the new-resource restore drill are in [backup and recovery](docs/backup-and-recovery.md).

## Upgrades

1. Record the current `cloudflare-os` gitlink.
2. Advance it to a specific reviewed upstream commit.
3. Review authentication, sharing, Gatekeeper, sandbox, storage, and model-context changes.
4. Reinstall both lockfiles and run all local gates.
5. Deploy to a nonproduction purchaser-owned environment first.
6. Restore the prior gitlink and Worker version if verification fails.

Never update the submodule blindly or modify it with an unpublishable local-only commit.
