# ADR 0033: Use a standard cron parser for Automation

## What changed

Scheduled Automation uses `cron-parser` for five-field cron evaluation with an explicit IANA
timezone. The durable queue stores the computed next occurrence and still treats PostgreSQL as the
system of record.

## Why

Timezone and daylight-saving transitions are correctness boundaries. A small custom parser would
silently mis-schedule work and make replay behavior difficult to audit.

## Alternatives considered

- Store fixed intervals only. This cannot express the user-facing weekday and weekly schedules.
- Implement cron parsing locally. This creates avoidable date, range, and DST risk.

## Risk and rollback

The dependency is used only while materializing a due schedule. Removing it requires replacing the
same tested interface and replaying schedule tests; existing queued requests remain valid.
