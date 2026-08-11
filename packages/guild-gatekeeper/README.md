# Guild Gatekeeper

This package is the capability boundary between Cloudflare OS agents/Gadgets and Guild data.

## Current behavior

- Cloudflare OS auto-provisions one opaque Guild account capability per Workshop user.
- Opening the Guild management page initializes an empty Guild only when the Workshop says the
  current user is an administrator.
- The first initializing administrator becomes the human Root Owner.
- Unknown users remain unregistered until they claim a one-time administrator invitation.
- Invitation claims bind the stable Cloudflare OS account UUID to a selected Role, Space, and
  `preboarding` or `active` Membership. Only the invitation hash is stored.
- Authorized administrators can issue or revoke invitations; create Agent and Service identities;
  assign scoped Roles; and activate, suspend, restore, stop, or depart identities from the
  sandboxed management UI. Root cannot be suspended or departed.
- Authorized administrators can create and edit custom Roles and hierarchical Spaces. Delegated
  Roles cannot exceed the administrator's global authority, and machine identities cannot receive
  human-only permissions.
- Authorized members can create multilingual Knowledge drafts, create immutable revisions, attach
  R2 files, propose review, approve or request changes, publish, acknowledge, deprecate, and archive.
- Ask Guild searches only permission-filtered Canonical Knowledge and returns versioned citations.
- Authorized members can inspect governed Goal, Project, Quest, and Step hierarchies. Authorized
  operators can create children, move them through legal states, and assign Quests or Steps only to
  active Humans and Agents that can read the resource. Every mutation records Chronicle evidence;
  assignment also creates an Inbox notification in the same transaction.
- Authorized Humans can create and revise Decision drafts, propose immutable options and evidence,
  and review them under the Constitution quorum. Approval must converge on one option; rejection
  records dissent. Approved Decisions can only be superseded inside the same security boundary.
- Failed or interrupted R2 cleanup remains in the PostgreSQL outbox and is retried by a five-minute
  Cron Trigger.
- `GuildSession.getOverview()` checks Guild authorization, removes unauthorized Spaces, requests an
  observation authorization, and only then returns data to the agent or Gadget.
- A Guild observation cannot be shared with another Workshop account by default.

The Gatekeeper management UI exposes identity, Membership, Role, Space, Knowledge, Ask Guild, Work,
and Decisions. Its Agent action catalog remains empty, so unfinished Agent execution and external-write
operations cannot appear or be invoked.

## Package layout

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | Environment contract, built-in Roles, and Cloudflare OS descriptions |
| `src/bootstrap.ts` | First-admin bootstrap and application-page rendering |
| `src/authorization.ts` | PostgreSQL snapshot loading and permission-filtered Guild reads |
| `src/management-api.ts` | Account-bound management RPC, invitation hashing, and write authorization |
| `src/knowledge-service.ts` | Knowledge policy, R2 lifecycle, Ask context construction, and cleanup |
| `src/work-service.ts` | Work input validation, authorization, assignment, and UI projections |
| `src/decision-service.ts` | Decision validation, authorization, proposal, review, and supersession |
| `src/session.ts` | Observation-authorized `GuildSession` RPC |
| `src/guild.ts` | Cloudflare Gatekeeper, account, verifier, and vendor adapters |
| `app/` | Sandboxed management iframe source |

## Identity boundary

Cloudflare Access authenticates the Workshop user. Cloudflare OS then stores the account capability
returned by this Gatekeeper for that user. The capability's generated UUID is the Guild Identity ID.
The Gatekeeper does not receive or store the Access email because the current upstream
`createAccount()` contract does not provide it. Instead, a 32-byte one-time invitation proves the
administrator's intent to bind that opaque account capability to a Guild Membership. Possession of
an outer Cloudflare OS account alone never creates an Identity or Role.

Do not weaken this by accepting a self-declared email as an authorization identifier. If deployments
later display verified email, it must come from an upstream identity-bearing capability or a
separately protected Access assertion flow; it is not an authorization key.

## Data boundary

The Worker receives a Hyperdrive binding and uses `@guild-os/postgres`. Every operation begins a
transaction, sets `app.guild_id` transaction-locally, and is subject to PostgreSQL row-level
security. Database credentials stay inside the Hyperdrive configuration.

Knowledge list and search queries apply the active Identity, Membership, Role, Space,
classification, visibility, owner, and explicit-share boundary in PostgreSQL. The service repeats
domain authorization before content is returned or supplied to Workers AI. File reads additionally
check the immutable security boundary captured when the file was uploaded.

Decision list queries use the same SQL-first boundary. Draft edits require authorization against
both old and proposed boundaries; proposal freezes the record, and database triggers independently
enforce human-only append-only reviews, quorum, terminal immutability, and exact-boundary
supersession.

## Build and verify

```sh
pnpm build:app
pnpm test
pnpm types:check
DATABASE_URL=postgresql://... pnpm test:integration
pnpm test:e2e
pnpm exec wrangler deploy --dry-run
```

The management iframe is bundled into one HTML file. It performs the Cloudflare OS MessagePort RPC
handshake and makes no network requests from the sandbox.
