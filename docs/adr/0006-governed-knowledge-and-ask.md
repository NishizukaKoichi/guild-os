# ADR 0006: Governed Knowledge and Ask Guild

Status: Accepted

Date: 2026-08-12

## Decision

PostgreSQL remains the source of truth for Knowledge metadata, immutable versions, reviews,
acknowledgements, file metadata, and cleanup obligations. R2 stores file bytes. Ask Guild retrieves
only Canonical Knowledge and applies authorization in PostgreSQL before repeating the domain policy
check and constructing model context.

Knowledge security metadata changes only before first publication while saving a new draft version.
The actor must be authorized against both the existing and proposed resource boundary. PostgreSQL
locks the boundary after a Canonical version exists; a different boundary requires a new Knowledge
record and review. File metadata remains immutable at upload time, and file reads require both
current-Knowledge and upload-time file authorization.

R2 writes use a pending/finalized database lifecycle. File deletion is recorded in the existing
transactional outbox and executed idempotently. A Worker Cron Trigger retries transient failures and
recovers abandoned processing leases.

Ask Guild uses a configured Workers AI model through AI Gateway with prompt logging and caching
disabled. It sends bounded authorized evidence, emits versioned citations, rate-limits by opaque
Guild Identity, and records only a question hash and citation count in Chronicle.

## Alternatives considered

- Filtering model candidates after a global top-N query was rejected because denied rows could
  displace permitted evidence and make authorization behavior data-dependent.
- Treating synchronous R2 deletion as complete was rejected because a transient failure would lose
  the cleanup obligation after PostgreSQL committed.
- Rewriting file security metadata when Knowledge changes was rejected because it would silently
  broaden historical attachment access and weaken auditability.

## Risks and rollback

PostgreSQL full-text search is lexical and will eventually need a derived Vectorize or pgvector
index for better recall. That index must preserve the same pre-context authorization contract and
must never become the source of truth. The Knowledge and Ask navigation can be removed without data
loss; database migrations and immutable history are retained. R2 cleanup jobs can be replayed safely
because object deletion and outbox idempotency keys are idempotent.
