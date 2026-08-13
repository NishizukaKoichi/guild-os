import {
  CLASSIFICATION_RANK,
  PERMISSIONS,
  assertNonBlank,
  assertRelationType,
  authorize,
  isAuthorized,
  type AuthorizationSnapshot,
  type Classification,
  type Permission,
  type SecuredResource,
  type Visibility,
} from "@guild-os/domain";
import {
  GuildContextRepository,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  CreateContextRelationRequest,
  ResolveMemoryReviewSignalRequest,
  RevokeContextRelationRequest,
  SharePersonalDataRequest,
  UiContextNode,
  UiContextPage,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);
const RESOURCE_TYPES = new Set([
  "memory", "external_source", "activity", "knowledge", "decision",
  "announcement", "agent_run", "connection", "file", "actor", "event",
]);

interface Endpoint {
  type: string;
  id: string;
  label: string;
  permission: Permission;
  resource: SecuredResource | null;
}

type BoundaryRow = {
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  read_permission: string;
};

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function permission(value: string): Permission {
  if (!KNOWN_PERMISSIONS.has(value)) throw new Error("Context endpoint has an unknown permission.");
  return value as Permission;
}

function relationVisibility(first: Endpoint, second: Endpoint): {
  visibility: Visibility;
  spaceId: string | null;
} {
  const resources = [first.resource, second.resource]
    .filter((resource): resource is SecuredResource => resource !== null);
  if (resources.length === 0) return { visibility: "guild", spaceId: null };
  if (resources.map((resource) => resource.visibility)
    .some((value) => value === "private" || value === "restricted")) {
    return { visibility: "private", spaceId: resources[0]?.spaceId ?? resources[1]?.spaceId ?? null };
  }
  const spaceIds = [...new Set(resources
    .map((resource) => resource.spaceId)
    .filter((spaceId): spaceId is string => spaceId !== null))];
  if (spaceIds.length > 0) {
    if (spaceIds.length > 1) {
      return { visibility: "private", spaceId: null };
    }
    return { visibility: "space", spaceId: spaceIds[0]! };
  }
  return { visibility: "guild", spaceId: null };
}

function relationClassification(first: Endpoint, second: Endpoint): Classification {
  const values = [first.resource?.classification ?? "internal", second.resource?.classification ?? "internal"];
  return values.reduce<Classification>((highest, value) =>
    CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[highest] ? value : highest, "public");
}

function stripGuildId<T extends { guildId: string }>(value: T): Omit<T, "guildId"> {
  const { guildId: _guildId, ...rest } = value;
  return rest;
}

async function labelFor(
  connection: GuildTransactionConnection,
  guildId: string,
  type: string,
  id: string,
): Promise<string | null> {
  const queryByType: Readonly<Record<string, string>> = {
    memory: `SELECT COALESCE(version.title ->> 'en', version.title ->> 'ja',
                    version.title ->> 'zh-CN', 'Memory') AS label
               FROM memories memory JOIN memory_versions version
                 ON version.guild_id = memory.guild_id AND version.memory_id = memory.id
                AND version.version = memory.current_version
              WHERE memory.guild_id = $1 AND memory.id = $2`,
    external_source: `SELECT COALESCE(version.title ->> 'en', version.title ->> 'ja',
                    version.title ->> 'zh-CN', 'External source') AS label
               FROM memories memory JOIN memory_versions version
                 ON version.guild_id = memory.guild_id AND version.memory_id = memory.id
                AND version.version = memory.current_version
              WHERE memory.guild_id = $1 AND memory.id = $2 AND memory.layer = 'external'`,
    activity: "SELECT title AS label FROM activities WHERE guild_id = $1 AND id = $2",
    knowledge: `SELECT COALESCE(version.title ->> 'en', version.title ->> 'ja',
                    version.title ->> 'zh-CN', 'Knowledge') AS label
               FROM knowledge item JOIN knowledge_versions version
                 ON version.guild_id = item.guild_id AND version.knowledge_id = item.id
                AND version.version = item.current_version
              WHERE item.guild_id = $1 AND item.id = $2`,
    decision: "SELECT title AS label FROM decisions WHERE guild_id = $1 AND id = $2",
    announcement: "SELECT title AS label FROM announcements WHERE guild_id = $1 AND id = $2",
    agent_run: "SELECT COALESCE(plan ->> 'objective', 'Agent run') AS label FROM agent_runs WHERE guild_id = $1 AND id = $2",
    connection: "SELECT name AS label FROM connectors WHERE guild_id = $1 AND id = $2",
    file: "SELECT original_name AS label FROM files WHERE guild_id = $1 AND id = $2",
    actor: `SELECT actor.display_name AS label FROM actors actor
              JOIN actor_memberships membership ON membership.actor_id = actor.id
             WHERE membership.guild_id = $1 AND actor.id = $2`,
    event: "SELECT action AS label FROM chronicle_events WHERE guild_id = $1 AND id = $2",
  };
  const sql = queryByType[type];
  if (!sql) return null;
  return (await connection.query<{ label: string }>(sql, [guildId, id])).rows[0]?.label ?? null;
}

async function resolveEndpoint(
  connection: GuildTransactionConnection,
  env: GuildEnv,
  actorId: string,
  type: string,
  id: string,
): Promise<Endpoint | null> {
  if (!RESOURCE_TYPES.has(type)) return null;
  const underlyingType = type === "external_source" ? "memory" : type;
  let resource: SecuredResource | null = null;
  let readPermission: Permission;
  if (["memory", "activity", "knowledge", "decision", "announcement", "agent_run"].includes(underlyingType)) {
    const row = (await connection.query<BoundaryRow>(
      `SELECT space_id::text, owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], read_permission
         FROM guild_runtime.conversation_subject($1, $2, $3)`,
      [env.GUILD_ID, underlyingType, id],
    )).rows[0];
    if (!row) return null;
    readPermission = permission(row.read_permission);
    resource = {
      id,
      guildId: env.GUILD_ID,
      spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id,
      visibility: row.visibility,
      classification: row.classification,
      allowedIdentityIds: row.allowed_identity_ids,
    };
  } else if (type === "connection") {
    const row = (await connection.query<BoundaryRow>(
      `SELECT space_id::text, owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], 'connection.read' AS read_permission
         FROM connectors WHERE guild_id = $1 AND id = $2 AND status <> 'revoked'`,
      [env.GUILD_ID, id],
    )).rows[0];
    if (!row) return null;
    readPermission = "connection.read";
    resource = {
      id, guildId: env.GUILD_ID, spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id, visibility: row.visibility,
      classification: row.classification, allowedIdentityIds: row.allowed_identity_ids,
    };
  } else if (type === "file") {
    const row = (await connection.query<BoundaryRow>(
      `SELECT space_id::text, owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], 'file.read' AS read_permission
         FROM files WHERE guild_id = $1 AND id = $2 AND status <> 'deleted'`,
      [env.GUILD_ID, id],
    )).rows[0];
    if (!row) return null;
    readPermission = "file.read";
    resource = {
      id, guildId: env.GUILD_ID, spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id, visibility: row.visibility,
      classification: row.classification, allowedIdentityIds: row.allowed_identity_ids,
    };
  } else if (type === "event") {
    const row = (await connection.query<BoundaryRow>(
      `SELECT space_id::text, owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], 'event.read' AS read_permission
         FROM chronicle_events WHERE guild_id = $1 AND id = $2`,
      [env.GUILD_ID, id],
    )).rows[0];
    if (!row) return null;
    readPermission = "event.read";
    resource = {
      id, guildId: env.GUILD_ID, spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id, visibility: row.visibility,
      classification: row.classification, allowedIdentityIds: row.allowed_identity_ids,
    };
  } else {
    const exists = (await connection.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM actor_memberships membership
        JOIN actors actor ON actor.id = membership.actor_id
       WHERE membership.guild_id = $1 AND membership.actor_id = $2
         AND actor.status = 'active') AS exists`,
      [env.GUILD_ID, id],
    )).rows[0]?.exists;
    if (!exists) return null;
    readPermission = "actor.read";
  }
  const snapshot = await loadActorAuthorizationSnapshot(
    connection,
    env.GUILD_ID,
    actorId,
    resource?.spaceId ?? null,
  );
  if (!isAuthorized(snapshot, { actorIdentityId: actorId, permission: readPermission, resource: resource ?? undefined })) {
    return null;
  }
  const label = await labelFor(connection, env.GUILD_ID, type, id);
  return label ? { type, id, label, permission: readPermission, resource } : null;
}

async function canGlobally(
  connection: GuildTransactionConnection,
  env: GuildEnv,
  actorId: string,
  required: Permission,
): Promise<boolean> {
  const snapshot = await loadActorAuthorizationSnapshot(connection, env.GUILD_ID, actorId);
  return isAuthorized(snapshot, { actorIdentityId: actorId, permission: required });
}

export class GuildContextService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getPage(): Promise<UiContextPage> {
    return this.#transaction(async (connection) => {
      const repository = new GuildContextRepository(connection, this.#env.GUILD_ID);
      const [relationsPage, personalCustody, canManageRelations, canReviewMemory, canReadData] =
        await Promise.all([
          repository.listRelations(this.#accountId),
          repository.listPersonalCustody(this.#accountId),
          canGlobally(connection, this.#env, this.#accountId, "relation.manage"),
          canGlobally(connection, this.#env, this.#accountId, "memory.govern"),
          canGlobally(connection, this.#env, this.#accountId, "data.read"),
        ]);
      const endpointKeys = new Map<string, { type: string; id: string }>();
      for (const relation of relationsPage.items) {
        endpointKeys.set(`${relation.fromType}:${relation.fromId}`, { type: relation.fromType, id: relation.fromId });
        endpointKeys.set(`${relation.toType}:${relation.toId}`, { type: relation.toType, id: relation.toId });
      }
      const nodes: readonly UiContextNode[] = await repository.listVisibleNodes(
        this.#accountId,
        [...endpointKeys.values()],
      );
      const visibleEndpointKeys = new Set(nodes.map((node) => `${node.type}:${node.id}`));
      return {
        relations: relationsPage.items.filter((relation) =>
          visibleEndpointKeys.has(`${relation.fromType}:${relation.fromId}`) &&
          visibleEndpointKeys.has(`${relation.toType}:${relation.toId}`))
          .map(stripGuildId),
        nodes,
        reviewSignals: canReviewMemory
          ? (await repository.listReviewSignals()).map(stripGuildId)
          : [],
        personalCustody: personalCustody.map(stripGuildId),
        custodyCounts: canReadData ? await repository.getCustodyCounts() : null,
        canManageRelations,
        canReviewMemory,
      };
    });
  }

  async createRelation(input: CreateContextRelationRequest): Promise<string> {
    assertUuid(input.fromId, "Relation source ID");
    assertUuid(input.toId, "Relation target ID");
    assertRelationType(input.relationType);
    assertNonBlank(input.rationale, "Relation rationale", 5_000);
    const relationId = crypto.randomUUID();
    await this.#transaction(async (connection) => {
      const [from, to] = await Promise.all([
        resolveEndpoint(connection, this.#env, this.#accountId, input.fromType, input.fromId),
        resolveEndpoint(connection, this.#env, this.#accountId, input.toType, input.toId),
      ]);
      if (!from || !to) throw new Error("Both Context Graph endpoints must exist and be visible.");
      const boundary = relationVisibility(from, to);
      const classification = relationClassification(from, to);
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        boundary.spaceId,
      );
      const relationResource: SecuredResource = {
        id: relationId,
        guildId: this.#env.GUILD_ID,
        spaceId: boundary.spaceId,
        ownerIdentityId: this.#accountId,
        visibility: boundary.visibility,
        classification,
        allowedIdentityIds: [],
      };
      authorize(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "relation.manage",
        resource: relationResource,
      });
      await new GuildContextRepository(connection, this.#env.GUILD_ID).createRelation({
        id: relationId,
        actorId: this.#accountId,
        fromType: input.fromType,
        fromId: input.fromId,
        relationType: input.relationType,
        toType: input.toType,
        toId: input.toId,
        spaceId: boundary.spaceId,
        visibility: boundary.visibility,
        classification,
        allowedActorIds: [],
        properties: {},
        rationale: input.rationale,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "context_relation.created",
          "relation",
          relationId,
          { fromType: input.fromType, fromId: input.fromId, relationType: input.relationType,
            toType: input.toType, toId: input.toId, source: "guild-ui" },
          relationResource,
        ),
      });
    });
    return relationId;
  }

  async revokeRelation(input: RevokeContextRelationRequest): Promise<number> {
    assertUuid(input.relationId, "Relation ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Expected relation version is invalid.");
    }
    return this.#transaction(async (connection) => {
      const repository = new GuildContextRepository(connection, this.#env.GUILD_ID);
      const visible = (await repository.listRelations(this.#accountId, null, 100)).items
        .find((relation) => relation.id === input.relationId);
      if (!visible) throw new Error("Context Graph relation was not found or is not visible.");
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        visible.spaceId,
      );
      authorize(snapshot, { actorIdentityId: this.#accountId, permission: "relation.manage", resource: {
        id: visible.id, guildId: visible.guildId, spaceId: visible.spaceId,
        ownerIdentityId: visible.ownerActorId, visibility: visible.visibility,
        classification: visible.classification, allowedIdentityIds: visible.allowedActorIds,
      } });
      return repository.revokeRelation(
        input.relationId,
        input.expectedVersion,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "context_relation.revoked",
          "relation",
          input.relationId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async resolveReviewSignal(input: ResolveMemoryReviewSignalRequest): Promise<number> {
    assertUuid(input.signalId, "Memory review signal ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Expected Memory review version is invalid.");
    }
    return this.#transaction(async (connection) => {
      const snapshot = await loadActorAuthorizationSnapshot(connection, this.#env.GUILD_ID, this.#accountId);
      authorize(snapshot, { actorIdentityId: this.#accountId, permission: "memory.govern" });
      return new GuildContextRepository(connection, this.#env.GUILD_ID).resolveReviewSignal(
        input.signalId,
        input.expectedVersion,
        input.status,
        input.resolution,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          `memory_review.${input.status}`,
          "memory_review_signal",
          input.signalId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async sharePersonalData(input: SharePersonalDataRequest): Promise<void> {
    assertUuid(input.resourceId, "Resource ID");
    await this.#transaction(async (connection) => {
      const snapshot = await loadActorAuthorizationSnapshot(connection, this.#env.GUILD_ID, this.#accountId);
      authorize(snapshot, { actorIdentityId: this.#accountId, permission: "data.read" });
      await new GuildContextRepository(connection, this.#env.GUILD_ID).sharePersonalData(
        input.resourceType,
        input.resourceId,
        input.expectedVersion,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "data.personal.shared",
          input.resourceType,
          input.resourceId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async #transaction<T>(operation: (connection: GuildTransactionConnection) => Promise<T>): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [this.#accountId]);
        const snapshot: AuthorizationSnapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        authorize(snapshot, { actorIdentityId: this.#accountId, permission: "guild.read" });
        return operation(connection);
      },
    );
  }
}
