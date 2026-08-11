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
and must produce Chronicle records when implemented. It cannot be placed in an ordinary Role;
database constraints reject it even if an application path is bypassed.

An administrator may invite an Identity or assign a Role only when the administrator holds every
permission in that Role globally. Creating or editing a custom Role applies the same rule. This
prevents a Space-scoped manager from manufacturing or delegating Guild-wide authority. Roles must
remain nonempty, built-in Roles are immutable, and machine identities cannot receive permissions
reserved for Humans.

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
secrets, stops its Agent profile, and kills unfinished runs for which it is Agent, requester, or
owner of the Connector. The same transaction expires pending approvals, cancels pending Workflow
start/signals, queues Workflow termination, and appends Identity and per-run Chronicle events.
Existing Cloudflare OS capability objects may remain cached, but every Guild data request and final
Agent execution reloads active Identity and Membership state and therefore denies them.

## Agent execution

The v1 write target is one deployment-owned HTTPS Webhook Connector. Its URL is validated at deploy
time, stored as immutable PostgreSQL configuration, and checked against Worker bindings at plan and
execution time. Agents and browsers cannot provide or redirect the destination. Workers also enable
the strict-public global `fetch` compatibility flag, reject HTTP redirects, and enforce a bounded
timeout.

Cloudflare OS action approval opens a Guild approval; it does not execute the operation. The
Constitution quorum is counted from append-only Human votes. PostgreSQL independently rejects
inactive, machine, wrong-Space, insufficient-clearance, or unauthorized reviewers. The run can
enter `running` only from a current `approved` request, and the execution claim is atomic. A second
claim is rejected rather than delivering twice.

Every run stores immutable Agent, requester, Workflow, and Connector permission snapshots plus hard
limits. Immediately before delivery, Guild OS reloads both Identities, Memberships, Roles, Space,
Agent profile, current Constitution limits, and Connector status. The effective authority and
limits are the stricter intersection of the snapshot and current state.

Webhook delivery uses HMAC-SHA256 over the timestamp and exact body, an immutable idempotency key,
and no automatic outbound retry. The receiver is responsible for durable idempotency. Kill changes
PostgreSQL state before Workflow termination. An HTTP request already accepted remotely cannot be
recalled; a completion observed after Kill is recorded once as `agent.run.delivery_after_kill`
without changing the run from `killed`.

## Model context

Ask Guild queries only Canonical Knowledge. PostgreSQL first applies active Membership, Role,
hierarchical Space, classification, visibility, owner, and explicit-share predicates. The domain
policy engine then repeats authorization on each returned candidate before its text can enter model
context. Filtering a fixed top-N result after retrieval is prohibited because denied rows could
crowd out permitted evidence even when their text is later removed.

The Workers AI call disables AI Gateway prompt logging and cache collection. Chronicle stores only
the question SHA-256 and citation count. A per-Identity rate-limit binding is checked after evidence
authorization and before model invocation. Citations identify the exact Knowledge version supplied
to the model; a no-evidence response does not call the model.

Knowledge security metadata may change only before its first Canonical publication, while saving a
new immutable draft version. The writer must be authorized against both the old and proposed
boundary. PostgreSQL locks Space, visibility, classification, and explicit shares after publication;
a different boundary requires a new Knowledge record and review. Each R2 file also retains its
upload-time boundary, and reading it requires authorization against both the current Knowledge and
the immutable file boundary.

Decision lists are permission-filtered in PostgreSQL before rows reach the Gatekeeper, then each
result is authorized again by the domain policy. A draft can be edited only by an authorized Human.
Proposal freezes its content, evidence references, options, Space, visibility, classification, and
explicit-share boundary. Reviews are append-only and human-only; an Agent, Service, inactive
Membership, or Human outside that boundary cannot vote. Approval is reached only when one option
meets the Constitution quorum. A rejection records dissent and closes the proposal. Approved or
rejected results cannot be rewritten. An approved Decision can be superseded only by another
approved Decision with the exact same authorization boundary, preserving access rather than
silently broadening or narrowing it.

Announcement management is human-only. Draft creation and edits require `announcement.manage` on
both the current and proposed boundary. Publication freezes title, body, Space, target Role,
visibility, classification, explicit shares, and expiry. Recipient selection is one SQL operation
over active Human Identities with `preboarding` or `active` Membership, adequate clearance,
`announcement.read`, matching Space ancestry, optional target Role, and visibility access. The
publisher is excluded, and a per-recipient deduplication key makes retries safe.

Inbox and Chronicle queries do not trust the fact that a recipient or auditor once had access.
Each row stores the originating resource's security boundary, and PostgreSQL re-evaluates current
Identity, Membership, Role, Space, clearance, ownership, and explicit-share authority before the
row leaves the database. The Gatekeeper then repeats domain authorization. Suspending a member or
removing a Role therefore hides prior Inbox and Chronicle rows immediately without deleting the
historical record. Inbox payload and security columns are immutable; only its recipient can change
the read timestamp. Chronicle remains fully append-only.

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
Additional triggers enforce one root Space, acyclic Space ancestry, immutable Identity kinds,
nonempty Roles, valid Agent limits and tools, and the pairing between an active Agent profile, its
Agent Identity, and active Membership. These checks repeat domain validation so direct SQL cannot
create an authorization state that the application refuses.

Decision triggers independently enforce draft-only edits, human reviewer eligibility, append-only
reviews, same-option quorum, immutable terminal results, and exact-boundary supersession. This keeps
the governance record valid even if a future service implementation bypasses TypeScript checks.

R2 uploads are two-phase: a pending PostgreSQL row is committed before bytes are written, and only
then becomes ready. Draft publication, archival, and version replacement reject pending uploads.
Unlinks and failed uploads create a transactional outbox item before cleanup. The Worker retries
idempotent R2 deletion on a Cron Trigger and recovers abandoned processing leases, so an R2 outage
does not make deleted files visible or lose the cleanup obligation.

## Secrets

- PostgreSQL credentials live in the database provider and Hyperdrive configuration.
- Model-provider credentials live in AI Gateway or Wrangler secrets.
- OAuth credentials live in their owning Gatekeeper Worker secrets.
- Secrets are never valid `deployment.jsonc` values.
- Live deployment validates all required secrets before the first Worker update, transfers only the
  required values through mode-`0600` temporary files, deletes them after use, and removes them from
  child-process environments.
- Logs must not contain prompts, tokens, connection strings, private content, or unrestricted event
  payloads.

## Write-path threat model

| Threat | Control | Residual risk / response |
| --- | --- | --- |
| Forged Human or Agent ID | IDs come from account capability or permission-filtered discovery; PostgreSQL reloads active Identity and Membership | Rehearse Access and account-capability recovery in production |
| Requester-to-Agent privilege escalation | Agent, requester, Workflow, and Connector permission intersection at plan and execution | Incorrect Role design can still grant intended but excessive authority; audit Roles |
| Unauthorized context leakage | SQL filters Role, Space, clearance, visibility, and sharing before model context | External model/provider policy remains purchaser-owned |
| Agent-selected URL / SSRF | Fixed immutable HTTPS URL, strict-public fetch, credential/query/hash rejection, redirects disabled | DNS ownership and receiver security remain purchaser responsibilities |
| Duplicate external effect | Atomic run claim, one outbound attempt, immutable idempotency key, receiver-side durable deduplication | Lost responses are ambiguous; use receiver audit and an explicit compensating run |
| Stale approval | Approval expiry plus execution-time state and authority recheck | A remote effect already accepted cannot be revoked |
| Workflow or API outage | Transactional outbox, bounded backoff, exhausted-attempt terminal failure and Chronicle event | Operators must restore Cloudflare service and create a new approved run |
| Kill/offboarding race | Database-first Kill, outbox cancellation, Workflow termination, late-delivery Chronicle event | In-flight network bytes may win; execute the receiver's compensating operation |
| Secret disclosure | Wrangler secret, no config/log/prompt storage, HMAC verification | Rotate receiver and Worker secret, provision a new Connector ID, kill old runs |
| Prompt injection in Knowledge | Canonical-only, permission-filtered context; model output cannot bypass policy or approval | Humans must inspect Level 2 action payloads before approval |

## Known security gates

Before a production release, complete and verify:

- Keep Level 3 actions disabled until a reauthentication-capable, multi-approver connector is added
- External Access/session recovery rehearsal in the deployed environment
- Backup restore rehearsal
- Receiver-side signature, replay-window, and durable idempotency smoke
