# ADR 0045: Schema-bound Intent Plans With A Narrow Safe Fallback

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

The production model subsequently returned a supported action kind and valid risk level but moved
request fields onto the action object instead of placing them inside `request`. That output was
correctly rejected, but it demonstrated that `json_object` mode did not communicate the action
envelope strongly enough to the model.

## Decision

The Plan prompt uses Workers AI `json_schema` mode to require one to twenty actions and the exact
action envelope for each currently authorized action kind. It also includes the complete,
server-derived safe Memory action as the fallback example. The adapter unwraps string and object
forms of the Workers AI `response` envelope before validation.

If the provider returns non-JSON text, the model returns an empty `actions` array, or a supported
action with a valid risk level breaks only the outer action envelope, the service discards that
output and creates its existing deterministic, permission-checked working Memory proposal. A
parsed malformed top-level object or missing `actions` array remains an error.

Unsupported action kinds, excessive action counts, malformed request contents, invalid risk levels, and
resource authorization failures continue to fail closed. The fallback creates only a pending Plan;
it never executes during Ask or Plan and still requires the normal one-at-a-time Act boundary.

## Alternatives

- Returning the model error unchanged was rejected because a harmless empty response made the main
  production journey unavailable.
- Falling back for every invalid model response was rejected because it could conceal unsupported
  actions, malformed request content, or excessive actions that operators need to investigate.
  Provider text that cannot represent any Action is distinct: it is discarded rather than parsed.

## Risks And Rollback

The fallback may propose preserving an informational answer when the model cannot identify a more
specific action. The proposal remains visible and unexecuted, so the Human can decline it. Rollback
is the removal of the empty-proposal exception and the accompanying prompt constraint and test.
