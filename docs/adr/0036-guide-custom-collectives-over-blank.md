# ADR 0036: Guide custom collectives over the neutral Blank substrate

Status: Accepted

Date: 2026-08-16

## Context

Guild OS must support collectives beyond the built-in Personal, Company, Research, Community,
Creator, Open Source, and Agent Collective Profiles. Listing a preset for every possible
collective would overload first setup and still fail to cover unknown purposes. Sending a
nontechnical purchaser to the raw Blank Profile would expose implementation vocabulary without
helping the system speak the collective's language.

The existing data model already separates a neutral Blank Template, bounded Vocabulary overrides,
and five onboarding Context answers. Role and Capability changes remain a separate authorization
operation.

## Decision

- Keep four familiar presets on the first screen: Personal with AI, Company, Research, and
  Community.
- Add **Other / Build your own** as one guided primary choice.
- Keep Creator, Open Source, Agent Collective, and raw Blank behind the advanced disclosure.
- Implement Other on the neutral Blank Template. Ask for the collective's terms for participants,
  shared memory, activity, and decisions, and persist those terms as bounded Vocabulary overrides.
- Require the five purpose, participant, memory, activity, and decision-style answers for Other.
- Keep Blank's Coordinator, Participant, and Observer Role preset. Do not generate Capabilities,
  external Connections, Agents, or approval policy from free text during initialization.
- Validate every Vocabulary key and value server-side before the initialization transaction.
- Treat custom vocabulary as purchaser-authored content rather than UI translation. Locale changes
  do not rewrite it.

## Alternatives considered

- Add many more preset cards. Rejected because choice count grows without bounding the domain.
- Tell purchasers to select Blank and configure it later. Rejected because it abandons the
  nontechnical first-run experience.
- Ask a model to invent Roles and policy from the five answers. Rejected because initialization
  would become model-dependent and free text could silently change authorization.

## Risks and rollback

Using Blank means custom collectives begin with neutral creation choices and Roles until an owner
changes them explicitly. This is visible in the setup preview and documented as a security
boundary. Rollback removes the guided choice and vocabulary payload from first setup; stored Blank
Profiles and overrides remain valid and need no schema rollback.
