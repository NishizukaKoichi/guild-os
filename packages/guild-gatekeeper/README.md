# Guild Gatekeeper

This package is the capability boundary between Cloudflare OS agents/Gadgets and Guild data.

## Current behavior

- Cloudflare OS auto-provisions one opaque Guild account capability per Workshop user.
- Opening the Guild management page initializes an empty Guild only when the Workshop says the
  current user is an administrator.
- The first initializing administrator becomes the human Root Owner.
- Later users are enrolled in `preboarding`; they receive no role implicitly.
- `GuildSession.getOverview()` checks Guild authorization, removes unauthorized Spaces, requests an
  observation authorization, and only then returns data to the agent or Gadget.
- A Guild observation cannot be shared with another Workshop account by default.

The Gatekeeper currently exposes reads only. Its action catalog is empty, so unfinished write
operations cannot appear in production UI or be invoked by an agent.

## Package layout

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | Environment contract, built-in Roles, and Cloudflare OS descriptions |
| `src/bootstrap.ts` | First-admin bootstrap, Preboarding enrollment, and status-page rendering |
| `src/authorization.ts` | PostgreSQL snapshot loading and permission-filtered Guild reads |
| `src/session.ts` | Observation-authorized `GuildSession` RPC |
| `src/guild.ts` | Cloudflare Gatekeeper, account, verifier, and vendor adapters |
| `app/` | Sandboxed management iframe source |

## Identity boundary

Cloudflare Access authenticates the Workshop user. Cloudflare OS then stores the account capability
returned by this Gatekeeper for that user. The capability's generated UUID is the Guild Identity ID.
The Gatekeeper does not receive or store the Access email because the current upstream
`createAccount()` contract does not provide it.

Do not weaken this by accepting a self-declared email as an authorization identifier. A future
verified-email mapping must use an upstream identity-bearing capability or a separately protected
Access assertion flow.

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
