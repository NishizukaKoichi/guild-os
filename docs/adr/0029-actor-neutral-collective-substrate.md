# ADR 0029: Make Actor, Memory, and Activity the Collective substrate

## Status

Accepted

## Context

Guild OS shipped with strong Guild isolation, authorization, Chronicle, Agent execution, and
recovery controls. Its product ontology still treated a company-shaped system as the default:
single-Guild Identities, employment-oriented Membership states, Admin/Manager/Member bootstrap
Roles, mandatory Knowledge governance, a fixed Goal/Project/Quest/Step hierarchy, and separate
People and Agent screens.

Renaming those surfaces would preserve the same assumptions and would make future Community,
Research, Creator, Open Source, Guild federation, and Agent Collective templates conditional
branches over a Company model.

## Decision

- `Actor` is the global subject primitive. Human, Agent, Service, and Guild are Actor kinds.
  Guild-scoped `ActorMembership` stores participation state, clearance, and timestamps. Kind-
  specific profiles extend an Actor without creating a parallel membership system.
- Neutral Membership states are `invited`, `joined`, `active`, `paused`, `left`, and `blocked`.
  Existing states are mapped by the compatibility layer: preboarding -> joined, suspended ->
  paused, departed -> left.
- Roles remain editable data. Their grants are exposed as Capabilities. New neutral capabilities
  cover Actor, Memory, Activity, Template, Connection, Run, Event, and governance operations;
  legacy permission names remain aliases during migration.
- A Human platform Custodian remains mandatory for billing, emergency recovery, and irreversible
  governance. Custodianship is not a Company Owner Role and is not required to appear as an
  operational Member in Agent Collective views.
- `Memory` stores typed durable context. A governance workflow is optional. Migrated Knowledge uses
  `type=knowledge` and `workflow=canonical`; facts, artifacts, research, experiences, failures,
  external sources, and Agent outputs do not inherit that workflow automatically.
- `Activity` is recursive and typed. Parent, dependency, order, assignee Actor, time, output Memory,
  and security boundary are independent fields. Migrated Goal, Project, Quest, and Step rows retain
  their UUIDs and become typed Activities; new Activities require no fixed depth.
- Templates are versioned presets for initial Roles, vocabulary, Spaces, Memory types, Activity
  types, Decision methods, workflows, recommended Agents, and dashboard intentions. They never
  change authorization or schema behavior. Blank is the default and has equal first-class UI
  placement. A Space can override the Guild vocabulary profile, allowing research, operations,
  community, and creation cultures to coexist inside one Guild without forking the core schema.
- The primary UI is Home, Ask, Members, Memory, Activity, and More. Agent controls live in the
  Agent Member detail; Approvals and Runs remain safety views under More.
- Ask continues to filter in PostgreSQL before model context. Read, plan, reversible write, external
  write, and irreversible action boundaries remain explicit.
- The migration is additive. Existing APIs and tables are deprecated compatibility adapters and
  mirror their writes into canonical tables. No production UUID or Chronicle event is rewritten.
- All-Guild backfills run in one transaction under the non-superuser table owner. `FORCE RLS` is
  relaxed only inside that transaction, deferred constraints and count reconciliation are drained,
  and forced tenant RLS is restored before commit. A failed guard rolls back the schema and data.

## Alternatives considered

- **Rename existing tables and labels.** Rejected because fixed Work depth, mandatory Knowledge
  workflow, and single-Guild Identities would remain the actual model.
- **Rewrite the product from zero.** Rejected because it would discard proven RLS, audit,
  approval, backup, and recovery invariants and make safe production migration impractical.
- **Create a separate schema per template.** Rejected because templates would become divergent
  products and mixed Collectives would be impossible.
- **Make every Actor equally eligible for every effect.** Rejected because Actor-neutral capability
  vocabulary still requires kind-specific, Guild, Connector, and approval policy intersections.

## Consequences

The product can represent a Blank Guild, Community, Research Collective, Creator Collective, Open
Source Project, Agent Collective, or Company without borrowing Company semantics. The release has
a temporary duplication cost while canonical and compatibility persistence coexist. Count checks,
mirror triggers, tests, and a documented removal gate make that cost visible and reversible.

No migration in this release drops legacy data. Application rollback is a prior-Worker redeploy;
schema cleanup is deferred until compatibility usage reaches zero.
