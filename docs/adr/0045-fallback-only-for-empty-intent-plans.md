# ADR 0045: Fall Back Only For Empty Intent Plans

## Status

Accepted on 2026-08-30.

## Context

The production Plan model returned a valid JSON object with an empty `actions` array for an
informational Ask objective. The server correctly refused to persist or execute it, but the user
could not complete the documented Ask to Plan journey. Treating every malformed or unsupported
model action as a fallback would hide unsafe output and weaken the inspection boundary.

Cloudflare Workers AI JSON Mode returns structured output inside a `response` envelope. Depending
on the provider path, that envelope can contain either a JSON string or an already-parsed object.
Both are provider-valid representations and must reach the same strict Plan parser.

## Decision

The Plan prompt explicitly requires one to twenty actions and directs the model to use a
working-layer `memory.propose` when no specialized action is justified. If the model still returns
an empty `actions` array, the service uses its existing deterministic, permission-checked Memory
proposal. The adapter unwraps string and object forms of the Workers AI `response` envelope before
validation. A malformed top-level response or missing `actions` array remains an error.

Unsupported action kinds, excessive action counts, malformed requests, invalid risk levels, and
resource authorization failures continue to fail closed. The fallback creates only a pending Plan;
it never executes during Ask or Plan and still requires the normal one-at-a-time Act boundary.

## Alternatives

- Returning the model error unchanged was rejected because a harmless empty response made the main
  production journey unavailable.
- Falling back for every invalid model response was rejected because it could conceal unsupported
  or excessive actions that operators need to investigate.

## Risks And Rollback

The fallback may propose preserving an informational answer when the model cannot identify a more
specific action. The proposal remains visible and unexecuted, so the Human can decline it. Rollback
is the removal of the empty-proposal exception and the accompanying prompt constraint and test.
