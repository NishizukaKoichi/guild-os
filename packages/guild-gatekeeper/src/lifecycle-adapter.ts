import {
  ACTOR_MEMBERSHIP_STATES,
  COLLECTIVE_TEMPLATE_KEYS,
  type ActivityType,
  type ActorMembershipState,
  type CollectiveTemplateKey,
} from "@guild-os/domain";
import type { QueryResultRow } from "@guild-os/postgres";
import {
  withGuildTransaction,
  type GuildTransactionConnection,
} from "../../guild-postgres/src/transaction.js";
import {
  buildCanonicalMemoryReconfirmationPlan,
  buildOffboardingPlan,
  buildOnboardingPlan,
  type ActorOnboardingSnapshot,
  type ActorStopResult,
  type CanonicalMemoryAudienceSnapshot,
  type CanonicalMemoryRequirementSource,
  type ConnectionRevocationResult,
  type HandoverCreationResult,
  type InitialActivityRequirementSource,
  type LifecycleActorKind,
  type LifecycleActorSnapshot,
  type LifecycleAtomicScope,
  type LifecycleChronicleEvent,
  type LifecycleRepository,
  type LifecycleRequirement,
  type OnboardingPathRequirementSource,
  type LifecycleTransaction,
  type OffboardingPlan,
  type OffboardingReceipt,
  type OffboardingSeal,
  type OffboardingSnapshot,
} from "./lifecycle-runtime.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATED_PATH_PREFIX = "guild-lifecycle-runtime:v1:";
const MAX_LOCK_KEYS = 100;
const MAX_RECONFIRMATION_AUDIENCE = 1_000;

export interface LifecycleQueryResult<Row extends QueryResultRow> {
  rows: Row[];
  rowCount: number | null;
}

export interface LifecycleSqlConnection {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<LifecycleQueryResult<Row>>;
}

export interface LifecycleDatabase {
  transaction<T>(
    guildId: string,
    operation: (connection: LifecycleSqlConnection) => Promise<T>,
  ): Promise<T>;
}

export interface PostgresLifecycleRuntimeRepositoryOptions {
  connectionString: string;
  guildId: string;
  requesterActorId: string;
  database?: LifecycleDatabase;
}

class ConnectionStringLifecycleDatabase implements LifecycleDatabase {
  readonly #connectionString: string;

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  transaction<T>(
    guildId: string,
    operation: (connection: LifecycleSqlConnection) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#connectionString,
      guildId,
      (connection: GuildTransactionConnection) => operation({
        async query<Row extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<LifecycleQueryResult<Row>> {
          const result = await connection.query<Row>(text, values);
          return { rows: result.rows, rowCount: result.rowCount };
        },
      }),
    );
  }
}

type PermissionSubjectRow = QueryResultRow & {
  kind: string;
  identity_status: string;
  membership_state: string;
  is_root_owner: boolean;
};

type RoleIdRow = QueryResultRow & { role_id: string };
type PermissionRow = QueryResultRow & { permission: string };

async function assertCurrentLifecyclePermission(
  connection: LifecycleSqlConnection,
  guildId: string,
  requesterActorId: string,
): Promise<void> {
  const subject = (await connection.query<PermissionSubjectRow>(
    `/* lifecycle-adapter:permission-subject */
     SELECT identity_row.kind, identity_row.status AS identity_status,
            membership_row.state AS membership_state,
            guild_row.root_owner_identity_id = identity_row.id AS is_root_owner
       FROM guilds guild_row
       JOIN identities identity_row
         ON identity_row.guild_id = guild_row.id AND identity_row.id = $2
       JOIN memberships membership_row
         ON membership_row.guild_id = identity_row.guild_id
        AND membership_row.identity_id = identity_row.id
      WHERE guild_row.id = $1
      FOR KEY SHARE OF guild_row, identity_row, membership_row`,
    [guildId, requesterActorId],
  )).rows[0];
  if (!subject || subject.kind !== "human" || subject.identity_status !== "active" ||
      subject.membership_state !== "active") {
    throw new Error("Lifecycle management requires a current active Human membership.");
  }
  if (subject.is_root_owner) return;

  const roles = (await connection.query<RoleIdRow>(
    `/* lifecycle-adapter:permission-roles */
     SELECT binding.role_id::text
       FROM role_bindings binding
      WHERE binding.guild_id = $1 AND binding.identity_id = $2
        AND binding.space_id IS NULL
      ORDER BY binding.role_id
      FOR KEY SHARE OF binding`,
    [guildId, requesterActorId],
  )).rows;
  if (roles.length === 0) {
    throw new Error("The current Human does not have lifecycle.manage.");
  }
  const permissions = (await connection.query<PermissionRow>(
    `/* lifecycle-adapter:permission-grants */
     SELECT permission.permission
       FROM role_permissions permission
      WHERE permission.guild_id = $1
        AND permission.role_id = ANY($2::uuid[])
        AND permission.permission = 'lifecycle.manage'
      FOR KEY SHARE OF permission`,
    [guildId, roles.map((row) => row.role_id)],
  )).rows;
  if (permissions.length === 0) {
    throw new Error("The current Human does not have lifecycle.manage.");
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertNonBlank(value: string, label: string, maxLength = 500): void {
  if (value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} is invalid.`);
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = unique(left);
  const normalizedRight = unique(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

async function deterministicUuid(namespace: string, value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${namespace}\u0000${value}`),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function actorKind(value: string): LifecycleActorKind {
  if (value !== "human" && value !== "agent") {
    throw new Error("Lifecycle runtime supports only Human and Agent Actors.");
  }
  return value;
}

function membershipState(value: string): ActorMembershipState {
  if (!(ACTOR_MEMBERSHIP_STATES as readonly string[]).includes(value)) {
    throw new Error("Actor membership state is invalid.");
  }
  return value as ActorMembershipState;
}

function templateKey(value: string): CollectiveTemplateKey {
  if (!(COLLECTIVE_TEMPLATE_KEYS as readonly string[]).includes(value)) {
    throw new Error("Collective template key is invalid.");
  }
  return value as CollectiveTemplateKey;
}

function activityType(value: string): ActivityType {
  if (!/^(?:task|project|quest|event|discussion|experiment|study|campaign|ritual|session|creation|maintenance|investigation|goal|step|custom:[a-z0-9][a-z0-9_-]{1,62})$/.test(value)) {
    throw new Error("Activity type is invalid.");
  }
  return value as ActivityType;
}

type ActorRow = QueryResultRow & {
  actor_id: string;
  kind: string;
  actor_status: string;
  membership_state: string;
  membership_operational: boolean;
  template_key: string;
  is_root_owner: boolean;
};

type ActorBindingRow = QueryResultRow & {
  role_id: string;
  space_id: string | null;
};

type MemoryBlueprintRow = QueryResultRow & {
  memory_id: string;
  memory_version: number;
  title: string;
  instructions: string;
  memory_space_id: string | null;
  applicable_role_ids: string[];
};

type ActivityBlueprintRow = QueryResultRow & {
  definition_key: string;
  template_version: number;
  title: string;
  instructions: string;
  activity_type: string;
  target_space_id: string | null;
  applicable_role_ids: string[];
};

type OnboardingPathBlueprintRow = QueryResultRow & {
  path_id: string;
  path_version: number;
  name: string;
  description: string;
  path_space_id: string | null;
  template_key: string | null;
  applicable_role_ids: string[];
};

type OnboardingPathActivityRow = QueryResultRow & {
  path_id: string;
  definition_key: string;
  title: string;
  instructions: string;
  activity_type: string;
  target_space_id: string | null;
};

type ExistingRequirementRow = QueryResultRow & {
  requirement_id: string;
  actor_id: string;
};

type IdRow = QueryResultRow & { id: string };
type ConnectionRow = QueryResultRow & { id: string; auth_kind: string };
type RunRow = QueryResultRow & { id: string; workflow_instance_id: string };
type ResourceRow = QueryResultRow & { resource_id: string; title: string };
type DraftRow = ResourceRow & { resource_type: "memory" | "knowledge" | "decision" };

type ReceiptRow = QueryResultRow & {
  handover_id: string;
  actor_id: string;
  details: Record<string, unknown>;
  occurred_at: string;
  handover_item_count: string;
};

interface LoadedOffboardingState {
  snapshot: OffboardingSnapshot;
  workflowRequestIds: readonly string[];
  runWorkflowInstances: ReadonlyMap<string, string>;
}

function numberDetail(details: Record<string, unknown>, key: string): number {
  const value = details[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Stored lifecycle receipt has invalid ${key}.`);
  }
  return value;
}

function actorKindDetail(details: Record<string, unknown>): LifecycleActorKind {
  const value = details.actorKind;
  if (value !== "human" && value !== "agent") {
    throw new Error("Stored lifecycle receipt has invalid Actor kind.");
  }
  return value;
}

function safeChronicleDetails(event: LifecycleChronicleEvent): Record<string, string | number | boolean | null> {
  const base: Record<string, string | number | boolean | null> = {
    source: "lifecycle-runtime-adapter",
    reasonSupplied: event.reason.trim().length > 0,
  };
  if (event.action === "lifecycle.onboarding.assigned") {
    return {
      ...base,
      actorKind: event.details.actorKind === "agent" ? "agent" : "human",
      templateKey: typeof event.details.templateKey === "string"
        ? event.details.templateKey.slice(0, 100) : "unknown",
      requirementCount: typeof event.details.requirementCount === "number"
        ? event.details.requirementCount : 0,
    };
  }
  if (event.action === "lifecycle.memory.reconfirmation_assigned") {
    return {
      ...base,
      memoryVersion: typeof event.details.memoryVersion === "number"
        ? event.details.memoryVersion : 0,
      targetActorCount: typeof event.details.targetActorCount === "number"
        ? event.details.targetActorCount : 0,
    };
  }
  return {
    ...base,
    actorKind: event.details.actorKind === "agent" ? "agent" : "human",
    successorActorId: typeof event.details.successorActorId === "string"
      ? event.details.successorActorId : null,
    revokedAccessTokenCount: typeof event.details.revokedAccessTokenCount === "number"
      ? event.details.revokedAccessTokenCount : 0,
    revokedConnectorCredentialCount:
      typeof event.details.revokedConnectorCredentialCount === "number"
        ? event.details.revokedConnectorCredentialCount : 0,
    stoppedScheduledRunCount: typeof event.details.stoppedScheduledRunCount === "number"
      ? event.details.stoppedScheduledRunCount : 0,
    killedAgentRunCount: typeof event.details.killedAgentRunCount === "number"
      ? event.details.killedAgentRunCount : 0,
    expiredApprovalCount: typeof event.details.expiredApprovalCount === "number"
      ? event.details.expiredApprovalCount : 0,
    handoverItemCount: typeof event.details.handoverItemCount === "number"
      ? event.details.handoverItemCount : 0,
  };
}

class PostgresLifecycleTransaction implements LifecycleTransaction {
  readonly #connection: LifecycleSqlConnection;
  readonly #guildId: string;
  readonly #requesterActorId: string;
  readonly #loadedActors = new Map<string, LifecycleActorSnapshot>();
  readonly #allowedRequirementKeys = new Set<string>();
  #loadedOffboarding: LoadedOffboardingState | null = null;

  constructor(
    connection: LifecycleSqlConnection,
    guildId: string,
    requesterActorId: string,
  ) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#requesterActorId = requesterActorId;
  }

  async #loadActor(actorId: string, lock: "UPDATE" | "KEY SHARE"): Promise<LifecycleActorSnapshot> {
    assertUuid(actorId, "Actor ID");
    const row = (await this.#connection.query<ActorRow>(
      `/* lifecycle-adapter:actor */
       SELECT actor.id::text AS actor_id, actor.kind, actor.status AS actor_status,
              membership.state AS membership_state,
              membership.operational AS membership_operational,
              settings.template_key,
              guild_row.root_owner_identity_id = actor.id AS is_root_owner
         FROM actors actor
         JOIN actor_memberships membership
           ON membership.guild_id = $1 AND membership.actor_id = actor.id
         JOIN identity_actor_links link
           ON link.guild_id = membership.guild_id AND link.actor_id = actor.id
         JOIN guild_collective_settings settings ON settings.guild_id = membership.guild_id
         JOIN guilds guild_row ON guild_row.id = membership.guild_id
        WHERE actor.id = $2 AND actor.home_guild_id = $1
        FOR ${lock} OF actor, membership`,
      [this.#guildId, actorId],
    )).rows[0];
    if (!row) throw new Error("Lifecycle Actor was not found in this Guild.");
    const bindings = (await this.#connection.query<ActorBindingRow>(
      `/* lifecycle-adapter:actor-bindings */
       SELECT binding.role_id::text, binding.space_id::text
         FROM actor_role_bindings binding
        WHERE binding.guild_id = $1 AND binding.actor_id = $2
        ORDER BY binding.role_id, binding.space_id
        FOR KEY SHARE OF binding`,
      [this.#guildId, actorId],
    )).rows;
    const snapshot: LifecycleActorSnapshot = {
      guildId: this.#guildId,
      actorId: row.actor_id,
      kind: actorKind(row.kind),
      identityOperational: row.actor_status === "active",
      membershipState: membershipState(row.membership_state),
      membershipOperational: row.membership_operational,
      lifecycleEpoch: 1,
      templateKey: templateKey(row.template_key),
      roleBindings: bindings.map((binding) => ({
        roleId: binding.role_id,
        spaceId: binding.space_id,
      })),
      isRootOwner: row.is_root_owner,
    };
    this.#loadedActors.set(actorId, snapshot);
    return snapshot;
  }

  async #existingRequirementKeys(
    requirements: readonly LifecycleRequirement[],
  ): Promise<readonly string[]> {
    if (requirements.length === 0) return [];
    const pathRequirements = requirements.filter(
      (requirement) => requirement.kind === "path_assignment",
    );
    const existingPathRows = pathRequirements.length === 0 ? [] : (await this.#connection.query<{
      path_id: string;
      actor_id: string;
    } & QueryResultRow>(
      `/* lifecycle-adapter:existing-path-assignments */
       SELECT path_id::text, actor_id::text
         FROM onboarding_assignments
        WHERE guild_id = $1 AND actor_id = ANY($2::uuid[]) AND path_id = ANY($3::uuid[])
        FOR KEY SHARE`,
      [
        this.#guildId,
        unique(pathRequirements.map((requirement) => requirement.actorId)),
        unique(pathRequirements.map((requirement) => requirement.pathId)),
      ],
    )).rows;
    const existingPaths = new Set(existingPathRows.map((row) => `${row.path_id}:${row.actor_id}`));
    const generatedRequirements = requirements.filter(
      (requirement) => requirement.kind !== "path_assignment",
    );
    const identities = await Promise.all(generatedRequirements.map(async (requirement) => ({
      requirementId: await deterministicUuid("lifecycle-requirement", requirement.idempotencyKey),
      actorId: requirement.actorId,
      key: requirement.idempotencyKey,
    })));
    const rows = identities.length === 0 ? [] : (await this.#connection.query<ExistingRequirementRow>(
      `/* lifecycle-adapter:existing-requirements */
       SELECT requirement.id::text AS requirement_id, assignment.actor_id::text AS actor_id
         FROM onboarding_requirements requirement
         JOIN onboarding_assignments assignment
           ON assignment.guild_id = requirement.guild_id
          AND assignment.path_id = requirement.path_id
        WHERE requirement.guild_id = $1
          AND requirement.id = ANY($2::uuid[])
        FOR KEY SHARE OF requirement, assignment`,
      [this.#guildId, identities.map((item) => item.requirementId)],
    )).rows;
    const existing = new Set(rows.map((row) => `${row.requirement_id}:${row.actor_id}`));
    return [
      ...pathRequirements
        .filter((requirement) => existingPaths.has(`${requirement.pathId}:${requirement.actorId}`))
        .map((requirement) => requirement.idempotencyKey),
      ...identities
      .filter((item) => existing.has(`${item.requirementId}:${item.actorId}`))
      .map((item) => item.key),
    ];
  }

  async loadActorOnboarding(actorId: string): Promise<ActorOnboardingSnapshot> {
    const actor = await this.#loadActor(actorId, "UPDATE");
    const pathRows = (await this.#connection.query<OnboardingPathBlueprintRow>(
      `/* lifecycle-adapter:onboarding-path-blueprints */
       SELECT path.id::text AS path_id, path.version AS path_version,
              path.name, path.description, path.space_id::text AS path_space_id,
              path.template_key,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM onboarding_paths path
         JOIN guild_collective_settings settings ON settings.guild_id = path.guild_id
        WHERE path.guild_id = $1 AND path.status = 'active'
          AND path.description NOT LIKE $3
          AND (path.template_key IS NULL OR path.template_key = settings.template_key)
          AND EXISTS (SELECT 1 FROM onboarding_requirements requirement
                       WHERE requirement.guild_id = path.guild_id
                         AND requirement.path_id = path.id)
          AND (path.space_id IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (binding.space_id IS NULL OR binding.space_id = path.space_id)
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM onboarding_path_roles scope
             WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
          ) OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
            JOIN onboarding_path_roles scope
              ON scope.guild_id = binding.guild_id AND scope.role_id = binding.role_id
             AND scope.path_id = path.id
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (path.space_id IS NULL OR binding.space_id IS NULL
                    OR binding.space_id = path.space_id)
          ))
        ORDER BY path.id
        FOR KEY SHARE OF path`,
      [this.#guildId, actorId, `${GENERATED_PATH_PREFIX}%`],
    )).rows;
    const pathIds = pathRows.map((row) => row.path_id);
    const pathActivityRows = pathIds.length === 0 ? [] : (await this.#connection.query<
      OnboardingPathActivityRow
    >(
      `/* lifecycle-adapter:onboarding-path-activities */
       SELECT path.id::text AS path_id, requirement.id::text AS definition_key,
              requirement.title, requirement.instructions, source.type AS activity_type,
              COALESCE(path.space_id, source.space_id)::text AS target_space_id
         FROM onboarding_paths path
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
          AND requirement.kind = 'activity'
         JOIN activities source
           ON source.guild_id = requirement.guild_id AND source.id = requirement.resource_id
        WHERE path.guild_id = $1 AND path.id = ANY($2::uuid[])
          AND source.status NOT IN ('cancelled', 'archived')
        ORDER BY path.id, requirement.position, requirement.id
        FOR KEY SHARE OF path, requirement, source`,
      [this.#guildId, pathIds],
    )).rows;
    const onboardingPaths: OnboardingPathRequirementSource[] = pathRows.map((row) => ({
      pathId: row.path_id,
      pathVersion: row.path_version,
      name: row.name,
      description: row.description,
      spaceId: row.path_space_id,
      templateKey: row.template_key === null ? null : templateKey(row.template_key),
      applicability: {
        actorKinds: [actor.kind],
        templateKeys: [],
        roleIds: row.applicable_role_ids,
      },
      initialActivities: pathActivityRows
        .filter((activity) => activity.path_id === row.path_id)
        .map((activity) => ({
          definitionKey: activity.definition_key,
          activityType: activityType(activity.activity_type),
          title: activity.title,
          instructions: activity.instructions,
          targetSpaceId: activity.target_space_id,
        })),
    }));
    const memoryRows = (await this.#connection.query<MemoryBlueprintRow>(
      `/* lifecycle-adapter:onboarding-memory-blueprints */
       SELECT memory.id::text AS memory_id, memory.current_version AS memory_version,
              requirement.title, requirement.instructions,
              memory.space_id::text AS memory_space_id,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM onboarding_paths path
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
          AND requirement.kind = 'memory'
         JOIN memories memory
           ON memory.guild_id = requirement.guild_id AND memory.id = requirement.resource_id
         JOIN guild_collective_settings settings ON settings.guild_id = path.guild_id
        WHERE path.guild_id = $1 AND path.status = 'active'
          AND path.description NOT LIKE $3
          AND (path.template_key IS NULL OR path.template_key = settings.template_key)
          AND memory.status = 'active' AND memory.layer = 'canonical'
          AND memory.governance_state = 'canonical'
          AND (path.space_id IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (binding.space_id IS NULL OR binding.space_id = path.space_id)
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM onboarding_path_roles scope
             WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
          ) OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
            JOIN onboarding_path_roles scope
              ON scope.guild_id = binding.guild_id AND scope.role_id = binding.role_id
             AND scope.path_id = path.id
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (path.space_id IS NULL OR binding.space_id IS NULL
                    OR binding.space_id = path.space_id)
          ))
          AND (memory.space_id IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = memory.guild_id AND binding.actor_id = $2
               AND (binding.space_id IS NULL OR binding.space_id = memory.space_id)
          ))
        ORDER BY memory.id, path.id, requirement.position
        FOR KEY SHARE OF path, requirement, memory`,
      [this.#guildId, actorId, `${GENERATED_PATH_PREFIX}%`],
    )).rows;
    const activityRows = (await this.#connection.query<ActivityBlueprintRow>(
      `/* lifecycle-adapter:onboarding-activity-blueprints */
       SELECT requirement.id::text AS definition_key, path.version AS template_version,
              requirement.title, requirement.instructions,
              source.type AS activity_type,
              COALESCE(path.space_id, source.space_id)::text AS target_space_id,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM onboarding_paths path
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
          AND requirement.kind = 'activity'
         JOIN activities source
           ON source.guild_id = requirement.guild_id AND source.id = requirement.resource_id
         JOIN guild_collective_settings settings ON settings.guild_id = path.guild_id
        WHERE path.guild_id = $1 AND path.status = 'active'
          AND path.description NOT LIKE $3
          AND (path.template_key IS NULL OR path.template_key = settings.template_key)
          AND source.status NOT IN ('cancelled', 'archived')
          AND (COALESCE(path.space_id, source.space_id) IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (binding.space_id IS NULL
                    OR binding.space_id = COALESCE(path.space_id, source.space_id))
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM onboarding_path_roles scope
             WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
          ) OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
            JOIN onboarding_path_roles scope
              ON scope.guild_id = binding.guild_id AND scope.role_id = binding.role_id
             AND scope.path_id = path.id
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = $2
               AND (path.space_id IS NULL OR binding.space_id IS NULL
                    OR binding.space_id = path.space_id)
          ))
        ORDER BY path.id, requirement.position
        FOR KEY SHARE OF path, requirement, source`,
      [this.#guildId, actorId, `${GENERATED_PATH_PREFIX}%`],
    )).rows;
    const canonicalMemories: CanonicalMemoryRequirementSource[] = memoryRows.map((row) => ({
      memoryId: row.memory_id,
      version: row.memory_version,
      title: row.title,
      instructions: row.instructions,
      spaceId: row.memory_space_id,
      status: "active",
      layer: "canonical",
      governanceState: "canonical",
      applicability: {
        actorKinds: [actor.kind],
        templateKeys: [actor.templateKey],
        roleIds: row.applicable_role_ids,
      },
    }));
    const initialActivities: InitialActivityRequirementSource[] = activityRows.map((row) => ({
      definitionKey: row.definition_key,
      templateKey: actor.templateKey,
      templateVersion: row.template_version,
      title: row.title,
      instructions: row.instructions,
      activityType: activityType(row.activity_type),
      spaceId: row.target_space_id,
      applicability: {
        actorKinds: [actor.kind],
        templateKeys: [actor.templateKey],
        roleIds: row.applicable_role_ids,
      },
    }));
    const provisional: ActorOnboardingSnapshot = {
      actor,
      onboardingPaths,
      canonicalMemories,
      initialActivities,
      existingRequirementKeys: [],
    };
    const requirements = buildOnboardingPlan(provisional).requirements;
    requirements.forEach((requirement) => this.#allowedRequirementKeys.add(requirement.idempotencyKey));
    return {
      ...provisional,
      existingRequirementKeys: await this.#existingRequirementKeys(requirements),
    };
  }

  async loadCanonicalMemoryAudience(memoryId: string): Promise<CanonicalMemoryAudienceSnapshot> {
    assertUuid(memoryId, "Memory ID");
    const memoryRow = (await this.#connection.query<MemoryBlueprintRow>(
      `/* lifecycle-adapter:reconfirmation-memory */
       SELECT memory.id::text AS memory_id, memory.current_version AS memory_version,
              requirement.title, requirement.instructions,
              memory.space_id::text AS memory_space_id,
              ARRAY(SELECT scope.role_id::text FROM onboarding_path_roles scope
                     WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
                     ORDER BY scope.role_id) AS applicable_role_ids
         FROM memories memory
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = memory.guild_id
          AND requirement.resource_id = memory.id AND requirement.kind = 'memory'
         JOIN onboarding_paths path
           ON path.guild_id = requirement.guild_id AND path.id = requirement.path_id
        WHERE memory.guild_id = $1 AND memory.id = $2
          AND memory.status = 'active' AND memory.layer = 'canonical'
          AND memory.governance_state = 'canonical'
          AND path.status = 'active' AND path.description NOT LIKE $3
        ORDER BY path.id, requirement.position LIMIT 1
        FOR KEY SHARE OF memory, requirement, path`,
      [this.#guildId, memoryId, `${GENERATED_PATH_PREFIX}%`],
    )).rows[0];
    if (!memoryRow) throw new Error("Canonical Memory has no active onboarding policy.");
    const audienceRows = (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:reconfirmation-audience */
       SELECT DISTINCT actor.id::text
         FROM actors actor
         JOIN actor_memberships membership
           ON membership.guild_id = $1 AND membership.actor_id = actor.id
         JOIN guild_collective_settings settings ON settings.guild_id = membership.guild_id
         JOIN onboarding_paths path
           ON path.guild_id = membership.guild_id AND path.status = 'active'
          AND path.description NOT LIKE $3
          AND (path.template_key IS NULL OR path.template_key = settings.template_key)
         JOIN onboarding_requirements requirement
           ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
          AND requirement.kind = 'memory' AND requirement.resource_id = $2
         JOIN memories memory
           ON memory.guild_id = requirement.guild_id AND memory.id = requirement.resource_id
        WHERE actor.kind IN ('human', 'agent') AND actor.status = 'active'
          AND membership.state IN ('joined', 'active') AND membership.operational
          AND (path.space_id IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = actor.id
               AND (binding.space_id IS NULL OR binding.space_id = path.space_id)
          ))
          AND (NOT EXISTS (
            SELECT 1 FROM onboarding_path_roles scope
             WHERE scope.guild_id = path.guild_id AND scope.path_id = path.id
          ) OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
            JOIN onboarding_path_roles scope
              ON scope.guild_id = binding.guild_id AND scope.role_id = binding.role_id
             AND scope.path_id = path.id
             WHERE binding.guild_id = path.guild_id AND binding.actor_id = actor.id
               AND (path.space_id IS NULL OR binding.space_id IS NULL
                    OR binding.space_id = path.space_id)
          ))
          AND (memory.space_id IS NULL OR EXISTS (
            SELECT 1 FROM actor_role_bindings binding
             WHERE binding.guild_id = memory.guild_id AND binding.actor_id = actor.id
               AND (binding.space_id IS NULL OR binding.space_id = memory.space_id)
          ))
        ORDER BY actor.id LIMIT $4`,
      [this.#guildId, memoryId, `${GENERATED_PATH_PREFIX}%`, MAX_RECONFIRMATION_AUDIENCE + 1],
    )).rows;
    if (audienceRows.length > MAX_RECONFIRMATION_AUDIENCE) {
      throw new Error("Canonical Memory reconfirmation audience exceeds the safe batch limit.");
    }
    const actors: LifecycleActorSnapshot[] = [];
    for (const row of audienceRows) actors.push(await this.#loadActor(row.id, "KEY SHARE"));
    const memorySource: CanonicalMemoryRequirementSource = {
      memoryId: memoryRow.memory_id,
      version: memoryRow.memory_version,
      title: memoryRow.title,
      instructions: memoryRow.instructions,
      spaceId: memoryRow.memory_space_id,
      status: "active",
      layer: "canonical",
      governanceState: "canonical",
      applicability: { actorKinds: [], templateKeys: [], roleIds: [] },
    };
    const provisional: CanonicalMemoryAudienceSnapshot = {
      guildId: this.#guildId,
      memory: memorySource,
      actors,
      existingRequirementKeys: [],
    };
    const requirements = buildCanonicalMemoryReconfirmationPlan(provisional).requirements;
    requirements.forEach((requirement) => this.#allowedRequirementKeys.add(requirement.idempotencyKey));
    return {
      ...provisional,
      existingRequirementKeys: await this.#existingRequirementKeys(requirements),
    };
  }

  async ensureOnboardingRequirements(
    requirements: readonly LifecycleRequirement[],
  ): Promise<readonly string[]> {
    const inserted: string[] = [];
    for (const requirement of requirements) {
      if (requirement.guildId !== this.#guildId ||
          !this.#allowedRequirementKeys.has(requirement.idempotencyKey)) {
        throw new Error("Lifecycle requirement was not derived from the locked policy snapshot.");
      }
      const actor = this.#loadedActors.get(requirement.actorId);
      if (!actor) throw new Error("Lifecycle requirement Actor is not locked in this transaction.");
      assertNonBlank(requirement.title, "Requirement title", 200);
      if (requirement.instructions.length > 10_000) {
        throw new Error("Requirement instructions are too long.");
      }
      if (requirement.kind === "path_assignment") {
        for (const activity of requirement.initialActivities) {
          const activityId = await deterministicUuid(
            "lifecycle-path-activity",
            `${requirement.idempotencyKey}:${activity.definitionKey}`,
          );
          await this.#connection.query(
            `/* lifecycle-adapter:insert-path-initial-activity */
             INSERT INTO activities
               (id, guild_id, space_id, owner_actor_id, creator_actor_id,
                assignee_actor_id, type, title, description, status, visibility,
                classification, allowed_actor_ids, source_ids, position)
             VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8, 'ready',
                     CASE WHEN $3::uuid IS NULL THEN 'guild' ELSE 'space' END,
                     'internal', '{}'::uuid[], '{}'::uuid[], 0)
             ON CONFLICT (id) DO NOTHING`,
            [
              activityId,
              this.#guildId,
              activity.targetSpaceId,
              requirement.actorId,
              this.#requesterActorId,
              activity.activityType,
              activity.title,
              activity.instructions,
            ],
          );
        }
        const assignmentId = await deterministicUuid(
          "lifecycle-path-assignment",
          requirement.idempotencyKey,
        );
        const assignment = await this.#connection.query<IdRow>(
          `/* lifecycle-adapter:insert-path-assignment */
           INSERT INTO onboarding_assignments
             (id, guild_id, actor_id, path_id, manager_actor_id)
           SELECT $1, $2, target.actor_id, path.id, manager.actor_id
             FROM actor_memberships target
             JOIN onboarding_paths path
               ON path.guild_id = target.guild_id AND path.id = $4 AND path.status = 'active'
             JOIN actor_memberships manager ON manager.guild_id = target.guild_id
            WHERE target.guild_id = $2 AND target.actor_id = $3
              AND target.state IN ('joined', 'active') AND target.operational
              AND manager.actor_id = $5 AND manager.state = 'active' AND manager.operational
           ON CONFLICT (guild_id, actor_id, path_id) DO NOTHING
           RETURNING id::text`,
          [assignmentId, this.#guildId, requirement.actorId, requirement.pathId,
            this.#requesterActorId],
        );
        if ((assignment.rowCount ?? 0) === 1) {
          inserted.push(requirement.idempotencyKey);
          continue;
        }
        const existing = (await this.#connection.query<IdRow>(
          `/* lifecycle-adapter:verify-path-assignment */
           SELECT id::text FROM onboarding_assignments
            WHERE guild_id = $1 AND actor_id = $2 AND path_id = $3`,
          [this.#guildId, requirement.actorId, requirement.pathId],
        )).rows[0];
        if (!existing) {
          throw new Error("Lifecycle path assignment was not inserted or already present.");
        }
        continue;
      }
      const pathId = await deterministicUuid("lifecycle-path", requirement.idempotencyKey);
      const requirementId = await deterministicUuid("lifecycle-requirement", requirement.idempotencyKey);
      const assignmentId = await deterministicUuid("lifecycle-assignment", requirement.idempotencyKey);
      const resourceId = requirement.kind === "memory_confirmation"
        ? requirement.memoryId
        : await deterministicUuid("lifecycle-activity", requirement.idempotencyKey);
      if (requirement.kind === "initial_activity") {
        await this.#connection.query(
          `/* lifecycle-adapter:insert-initial-activity */
           INSERT INTO activities
             (id, guild_id, space_id, owner_actor_id, creator_actor_id,
              assignee_actor_id, type, title, description, status, visibility,
              classification, allowed_actor_ids, source_ids, position)
           VALUES ($1, $2, $3, $4, $5, $4, $6, $7, $8, 'ready',
                   CASE WHEN $3::uuid IS NULL THEN 'guild' ELSE 'space' END,
                   'internal', '{}'::uuid[], '{}'::uuid[], 0)
           ON CONFLICT (id) DO NOTHING`,
          [
            resourceId,
            this.#guildId,
            requirement.targetSpaceId,
            requirement.actorId,
            this.#requesterActorId,
            requirement.activityType,
            requirement.title,
            requirement.instructions,
          ],
        );
      }
      const policyVersion = requirement.kind === "memory_confirmation"
        ? requirement.memoryVersion : requirement.templateVersion;
      await this.#connection.query(
        `/* lifecycle-adapter:insert-generated-path */
         INSERT INTO onboarding_paths
           (id, guild_id, space_id, template_key, name, description,
            created_by_actor_id, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          pathId,
          this.#guildId,
          requirement.targetSpaceId,
          actor.templateKey,
          requirement.title,
          `${GENERATED_PATH_PREFIX}${pathId}`,
          this.#requesterActorId,
          policyVersion,
        ],
      );
      await this.#connection.query(
        `/* lifecycle-adapter:insert-generated-requirement */
         INSERT INTO onboarding_requirements
           (id, guild_id, path_id, kind, resource_id, title,
            instructions, required, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 0)
         ON CONFLICT (id) DO NOTHING`,
        [
          requirementId,
          this.#guildId,
          pathId,
          requirement.kind === "memory_confirmation" ? "memory" : "activity",
          resourceId,
          requirement.title,
          requirement.instructions,
        ],
      );
      const assignment = await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:insert-generated-assignment */
         INSERT INTO onboarding_assignments
           (id, guild_id, actor_id, path_id, manager_actor_id)
         SELECT $1, $2, target.actor_id, $4, manager.actor_id
           FROM actor_memberships target
           JOIN actor_memberships manager ON manager.guild_id = target.guild_id
          WHERE target.guild_id = $2 AND target.actor_id = $3
            AND target.state IN ('joined', 'active') AND target.operational
            AND manager.actor_id = $5 AND manager.state = 'active' AND manager.operational
         ON CONFLICT (guild_id, actor_id, path_id) DO NOTHING
         RETURNING id::text`,
        [assignmentId, this.#guildId, requirement.actorId, pathId, this.#requesterActorId],
      );
      if ((assignment.rowCount ?? 0) === 1) {
        inserted.push(requirement.idempotencyKey);
        continue;
      }
      const existing = (await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:verify-generated-assignment */
         SELECT id::text FROM onboarding_assignments
          WHERE guild_id = $1 AND actor_id = $2 AND path_id = $3`,
        [this.#guildId, requirement.actorId, pathId],
      )).rows[0];
      if (!existing) {
        throw new Error("Onboarding assignment could not be created for the current Actor state.");
      }
    }
    return inserted.sort();
  }

  async loadOffboarding(
    actorId: string,
    successorActorId: string | null,
  ): Promise<OffboardingSnapshot> {
    if (actorId === this.#requesterActorId) {
      throw new Error("A lifecycle administrator cannot offboard their current session.");
    }
    const actor = await this.#loadActor(actorId, "UPDATE");
    const successor = successorActorId === null
      ? null : await this.#loadActor(successorActorId, "KEY SHARE");
    const connections = (await this.#connection.query<ConnectionRow>(
      `/* lifecycle-adapter:offboarding-connections */
       SELECT id::text, auth_kind FROM connectors
        WHERE guild_id = $1 AND owner_identity_id = $2 AND status <> 'revoked'
        ORDER BY id FOR UPDATE`,
      [this.#guildId, actorId],
    )).rows;
    const schedules = (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:offboarding-schedules */
       SELECT id::text FROM automation_rules
        WHERE guild_id = $1 AND status = 'active'
          AND (agent_actor_id = $2 OR created_by_actor_id = $2)
        ORDER BY id FOR UPDATE`,
      [this.#guildId, actorId],
    )).rows.map((row) => row.id);
    const workflowRequests = (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:offboarding-workflow-requests */
       SELECT request.id::text
         FROM workflow_run_requests request
        WHERE request.guild_id = $1
          AND request.status IN ('queued', 'planning', 'running')
          AND (request.agent_actor_id = $2 OR request.requested_by_actor_id = $2
               OR request.automation_rule_id = ANY($3::uuid[]))
        ORDER BY request.id FOR UPDATE`,
      [this.#guildId, actorId, schedules],
    )).rows.map((row) => row.id);
    const runs = (await this.#connection.query<RunRow>(
      `/* lifecycle-adapter:offboarding-agent-runs */
       SELECT run.id::text, run.workflow_instance_id
         FROM agent_runs run
         LEFT JOIN connectors connector
           ON connector.guild_id = run.guild_id AND connector.id = run.connector_id
        WHERE run.guild_id = $1
          AND run.status IN ('planning', 'awaiting_approval', 'running')
          AND (run.agent_identity_id = $2 OR run.requester_identity_id = $2
               OR connector.owner_identity_id = $2)
        ORDER BY run.id FOR UPDATE OF run`,
      [this.#guildId, actorId],
    )).rows;
    const runIds = runs.map((row) => row.id);
    const approvals = runIds.length === 0 ? [] : (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:offboarding-approvals */
       SELECT id::text FROM approval_requests
        WHERE guild_id = $1 AND agent_run_id = ANY($2::uuid[]) AND status = 'pending'
        ORDER BY id FOR UPDATE`,
      [this.#guildId, runIds],
    )).rows.map((row) => row.id);
    const activities = (await this.#connection.query<ResourceRow>(
      `/* lifecycle-adapter:offboarding-activities */
       SELECT id::text AS resource_id, title
         FROM activities
        WHERE guild_id = $1 AND (owner_actor_id = $2 OR assignee_actor_id = $2)
          AND status NOT IN ('completed', 'cancelled', 'archived')
        ORDER BY id FOR UPDATE`,
      [this.#guildId, actorId],
    )).rows;
    const files = (await this.#connection.query<ResourceRow>(
      `/* lifecycle-adapter:offboarding-files */
       SELECT id::text AS resource_id, original_name AS title
         FROM files
        WHERE guild_id = $1 AND owner_identity_id = $2 AND status <> 'deleted'
        ORDER BY id FOR UPDATE`,
      [this.#guildId, actorId],
    )).rows;
    const memoryDrafts = (await this.#connection.query<DraftRow>(
      `/* lifecycle-adapter:offboarding-memory-drafts */
       SELECT memory.id::text AS resource_id, 'memory'::text AS resource_type,
              COALESCE(version.title ->> 'en', version.title ->> 'ja',
                       version.title ->> 'zh-CN', 'Memory draft') AS title
         FROM memories memory
         JOIN memory_versions version
           ON version.guild_id = memory.guild_id AND version.memory_id = memory.id
          AND version.version = memory.current_version
        WHERE memory.guild_id = $1 AND memory.owner_actor_id = $2
          AND memory.workflow = 'canonical'
          AND memory.governance_state IN ('draft', 'proposed')
        ORDER BY memory.id
        FOR UPDATE OF memory, version`,
      [this.#guildId, actorId],
    )).rows;
    const knowledgeDrafts = (await this.#connection.query<DraftRow>(
      `/* lifecycle-adapter:offboarding-knowledge-drafts */
       SELECT knowledge.id::text AS resource_id,
              'knowledge'::text AS resource_type,
              COALESCE(version.title ->> 'en', version.title ->> 'ja',
                       version.title ->> 'zh-CN', 'Knowledge draft') AS title
         FROM knowledge
         JOIN knowledge_versions version
           ON version.guild_id = knowledge.guild_id AND version.knowledge_id = knowledge.id
          AND version.version = knowledge.current_version
        WHERE knowledge.guild_id = $1 AND knowledge.owner_identity_id = $2
          AND knowledge.state IN ('draft', 'proposed')
        ORDER BY knowledge.id
        FOR UPDATE OF knowledge, version`,
      [this.#guildId, actorId],
    )).rows;
    const decisionDrafts = (await this.#connection.query<DraftRow>(
      `/* lifecycle-adapter:offboarding-decision-drafts */
       SELECT decision.id::text AS resource_id,
              'decision'::text AS resource_type, decision.title AS title
         FROM decisions decision
        WHERE decision.guild_id = $1 AND decision.owner_identity_id = $2
          AND decision.status IN ('draft', 'proposed')
        ORDER BY decision.id
        FOR UPDATE OF decision`,
      [this.#guildId, actorId],
    )).rows;
    const drafts = [...memoryDrafts, ...knowledgeDrafts, ...decisionDrafts]
      .sort((left, right) => left.resource_type.localeCompare(right.resource_type) ||
        left.resource_id.localeCompare(right.resource_id));
    const snapshot: OffboardingSnapshot = {
      actor,
      successor,
      accessTokenIds: connections
        .filter((connection) => connection.auth_kind === "access_token")
        .map((connection) => connection.id),
      connectorCredentialIds: connections
        .filter((connection) => connection.auth_kind !== "access_token")
        .map((connection) => connection.id),
      scheduledRunIds: schedules,
      activeAgentRunIds: runIds,
      pendingApprovalIds: approvals,
      openActivities: activities.map((resource) => ({
        resourceId: resource.resource_id,
        title: resource.title,
      })),
      ownedFiles: files.map((resource) => ({
        resourceId: resource.resource_id,
        title: resource.title,
      })),
      governedDrafts: drafts.map((resource) => ({
        resourceId: resource.resource_id,
        title: resource.title,
        resourceType: resource.resource_type,
      })),
    };
    this.#loadedOffboarding = {
      snapshot,
      workflowRequestIds: workflowRequests,
      runWorkflowInstances: new Map(runs.map((run) => [run.id, run.workflow_instance_id])),
    };
    return snapshot;
  }

  async #assertOffboardingPlan(plan: OffboardingPlan): Promise<LoadedOffboardingState> {
    const loaded = this.#loadedOffboarding;
    if (!loaded) throw new Error("Offboarding resources were not locked in this transaction.");
    const expected = buildOffboardingPlan(loaded.snapshot);
    if (plan.operationKey !== expected.operationKey || plan.guildId !== this.#guildId ||
        plan.actorId !== expected.actorId || plan.actorKind !== expected.actorKind ||
        plan.successorActorId !== expected.successorActorId ||
        !sameIds(plan.accessTokenIds, expected.accessTokenIds) ||
        !sameIds(plan.connectorCredentialIds, expected.connectorCredentialIds) ||
        !sameIds(plan.scheduledRunIds, expected.scheduledRunIds) ||
        !sameIds(plan.activeAgentRunIds, expected.activeAgentRunIds) ||
        !sameIds(plan.pendingApprovalIds, expected.pendingApprovalIds) ||
        !sameIds(
          plan.handoverItems.map((item) => item.idempotencyKey),
          expected.handoverItems.map((item) => item.idempotencyKey),
        )) {
      throw new Error("Offboarding plan does not match the locked PostgreSQL snapshot.");
    }
    return loaded;
  }

  async findOffboardingReceipt(operationKey: string): Promise<OffboardingReceipt | null> {
    assertNonBlank(operationKey, "Offboarding operation key");
    const handoverId = await deterministicUuid("lifecycle-handover", operationKey);
    const chronicleId = await deterministicUuid("lifecycle-chronicle", `chronicle:${operationKey}`);
    const row = (await this.#connection.query<ReceiptRow>(
      `/* lifecycle-adapter:find-offboarding-receipt */
       SELECT handover.id::text AS handover_id,
              handover.departing_actor_id::text AS actor_id,
              event.details, event.occurred_at::text,
              count(item.id)::text AS handover_item_count
         FROM handover_cases handover
         JOIN chronicle_events event
           ON event.guild_id = handover.guild_id AND event.id = $3
          AND event.action = 'lifecycle.actor.offboarded'
          AND event.subject_id = handover.departing_actor_id
         LEFT JOIN handover_items item
           ON item.guild_id = handover.guild_id AND item.case_id = handover.id
        WHERE handover.guild_id = $1 AND handover.id = $2
        GROUP BY handover.id, event.details, event.occurred_at`,
      [this.#guildId, handoverId, chronicleId],
    )).rows[0];
    if (!row) return null;
    return {
      operationKey,
      guildId: this.#guildId,
      actorId: row.actor_id,
      actorKind: actorKindDetail(row.details),
      handoverId: row.handover_id,
      handoverItemCount: Number(row.handover_item_count),
      revokedAccessTokenCount: numberDetail(row.details, "revokedAccessTokenCount"),
      revokedConnectorCredentialCount: numberDetail(
        row.details,
        "revokedConnectorCredentialCount",
      ),
      stoppedScheduledRunCount: numberDetail(row.details, "stoppedScheduledRunCount"),
      killedAgentRunCount: numberDetail(row.details, "killedAgentRunCount"),
      expiredApprovalCount: numberDetail(row.details, "expiredApprovalCount"),
      completedAt: row.occurred_at,
    };
  }

  async stopActorAccess(plan: OffboardingPlan): Promise<ActorStopResult> {
    await this.#assertOffboardingPlan(plan);
    const membership = await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:stop-membership */
       UPDATE memberships
          SET state = 'departed', departed_at = COALESCE(departed_at, now())
        WHERE guild_id = $1 AND identity_id = $2
          AND state IN ('preboarding', 'active', 'suspended')
       RETURNING identity_id::text AS id`,
      [this.#guildId, plan.actorId],
    );
    const identity = await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:stop-identity */
       UPDATE identities SET status = 'disabled'
        WHERE guild_id = $1 AND id = $2 AND status = 'active'
       RETURNING id::text`,
      [this.#guildId, plan.actorId],
    );
    if ((membership.rowCount ?? 0) !== 1 || (identity.rowCount ?? 0) !== 1) {
      throw new Error("Identity or Membership access changed before offboarding committed.");
    }
    let agentProfileStopped = false;
    if (plan.actorKind === "agent") {
      const profile = await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:stop-agent-profile */
         UPDATE agent_profiles SET status = 'stopped', updated_at = now()
          WHERE guild_id = $1 AND identity_id = $2 AND status = 'active'
         RETURNING identity_id::text AS id`,
        [this.#guildId, plan.actorId],
      );
      agentProfileStopped = (profile.rowCount ?? 0) === 1;
    }
    return { identityStopped: true, membershipStopped: true, agentProfileStopped };
  }

  async revokeActorConnections(plan: OffboardingPlan): Promise<ConnectionRevocationResult> {
    await this.#assertOffboardingPlan(plan);
    const expectedIds = unique([...plan.accessTokenIds, ...plan.connectorCredentialIds]);
    if (expectedIds.length === 0) return { accessTokenIds: [], connectorCredentialIds: [] };
    const rows = (await this.#connection.query<ConnectionRow>(
      `/* lifecycle-adapter:revoke-connections */
       UPDATE connectors
          SET status = 'revoked', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND owner_identity_id = $2
          AND id = ANY($3::uuid[]) AND status <> 'revoked'
       RETURNING id::text, auth_kind`,
      [this.#guildId, plan.actorId, expectedIds],
    )).rows;
    return {
      accessTokenIds: rows
        .filter((row) => row.auth_kind === "access_token")
        .map((row) => row.id),
      connectorCredentialIds: rows
        .filter((row) => row.auth_kind !== "access_token")
        .map((row) => row.id),
    };
  }

  async stopActorSchedules(plan: OffboardingPlan): Promise<readonly string[]> {
    const loaded = await this.#assertOffboardingPlan(plan);
    const stopped = plan.scheduledRunIds.length === 0 ? [] : (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:stop-schedules */
       UPDATE automation_rules
          SET status = 'paused', version = version + 1, updated_at = now()
        WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'
       RETURNING id::text`,
      [this.#guildId, plan.scheduledRunIds],
    )).rows.map((row) => row.id);
    if (loaded.workflowRequestIds.length > 0) {
      const cancelled = (await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:cancel-workflow-requests */
         UPDATE workflow_run_requests
            SET status = 'cancelled', finished_at = now(), updated_at = now(),
                lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL,
                error_message = 'Cancelled because a related Actor left the Guild.'
          WHERE guild_id = $1 AND id = ANY($2::uuid[])
            AND status IN ('queued', 'planning', 'running')
         RETURNING id::text`,
        [this.#guildId, loaded.workflowRequestIds],
      )).rows.map((row) => row.id);
      if (!sameIds(cancelled, loaded.workflowRequestIds)) {
        throw new Error("Not every active Workflow request was cancelled.");
      }
    }
    return stopped;
  }

  async killActorRuns(plan: OffboardingPlan): Promise<readonly string[]> {
    const loaded = await this.#assertOffboardingPlan(plan);
    if (plan.activeAgentRunIds.length === 0) return [];
    const killed = (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:kill-agent-runs */
       UPDATE agent_runs
          SET status = 'killed', kill_requested_at = now(), finished_at = now(),
              error_message = 'Killed because a related Actor left the Guild.',
              version = version + 1
        WHERE guild_id = $1 AND id = ANY($2::uuid[])
          AND status IN ('planning', 'awaiting_approval', 'running')
       RETURNING id::text`,
      [this.#guildId, plan.activeAgentRunIds],
    )).rows.map((row) => row.id);
    await this.#connection.query(
      `/* lifecycle-adapter:cancel-agent-outbox */
       UPDATE outbox SET status = 'cancelled', completed_at = now(), locked_at = NULL,
                         updated_at = now()
        WHERE guild_id = $1 AND status IN ('pending', 'processing')
          AND topic IN ('agent.workflow.start', 'agent.workflow.signal')
          AND payload ->> 'runId' = ANY($2::text[])`,
      [this.#guildId, plan.activeAgentRunIds],
    );
    for (const runId of plan.activeAgentRunIds) {
      const workflowInstanceId = loaded.runWorkflowInstances.get(runId);
      if (!workflowInstanceId) throw new Error("Agent Run Workflow instance was not locked.");
      await this.#connection.query(
        `/* lifecycle-adapter:enqueue-agent-termination */
         INSERT INTO outbox
           (id, guild_id, topic, payload, idempotency_key, status)
         VALUES ($1, $2, 'agent.workflow.terminate', $3::jsonb, $4, 'pending')
         ON CONFLICT (guild_id, idempotency_key) DO NOTHING`,
        [
          await deterministicUuid("lifecycle-agent-termination", runId),
          this.#guildId,
          JSON.stringify({ runId, workflowInstanceId }),
          `agent-workflow-terminate:${runId}`,
        ],
      );
    }
    await this.#connection.query(
      `/* lifecycle-adapter:cancel-agent-delegations */
       UPDATE agent_delegations SET status = 'cancelled', updated_at = now()
        WHERE guild_id = $1
          AND (parent_run_id = ANY($2::uuid[]) OR child_run_id = ANY($2::uuid[]))
          AND status IN ('proposed', 'approved', 'running')`,
      [this.#guildId, plan.activeAgentRunIds],
    );
    return killed;
  }

  async expireActorApprovals(plan: OffboardingPlan): Promise<readonly string[]> {
    await this.#assertOffboardingPlan(plan);
    if (plan.pendingApprovalIds.length === 0) return [];
    return (await this.#connection.query<IdRow>(
      `/* lifecycle-adapter:expire-approvals */
       UPDATE approval_requests SET status = 'expired', updated_at = now()
        WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'pending'
       RETURNING id::text`,
      [this.#guildId, plan.pendingApprovalIds],
    )).rows.map((row) => row.id);
  }

  async createHandover(plan: OffboardingPlan): Promise<HandoverCreationResult> {
    await this.#assertOffboardingPlan(plan);
    const handoverId = await deterministicUuid("lifecycle-handover", plan.operationKey);
    await this.#connection.query(
      `/* lifecycle-adapter:create-handover */
       INSERT INTO handover_cases
         (id, guild_id, departing_actor_id, successor_actor_id,
          initiated_by_actor_id, reason)
       VALUES ($1, $2, $3, $4, $5,
               'Actor lifecycle access was revoked; review every explicit handover item.')
       ON CONFLICT (id) DO NOTHING`,
      [handoverId, this.#guildId, plan.actorId, plan.successorActorId, this.#requesterActorId],
    );
    const createdKeys: string[] = [];
    for (const item of plan.handoverItems) {
      const itemId = await deterministicUuid("lifecycle-handover-item", item.idempotencyKey);
      const inserted = await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:create-handover-item */
         INSERT INTO handover_items
           (id, guild_id, case_id, resource_type, resource_id, title, disposition, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '')
         ON CONFLICT (guild_id, case_id, resource_type, resource_id) DO NOTHING
         RETURNING id::text`,
        [
          itemId,
          this.#guildId,
          handoverId,
          item.resourceType,
          item.resourceId,
          item.title,
          item.disposition,
        ],
      );
      if ((inserted.rowCount ?? 0) === 1) {
        createdKeys.push(item.idempotencyKey);
        continue;
      }
      const existing = (await this.#connection.query<IdRow>(
        `/* lifecycle-adapter:verify-handover-item */
         SELECT id::text FROM handover_items
          WHERE guild_id = $1 AND case_id = $2 AND resource_type = $3 AND resource_id = $4`,
        [this.#guildId, handoverId, item.resourceType, item.resourceId],
      )).rows[0];
      if (!existing) throw new Error("Explicit handover item could not be persisted.");
      createdKeys.push(item.idempotencyKey);
    }
    if (plan.successorActorId !== null) {
      await this.#connection.query(
        `/* lifecycle-adapter:transfer-open-activities */
         UPDATE activities
            SET owner_actor_id = CASE WHEN owner_actor_id = $2 THEN $3 ELSE owner_actor_id END,
                assignee_actor_id = CASE WHEN assignee_actor_id = $2 THEN $3 ELSE assignee_actor_id END,
                version = version + 1, updated_at = now()
          WHERE guild_id = $1 AND (owner_actor_id = $2 OR assignee_actor_id = $2)
            AND status NOT IN ('completed', 'cancelled', 'archived')`,
        [this.#guildId, plan.actorId, plan.successorActorId],
      );
    }
    return { handoverId, itemKeys: createdKeys.sort() };
  }

  async inspectOffboardingSeal(actorId: string): Promise<OffboardingSeal> {
    assertUuid(actorId, "Actor ID");
    const row = (await this.#connection.query<QueryResultRow & {
      identity_operational: boolean;
      membership_operational: boolean;
      agent_operational: boolean;
      active_access_tokens: string;
      active_connector_credentials: string;
      active_schedules: string;
      active_agent_runs: string;
      pending_approvals: string;
    }>(
      `/* lifecycle-adapter:offboarding-seal */
       SELECT
         EXISTS (SELECT 1 FROM identities identity_row
                  WHERE identity_row.guild_id = $1 AND identity_row.id = $2
                    AND identity_row.status = 'active')
           OR EXISTS (SELECT 1 FROM actors actor
                       WHERE actor.home_guild_id = $1 AND actor.id = $2
                         AND actor.status = 'active') AS identity_operational,
         EXISTS (SELECT 1 FROM memberships membership
                  WHERE membership.guild_id = $1 AND membership.identity_id = $2
                    AND membership.state IN ('preboarding', 'active'))
           OR EXISTS (SELECT 1 FROM actor_memberships membership
                       WHERE membership.guild_id = $1 AND membership.actor_id = $2
                         AND membership.operational) AS membership_operational,
         EXISTS (SELECT 1 FROM agent_profiles profile
                  WHERE profile.guild_id = $1 AND profile.identity_id = $2
                    AND profile.status = 'active')
           OR EXISTS (SELECT 1 FROM actor_agent_profiles profile
                       WHERE profile.guild_id = $1 AND profile.actor_id = $2
                         AND profile.status = 'active') AS agent_operational,
         (SELECT count(*)::text FROM connectors connection
           WHERE connection.guild_id = $1 AND connection.owner_identity_id = $2
             AND connection.auth_kind = 'access_token' AND connection.status <> 'revoked')
           AS active_access_tokens,
         (SELECT count(*)::text FROM connectors connection
           WHERE connection.guild_id = $1 AND connection.owner_identity_id = $2
             AND connection.auth_kind <> 'access_token' AND connection.status <> 'revoked')
           AS active_connector_credentials,
         ((SELECT count(*) FROM automation_rules rule
            WHERE rule.guild_id = $1 AND rule.status = 'active'
              AND (rule.agent_actor_id = $2 OR rule.created_by_actor_id = $2))
          + (SELECT count(*) FROM workflow_run_requests request
              WHERE request.guild_id = $1
                AND request.status IN ('queued', 'planning', 'running')
                AND (request.agent_actor_id = $2 OR request.requested_by_actor_id = $2)))::text
           AS active_schedules,
         (SELECT count(*)::text FROM agent_runs run
           LEFT JOIN connectors connection
             ON connection.guild_id = run.guild_id AND connection.id = run.connector_id
          WHERE run.guild_id = $1 AND run.status IN ('planning', 'awaiting_approval', 'running')
            AND (run.agent_identity_id = $2 OR run.requester_identity_id = $2
                 OR connection.owner_identity_id = $2)) AS active_agent_runs,
         (SELECT count(*)::text FROM approval_requests approval
           JOIN agent_runs run
             ON run.guild_id = approval.guild_id AND run.id = approval.agent_run_id
           LEFT JOIN connectors connection
             ON connection.guild_id = run.guild_id AND connection.id = run.connector_id
          WHERE approval.guild_id = $1 AND approval.status = 'pending'
            AND (run.agent_identity_id = $2 OR run.requester_identity_id = $2
                 OR connection.owner_identity_id = $2)) AS pending_approvals`,
      [this.#guildId, actorId],
    )).rows[0];
    if (!row) throw new Error("Offboarding closure proof could not be loaded.");
    return {
      identityOperational: row.identity_operational,
      membershipOperational: row.membership_operational,
      agentOperational: row.agent_operational,
      activeAccessTokenCount: Number(row.active_access_tokens),
      activeConnectorCredentialCount: Number(row.active_connector_credentials),
      activeScheduledRunCount: Number(row.active_schedules),
      activeAgentRunCount: Number(row.active_agent_runs),
      pendingApprovalCount: Number(row.pending_approvals),
    };
  }

  async appendChronicle(event: LifecycleChronicleEvent): Promise<void> {
    if (event.guildId !== this.#guildId || event.actorId !== this.#requesterActorId) {
      throw new Error("Lifecycle Chronicle event crosses the locked Guild or actor boundary.");
    }
    assertUuid(event.subjectId, "Chronicle subject ID");
    if (Number.isNaN(Date.parse(event.occurredAt))) {
      throw new Error("Lifecycle Chronicle occurrence time is invalid.");
    }
    const eventId = await deterministicUuid("lifecycle-chronicle", event.idempotencyKey);
    const correlationId = UUID_PATTERN.test(event.correlationId)
      ? event.correlationId
      : await deterministicUuid("lifecycle-correlation", event.correlationId);
    const details = safeChronicleDetails(event);
    const inserted = await this.#connection.query<QueryResultRow & {
      action: string;
      subject_id: string;
    }>(
      `/* lifecycle-adapter:append-chronicle */
       INSERT INTO chronicle_events
         (id, guild_id, actor_identity_id, action, subject_type, subject_id,
          correlation_id, occurred_at, details, space_id, owner_identity_id,
          visibility, classification, allowed_identity_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
               NULL, $3, 'guild', 'restricted', '{}'::uuid[])
       ON CONFLICT (guild_id, id) DO NOTHING
       RETURNING action, subject_id::text`,
      [
        eventId,
        this.#guildId,
        this.#requesterActorId,
        event.action,
        event.subjectType,
        event.subjectId,
        correlationId,
        event.occurredAt,
        JSON.stringify(details),
      ],
    );
    if ((inserted.rowCount ?? 0) === 1) return;
    const existing = (await this.#connection.query<QueryResultRow & {
      action: string;
      subject_id: string;
    }>(
      `/* lifecycle-adapter:verify-chronicle */
       SELECT action, subject_id::text FROM chronicle_events
        WHERE guild_id = $1 AND id = $2`,
      [this.#guildId, eventId],
    )).rows[0];
    if (!existing || existing.action !== event.action || existing.subject_id !== event.subjectId) {
      throw new Error("Lifecycle Chronicle idempotency record does not match this event.");
    }
  }

  async saveOffboardingReceipt(receipt: OffboardingReceipt): Promise<void> {
    const stored = await this.findOffboardingReceipt(receipt.operationKey);
    if (!stored || stored.guildId !== receipt.guildId || stored.actorId !== receipt.actorId ||
        stored.handoverId !== receipt.handoverId ||
        stored.handoverItemCount !== receipt.handoverItemCount ||
        stored.revokedAccessTokenCount !== receipt.revokedAccessTokenCount ||
        stored.revokedConnectorCredentialCount !== receipt.revokedConnectorCredentialCount ||
        stored.stoppedScheduledRunCount !== receipt.stoppedScheduledRunCount ||
        stored.killedAgentRunCount !== receipt.killedAgentRunCount ||
        stored.expiredApprovalCount !== receipt.expiredApprovalCount) {
      throw new Error("Durable offboarding receipt does not match the committed lifecycle evidence.");
    }
  }
}

export class PostgresLifecycleRuntimeRepository implements LifecycleRepository {
  readonly #guildId: string;
  readonly #requesterActorId: string;
  readonly #database: LifecycleDatabase;

  constructor(options: PostgresLifecycleRuntimeRepositoryOptions) {
    assertUuid(options.guildId, "Guild ID");
    assertUuid(options.requesterActorId, "Requester Actor ID");
    if (!options.database) assertNonBlank(options.connectionString, "PostgreSQL connection string", 10_000);
    this.#guildId = options.guildId;
    this.#requesterActorId = options.requesterActorId;
    this.#database = options.database ?? new ConnectionStringLifecycleDatabase(options.connectionString);
  }

  transact<T>(
    scope: LifecycleAtomicScope,
    work: (transaction: LifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    if (scope.guildId !== this.#guildId) {
      throw new Error("Lifecycle transaction crosses the configured Guild boundary.");
    }
    const lockKeys = unique(scope.lockKeys);
    if (lockKeys.length === 0 || lockKeys.length > MAX_LOCK_KEYS ||
        lockKeys.some((key) => key.trim().length === 0 || key.length > 500)) {
      throw new Error("Lifecycle transaction lock keys are invalid.");
    }
    return this.#database.transaction(this.#guildId, async (connection) => {
      await connection.query(
        "/* lifecycle-adapter:actor-context */ SELECT set_config('app.actor_identity_id', $1, true)",
        [this.#requesterActorId],
      );
      for (const lockKey of lockKeys) {
        await connection.query(
          "/* lifecycle-adapter:advisory-lock */ SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`guild-lifecycle:${this.#guildId}:${lockKey}`],
        );
      }
      await assertCurrentLifecyclePermission(
        connection,
        this.#guildId,
        this.#requesterActorId,
      );
      return work(new PostgresLifecycleTransaction(
        connection,
        this.#guildId,
        this.#requesterActorId,
      ));
    });
  }
}
