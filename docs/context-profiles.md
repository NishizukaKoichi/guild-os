# Context Profiles

Context Profiles let the same neutral Guild OS core speak and operate naturally for Personal work
with AI, a Company, Community, Research Collective, Creator Collective, Open Source Project, Agent
Collective, or a Blank Guild.

## First setup

The first setup asks how the purchaser intends to use Guild OS before asking for implementation
details. Personal with AI is selected by default and is the shortest safe path for one person: it
creates a human Root Owner, personal operating vocabulary, and one bounded Personal assistant.
Company, Research, and Community are the other preset choices. **Other / Build your own** is the
fifth primary choice for a collective that does not fit one preset. Creator, Open Source, Agent
Collective, and the raw Blank Profile remain available under advanced Profiles.

Other is guided rather than an instruction to edit code. It asks what the collective calls its
participants, shared memory, activity, and decisions, then requires five short answers about its
purpose, participants, memory, activity, and decision style. Guild OS persists those terms as
Vocabulary overrides and the answers as starting Context on the neutral Blank substrate. It does
not generate new Capabilities or silently invent an authorization policy; the neutral Coordinator,
Participant, and Observer Role preset remains reviewable after setup.

The deployment-defined Guild name is read-only during setup. The administrator enters the human
Root display name and accepts Root responsibility explicitly. Starting-context answers are
generated from the selected Profile and can be customized in an optional section. After the
transaction succeeds, a completion receipt shows the Profile, Root Owner, assistant state, and
Connection state before the administrator opens the Guild.

Custom vocabulary is purchaser-authored operational content. It remains unchanged when a user
switches the UI language. Translate or revise those terms under **Settings > Context profiles**
when a multilingual Guild needs localized operating terminology.

## What changes

The Guild Profile controls:

- navigation and action labels;
- the order of Home actions;
- Memory and Activity choices at Guild scope;
- Decision methods;
- recommended workflows;
- the suggested Agent name;
- the initial Role preset when the Guild is first created.

A Space may inherit the Guild Profile or select another Profile. A Space override changes its
labels, Memory choices, Activity choices, Decision methods, workflow suggestions, and Agent
suggestion together. For example, a Company Guild can contain a Research Space that offers Study,
Experiment, Research Note, Data, and peer-review choices without changing the rest of the Guild.

## What does not change

Changing a Profile after initialization does not rewrite existing Roles, Role bindings,
Capabilities, Members, records, or History. It also does not change PostgreSQL RLS or authorization
policy. Make security changes separately under **Settings > Roles** so they remain explicit and
auditable.

Existing Memory and Activity remain visible after a Profile change. List filters combine the types
from all Profiles visible to the current Actor, while creation forms show only the choices for the
selected Space.

## Configure a Guild

1. Open **More > Settings**.
2. Under **Context profiles**, select the Guild Context Profile.
3. Review the Role preset, creation choices, Decision methods, workflows, and Agent suggestion.
4. Optionally override the four primary labels.
5. Select **Apply profile**.

## Configure a Space

1. Open **More > Settings > Context profiles**.
2. Under **Space context profiles**, find the Space.
3. Select a Profile or **Use Guild default**.
4. Open Memory, Activity, or Decisions and select that Space to use its choices.

The database column `spaces.vocabulary_profile_key`, API field `vocabularyProfileKey`, and existing
service method names are retained as a compatibility layer. New code must treat the value as the
complete Context Profile key. Removing those aliases requires a versioned API and forward-only
database migration.
