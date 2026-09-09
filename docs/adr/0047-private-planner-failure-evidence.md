# ADR 0047: Private planner failure evidence

Status: accepted

## Context

A production Ask / Plan / Act check reached the deterministic fallback even though
the configured Workers AI planning route was active. The existing catch boundaries
discarded the distinction between provider failure and invalid generated content.
Requesting another operator credential does not explain or repair that behavior.

## Decision

Add `fallbackReason` to the existing `intent.proposal.created` Chronicle payload.
It is null for model-generated plans and a fixed category for unavailable planners,
timeouts, provider schema/authentication/rate-limit failures, or invalid output.
Categories are diagnostic hints, not trusted provider error codes or authorization.

Never persist provider error text, prompts, credentials, URLs, or generated content
in this diagnostic field. Existing Chronicle authorization governs its visibility.
No new endpoint, authentication setting, database migration, or public telemetry
is introduced. All existing parsing, authorization, confirmation and Act checks remain.

## Verification and rollback

Unit regressions cover provider failure categories, invalid output and secret-like
error content. An authenticated production plan can be inspected in Chronicle
without an additional service-token login. A local fixture does not prove the live
provider path; observed cause and any subsequent repair must be recorded separately.
Older readers ignore the additive JSON property. Reverting this change requires no
data migration and does not rewrite existing Chronicle events.
