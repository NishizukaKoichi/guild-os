# Customizing Cloudflare OS

This wrapper exposes controls at three depths. Start in the Admin UI, move to deployment configuration when the trust or infrastructure boundary changes, and write code only for capabilities that neither layer can express.

## Admin UI

Use `/admin` for runtime policy that should not require a deployment:

- Site name, logo, and accent color
- Announcements and agent instructions
- Connector availability and auto-provisioning policy
- Signup behavior, featured blueprints, and output formats

Authentication and authorization are deliberately absent. Sign-in configuration and administrator identities remain deployment-controlled so a compromised admin session cannot redefine the trust boundary.

## Collective Templates and Context Profiles

Choose **More > Settings > Context profiles** to apply Personal with AI, Company, Community,
Research, Creator, Open Source, Agent Collective, or Blank. The Guild Profile controls labels,
Home action order, Memory and Activity choices, Decision methods, workflow suggestions, and the
suggested Agent. The four primary labels can be overridden, and every Space can inherit the Guild
Profile or select a different built-in or purchaser-saved Blueprint. See the complete
[Context Profile guide](context-profiles.md).

The selected Template's built-in Role preset is created during initialization. Custom Roles remain
editable data under Guild Settings; built-in Roles are protected from accidental mutation.
Applying a Profile after initialization does not silently replace existing Roles, assignments,
Actors, or data. This prevents an operating-context change from becoming an authorization
migration. Personal with AI is the guided initialization default; Blank is the advanced neutral
Profile.

For a purpose that does not match a preset, select **Other / Build your own** during first setup.
Answer what the collective exists for, who or what participates, what it remembers, how it acts,
and how it decides. Guild OS proposes a name and purpose, full vocabulary, bounded Role and
Capability bundles, Spaces, Memory types, Activity types and states, Decision methods, Home
priorities, Workflows, and an optional bounded Agent. Review and edit every proposal before save.

Saved Blueprints are Guild-scoped, versioned data. Use **Settings > Context profiles** to create,
edit, apply, or reuse them for the whole Guild or a single Space. Applying one after initialization
changes operating context only; it never rewrites existing Roles, assignments, permissions,
Constitution, approval rules, Connections, or Agent permissions. Use the dedicated governed
Settings operations for authority changes.

Workers AI may improve a proposal when available. Model output is untrusted: the server strips
authority choices down to reviewed allowlisted bundles and validates the exact schema. A bounded
deterministic proposal remains available if the model is unavailable, and the review screen marks
that fallback. Raw Blank remains the expert path that makes no proposal.

Built-in definitions live in `packages/guild-domain/src/templates.ts`; translated display copy
lives in `packages/guild-gatekeeper/app/collective-language.ts`. To add a purchaser-owned Template:

1. Add a stable key to `COLLECTIVE_TEMPLATE_KEYS` and one definition with labels, Role presets,
   Memory types, Activity types, decision methods, workflows, dashboard intents, and optional Agent.
2. Add localized copy without changing the internal key.
3. Add a forward-only migration that seeds `collective_templates` and `vocabulary_profiles` for
   existing Guilds. Never edit an applied migration.
4. Add domain tests for the definition and E2E coverage for Home ordering, type choices, workflows,
   the suggested Agent, and one Space override at 1440, 390, and 320 pixels.

To remove a Template, first migrate every `guild_collective_settings.template_key` and
`spaces.vocabulary_profile_key` reference to Blank or another retained Template. Only then remove
the registry entry in a later release. Do not encode Template checks inside repositories or policy
code; add a neutral Capability or data field when behavior is genuinely new.

Custom Memory and Activity types use a namespaced value such as `custom:recipe` or
`custom:mutual_aid`. Add the type to the selected Template definition so the UI offers it. The
canonical schema and API accept these names without a Template-specific table.

### Branding

Set the site name, logo, and accent color from the General tab in `/admin`. Logo uploads accept PNG, JPEG, WebP, and SVG files up to 5 MB. The browser scales the longest edge to 256 pixels without cropping and converts the result to PNG. The server then checks the PNG header and rejects anything over 256 KB or 512 pixels before storing it in the deployment's blueprint-content R2 bucket. Square images work best.

The custom logo appears in the app chrome, sign-in screens, and browser tab on each user's next connection. Use **Restore default** to remove it.

## Deployment configuration

[`deployment.jsonc`](../deployment.jsonc) is the annotated sales-template control surface. Copy it
to ignored `deployment.local.jsonc` for an installed instance, or set
`GUILD_OS_DEPLOYMENT_CONFIG` to an absolute encrypted external path. The commands prefer the local
copy and refuse a live deploy from the tracked template. Its groups map directly to generated
Wrangler configuration:

| Path | Controls | Choices |
| --- | --- | --- |
| `accountId` | Resource ownership | A 32-character [Cloudflare account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/) |
| `workers.*.name` | Stable Worker service identities | Unique lowercase names; changing one creates a differently named Worker |
| `workers.workshop.route` | Public Workshop address | `customDomain` for production or `workersDev: true` for evaluation |
| `access` | Cloudflare Access trust and administrator list | Access team issuer, application audience, and verified email list |
| `aiGateway` | Deployment-funded model catalog | Disabled, Workers AI direct, or provider traffic through AI Gateway |
| `context` | Context sharing boundary, snapshot KV, and optional Artifacts repositories | A stable domain label; automatic or existing KV; Git-backed collections disabled or enabled |
| `guild` | Guild identity, Constitution defaults, quorum, retention, Hyperdrive, and Ask Guild | Organization settings, PostgreSQL, Workers AI model, AI Gateway ID, and request limit |
| `errorReporting` | Private explicit-issue destination | Console Reporter enabled state, environment, and release metadata |
| `resources` | Blueprint/avatar KV plus blueprint and Knowledge R2 | `null` to provision or explicit IDs/names to reuse |
| `observability` | Worker telemetry | Structured logs, invocation logs, traces, and sampling; see the [observability guide](observability.md) |

Secrets are never valid values in these files. Install them only through the documented deployment
environment and temporary Wrangler secret transfer.

### Workers and routing

Keep the four Worker names unique. Service bindings use these names, so update and deploy them together.

For production, set a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/):

```jsonc
"route": { "customDomain": "os.example.com" }
```

The hostname must belong to an active Cloudflare zone and cannot conflict with an existing CNAME. Wrangler creates the DNS record and certificate. For evaluation, use the account's [`workers.dev`](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) subdomain instead:

```jsonc
"route": { "workersDev": true }
```

### Sign-in methods

Cloudflare OS supports three ways to sign users in. This starter deploys Cloudflare Access.

| Method | How it works | In this starter |
| --- | --- | --- |
| Cloudflare Access | Access verifies identity before the request reaches the Worker, and the Workshop trusts the signed Access JWT. The password login and signup pages are disabled. | Deployed by default |
| Built-in password accounts | Cloudflare OS serves its own username and password login plus signup. This is the upstream default. | Requires deploy script changes |
| Auth Gatekeepers | Gatekeepers that advertise `providesAuth` add "Continue with ..." buttons, alongside or instead of password login. | Requires deploy script changes |

Access mode is the default here because unauthenticated requests never reach application code. `scripts/deploy.mjs` implements it by setting `CF_ACCESS_ISS` and `CF_ACCESS_AUD` on the Workshop and building the frontend with `VITE_CF_ACCESS_MODE=true`.

To run another method, drop those two variables and the build flag, then set upstream's `AUTH_GATEKEEPERS` allowlist for provider sign-in. `DISABLE_PASSWORD_AUTH=true` makes a deployment provider-only. Upstream ignores it unless at least one auth Gatekeeper is allowlisted, so a deployment cannot lock everyone out. The wrapper's validation assumes Access mode, so review the upstream Workshop backend and frontend documentation before changing it.

The `admins` list gates `/admin` in every method.

#### Cloudflare Access

Create a [self-hosted Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) covering the Workshop hostname. Then configure:

- `issuer`: the team origin, such as `https://acme.cloudflareaccess.com`, with no path.
- `audience`: the application's [AUD tag](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag).
- `admins`: Access-verified email addresses allowed into `/admin`.

Access policies decide who can sign in. The `admins` list decides which signed-in identities can change runtime policy. Keep both narrow.

### Storage

Wrangler supports [automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning) for KV and R2. Leave these values as `null` for a new deployment:

```jsonc
"context": {
  "sharingDomain": "production",
  "kvNamespaceId": null
},
"resources": {
  "blueprintsKvNamespaceId": null,
  "avatarsKvNamespaceId": null,
  "blueprintContentBucket": null,
  "knowledgeFilesBucket": null
}
```

Wrangler creates resources with the Worker name as a prefix and reconnects them on future deploys. To adopt existing data, replace the relevant `null` with a [KV namespace ID](https://developers.cloudflare.com/kv/reference/kv-commands/#kv-namespace) or [R2 bucket name](https://developers.cloudflare.com/r2/reference/wrangler-commands/#r2-bucket).

### Context Artifacts

The Context Gatekeeper can use [Artifacts](https://developers.cloudflare.com/artifacts/) as Git-compatible storage for Context collections. This is disabled when `enabled` is omitted or false and requires Artifacts access on the deployment account. Enable it without specifying a namespace to use `gatekeeper-context-collections`:

```jsonc
"artifacts": { "enabled": true }
```

To isolate repositories under another stable namespace, add the optional property:

```jsonc
"artifacts": {
  "enabled": true,
  "namespace": "acme-context-collections"
}
```

Artifacts creates the namespace implicitly when the first repository is created. Keep the selected namespace stable: existing Git-backed collections refer to repositories in it. Disabling the binding later stops repository refresh and token management but does not delete repositories; the last synchronized Context content remains readable. Write tokens grant repository mutation authority, so protect them like other credentials and revoke them when no longer needed.

### AI models

AI is optional for deployment. The Workers AI binding remains available to Cloudflare OS platform features, but the current upstream model transport uses HTTPS. A deployment-funded model catalog therefore requires `CF_AI_GATEWAY_API_TOKEN` even for Workers AI.

| Mode | Configuration | Result |
| --- | --- | --- |
| No platform model | `aiGateway.enabled: false` | Deploys without an AI secret; no funded model catalog is advertised |
| Workers AI direct | Enable AI, include only `cloudflare`, set `workersAi.mode: "direct"` | Calls the Workers AI REST endpoint without Gateway model logs |
| Workers AI through Gateway | Enable AI, include `cloudflare`, set `workersAi.mode: "gateway"` | Adds [AI Gateway observability](https://developers.cloudflare.com/ai-gateway/observability/) |
| External providers | Add `anthropic`, `openai`, or `google` | Exposes supported models through [AI Gateway](https://developers.cloudflare.com/ai-gateway/) and its billing/key configuration |

To fund Workers AI directly:

```jsonc
"aiGateway": {
  "enabled": true,
  "name": "default",
  "accountId": "<CLOUDFLARE_ACCOUNT_ID>",
  "providers": ["cloudflare"],
  "workersAi": { "mode": "direct" }
}
```

To route it through AI Gateway, change `mode` to `gateway` and add the gateway name. Cloudflare can [create the `default` gateway on first use](https://developers.cloudflare.com/changelog/post/2026-03-02-default-gateway/). Add external providers only after selecting [Unified Billing or BYOK](https://developers.cloudflare.com/ai-gateway/get-started/#provider-authentication).

Create a narrowly scoped [API token](https://dash.cloudflare.com/profile/api-tokens) following the current [AI Gateway authentication guidance](https://developers.cloudflare.com/ai-gateway/configuration/authentication/), then provide it only to the live deployment process. When AI is enabled, the generated Wrangler config [declares this secret as required](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy), so deployment fails clearly if it is missing.

```sh
read -r -s CF_AI_GATEWAY_API_TOKEN
export CF_AI_GATEWAY_API_TOKEN
# Also export GUILD_WEBHOOK_SIGNING_SECRET, then run pnpm deploy.
```

The deploy script sends secrets through temporary mode-`0600` JSON files accepted by Wrangler's
`--secrets-file` option, removes them even after failure, and does not forward them to build or test
processes. This also supports the first deployment, before either Worker exists.

For Workers AI through the default gateway, current Cloudflare guidance calls for Account permissions `AI Gateway - Read`, `AI Gateway - Edit`, and `Workers AI - Read`. Recheck the linked guidance when enabling other providers.

Ask Guild has a separate Workers AI binding on the Guild Gatekeeper. Configure it independently:

```jsonc
"guild": {
  "askModel": "@cf/meta/llama-3.1-8b-instruct-fast",
  "aiGatewayId": "default",
  "askRequestsPerMinute": 20,
  "recoveryAttemptsPerMinute": 5
}
```

The Ask limit and emergency-recovery limit are applied per opaque Cloudflare OS account and
Cloudflare location. They limit bursts and are not a billing budget; Guild- and Agent-level monetary
budgets remain an Agent runtime responsibility.
Ask calls disable AI Gateway prompt logging and cache collection. The database Chronicle stores a
question SHA-256 and citation count, not the question or answer text.

### Observability

The starter enables structured custom logs and a private console-backed Error Reporter, while invocation logs, traces, and browser reporting remain separate controls. See [Observability and error reporting](observability.md) for signal selection, sampling, triage, privacy, source maps, frontend reporting, and external destinations.

## Guild Gatekeeper

The deployment-owned Guild Gatekeeper lives under `packages/`, outside the `cloudflare-os` submodule. `scripts/deploy.mjs` binds it to the Workshop as `GATEKEEPER_GUILD` and keeps Context available as `GATEKEEPER_CONTEXT`.

The implemented governed-memory path is:

1. `types.d.ts` defines the API visible to TypeScript callers.
2. `GuildSessionImpl` resolves the caller's Guild identity and effective permissions from PostgreSQL.
3. PostgreSQL removes unauthorized Knowledge rows before model context construction, then the domain
   policy engine repeats the check before any text is supplied to Workers AI.
4. `GuildGatekeeper` bootstraps the first Cloudflare OS administrator as the human Root Owner; later Humans enter only through a one-time invitation bound to Role, Space, and initial Membership state.
5. `GuildAccount` exposes a per-user session as a singleton.
6. `GatekeeperVendor` advertises credential-free auto-provisioning.
7. Canonical Knowledge can be queried through Ask Guild with source citations; drafts and denied
   rows never enter model context.
8. R2 uploads use pending database metadata, checksum verification, and finalization. Deletions use
   the transactional outbox and a five-minute Cron Trigger so a transient R2 failure is retried.
9. The Workshop service binding makes the vendor available to Cloudflare OS.

### Governed Agent Webhook

`guild.agentWorkflowName` names the Cloudflare Workflow. `guild.webhook` provisions the one fixed,
deployment-owned v1 Connector. Generate a new Connector UUID for every destination; changing an
existing Connector's URL in place is rejected.

Export `GUILD_WEBHOOK_SIGNING_SECRET` only while running `pnpm deploy`. The deployment check declares
it as required but remains secret-free; the live deploy validates and transfers it through a
restricted temporary file. Cloudflare OS Agent sessions discover eligible Agent, Space, and
Connector IDs through
`getAgentExecutionContext()`, then submit `planWebhookAction()`. Cloudflare OS approval opens the
Guild approval request; it does not bypass the Constitution quorum.

See [Agent Webhook contract](agent-webhook.md) for receiver signature, idempotency, timeout, and Kill
race requirements.

Read the [package guide](../packages/guild-gatekeeper/README.md), [security model](security.md), and upstream [`write-gatekeeper` skill](https://github.com/cloudflare/cloudflare-os/blob/main/.agents/skills/write-gatekeeper/SKILL.md) before adding verified identity claims, URL-scoped resources, writes, simulations, hooks, or configurator UI. New write actions must preserve the v1 plan, approval, final authority recheck, idempotency, Kill, and Chronicle invariants; do not route around the governed Agent service.

## Code extensions

Prefer wrapper-owned Workers and [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) over patches inside the submodule. Modify upstream only when a Worker boundary cannot express the behavior, and keep the change as a reviewable upstream commit or fork rather than a generated overlay.

## Upgrade

1. Record the current `cloudflare-os` gitlink for rollback.
2. Update the submodule to the intended upstream commit.
3. Review Workshop and Context Wrangler base-config changes and Gatekeeper contracts.
4. Run `pnpm install --frozen-lockfile`, `pnpm audit:dependencies`, `pnpm peers:check`, and
   `pnpm check` from the repository root.
5. Deploy and verify Access, administrator access, PostgreSQL/Hyperdrive, storage, configured AI, Context, Guild observations, and the Error Reporter query surface.
6. If needed, restore the previous gitlink and redeploy, or use [Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) when bindings remain compatible.

Do not update the submodule blindly. The deployment script derives from upstream configs so incompatible base changes remain visible during review and checks.
