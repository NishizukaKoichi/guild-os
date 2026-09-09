# ADR 0048: Private Memory drafts and inspectable content

Status: Accepted

## Context

Production verification found that the deterministic Ask-to-Plan fallback used
Guild or Space visibility, even when the objective requested a private draft.
Reading an authorized answer does not imply permission to redistribute it.
The Act confirmation also showed the target title but omitted the proposed
body and audience.

## Decision

- The deterministic fallback always proposes a private Working Memory owned by
  the requesting Actor. Selecting a Space does not imply sharing.
- The model prompt uses the same private default. Explicitly requested sharing
  remains subject to the existing permission checks and one-action confirmation.
- Memory actions expose a typed, additive preview of the immutable proposed
  body, visibility, classification, Space and explicit Actor IDs to the proposal
  owner. The existing proposal authorization boundary remains in force.
- Act displays the visibility and classification before confirmation, with an
  expandable plain-text body. Content is rendered as text, not HTML.
- This is not automatic publication, Canonical promotion, a new permission, or
  an implicit change to existing Memory or already saved proposals.

## Verification and rollback

Service regression tests assert a private, unshared Working Memory fallback.
Adapter tests verify the exact body and audience and exclude unrelated actions.
Browser tests inspect content before Act and check the audience in English,
Japanese and Simplified Chinese. Existing permission, idempotency and approval
tests remain release gates.

No database migration is required. The preview field is additive for older
clients. Rolling back application code does not change existing saved proposals
or Memory. Local fixture tests do not establish model reliability or purchaser
acceptance; live model evidence is recorded separately.
