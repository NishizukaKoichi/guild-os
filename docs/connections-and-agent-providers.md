# Connections And Agent Providers

This runbook describes the supported purchaser-owned model and external-service boundary. Every
adapter described as executable below has an administrator setup path, authorization checks, and
synthetic verification. Deliberately unsupported adapter kinds are listed separately.

## Ownership boundary

The purchaser owns every provider account, endpoint, Cloudflare Worker binding, OAuth client,
Service Binding, token, budget, and revocation process. Guild OS stores provider and Connection
metadata in the purchaser's PostgreSQL database. Credential values remain Cloudflare Worker
Secrets or service bindings and are never written to PostgreSQL, Git, deployment JSONC, exports,
Chronicle, or support material.

A **Secret reference** is only a binding name such as `PURCHASER_MODEL_API_KEY`. It must match
`[A-Z][A-Z0-9_]{2,127}`. It is safe to record the name and custodian; never record the value in this
repository.

Install a value interactively against the purchaser's Guild Gatekeeper Worker:

```sh
read -r GUILD_GATEKEEPER_WORKER_NAME
pnpm exec wrangler secret put PURCHASER_MODEL_API_KEY \
  --name "$GUILD_GATEKEEPER_WORKER_NAME"
unset GUILD_GATEKEEPER_WORKER_NAME
```

Verify binding names without retrieving values:

```sh
read -r GUILD_GATEKEEPER_WORKER_NAME
pnpm exec wrangler secret list \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --format json
unset GUILD_GATEKEEPER_WORKER_NAME
```

Keep a purchaser-owned registry outside the reusable source repository with the binding name,
provider, purpose, custodian, creation date, rotation date, and affected Worker. The registry must
not contain credential values.

## Model providers

The data model supports these provider kinds:

| Kind | Runtime behavior | Endpoint and Secret reference |
| --- | --- | --- |
| `workers_ai` | Uses the purchaser's `AI` binding, optionally through the configured AI Gateway ID | Must both be absent |
| `cloudflare_ai_gateway` | Uses an OpenAI-compatible HTTPS endpoint | Both required by the service layer |
| `openai_compatible` | Calls `<base>/chat/completions` or `<base>/embeddings` | Both required |

Routes are configured by purpose: `ask`, `plan`, `act`, `embedding`, or `review`. Each route selects
an active provider, a primary model from that provider's allowlist, an optional fallback model,
maximum tokens, a daily budget in minor currency units, cache policy, and status. The runtime clamps
requested tokens to the route maximum. It makes at most one fallback attempt, and never falls back
when a caller explicitly requested a model.

The daily-budget field is persisted and displayed, but the current model runtime does not aggregate
provider spend or reject a call when that daily amount is reached. Treat it as policy metadata, not
a hard cost control. Enforce purchaser limits at the provider/Cloudflare account as well, and do not
claim route-budget enforcement until usage accounting and denial tests exist.

External calls use HTTPS, refuse redirects, time out after 30 seconds, and reject responses larger
than 2 MB. The current external contract is OpenAI-compatible JSON with Bearer authentication. A
provider-specific protocol needs a reviewed adapter; changing only the provider label is not enough.

### Purchaser setup

1. Decide which model purposes the Guild needs and create a separate budget boundary for each.
2. For Workers AI, confirm the deploy-created `AI` binding and the `guild.askModel` and
   `guild.aiGatewayId` values in the purchaser configuration.
3. For an external provider, install its value as a Worker Secret and record only the reference
   name.
4. In **Operations > AI models**, register the provider and list only approved model IDs.
5. Configure one route at a time, starting with `ask`; set a conservative token limit and budget.
6. Exercise the route with synthetic, non-sensitive content, inspect provider-side usage, and
   inspect Chronicle evidence for the provider and route configuration before admitting real data.
7. Disable or revoke the route before rotating or removing its Secret binding.

If no active database route exists, the runtime falls back to the deployment-managed Workers AI
provider: `guild.askModel` for text purposes and `@cf/baai/bge-m3` for embeddings. This is an
availability fallback, not proof that a purchaser budget or model policy has been reviewed.

### Provider administration

The Operations form accepts Workers AI, Cloudflare AI Gateway, and OpenAI-compatible providers.
For both HTTPS kinds it requires the endpoint and Secret reference expected by the service layer;
the endpoint and model allowlist are validated before activation. The `aiGateway` block in the
purchaser deployment configuration controls Cloudflare OS's platform model catalog and is separate
from a Guild `model_providers` row.

## Connection authorization has two allowlists

Every executable Connection needs both boundaries:

1. `capabilityPermissions` contains Guild OS permissions such as `connection.read` and
   `connection.execute`. It determines which Guild actors may be delegated authority over the
   Connection.
2. `configuration.allowedCapabilities` contains exact remote tool or action IDs. It determines what
   the adapter may discover and invoke at the external service.

Use the intersection of both lists. Granting `connection.execute` does not authorize an unlisted
remote action, and listing a remote action does not grant a Guild actor permission to execute it.
The remote service must apply its own authorization as a fourth boundary.

Capability IDs are case-sensitive, at most 128 characters, and use letters, numbers, `.`, `_`,
`:`, `/`, or `-`, beginning with a letter or number. Prefer the narrowest stable IDs. Never use a
wildcard or accept every action returned by discovery.

## Supported adapter configurations

The JSON below is the `configuration` object stored with a Connection. It contains identifiers and
allowlists only. The credential value lives in the Worker binding named by `secretReference`.

### Standard or Cloudflare OS MCP over HTTPS

Use Connection kind `mcp`, a fixed public HTTPS endpoint, and an explicit tool allowlist. Omit
`adapterKind` for standard MCP Streamable HTTP; set it as shown for a Cloudflare OS MCP endpoint.

```json
{
  "adapterKind": "cloudflare_os_mcp",
  "protocolVersion": "2025-06-18",
  "allowedCapabilities": [
    {
      "id": "knowledge.search",
      "title": "Search approved knowledge"
    }
  ]
}
```

The adapter performs `initialize`, paginated `tools/list`, and `tools/call`. Discovery fails closed
if any configured tool is absent. Only configured tools survive discovery filtering.

### Cloudflare Gatekeeper HTTPS action bridge

Use Connection kind `api`. The default routes are `health`, `capabilities`, and `invoke`; override
only when the purchaser bridge uses stable reviewed paths.

```json
{
  "routes": {
    "health": "health",
    "discovery": "capabilities",
    "invoke": "invoke"
  },
  "allowedCapabilities": [
    {
      "id": "ticket.create",
      "title": "Create a ticket"
    }
  ]
}
```

Discovery must return an `actions` list. Invocation receives `capabilityId`, `input`, and an
idempotency key. The bridge must authenticate the caller, enforce its own allowlist, and make every
write idempotent.

### Fixed HTTPS Webhook

Use `https_webhook` or `webhook` with one fixed public HTTPS URL. Invocation input cannot select a
different destination. Configure the capability explicitly even though the adapter defaults to
`webhook.send` when it is absent.

```json
{
  "healthMethod": "HEAD",
  "secretHeaderName": "Authorization",
  "secretFormat": "bearer",
  "allowedCapabilities": [
    { "id": "webhook.send", "title": "Send approved event" }
  ]
}
```

This generic adapter is separate from the deployment-managed Agent Webhook. The governed Agent
write path in `deployment.local.jsonc` uses the fixed receiver contract, HMAC signatures, and the
outbox described in [Agent Webhook](agent-webhook.md).

### Cloudflare Service Binding

Use Connection kind `cloudflare_service`, authentication kind `service_binding`, no public endpoint,
and an injected `Fetcher` binding.

```json
{
  "bindingReference": "PURCHASER_ACTIONS_SERVICE",
  "basePath": "guild",
  "routes": {
    "health": "health",
    "discovery": "capabilities",
    "invoke": "invoke"
  },
  "allowedCapabilities": [
    { "id": "document.render", "title": "Render an approved document" }
  ]
}
```

The current top-level deployment schema does not declare arbitrary purchaser Service Bindings. A
Service Binding therefore requires a reviewed deployment extension that injects the exact binding
into the Guild Gatekeeper Worker. Record and reapply that extension on every release; a database
Connection row alone cannot create the binding.

### OAuth, database, and storage kinds

The OAuth adapter performs issuer metadata discovery only. It does not perform authorization-code
exchange, token refresh, or action invocation. The `database` and `storage` kinds exist in the
domain model but the configured runtime deliberately returns `unsupported_operation`. Do not sell
or document these three kinds as working action connectors.

## Network and data guards

Configured network adapters enforce these runtime limits:

- public HTTPS only; credentials in URLs are rejected;
- localhost/local suffixes, metadata hostnames, IPv6 literals, and literal private, link-local, or
  reserved IPv4 destinations are rejected;
- redirects are rejected;
- default timeout 10 seconds, with a hard maximum of 30 seconds;
- request body maximum 256 KiB and response maximum 1 MiB;
- discovery maximum 200 capabilities and MCP pagination maximum 50 pages;
- configured Secret material is checked for reflection in responses.

Do not weaken these guards in order to connect a private service. Put a purchaser-owned public
Gatekeeper in front of that service or use a reviewed Cloudflare Service Binding.

## Connection product boundary

The governed Agent runtime implements `connection_invoke`. It requires the Agent to have the
`connection_invoke` tool, the Workflow to allow that action and `connection.execute`, and the
requester, Agent, Workflow, and Connection permissions to intersect. The immutable run risk must
equal the Connection's configured risk. Execution rechecks that the purchaser-configured
Connection remains active, calls only the plan's allowlisted capability with the run idempotency
key, observes Kill before and after invocation, and persists the bounded JSON result and usage.

The adapter layer implements health, discovery, and invocation, and the automation planner can
produce a governed `connection_invoke` plan. **Operations > Connections** collects the adapter's
complete immutable configuration, including remote capability allowlists, routes, MCP protocol,
Secret reference, or Service Binding reference as applicable. Administrators can run bounded
health and discovery checks, compare discovered capabilities with the allowlist, revoke the
Connection, and enable `connection_invoke` only on a Workflow that explicitly allows it.

The direct Agent-run dialog and Ask/Plan/Act path both create governed plans; neither can add a
remote capability or bypass the Workflow allowlist. A Service Binding row is executable only when
the matching `Fetcher` binding exists in the deployed Worker. Do not patch Connection rows directly
in PostgreSQL.

## Rotation, revocation, and offboarding

1. Disable the model route, automation, or workflow that can use the binding.
2. Revoke the Connection or provider in **Operations** and verify its Chronicle event.
3. Replace the purchaser-side credential and update the Worker Secret binding interactively.
4. Verify only binding names are visible with `wrangler secret list`.
5. Re-enable the smallest route and test with a reversible synthetic action.
6. Remove the prior provider credential at the provider after Guild verification succeeds.

When a Human, Agent, or Service leaves, also revoke provider-side sessions and tokens. Application
offboarding cannot revoke credentials owned outside the purchaser's Cloudflare account.

## Verification

Run the adapter and model unit suites for the exact reviewed checkout:

```sh
pnpm --filter @guild-os/gatekeeper exec vitest run \
  __tests__/configured-connection.test.ts \
  __tests__/connection-adapters.test.ts
```

The model runtime suite is database-backed. Supply a migrated, disposable PostgreSQL test database;
the package command mutates it and includes `__tests__/model-runtime.integration.test.ts`:

```sh
read -r -s DATABASE_URL
export DATABASE_URL
pnpm --filter @guild-os/gatekeeper test:integration
unset DATABASE_URL
```

For a deployed release, also record these non-secret checks:

```sh
read -r GUILD_GATEKEEPER_WORKER_NAME
pnpm exec wrangler secret list \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --format json
pnpm exec wrangler deployments status \
  --name "$GUILD_GATEKEEPER_WORKER_NAME" --json
unset GUILD_GATEKEEPER_WORKER_NAME
```

Verify the expected binding names and active Worker Version ID. Never paste command output that
contains purchaser identifiers into the reusable sales-template repository.
