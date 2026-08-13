# ADR 0030: Apply complete Context Profiles at Guild and Space scope

## Status

Accepted.

## Context

The Actor-neutral substrate already stored one Template for the Guild and an optional
`vocabulary_profile_key` for each Space. The first implementation used the Space value for labels
and Decision methods, while Memory and Activity creation continued to use the Guild Template.
Dashboard intentions, workflow presets, and the suggested Agent were stored but not consistently
used. A mixed Guild could therefore call a Space a research lab while still offering company Task
and Manual choices.

## Decision

- Treat the existing Space vocabulary assignment as a complete **Context Profile**. The persisted
  column and wire field retain their existing names for compatibility, but the selected Template
  supplies labels, Memory types, Activity types, Decision methods, workflow presets, and the
  suggested Agent.
- Resolve the effective profile from the selected Space before showing any creation choices. When
  a user changes Space, replace an invalid selected type or Decision method with the first valid
  choice from the new profile.
- Build list-filter choices from the union of every profile visible to the current Actor. This keeps
  records from mixed Spaces discoverable without offering cross-context choices during creation.
- Order Home actions from the Guild Template's `dashboardIntents`. Space-specific actions resolve
  their profile inside the creation dialog.
- Apply Template Roles only during Guild initialization. A later Context Profile change preserves
  Roles, bindings, Capabilities, and existing data. Security changes remain explicit Role
  administration operations and continue through the existing authorization and Chronicle paths.
- Keep the canonical API and database neutral. Context Profiles shape defaults and presentation;
  they do not add Template checks to repositories, RLS, or policy evaluation.

## Alternatives considered

- **Change labels only:** rejected because it produces contradictory choices and makes a Research
  or Creator Space a cosmetic Company view.
- **Automatically rewrite Roles when a profile changes:** rejected because a presentation change
  could silently grant or revoke authority and invalidate pending invitations or ownership records.
- **Create Template-specific tables and endpoints:** rejected because it forks the neutral core and
  prevents multiple operating cultures from sharing one Guild.

## Risks and rollback

The UI now derives more behavior from Template metadata. Missing or invalid Space profile keys
fall back to the Guild profile, and existing records remain readable through union filters. Rolling
back the application restores the previous presentation without a data migration because no schema
or stored authorization state changes in this decision.
