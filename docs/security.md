# Security Model

## Trust boundaries

Cloudflare Access authenticates a human before the Workshop request reaches application code.
Cloudflare OS owns the user session, agent sandbox, Gadget sandbox, connected capabilities, and
approval queue. Guild OS owns organizational authorization and data isolation.

Neither layer replaces the other:

- Access authentication does not grant a Guild Role.
- Hiding a control in the frontend does not authorize its backend operation.
- A Guild Role does not give an Agent a connector capability.
- A connector capability does not bypass Guild, Space, requester, or workflow restrictions.

## Identity

Guild identities are Human, Agent, or Service. Root Owner must be an active Human. The current
Gatekeeper uses a per-Workshop-account capability UUID for its Human identity because upstream
Cloudflare OS does not pass the verified Access identity into auto-provisioned `createAccount()`.

An unknown account is not inserted into the Guild database. A Human administrator creates a
32-byte one-time invitation for a specific Role, Space, and initial Membership state. The recipient
claims it from that account capability. PostgreSQL stores only the SHA-256 hash, locks the invitation
row during acceptance, and rejects expiry or replay. Authorization must never use a self-declared
email.

## Authorization

All operations call the framework-independent policy engine. Role bindings can be global or scoped
to a Space; a Space binding applies to descendants, never siblings. Suspended, departed, and disabled
identities are rejected before role evaluation.

Root ownership does not bypass Private visibility. Break Glass is a separate human-only permission
and must produce Chronicle records when implemented.

Agent authority is:

```text
agent grants
intersection requester grants
intersection workflow grants
intersection connector capability
```

Constitution, Guild, Space, Identity, Membership, Role, Agent configuration, Connector management,
Agent stopping/approval, and Break Glass remain human-only even if an Agent is accidentally assigned
a Role containing those permissions.

Suspending or departing an Identity disables it in the same transaction, revokes owned Connector
secrets, stops its Agent profile, kills unfinished runs for which it is Agent or requester, and
appends a Chronicle event. Existing Cloudflare OS capability objects may remain cached, but every
Guild data request reloads active Identity and Membership state and therefore denies them.

## Model context

Knowledge and Space metadata are authorization-filtered before they are returned through the
Gatekeeper. The agent catalog is bounded by Cloudflare OS and contains only permitted Spaces. The
Gatekeeper asks the Workshop to authorize each observation before returning data to a Gadget or
agent.

Guild observations cannot currently be shared with a different Workshop account. This conservative
default prevents historical observations from becoming visible to a new collaborator.

## PostgreSQL

Every application transaction executes:

```sql
SELECT set_config('app.guild_id', $1, true);
```

All Guild tables use forced row-level security based on this transaction-local value. The repository
accepts only the opaque connection type produced by the transaction helper. PostgreSQL remains
defense in depth; application authorization is still required for Role, Space, visibility, and
classification.

Chronicle has a database trigger rejecting updates and deletes. Material mutations, Chronicle
events, and outbox records must commit in one transaction. Deferred database constraint triggers
also reject a final state where the Root Owner is not an active Human with an active Membership.

## Secrets

- PostgreSQL credentials live in the database provider and Hyperdrive configuration.
- Model-provider credentials live in AI Gateway or Wrangler secrets.
- OAuth credentials live in their owning Gatekeeper Worker secrets.
- Secrets are never valid `deployment.jsonc` values.
- Logs must not contain prompts, tokens, connection strings, private content, or unrestricted event
  payloads.

## Known security gates

Before a production release, complete and verify:

- Multi-approver Level 3 execution with reauthentication
- Agent identity binding and run-specific permission intersection at the Gatekeeper
- External Access/session recovery rehearsal in the deployed environment
- Backup restore rehearsal
- Threat model for every write-capable Gatekeeper
