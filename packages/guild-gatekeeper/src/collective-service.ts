import {
  CLASSIFICATIONS,
  COLLECTIVE_TEMPLATES,
  VISIBILITIES,
  assertNonBlank,
  assertActivityStatus,
  assertActivityText,
  assertActivityType,
  assertMemoryContent,
  assertMemoryLayer,
  assertMemoryType,
  assertVocabularyOverrides,
  authorize,
  collectiveTemplate,
  isAuthorized,
  type ActorSecuredResource,
  type AuthorizationSnapshot,
  type CollectiveTemplateLabels,
  type Permission,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildCollectiveRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type CollectiveListCursor,
  type CollectiveActivityDependency,
  type GuildTransactionConnection,
  type MemorySummary,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  ArchiveMemoryRequest,
  AddActivityDependencyRequest,
  AssignActivityRequest,
  ChangeActivityStatusRequest,
  CompleteActivityRequest,
  ConfigureCollectiveRequest,
  CreateActivityRequest,
  CreateMemoryRequest,
  SaveMemoryRequest,
  RemoveActivityDependencyRequest,
  SetSpaceVocabularyRequest,
  UiActivity,
  UiActivityCapabilities,
  UiActivityDependency,
  UiActivityPage,
  UiActivityPageRequest,
  UiCollectiveContext,
  UiCollectiveSpace,
  UiMemory,
  UiMemoryCapabilities,
  UiMemoryPage,
  UiMemoryPageRequest,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REFERENCES = 100;
const LIST_SIZE = 40;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Expected version must be a positive integer.");
  }
}

function assertTimestamp(value: string | null, field: string): void {
  if (value !== null && Number.isNaN(Date.parse(value))) throw new Error(`${field} is invalid.`);
}

function assertReferences(values: readonly string[], field: string): void {
  if (!Array.isArray(values) || values.length > MAX_REFERENCES ||
      new Set(values).size !== values.length) {
    throw new Error(`${field} must contain at most ${MAX_REFERENCES} unique IDs.`);
  }
  for (const value of values) assertUuid(value, field);
}

function assertBoundary(input: {
  spaceId: string | null;
  visibility: string;
  classification: string;
  allowedActorIds: readonly string[];
}): void {
  if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Classification is invalid.");
  }
  if (input.visibility === "space" && input.spaceId === null) {
    throw new Error("Space visibility requires a Space.");
  }
  if (!["restricted", "private"].includes(input.visibility) && input.allowedActorIds.length > 0) {
    throw new Error("Explicit Actor access is valid only for restricted or private records.");
  }
  assertReferences(input.allowedActorIds, "Allowed Actor IDs");
}

function toSecuredResource(resource: ActorSecuredResource): SecuredResource {
  return {
    id: resource.id,
    guildId: resource.guildId,
    spaceId: resource.spaceId,
    ownerIdentityId: resource.ownerActorId,
    visibility: resource.visibility,
    classification: resource.classification,
    allowedIdentityIds: resource.allowedActorIds,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(cursor: CollectiveListCursor | null): string | null {
  return cursor === null ? null : bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(cursor)),
  );
}

function decodeCursor(value: string | null | undefined): CollectiveListCursor | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Collective cursor is malformed.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const cursor = parsed as Readonly<Record<string, unknown>>;
    if (typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" ||
        Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error("invalid cursor");
    assertUuid(cursor.id, "Cursor ID");
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new Error("Collective cursor is malformed.");
  }
}

function memoryCapabilities(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  memory: MemorySummary,
): UiMemoryCapabilities {
  const resource = toSecuredResource(memory);
  const editable = memory.workflow === null && memory.status === "active" && isAuthorized(snapshot, {
    actorIdentityId: actorId,
    permission: "memory.create",
    resource,
  });
  return { edit: editable, archive: editable, governed: memory.workflow !== null };
}

function activityCapabilities(
  snapshot: AuthorizationSnapshot,
  actorId: string,
  resource: ActorSecuredResource & {
    status: string;
    compatibilitySourceType?: "goal" | "project" | "quest" | "step" | null;
  },
): UiActivityCapabilities {
  const secured = toSecuredResource(resource);
  if (resource.compatibilitySourceType) {
    return {
      changeStatus: false,
      assign: false,
      addChild: false,
      manageDependencies: false,
      recordOutcome: false,
    };
  }
  const canChange = isAuthorized(snapshot, {
    actorIdentityId: actorId,
    permission: "activity.create",
    resource: secured,
  });
  return {
    changeStatus: canChange,
    assign: isAuthorized(snapshot, {
      actorIdentityId: actorId,
      permission: "activity.assign",
      resource: secured,
    }),
    addChild: canChange,
    manageDependencies: canChange,
    recordOutcome: canChange && resource.status === "active",
  };
}

function activityDependencyForUi(
  value: CollectiveActivityDependency,
): UiActivityDependency {
  return {
    id: value.dependency.id,
    activityId: value.dependency.activityId,
    dependsOnActivityId: value.dependency.dependsOnActivityId,
    kind: value.dependency.kind,
    version: value.dependency.version,
    createdByActorId: value.dependency.createdByActorId,
    createdAt: value.dependency.createdAt,
    activity: value.activity,
    dependsOnActivity: value.dependsOnActivity,
  };
}

async function snapshotFor(
  cache: Map<string, Promise<AuthorizationSnapshot>>,
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  spaceId: string | null,
): Promise<AuthorizationSnapshot> {
  const key = spaceId ?? "global";
  let snapshot = cache.get(key);
  if (!snapshot) {
    snapshot = loadActorAuthorizationSnapshot(connection, guildId, actorId, spaceId);
    cache.set(key, snapshot);
  }
  return snapshot;
}

export class GuildCollectiveService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getContext(): Promise<UiCollectiveContext> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => this.#context(connection),
    );
  }

  async configure(input: ConfigureCollectiveRequest): Promise<UiCollectiveContext> {
    collectiveTemplate(input.templateKey);
    assertVocabularyOverrides(input.vocabularyOverrides);
    for (const answer of Object.values(input.onboardingAnswers)) {
      if (typeof answer !== "string" || answer.length > 2_000) {
        throw new Error("Each onboarding answer must be at most 2,000 characters.");
      }
    }
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#authorize(connection, null, "template.manage");
        await new GuildCollectiveRepository(connection, this.#env.GUILD_ID).configure({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "collective.configured",
            "collective",
            this.#env.GUILD_ID,
            { templateKey: input.templateKey, source: "guild-ui" },
          ),
        });
      },
    );
    return this.getContext();
  }

  async setSpaceVocabulary(input: SetSpaceVocabularyRequest): Promise<UiCollectiveContext> {
    assertUuid(input.spaceId, "Space ID");
    if (input.templateKey !== null) collectiveTemplate(input.templateKey);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#authorize(connection, {
          id: input.spaceId,
          guildId: this.#env.GUILD_ID,
          spaceId: input.spaceId,
          ownerIdentityId: this.#accountId,
          visibility: "space",
          classification: "public",
          allowedIdentityIds: [],
        }, "space.manage");
        await new GuildCollectiveRepository(connection, this.#env.GUILD_ID).setSpaceVocabulary(
          input.spaceId,
          input.templateKey,
          this.#accountId,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "space.vocabulary.changed",
            "space",
            input.spaceId,
            { templateKey: input.templateKey ?? "inherit", source: "guild-ui" },
          ),
        );
      },
    );
    return this.getContext();
  }

  async getMemoryPage(request: UiMemoryPageRequest = {}): Promise<UiMemoryPage> {
    if (request.type) assertMemoryType(request.type);
    if (request.search && request.search.length > 500) throw new Error("Memory search is too long.");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const page = await repository.listMemories(this.#accountId, {
          cursor: decodeCursor(request.cursor),
          pageSize: LIST_SIZE,
          type: request.type,
          search: request.search,
          includeArchived: request.includeArchived,
        });
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const items: UiMemory[] = [];
        for (const memory of page.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            memory.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "memory.read",
            resource: toSecuredResource(memory),
          });
          const { guildId: _guildId, ...value } = memory;
          items.push({
            ...value,
            capabilities: memoryCapabilities(snapshot, this.#accountId, memory),
          });
        }
        const creatableSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "memory.create",
        );
        return {
          items,
          nextCursor: encodeCursor(page.nextCursor),
          creatableSpaceIds: creatableSpaces.map((space) => space.id),
        };
      },
    );
  }

  async createMemory(input: CreateMemoryRequest): Promise<string> {
    assertMemoryType(input.type);
    assertMemoryContent(input.title, input.summary, input.body);
    assertMemoryLayer(input.layer);
    if (input.layer === "canonical") {
      throw new Error("Canonical Memory must pass through the governed Knowledge workflow.");
    }
    if (!input.provenance || typeof input.provenance !== "object" || Array.isArray(input.provenance)) {
      throw new Error("Memory provenance must be a JSON object.");
    }
    assertTimestamp(input.lastVerifiedAt, "Memory verification time");
    assertBoundary(input);
    assertReferences(input.sourceIds, "Memory source IDs");
    if (input.changeNote.length > 2_000) throw new Error("Change note is too long.");
    if (input.confidence !== null &&
        (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
      throw new Error("Memory confidence must be between 0 and 1.");
    }
    if (input.custody !== "guild" && input.custody !== "personal") {
      throw new Error("Memory custody is invalid.");
    }
    if (input.custody === "personal" &&
        (input.visibility !== "private" || input.allowedActorIds.length > 0)) {
      throw new Error("Personal Memory must remain private until its owner explicitly shares it.");
    }
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const resource = this.#newResource(id, input);
        await this.#authorize(connection, resource, "memory.create");
        await this.#assertActorIds(connection, input.allowedActorIds);
        await this.#assertMemorySources(connection, input.sourceIds);
        await new GuildCollectiveRepository(connection, this.#env.GUILD_ID).createMemory({
          ...input,
          layer: input.layer === "external" ? "external" : "working",
          id,
          actorId: this.#accountId,
          ownerActorId: this.#accountId,
          chronicleEvent: this.#event("memory.created", "memory", id, {
            type: input.type,
          }, resource),
        });
      },
    );
    return id;
  }

  async saveMemory(input: SaveMemoryRequest): Promise<number> {
    assertUuid(input.memoryId, "Memory ID");
    assertVersion(input.expectedVersion);
    assertMemoryContent(input.title, input.summary, input.body);
    assertReferences(input.sourceIds, "Memory source IDs");
    if (input.changeNote.length > 2_000) throw new Error("Change note is too long.");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const memory = await repository.getMemory(input.memoryId);
        const resource = toSecuredResource(memory);
        await this.#authorize(connection, resource, "memory.create");
        await this.#assertMemorySources(connection, input.sourceIds);
        return repository.saveMemory({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event("memory.version.created", "memory", input.memoryId, {
            version: input.expectedVersion + 1,
          }, resource),
        });
      },
    );
  }

  async archiveMemory(input: ArchiveMemoryRequest): Promise<number> {
    assertUuid(input.memoryId, "Memory ID");
    assertVersion(input.expectedVersion);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const memory = await repository.getMemory(input.memoryId);
        const resource = toSecuredResource(memory);
        await this.#authorize(connection, resource, "memory.create");
        return repository.archiveMemory({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "memory.archived",
            "memory",
            input.memoryId,
            {},
            resource,
          ),
        });
      },
    );
  }

  async getActivityPage(request: UiActivityPageRequest = {}): Promise<UiActivityPage> {
    if (request.parentActivityId) assertUuid(request.parentActivityId, "Parent Activity ID");
    if (request.assigneeActorId) assertUuid(request.assigneeActorId, "Assignee Actor ID");
    request.types?.forEach(assertActivityType);
    request.statuses?.forEach(assertActivityStatus);
    if (request.search && request.search.length > 500) throw new Error("Activity search is too long.");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const page = await repository.listActivities(this.#accountId, {
          cursor: decodeCursor(request.cursor),
          pageSize: LIST_SIZE,
          parentActivityId: request.parentActivityId,
          assigneeActorId: request.assigneeActorId,
          types: request.types,
          statuses: request.statuses,
          search: request.search,
        });
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const graphs = await repository.listActivityGraphs(
          this.#accountId,
          page.items.map((activity) => activity.id),
        );
        const items: UiActivity[] = [];
        for (const activity of page.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            activity.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "activity.read",
            resource: toSecuredResource(activity),
          });
          const { guildId: _guildId, ...value } = activity;
          const graph = graphs.get(activity.id);
          const outcome = graph?.outcome ?? null;
          items.push({
            ...value,
            dependencies: graph?.dependencies.map(activityDependencyForUi) ?? [],
            dependents: graph?.dependents.map(activityDependencyForUi) ?? [],
            outcome: outcome === null ? null : {
              activityId: outcome.activityId,
              version: outcome.version,
              activityVersion: outcome.activityVersion,
              summary: outcome.summary,
              evidenceSourceIds: outcome.evidenceSourceIds,
              completedByActorId: outcome.completedByActorId,
              completedAt: outcome.completedAt,
            },
            capabilities: activityCapabilities(snapshot, this.#accountId, activity),
          });
        }
        const creatableSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "activity.create",
        );
        return {
          items,
          nextCursor: encodeCursor(page.nextCursor),
          creatableSpaceIds: creatableSpaces.map((space) => space.id),
        };
      },
    );
  }

  async createActivity(input: CreateActivityRequest): Promise<string> {
    if (input.parentActivityId) assertUuid(input.parentActivityId, "Parent Activity ID");
    if (input.assigneeActorId) assertUuid(input.assigneeActorId, "Assignee Actor ID");
    assertActivityType(input.type);
    assertActivityStatus(input.status);
    assertActivityText(input.title, input.description);
    assertBoundary(input);
    assertReferences(input.sourceIds, "Activity source IDs");
    assertTimestamp(input.startsAt, "Activity start time");
    assertTimestamp(input.dueAt, "Activity due time");
    if (!Number.isSafeInteger(input.position) || input.position < 0) {
      throw new Error("Activity position must be a non-negative integer.");
    }
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const resource = this.#newResource(id, input);
        await this.#authorize(connection, resource, "activity.create");
        if (input.parentActivityId) {
          const parent = await repository.getActivity(input.parentActivityId);
          await this.#authorize(connection, toSecuredResource(parent), "activity.create");
        }
        await this.#assertActorIds(
          connection,
          input.assigneeActorId
            ? [...input.allowedActorIds, input.assigneeActorId]
            : input.allowedActorIds,
        );
        await this.#assertMemorySources(connection, input.sourceIds);
        await repository.createActivity({
          ...input,
          id,
          actorId: this.#accountId,
          ownerActorId: this.#accountId,
          chronicleEvent: this.#event("activity.created", "activity", id, {
            type: input.type,
            status: input.status,
          }, resource),
        });
      },
    );
    return id;
  }

  async changeActivityStatus(input: ChangeActivityStatusRequest): Promise<number> {
    assertUuid(input.activityId, "Activity ID");
    assertVersion(input.expectedVersion);
    assertActivityStatus(input.status);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.activityId);
        const resource = toSecuredResource(activity);
        await this.#authorize(connection, resource, "activity.create");
        return repository.changeActivityStatus({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "activity.status.changed",
            "activity",
            input.activityId,
            { from: activity.status, to: input.status },
            resource,
          ),
        });
      },
    );
  }

  async assignActivity(input: AssignActivityRequest): Promise<number> {
    assertUuid(input.activityId, "Activity ID");
    assertVersion(input.expectedVersion);
    if (input.assigneeActorId) assertUuid(input.assigneeActorId, "Assignee Actor ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.activityId);
        const resource = toSecuredResource(activity);
        await this.#authorize(connection, resource, "activity.assign");
        if (input.assigneeActorId) await this.#assertActorIds(connection, [input.assigneeActorId]);
        return repository.assignActivity({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "activity.assigned",
            "activity",
            input.activityId,
            { assigneeActorId: input.assigneeActorId },
            resource,
          ),
        });
      },
    );
  }

  async addActivityDependency(input: AddActivityDependencyRequest): Promise<number> {
    assertUuid(input.activityId, "Activity ID");
    assertUuid(input.dependsOnActivityId, "Predecessor Activity ID");
    assertVersion(input.expectedVersion);
    if (!["blocks", "relates_to", "follows"].includes(input.kind)) {
      throw new Error("Activity dependency kind is invalid.");
    }
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.activityId);
        const predecessor = await repository.getActivity(input.dependsOnActivityId);
        const resource = toSecuredResource(activity);
        await this.#authorize(connection, resource, "activity.create");
        await this.#authorize(connection, toSecuredResource(predecessor), "activity.read");
        const result = await repository.addActivityDependency({
          ...input,
          id: crypto.randomUUID(),
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "activity.dependency.added",
            "activity",
            input.activityId,
            { dependsOnActivityId: input.dependsOnActivityId, kind: input.kind },
            resource,
          ),
        });
        return result.activityVersion;
      },
    );
  }

  async removeActivityDependency(input: RemoveActivityDependencyRequest): Promise<number> {
    assertUuid(input.activityId, "Activity ID");
    assertUuid(input.dependencyId, "Activity dependency ID");
    assertVersion(input.expectedVersion);
    assertVersion(input.expectedDependencyVersion);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.activityId);
        const dependency = await repository.getActivityDependency(input.dependencyId);
        if (dependency.activityId !== input.activityId) {
          throw new Error("Activity dependency does not belong to this Activity.");
        }
        const predecessor = await repository.getActivity(dependency.dependsOnActivityId);
        const resource = toSecuredResource(activity);
        await this.#authorize(connection, resource, "activity.create");
        await this.#authorize(connection, toSecuredResource(predecessor), "activity.read");
        const result = await repository.removeActivityDependency({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "activity.dependency.removed",
            "activity",
            input.activityId,
            {
              dependencyId: input.dependencyId,
              dependsOnActivityId: dependency.dependsOnActivityId,
              kind: dependency.kind,
              dependencyVersion: input.expectedDependencyVersion,
            },
            resource,
          ),
        });
        return result.activityVersion;
      },
    );
  }

  async completeActivity(input: CompleteActivityRequest): Promise<number> {
    assertUuid(input.activityId, "Activity ID");
    assertVersion(input.expectedVersion);
    assertNonBlank(input.summary, "Activity outcome summary", 10_000);
    assertReferences(input.evidenceSourceIds, "Activity outcome evidence source IDs");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
        const activity = await repository.getActivity(input.activityId);
        const resource = toSecuredResource(activity);
        await this.#authorize(connection, resource, "activity.create");
        await this.#assertMemorySources(connection, input.evidenceSourceIds);
        const result = await repository.completeActivity({
          ...input,
          actorId: this.#accountId,
          chronicleEvent: this.#event(
            "activity.completed",
            "activity",
            input.activityId,
            {
              from: activity.status,
              to: "completed",
              evidenceSourceCount: input.evidenceSourceIds.length,
            },
            resource,
          ),
        });
        return result.activityVersion;
      },
    );
  }

  async #context(connection: GuildTransactionConnection): Promise<UiCollectiveContext> {
    let snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      null,
    );
    const templateSpaces = await listAuthorizedSpaces(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      "template.read",
    );
    if (!isAuthorized(snapshot, {
      actorIdentityId: this.#accountId,
      permission: "template.read",
    })) {
      const first = templateSpaces[0];
      if (first) {
        snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          first.id,
        );
      }
      authorize(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "template.read",
        resource: {
          id: first?.id ?? this.#env.GUILD_ID,
          guildId: this.#env.GUILD_ID,
          spaceId: first?.id ?? null,
          ownerIdentityId: this.#accountId,
          visibility: first ? "space" : "guild",
          classification: "public",
          allowedIdentityIds: [],
        },
      });
    }
    const repository = new GuildCollectiveRepository(connection, this.#env.GUILD_ID);
    const settings = await repository.getSettings();
    const template = collectiveTemplate(settings.templateKey);
    const labels = { ...template.labels, ...settings.vocabularyOverrides };
    const readableSpaces = await listAuthorizedSpaces(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      "space.read",
    );
    const readableSpaceIds = readableSpaces.map((space) => space.id);
    const configurableSpaces = await listAuthorizedSpaces(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      "space.manage",
    );
    const configurableSpaceIds = new Set(configurableSpaces.map((space) => space.id));
    const rows = (await connection.query<{
      id: string;
      parent_space_id: string | null;
      name: string;
      vocabulary_profile_key: string | null;
      template_key: string | null;
      profile_labels: Partial<CollectiveTemplateLabels> | null;
    }>(
      `SELECT space.id::text,
              CASE WHEN space.parent_space_id = ANY($2::uuid[])
                THEN space.parent_space_id::text ELSE NULL END AS parent_space_id,
              space.name,
              space.vocabulary_profile_key, profile.template_key,
              profile.labels AS profile_labels
         FROM spaces space
         LEFT JOIN vocabulary_profiles profile
           ON profile.guild_id = space.guild_id
          AND profile.key = space.vocabulary_profile_key
        WHERE space.guild_id = $1 AND space.status = 'active'
          AND space.id = ANY($2::uuid[])
        ORDER BY space.name, space.id`,
      [this.#env.GUILD_ID, readableSpaceIds],
    )).rows;
    const spaces: UiCollectiveSpace[] = rows.map((row) => {
      const profileTemplate = row.template_key &&
        COLLECTIVE_TEMPLATES.some((candidate) => candidate.key === row.template_key)
        ? collectiveTemplate(row.template_key as typeof template.key)
        : null;
      return {
        id: row.id,
        parentSpaceId: row.parent_space_id,
        name: row.name,
        vocabularyProfileKey: profileTemplate?.key ?? null,
        labels: {
          ...(profileTemplate?.labels ?? labels),
          ...(row.profile_labels ?? {}),
        },
        canConfigure: configurableSpaceIds.has(row.id),
      };
    });
    return {
      template,
      templates: COLLECTIVE_TEMPLATES,
      labels,
      vocabularyOverrides: settings.vocabularyOverrides,
      onboardingAnswers: settings.onboardingAnswers,
      templateVersion: settings.templateVersion,
      spaces,
      canConfigure: isAuthorized(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "template.manage",
      }),
      canConfigureSpaces: configurableSpaces.length > 0,
    };
  }

  async #authorize(
    connection: GuildTransactionConnection,
    resource: SecuredResource | null,
    permission: Permission,
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      resource?.spaceId ?? null,
    );
    authorize(snapshot, {
      actorIdentityId: this.#accountId,
      permission,
      ...(resource ? { resource } : {}),
    });
    return snapshot;
  }

  async #assertActorIds(
    connection: GuildTransactionConnection,
    actorIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(actorIds)];
    if (unique.length === 0) return;
    const count = (await connection.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM actor_memberships
        WHERE guild_id = $1 AND actor_id = ANY($2::uuid[])`,
      [this.#env.GUILD_ID, unique],
    )).rows[0]?.count;
    if (Number(count ?? 0) !== unique.length) {
      throw new Error("One or more Actors do not belong to this Guild.");
    }
  }

  async #assertMemorySources(
    connection: GuildTransactionConnection,
    memoryIds: readonly string[],
  ): Promise<void> {
    for (const memoryId of memoryIds) {
      const memory = await new GuildCollectiveRepository(
        connection,
        this.#env.GUILD_ID,
      ).getMemory(memoryId);
      await this.#authorize(connection, toSecuredResource(memory), "memory.read");
    }
  }

  #newResource(
    id: string,
    input: Pick<CreateMemoryRequest, "spaceId" | "visibility" | "classification" | "allowedActorIds">,
  ): SecuredResource {
    return {
      id,
      guildId: this.#env.GUILD_ID,
      spaceId: input.spaceId,
      ownerIdentityId: this.#accountId,
      visibility: input.visibility,
      classification: input.classification,
      allowedIdentityIds: input.allowedActorIds,
    };
  }

  #event(
    action: string,
    subjectType: string,
    subjectId: string,
    details: Readonly<Record<string, string | number | boolean | null>>,
    resource: SecuredResource,
  ) {
    return makeChronicleEvent(
      this.#env.GUILD_ID,
      this.#accountId,
      action,
      subjectType,
      subjectId,
      { ...details, source: "guild-ui" },
      resource,
    );
  }
}
