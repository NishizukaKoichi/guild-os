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
- Agent/requester/workflow/connector permission intersection
- Knowledge lifecycle and risk-based approval rules
- Agent budget, duration, step, retry, and delegation limits
- PostgreSQL schema for Guild v1 entities
- PostgreSQL row-level Guild isolation
- Append-only Chronicle and idempotent external-action outbox
- Hyperdrive transaction boundary
- Guild Gatekeeper with administrator bootstrap, one-time invitation binding, observation approval,
  and permission-filtered Space discovery
- Sandboxed, mobile-responsive Home, People, Agents, invitation, offboarding, and Settings UI
- Human, Agent, and Service registration with scoped Role assignment and lifecycle controls
- Custom Role and hierarchical Space administration with database-enforced invariants
- English-first UI with complete Japanese dictionary and Japanese fallback for Simplified Chinese
- Transactional Membership lifecycle with immediate data denial, connector revocation, and Chronicle

Not exposed as finished product features yet:

- Scoped People views for non-global administrators
- Knowledge, Work, Decisions, Inbox, and Chronicle management screens
- Knowledge semantic search and citations
- Agent write actions, approval quorum execution, Workflows, and kill-switch UI
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
| `packages/error-reporter` | Private structured backend error events |

See [architecture](docs/architecture.md), [security](docs/security.md), and the
[accepted decisions](docs/adr/).

## Prerequisites

- Node.js 24
- pnpm 11
- A purchaser-owned Cloudflare account
- A purchaser-owned PostgreSQL database reachable by Hyperdrive
- Workers, KV, R2, Browser Rendering, and Dynamic Worker Loaders
- A Cloudflare Access self-hosted application for the Workshop hostname

AI is optional for deployment. Agents require a configured model before they can run.

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

CI applies every migration twice to an ephemeral PostgreSQL 17 database owned by a non-superuser,
then verifies Guild RLS isolation, Root Owner integrity, and Chronicle immutability. Local
integration verification uses the same command:

```sh
DATABASE_URL=postgresql://... pnpm --filter @guild-os/postgres test:integration
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
6. Configure AI Gateway only when the deployment will fund models.

The first Workshop administrator who opens **Guild** initializes the database and becomes Root
Owner. Keep the Access policy restricted to that person until initialization is complete. The Root
Owner then issues a high-entropy, one-time invitation from **People**. A recipient's stable
Cloudflare OS account capability is bound to the selected Role, Space, and initial Membership state
only after that token is claimed. The database stores only the token's SHA-256 hash.

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
pnpm deploy
```

No Cloudflare resources are created by the test, build, lint, or typecheck commands.

## Upgrades

1. Record the current `cloudflare-os` gitlink.
2. Advance it to a specific reviewed upstream commit.
3. Review authentication, sharing, Gatekeeper, sandbox, storage, and model-context changes.
4. Reinstall both lockfiles and run all local gates.
5. Deploy to a nonproduction purchaser-owned environment first.
6. Restore the prior gitlink and Worker version if verification fails.

Never update the submodule blindly or modify it with an unpublishable local-only commit.
