# Guild OS Webhook Receiver

This optional purchaser-owned Worker is the reference Risk Level 2 write target. It verifies the
exact Guild OS HMAC request before parsing JSON, rejects stale requests after five minutes, and uses
one SQLite-backed Durable Object per Guild/idempotency-key pair for strongly consistent replay
protection. A first request returns `201`; an exact replay returns `200` without a second effect; key
reuse with a different body returns `409`.

The Durable Object stores the validated event and exact body as the reference external effect. A
real connector can replace that storage write with email, ticketing, or another system, but must
preserve verification, durable claim-before-effect, conflict handling, and bounded response time.

Only `GET /healthz` and `POST /guild-events` exist. There is no public receipt-list endpoint.
Operators inspect records through purchaser-controlled Durable Object tooling and Chronicle.

Run the repeat-delivery smoke after deployment:

```sh
export WEBHOOK_RECEIVER_URL=https://hooks.example.com/guild-events
read -r -s GUILD_WEBHOOK_SIGNING_SECRET
export GUILD_WEBHOOK_SIGNING_SECRET
pnpm smoke:webhook
unset WEBHOOK_RECEIVER_URL GUILD_WEBHOOK_SIGNING_SECRET
```
