# Production Deployment

This runbook deploys one purchaser-owned Guild. The purchaser must own the Cloudflare account,
PostgreSQL database, domain, model credentials, Webhook receiver, backups, and administrator
identities. No seller service is required after deployment.

Deployment success is not product completion. The reviewed commit must still satisfy the
[full-spec acceptance contract](full-spec-acceptance.md), and every capability promised to a
purchaser must pass its own acceptance path.

This repository intentionally does not advertise a generic **Deploy to Cloudflare** button.
Cloudflare's deploy-button flow does not deploy multiple Workers from one monorepo together, while
Guild OS deploys the Workshop, Gatekeeper, receiver, and supporting purchaser-owned resources as
one reviewed release. Use this runbook until an installer can preserve that full boundary without
silently omitting services.

## 0. Clean-room checkout

Start from a purchaser-owned Git URL in a new directory. Do not copy a seller working tree,
`node_modules`, generated Worker configuration, production data, or an instance configuration.

```sh
read -r PURCHASER_REPOSITORY_URL
read -r RELEASE_COMMIT
git clone "$PURCHASER_REPOSITORY_URL" guild-os
cd guild-os
git checkout --detach "$RELEASE_COMMIT"
unset PURCHASER_REPOSITORY_URL RELEASE_COMMIT
git submodule sync --recursive
git submodule update --init --recursive
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
```

Confirm that the clone contains the expected pinned Cloudflare OS gitlink and no purchaser data:

```sh
git status --short
git rev-parse --show-toplevel
git rev-parse HEAD
git submodule status
node --version
pnpm --version
```

The release toolchain is Node.js 24 and pnpm 11.9.0. `git status --short` must be empty. A leading
`+`, `-`, or `U` in `git submodule status` is not an acceptable release state.

## 1. Record the release

Start from a clean, reviewed commit and record the exact release before provisioning anything:

```sh
git status --short
git rev-parse HEAD
git submodule status
node --version
pnpm --version
```

Use Node.js 24 and pnpm 11. Keep the Git commit, Cloudflare account ID, PostgreSQL provider/project,
and eventual Worker version IDs in the operator change record. Do not deploy a working tree with
unreviewed changes.

## 2. Create purchaser-owned infrastructure

1. Create a blank PostgreSQL database with TLS, automated provider backups, point-in-time recovery
   where available, a non-superuser schema-management login, and a separate Runtime login. As a
   provider administrator, enable `vector` and `pg_trgm` once, create the Runtime login with a
   generated password, then remove the privileged session. Runtime must have no `BYPASSRLS`,
   `CREATEROLE`, `CREATEDB`, replication, extension-management, or schema-creation authority.
2. With the management URL containing exactly `sslmode=verify-full`, run `pnpm db:migrate`, set
   `GUILD_RUNTIME_DATABASE_ROLE` to the Runtime role name, and run `pnpm db:provision-runtime`.
   Never put either database URL in Git or a deployment configuration file. Run `pnpm db:verify`
   with the same management URL and role name; it verifies PostgreSQL 17+, TLS, exact migration
   checksums, forced RLS, and Runtime least privilege.
3. Create Hyperdrive with the Runtime role URL and record its 32-character ID. Never give
   Hyperdrive the management credential.
4. Choose the Workshop hostname. For an evaluation deployment, use a `workersDev` route. For
   production, use a hostname in a purchaser-owned Cloudflare zone.
5. Create a Cloudflare Access self-hosted application for that exact hostname. Start with only the
   intended Root Owner in the Allow policy. Record the issuer origin and application audience.
6. Enable the bundled purchaser-owned reference Webhook receiver, or deploy another HTTPS receiver
   that follows [the receiver contract](agent-webhook.md), including HMAC verification, a
   five-minute replay window, and durable idempotency. The bundled receiver uses one SQLite-backed
   Durable Object per idempotency key and can use a `workersDev` or custom-domain route.
7. Decide which purchaser-owned model and Connection paths are actually in release scope. Create
   only the provider accounts, public Gatekeepers, MCP endpoints, or Service Bindings required by
   that scope. Record Secret reference names, never values. Follow
   [Connections and Agent providers](connections-and-agent-providers.md).

Use the current official Cloudflare instructions for
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/get-started/),
[Access self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[R2](https://developers.cloudflare.com/r2/), and
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## 3. Configure the deployment

Copy `deployment.jsonc` to the ignored `deployment.local.jsonc`, set mode `0600`, and replace every
active placeholder in that copy. Alternatively, set `GUILD_OS_DEPLOYMENT_CONFIG` to an absolute
path in the purchaser's encrypted operations area. Keep these identifiers stable after first
production use:

```sh
cp deployment.jsonc deployment.local.jsonc
chmod 600 deployment.local.jsonc
```

- Guild UUID
- Worker names
- Agent Workflow name
- Webhook Connector UUID and URL
- Reference Webhook Worker name and route when enabled
- Cloudflare Access issuer and audience
- Hyperdrive ID
- KV namespace IDs and R2 bucket names after automatic provisioning
- Per-Identity Ask and emergency-recovery attempt limits

The top-level deployment schema configures the built-in Workers AI path, fixed HMAC Webhook, and
bundled Workers. It does not declare arbitrary purchaser Connection Secrets or Service Bindings.
Those are separately reviewed instance extensions and must be inventoried, reapplied, and verified
after every deploy.

For first deployment, `null` KV/R2 values allow Wrangler automatic provisioning. After every Worker
is deployed, the deploy script reads the single version receiving 100 percent of traffic, verifies
that its release message contains the current Git SHA, captures the actual KV/R2 bindings returned
by Cloudflare, and atomically creates a mode-`0600` `deployment.lock.json`. Every later deploy
reapplies the lock and fails if its account, Guild, Worker names, configured resource values, active
release, or deployed bindings differ.
If an initial multi-Worker deploy fails, the same discovery path retains resources from Workers that
reached the current release and leaves unknown entries `null`, so the next attempt can resume.
A release record or backup still refuses an unresolved partial lock.

`deployment.lock.json` is ignored by Git because it belongs to one purchaser instance, not the
reusable source template. Preserve it in the purchaser's encrypted operations vault and complete
backup. Losing it does not delete data, but turns resource recovery into manual account discovery.
The same separation applies to `deployment.local.jsonc`. Release evidence records only its source
class and SHA-256, never its filesystem path or plaintext values.

## 4. Verify without changing cloud state

```sh
git submodule sync --recursive
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm peers:check
pnpm build
pnpm test
pnpm test:cloudflare-os
pnpm lint
pnpm types:check
pnpm check
```

The root lockfile covers the exact Cloudflare OS packages used by the deployment as well as the
Guild-owned packages. Never run a second install from `cloudflare-os/pnpm-lock.yaml` for this
release; doing so creates a different, unaudited dependency graph.

Generate the release-specific dependency license inventory from this same checkout and preserve it
with the purchaser's release evidence outside the repository:

```sh
pnpm licenses list --json > /Volumes/EncryptedOps/guild-os/releases/dependency-licenses.json
```

Use a new destination for every release and never overwrite prior evidence. Follow
[Licensing and distribution](licensing-and-distribution.md) and include the root/submodule license
and required notices with every source or object bundle.

`pnpm check` repeats dependency audit and peer checks, runs tests and type/lint checks, builds all
Workers, and asks Wrangler for deployment dry runs. It does not need application secrets and does
not create cloud resources.
CI points it at `fixtures/deployment.ci.jsonc`, whose reserved values exist only to prove all Worker
bundles. Local setup without a purchaser configuration still fails clearly on template
placeholders.

Verify that `/readyz` is pinned to the final migration file and its exact SHA-256. This command is
read-only and exits nonzero on drift:

```sh
node --input-type=module <<'NODE'
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const directory = "packages/guild-postgres/migrations";
const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const latest = migrations.at(-1);
const source = await readFile("packages/guild-postgres/src/schema.ts", "utf8");
const marker = source.match(/CURRENT_GUILD_SCHEMA_MIGRATION\s*=\s*\n?\s*"([^"]+)"/)?.[1];
const expected = source.match(/CURRENT_GUILD_SCHEMA_CHECKSUM\s*=\s*\n?\s*"([a-f0-9]+)"/)?.[1];
const actual = latest
  ? createHash("sha256").update(await readFile(`${directory}/${latest}`)).digest("hex")
  : null;
if (!latest || marker !== latest || expected !== actual) {
  throw new Error(`readiness drift: marker=${marker} latest=${latest} checksum=${expected}`);
}
console.log(`readiness marker verified: ${latest}`);
NODE
```

The command must print `readiness marker verified` before deployment. A new migration must advance
the source marker, exact checksum, and migration-order test in the same reviewed change. Never
bypass a failure by weakening `/readyz` or by changing the target database's migration ledger.

Before the management role changes the target, verify that it is either fresh or an exact migration
prefix of this release:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm db:preflight
pnpm db:migrate
unset DATABASE_URL
```

The preflight rejects PostgreSQL below 17, unverified remote TLS, superuser or `BYPASSRLS`, missing
database/schema creation authority, unavailable `vector`, `pg_trgm`, or `pgcrypto`, ledger hash
drift, and Guild schema objects without a trusted ledger.

### Upgrade a legacy single-owner database

Deployments created before ADR 0039 can have the Runtime login as the owner of application tables,
sequences, types, and `guild_runtime` functions. Do not work around the new preflight by granting
Runtime more authority or by using a provider role in Hyperdrive.

First create a provider snapshot and a verified backup of the active release. Then create a new
login named for schema management at the PostgreSQL provider. It must be a non-superuser with no
`BYPASSRLS`, `CREATEROLE`, `CREATEDB`, or replication authority. With the provider administrator URL
in `DATABASE_URL`, run the bounded ownership transfer:

On Neon, create this login with SQL, not the Console, CLI, or API. Neon grants its
`neon_superuser` membership to control-plane-created roles, while a SQL-created role starts with
normal PostgreSQL privileges. Generate its password into purchaser-owned encrypted custody, then
use an owner session to execute the equivalent of:

```sql
CREATE ROLE guild_schema_manager LOGIN PASSWORD '<owner-supplied-secret>'
  NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
```

Do not place that statement with a real password in shell history, Git, logs, or this configuration.
Other providers can use their supported least-privilege role-creation path.

```sh
read -r -s DATABASE_URL
export DATABASE_URL
export GUILD_MANAGEMENT_DATABASE_ROLE=guild_schema_manager
export GUILD_RUNTIME_DATABASE_ROLE=guild_runtime_app
pnpm db:separate-legacy-roles
unset DATABASE_URL GUILD_MANAGEMENT_DATABASE_ROLE GUILD_RUNTIME_DATABASE_ROLE
```

The command fails closed when an unexpected owner exists or Runtime owns anything outside the
bounded Guild OS schemas, current database, default privileges, and required extensions. In one
transaction it transfers the legacy role's owned database objects, grants schema-management
authority to the new role, restores Runtime DML and function access, makes the migration ledger
read-only to Runtime, revokes Runtime schema creation, and installs default privileges for future
migrations. It is idempotent after a successful transfer.

Obtain the new management role URL from the provider and run `db:preflight`, `db:migrate`,
`db:provision-runtime`, and `db:verify` in that order. Keep Hyperdrive on the unchanged Runtime
credential. If the transaction fails, it rolls back. If a later migration fails, restore the
provider snapshot; never roll back by returning schema ownership to Runtime.

## 5. Supply secrets and deploy

Store the Webhook HMAC secret in the purchaser's secret manager and in the receiver. Paste it into a
hidden prompt for the live deploy:

```sh
pnpm exec wrangler login
read -r -s DATABASE_URL
export DATABASE_URL
export GUILD_RUNTIME_DATABASE_ROLE=guild_runtime_app
read -r -s GUILD_WEBHOOK_SIGNING_SECRET
export GUILD_WEBHOOK_SIGNING_SECRET
```

When `aiGateway.enabled` is true, also provide the narrowly scoped Cloudflare API token:

```sh
read -r -s CF_AI_GATEWAY_API_TOKEN
export CF_AI_GATEWAY_API_TOKEN
```

When `guild.modelProvider.kind` is `openai_compatible`, also provide the purchaser-owned endpoint
token. The binding name is fixed so deployment configuration cannot redirect secret lookup:

```sh
read -r -s GUILD_MODEL_PROVIDER_TOKEN
export GUILD_MODEL_PROVIDER_TOKEN
```

Deploy and clear the shell environment:

```sh
pnpm deploy
unset DATABASE_URL GUILD_RUNTIME_DATABASE_ROLE GUILD_WEBHOOK_SIGNING_SECRET \
  GUILD_MODEL_PROVIDER_TOKEN CF_AI_GATEWAY_API_TOKEN
```

The deploy script rejects uncommitted source or an unpinned submodule, verifies the management
database URL and the separately named Runtime role, then reruns tests, lint/type checks, and builds
before updating a Worker. It strips both database values from every child process. Every deployed
Worker Version receives the full Git SHA as its message and `guild-os-<short-sha>` as its tag. It
validates every required secret before
the first update, creates restricted temporary secret files for Wrangler, deletes them in all exit
paths, and removes database, Webhook, AI, and Access smoke credentials from unrelated child
processes.

For an in-place update where every required Secret binding already exists on the exact configured
Worker, do not rotate or re-enter those values. Use:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
export GUILD_RUNTIME_DATABASE_ROLE=guild_runtime_app
pnpm deploy -- --preserve-existing-secrets
unset DATABASE_URL GUILD_RUNTIME_DATABASE_ROLE
```

This mode calls `wrangler secret list` for every Worker with a required binding and validates exact
Secret names before the first deployment. It never reads a Secret value. Wrangler preserves
existing Secrets when a new Version is deployed without a replacement Secret file. A missing
required name fails the entire pre-deployment phase; use the hidden-input flow above to create or
intentionally rotate a Secret.

`pnpm deploy` installs only the Secret values understood by `scripts/deploy.mjs`:
`GUILD_WEBHOOK_SIGNING_SECRET`, external-provider `GUILD_MODEL_PROVIDER_TOKEN`, and, when enabled,
`CF_AI_GATEWAY_API_TOKEN`. Additional purchaser Connection Secret references are ordinary Guild
Gatekeeper Worker bindings. Install each additional value interactively, then verify only the
binding names:

```sh
read -r SECRET_REFERENCE
read -r GUILD_GATEKEEPER_WORKER_NAME
pnpm exec wrangler secret put "$SECRET_REFERENCE" \
  --name "$GUILD_GATEKEEPER_WORKER_NAME"
pnpm exec wrangler secret list \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --format json
unset SECRET_REFERENCE GUILD_GATEKEEPER_WORKER_NAME
```

A custom Cloudflare Service Binding cannot be created by inserting a Connection row. It requires a
reviewed deployment extension and an actual `Fetcher` binding on the Guild Gatekeeper Worker.

Generate a non-secret release record after deployment. The output must be a new absolute path
outside the repository:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm release:evidence -- \
  --output /Volumes/EncryptedOps/guild-os/releases/RELEASE.json
unset DATABASE_URL
```

For a `workersDev` Workshop, add `--url https://<worker>.<subdomain>.workers.dev`. The record hashes
private labels and administrator identities, re-verifies the target database, captures
migration/config hashes and all active Worker Version IDs, strips Cloudflare author email, and
writes a read-only SHA-256 sidecar. Keep it with the change record; do not commit purchaser instance
evidence to the sales template.

## 6. Initialize ownership

1. Confirm Access allows only the intended Root Owner.
2. Confirm the same person is the only configured Workshop administrator.
3. Open the Workshop URL, then open **Guild**. Merely opening this page must not create Guild rows.
4. Choose the Context Profile that best matches the intended use. **Personal with AI** is the
   recommended default for one person; Company, Research, and Community are primary alternatives.
   Creator, Open Source, Agent Collective, and Blank are under advanced Profiles.
5. Verify the read-only Guild name and purpose. Enter the intended human Root display name, select
   the preferred locale, accept the Root-responsibility checkbox, and submit **Create Guild** once.
   Starting-context fields are optional and already contain Profile-specific safe defaults.
6. Verify the completion receipt, including Profile, Root Owner, assistant state, and Connection
   state, then select **Open Guild OS**. Personal with AI must provision one bounded Personal
   assistant; Connections remain off until an administrator enables them.
7. Confirm the account becomes a Human Identity with active Membership and Root Owner status. From
   a second authenticated but uninvited account, verify that Root identity, Constitution, transfer,
   and Agent configuration are not visible.
8. Create a second recovery administrator with the minimum intended Role; do not share the Root
   Owner login.
9. Rehearse a Root handover to that Human and back again. The current Root proposes the transfer in
   **Settings**, the named Human accepts from their own session, and both sides verify the proposal
   and acceptance in **Chronicle**. Acceptance invalidates the prior Root's recovery-code generation.
10. In **Settings > Emergency recovery**, select the Role retained by the prior Root and generate a
   code set. Verify ten codes are shown exactly once, store them under separate offline custody,
   rotate once to prove the first set is invalidated, and retain only the latest set.
11. Expand the Access Allow policy only after Guild invitation, claim, Root transfer, and recovery
   custody have been tested.

Root ownership cannot be assigned to an Agent, disabled, suspended, departed, or deleted through
the application.

## 7. Production acceptance smoke

First run the non-destructive automated smoke. It proves that an unauthenticated Workshop request
is redirected to the configured Access tenant, the reference receiver has strict health headers,
and an unsigned plausible write is rejected. It also captures the active Worker Versions:

```sh
pnpm smoke:production -- \
  --output /Volumes/EncryptedOps/guild-os/releases/SMOKE.json
```

Add `--url` for `workersDev`. Optionally set both `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` for a narrowly scoped Access service-token check; unset them immediately.
The smoke evidence deliberately lists the human checks that remain.

Use synthetic names and non-sensitive content for the first test:

1. Invite one Human into `Preboarding`, claim the one-time invitation, complete assigned Knowledge,
   then activate and later depart that Identity.
2. Create one Agent and one Service, bind least-privilege Roles to a child Space, and verify a sibling
   Space is absent.
3. Create Knowledge, upload a small file, propose, approve, publish, acknowledge, ask a cited
   question, deprecate, and confirm every transition in Chronicle.
4. Create a Goal, Project, Quest, and Step; assign the Quest to the Agent and the Step to the Human.
5. Propose and approve a Decision with evidence and dissent; publish a Role/Space Announcement and
   verify Inbox delivery and read state.
6. Plan a Risk Level 2 Agent Webhook, approve it in Cloudflare OS and Guild governance, verify exactly
   one signed receiver record, and confirm completion, limits, and correlation in Chronicle.
7. Repeat the same idempotency key directly against the receiver and prove no second effect occurs.
8. Start a second run, use Kill before delivery, and verify the Workflow and approval terminate.
9. Stop the Agent and verify its active run, token-bearing Connector access, and future execution are
   denied immediately.
10. Test desktop and 390 px mobile navigation with English, Japanese, and Simplified Chinese modes.
11. Propose, cancel, repropose, and accept one Root ownership transfer; verify the outgoing Role,
    private notifications, expiry behavior, and append-only Chronicle evidence.
12. Before admitting real users, use one current recovery code from a separate authenticated Human
    account. Verify Root changes atomically, the old Root receives its configured Role, all sibling
    codes and pending transfers become invalid, `break_glass.used` records the disclosure and
    changes, and a fresh generation can be created under the new Root.

For every enabled external model or Connection, add synthetic acceptance for the exact provider,
route purpose, remote capability allowlist, health/discovery response, approval level, invocation,
revocation path, and provider-side audit trail. A saved metadata row is not an integration test. A
Service Binding additionally requires confirmation that the named `Fetcher` binding exists in the
active Guild Gatekeeper Worker version.

Do not admit real users until the automated smoke and all twelve human checks pass and their
checksums/results are attached to the release record.
For the bundled receiver, the repeat-delivery test is executable as `pnpm smoke:webhook`; see
[`packages/webhook-receiver/README.md`](../packages/webhook-receiver/README.md).

## 8. Migration to another purchaser environment

Use a complete verified backup, not the logical NDJSON export, for full-environment migration.
Create new Cloudflare and PostgreSQL resources in the destination account. The resource names and
IDs change; the restored Guild UUID remains the UUID recorded in the backup unless a separately
reviewed data transformation changes every Guild-scoped reference. The current restore tooling does
not perform such an identity rewrite.

1. Freeze source writes and create a final verified backup.
2. Prepare the backup offline with `pnpm restore:prepare`.
3. Restore PostgreSQL, KV, and R2 into new destination resources from that same backup set.
4. Recreate and review Access policies instead of blindly transplanting old account object IDs.
5. Create new Hyperdrive, Worker, Workflow, Durable Object, and Service Binding identities.
6. Reinstall provider and Connection Secret values under purchaser custody; only reference names
   travel in application metadata.
7. Deploy the exact source commit recorded by the backup, then apply only reviewed forward
   migrations.
8. Run database verification, production smoke, full Human acceptance, and an export checksum.
9. Switch the Access-protected hostname only after owner approval; keep the source denied but intact
   through the rollback window.

See [Backup and recovery](backup-and-recovery.md) for the store-level procedure and
[Administrator handover](admin-handover.md) for ownership acceptance.

## 9. Rollback

For code-only failure with no incompatible data change, inspect the active deployment and roll each
affected Worker back to its recorded last-known-good Version ID:

```sh
read -r WORKER_NAME
pnpm exec wrangler deployments status \
  --name "$WORKER_NAME" --json
read -r VERSION_ID
pnpm exec wrangler versions view "$VERSION_ID" \
  --name "$WORKER_NAME"
pnpm exec wrangler rollback "$VERSION_ID" \
  --name "$WORKER_NAME" --message "purchaser-approved rollback"
unset VERSION_ID WORKER_NAME
```

The rollback command changes production and requires purchaser approval. Confirm the Version ID
against release evidence before executing it. Roll back the coordinated Worker set, not one Worker
in isolation when contracts changed between them.

Never roll back the database by deleting migrations. If a new migration is incompatible, preserve
the failed environment, restore the pre-release database and object backup into new resources,
point a newly reviewed Hyperdrive configuration at it, and deploy the matching code.

After any rollback, repeat Access, Guild bootstrap, Knowledge read, Agent denial, and Chronicle
checks. See [backup and recovery](backup-and-recovery.md) for the data procedure.
