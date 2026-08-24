# Administrator Handover

This runbook transfers one Guild OS instance to purchaser control. It is for a reviewed deployment,
not the reusable sales template. The handover is complete only when purchaser administrators can
operate, recover, export, restore, and revoke the system without a seller account.

## Non-negotiable ownership result

At acceptance, the purchaser controls:

- the canonical Git repository and release history;
- the signed release package, exact Core and Cloudflare OS local Git source archives, license,
  third-party notices, dependency inventory, and exact source/object manifest shipped with the
  installed release;
- the Cloudflare account, zone, DNS, Access application, Workers, Workflows, Hyperdrive, KV, R2,
  Durable Objects, AI Gateway, and service bindings used by the instance;
- the PostgreSQL organization/project, application role, backups, and recovery process;
- every model/provider, Webhook, MCP, OAuth, API, storage, and notification account;
- the production domain and its registrar account;
- the encrypted operations vault, backup destinations, release evidence, and incident records;
- the Guild Root succession process and current Break Glass codes.

The seller must not remain the only super-administrator, credential custodian, billing owner,
domain registrant, backup holder, Git host owner, or recovery contact.

## Handover register

Create a purchaser-owned change record outside the source repository. Record identifiers and
custodians, never credential values.

| Asset | Record |
| --- | --- |
| Source | Signed release-manifest checksum, local Core/Cloudflare OS bundle checksums and archive location, optional purchaser Git URL, release commit, gitlink, licenses, notices, dependency inventory, branch protection owner |
| Cloudflare | Account ID, account owners, zone, billing owner, support plan |
| Access | Application ID, audience, hostname, policy owner, emergency deny procedure |
| Workers | Worker names and active Version IDs for Workshop, Context, Guild Gatekeeper, receiver, and error reporter |
| State | PostgreSQL project/database, Hyperdrive ID, KV IDs, R2 bucket names, Durable Object/Workflow names |
| Deployment | Custodian and checksum of `deployment.local.jsonc` and `deployment.lock.json` |
| Models | Provider, approved model IDs, route purposes, budget owner, Secret reference names |
| Connections | Kind, endpoint/service binding, capability allowlists, risk level, owner, Secret reference names |
| Recovery | Backup location, last verified backup, last restore drill, RPO/RTO, Break Glass custodians |
| External | Domain registrar, Webhook receiver, OAuth clients, MCP/Gatekeeper services, alert destinations |

Do not attach `deployment.local.jsonc`, `deployment.lock.json`, release evidence, Access snapshots,
or backup manifests to the reusable template repository. They belong to the purchaser instance.

## Before the handover meeting

1. Freeze a reviewed Git commit and stop unreviewed production changes.
2. Run all local release gates and database preflight for that commit.
3. Create and verify a complete encrypted backup.
4. Complete an isolated restore rehearsal and record measured RPO/RTO.
5. Generate release and production smoke evidence outside the repository.
6. Inventory every Secret reference and service binding without retrieving values.
7. Generate and preserve the exact dependency license inventory for the reviewed lockfile.
8. Preserve the signed release package and verify that its Core and Cloudflare OS bundles clone
   locally at the recorded commits without a seller repository.
9. Add at least two purchaser-controlled Cloudflare and PostgreSQL administrators.
10. Add a purchaser-controlled Git organization owner and verify branch protection and release
    access when the purchaser imports the acquired source into its own Git host.
11. Invite a second active Human into Guild OS with the intended recovery administration Role.
12. Resolve or explicitly accept every item in the full-spec acceptance contract. Do not label an
    unresolved item complete.

Exact source and local gate record:

```sh
git status --short
git rev-parse HEAD
git submodule status
node --version
pnpm --version
pnpm audit:dependencies
pnpm peers:check
pnpm test
pnpm test:cloudflare-os
pnpm build
pnpm lint
pnpm types:check
pnpm check
```

`git status --short` must be empty for a release. `pnpm check` is a dry run and does not create cloud
resources.

## Transfer the application Root

Root ownership is separate from Roles. An Agent or Service can never become Root.

1. The current Root opens **Settings** and proposes an active named Human as the successor.
2. The current Root chooses the ordinary Role they will retain after transfer.
3. The successor signs in with their own Cloudflare Access identity and accepts before expiry.
4. Both Humans verify proposal and acceptance events in **Chronicle**.
5. The new Root confirms Constitution, Roles, Spaces, Operations, People, and recovery access.
6. Generate a new Break Glass generation under the new Root. Acceptance invalidates the former
   Root's generation; retain only the new set.

Ten one-time Break Glass codes are displayed once. Only hashes are stored. Split the plaintext codes
among purchaser-controlled Human custodians in a separate failure domain. Never put them in Git,
PostgreSQL notes, Cloudflare variables, Chronicle, chat, or the backup set.

## Transfer external control

Perform ownership changes in the purchaser accounts, then verify them from a purchaser session:

1. Cloudflare: purchaser administrators can manage billing, account members, Access, DNS, Workers,
   Hyperdrive, KV, R2, Workflows, AI, and API tokens.
2. PostgreSQL: purchaser administrators can restore backups, rotate the non-superuser management
   and Runtime credentials independently, and prove Hyperdrive uses only the Runtime role. The
   Runtime role has no DDL, `BYPASSRLS`, role/database creation, replication, or migration-ledger
   write authority, and neither credential remains accessible to the seller after handover.
3. Source: purchaser administrators can reinstall from the retained signed package with no seller
   network. If they use a private Git host, they can also clone, review the pinned Cloudflare OS
   state, run CI, create protected releases, and recover deleted local workstations.
4. Domain: purchaser controls registrar, DNS ownership, and renewal.
5. Providers: purchaser owns model, MCP, Webhook, OAuth, and any external storage accounts.
6. Operations vault: purchaser can decrypt configuration, resource locks, evidence, and backup
   manifests.

List deployed versions and Secret **names** from a purchaser-authenticated terminal:

```sh
read -r GUILD_GATEKEEPER_WORKER_NAME
pnpm exec wrangler deployments status \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --json
pnpm exec wrangler secret list \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --format json
unset GUILD_GATEKEEPER_WORKER_NAME
```

Repeat for each Worker that owns Secrets. Do not capture environment values or terminal sessions in
the handover record.

## Acceptance exercise

The purchaser, not the seller, performs the final exercise:

1. Extract the exact Core and Cloudflare OS commits from the purchaser-retained signed package into
   a clean directory, without seller-network access, install the lockfile, and pass local gates.
   Importing that source into a purchaser-owned Git URL is optional and must preserve licenses and
   provenance.
2. Verify the database without mutation and verify the deployed Worker release.
3. Sign in through Access as Root and as a least-privileged member; confirm denied Space data is not
   returned.
4. Create synthetic Knowledge, a file, Activity, Decision, and Agent plan; verify citations,
   approval, limits, and Chronicle evidence.
5. Request, download, checksum, and parse a logical export; record its seven-day expiry timestamp.
6. Revoke a synthetic Connection or provider and verify immediate denial and Chronicle evidence.
7. Run the production smoke and complete its listed Human checks.
8. Prepare a restore from the latest backup without using a seller credential.
9. Demonstrate an Access deny-all emergency action and reverse it without changing application data.

Generate fresh evidence paths outside the repository:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
export GUILD_RUNTIME_DATABASE_ROLE=guild_runtime_app
pnpm release:evidence -- \
  --output /absolute/purchaser-ops/releases/RELEASE.json
unset DATABASE_URL GUILD_RUNTIME_DATABASE_ROLE
pnpm smoke:production -- \
  --output /absolute/purchaser-ops/releases/SMOKE.json
read -r BACKUP_PATH
read -r RESTORE_PATH
pnpm backup:verify -- \
  --input "$BACKUP_PATH"
pnpm restore:prepare -- \
  --input "$BACKUP_PATH" \
  --output "$RESTORE_PATH"
unset BACKUP_PATH RESTORE_PATH
```

The handover record contains command status, timestamps, release/backup IDs, checksums, and named
approvers. It does not contain Secrets or private data samples.

## Offboard the seller or outgoing administrator

Offboarding is last, after purchaser recovery has been demonstrated.

1. Transfer Guild Root first. The current Root cannot offboard their own active session.
2. Use **People** to offboard the Human, provide a reason, and assign a successor for open official
   work and files.
3. Immediately remove that person from Cloudflare Access and purchaser identity-provider groups.
4. Remove Cloudflare, PostgreSQL, Git, registrar, model-provider, backup, and operations-vault roles.
5. Revoke personal API tokens, OAuth grants, SSH keys, deployment keys, service tokens, and active
   sessions at their source.
6. Rotate shared credentials and Break Glass codes; do not assume account removal rotates a shared
   value.
7. Verify assigned work and official contributions remain, while Personal Data follows the
   Constitution policy.
8. Verify lifecycle and revocation events in Chronicle and attach external-account evidence to the
   purchaser's incident/change record.

The supported Members management path executes the lifecycle postconditions in one database
transaction and has real-PostgreSQL integration coverage. Every release must still rehearse that
path against synthetic Identities. If a token, schedule, Connection, or Agent Run remains active,
deny it at Cloudflare Access/provider level, preserve evidence, and treat the handover as
incomplete.

## Administrator prohibitions

- Do not commit Secrets, database URLs, Access service-token values, recovery codes, or private
  purchaser configuration.
- Do not make the seller's account the sole owner of any runtime dependency.
- Do not remove Apache or dependency notices, claim exclusive ownership of third-party code, or make
  an update entitlement a runtime access check.
- Do not assign Root to an Agent or Service, share a Root login, or use direct SQL to replace Root.
- Do not edit an applied migration or delete migration history.
- Do not restore into production in place or combine stores from different backup sets.
- Do not patch Connection configuration or retention jobs directly in PostgreSQL.
- Do not enable an MCP, API, Service Binding, model, or Agent action without explicit allowlists,
  budgets, approval policy, synthetic test, and revocation owner.
- Do not claim the product is complete because a CLI deploy succeeded.

## Incident and recovery order

1. Protect people and external systems; stop affected Agent Runs and external actions.
2. Restrict Cloudflare Access or set an emergency deny policy.
3. Preserve failed resources, logs, Worker Version IDs, Chronicle events, and timestamps.
4. Revoke exposed provider credentials and issue new Secret values under purchaser custody.
5. Select the newest internally consistent verified backup.
6. Restore to new resources using [Backup and recovery](backup-and-recovery.md).
7. Deploy the matching source commit, verify migrations, and run smoke/acceptance.
8. Switch the Access-protected hostname only after purchaser owner approval.
9. Record the incident, recovery point, data loss window, and follow-up decision.

## Handover completion record

The purchaser approver signs only when all of the following are true:

- purchaser-controlled Humans hold Root, Cloudflare, PostgreSQL, Git, domain, provider, and backup
  authority;
- at least two independent purchaser administrators and separate Break Glass custody exist;
- local gates, database preflight, deployment evidence, smoke, backup verification, and restore
  rehearsal refer to the same reviewed release boundary;
- all Secret values have purchaser custody and only reference names appear in documentation;
- the installed source/object manifest, licenses, notices, and dependency inventory are preserved;
- seller and outgoing access has been removed and verified;
- known incomplete product boundaries are recorded, not described as complete.
