# ADR 0004: Use React for the sandboxed management UI

Status: Accepted

## Decision

Build the Guild management iframe with React 19, TypeScript, and Lucide icons, bundled by the
existing Vite single-file pipeline. Keep all data access behind the account-bound MessagePort RPC.
Use a small local i18n provider with English as the initial language, a complete Japanese dictionary,
and Japanese fallback for incomplete Simplified Chinese entries.

## Why

The product requires multiple stateful operational views, forms, dialogs, responsive navigation,
and frequent AI-assisted extension. React is already used by upstream Cloudflare OS and provides a
widely understood component boundary without adding a private framework. Lucide provides consistent
accessible command icons.

## Alternatives considered

- Continue with one vanilla TypeScript file: rejected because the management surface already has
  independent pages and stateful workflows that would become tightly coupled.
- Import the full upstream design system: deferred because it would increase coupling to an
  early-access upstream package.

## Risks and rollback

The single-file bundle is larger. Production build size and iframe startup remain test gates. The
development-only fictional data adapter is removed by Vite dead-code elimination and is scanned out
of production HTML. Rollback is the prior status-page commit; PostgreSQL and RPC contracts are
independent of React.
