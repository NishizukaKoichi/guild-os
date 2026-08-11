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
- Root and Admin users can issue or revoke invitations and activate, suspend, restore, or depart a
  Human from the sandboxed People UI. Root cannot be suspended or departed.
- `GuildSession.getOverview()` checks Guild authorization, removes unauthorized Spaces, requests an
  observation authorization, and only then returns data to the agent or Gadget.
- A Guild observation cannot be shared with another Workshop account by default.

The Gatekeeper management UI exposes Human invitation and Membership writes. Its Agent action
catalog remains empty, so unfinished Agent write operations cannot appear or be invoked.

## Package layout

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | Environment contract, built-in Roles, and Cloudflare OS descriptions |
| `src/bootstrap.ts` | First-admin bootstrap and application-page rendering |
| `src/authorization.ts` | PostgreSQL snapshot loading and permission-filtered Guild reads |
| `src/management-api.ts` | Account-bound management RPC, invitation hashing, and write authorization |
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

## Build and verify

```sh
pnpm build:app
pnpm test
pnpm types:check
pnpm exec wrangler deploy --dry-run
```

The management iframe is bundled into one HTML file. It performs the Cloudflare OS MessagePort RPC
handshake and makes no network requests from the sandbox.
