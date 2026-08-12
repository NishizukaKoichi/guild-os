# Backup And Recovery

Guild OS has one relational system of record plus purchaser-owned Cloudflare stores. A PostgreSQL
dump alone is not a complete backup. The supported backup command captures one verified set and
does not depend on a seller account or service.

## Backup contents

| Store | Export |
| --- | --- |
| PostgreSQL | Custom-format `pg_dump`, restore catalog, migration and quiescence boundary |
| Context, Blueprints, Avatars KV | Binary-safe JSONL with expiration and metadata |
| Knowledge and Blueprint R2 | Full object trees plus per-object SHA-256 indexes |
| Cloudflare Access | Matching application and policies |
| Workers | Active deployment and Version IDs, with author identity removed |
| Deployment | Restorable resource lock, summary, and source/migration hashes; no secret values |
| Context Artifacts | Optional verified Git bundle |

Secrets and plaintext Break Glass codes are deliberately excluded. Keep database credentials,
Webhook HMAC values, OAuth/provider secrets, and recovery codes in separate purchaser-controlled
custody.

## Policy

Choose RPO and RTO before admitting real users. A reasonable small-team baseline is provider PITR,
one daily logical backup, 30 daily copies, 12 monthly copies, and a quarterly restore rehearsal.
Keep at least one encrypted copy in a different account and failure domain.

The backup directory contains private organizational data. Put it on a FileVault/LUKS/BitLocker
volume or another encrypted destination before using the required confirmation flag. The flag is an
operator assertion; the script cannot prove the storage layer's encryption policy.

## Requirements

- A clean source checkout with the purchaser's `deployment.lock.json`
- `pg_dump` and `pg_restore` matching the production PostgreSQL major version
- `rclone` configured for the purchaser's R2 account
- `DATABASE_URL` with read access to the full Guild database
- `CLOUDFLARE_API_TOKEN` scoped to read the configured KV namespaces, Access application/policies,
  and Worker deployments
- Zero nonterminal Agent Runs, pending/processing outbox rows, or pending file uploads
- Access temporarily restricted to the backup operator for the whole command

The script checks the latest migration, Guild existence, active-work counts, and Chronicle sequence
before and after export. If the Chronicle sequence changes, it deletes the incomplete output.

## Create and verify

Use an absolute destination outside the repository. `R2_REMOTE` is the name of an existing `rclone`
remote, not a secret or bucket name.

```sh
export DATABASE_URL='postgresql://...'
export CLOUDFLARE_API_TOKEN='...'

pnpm backup:create -- \
  --output /Volumes/EncryptedOps/guild-os/2026-08-12T010000Z \
  --r2-remote purchaser-r2 \
  --confirm-encrypted-destination

unset DATABASE_URL CLOUDFLARE_API_TOKEN

pnpm backup:verify -- \
  --input /Volumes/EncryptedOps/guild-os/2026-08-12T010000Z
```

When Context Artifacts is enabled, also pass its clean local mirror:

```sh
--artifacts-repository /Volumes/Pensive/Operations/context-artifacts
```

Creation uses restricted file modes, verifies the `pg_dump` catalog, compares the remote R2 tree,
indexes every object, hashes every exported control file, and runs the same full verification used
by `backup:verify`. Copy the finished directory off-site only after the command succeeds.

## Prepare a restore

Never restore into production in place. First verify and prepare an immutable backup into a separate
directory:

```sh
pnpm restore:prepare -- \
  --input /Volumes/EncryptedOps/guild-os/2026-08-12T010000Z \
  --output /Volumes/EncryptedOps/guild-os-restore/2026-08-12T010000Z
```

This command verifies all manifest, file, KV, and R2 checksums again. It emits
`restore-plan.json` and bounded `kv/<store>/batch-*.json` files compatible with Wrangler's binary
bulk shape. It performs no network call and mutates no cloud resource.

## Restore rehearsal

Create a new PostgreSQL database, Hyperdrive configuration, KV namespaces, R2 buckets, Access
application, Worker names, Guild UUID, and HMAC secret. Keep Access restricted to recovery testers.

1. Restore PostgreSQL and verify the catalog:

   ```sh
   pg_restore --list BACKUP/postgres/guild-os.dump
   pg_restore --exit-on-error --no-owner --no-acl \
     --dbname "$RESTORE_DATABASE_URL" BACKUP/postgres/guild-os.dump
   DATABASE_URL="$RESTORE_DATABASE_URL" pnpm db:migrate
   ```

2. For every generated KV batch, target the newly created namespace explicitly:

   ```sh
   pnpm exec wrangler kv bulk put RESTORE/kv/context/batch-00001.json \
     --namespace-id "$NEW_CONTEXT_KV_ID" --remote
   ```

3. Copy each backed-up R2 directory into its new bucket, preserving metadata, then run `rclone
   check` and compare the stored object count/bytes with `restore-plan.json`.
4. Recreate the Access application and policies from `cloudflare/access.json`; review identities,
   session duration, and hostname instead of applying the old object blindly.
5. Configure a new ignored `deployment.local.jsonc` and let the first deploy create a new lock.
   Never transplant production resource IDs into the rehearsal.
6. Deploy the exact source commit recorded by the backup, then apply only reviewed newer migrations.
7. Verify Root integrity, RLS cross-Guild denial, Knowledge/files, Ask citations, Work, Decisions,
   Inbox, Chronicle ordering, Agent approval/delivery, and Kill behavior.
8. Rotate Break Glass codes. A point-in-time database restore can revive the generation pointer that
   existed at that historical time.
9. Record measured RPO/RTO and the release, backup, restore-plan, and smoke checksums.

## Production recovery

Preserve the failed environment for forensics. Restore the newest verified set into new resources,
rotate every possibly exposed secret, deploy the recorded commit, and run the production smoke plus
the human acceptance matrix. Switch the Access-protected hostname only after owner approval. Keep
the old environment denied but intact until its retention decision is recorded.

Never delete migrations to roll back. Never combine a PostgreSQL point from one backup with KV or R2
from another. For one missing immutable R2 object, restore only that key and verify its SHA-256
against PostgreSQL metadata and the backup index.

## Break Glass custody

The active Root generates ten one-time codes in **Settings > Emergency recovery**. Plaintext is
shown once and is not in backups. Split current codes across trusted Human custodians and a separate
failure domain. Rotate after custody changes, suspected exposure, Root transfer, or recovery use.
The seller cannot reconstruct a code or bypass this process.
