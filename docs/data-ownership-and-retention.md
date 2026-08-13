# Data Ownership And Retention

This runbook defines purchaser data custody, logical export, retention, and deletion boundaries for
the supported production workflow.

## Ownership model

One deployment represents one Guild and one independent data boundary. The purchaser owns its
PostgreSQL database, R2 objects, KV data, Cloudflare Access policy, Worker configuration, model
accounts, Connection endpoints, backups, and operational evidence. The seller has no required
runtime account and no recovery bypass.

Application records use three custody classes:

| Custody | Meaning | Default handling |
| --- | --- | --- |
| `guild` | Official organizational record owned by the Guild | Available only through Role, Space, visibility, and classification authorization |
| `personal` | Record owned by one Human | Excluded from Guild retrieval and Agent context until explicitly shared |
| `shared` | Personal record explicitly contributed to the Guild | Retains the personal owner and sharing evidence while becoming available within its authorized Guild boundary |

Custody applies to Memory, Activity, Decision, Conversation, File, and Agent Run resources. A Guild
record cannot silently become personal, and a shared record cannot silently return to personal
custody. Relations inherit the stricter boundary of the records they connect.

Private conversations have separate participant authorization. Their message plaintext is not
copied into Chronicle. A participant can explicitly promote selected text to Guild Memory,
Activity, Decision, or Handover from the private-message surface. The application stores source
message IDs, a content fingerprint, the initiating Human, the created resource, status, and
Chronicle evidence. Replays are idempotent and current subject authorization is checked before the
text leaves PostgreSQL. Do not reclassify private data with direct SQL.

## Constitution data policy

The Constitution stores the Guild's default visibility, default classification, personal-data
departure policy, cross-Guild sharing policy, and retention period. Root-only Constitution changes
are versioned and require Chronicle reasons.

Before admitting real data, the purchaser must document:

- what is official Guild Data and what remains Personal Data;
- which Spaces and classifications apply;
- whether departed-member Personal Data is retained, archived, or deleted after retention;
- the legal and contractual basis for each retention period;
- who may request export, authorize purge, and hold backups;
- litigation hold, investigation hold, and regulatory exceptions.

The application policy is not legal advice and does not override a purchaser's obligations.

## Logical data export

An authorized Human opens **Operations > Data**. `data.manage` may request or retry an export;
`data.read` may list and download it. Only the Human who requested a job may retry or download that
job.

The export has these fixed categories:

```text
guild, actors, spaces, roles, memories, activities, decisions,
conversations, files, agent_runs, chronicle, operations
```

Guild and shared records are included. Personal records are included only when the requester checks
the personal-data option and is the personal owner. The job writes NDJSON and ready file bodies to
the purchaser's Knowledge R2 bucket, records row/file/byte counts and SHA-256, and expires after
seven days. Maintenance removes expired export objects and marks their jobs expired. A failed job
removes partial objects before it becomes retryable.

The `operations` category can include Connection and model-provider metadata, including Secret
reference **names**. It cannot read or export Worker Secret values.

### Export is not backup

The logical export is a portable, human-requested product view. It is not a physical recovery set.
Its fixed categories do not include every internal table or state machine, and it does not capture
Cloudflare Access, KV, Worker Versions, deployment resource locks, every R2 prefix, or external
provider configuration. In particular, do not assume private-message, onboarding, handover,
workflow-evidence, or every operational table is recoverable from the NDJSON.

Use [Backup and recovery](backup-and-recovery.md) for disaster recovery or full-environment
migration.

### Export verification

For each export, retain outside the source repository:

- requester, request time, included-personal choice, and Chronicle event ID;
- completed status, row/file/byte counts, SHA-256, and expiry time;
- the downloaded NDJSON checksum;
- a sample parse proving every line is valid JSON;
- the destination and deletion date for any copy made outside purchaser R2.

Example local validation of a downloaded export:

```sh
read -r EXPORT_PATH
shasum -a 256 "$EXPORT_PATH"
node -e '
  const fs = require("node:fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
  for (const line of lines) JSON.parse(line);
  console.log(`valid NDJSON records: ${lines.length}`);
' "$EXPORT_PATH"
unset EXPORT_PATH
```

The download endpoint verifies the full byte count and SHA-256 before returning the file. The UI
shows the leading checksum characters; confirm that prefix against the local result and retain the
full local checksum as purchaser evidence before the file is used for disclosure.

## Retention semantics implemented in code

The retention runtime accepts only these category/action pairs:

| Category | `retain` dry count | Reversible `archive` | Irreversible `purge` |
| --- | --- | --- | --- |
| memories | Yes | Active eligible records to `archived` | No |
| activities | Yes | Eligible completed records to `archived` | No |
| decisions | Yes | No | No |
| conversations | Yes | No | No |
| files | Yes | No | Deleted, expired, unlinked eligible files only |
| agent_runs | Yes | No | No |
| chronicle | Yes | No | No |

The SQL is a closed allowlist. A caller cannot provide a table, column, predicate, or SQL fragment.
Runs are bounded, leased, checkpointed, retried within limits, and recheck the Constitution policy
version at execution. A policy change makes the run fail closed.

`archive` is a status transition, not deletion. File `purge` removes eligible metadata and custody
records and atomically queues the R2 object for durable deletion. A file is eligible only after it
is already marked deleted, its `retention_until` has elapsed, and it is no longer linked to
governed Knowledge or Memory. Chronicle itself has no purge allowlist.

## Dry-run, evidence, and purge

A safe destructive workflow must proceed in this order:

1. Take and verify a complete backup.
2. Freeze the Constitution policy version for review.
3. Create a dry-run containing the exact categories, actions, and cutoff.
4. Verify `affectedCount` remains zero and review every `candidateCount`.
5. Record owner approval, legal/hold checks, dry-run ID, policy version, cutoff, and backup checksum.
6. For purge, obtain fresh one-use server authorization evidence for the same active Human.
7. Create the non-dry run with exactly the approved scope.
8. Verify checkpoints, terminal Chronicle evidence, R2 deletion outbox completion, and a second
   inventory.

The planning service requires every mutation to be submitted by the active Human Root Owner and to
match a completed dry run exactly: Constitution policy version, cutoff, ordered categories, and
actions. Archive apply requires the confirmation `APPLY`; a plan containing purge requires
`PURGE`. A dry-run requires neither confirmation nor a previous preview and must mutate zero
records.

Non-dry file purge also requires a Cloudflare Access login verified within the preceding five
minutes. Template provisioning creates one active Access-verifier Service Actor for a new Guild;
migration `0042_access_verifier_service_backfill.sql` creates the same least-privileged Service and
Chronicle provenance for existing Guilds that lack one. The planning service uses that matching
Service Actor to append `authorization.verified`, stores only a SHA-256 assertion and immutable
evidence metadata, gives the evidence a five-minute lifetime, and consumes it once when the run is
planned. It never stores an Access token in the evidence row.

## Supported retention workflow

The retention schema, planning service, repository, runtime, adapter, management API, Operations UI,
and tests form one supported path. The runtime uses bounded batches, leases, heartbeats,
checkpoints, retry limits, policy rechecks, Chronicle terminal evidence, and a transactional R2
deletion outbox. Template provisioning and the existing-Guild backfill create the least-privileged
Access-verifier Service Actor required by purge planning. Scheduled maintenance drains queued runs
and reports processed, completed, failed, and lease-lost counts.

In **Operations > Data retention**, a Root Owner creates a dry-run, reviews candidate counts and the
frozen Constitution version, selects that exact completed preview, and types `APPLY` or `PURGE`.
Purge additionally requires a current Cloudflare Access login and consumes one-use verification
evidence. The history table exposes plan, counts, status, evidence state, and completion. Direct SQL,
manual R2 deletion, and ad hoc runtime calls remain unsupported because they bypass the preview,
Root, policy-version, reauthentication, and Chronicle controls.

## Offboarding data handling

Use the governed People offboarding flow, never a direct Membership state update. The current
surface requires a reason, prevents self-offboarding, and requires Root ownership transfer before
the Root can leave. Assign a successor when open work or files need handover.

After submission, verify:

- Membership is non-operational and Guild data access is denied;
- owned sessions, tokens, Connections, schedules, approvals, queued delivery, and active Agent work
  are stopped atomically by the integrated lifecycle path;
- open official work and files have a named Handover item;
- official Guild contributions remain in Guild custody;
- Personal Data follows the recorded Constitution policy;
- purchaser-side model, email, storage, and identity-provider credentials are revoked separately;
- Chronicle contains the lifecycle decision without exposing private plaintext.

The supported People/Members management path routes through the same transactional lifecycle
service tested against PostgreSQL. If any postcondition fails in production, treat offboarding as
an incident, deny access at Cloudflare Access and the external provider first, and preserve
evidence.

## Verification commands

Validate the fixed export and retention contracts in the reviewed checkout:

```sh
pnpm --filter @guild-os/gatekeeper exec vitest run \
  __tests__/retention-service.test.ts \
  __tests__/retention-runtime.test.ts \
  __tests__/retention-adapter.test.ts

read -r -s DATABASE_URL
export DATABASE_URL
pnpm --filter @guild-os/postgres test:integration
unset DATABASE_URL
```

Use only a migrated, disposable PostgreSQL test database. The package integration command mutates
that database and includes `src/portability.integration.test.ts`.

Before relying on a deployed export, also verify the current Worker release and run the production
smoke from [Production deployment](deployment.md). No command in this document authorizes a purge.
