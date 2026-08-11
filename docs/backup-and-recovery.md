# Backup And Recovery

Guild OS has one authoritative relational store and several purchaser-owned object/configuration
stores. A database dump alone is not a complete backup.

## Inventory

| Store | Contents | Backup mechanism |
| --- | --- | --- |
| PostgreSQL | Guild, Constitution, Spaces, Identities, Memberships, Roles, Knowledge metadata and versions, Work, Decisions, Inbox, Agent Runs, Chronicle | Provider PITR plus encrypted `pg_dump` |
| Knowledge R2 | Knowledge files and checksummed Agent/file artifacts | S3-compatible copy with `rclone` or equivalent |
| Blueprint-content R2 | Cloudflare OS Blueprint assets | S3-compatible copy |
| Workshop KV | Blueprints and avatars | Cloudflare KV list/get export |
| Context KV or Artifacts | Cloudflare OS Context collections | KV export or Artifacts repository mirror |
| Cloudflare configuration | Access policy, Hyperdrive, AI Gateway, Worker versions, bindings | Exported settings plus `deployment.jsonc` and release record |
| Secrets | HMAC, provider, OAuth, and database credentials | Purchaser secret manager; never the backup archive |

## Policy

Set an explicit recovery point objective and recovery time objective before launch. A practical
small-team baseline is daily logical export, provider point-in-time recovery, 30 daily copies, 12
monthly copies, and a quarterly restore rehearsal. Encrypt every archive, store it in a different
failure domain and account, and restrict access to named Human administrators.

Chronicle is append-only application history, not a substitute for a backup. R2 and KV are not
automatically reconstructed from PostgreSQL.

## Consistent backup

1. Record the release commit and current `deployment.jsonc` resource identifiers.
2. Temporarily restrict the Cloudflare Access policy to the backup operator.
3. Kill or wait for every non-terminal Agent Run. Confirm no Workflow delivery or file upload is in
   progress and the durable outboxes have no pending item.
4. Take the PostgreSQL provider snapshot/PITR marker.
5. Create a custom-format logical dump without ownership or ACL records:

   ```sh
   read -r -s DATABASE_URL
   export DATABASE_URL
   pg_dump --format=custom --no-owner --no-acl --file guild-os.dump "$DATABASE_URL"
   unset DATABASE_URL
   ```

6. Copy each R2 bucket to an encrypted backup destination. Cloudflare R2 exposes an S3-compatible
   endpoint and supports `rclone copy` in either direction:

   ```sh
   rclone copy r2:knowledge-bucket encrypted-backup:guild-os/2026-08-12/r2/knowledge
   rclone copy r2:blueprint-bucket encrypted-backup:guild-os/2026-08-12/r2/blueprints
   ```

7. Export every KV namespace. Use `wrangler kv key list` to obtain all key names, retrieve values in
   batches of at most 100, and retain `expiration` and `metadata`; the resulting restore file must
   match the `wrangler kv bulk put` `{key,value,expiration,metadata,base64}` shape. Binary values must
   be Base64 encoded with `base64: true`.
8. Mirror an enabled Context Artifacts namespace through its Git-compatible interface.
9. Export Access application/policy, Hyperdrive, AI Gateway, Worker version, custom-domain, and
   binding identifiers into the release record. Do not export secret values into the archive.
10. Generate SHA-256 checksums for every dump/export and write a manifest containing UTC time,
    commit, Guild UUID, resource IDs, object counts, sizes, and checksums.
11. Re-enable the prior Access policy only after the manifest and off-site copy verify.

Cloudflare documents the current [KV CLI](https://developers.cloudflare.com/workers/wrangler/commands/kv/)
and [R2 `rclone` setup](https://developers.cloudflare.com/r2/examples/rclone/). Recheck those commands
against the pinned Wrangler version before automating them.

## Restore rehearsal

Never rehearse against production. Restore into a new PostgreSQL database, new KV namespaces, new R2
buckets, new Hyperdrive configuration, and new Worker names.

1. Verify the manifest signature/checksums and scan the archive from an isolated machine.
2. Restore PostgreSQL and inspect before exposing it:

   ```sh
   createdb guild_os_restore
   pg_restore --exit-on-error --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" guild-os.dump
   ```

3. Run `pnpm db:migrate` against the restored database. Existing migration checksums must match and
   only newer migrations may apply.
4. Copy R2 objects into the new buckets. Compare object counts, sizes, and sampled SHA-256 values
   with PostgreSQL `knowledge_files.sha256` metadata.
5. Restore KV files with `wrangler kv bulk put`, then compare key counts and sampled values.
6. Point a new Hyperdrive configuration at the restored database. Use a separate Access
   application and deny all users except recovery testers.
7. Deploy the exact recorded Git commit with new Worker/resource names and a newly rotated HMAC
   secret. Never reuse production Connector credentials in a rehearsal.
8. Verify Root Owner integrity, cross-Guild RLS denial, published Knowledge/file reads, Ask citations,
   Work/Decision/Inbox state, Chronicle ordering, and one synthetic Agent Run.
9. Record measured RPO/RTO, failed checks, and remediation. Delete the rehearsal environment only
   after the report is retained.

## Production recovery

Choose the newest verified recovery point before the incident. Preserve the failed environment for
forensics, restore into new resources, rotate all potentially exposed secrets, and deploy the code
commit recorded in the manifest. Switch the Access-protected hostname only after the rehearsal
checks pass. Keep the old environment denied but intact until owners approve disposal.

If only an R2 object is missing, restore that exact immutable object key and verify its database
checksum. If PostgreSQL is rolled back, restore R2/KV to the same backup boundary; mixing recovery
points can expose dangling files or stale Cloudflare OS state.
