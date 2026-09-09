# ADR 0049: Bounded planner response-format compatibility

Status: Accepted

## Observed failure

An authenticated production Plan request on release `ae79fe0` recorded
`provider_schema_rejected` in Chronicle. Ask inference succeeded with the same
active Workers AI provider. This distinguishes provider response-format
rejection from an absent provider, authentication failure, empty model output or
successful model planning. No provider response text is logged.

## Decision

Request schema-constrained output first. Only when the provider rejects JSON
Mode/schema compilation, perform one read-only model retry with `json_object`.
Include the identical full output schema in the retry's system message. Do not
retry authentication, rate-limit, timeout or generic provider errors here.

The same overall planner deadline covers both calls. Check cancellation before
the retry and after the response. At most two calls are made, retaining the
existing per-call token limit and purchaser-owned model route. This does not
retry Act, create multiple proposals or execute any external action.

Provider grammar support is not an authorization boundary. Both output modes
must pass the existing strict request parser, allowed-action checks, current
Role/Space authorization and immutable proposal creation. Invalid output uses
the existing private Working Memory fallback or fails closed as appropriate.
Act still requires a separate one-action confirmation and current authority.

## Alternatives and costs

Changing the purchaser's model route or credentials is unnecessary. Removing
validation would weaken safety. Repeating indefinitely would increase cost and
latency. The bounded compatibility call can consume an additional inference
attempt; it stays within the overall deadline and does not add a service or
subscription. Schema-capable providers retain the original one-call behavior.

## Verification and rollback

Unit tests cover compatibility success, unrelated provider failures, a failing
second call and cancellation before retry. Existing malformed-output,
permission, idempotency and approval regressions remain mandatory. Local tests
do not prove production inference; a new authenticated production Plan must
record source `model` before that claim is made.

No migration, permission or credential change is required. Reverting this
application change restores the original response-format behavior without
rewriting saved proposals or History.
