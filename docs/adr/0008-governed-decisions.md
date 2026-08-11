# ADR 0008: Governed Decisions

Status: Accepted

Date: 2026-08-12

## Decision

PostgreSQL is the source of truth for formal Decisions, their ordered options, and reviews. A draft
contains a question, rationale, evidence references, review date, security boundary, and between two
and twenty options. Draft edits use exact-version optimistic concurrency. Proposal freezes content,
evidence, options, Space, visibility, classification, and explicit shares so reviewers vote on a
stable record.

List queries apply active Membership, Role, Space ancestry, classification, visibility, ownership,
and explicit sharing before rows leave PostgreSQL. The Gatekeeper repeats domain authorization
before returning content or accepting a mutation. Only an eligible active Human can review a
proposal. Reviews are append-only, each reviewer can vote once, and approval occurs only when one
option independently reaches the Constitution's Level 2 approval quorum. A rejection records the
reviewer's reason and closes the proposal so dissent cannot be silently erased. Proposal, review,
outcome, Inbox notifications, and Chronicle evidence commit transactionally.

An approved or rejected result is immutable. An approved Decision may be marked superseded only by
another approved Decision with the exact same Space, visibility, classification, and explicit-share
set. Both rows are locked in stable order during supersession. This prevents a replacement operation
from changing who can discover the governance record.

Eligible-approver counting and Inbox fan-out use set-based SQL and have no application-level member
cap. The option limit is a deliberate product constraint, not a scalability limit on Guild size.

## Alternatives considered

- Keeping decisions in conversations was rejected because chat cannot provide a stable approved
  result, evidence chain, review quorum, or supersession history.
- Counting approvals across different options was rejected because it could approve a Decision
  without agreement on an outcome.
- Allowing Agents or Services to vote was rejected because v1 governance approval is a human
  accountability boundary. Agents may prepare proposals and evidence only through later governed
  workflows.
- Updating or deleting reviews was rejected because it would rewrite the decision history.
- Capping eligible reviewers at twenty was rejected because organization size must not determine
  correctness or notification delivery.

## Risks and rollback

A single rejection closes a proposal, which favors explicit dissent over silent majority override.
A later Constitution feature may introduce a reviewed rejection policy, but must not reinterpret
existing Decisions. The Decisions navigation and Gatekeeper methods can be rolled back to the
previous Worker version without deleting records. Migrations `0013`, `0014`, and `0015` are
append-only and must never be edited after application; corrections require a later migration.
