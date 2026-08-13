# Collective ontology audit

Updated: 2026-08-12

## Scope

This audit compares the shipped Guild OS implementation with the Actor-neutral Collective OS
definition. It covers the domain package, PostgreSQL schema and repositories, Gatekeeper API,
React application, localization, tests, documentation, backup tooling, and deployment boundary.

## What already fits the neutral substrate

- Every protected record is Guild-scoped and every PostgreSQL transaction sets a transaction-local
  Guild boundary. Forced row-level security prevents cross-Guild reads and writes.
- Role grants are data, not fixed application enums. Permissions are evaluated with Membership,
  Space ancestry, classification, visibility, ownership, and explicit shares before content leaves
  PostgreSQL.
- Human, Agent, and Service records already share one `identities` table, one `memberships` table,
  one Role binding table, and one authorization snapshot. Agent profiles are an extension rather
  than a separate login system.
- Chronicle is append-only and records Human, Agent, Service, and System effects through the same
  event shape. Conversations inherit their subject's current authorization boundary.
- Agent runs already have tool, Space, Role, requester, Workflow, Connector, budget, token, duration,
  Step, retry, delegation, approval, idempotency, and Kill Switch controls.
- Backups are Guild-scoped, checksummed, externally stored, and verified before restore preparation.
  Deployment is purchaser-owned and pins the exact Git source.

These controls remain authoritative during and after the ontology migration.

## Company-centric assumptions found

| Surface | Existing assumption | Neutral replacement |
| --- | --- | --- |
| Domain | `IdentityKind` excludes another Guild | `ActorKind = human \| agent \| service \| guild` |
| Persistence | An Identity belongs to exactly one Guild | Global Actor plus Guild-scoped Membership |
| Membership | `preboarding`, `suspended`, and `departed` encode employment lifecycle | `invited`, `joined`, `active`, `paused`, `left`, `blocked` |
| Bootstrap | Every Guild receives `Admin`, `Manager`, and `Member` | Template presets; Blank Guild is the default |
| Governance | Root ownership is presented as an organizational Owner role | Human platform Custodian is a separate recovery and stewardship boundary |
| Navigation | Team and AI Agents are separate destinations | One Members destination with Actor-type filters and profile details |
| Memory | Every durable item is Knowledge with a publication workflow | Memory with a type and optional governance workflow |
| Activity | Every activity must be Goal -> Project -> Quest -> Step | Recursive Activity plus typed relationships and optional dependencies |
| Assignment | Work is assignable only to Human or Agent | Activity is assignable to any active Actor; execution policy still limits effects |
| Decisions | Formal approval is the only modeled decision method | Method and participants are explicit; high-risk effects retain Human approval |
| UI copy | Work, People, onboarding, departed, Manager | Complete Template Context Profiles over neutral primitives, overridable per Space |
| Ask | Searches only Canonical Knowledge | Searches authorized Memory before model context construction |
| Tests/docs | Company-shaped fixtures reproduce the same assumptions | Blank, Community, Research, Creator, Agent, Open Source, and Company scenarios |

## Canonical target

```text
Guild
|- Actors
|- Memberships
|- Spaces
|- Roles and Capabilities
|- Memories
|- Activities
|- Decisions
|- Conversations
|- Connections
|- Runs
|- Events
`- Template settings
```

An Actor is global. A Membership places that Actor in one Guild with neutral state, Roles, Space
scope, and clearance. Human, Agent, Service, and Guild profiles add kind-specific data without
changing Membership semantics.

Templates configure vocabulary, initial Roles, suggested types, Decision methods, workflows,
dashboard intentions, and recommended Agents. Each Space may select its own complete Context Profile, so
one Guild can speak research language in a laboratory Space and community language in an events
Space while using the same Memory and Activity rows.

Memory and Activity become the canonical persistence models. Existing Knowledge and four-level
Work tables remain available through an explicitly deprecated compatibility layer while deployed
data and integrations are migrated. Compatibility writes mirror into the canonical models, so the
new UI and Ask path do not depend on company-shaped tables.

## Security interpretation

Actor-neutral does not mean risk-neutral. Capability vocabulary is shared by every Actor kind, and
effective authority remains the intersection of Membership capability, Actor policy, Guild policy,
Space scope, resource policy, Connector authority, and approval state. Human Custodianship,
high-risk approval, Break Glass, and ownership transfer remain platform safety constraints, not a
claim that a Guild is a company.

## Migration constraints

- Preserve every existing UUID, Chronicle sequence, version, file link, Role, permission, and
  security boundary.
- Add canonical tables and compatibility mirrors in one transactional, rerunnable migration.
- Fail the migration if legacy Work IDs collide across aggregate tables or if migrated row counts
  differ.
- Do not drop legacy tables or columns in this release.
- Back up and verify production before applying the migration. Run schema and count checks before
  directing traffic to the new Worker.
- Roll back application traffic by redeploying the prior Worker. The additive schema remains inert;
  no reverse data rewrite is required.

## Compatibility debt

The legacy `identities`, `memberships`, `role_bindings`, `knowledge*`, and
`goals/projects/quests/steps` APIs remain for one migration window. New product work must use
Actor, Membership, Memory, and Activity APIs. Removal requires a separate release that proves no
legacy callers, verifies a fresh backup, and compares canonical and compatibility row counts.
