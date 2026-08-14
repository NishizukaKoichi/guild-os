# ADR 0035: Make Personal with AI the guided first-run Profile

Status: Accepted

Date: 2026-08-14

## Context

Guild OS supports several Collective Templates, but the previous first-run screen exposed neutral
configuration concepts before a nontechnical purchaser had seen the product. A person evaluating
Guild OS alone also had to infer that Agent Collective or Blank could represent personal use. The
initialization form required five context answers and repeated typing of the configured Guild name,
even though trusted Workshop administrator identity and the PostgreSQL first-Root transaction are
the actual authorization boundary.

The repository deploys multiple Workers plus PostgreSQL and purchaser-owned resources. Cloudflare's
Deploy to Cloudflare button does not deploy multiple Workers from one monorepo together, so a button
would present a shorter path while silently omitting required services.

## Decision

- Add **Personal with AI** as a first-class Template and Context Profile.
- Select Personal with AI by default during first setup and label it as recommended.
- Keep Company, Research, and Community as primary choices. Keep Creator, Open Source, Agent
  Collective, and Blank under an advanced disclosure.
- Generate Profile-specific starting context automatically. Keep those fields editable under an
  optional customization disclosure rather than requiring them for setup.
- Show the deployment-defined Guild name as read-only. Require the human Root display name and an
  affirmative Root-responsibility checkbox instead of using name transcription as a ceremony.
- Preserve the trusted Workshop administrator check, account-bound capability, serialized
  PostgreSQL transaction, human-only Root invariant, and privacy-minimized bootstrap response.
- Provision the Profile's bounded suggested Agent, including a Personal assistant for the default
  path.
- Show a completion receipt before entering Guild OS so the purchaser can verify Profile, Root,
  assistant, and Connection state.
- Keep the reviewed deployment runbook as the supported installation path until an installer can
  deploy every Worker and required resource without weakening ownership or security boundaries.

## Alternatives considered

- Reuse Agent Collective for personal use. Rejected because its policy-oriented language and
  defaults do not match a person's everyday goals, tasks, and memory.
- Add a Deploy to Cloudflare button immediately. Rejected because the documented multi-Worker
  monorepo limitation would create an incomplete installation.
- Keep exact Guild-name transcription. Rejected because it adds friction without replacing or
  strengthening any server-side authorization check.

## Risks and rollback

Personal becomes the product default, so copy and ordering changes can affect first-run
expectations. All Profiles remain selectable and existing Guild settings are unchanged. Rollback is
a forward migration that selects Blank for future first runs and removes Personal references only
after existing Profile references are migrated; applied migrations are never edited.
