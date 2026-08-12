# Actor-neutral Collective migration

Migrations `0026_actor_collective_core.sql`, `0027_memory_activity_core.sql`,
`0028_collective_compatibility.sql`, and `0029_agent_token_limits.sql` add the neutral substrate and
complete Agent hard limits without deleting or renumbering any production record. They are
forward-only, checksum-pinned, transactional, and safe to rerun through the migration runner.

## Mapping

| Compatibility source | Canonical target |
| --- | --- |
| Identity | Actor with the same UUID and a kind profile |
| Membership | Actor Membership with neutral state |
| Role binding and permission | Actor Role binding and neutral Capability alias |
| Knowledge and version | Memory `type=knowledge`, `workflow=canonical`, same UUID/version |
| Goal, Project, Quest, Step | Recursive typed Activity with the same UUID and parent relation |
| Work assignment | Activity assignee Actor |
| Agent Run Quest | Agent Run Activity reference |
| Chronicle | Unchanged append-only Event source of truth |

The state mapping is `preboarding -> joined`, `active -> active`, `suspended -> paused`, and
`departed -> left`. Compatibility writes are mirrored after migration so old and new Worker
versions can be rolled between while the release is evaluated.

## Required preflight

1. Produce a clean release commit and run every local gate.
2. Restrict Access to the migration operator and wait for nonterminal Agent Runs, outbox work, and
   pending file uploads to reach zero.
3. Create and verify an encrypted backup as documented in
   [backup and recovery](backup-and-recovery.md). Record its path and manifest checksum outside Git.
4. Print the exact migration set and hashes without a database connection:

   ```sh
   pnpm --filter @guild-os/postgres migrate --dry-run
   ```

5. Apply the full migration set twice to an empty PostgreSQL 17 database owned by a non-superuser,
   then run both integration suites. The second migration pass must report no work.

   ```sh
   DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm db:migrate
   DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm db:migrate
   DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm --filter @guild-os/postgres test:integration
   DATABASE_URL="$REHEARSAL_DATABASE_URL" pnpm --filter @guild-os/gatekeeper test:integration
   ```

## Production apply and reconciliation

Run `pnpm db:verify`, then `pnpm db:migrate`. Each migration contains transaction-ending count and
reference guards, so a mismatch aborts before its migration ledger row commits. After application,
set `app.guild_id` to the configured Guild UUID and reconcile the compatibility sets:

```sql
SELECT
  (SELECT count(*) FROM identities) AS identities,
  (SELECT count(*) FROM identity_actor_links) AS identity_links,
  (SELECT count(*) FROM actor_memberships) AS actor_memberships,
  (SELECT count(*) FROM memberships) AS legacy_memberships,
  (SELECT count(*) FROM actor_role_bindings) AS actor_role_bindings,
  (SELECT count(*) FROM role_bindings) AS legacy_role_bindings;

SELECT
  (SELECT count(*) FROM knowledge) AS knowledge,
  (SELECT count(*) FROM memories WHERE legacy_source_type = 'knowledge') AS migrated_memory,
  (SELECT count(*) FROM knowledge_versions) AS knowledge_versions,
  (SELECT count(*) FROM memory_versions version
     JOIN memories memory ON memory.guild_id = version.guild_id AND memory.id = version.memory_id
    WHERE memory.legacy_source_type = 'knowledge') AS migrated_memory_versions;

SELECT
  (SELECT count(*) FROM goals) + (SELECT count(*) FROM projects) +
  (SELECT count(*) FROM quests) + (SELECT count(*) FROM steps) AS legacy_work,
  (SELECT count(*) FROM activities WHERE legacy_source_type IS NOT NULL) AS migrated_activity;
```

Each pair must match. Also run `pnpm db:verify`; it checks the exact migration hashes and forced RLS.
Do not continue to Worker deployment after any discrepancy.

## Release and rollback

Deploy the exact tested commit, then smoke Home, Ask, Members, Memory, Activity, Settings, a Space
vocabulary override, one Canonical Knowledge citation, and one direct Memory citation. Confirm that
History contains the new configuration and content events.

These migrations are additive. Application rollback is therefore a redeploy of the previous Worker
version; compatibility triggers keep the old tables current, and old runtimes ignore the additional
`maxTokens` and `tokens` JSON properties. Do not drop the new tables or delete migration ledger
rows. If data reconciliation fails, deny Access, preserve the failed database for forensics, and
restore the verified pre-migration backup into new resources.

## Compatibility removal gate

Remove legacy tables and APIs only in a later release after all of the following are true:

- no production client calls `searchKnowledge`, fixed Work mutations, or legacy Identity endpoints;
- every write path targets Actor, Membership, Memory, Activity, Capability, Run, and Event APIs;
- at least one full retention window has passed with zero compatibility-only writes;
- a fresh backup/restore rehearsal proves canonical counts, file links, Agent Runs, and History;
- rollback no longer requires a Worker version that reads legacy tables;
- a separate reviewed migration removes mirrors first, observes the release, and drops data only
  after another verified backup.

Until that gate, the compatibility layer is intentional production safety, not a second product
ontology.
