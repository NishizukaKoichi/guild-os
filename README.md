# Guild OS

Guild OS is an organizational layer for humans and AI agents to share governed memory, work,
decisions, and history. It extends the open-source
[Cloudflare OS](https://github.com/cloudflare/cloudflare-os) instead of rebuilding its agent
workspace, Gadgets, Blueprints, sandboxing, or Gatekeeper approval system.

This repository is self-hosted. Each purchaser deploys it to their own Cloudflare account, connects
their own PostgreSQL database and model providers, and owns every stored object and credential.
There is no seller-operated API, licensing server, or required subscription.

> [!IMPORTANT]
> Cloudflare OS is early-access software. This repository pins a reviewed upstream commit and never
> follows an unpinned branch in production.

## Implementation status

Implemented and tested:

- Pinned Cloudflare OS Starter deployment wrapper
- Human, Agent, and Service domain types
- Role and hierarchical Space permission engine
- Root Owner and private-data invariants
- Root-only, versioned Constitution management with mandatory Chronicle reasons
- Two-party, expiring Root ownership transfer with outgoing Role preservation and atomic Chronicle
- Purchaser-owned Break Glass recovery with one-time offline codes, whole-generation invalidation,
  rate limiting, previous-Root Role preservation, and mandatory Chronicle disclosure
- Agent/requester/workflow/connector permission intersection
- Knowledge lifecycle and risk-based approval rules
- Agent budget, duration, step, retry, and delegation limits
- PostgreSQL schema for Guild v1 entities
- PostgreSQL row-level Guild isolation
- Append-only Chronicle and idempotent external-action outbox
- Hyperdrive transaction boundary
- Guild Gatekeeper with explicit administrator-confirmed bootstrap, privacy-minimized nonmember
  responses, one-time invitation binding, observation approval, and permission-filtered discovery
- Sandboxed, mobile-responsive Home, People, Agents, invitation, offboarding, and Settings UI
- Human, Agent, and Service registration with scoped Role assignment and lifecycle controls
- Custom Role and hierarchical Space administration with database-enforced invariants
- Governed Knowledge creation, immutable versions, human review, publication, deprecation,
  acknowledgement, and multilingual content
- R2 attachments with per-file authorization, checksums, two-phase upload, and durable cleanup
- Ask Guild over permission-filtered Canonical Knowledge with citations and per-Identity rate limits
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
- English-first UI with complete Japanese dictionary and Japanese fallback for Simplified Chinese
- Transactional Membership lifecycle with immediate data denial, connector revocation, and Chronicle
  evidence
- Strict Gatekeeper liveness/readiness, bounded maintenance metrics, reproducible resource locking,
  verified whole-system backup/restore preparation, release evidence, and Access production smoke

Not exposed as finished product features yet:

- Scoped People views for non-global administrators
- Semantic search index beyond the current PostgreSQL full-text retrieval
- Guild federation

These incomplete capabilities are absent from the user-facing action surface rather than presented
as nonfunctional controls.

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

See [architecture](docs/architecture.md), [security](docs/security.md), and the
[accepted decisions](docs/adr/). Operational owners should also keep the
[deployment](docs/deployment.md) and [backup and recovery](docs/backup-and-recovery.md) runbooks.

## Prerequisites

- Node.js 24
- pnpm 11
- A purchaser-owned Cloudflare account
- A purchaser-owned PostgreSQL database reachable by Hyperdrive
- Workers, KV, R2, Browser Rendering, and Dynamic Worker Loaders
- A Cloudflare Access self-hosted application for the Workshop hostname

Workers AI access is required for Ask Guild. The v1 Agent write path does not call a model itself;
it receives a plan from Cloudflare OS and executes only the configured signed Webhook after approval.

## Local setup

```sh
git submodule update --init
pnpm install --frozen-lockfile
pnpm --dir cloudflare-os install --frozen-lockfile
pnpm test
pnpm build
pnpm lint
```

Node.js 22 currently passes the repository tests, but Node.js 24 is the supported build target from
the upstream Starter.

## PostgreSQL

Create a blank PostgreSQL database, then run migrations with the connection string supplied only
through the process environment:

```sh
export DATABASE_URL='postgresql://user:password@host:5432/guild_os?sslmode=require'
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
DATABASE_URL='postgresql://...' pnpm db:verify
```

This requires PostgreSQL 17+, TLS, a non-superuser role without `BYPASSRLS`, the exact migration
set and checksums for the release, and forced RLS on every Guild table. Plaintext localhost is
available only for explicit local diagnostics with `--allow-insecure-localhost`.

CI applies every migration twice to an ephemeral PostgreSQL 17 database owned by a non-superuser,
then verifies Guild RLS isolation, Root Owner integrity, and Chronicle immutability. Local
integration verification uses the same command:

```sh
DATABASE_URL=postgresql://... pnpm --filter @guild-os/postgres test:integration
DATABASE_URL=postgresql://... pnpm --filter @guild-os/gatekeeper test:integration
pnpm --filter @guild-os/gatekeeper test:e2e
```

Create a Hyperdrive configuration for the migrated database from the Cloudflare dashboard. Copy the
32-character Hyperdrive configuration ID; database credentials do not belong in this repository.

## Deployment configuration

Edit `deployment.jsonc`:

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
bytes and must never be stored in `deployment.jsonc` or a tracked environment file:

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

The first live deploy stores automatically provisioned KV/R2 identities in the ignored
`deployment.lock.json`; preserve that purchaser-instance file outside the sales template. Live
deploys require a clean commit and pinned submodule and annotate every Worker Version with that Git
SHA. See the deployment runbook for immutable release and smoke evidence commands.

The receiving service must verify the signature and persist the idempotency key before applying an
effect. See the [Agent Webhook contract](docs/agent-webhook.md).

Opening **Guild** never initializes the database as a page-load side effect. On an uninitialized
deployment, a Workshop administrator must enter their Root display name, choose a locale, type the
configured Guild name exactly, and submit the initialization form. PostgreSQL serializes competing
attempts, so only one human account can become Root Owner. Keep the Access policy and Workshop
administrator list restricted to that intended person until initialization is complete.

The Root Owner then issues a high-entropy, one-time invitation from **People**. A recipient's stable
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

The current v1 completion evidence and remaining gates are tracked in
[v1 completion](docs/v1-completion.md).

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
pnpm backup:create -- --output /absolute/encrypted/path --r2-remote REMOTE \
  --confirm-encrypted-destination
pnpm backup:verify -- --input /absolute/backup/path
pnpm restore:prepare -- --input /absolute/backup/path --output /absolute/restore/path
```

They capture and verify PostgreSQL, binary KV, R2, Access, Worker versions, and optional Context
Artifacts without storing secrets. `restore:prepare` generates bounded KV bulk files and never
mutates cloud state. Full requirements and the new-resource restore drill are in
[backup and recovery](docs/backup-and-recovery.md).

## Upgrades

1. Record the current `cloudflare-os` gitlink.
2. Advance it to a specific reviewed upstream commit.
3. Review authentication, sharing, Gatekeeper, sandbox, storage, and model-context changes.
4. Reinstall both lockfiles and run all local gates.
5. Deploy to a nonproduction purchaser-owned environment first.
6. Restore the prior gitlink and Worker version if verification fails.

Never update the submodule blindly or modify it with an unpublishable local-only commit.
