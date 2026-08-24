# Backup And Recovery

Guild OS has one relational system of record plus purchaser-owned Cloudflare stores. A PostgreSQL
dump alone is not a complete backup. The supported backup command captures one verified set and
does not depend on a seller account or service.

## Backup contents

| Store | Export |
| --- | --- |
| PostgreSQL | Guild-scoped, forced-RLS-aware plain SQL with column `INSERT`s, migration and quiescence boundary |
| Context, Blueprints, Avatars KV | Binary-safe JSONL with expiration and metadata |
| Knowledge and Blueprint R2 | Full object trees plus per-object metadata and SHA-256 indexes |
| Cloudflare Access | Matching application and policies |
| Workers | Active deployment and Version IDs, with author identity removed |
| Deployment | Restorable resource lock, summary, and source/migration hashes; no secret values |
| Context Artifacts | Optional verified Git bundle |

PostgreSQL includes Guild-owned Connection and model-provider metadata, their capability/model
allowlists, and Secret reference names. It cannot include Worker Secret values, external-provider
state, or a Cloudflare Service Binding that exists only in deployment configuration. Recreate those
runtime bindings from the purchaser's separate custody register during restore.

Secrets and plaintext Break Glass codes are deliberately excluded. Keep database credentials,
Webhook HMAC values, OAuth/provider secrets, and recovery codes in separate purchaser-controlled
custody.

## Policy

Choose RPO and RTO before admitting real users. A reasonable small-team baseline is provider PITR,
one daily complete application backup, 30 daily copies, 12 monthly copies, and a quarterly restore
rehearsal. Keep at least one encrypted copy in a different account and failure domain.

The backup directory contains private organizational data. Put it on a FileVault/LUKS/BitLocker
volume or another encrypted destination before using the required confirmation flag. The flag is an
operator assertion; the script cannot prove the storage layer's encryption policy.

## Requirements

- A clean source checkout with the purchaser's `deployment.lock.json`
- `pg_dump` and `psql` matching the production PostgreSQL major version
- A direct, unpooled `DATABASE_URL` with read access to the full Guild database and explicit
  `sslmode=verify-full`; the backup's Guild-scoped startup setting is not compatible with
  transaction-pooler endpoints
- `CLOUDFLARE_API_TOKEN` scoped to read the configured KV namespaces, R2 buckets, Access
  application/policies, and Worker deployments
- Zero nonterminal Agent Runs, pending/processing outbox rows, or pending file uploads
- Access temporarily restricted to the backup operator for the whole command

The script checks the latest migration, Guild existence, active-work counts, Chronicle sequence, and
every Guild-scoped table count before and after export. If any boundary changes, it deletes the
incomplete output.

## Create and verify

Use an absolute destination outside the repository. The default R2 exporter uses Cloudflare's REST
API and the same scoped API token as the other Cloudflare stores. It lists all cursor pages,
downloads each object, preserves list metadata in the index, and rejects a bucket whose inventory
changes before the export completes.

```sh
read -r -s DATABASE_URL
export DATABASE_URL
read -r -s CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN

pnpm backup:create -- \
  --output /Volumes/EncryptedOps/guild-os/2026-08-12T010000Z \
  --confirm-encrypted-destination

unset DATABASE_URL CLOUDFLARE_API_TOKEN

pnpm backup:verify -- \
  --input /Volumes/EncryptedOps/guild-os/2026-08-12T010000Z
```

The hidden prompts keep values out of the command text and shell history. They do not replace a
purchaser secret manager. Never put either value in an environment file in the repository.

When Context Artifacts is enabled, also pass its clean local mirror:

```sh
--artifacts-repository /Volumes/Pensive/Operations/context-artifacts
```

Creation uses restricted file modes, sets the configured Guild UUID for every `pg_dump` query,
uses libpq's system CA roots by default (or the explicit `sslrootcert` from `DATABASE_URL`), enables
row security explicitly, and emits column-name `INSERT`s rather than `COPY` so the dump can
be restored while row security remains active. It compares Chronicle and per-table row counts plus
the remote R2 tree, indexes every object, hashes every exported control file, and runs the same full
verification used by `backup:verify`. Copy the finished directory off-site only after the command
succeeds.

For Neon, copy the direct endpoint rather than the hostname containing `-pooler`. The backup command
rejects a recognized pooler endpoint before creating output so a failed startup cannot leave a
misleading partial backup.

The source checkout may be ahead of the active deployment during a pre-deploy backup. The manifest
records the clean backup-tool commit and active Worker release separately, requires every Worker to
be on the same 100-percent release, and refuses a database migration mismatch. Direct `guild_id`,
Actor `home_guild_id`, and explicitly reviewed relationship-scoped tables must all use forced RLS;
any unknown unscoped table stops the backup.

For large R2 stores, `rclone` remains an optional high-throughput path. Configure a purchaser-owned
R2 remote, then add `--r2-remote purchaser-r2`. The backup still indexes and verifies the local
object tree after `rclone check` succeeds.

Cloudflare Access read permission is separate from Workers/KV/R2 permission. If the backup token
cannot read Access, export the application and policies with a separately scoped read-only token or
create a reviewed JSON snapshot with this exact non-secret shape:

```json
{
  "application": {
    "id": "ACCESS_APPLICATION_UUID",
    "aud": "CONFIGURED_ACCESS_AUDIENCE",
    "domain": "guild.example.com"
  },
  "policies": [
    {
      "id": "ACCESS_POLICY_UUID",
      "name": "Allow members",
      "decision": "allow",
      "include": []
    }
  ]
}
```

Pass the absolute file path as `--access-snapshot`. The command rejects secret-like fields, an
audience mismatch, an empty policy set, or malformed IDs. Preserve every non-secret application and
policy field returned by the API; the abbreviated example only documents the required validation
boundary.

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

Keep the original backup immutable. The prepared directory is an execution plan, not a second
backup. Record both directory checksums and the exact source commit outside the repository.

## Restore rehearsal

Create a new PostgreSQL database, Hyperdrive configuration, KV namespaces, R2 buckets, Access
application, Worker names, and HMAC secret. Keep Access restricted to recovery testers. Use the
Guild UUID recorded by the backup in the isolated target; resource IDs and names change, but the
restored Guild identity does not. The current restore tooling does not rewrite every Guild-scoped
foreign key to a new UUID.

1. Restore PostgreSQL and verify the catalog:

   ```sh
   # Configure PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD, and PGSSLMODE
   # for the isolated target; do not expose a credential URL in process arguments.
   read -r BACKUP_GUILD_UUID
   PGOPTIONS="-c app.guild_id=$BACKUP_GUILD_UUID" psql \
     --no-psqlrc --single-transaction --set ON_ERROR_STOP=on \
     --file /absolute/verified-backup/postgres/guild-os.sql
   unset BACKUP_GUILD_UUID
   read -r -s DATABASE_URL
   export DATABASE_URL
   pnpm db:migrate
   pnpm db:verify
   unset DATABASE_URL
   ```

   `restore-plan.json` records the immutable backup under `sourceBackup.path`; its PostgreSQL entry
   identifies `postgres/guild-os.sql`. The prepared directory contains the plan and generated KV
   batches, not a duplicate SQL dump.

   Compare every restored Guild table count and the maximum Chronicle sequence with
   `stores.postgres.expectedGuildTableRows` and `expectedChronicleSequence` in
   `restore-plan.json` before testing the application.

2. For every generated KV batch, target the newly created namespace explicitly:

   ```sh
   pnpm exec wrangler kv bulk put RESTORE/kv/context/batch-00001.json \
     --namespace-id "$NEW_CONTEXT_KV_ID" --remote
   ```

3. Copy each backed-up R2 directory into its new bucket, preserving the metadata recorded in the
   adjacent index. Use the Cloudflare R2 REST API, Wrangler for individual objects, or `rclone` for
   bulk transfer, then compare object count, bytes, and hashes with `restore-plan.json`.
4. Recreate the Access application and policies from `cloudflare/access.json`; review identities,
   session duration, and hostname instead of applying the old object blindly.
5. Configure a new ignored `deployment.local.jsonc` and let the first deploy create a new lock.
   Set `guild.id` to the backup Guild UUID. Never transplant production Cloudflare resource IDs
   into the rehearsal.
6. Initialize the destination Cloudflare OS profile and explicitly enable the Guild ambient
   Gatekeeper for the intended testers. Cloudflare OS per-user account identifiers, its profile
   state, and ambient Gatekeeper enablement are deployment state, not Guild backup contents.
7. Deploy the exact source commit recorded by the backup, then apply only reviewed newer migrations.
8. Recreate every provider Secret and Connection Secret or Service Binding from purchaser custody.
   Verify the binding names and the exact model/capability allowlists; never copy a Secret value
   from application metadata because it is not stored there.
9. Run authenticated production smoke into a new external evidence file, then have Core compare the
   live target against the immutable backup before any recovery mutation:

   ```sh
   pnpm smoke:production -- \
     --output /PURCHASER-EVIDENCE/restore-initial-smoke.json
   pnpm restore:verify-pre -- \
     --backup /absolute/verified-backup \
     --restore-plan /absolute/prepared-restore \
     --smoke /PURCHASER-EVIDENCE/restore-initial-smoke.json \
     --output /PURCHASER-EVIDENCE/restore-pre-recovery.json
   ```

   `restore:verify-pre` is read-only. It re-verifies the backup and restore plan, queries the live
   forced-RLS PostgreSQL boundary, reads every target KV value and R2 object, compares exact hashes
   and metadata, binds the active Worker inventory and authenticated Access smoke, and writes
   `guild-os-restore-verification-pre/v1`. The output and checksum must remain outside Git. The
   command requires purchaser-scoped `DATABASE_URL` with `sslmode=verify-full`,
   `CLOUDFLARE_API_TOKEN`, and the target deployment configuration and lock.
10. Verify Root integrity, RLS cross-Guild denial, Knowledge/files, Ask citations, Work, Decisions,
   Inbox, Chronicle ordering, Agent approval/delivery, and Kill behavior.
11. Use a separately custodied Break Glass code to bind the destination Cloudflare OS Human account
    to Root, then rotate the generation. A point-in-time database restore can revive the generation
    pointer that existed at that historical time. If the backup records no active code set, stop the
    production recovery: absence of a separately custodied code is an operational recovery failure,
    not permission to bypass Root governance. A nonproduction rehearsal may use a separately
    approved target-only bootstrap that follows the repository's hashing, invalidation, and Chronicle
    invariants, but it must be invalidated immediately and recorded as rehearsal-only evidence.
12. Run a second authenticated smoke and generate the post-recovery technical record:

   ```sh
   pnpm smoke:production -- \
     --output /PURCHASER-EVIDENCE/restore-post-recovery-smoke.json
   pnpm restore:verify-post -- \
     --pre /PURCHASER-EVIDENCE/restore-pre-recovery.json \
     --smoke /PURCHASER-EVIDENCE/restore-post-recovery-smoke.json \
     --output /PURCHASER-EVIDENCE/restore-technical.json
   ```

   The post phase queries the same target and proves a completed recovery, one consumed code, code
   generation invalidation, an active Human Root membership, a later `break_glass.used` Chronicle
   event, no plaintext-capable code column, and authenticated smoke after recovery. It calculates
   measured RPO/RTO and emits checksum-bound `guild-os-restore-verification/v1`. It does not execute
   Break Glass or mutate the target. Guild OS Owned must then bind this technical record to the
   independent purchaser configuration and named ownership attestation; the Core record alone is
   not independent-purchaser commercial evidence.

After application checks, preserve both Smoke files, both Core verification files, their checksum
sidecars, the immutable backup, and restore plan in purchaser-controlled encrypted storage. A
successful login or hand-authored summary is not evidence that KV, R2, private data, Connection
metadata, or Chronicle ordering was restored.

### Verified rehearsal evidence

On 2026-08-21, exact Core commit
`63de2470e6ec7e5c4783ed947e54de7c78534eee` and Cloudflare OS commit
`bba32ca8fab7b9925f5b1a3e7e36c4d37f788ff5` completed an owner-controlled isolated rehearsal.
The verified encrypted backup restored 96 forced-RLS table scopes with no row-count mismatch and
Chronicle sequence `2888`, five KV values with exact hashes, and three R2 objects totaling 113,274
bytes with exact hashes and metadata. Access protection, authenticated Workshop access, unsigned
Webhook rejection, the real Break Glass Root-transfer UI, and post-recovery database integrity all
passed. Measured RPO was zero for the verified backup and measured RTO was 40m 46.571s.

The source backup contained no active Break Glass code set. A target-only, Chronicle-recorded code
generation was therefore used only to test the real recovery UI and was invalidated immediately.
The rehearsal also confirmed that the destination Cloudflare OS profile and Guild ambient
Gatekeeper must be initialized separately. All temporary Workers, Workflow, Hyperdrive, KV, R2,
Access application and policies, Neon branch, API tokens, Service Token, and plaintext recovery code
were deleted after verification. Checksummed evidence remains outside Git under
`/Volumes/Pensive/Workspace/NishizukaKoichi/guild-os-staging-evidence/restore-63de247.*`. This is
evidence for full-store restore behavior inside an owner-controlled account; it is not evidence of
an independent purchaser-account installation.

## Purchaser migration

A migration to another Cloudflare/PostgreSQL account is a restore into new resources followed by a
controlled hostname cutover:

1. Pass a restore rehearsal before the migration window.
2. Freeze source writes and restrict Access to migration operators.
3. Create a final backup and run `pnpm backup:verify` against it.
4. Prepare and restore that one backup set into destination resources using the recorded Guild UUID.
5. Recreate Access, provider Secrets, Connection Secrets, Service Bindings, and HMAC values under
   destination purchaser custody.
6. Deploy the backup's source commit, verify the database, and run production smoke plus Human
   acceptance against a nonproduction hostname.
7. Compare PostgreSQL row counts and Chronicle sequence, KV inventory, R2 object count/bytes/hashes,
   Access policy, active Worker Versions, and logical-export checksum.
8. Obtain owner approval, move the hostname, and keep the source environment denied but intact for
   the agreed rollback window.

Do not use the seven-day logical NDJSON export as a full migration source. Do not combine a provider
PITR database point with KV/R2 from a different backup merely because the timestamps are close.

## Production recovery

Preserve the failed environment for forensics. Restore the newest verified set into new resources,
rotate every possibly exposed secret, deploy the recorded commit, and run the production smoke plus
the human acceptance matrix. Switch the Access-protected hostname only after owner approval. Keep
the old environment denied but intact until its retention decision is recorded.

Never delete migrations to roll back. Never combine a PostgreSQL point from one backup with KV or R2
from another. For one missing immutable R2 object, restore only that key and verify its SHA-256
against PostgreSQL metadata and the backup index.

## Recovery evidence

A recovery is accepted only when the purchaser record includes:

- backup ID, format version, creation/verification status, and manifest checksum;
- source Git commit, Cloudflare OS gitlink, database migration set, and active Worker Versions;
- source and destination account/resource identifiers without credentials;
- restored row counts, maximum Chronicle sequence, KV counts, and R2 object/byte/hash totals;
- new deployment evidence and production smoke checksums;
- Secret reference and Service Binding inventory verification without values;
- measured RPO/RTO, owner approval, cutover time, and rollback deadline.

Keep this evidence with the purchaser's operations records. Do not commit it to the reusable source
template.

## Break Glass custody

The active Root generates ten one-time codes in **Settings > Emergency recovery**. Plaintext is
shown once and is not in backups. Split current codes across trusted Human custodians and a separate
failure domain. Rotate after custody changes, suspected exposure, Root transfer, or recovery use.
The seller cannot reconstruct a code or bypass this process.
