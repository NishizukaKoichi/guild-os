# ADR 0031: The Full Guild OS Specification Is the Release Boundary

Date: 2026-08-13

## Status

Accepted

## Context

The previous completion matrix treated the twelve-item MVP as the completion boundary. That was a
valid implementation milestone but did not represent the product owner's definition of Guild OS.
It allowed later Context Graph, privacy, lifecycle, contribution, semantic retrieval, automation,
Connection, and federation requirements to be described as future work while the product was called
complete.

## Decision

`docs/full-spec-acceptance.md` is the release contract. The twelve-item MVP is a mandatory subset.
No release may be described as complete while any full-spec acceptance row lacks production code,
authorization, automated evidence, operating documentation, or deployed verification.

Extensions remain additive and independently testable:

- neutral domain types and validation live in `guild-domain`;
- persistence, RLS, projections, and transactional Event writes live in `guild-postgres`;
- Cloudflare OS capability and UI boundaries live in `guild-gatekeeper`;
- long-running execution remains in Workflows;
- external writes remain scoped, approved, idempotent Connection adapters;
- PostgreSQL remains the source of truth; semantic indexes and live coordination are derivatives.

## Alternatives considered

- Keep the MVP definition and label everything else as a later roadmap. Rejected because it conflicts
  with the product owner's explicit completion definition.
- Rewrite the system as one large application. Rejected because it would discard verified security,
  migration, Chronicle, backup, and Cloudflare OS boundaries.

## Risks and rollback

The broader scope increases migration and review cost. Work therefore uses forward-only additive
migrations, compatibility adapters, small commits, pre-deploy backups, and exact-commit release
evidence. A release can roll back Workers while retaining additive database structures; destructive
compatibility removal remains a separate reviewed migration.
