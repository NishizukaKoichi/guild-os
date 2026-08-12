# Production Deployment

This runbook deploys one purchaser-owned Guild. The purchaser must own the Cloudflare account,
PostgreSQL database, domain, model credentials, Webhook receiver, backups, and administrator
identities. No seller service is required after deployment.

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
   where available, and a dedicated non-superuser application role.
2. Run `pnpm db:migrate` with the direct database URL containing exactly
   `sslmode=verify-full`. Never put that URL in Git or either deployment configuration file.
   Then run `pnpm db:verify`; production verification requires PostgreSQL 17+, TLS, a non-superuser
   role without `BYPASSRLS`, exact migration checksums, and forced RLS on every Guild table.
3. Create a Hyperdrive configuration for that database and record its 32-character ID.
4. Choose the Workshop hostname. For an evaluation deployment, use a `workersDev` route. For
   production, use a hostname in a purchaser-owned Cloudflare zone.
5. Create a Cloudflare Access self-hosted application for that exact hostname. Start with only the
   intended Root Owner in the Allow policy. Record the issuer origin and application audience.
6. Enable the bundled purchaser-owned reference Webhook receiver, or deploy another HTTPS receiver
   that follows [the receiver contract](agent-webhook.md), including HMAC verification, a
   five-minute replay window, and durable idempotency. The bundled receiver uses one SQLite-backed
   Durable Object per idempotency key and can use a `workersDev` or custom-domain route.

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
git submodule update --init
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

`pnpm check` repeats dependency audit and peer checks, runs tests and type/lint checks, builds all
Workers, and asks Wrangler for deployment dry runs. It does not need application secrets and does
not create cloud resources.
CI points it at `fixtures/deployment.ci.jsonc`, whose reserved values exist only to prove all Worker
bundles. Local setup without a purchaser configuration still fails clearly on template
placeholders.

## 5. Supply secrets and deploy

Store the Webhook HMAC secret in the purchaser's secret manager and in the receiver. Paste it into a
hidden prompt for the live deploy:

```sh
pnpm exec wrangler login
read -r -s DATABASE_URL
export DATABASE_URL
read -r -s GUILD_WEBHOOK_SIGNING_SECRET
export GUILD_WEBHOOK_SIGNING_SECRET
```

When `aiGateway.enabled` is true, also provide the narrowly scoped Cloudflare API token:

```sh
read -r -s CF_AI_GATEWAY_API_TOKEN
export CF_AI_GATEWAY_API_TOKEN
```

Deploy and clear the shell environment:

```sh
pnpm deploy
unset GUILD_WEBHOOK_SIGNING_SECRET CF_AI_GATEWAY_API_TOKEN
```

The deploy script rejects uncommitted source or an unpinned submodule, verifies the direct database,
then reruns tests, lint/type checks, and builds before updating a Worker. Every deployed Worker
Version receives the full Git
SHA as its message and `guild-os-<short-sha>` as its tag. It validates every required secret before
the first update, creates restricted temporary secret files for Wrangler, deletes them in all exit
paths, and removes database, Webhook, AI, and Access smoke credentials from unrelated child
processes.

Generate a non-secret release record after deployment. The output must be a new absolute path
outside the repository:

```sh
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
4. Verify the displayed Guild name and purpose. Enter the intended human display name, select the
   preferred locale, type the Guild name exactly, and submit **Initialize** once.
5. Confirm the account becomes a Human Identity with active Membership and Root Owner status. From
   a second authenticated but uninvited account, verify that Root identity, Constitution, transfer,
   and Agent configuration are not visible.
6. Create a second recovery administrator with the minimum intended Role; do not share the Root
   Owner login.
7. Rehearse a Root handover to that Human and back again. The current Root proposes the transfer in
   **Settings**, the named Human accepts from their own session, and both sides verify the proposal
   and acceptance in **Chronicle**. Acceptance invalidates the prior Root's recovery-code generation.
8. In **Settings > Emergency recovery**, select the Role retained by the prior Root and generate a
   code set. Verify ten codes are shown exactly once, store them under separate offline custody,
   rotate once to prove the first set is invalidated, and retain only the latest set.
9. Expand the Access Allow policy only after Guild invitation, claim, Root transfer, and recovery
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

Do not admit real users until the automated smoke and all twelve human checks pass and their
checksums/results are attached to the release record.
For the bundled receiver, the repeat-delivery test is executable as `pnpm smoke:webhook`; see
[`packages/webhook-receiver/README.md`](../packages/webhook-receiver/README.md).

## 8. Rollback

For code-only failure, use Cloudflare Workers version rollback or redeploy the last known-good Git
commit. Never roll back the database by deleting migrations. If a new migration is incompatible,
restore the pre-release database and object backup into a new environment, point a newly reviewed
Hyperdrive configuration at it, and redeploy the matching code.

After any rollback, repeat Access, Guild bootstrap, Knowledge read, Agent denial, and Chronicle
checks. See [backup and recovery](backup-and-recovery.md) for the data procedure.
