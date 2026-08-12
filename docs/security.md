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

Guild creation is an explicit command, not a page-load side effect. Before initialization, the UI
shows the configured Guild name and purpose, but only a Workshop-authenticated administrator can
submit the command. The caller must provide a human display name, locale, and exact Guild-name
confirmation. A PostgreSQL advisory transaction lock makes the first completed initialization the
only winner under concurrency.

Bootstrap data is partitioned by access state. A usable `preboarding` or `active` member receives
the member bootstrap. Every other initialized account receives only public deployment labels, its
own opaque account and Membership state, locale, and a masked Break Glass status. Root identity,
Constitution, ownership transfers, and Agent defaults are never serialized for that account. The
frontend branch is usability only; the account-bound RPC and every repository operation remain the
authorization boundary.

## Authorization

All operations call the framework-independent policy engine. Role bindings can be global or scoped
to a Space; a Space binding applies to descendants, never siblings. Suspended, departed, and disabled
identities are rejected before role evaluation.

Root ownership does not bypass Private visibility. Constitution update and Break Glass are
Root-only authorities, not delegable Role permissions; database constraints reject either grant
even if an application path is bypassed.

The Settings surface lets every authorized member read the current Constitution, but only the
current active human Root Owner can edit it. Every edit supplies the expected version and a reason.
The Gatekeeper and repository repeat the Root check, then PostgreSQL verifies the transaction-local
actor, active Root state, exact one-version increment, quorum ordering, retention bounds, and Agent
limit shape. The mutation and `constitution.updated` Chronicle event commit atomically. The
Constitution cannot be deleted.

Root ownership transfer uses a nondelegable two-party protocol. The current Root proposes one
different active Human, an outgoing Role, a reason, and an expiry. The named Human must accept from
their own authenticated account and confirm the Guild name. Neither an administrator nor the
current Root can accept on the successor's behalf. PostgreSQL freezes the proposal and referenced
Role while it is live, rejects acceptance after expiry, performs the Root change and outgoing Role
grant atomically, and requires matching Chronicle events at commit. Transfer history is append-only.
Acceptance also invalidates the current Break Glass generation atomically. PostgreSQL rejects a
Root change that leaves prior recovery codes active, so the previous Root cannot use retained codes
to undo a completed handover. The new Root creates a fresh custody set after acceptance.

Break Glass is the independent recovery path when the two-party protocol cannot be completed. The
current Root creates ten 192-bit one-time codes and receives the plaintext only once. PostgreSQL
stores SHA-256 hashes, an identifying hint, immutable generation metadata, and no recoverable
secret. Rotation or revocation advances a versioned pointer, so an old code set cannot be selected
again. A successful recovery consumes one code and invalidates its entire generation.

Recovery is available only through an authenticated Cloudflare OS account. It accepts an existing
active Human or creates a restricted active Human for an account not yet represented in the Guild;
existing inactive Humans and machine Identities are rejected. The exact Guild name, a reason, and a
per-account Cloudflare rate-limit check are required. Root replacement, outgoing Role assignment,
pending-transfer supersession, code consumption, generation invalidation, and Chronicle disclosure
commit in one transaction. Deferred PostgreSQL constraints reject a forged Root update, partial
completion, history mutation, or missing audit event. The Chronicle records what classes of
information were viewed and what changed, but never records a plaintext code or its hash.

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

Conversations never establish their own access scope. PostgreSQL resolves the current Knowledge,
Work, Decision, Announcement, or Agent Run boundary and applies Membership, Role, Space ancestry,
clearance, visibility, ownership, and explicit-share checks before returning any message body. The
Gatekeeper repeats the subject permission check, so a direct URL or stale browser state cannot keep
a thread visible after the subject becomes restricted. Stored Conversation boundaries are audit
snapshots only.

Only active Humans with current subject access can be mentioned. Mention eligibility and Inbox
fan-out are set-based and reject Agent, Service, inactive, wrong-Space, and insufficient-clearance
identities. Messages cannot be edited. Human moderators can lock or unlock a thread and redact a
message only with a reason and an exact optimistic version. PostgreSQL requires a newer matching
Chronicle event for each state change, which prevents replay of an older audit event. Normal reads
replace a redacted body with `null`; non-moderators also receive no redaction reason or actor.
Chronicle stores a SHA-256 digest and mention count for a post, not its plaintext.

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

Security-critical Root mutations additionally set `app.actor_identity_id` transaction-locally.
Their database triggers compare that actor with the current active human Root Owner instead of
trusting a caller-supplied `updated_by_identity_id` column.

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
- Secrets are never valid deployment JSONC values. Purchaser metadata belongs in ignored
  `deployment.local.jsonc` or an absolute encrypted external configuration, not the tracked
  template.
- Live deployment validates all required secrets before the first Worker update, transfers only the
  required values through mode-`0600` temporary files, deletes them after use, and removes them from
  child-process environments.
- Logs must not contain prompts, tokens, connection strings, private content, or unrestricted event
  payloads.

## Write-path threat model

| Threat | Control | Residual risk / response |
| --- | --- | --- |
| Forged Human or Agent ID | IDs come from account capability or permission-filtered discovery; PostgreSQL reloads active Identity and Membership | Rehearse Access and account-capability recovery in production |
| Accidental or racing first-owner claim | Initialization requires trusted Workshop admin context, exact Guild-name confirmation, and a Guild-scoped PostgreSQL advisory transaction lock | A wrongly configured Workshop admin list can still authorize the wrong human; keep Access and admin policy single-person until acceptance |
| Governance metadata enumeration by a nonmember | Discriminated bootstrap responses omit Root, Constitution, transfer, and Agent data before usable Membership | Configured Guild name and purpose remain visible to authenticated Workshop accounts by design |
| Requester-to-Agent privilege escalation | Agent, requester, Workflow, and Connector permission intersection at plan and execution | Incorrect Role design can still grant intended but excessive authority; audit Roles |
| Unauthorized context leakage | SQL filters Role, Space, clearance, visibility, and sharing before model context | External model/provider policy remains purchaser-owned |
| Agent-selected URL / SSRF | Fixed immutable HTTPS URL, strict-public fetch, credential/query/hash rejection, and manual redirect handling that rejects every 3xx response | DNS ownership and receiver security remain purchaser responsibilities |
| Duplicate external effect | Atomic run claim, one outbound attempt, immutable idempotency key, receiver-side durable deduplication | Lost responses are ambiguous; use receiver audit and an explicit compensating run |
| Stale approval | Approval expiry plus execution-time state and authority recheck | A remote effect already accepted cannot be revoked |
| Workflow or API outage | Transactional outbox, bounded backoff, exhausted-attempt terminal failure and Chronicle event | Operators must restore Cloudflare service and create a new approved run |
| Kill/offboarding race | Database-first Kill, outbox cancellation, Workflow termination, late-delivery Chronicle event | In-flight network bytes may win; execute the receiver's compensating operation |
| Secret disclosure | Wrangler secret, no config/log/prompt storage, HMAC verification | Rotate receiver and Worker secret, provision a new Connector ID, kill old runs |
| Prompt injection in Knowledge | Canonical-only, permission-filtered context; model output cannot bypass policy or approval | Humans must inspect Level 2 action payloads before approval |
| Stolen Root session attempts silent handover | Immutable expiring proposal plus acceptance by the named active Human in a separate account session | A compromise of both Human accounts still requires incident recovery and credential rotation |
| Lost Root and administrator access | Offline 192-bit one-time codes, purchaser custody, rate limit, exact confirmation, atomic generation invalidation, and mandatory Chronicle | Loss of every offline code requires purchaser-controlled infrastructure recovery; the seller has no bypass |
| Stolen or replayed recovery code | SHA-256-only storage, current-generation pointer, one-time consumption, whole-generation invalidation, expiry, and generic failures | A thief with both a current code and an allowed Cloudflare OS account can recover; use split offline custody and short Access policy scope |
| Comment leaks after subject access changes | Every read resolves and filters the current subject boundary before returning message bodies | Previously viewed content remains in a Human's memory or local browser history; use appropriate classification and endpoint cache headers |
| Silent comment editing or moderation | Append-only messages, redaction-only state changes, exact versions, and a newer transaction-paired Chronicle event | Redacted source bodies remain in PostgreSQL until the purchaser's retention process removes them under policy |

## Known security gates

Before a production release, complete and verify:

- Keep Level 3 actions disabled until a reauthentication-capable, multi-approver connector is added
- External Access/session recovery rehearsal in the deployed environment
- Break Glass custody, use, alert review, and post-database-restore rotation rehearsal
- Backup restore rehearsal
- Receiver-side signature, replay-window, and durable idempotency smoke

The bundled reference receiver provides the last control with exact-byte Web Crypto verification
and one SQLite-backed Durable Object per Guild/idempotency-key pair. It stores no signing secret in
its receipt and exposes no public receipt-list endpoint.
