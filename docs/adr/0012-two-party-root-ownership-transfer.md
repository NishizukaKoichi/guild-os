# ADR 0012: Require two active Humans for Root ownership transfer

- Status: Accepted
- Date: 2026-08-12

## Context

Root ownership controls the Constitution and the final organizational authority. A single-session
"make Root" action would let a stolen Root session silently hand the Guild to another Identity. A
Role assignment is also insufficient because Root authority is deliberately not delegable through
Roles. Ownership still needs a supported handover path so it is not permanently tied to the first
operator.

## Decision

- Only the current active human Root Owner can propose a transfer.
- A proposal names one different active Human, the Role retained by the outgoing Root, a reason,
  and a seven-day expiry. The successor's display name must be typed exactly in the management UI.
- Ownership changes only when the named Human accepts from their own authenticated account. The
  successor confirms the Guild name and supplies a separate acceptance reason.
- The proposal terms are immutable. While it is live, its outgoing Role and permissions cannot be
  changed. The current Root may cancel it; an expired proposal cannot be accepted or cancelled.
- Acceptance changes the Guild Root, grants the selected global Role to the outgoing Root when
  absent, resolves the proposal, notifies the prior Root, and appends Chronicle evidence in one
  PostgreSQL transaction.
- Proposal, acceptance, cancellation, and expiry each require a matching Chronicle event through a
  deferred database constraint. Transfer history cannot be updated or deleted.
- PostgreSQL rejects direct Root replacement unless the transaction identifies the successor and a
  matching live proposal, then verifies at commit that the proposal reached `accepted`.
- Agents and Services cannot propose, receive, accept, or cancel Root ownership.

## Alternatives considered

- **Immediate transfer by the current Root:** rejected because one compromised session could seize
  or irreversibly misdirect ownership.
- **Assign a special Root Role:** rejected because Role administrators could delegate authority that
  governs the Role system itself.
- **Email-only confirmation:** rejected because email is not the application identity boundary;
  Guild OS binds authority to the purchaser-owned Cloudflare OS account capability.

## Consequences

An ordinary handover requires both Humans to remain active until acceptance. If the current Root is
unavailable, operators must use the separately designed Break Glass ceremony, not edit the database
or manufacture a Role grant. Application rollback can remove the UI, but migration `0023` is not
rolled back in place; a correction is a reviewed forward migration. Completed and cancelled
transfer records remain part of Guild history.
