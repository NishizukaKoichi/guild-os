# ADR 0043: Bound scheduled maintenance cost

## What changed

Guild maintenance reconciliation runs sequentially and its Cron schedule is deployment-configurable.
The default and owner deployment use `0 * * * *` (hourly). User-triggered dispatch paths remain
immediate.

## Why

A five-minute Cron prevents an autosuspending PostgreSQL compute from staying asleep. On a free
usage tier this creates a predictable monthly outage even when no Human is using Guild OS. Running
eight maintenance jobs concurrently also exceeds the intended per-request database connection
budget. Hourly sequential reconciliation keeps retry and repair behavior while bounding idle cost.

## Alternatives considered

- Keep five-minute reconciliation and require a paid always-on database. This makes the default
  self-hosted product incur avoidable recurring cost.
- Remove reconciliation entirely. This would strand failed outbox, retention, export, embedding,
  automation, and federation work after transient failures.

## Risks and rollback

Background recovery can be delayed by up to one hour. Deployments that require lower recovery
latency can configure a shorter valid five-field Cron after reviewing database compute cost. Rollback
is to restore the previous Cron; user-triggered operations do not depend on that rollback.
