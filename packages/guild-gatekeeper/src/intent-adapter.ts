import {
  CLASSIFICATIONS,
  PERMISSIONS,
  VISIBILITIES,
  GuildDomainError,
  approvalRequirement,
  authorize,
  authorizeAgent,
  isAuthorized,
  type AuthorizationSnapshot,
  type ChronicleEvent,
  type Constitution,
  type JsonObject,
  type JsonValue,
  type Permission,
  type RiskLevel,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildCollectiveRepository,
  GuildDecisionRepository,
  GuildIntentRepository,
  loadActorAuthorizationSnapshot,
  loadAgentAuthorizationSnapshot,
  withGuildTransaction,
  type ClaimIntentActionInput,
  type ClaimIntentActionResult,
  type CompleteIntentActionInput,
  type CreateIntentProposalInput,
  type CreateIntentProposalResult,
  type FailIntentActionInput,
  type IntentActionInput,
  type IntentProposalAccess,
  type IntentProposalDetail,
  type ReconcileAgentIntentActionInput,
  type ReconcileAgentIntentActionResult,
  type RequeueIntentActionInput,
  type StageAgentIntentActionInput,
  type StoredIntentAction,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import { GuildAgentService } from "./agent-service.js";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import {
  createConfiguredIntentPlanner,
  GuildIntentService,
  IntentActionExecutionError,
  type ActIntentOutcome,
  type IntentActivityPort,
  type IntentActAuthority,
  type IntentAgentPort,
  type IntentAuthorityPort,
  type IntentDecisionPort,
  type IntentExecutionPorts,
  type IntentMemoryPort,
  type IntentPlanAuthority,
  type IntentPortInput,
  type IntentProposalStore,
  type IntentResourceResult,
  type PlanFromAskInput,
  type PlannedActionAuthorizationInput,
} from "./intent-service.js";
import type {
  ActIntentRequest,
  ActIntentResponse,
  AskGuildResponse,
  AssignActivityRequest,
  CreateActivityRequest,
  CreateDecisionRequest,
  CreateIntentPlanRequest,
  CreateIntentPlanResponse,
  CreateMemoryRequest,
  UiIntentAction,
  UiIntentProposal,
} from "./management-types.js";

const ACTION_PERMISSION = {
  "memory.propose": "memory.create",
  "activity.create": "activity.create",
  "activity.assign": "activity.assign",
  "decision.propose": "decision.propose",
  "agent.run": "agent.run",
} as const satisfies Record<StoredIntentAction["kind"], Permission>;

const TERMINAL_PROPOSAL_STATUSES = new Set(["completed", "rejected", "failed", "expired"]);
const ACTIVE_ACTOR_STATES = new Set(["joined", "active"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ActorAccessRow {
  actor_status: "active" | "disabled";
  membership_state: string;
  operational: boolean;
  actor_updated_at: string;
  membership_updated_at: string;
}

interface NamedActorRow {
  id: string;
  display_name: string;
}

interface NamedActivityRow {
  id: string;
  title: string;
}

export interface IntentProposalUiContext {
  constitution: Constitution;
  actorNames: ReadonlyMap<string, string>;
  activityNames: ReadonlyMap<string, string>;
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new Error("Cannot canonicalize a non-JSON value.");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sha256Hex(value: string): Promise<string> {
  return [...await sha256(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deterministicUuid(namespace: string, label: string): Promise<string> {
  const bytes = await sha256(`${namespace}:${label}`);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stringArray(value: JsonValue | undefined, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function actionSpace(action: IntentActionInput | StoredIntentAction): string | null {
  switch (action.kind) {
    case "memory.propose": return action.action.spaceId;
    case "activity.create": return action.action.spaceId;
    case "activity.assign": return null;
    case "decision.propose": return action.action.spaceId;
    case "agent.run": return action.action.spaceId;
  }
}

function boundaryFromRequest(
  guildId: string,
  actorId: string,
  resourceId: string,
  spaceId: string | null,
  request: JsonObject,
  allowedField: "allowedActorIds" | "allowedIdentityIds",
): SecuredResource {
  const visibility = requiredString(request.visibility, "Intent visibility");
  const classification = requiredString(request.classification, "Intent classification");
  if (!(VISIBILITIES as readonly string[]).includes(visibility) ||
      !(CLASSIFICATIONS as readonly string[]).includes(classification)) {
    throw new Error("Intent security boundary is invalid.");
  }
  const allowedIdentityIds = stringArray(request[allowedField], "Intent access list");
  return {
    id: resourceId,
    guildId,
    spaceId,
    ownerIdentityId: actorId,
    visibility: visibility as SecuredResource["visibility"],
    classification: classification as SecuredResource["classification"],
    allowedIdentityIds,
  };
}

function memoryResource(
  guildId: string,
  actorId: string,
  resourceId: string,
  request: CreateMemoryRequest,
): SecuredResource {
  return {
    id: resourceId,
    guildId,
    spaceId: request.spaceId,
    ownerIdentityId: actorId,
    visibility: request.visibility,
    classification: request.classification,
    allowedIdentityIds: request.allowedActorIds,
  };
}

function activityResource(
  guildId: string,
  actorId: string,
  resourceId: string,
  request: CreateActivityRequest,
): SecuredResource {
  return {
    id: resourceId,
    guildId,
    spaceId: request.spaceId,
    ownerIdentityId: actorId,
    visibility: request.visibility,
    classification: request.classification,
    allowedIdentityIds: request.allowedActorIds,
  };
}

function decisionResource(
  guildId: string,
  actorId: string,
  resourceId: string,
  request: CreateDecisionRequest,
): SecuredResource {
  return {
    id: resourceId,
    guildId,
    spaceId: request.spaceId,
    ownerIdentityId: actorId,
    visibility: request.visibility,
    classification: request.classification,
    allowedIdentityIds: request.allowedIdentityIds,
  };
}

function storedActionResource(
  guildId: string,
  actorId: string,
  action: Exclude<StoredIntentAction, { kind: "activity.assign" }>,
): SecuredResource {
  switch (action.kind) {
    case "memory.propose":
      return boundaryFromRequest(
        guildId,
        actorId,
        action.action.memoryId,
        action.action.spaceId,
        action.action.request,
        "allowedActorIds",
      );
    case "activity.create":
      return boundaryFromRequest(
        guildId,
        actorId,
        action.action.activityId,
        action.action.spaceId,
        action.action.request,
        "allowedActorIds",
      );
    case "decision.propose":
      return boundaryFromRequest(
        guildId,
        actorId,
        action.action.decisionId,
        action.action.spaceId,
        action.action.request,
        "allowedIdentityIds",
      );
    case "agent.run":
      return boundaryFromRequest(
        guildId,
        actorId,
        action.action.agentRunId,
        action.action.spaceId,
        action.action.request,
        "allowedIdentityIds",
      );
  }
}

function securedActivity(guildId: string, activity: Awaited<ReturnType<GuildCollectiveRepository["getActivity"]>>): SecuredResource {
  return {
    id: activity.id,
    guildId,
    spaceId: activity.spaceId,
    ownerIdentityId: activity.ownerActorId,
    visibility: activity.visibility,
    classification: activity.classification,
    allowedIdentityIds: activity.allowedActorIds,
  };
}

async function actorAccess(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
): Promise<ActorAccessRow | null> {
  return (await connection.query<ActorAccessRow>(
    `SELECT actor.status AS actor_status, membership.state AS membership_state,
            membership.operational, actor.updated_at::text AS actor_updated_at,
            membership.updated_at::text AS membership_updated_at
       FROM actors actor
       JOIN actor_memberships membership
         ON membership.actor_id = actor.id AND membership.guild_id = $1
      WHERE actor.id = $2 AND actor.home_guild_id = $1`,
    [guildId, actorId],
  )).rows[0] ?? null;
}

function permissionsFor(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  resource: SecuredResource,
): Permission[] {
  return PERMISSIONS.filter((permission) => isAuthorized(snapshot, {
    actorIdentityId: actorId,
    permission,
    resource,
  }));
}

async function authorityRevision(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  access: ActorAccessRow | null,
  resource: SecuredResource,
): Promise<string> {
  return sha256Hex(canonicalJson({
    actorId,
    actorStatus: access?.actor_status ?? "missing",
    membershipState: access?.membership_state ?? "missing",
    operational: access?.operational ?? false,
    actorUpdatedAt: access?.actor_updated_at ?? null,
    membershipUpdatedAt: access?.membership_updated_at ?? null,
    constitutionVersion: snapshot.constitution.version,
    constitutionUpdatedAt: snapshot.constitution.updatedAt,
    resource,
    bindings: snapshot.roleBindings
      .filter((binding) => binding.identityId === actorId)
      .map((binding) => ({ roleId: binding.roleId, spaceId: binding.spaceId }))
      .sort((left, right) => `${left.roleId}:${left.spaceId}`.localeCompare(`${right.roleId}:${right.spaceId}`)),
    roles: snapshot.roles.map((role) => ({ id: role.id, permissions: [...role.permissions].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }));
}

async function actionResource(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  action: StoredIntentAction,
): Promise<SecuredResource> {
  if (action.kind !== "activity.assign") return storedActionResource(guildId, actorId, action);
  const activity = await new GuildCollectiveRepository(connection, guildId)
    .getActivity(action.action.activityId);
  return securedActivity(guildId, activity);
}

async function assertActorIds(
  connection: GuildTransactionConnection,
  guildId: string,
  actorIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(actorIds)];
  if (unique.length === 0) return;
  const count = (await connection.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM actor_memberships
      WHERE guild_id = $1 AND actor_id = ANY($2::uuid[])`,
    [guildId, unique],
  )).rows[0]?.count ?? 0;
  if (count !== unique.length) throw new Error("One or more Actors do not belong to this Guild.");
}

async function assertMemorySources(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  memoryIds: readonly string[],
): Promise<void> {
  const repository = new GuildCollectiveRepository(connection, guildId);
  for (const memoryId of memoryIds) {
    const memory = await repository.getMemory(memoryId);
    const resource = {
      id: memory.id,
      guildId,
      spaceId: memory.spaceId,
      ownerIdentityId: memory.ownerActorId,
      visibility: memory.visibility,
      classification: memory.classification,
      allowedIdentityIds: memory.allowedActorIds,
    } satisfies SecuredResource;
    const snapshot = await loadActorAuthorizationSnapshot(connection, guildId, actorId, memory.spaceId);
    authorize(snapshot, { actorIdentityId: actorId, permission: "memory.read", resource });
  }
}

async function assertDecisionReferences(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  allowedIdentityIds: readonly string[],
  sourceIds: readonly string[],
): Promise<void> {
  if (allowedIdentityIds.length > 0) {
    const count = (await connection.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM identities
        WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
      [guildId, allowedIdentityIds],
    )).rows[0]?.count ?? 0;
    if (count !== allowedIdentityIds.length) {
      throw new Error("A shared Decision Identity is not active in this Guild.");
    }
  }
  if (sourceIds.length === 0) return;
  const rows = (await connection.query<{
    id: string;
    space_id: string | null;
    owner_identity_id: string;
    visibility: SecuredResource["visibility"];
    classification: SecuredResource["classification"];
    allowed_identity_ids: string[];
  }>(
    `SELECT id::text, space_id::text, owner_identity_id::text, visibility,
            classification, allowed_identity_ids::text[]
       FROM knowledge WHERE guild_id = $1 AND id = ANY($2::uuid[])`,
    [guildId, sourceIds],
  )).rows;
  if (rows.length !== sourceIds.length) throw new Error("A Decision source was not found in this Guild.");
  for (const row of rows) {
    const resource: SecuredResource = {
      id: row.id,
      guildId,
      spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id,
      visibility: row.visibility,
      classification: row.classification,
      allowedIdentityIds: row.allowed_identity_ids,
    };
    const snapshot = await loadActorAuthorizationSnapshot(connection, guildId, actorId, row.space_id);
    authorize(snapshot, { actorIdentityId: actorId, permission: "knowledge.read", resource });
  }
}

function intentEvent(
  input: Pick<IntentPortInput<unknown>, "guildId" | "actorId" | "proposalId" | "position" | "idempotencyKey">,
  action: string,
  subjectType: string,
  subjectId: string,
  resource: SecuredResource,
): ChronicleEvent {
  return makeChronicleEvent(
    input.guildId,
    input.actorId,
    action,
    subjectType,
    subjectId,
    {
      proposalId: input.proposalId,
      position: input.position,
      idempotencyKey: input.idempotencyKey,
      source: "intent-act",
    },
    resource,
  );
}

function intentResourceResult(resourceId: string, result: JsonObject): IntentResourceResult {
  return { resourceId, result };
}

class PostgresIntentProposalStore implements IntentProposalStore {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  async findProposal(id: string, access: IntentProposalAccess): Promise<IntentProposalDetail | null> {
    try {
      return await withGuildTransaction(
        this.#env.HYPERDRIVE.connectionString,
        this.#env.GUILD_ID,
        (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
          .getProposal(id, access),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "Plan proposal was not found for the current Actor.") {
        return null;
      }
      throw error;
    }
  }

  createProposal(input: CreateIntentProposalInput): Promise<CreateIntentProposalResult> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .createProposal(input),
    );
  }

  claimNextAction(input: ClaimIntentActionInput): Promise<ClaimIntentActionResult> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .claimNextAction(input),
    );
  }

  requeueAction(input: RequeueIntentActionInput): Promise<StoredIntentAction> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .requeueAction(input),
    );
  }

  succeedAction(input: CompleteIntentActionInput): Promise<IntentProposalDetail> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .succeedAction(input),
    );
  }

  failAction(input: FailIntentActionInput): Promise<IntentProposalDetail> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .failAction(input),
    );
  }

  stageAgentAction(input: StageAgentIntentActionInput): Promise<StoredIntentAction> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .stageAgentAction(input),
    );
  }

  reconcileStagedAgentRun(
    input: ReconcileAgentIntentActionInput,
  ): Promise<ReconcileAgentIntentActionResult> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .reconcileStagedAgentRun(input),
    );
  }
}

class PostgresIntentAuthorityPort implements IntentAuthorityPort {
  readonly #env: GuildEnv;
  readonly #actorId: string;
  readonly #confirmedProposalId: string | null;

  constructor(env: GuildEnv, actorId: string, confirmedProposalId: string | null) {
    this.#env = env;
    this.#actorId = actorId;
    this.#confirmedProposalId = confirmedProposalId;
  }

  loadPlanAuthority(input: PlanFromAskInput): Promise<IntentPlanAuthority> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#actorId,
          input.spaceId,
        );
        const access = await actorAccess(connection, this.#env.GUILD_ID, this.#actorId);
        const resource: SecuredResource = {
          id: input.requestId,
          guildId: this.#env.GUILD_ID,
          spaceId: input.spaceId,
          ownerIdentityId: this.#actorId,
          visibility: input.spaceId === null ? "guild" : "space",
          classification: "internal",
          allowedIdentityIds: [],
        };
        return {
          revision: await authorityRevision(snapshot, this.#actorId, access, resource),
          guildId: this.#env.GUILD_ID,
          actorId: this.#actorId,
          actorActive: access?.actor_status === "active" &&
            ACTIVE_ACTOR_STATES.has(access.membership_state),
          membershipOperational: access?.operational === true,
          permissions: permissionsFor(snapshot, this.#actorId, resource),
          spaceIds: input.spaceId === null ? [] : [input.spaceId],
          constitutionVersion: snapshot.constitution.version,
          capturedAt: new Date().toISOString(),
        };
      },
    );
  }

  async authorizePlannedAction(input: PlannedActionAuthorizationInput): Promise<boolean> {
    try {
      return await withGuildTransaction(
        this.#env.HYPERDRIVE.connectionString,
        this.#env.GUILD_ID,
        async (connection) => {
          const stored = {
            ...input.action,
            guildId: this.#env.GUILD_ID,
            proposalId: crypto.randomUUID(),
            position: 0,
            status: "pending",
            attemptCount: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            resourceType: null,
            resourceId: null,
            agentRunId: null,
            result: null,
            errorSummary: null,
            version: 1,
            startedAt: null,
            finishedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as StoredIntentAction;
          const resource = await actionResource(
            connection,
            this.#env.GUILD_ID,
            this.#actorId,
            stored,
          );
          const snapshot = await loadActorAuthorizationSnapshot(
            connection,
            this.#env.GUILD_ID,
            this.#actorId,
            resource.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#actorId,
            permission: ACTION_PERMISSION[input.action.kind],
            resource,
          });
          if (input.action.kind === "agent.run") {
            const agentSnapshot = await loadAgentAuthorizationSnapshot(
              connection,
              this.#env.GUILD_ID,
              input.action.action.agentActorId,
              this.#actorId,
              resource.spaceId,
            );
            const workflowPermissions = new Set(
              stringArray(input.action.action.request.workflowPermissions, "Agent workflow permissions") as Permission[],
            );
            authorizeAgent(agentSnapshot, {
              agentIdentityId: input.action.action.agentActorId,
              requesterIdentityId: this.#actorId,
              permission: "agent.run",
              workflowPermissions: new Set([...workflowPermissions, "agent.run"]),
              connectorPermissions: new Set([...workflowPermissions, "agent.run"]),
              resource,
            });
          }
          return true;
        },
      );
    } catch (error) {
      if (error instanceof GuildDomainError) return false;
      throw error;
    }
  }

  loadActAuthority(input: {
    proposal: IntentProposalDetail;
    action: StoredIntentAction;
    actorId: string;
  }): Promise<IntentActAuthority> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const resource = await actionResource(
          connection,
          this.#env.GUILD_ID,
          this.#actorId,
          input.action,
        );
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#actorId,
          resource.spaceId,
        );
        const access = await actorAccess(connection, this.#env.GUILD_ID, this.#actorId);
        const revision = await authorityRevision(snapshot, this.#actorId, access, resource);
        let actionAuthorized = isAuthorized(snapshot, {
          actorIdentityId: this.#actorId,
          permission: ACTION_PERMISSION[input.action.kind],
          resource,
        });
        if (input.action.kind === "agent.run") {
          const row = (await connection.query<{ active: boolean }>(
            `SELECT true AS active FROM actors actor
              JOIN actor_memberships membership
                ON membership.guild_id = $1 AND membership.actor_id = actor.id
              JOIN actor_agent_profiles profile
                ON profile.guild_id = $1 AND profile.actor_id = actor.id
             WHERE actor.id = $2 AND actor.status = 'active'
               AND membership.operational = true
               AND membership.state IN ('joined', 'active')
               AND profile.status = 'active'`,
            [this.#env.GUILD_ID, input.action.action.agentActorId],
          )).rows[0];
          actionAuthorized = actionAuthorized && row?.active === true;
        }
        const confirmed = this.#confirmedProposalId === input.proposal.id;
        return {
          revision,
          guildId: this.#env.GUILD_ID,
          actorId: this.#actorId,
          actorActive: access?.actor_status === "active" &&
            ACTIVE_ACTOR_STATES.has(access.membership_state),
          membershipOperational: access?.operational === true,
          permissions: permissionsFor(snapshot, this.#actorId, resource),
          spaceIds: resource.spaceId === null ? [] : [resource.spaceId],
          constitutionVersion: snapshot.constitution.version,
          actionAuthorized,
          approval: confirmed ? {
            proposalId: input.proposal.id,
            requestHash: input.proposal.requestHash,
            status: "approved",
            approvedRiskLevel: input.action.riskLevel,
            constitutionVersion: snapshot.constitution.version,
            revision,
            expiresAt: input.proposal.expiresAt,
          } : null,
        };
      },
    );
  }
}

class PostgresIntentMemoryPort implements IntentMemoryPort {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  propose(input: IntentPortInput<CreateMemoryRequest>): Promise<IntentResourceResult> {
    return withGuildTransaction<IntentResourceResult>(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.idempotencyKey]);
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const resource = memoryResource(this.#env.GUILD_ID, input.actorId, input.resourceId, input.request);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.actorId,
          input.request.spaceId,
        );
        authorize(snapshot, { actorIdentityId: input.actorId, permission: "memory.create", resource });
        await assertActorIds(connection, this.#env.GUILD_ID, input.request.allowedActorIds);
        await assertMemorySources(connection, this.#env.GUILD_ID, input.actorId, input.request.sourceIds);
        const existingRow = (await connection.query<{ origin_custody: "guild" | "personal" }>(
          "SELECT origin_custody FROM memories WHERE guild_id = $1 AND id = $2",
          [this.#env.GUILD_ID, input.resourceId],
        )).rows[0];
        if (existingRow) {
          const memory = await repository.getMemory(input.resourceId, true);
          const exact = memory.ownerActorId === input.actorId && memory.spaceId === input.request.spaceId &&
            memory.type === input.request.type && memory.visibility === input.request.visibility &&
            memory.classification === input.request.classification &&
            sameJson(memory.allowedActorIds, input.request.allowedActorIds) &&
            sameJson(memory.sourceIds, input.request.sourceIds) &&
            memory.confidence === input.request.confidence &&
            existingRow.origin_custody === input.request.custody &&
            memory.layer === input.request.layer && sameJson(memory.provenance, input.request.provenance) &&
            memory.lastVerifiedAt === input.request.lastVerifiedAt &&
            sameJson(memory.title, input.request.title) && sameJson(memory.summary, input.request.summary) &&
            sameJson(memory.body, input.request.body);
          if (!exact) {
            throw new IntentActionExecutionError(
              "idempotency_conflict",
              "The immutable Memory ID already contains different content.",
              false,
            );
          }
          return intentResourceResult(input.resourceId, { created: false, replayed: true });
        }
        if (input.request.layer === "canonical") {
          throw new IntentActionExecutionError("invalid_memory_layer", "Plan cannot write Canonical Memory.", false);
        }
        await repository.createMemory({
          ...input.request,
          layer: input.request.layer,
          id: input.resourceId,
          actorId: input.actorId,
          ownerActorId: input.actorId,
          chronicleEvent: intentEvent(input, "intent.memory.proposed", "memory", input.resourceId, resource),
        });
        return intentResourceResult(input.resourceId, { created: true, layer: input.request.layer });
      },
    );
  }
}

class PostgresIntentActivityPort implements IntentActivityPort {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  create(input: IntentPortInput<CreateActivityRequest>): Promise<IntentResourceResult> {
    return withGuildTransaction<IntentResourceResult>(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.idempotencyKey]);
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const resource = activityResource(this.#env.GUILD_ID, input.actorId, input.resourceId, input.request);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.actorId,
          input.request.spaceId,
        );
        authorize(snapshot, { actorIdentityId: input.actorId, permission: "activity.create", resource });
        await assertActorIds(
          connection,
          this.#env.GUILD_ID,
          input.request.assigneeActorId === null
            ? input.request.allowedActorIds
            : [...input.request.allowedActorIds, input.request.assigneeActorId],
        );
        await assertMemorySources(connection, this.#env.GUILD_ID, input.actorId, input.request.sourceIds);
        if (input.request.parentActivityId !== null) {
          const parent = await repository.getActivity(input.request.parentActivityId);
          authorize(snapshot, {
            actorIdentityId: input.actorId,
            permission: "activity.create",
            resource: securedActivity(this.#env.GUILD_ID, parent),
          });
        }
        const exists = (await connection.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM activities WHERE guild_id = $1 AND id = $2) AS exists",
          [this.#env.GUILD_ID, input.resourceId],
        )).rows[0]?.exists === true;
        if (exists) {
          const activity = await repository.getActivity(input.resourceId, true);
          const exact = activity.ownerActorId === input.actorId &&
            activity.parentActivityId === input.request.parentActivityId &&
            activity.spaceId === input.request.spaceId &&
            activity.assigneeActorId === input.request.assigneeActorId &&
            activity.type === input.request.type && activity.title === input.request.title &&
            activity.description === input.request.description && activity.status === input.request.status &&
            activity.visibility === input.request.visibility &&
            activity.classification === input.request.classification &&
            sameJson(activity.allowedActorIds, input.request.allowedActorIds) &&
            sameJson(activity.sourceIds, input.request.sourceIds) &&
            activity.startsAt === input.request.startsAt && activity.dueAt === input.request.dueAt &&
            activity.position === input.request.position;
          if (!exact) {
            throw new IntentActionExecutionError(
              "idempotency_conflict",
              "The immutable Activity ID already contains different content.",
              false,
            );
          }
          return intentResourceResult(input.resourceId, { created: false, replayed: true });
        }
        await repository.createActivity({
          ...input.request,
          id: input.resourceId,
          actorId: input.actorId,
          ownerActorId: input.actorId,
          chronicleEvent: intentEvent(input, "intent.activity.created", "activity", input.resourceId, resource),
        });
        return intentResourceResult(input.resourceId, { created: true });
      },
    );
  }

  assign(input: IntentPortInput<AssignActivityRequest>): Promise<IntentResourceResult> {
    return withGuildTransaction<IntentResourceResult>(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.idempotencyKey]);
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.resourceId, true);
        const resource = securedActivity(this.#env.GUILD_ID, activity);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.actorId,
          activity.spaceId,
        );
        authorize(snapshot, { actorIdentityId: input.actorId, permission: "activity.assign", resource });
        if (input.request.assigneeActorId !== null) {
          await assertActorIds(connection, this.#env.GUILD_ID, [input.request.assigneeActorId]);
        }
        const priorExecution = (await connection.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM chronicle_events
              WHERE guild_id = $1 AND action = 'intent.activity.assigned'
                AND subject_type = 'activity' AND subject_id = $2
                AND details->>'idempotencyKey' = $3
           ) AS exists`,
          [this.#env.GUILD_ID, input.resourceId, input.idempotencyKey],
        )).rows[0]?.exists === true;
        if (priorExecution && activity.assigneeActorId === input.request.assigneeActorId) {
          return intentResourceResult(input.resourceId, {
            version: activity.version,
            replayed: true,
          });
        }
        if (priorExecution) {
          throw new IntentActionExecutionError(
            "idempotency_conflict",
            "The completed Activity assignment no longer matches its durable result.",
            false,
          );
        }
        if (activity.version !== input.request.expectedVersion) {
          throw new IntentActionExecutionError(
            "activity_version_changed",
            "Activity changed after the Plan was created.",
            false,
          );
        }
        const version = await repository.assignActivity({
          ...input.request,
          actorId: input.actorId,
          chronicleEvent: intentEvent(input, "intent.activity.assigned", "activity", input.resourceId, resource),
        });
        return intentResourceResult(input.resourceId, { version, replayed: false });
      },
    );
  }
}

class PostgresIntentDecisionPort implements IntentDecisionPort {
  readonly #env: GuildEnv;

  constructor(env: GuildEnv) {
    this.#env = env;
  }

  async propose(input: IntentPortInput<CreateDecisionRequest>): Promise<IntentResourceResult> {
    const optionIds = await Promise.all(input.request.options.map((_option, position) =>
      deterministicUuid(input.resourceId, `option:${position}`)));
    return withGuildTransaction<IntentResourceResult>(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.idempotencyKey]);
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const resource = decisionResource(this.#env.GUILD_ID, input.actorId, input.resourceId, input.request);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.actorId,
          input.request.spaceId,
        );
        authorize(snapshot, { actorIdentityId: input.actorId, permission: "decision.propose", resource });
        await assertDecisionReferences(
          connection,
          this.#env.GUILD_ID,
          input.actorId,
          input.request.allowedIdentityIds,
          input.request.sourceIds,
        );
        const options = input.request.options.map((option, position) => ({
          id: optionIds[position]!,
          label: option.label,
          description: option.description,
          position,
        }));
        const exists = (await connection.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM decisions WHERE guild_id = $1 AND id = $2) AS exists",
          [this.#env.GUILD_ID, input.resourceId],
        )).rows[0]?.exists === true;
        if (exists) {
          const detail = await repository.getDetail(input.resourceId);
          const decision = detail.decision;
          const exact = decision.ownerIdentityId === input.actorId &&
            decision.spaceId === input.request.spaceId &&
            decision.method === (input.request.method ?? "custodian") &&
            decision.title === input.request.title && decision.description === input.request.description &&
            decision.rationale === input.request.rationale &&
            decision.visibility === input.request.visibility &&
            decision.classification === input.request.classification &&
            sameJson(decision.allowedIdentityIds, input.request.allowedIdentityIds) &&
            sameJson(decision.sourceIds, input.request.sourceIds) &&
            decision.reviewAt === input.request.reviewAt && sameJson(detail.options.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
              position: option.position,
            })), options) && decision.status !== "draft";
          if (!exact) {
            throw new IntentActionExecutionError(
              "idempotency_conflict",
              "The immutable Decision ID already contains different content.",
              false,
            );
          }
          return intentResourceResult(input.resourceId, {
            created: false,
            replayed: true,
            status: decision.status,
          });
        }
        await repository.createDecision({
          ...input.request,
          id: input.resourceId,
          options,
          actorIdentityId: input.actorId,
          ownerIdentityId: input.actorId,
          chronicleEvent: intentEvent(input, "intent.decision.created", "decision", input.resourceId, resource),
        });
        const version = await repository.propose({
          id: input.resourceId,
          expectedVersion: 1,
          actorIdentityId: input.actorId,
          requiredApprovals: snapshot.constitution.level2ApprovalQuorum,
          chronicleEvent: intentEvent(input, "intent.decision.proposed", "decision", input.resourceId, resource),
        });
        return intentResourceResult(input.resourceId, {
          created: true,
          status: "proposed",
          version,
        });
      },
    );
  }
}

class ServiceIntentAgentPort implements IntentAgentPort {
  readonly #service: GuildAgentService;

  constructor(env: GuildEnv, actorId: string) {
    this.#service = new GuildAgentService(env, actorId);
  }

  createGovernedRun(input: Parameters<IntentAgentPort["createGovernedRun"]>[0]): Promise<string> {
    return this.#service.createGovernedRun(input);
  }
}

function executionPorts(env: GuildEnv, actorId: string): IntentExecutionPorts {
  return {
    memory: new PostgresIntentMemoryPort(env),
    activity: new PostgresIntentActivityPort(env),
    decision: new PostgresIntentDecisionPort(env),
    agent: new ServiceIntentAgentPort(env, actorId),
  };
}

export function intentEvidenceFromAsk(response: AskGuildResponse): PlanFromAskInput["ask"]["evidence"] {
  return response.citations.map((citation) => ({
    sourceType: citation.resourceType,
    sourceId: citation.memoryId ?? citation.resourceId,
    label: citation.title,
    metadata: {
      resourceId: citation.resourceId,
      memoryId: citation.memoryId,
      governed: citation.governed,
      version: citation.version,
      spaceId: citation.spaceId,
      summary: citation.summary,
    },
  }));
}

function localizedLabel(value: JsonValue | undefined, locale: string): string | null {
  if (!isRecord(value)) return null;
  const preferred = value[locale];
  if (typeof preferred === "string" && preferred.trim()) return preferred;
  for (const fallback of ["en", "ja", "zh-CN"]) {
    const candidate = value[fallback];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function targetForAction(
  action: StoredIntentAction,
  proposal: IntentProposalDetail,
  context: IntentProposalUiContext,
): Pick<UiIntentAction, "resourceType" | "resourceId" | "resourceLabel" | "agentActorId" | "agentName"> {
  switch (action.kind) {
    case "memory.propose":
      return {
        resourceType: "memory",
        resourceId: action.action.memoryId,
        resourceLabel: localizedLabel(action.action.request.title, proposal.locale) ?? proposal.objective,
        agentActorId: null,
        agentName: null,
      };
    case "activity.create":
      return {
        resourceType: "activity",
        resourceId: action.action.activityId,
        resourceLabel: typeof action.action.request.title === "string"
          ? action.action.request.title
          : proposal.objective,
        agentActorId: null,
        agentName: null,
      };
    case "activity.assign":
      return {
        resourceType: "activity",
        resourceId: action.action.activityId,
        resourceLabel: context.activityNames.get(action.action.activityId) ?? proposal.objective,
        agentActorId: action.action.assigneeActorId,
        agentName: action.action.assigneeActorId === null
          ? null
          : context.actorNames.get(action.action.assigneeActorId) ?? action.action.assigneeActorId,
      };
    case "decision.propose":
      return {
        resourceType: "decision",
        resourceId: action.action.decisionId,
        resourceLabel: typeof action.action.request.title === "string"
          ? action.action.request.title
          : proposal.objective,
        agentActorId: null,
        agentName: null,
      };
    case "agent.run": {
      const plan = action.action.request.plan;
      const objective = isRecord(plan) && typeof plan.objective === "string"
        ? plan.objective
        : proposal.objective;
      return {
        resourceType: "agent_run",
        resourceId: action.action.agentRunId,
        resourceLabel: objective,
        agentActorId: action.action.agentActorId,
        agentName: context.actorNames.get(action.action.agentActorId) ?? action.action.agentActorId,
      };
    }
  }
}

function actionExecutionDetails(
  action: StoredIntentAction,
  proposal: IntentProposalDetail,
  context: IntentProposalUiContext,
): Pick<UiIntentAction,
  | "executingActorId"
  | "executingActorName"
  | "connectionId"
  | "estimatedCostMinor"
  | "estimatedCostCurrency"
  | "estimatedDurationSeconds"
  | "effectScope"
  | "rollbackKind"
> {
  if (action.kind !== "agent.run") {
    return {
      executingActorId: proposal.createdByActorId,
      executingActorName: context.actorNames.get(proposal.createdByActorId) ?? proposal.createdByActorId,
      connectionId: null,
      estimatedCostMinor: 0,
      estimatedCostCurrency: null,
      estimatedDurationSeconds: null,
      effectScope: "guild",
      rollbackKind: action.kind === "activity.assign" ? "reversible" : "compensating_action",
    };
  }
  const plan = isRecord(action.action.request.plan) ? action.action.request.plan : null;
  const usage = plan && isRecord(plan.estimatedUsage) ? plan.estimatedUsage : null;
  const plannedAction = plan && isRecord(plan.action) ? plan.action : null;
  const plannedKind = plannedAction && typeof plannedAction.kind === "string" ? plannedAction.kind : null;
  const external = plannedKind === "connection_invoke" ||
    plannedKind === "https_webhook" || plannedKind === "federation_publish";
  const estimatedCostMinor = usage && Number.isSafeInteger(usage.budgetMinor) &&
    (usage.budgetMinor as number) >= 0 ? usage.budgetMinor as number : null;
  const estimatedDurationSeconds = usage && Number.isSafeInteger(usage.durationSeconds) &&
    (usage.durationSeconds as number) >= 0 ? usage.durationSeconds as number : null;
  return {
    executingActorId: action.action.agentActorId,
    executingActorName: context.actorNames.get(action.action.agentActorId) ?? action.action.agentActorId,
    connectionId: plan && typeof plan.connectorId === "string" ? plan.connectorId : null,
    estimatedCostMinor,
    estimatedCostCurrency: estimatedCostMinor === null ? null : context.constitution.agentDefaults.currency,
    estimatedDurationSeconds,
    effectScope: external ? "external" : "guild",
    rollbackKind: plannedKind === "memory_search"
      ? "not_applicable"
      : external
        ? "not_automatic"
        : "compensating_action",
  };
}

export function intentProposalForUi(
  proposal: IntentProposalDetail,
  context: IntentProposalUiContext,
  now = new Date(),
): UiIntentProposal {
  const expiredByTime = Date.parse(proposal.expiresAt) <= now.valueOf();
  const actions = proposal.actions.map((action): UiIntentAction => {
    const requirement = action.kind === "agent.run"
      ? approvalRequirement(context.constitution, action.riskLevel)
      : { approvals: 0, reauthenticationRequired: false };
    return {
      position: action.position,
      kind: action.kind,
      riskLevel: action.riskLevel,
      status: action.status,
      attemptCount: action.attemptCount,
      requiredPermission: ACTION_PERMISSION[action.kind],
      explicitConfirmationRequired: true,
      durableHumanApprovals: requirement.approvals,
      reauthenticationRequired: requirement.reauthenticationRequired,
      ...targetForAction(action, proposal, context),
      ...actionExecutionDetails(action, proposal, context),
      result: action.result,
      errorSummary: action.errorSummary,
      startedAt: action.startedAt,
      finishedAt: action.finishedAt,
    };
  });
  return {
    id: proposal.id,
    objective: proposal.objective,
    locale: proposal.locale,
    spaceId: proposal.spaceId,
    status: expiredByTime && !TERMINAL_PROPOSAL_STATUSES.has(proposal.status)
      ? "expired"
      : proposal.status,
    maximumRiskLevel: proposal.maximumRiskLevel,
    evidence: proposal.evidence,
    actions,
    nextActionPosition: actions.find((action) =>
      ["pending", "processing", "staged"].includes(action.status))?.position ?? null,
    canAct: !expiredByTime && !TERMINAL_PROPOSAL_STATUSES.has(proposal.status),
    expiresAt: proposal.expiresAt,
    completedAt: proposal.completedAt,
    errorSummary: proposal.errorSummary,
    version: proposal.version,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

function outcomeStatus(outcome: ActIntentOutcome): ActIntentResponse["outcome"] {
  return outcome.status;
}

export class GuildIntentAdapter {
  readonly #env: GuildEnv;
  readonly #actorId: string;

  constructor(env: GuildEnv, actorId: string) {
    assertUuid(env.GUILD_ID, "Guild ID");
    assertUuid(actorId, "Actor ID");
    this.#env = env;
    this.#actorId = actorId;
  }

  async plan(input: CreateIntentPlanRequest, askResponse: AskGuildResponse): Promise<CreateIntentPlanResponse> {
    const availableAgents = await this.#availableAgents(input.spaceId);
    const service = this.#service(null, true);
    const result = await service.planFromAsk({
      mode: "plan",
      requestId: input.requestId,
      guildId: this.#env.GUILD_ID,
      actorId: this.#actorId,
      spaceId: input.spaceId,
      locale: input.locale,
      objective: input.objective,
      ask: {
        query: input.question,
        answer: askResponse.answer,
        evidence: intentEvidenceFromAsk(askResponse),
      },
      availableAgents,
    });
    return {
      created: result.created,
      source: result.source,
      proposal: await this.#toUi(result.proposal),
    };
  }

  async list(): Promise<readonly UiIntentProposal[]> {
    const proposals = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildIntentRepository(connection, this.#env.GUILD_ID);
        const access = { actorId: this.#actorId } satisfies IntentProposalAccess;
        const page = await repository.listProposals(access, null, 20);
        return Promise.all(page.items.map((proposal) => repository.getProposal(proposal.id, access)));
      },
    );
    return Promise.all(proposals.map((proposal) => this.#toUi(proposal)));
  }

  async get(proposalId: string): Promise<UiIntentProposal> {
    assertUuid(proposalId, "Plan proposal ID");
    const proposal = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
        .getProposal(proposalId, { actorId: this.#actorId }),
    );
    return this.#toUi(proposal);
  }

  async act(input: ActIntentRequest): Promise<ActIntentResponse> {
    assertUuid(input.proposalId, "Plan proposal ID");
    if (input.confirmation !== true) throw new Error("Explicit Act confirmation is required.");
    const outcome = await this.#service(input.proposalId, false).actOnce({
      mode: "act",
      guildId: this.#env.GUILD_ID,
      actorId: this.#actorId,
      proposalId: input.proposalId,
    });
    const proposal = "proposal" in outcome
      ? outcome.proposal
      : await withGuildTransaction(
        this.#env.HYPERDRIVE.connectionString,
        this.#env.GUILD_ID,
        (connection) => new GuildIntentRepository(connection, this.#env.GUILD_ID)
          .getProposal(input.proposalId, { actorId: this.#actorId }),
      );
    return {
      outcome: outcomeStatus(outcome),
      position: "position" in outcome ? outcome.position : null,
      errorCode: "errorCode" in outcome ? outcome.errorCode : null,
      proposal: await this.#toUi(proposal),
    };
  }

  #service(confirmedProposalId: string | null, withPlanner: boolean): GuildIntentService {
    return new GuildIntentService(
      new PostgresIntentProposalStore(this.#env),
      new PostgresIntentAuthorityPort(this.#env, this.#actorId, confirmedProposalId),
      executionPorts(this.#env, this.#actorId),
      { planner: withPlanner ? createConfiguredIntentPlanner(this.#env) : null },
    );
  }

  async #availableAgents(spaceId: string | null): Promise<readonly {
    actorId: string;
    displayName: string;
    spaceIds: readonly string[];
  }[]> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const rows = (await connection.query<NamedActorRow>(
          `SELECT actor.id::text, actor.display_name
             FROM actors actor
             JOIN actor_memberships membership
               ON membership.guild_id = $1 AND membership.actor_id = actor.id
             JOIN actor_agent_profiles profile
               ON profile.guild_id = $1 AND profile.actor_id = actor.id
            WHERE actor.kind = 'agent' AND actor.status = 'active'
              AND membership.operational = true
              AND membership.state IN ('joined', 'active')
              AND profile.status = 'active'
            ORDER BY actor.display_name, actor.id
            LIMIT 100`,
          [this.#env.GUILD_ID],
        )).rows;
        const resource: SecuredResource = {
          id: crypto.randomUUID(),
          guildId: this.#env.GUILD_ID,
          spaceId,
          ownerIdentityId: this.#actorId,
          visibility: spaceId === null ? "guild" : "space",
          classification: "internal",
          allowedIdentityIds: [],
        };
        const available: { actorId: string; displayName: string; spaceIds: readonly string[] }[] = [];
        for (const row of rows) {
          try {
            const snapshot = await loadAgentAuthorizationSnapshot(
              connection,
              this.#env.GUILD_ID,
              row.id,
              this.#actorId,
              spaceId,
            );
            if (!isAuthorized(snapshot, {
              actorIdentityId: this.#actorId,
              permission: "agent.run",
              resource,
            }) || !isAuthorized(snapshot, {
              actorIdentityId: row.id,
              permission: "agent.run",
              resource,
            })) continue;
            available.push({
              actorId: row.id,
              displayName: row.display_name,
              spaceIds: spaceId === null ? [] : [spaceId],
            });
          } catch (error) {
            if (!(error instanceof GuildDomainError)) throw error;
          }
        }
        return available;
      },
    );
  }

  async #toUi(proposal: IntentProposalDetail): Promise<UiIntentProposal> {
    const context = await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection): Promise<IntentProposalUiContext> => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#actorId,
          proposal.spaceId,
        );
        const actorIds = [...new Set([proposal.createdByActorId, ...proposal.actions.flatMap((action) => {
          if (action.kind === "agent.run") return [action.action.agentActorId];
          if (action.kind === "activity.assign" && action.action.assigneeActorId !== null) {
            return [action.action.assigneeActorId];
          }
          return [];
        })])];
        const activityIds = [...new Set(proposal.actions
          .filter((action): action is Extract<StoredIntentAction, { kind: "activity.assign" }> =>
            action.kind === "activity.assign")
          .map((action) => action.action.activityId))];
        const actors = actorIds.length === 0 ? [] : (await connection.query<NamedActorRow>(
          `SELECT id::text, display_name FROM actors
            WHERE home_guild_id = $1 AND id = ANY($2::uuid[])`,
          [this.#env.GUILD_ID, actorIds],
        )).rows;
        const activities = activityIds.length === 0 ? [] : (await connection.query<NamedActivityRow>(
          `SELECT id::text, title FROM activities
            WHERE guild_id = $1 AND id = ANY($2::uuid[])`,
          [this.#env.GUILD_ID, activityIds],
        )).rows;
        return {
          constitution: snapshot.constitution,
          actorNames: new Map(actors.map((actor) => [actor.id, actor.display_name])),
          activityNames: new Map(activities.map((activity) => [activity.id, activity.title])),
        };
      },
    );
    return intentProposalForUi(proposal, context);
  }
}
