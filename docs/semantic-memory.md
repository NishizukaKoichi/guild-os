# Semantic Memory Operations

Semantic Memory augments PostgreSQL lexical search. It is never the system of record and never
widens access. Memory rows and immutable versions remain authoritative; vectors are disposable
derived data.

## Authorization order

Ask Guild performs retrieval in this order:

1. PostgreSQL resolves the active Membership, Role, Capability, Space ancestry, classification,
   visibility, explicit sharing, custody, and current Memory version.
2. Only those authorized candidates participate in lexical and vector ranking.
3. The domain layer rechecks each selected resource.
4. Only the bounded authorized context and exact-version citations are sent to the model.

Personal Memory is not queued or searched. Explicitly shared Personal Memory becomes eligible only
after the audited custody transition. A vector hit can change ranking, never authorization.

## Database prerequisite

Migration `0030_memory_context_and_custody.sql` uses 1,024-dimensional pgvector values and trigram
search. A database administrator must run this once before the restricted application role applies
migrations:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Do not grant the application role superuser, `BYPASSRLS`, or extension-management authority.

## Normal operation

Creating a Guild or Shared Memory version queues one job per available `en`, `ja`, or `zh-CN`
locale. Scheduled maintenance claims jobs with `FOR UPDATE SKIP LOCKED`, processes at most 20 per
drain, retries failures with bounded backoff, and reclaims a processing lease after ten minutes.
The default embedding model is `@cf/baai/bge-m3`; an active purchaser embedding route can replace
it. Query-embedding failure falls back to authorized lexical retrieval instead of failing Ask.

Monitor structured maintenance output for completed embedding jobs and inspect failed rows through
purchaser database observability. Repeated failure is an operations incident: disable the broken
embedding route, retain lexical search, and repair provider credentials or model compatibility.

## Rebuild the derived index

Use this only for model replacement, index corruption, or a reviewed retrieval migration. Take and
verify a complete backup first. The commands below affect one Guild and preserve every Memory row,
version, custody record, citation, and Chronicle event.

Run in `psql` with the restricted application role, replacing the two variables. Keep the
transaction intact so forced RLS applies to the selected Guild:

```sql
\set guild_id '00000000-0000-0000-0000-000000000000'
\set embedding_model '@cf/baai/bge-m3'

BEGIN;
SELECT set_config('app.guild_id', :'guild_id', true);

DELETE FROM memory_embeddings
 WHERE guild_id = :'guild_id'::uuid;

DELETE FROM memory_embedding_jobs
 WHERE guild_id = :'guild_id'::uuid;

INSERT INTO memory_embedding_jobs (
  id, guild_id, memory_id, memory_version, locale, model
)
SELECT gen_random_uuid(), version.guild_id, version.memory_id,
       version.version, language.locale, :'embedding_model'
  FROM memories memory
  JOIN memory_versions version
    ON version.guild_id = memory.guild_id
   AND version.memory_id = memory.id
   AND version.version = memory.current_version
  JOIN resource_custody custody
    ON custody.guild_id = memory.guild_id
   AND custody.resource_type = 'memory'
   AND custody.resource_id = memory.id
   AND custody.custody IN ('guild', 'shared')
 CROSS JOIN LATERAL jsonb_object_keys(version.body) AS language(locale)
 WHERE memory.guild_id = :'guild_id'::uuid
   AND memory.status = 'active'
   AND language.locale IN ('en', 'ja', 'zh-CN');

COMMIT;
```

Let scheduled maintenance drain the queue. Compare eligible Memory/locale count, completed job
count, and vector count before accepting the rebuild. Then run an authenticated Ask smoke that
proves an authorized citation appears and a denied Space resource does not appear.

## Rollback and recovery

If a new embedding model degrades results, disable its route, rebuild with the prior model ID, and
repeat the authenticated citation smoke. If vector storage is unavailable, leave the queue intact
or disable the embedding route; lexical retrieval remains the fail-safe. Never restore vectors
without their matching PostgreSQL Memory versions, and never use vectors as a backup source.
