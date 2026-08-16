# ADR 0037: Make Purpose-first Blueprints a completion boundary

Status: Accepted

Date: 2026-08-16

## Context

The guided Other flow introduced by ADR 0036 asks useful questions but stores only vocabulary and
Context on the neutral Blank Profile. It does not create the Roles, Spaces, Memory and Activity
types, decision process, Home layout, Workflows, or Agent that make the product fit an unknown
collective. Calling fixed presets plus Blank a full general-purpose Collective OS would therefore
shrink the product contract.

Purchasers must not need to understand internal Actor, Memory, Activity, or Capability primitives,
write code, or design an authorization model before they can start. At the same time, model output
must never acquire authority merely because it sounds plausible.

## Decision

- Keep Personal with AI, Company, Research, and Community as the short first-run choices. Keep the
  specialist presets and raw Blank under advanced options.
- Make Other a Purpose-first Blueprint Builder. Ask why the collective exists, who or what
  participates, what it remembers, how it acts, and how it decides.
- Generate an actual, schema-validated Blueprint containing a name and purpose, vocabulary, Role
  and Capability proposals, Spaces, Memory types, Activity types and states, Decision methods,
  Home layout, Workflows, and an optional bounded Agent proposal.
- Treat generation as an untrusted draft. Show the complete result for Human review and editing
  before it can be saved or applied.
- Persist purchaser Blueprints in the existing Guild-scoped Template/Profile boundary and retain
  immutable versions. A saved Blueprint can be reused at Guild level or assigned to a Space.
- Use a bounded deterministic generator as the always-available baseline. A configured model may
  improve terminology and structure, but its response must pass the same exact schema, allowlists,
  size limits, and authority policy before reaching the UI.
- Applying a Blueprint may create explicitly reviewed initial Roles, Spaces, Workflows, and a
  bounded Agent during new-Guild initialization. Applying or assigning a Blueprint to an existing
  Guild or Space changes Context/Profile choices only. Existing Role permissions, Constitution,
  approval rules, Connections, and Agent permissions require their existing dedicated governed
  operations and are never changed by Blueprint assignment.
- Keep purchaser-authored content in its original language. UI chrome remains translated through
  the normal English, Japanese, and Simplified Chinese dictionaries.

## Alternatives considered

- Add presets for every known collective. Rejected because the list cannot cover unknown purposes
  and becomes harder to choose from.
- Keep ADR 0036 and send unknown collectives to Blank. Rejected because it requires product and
  authorization design knowledge from the purchaser.
- Apply model output directly. Rejected because prompt input and model output are untrusted, and
  silent authority changes violate Guild sovereignty.

## Risks and rollback

Generated terminology can be mediocre or culturally inappropriate. Full review and editing are
therefore required before save. The deterministic baseline keeps setup available when a model is
unconfigured or fails. The model-assisted path can be disabled without invalidating saved
Blueprints. Saved version history is append-only; restoring earlier content must create a new
reviewed current version and must not delete Chronicle evidence or rewrite existing authority.
