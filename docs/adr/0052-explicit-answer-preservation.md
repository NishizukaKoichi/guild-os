# ADR 0052: Explicit answer preservation in Memory plans

Date: 2026-09-09

## Observed failure

Live model planning on the exact 2f73715 release produced the requested short
title and private audience, but copied an instruction into the Memory body.
The content preview exposed this semantic failure; no Act was executed.
Another prompt-only repair is not a reliable content-preservation guarantee.

## Decision

The Plan form defaults an explicit, localized checkbox to preserve the answer
unchanged in Memory drafts. The additive `preserveAnswer` option is validated
as boolean. When selected, the service binds each Memory action's body and
source IDs to the freshly authorized server-side Ask result before hashing,
authorization and immutable proposal storage. The client supplies no answer
or authority. Provenance and Chronicle record the selected policy. The model
still chooses action kind, title and metadata; users still inspect the exact
body, audience and actions before individually confirming Act.

Unchecking the option retains model-authored draft content. Older callers that
omit the option retain their contract. Activity, Decision and Agent actions
are unchanged. No existing proposal, Memory or schema is rewritten.

Live afed164 verification completed one private Memory Act with the requested
title and unchanged answer, but the model's summary still described the
instruction rather than the question. Preserve mode therefore also binds the
summary to the Ask question. The model-authored mode remains unchanged.

## Verification and limits

Unit tests cover EN/JA/zh-CN content binding through Act, explicit draft mode,
and invalid input rejection before inference. E2E checks the visible default
and editable choice. Exact-release CI and live model/Act evidence are separate
release gates, not implied by these tests. Preserving an answer does not make
its claims canonical or remove the need to inspect its sources.

Rollback uses the prior code version; the additive request field requires no
data migration. A transient deployment-time RPC reset was also observed and
recovered by reloading the outer application. This ADR does not claim to repair
that upstream connection-recovery behavior.
