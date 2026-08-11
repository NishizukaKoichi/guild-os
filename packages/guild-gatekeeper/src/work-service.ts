import {
  GuildDomainError,
  VISIBILITIES,
  CLASSIFICATIONS,
  assertGoalStatus,
  assertProjectStatus,
  assertQuestStatus,
  assertStepStatus,
  assertWorkText,
  authorize,
  isAuthorized,
  type AuthorizationSnapshot,
  type Permission,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildKnowledgeRepository,
  GuildWorkRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
  type WorkListCursor,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  CreateGoalRequest,
  CreateProjectRequest,
  CreateQuestRequest,
  CreateStepRequest,
  UiGoal,
  UiProject,
  UiQuest,
  UiQuestDetail,
  UiStep,
  UiWorkCapabilities,
  UiWorkPage,
  UiWorkPageRequest,
  WorkAssignmentRequest,
  WorkResourceInput,
  WorkStatusRequest,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REFERENCES = 100;
const WORK_LIST_SIZE = 30;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Expected Work version must be a positive integer.");
  }
}

function assertOptionalTimestamp(value: string | null, field: string): void {
  if (value !== null && Number.isNaN(Date.parse(value))) throw new Error(`${field} is invalid.`);
}

function assertResourceInput(input: WorkResourceInput): void {
  assertWorkText(input.title, input.description);
  if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Work visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Work classification is invalid.");
  }
  if (input.visibility === "space" && input.spaceId === null) {
    throw new Error("Space-visible Work requires a Space.");
  }
  if (input.visibility !== "restricted" && input.visibility !== "private" &&
      input.allowedIdentityIds.length > 0) {
    throw new Error("Explicit Identity access is valid only for restricted or private Work.");
  }
  for (const [name, values] of [
    ["allowed Identity", input.allowedIdentityIds],
    ["source", input.sourceIds],
  ] as const) {
    if (!Array.isArray(values) || values.length > MAX_REFERENCES ||
        new Set(values).size !== values.length) {
      throw new Error(`Work ${name} IDs must contain at most ${MAX_REFERENCES} unique values.`);
    }
    for (const value of values) assertUuid(value, `Work ${name} ID`);
  }
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

function encodeCursor(cursor: WorkListCursor | null): string | null {
  return cursor === null ? null : bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(cursor)),
  );
}

function decodeCursor(value: string | null | undefined): WorkListCursor | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Work cursor is malformed.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const cursor = parsed as Readonly<Record<string, unknown>>;
    if (typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" ||
        Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error("invalid cursor");
    assertUuid(cursor.id, "Work cursor ID");
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new Error("Work cursor is malformed.");
  }
}

async function snapshotFor(
  cache: Map<string, Promise<AuthorizationSnapshot>>,
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityId: string,
  spaceId: string | null,
): Promise<AuthorizationSnapshot> {
  const key = spaceId ?? "global";
  let snapshot = cache.get(key);
  if (!snapshot) {
    snapshot = loadActorAuthorizationSnapshot(connection, guildId, actorIdentityId, spaceId);
    cache.set(key, snapshot);
  }
  return snapshot;
}

function capabilities(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  resource: SecuredResource,
  canHaveChild: boolean,
  canAssign: boolean,
): UiWorkCapabilities {
  const can = (permission: Permission) => isAuthorized(snapshot, {
    actorIdentityId,
    permission,
    resource,
  });
  return {
    changeStatus: can("work.create"),
    assign: canAssign && can("work.assign"),
    addChild: canHaveChild && can("work.create"),
  };
}

function goalForUi(
  goal: Awaited<ReturnType<GuildWorkRepository["getGoal"]>>,
  value: UiWorkCapabilities,
): UiGoal {
  const { guildId: _guildId, ...rest } = goal;
  return { ...rest, capabilities: value };
}

function projectForUi(
  project: Awaited<ReturnType<GuildWorkRepository["getProject"]>>,
  value: UiWorkCapabilities,
): UiProject {
  const { guildId: _guildId, ...rest } = project;
  return { ...rest, capabilities: value };
}

function questForUi(
  quest: Awaited<ReturnType<GuildWorkRepository["getQuest"]>>,
  value: UiWorkCapabilities,
): UiQuest {
  const { guildId: _guildId, ...rest } = quest;
  return { ...rest, capabilities: value };
}

function stepForUi(
  step: Awaited<ReturnType<GuildWorkRepository["getStep"]>>,
  value: UiWorkCapabilities,
): UiStep {
  const { guildId: _guildId, ...rest } = step;
  return { ...rest, capabilities: value };
}

export class GuildWorkService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getPage(request: UiWorkPageRequest = {}): Promise<UiWorkPage> {
    if (request.projectId) assertUuid(request.projectId, "Project ID");
    if (request.assigneeIdentityId) assertUuid(request.assigneeIdentityId, "Assignee Identity ID");
    if (request.questStatuses) {
      for (const status of request.questStatuses) assertQuestStatus(status);
    }
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const goalPage = await repository.listGoals(
          this.#accountId,
          decodeCursor(request.goalCursor),
          WORK_LIST_SIZE,
        );
        const projectPage = await repository.listProjects(
          this.#accountId,
          null,
          decodeCursor(request.projectCursor),
          WORK_LIST_SIZE,
        );
        const questPage = await repository.listQuests(
          this.#accountId,
          {
            projectId: request.projectId,
            assigneeIdentityId: request.assigneeIdentityId,
            statuses: request.questStatuses,
          },
          decodeCursor(request.questCursor),
          WORK_LIST_SIZE,
        );
        const creatableSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "work.create",
        );
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const goals: UiGoal[] = [];
        for (const goal of goalPage.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            goal.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "work.read",
            resource: goal,
          });
          goals.push(goalForUi(goal, capabilities(
            snapshot,
            this.#accountId,
            goal,
            goal.status === "draft" || goal.status === "active",
            false,
          )));
        }
        const projects: UiProject[] = [];
        for (const project of projectPage.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            project.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "work.read",
            resource: project,
          });
          projects.push(projectForUi(project, capabilities(
            snapshot,
            this.#accountId,
            project,
            ["planned", "active", "blocked"].includes(project.status),
            false,
          )));
        }
        const quests: UiQuest[] = [];
        for (const quest of questPage.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            quest.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "work.read",
            resource: quest,
          });
          quests.push(questForUi(quest, capabilities(
            snapshot,
            this.#accountId,
            quest,
            !["completed", "cancelled"].includes(quest.status),
            true,
          )));
        }
        return {
          goals,
          projects,
          quests,
          nextGoalCursor: encodeCursor(goalPage.nextCursor),
          nextProjectCursor: encodeCursor(projectPage.nextCursor),
          nextQuestCursor: encodeCursor(questPage.nextCursor),
          canCreate: creatableSpaces.length > 0,
        };
      },
    );
  }

  async getQuestDetail(questId: string): Promise<UiQuestDetail> {
    assertUuid(questId, "Quest ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const quest = await repository.getQuest(questId);
        const snapshot = await this.#authorize(connection, quest, "work.read");
        const questCapabilities = capabilities(
          snapshot,
          this.#accountId,
          quest,
          !["completed", "cancelled"].includes(quest.status),
          true,
        );
        const stepCapabilities = capabilities(
          snapshot,
          this.#accountId,
          quest,
          false,
          true,
        );
        return {
          quest: questForUi(quest, questCapabilities),
          steps: (await repository.listSteps(questId)).map((step) =>
            stepForUi(step, stepCapabilities)),
        };
      },
    );
  }

  async createGoal(input: CreateGoalRequest): Promise<string> {
    assertResourceInput(input);
    assertOptionalTimestamp(input.targetAt, "Goal target date");
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const resource = this.#newResource(id, input);
        await this.#authorize(connection, resource, "work.create");
        await this.#assertReferences(connection, input.allowedIdentityIds, input.sourceIds);
        await new GuildWorkRepository(connection, this.#env.GUILD_ID).createGoal({
          ...input,
          id,
          actorIdentityId: this.#accountId,
          ownerIdentityId: this.#accountId,
          chronicleEvent: this.#event("goal.created", "goal", id, { status: "draft" }, resource),
        });
      },
    );
    return id;
  }

  async createProject(input: CreateProjectRequest): Promise<string> {
    assertUuid(input.goalId, "Goal ID");
    assertResourceInput(input);
    assertOptionalTimestamp(input.dueAt, "Project due date");
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const parent = await repository.getGoal(input.goalId);
        await this.#authorize(connection, parent, "work.create");
        const resource = this.#newResource(id, input);
        await this.#authorize(connection, resource, "work.create");
        await this.#assertReferences(connection, input.allowedIdentityIds, input.sourceIds);
        await repository.createProject({
          ...input,
          id,
          actorIdentityId: this.#accountId,
          ownerIdentityId: this.#accountId,
          chronicleEvent: this.#event("project.created", "project", id, {
            goalId: input.goalId,
            status: "planned",
          }, resource),
        });
      },
    );
    return id;
  }

  async createQuest(input: CreateQuestRequest): Promise<string> {
    assertUuid(input.projectId, "Project ID");
    if (input.assigneeIdentityId) assertUuid(input.assigneeIdentityId, "Assignee Identity ID");
    assertResourceInput(input);
    assertOptionalTimestamp(input.dueAt, "Quest due date");
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const parent = await repository.getProject(input.projectId);
        await this.#authorize(connection, parent, "work.create");
        const resource = this.#newResource(id, input);
        await this.#authorize(connection, resource, "work.create");
        await this.#assertReferences(connection, input.allowedIdentityIds, input.sourceIds);
        await this.#assertAssignable(connection, input.assigneeIdentityId, resource);
        await repository.createQuest({
          ...input,
          id,
          actorIdentityId: this.#accountId,
          ownerIdentityId: this.#accountId,
          chronicleEvent: this.#event("quest.created", "quest", id, {
            projectId: input.projectId,
            assigneeIdentityId: input.assigneeIdentityId,
            status: "ready",
          }, resource),
        });
      },
    );
    return id;
  }

  async createStep(input: CreateStepRequest): Promise<string> {
    assertUuid(input.questId, "Quest ID");
    if (input.assigneeIdentityId) assertUuid(input.assigneeIdentityId, "Assignee Identity ID");
    assertWorkText(input.title, input.description);
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const quest = await repository.getQuest(input.questId);
        await this.#authorize(connection, quest, "work.create");
        await this.#assertAssignable(connection, input.assigneeIdentityId, quest);
        await repository.createStep({
          ...input,
          id,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event("step.created", "step", id, {
            questId: input.questId,
            assigneeIdentityId: input.assigneeIdentityId,
            status: "pending",
          }, quest),
        });
      },
    );
    return id;
  }

  async changeStatus(input: WorkStatusRequest): Promise<number> {
    assertUuid(input.id, "Work ID");
    assertVersion(input.expectedVersion);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        if (input.kind === "goal") {
          assertGoalStatus(input.status);
          const resource = await repository.getGoal(input.id);
          await this.#authorize(connection, resource, "work.create");
          return repository.updateGoalStatus({
            ...input,
            status: input.status,
            actorIdentityId: this.#accountId,
            chronicleEvent: this.#event("goal.status.changed", "goal", input.id, {
              from: resource.status,
              to: input.status,
            }, resource),
          });
        }
        if (input.kind === "project") {
          assertProjectStatus(input.status);
          const resource = await repository.getProject(input.id);
          await this.#authorize(connection, resource, "work.create");
          return repository.updateProjectStatus({
            ...input,
            status: input.status,
            actorIdentityId: this.#accountId,
            chronicleEvent: this.#event("project.status.changed", "project", input.id, {
              from: resource.status,
              to: input.status,
            }, resource),
          });
        }
        if (input.kind === "quest") {
          assertQuestStatus(input.status);
          const resource = await repository.getQuest(input.id);
          await this.#authorize(connection, resource, "work.create");
          return repository.updateQuestStatus({
            ...input,
            status: input.status,
            actorIdentityId: this.#accountId,
            chronicleEvent: this.#event("quest.status.changed", "quest", input.id, {
              from: resource.status,
              to: input.status,
            }, resource),
          });
        }
        assertStepStatus(input.status);
        const step = await repository.getStep(input.id);
        const resource = await repository.getQuest(step.questId);
        await this.#authorize(connection, resource, "work.create");
        return repository.updateStepStatus({
          ...input,
          status: input.status,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event("step.status.changed", "step", input.id, {
            from: step.status,
            to: input.status,
          }, resource),
        });
      },
    );
  }

  async assign(input: WorkAssignmentRequest): Promise<number> {
    assertUuid(input.id, "Work ID");
    assertVersion(input.expectedVersion);
    if (input.assigneeIdentityId) assertUuid(input.assigneeIdentityId, "Assignee Identity ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildWorkRepository(connection, this.#env.GUILD_ID);
        const resource = input.kind === "quest"
          ? await repository.getQuest(input.id)
          : await repository.getQuest((await repository.getStep(input.id)).questId);
        await this.#authorize(connection, resource, "work.assign");
        await this.#assertAssignable(connection, input.assigneeIdentityId, resource);
        const assignment = {
          ...input,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event(`${input.kind}.assigned`, input.kind, input.id, {
            assigneeIdentityId: input.assigneeIdentityId,
          }, resource),
        };
        return input.kind === "quest"
          ? repository.assignQuest(assignment)
          : repository.assignStep(assignment);
      },
    );
  }

  async #authorize(
    connection: GuildTransactionConnection,
    resource: SecuredResource,
    permission: Permission,
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      resource.spaceId,
    );
    authorize(snapshot, { actorIdentityId: this.#accountId, permission, resource });
    return snapshot;
  }

  async #assertAssignable(
    connection: GuildTransactionConnection,
    identityId: string | null,
    resource: SecuredResource,
  ): Promise<void> {
    if (identityId === null) return;
    const identity = (await connection.query<{
      kind: string;
      identity_status: string;
      membership_state: string;
      agent_status: string | null;
    }>(
      `SELECT i.kind, i.status AS identity_status, m.state AS membership_state,
              ap.status AS agent_status
         FROM identities i
         JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
         LEFT JOIN agent_profiles ap ON ap.guild_id = i.guild_id AND ap.identity_id = i.id
        WHERE i.guild_id = $1 AND i.id = $2`,
      [this.#env.GUILD_ID, identityId],
    )).rows[0];
    if (!identity || identity.identity_status !== "active" ||
        !["preboarding", "active"].includes(identity.membership_state) ||
        !["human", "agent"].includes(identity.kind) ||
        identity.kind === "agent" && identity.agent_status !== "active") {
      throw new GuildDomainError(
        "INVALID_INPUT",
        "Work can be assigned only to an active Human or Agent.",
      );
    }
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      identityId,
      resource.spaceId,
    );
    authorize(snapshot, { actorIdentityId: identityId, permission: "work.read", resource });
  }

  async #assertReferences(
    connection: GuildTransactionConnection,
    allowedIdentityIds: readonly string[],
    sourceIds: readonly string[],
  ): Promise<void> {
    if (allowedIdentityIds.length > 0) {
      const count = (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM identities
          WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
        [this.#env.GUILD_ID, allowedIdentityIds],
      )).rows[0]?.count;
      if (Number(count ?? 0) !== allowedIdentityIds.length) {
        throw new Error("A shared Work Identity is not active in this Guild.");
      }
    }
    const knowledge = new GuildKnowledgeRepository(connection, this.#env.GUILD_ID);
    for (const sourceId of sourceIds) {
      const source = await knowledge.getKnowledge(sourceId);
      await this.#authorize(connection, source, "knowledge.read");
    }
  }

  #newResource(id: string, input: WorkResourceInput): SecuredResource {
    return {
      id,
      guildId: this.#env.GUILD_ID,
      spaceId: input.spaceId,
      ownerIdentityId: this.#accountId,
      visibility: input.visibility,
      classification: input.classification,
      allowedIdentityIds: input.allowedIdentityIds,
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
