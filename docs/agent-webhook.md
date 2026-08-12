# Agent Webhook Contract

Guild OS v1 performs one governed external-write operation: a signed `POST` to the fixed HTTPS URL
in the purchaser deployment configuration. The URL is deployment-owned and cannot be supplied by
an Agent or browser.

## Request

Headers:

| Header | Value |
| --- | --- |
| `content-type` | `application/json` |
| `idempotency-key` | Immutable key unique to the Guild run |
| `x-guild-event` | Validated event type |
| `x-guild-timestamp` | ISO 8601 signing timestamp |
| `x-guild-signature` | `v1=` followed by lowercase HMAC-SHA256 hex |
| `user-agent` | `Guild-OS/1.0` |

Body:

```json
{
  "id": "agent-run-uuid",
  "guildId": "guild-uuid",
  "type": "guild.quest.completed",
  "occurredAt": "2026-08-12T00:00:00.000Z",
  "actor": {
    "agentIdentityId": "agent-uuid",
    "requesterIdentityId": "human-uuid"
  },
  "data": {}
}
```

The signing input is the exact UTF-8 byte sequence:

```text
<x-guild-timestamp>.<raw request body>
```

Verify the HMAC with `GUILD_WEBHOOK_SIGNING_SECRET` using a constant-time comparison. Reject a
timestamp outside the receiver's chosen replay window, normally five minutes. Do not parse and
reserialize the body before signature verification.

## Receiver transaction

The receiver must atomically claim `idempotency-key` in durable storage before applying the side
effect. A repeated key returns the previously stored result without performing the effect again.
Return a `2xx` status only after the claim and required durable write have committed.

Guild OS deliberately performs no automatic outbound HTTP retry. A timeout can mean either that the
receiver did not act or that it acted and the response was lost. The idempotency record is therefore
still mandatory for operator-led replay or a future connector-specific recovery workflow.

Redirects are rejected. The endpoint must return directly within the smaller of 30 seconds and the
run's effective duration limit. Response bodies are ignored and cancelled.

## Bundled reference receiver

`packages/webhook-receiver` is an optional deployable implementation of this contract. It verifies
the HMAC over the exact bytes before JSON parsing, enforces a five-minute replay window, validates
the event envelope, and atomically stores one receipt in a SQLite-backed Durable Object selected by
Guild and idempotency key. An exact replay returns the original receipt without another effect; a
different payload using the same key returns `409`.

The reference effect is durable event receipt. Replace it with an owned email, ticketing, posting,
or automation adapter when needed, while retaining claim-before-effect semantics. Disable
`referenceWebhook.enabled` only after the replacement passes the same contract tests.

## Deployment

1. Deploy the receiver in the purchaser-owned environment.
2. Generate at least 32 random bytes with a cryptographic generator and store it in the purchaser's
   secret manager.
3. Store the same secret in the receiver, then provide it only to the Guild OS live deployment:

   ```sh
   read -r -s GUILD_WEBHOOK_SIGNING_SECRET
   export GUILD_WEBHOOK_SIGNING_SECRET
   pnpm deploy
   unset GUILD_WEBHOOK_SIGNING_SECRET
   ```

4. Set a new `guild.webhook.connectorId`, name, and credential-free HTTPS URL in
   `deployment.local.jsonc`.
5. Run `pnpm check`, deploy, send one nonproduction event, and verify the receiver's idempotency
   record and the Guild Chronicle.

For the bundled receiver, run `pnpm smoke:webhook` with `WEBHOOK_RECEIVER_URL` and the signing secret
set only in the process environment. It sends one synthetic request twice and requires `201` then
deduplicated `200` with the same body hash.

Changing the URL requires a new Connector ID. The deploy script transfers the secret with a
temporary mode-`0600` Wrangler secrets file and removes it after deployment. Never place the secret
in Git, deployment JSONC, query parameters, logs, or an Agent prompt.

## Kill races

Guild OS records `external_attempted_at` before network delivery. A Kill Switch prevents a pending
run from starting and terminates its Workflow, but no system can recall bytes already accepted by a
remote endpoint. If delivery completes after Kill, Guild OS preserves `killed` as the run state and
adds `agent.run.delivery_after_kill` to Chronicle with the observed HTTP result. Operators must use
the receiver's documented compensating operation when the external effect needs reversal.
