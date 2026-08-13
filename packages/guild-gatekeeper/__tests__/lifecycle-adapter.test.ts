import type { QueryResultRow } from "@guild-os/postgres";
import { describe, expect, it } from "vitest";
import {
  type LifecycleDatabase,
  type LifecycleQueryResult,
  type LifecycleSqlConnection,
  PostgresLifecycleRuntimeRepository,
} from "../src/lifecycle-adapter.js";
import { GuildLifecycleRuntime } from "../src/lifecycle-runtime.js";

const uuid = (suffix: number): string =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const IDS = {
  guild: uuid(1),
  manager: uuid(2),
  human: uuid(3),
  agent: uuid(4),
  successor: uuid(5),
  excluded: uuid(6),
  staffRole: uuid(10),
  managerRole: uuid(11),
  spaceA: uuid(20),
  spaceB: uuid(21),
  memory: uuid(30),
  activityDefinition: uuid(31),
  onboardingPath: uuid(32),
  token: uuid(40),
  credential: uuid(41),
  schedule: uuid(42),
  workflowRequest: uuid(43),
  run: uuid(44),
  approval: uuid(45),
  activity: uuid(50),
  file: uuid(51),
  memoryDraft: uuid(52),
  knowledgeDraft: uuid(53),
  decisionDraft: uuid(54),
} as const;

const NOW = "2026-08-14T04:00:00.000Z";

interface ActorFixture {
  kind: "human" | "agent";
  status: "active" | "disabled";
  membershipState: "joined" | "active" | "paused" | "left" | "blocked";
  membershipOperational: boolean;
  templateKey: "company" | "research";
  isRootOwner: boolean;
  bindings: readonly { roleId: string; spaceId: string | null }[];
}

interface BlueprintMemory {
  memory_id: string;
  memory_version: number;
  title: string;
  instructions: string;
  memory_space_id: string | null;
}

interface BlueprintActivity {
  definition_key: string;
  template_version: number;
  title: string;
  instructions: string;
  activity_type: string;
  target_space_id: string | null;
}

interface GeneratedPath {
  spaceId: string | null;
  templateKey: string;
  version: number;
}

interface GeneratedRequirement {
  pathId: string;
  resourceId: string;
}

interface ConnectionFixture {
  id: string;
  ownerId: string;
  authKind: string;
  status: "active" | "revoked";
}

interface RunFixture {
  id: string;
  workflowInstanceId: string;
  status: "running" | "killed";
}

interface ChronicleFixture {
  action: string;
  subjectId: string;
  details: Record<string, unknown>;
  occurredAt: string;
}

interface HandoverCaseFixture {
  actorId: string;
  successorId: string | null;
}

interface HandoverItemFixture {
  caseId: string;
  resourceType: string;
  resourceId: string;
  title: string;
}

interface ResourceFixture {
  resource_id: string;
  title: string;
}

interface DraftFixture extends ResourceFixture {
  resource_type: "memory" | "knowledge" | "decision";
}

interface FakeState {
  requesterActive: boolean;
  requesterIsRoot: boolean;
  requesterRoleIds: readonly string[];
  requesterCanManageLifecycle: boolean;
  actors: Map<string, ActorFixture>;
  onboardingMemories: readonly BlueprintMemory[];
  onboardingActivities: readonly BlueprintActivity[];
  reconfirmationMemory: BlueprintMemory | null;
  reconfirmationAudience: readonly string[];
  generatedPaths: Map<string, GeneratedPath>;
  generatedRequirements: Map<string, GeneratedRequirement>;
  generatedAssignments: Map<string, string>;
  generatedActivities: Set<string>;
  legacyMembershipStates: Map<string, "preboarding" | "active" | "suspended" | "departed">;
  identityStatuses: Map<string, "active" | "disabled">;
  agentProfileStatuses: Map<string, "active" | "stopped">;
  connections: Map<string, ConnectionFixture>;
  schedules: Map<string, "active" | "paused">;
  workflowRequests: Map<string, "running" | "cancelled">;
  runs: Map<string, RunFixture>;
  approvals: Map<string, "pending" | "expired">;
  openActivities: readonly ResourceFixture[];
  ownedFiles: readonly ResourceFixture[];
  memoryDrafts: readonly DraftFixture[];
  knowledgeDrafts: readonly DraftFixture[];
  decisionDrafts: readonly DraftFixture[];
  handoverCases: Map<string, HandoverCaseFixture>;
  handoverItems: Map<string, HandoverItemFixture>;
  chronicle: Map<string, ChronicleFixture>;
}

interface QueryRecord {
  transactionId: number;
  tag: string;
  text: string;
  values: readonly unknown[];
}

function actorFixture(
  overrides: Partial<ActorFixture> = {},
): ActorFixture {
  return {
    kind: "human",
    status: "active",
    membershipState: "active",
    membershipOperational: true,
    templateKey: "company",
    isRootOwner: false,
    bindings: [{ roleId: IDS.staffRole, spaceId: IDS.spaceA }],
    ...overrides,
  };
}

function baseState(): FakeState {
  return {
    requesterActive: true,
    requesterIsRoot: true,
    requesterRoleIds: [IDS.managerRole],
    requesterCanManageLifecycle: true,
    actors: new Map([
      [IDS.manager, actorFixture({ isRootOwner: true, bindings: [{ roleId: IDS.managerRole, spaceId: null }] })],
    ]),
    onboardingMemories: [],
    onboardingActivities: [],
    reconfirmationMemory: null,
    reconfirmationAudience: [],
    generatedPaths: new Map(),
    generatedRequirements: new Map(),
    generatedAssignments: new Map(),
    generatedActivities: new Set(),
    legacyMembershipStates: new Map([[IDS.manager, "active"]]),
    identityStatuses: new Map([[IDS.manager, "active"]]),
    agentProfileStatuses: new Map(),
    connections: new Map(),
    schedules: new Map(),
    workflowRequests: new Map(),
    runs: new Map(),
    approvals: new Map(),
    openActivities: [],
    ownedFiles: [],
    memoryDrafts: [],
    knowledgeDrafts: [],
    decisionDrafts: [],
    handoverCases: new Map(),
    handoverItems: new Map(),
    chronicle: new Map(),
  };
}

function onboardingState(): FakeState {
  const state = baseState();
  state.actors.set(IDS.human, actorFixture({
    membershipState: "joined",
    bindings: [{ roleId: IDS.staffRole, spaceId: IDS.spaceA }],
  }));
  state.legacyMembershipStates.set(IDS.human, "preboarding");
  state.identityStatuses.set(IDS.human, "active");
  state.onboardingMemories = [{
    memory_id: IDS.memory,
    memory_version: 3,
    title: "Safety manual",
    instructions: "Confirm this canonical version.",
    memory_space_id: IDS.spaceA,
  }];
  state.onboardingActivities = [{
    definition_key: IDS.activityDefinition,
    template_version: 7,
    title: "First shift",
    instructions: "Complete with a manager.",
    activity_type: "task",
    target_space_id: IDS.spaceA,
  }];
  return state;
}

function offboardingState(kind: "human" | "agent" = "human"): FakeState {
  const state = baseState();
  state.actors.set(IDS.human, actorFixture({ kind }));
  state.actors.set(IDS.successor, actorFixture({
    bindings: [{ roleId: IDS.managerRole, spaceId: null }],
  }));
  state.legacyMembershipStates.set(IDS.human, "active");
  state.legacyMembershipStates.set(IDS.successor, "active");
  state.identityStatuses.set(IDS.human, "active");
  state.identityStatuses.set(IDS.successor, "active");
  if (kind === "agent") state.agentProfileStatuses.set(IDS.human, "active");
  state.connections.set(IDS.token, {
    id: IDS.token,
    ownerId: IDS.human,
    authKind: "access_token",
    status: "active",
  });
  state.connections.set(IDS.credential, {
    id: IDS.credential,
    ownerId: IDS.human,
    authKind: "oauth",
    status: "active",
  });
  state.schedules.set(IDS.schedule, "active");
  state.workflowRequests.set(IDS.workflowRequest, "running");
  state.runs.set(IDS.run, {
    id: IDS.run,
    workflowInstanceId: "workflow-instance-1",
    status: "running",
  });
  state.approvals.set(IDS.approval, "pending");
  state.openActivities = [{ resource_id: IDS.activity, title: "Open activity" }];
  state.ownedFiles = [{ resource_id: IDS.file, title: "Owned file" }];
  state.memoryDrafts = [{
    resource_id: IDS.memoryDraft,
    resource_type: "memory",
    title: "Private memory title",
  }];
  state.knowledgeDrafts = [{
    resource_id: IDS.knowledgeDraft,
    resource_type: "knowledge",
    title: "Knowledge draft",
  }];
  state.decisionDrafts = [{
    resource_id: IDS.decisionDraft,
    resource_type: "decision",
    title: "Decision draft",
  }];
  return state;
}

function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly object[] = [],
): LifecycleQueryResult<Row> {
  return {
    rows: [...rows] as unknown as Row[],
    rowCount: rows.length,
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new Error("Expected serialized JSON.");
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

class FakeConnection implements LifecycleSqlConnection {
  readonly #state: FakeState;
  readonly #queries: QueryRecord[];
  readonly #transactionId: number;
  readonly #failureTag: string | null;

  constructor(
    state: FakeState,
    queries: QueryRecord[],
    transactionId: number,
    failureTag: string | null,
  ) {
    this.#state = state;
    this.#queries = queries;
    this.#transactionId = transactionId;
    this.#failureTag = failureTag;
  }

  #string(values: readonly unknown[], index: number): string {
    const value = values[index];
    if (typeof value !== "string") throw new Error(`Expected string parameter ${index}.`);
    return value;
  }

  #strings(values: readonly unknown[], index: number): readonly string[] {
    const value = values[index];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`Expected string-array parameter ${index}.`);
    }
    return value as string[];
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    inputValues: readonly unknown[] = [],
  ): Promise<LifecycleQueryResult<Row>> {
    const match = /\/\* lifecycle-adapter:([a-z-]+) \*\//.exec(text);
    if (!match?.[1]) throw new Error(`Unlabelled lifecycle SQL: ${text}`);
    const tag = match[1];
    const values = [...inputValues];
    this.#queries.push({ transactionId: this.#transactionId, tag, text, values });
    if (tag === this.#failureTag) throw new Error(`Injected SQL failure at ${tag}`);

    switch (tag) {
      case "actor-context":
      case "advisory-lock":
      case "cancel-agent-outbox":
      case "enqueue-agent-termination":
      case "cancel-agent-delegations":
      case "transfer-open-activities":
        return queryResult<Row>();
      case "permission-subject":
        return this.#state.requesterActive ? queryResult<Row>([{
          kind: "human",
          identity_status: "active",
          membership_state: "active",
          is_root_owner: this.#state.requesterIsRoot,
        }]) : queryResult<Row>();
      case "permission-roles":
        return queryResult<Row>(this.#state.requesterRoleIds.map((roleId) => ({ role_id: roleId })));
      case "permission-grants":
        return this.#state.requesterCanManageLifecycle
          ? queryResult<Row>([{ permission: "lifecycle.manage" }])
          : queryResult<Row>();
      case "actor": {
        const actorId = this.#string(values, 1);
        const actor = this.#state.actors.get(actorId);
        return actor ? queryResult<Row>([{
          actor_id: actorId,
          kind: actor.kind,
          actor_status: actor.status,
          membership_state: actor.membershipState,
          membership_operational: actor.membershipOperational,
          template_key: actor.templateKey,
          is_root_owner: actor.isRootOwner,
        }]) : queryResult<Row>();
      }
      case "actor-bindings": {
        const actor = this.#state.actors.get(this.#string(values, 1));
        return queryResult<Row>((actor?.bindings ?? []).map((binding) => ({
          role_id: binding.roleId,
          space_id: binding.spaceId,
        })));
      }
      case "onboarding-path-blueprints":
        return this.#state.onboardingMemories.length === 0 &&
            this.#state.onboardingActivities.length === 0
          ? queryResult<Row>()
          : queryResult<Row>([{
              path_id: IDS.onboardingPath,
              path_version: 7,
              name: "Company onboarding",
              description: "Read, confirm, and complete the guided activity.",
              path_space_id: IDS.spaceA,
              template_key: "company",
              applicable_role_ids: [IDS.staffRole],
            }]);
      case "onboarding-path-activities":
        return queryResult<Row>(this.#state.onboardingActivities.map((activity) => ({
          path_id: IDS.onboardingPath,
          ...activity,
        })));
      case "onboarding-memory-blueprints":
        return queryResult<Row>(this.#state.onboardingMemories);
      case "onboarding-activity-blueprints":
        return queryResult<Row>(this.#state.onboardingActivities);
      case "reconfirmation-memory":
        return this.#state.reconfirmationMemory
          ? queryResult<Row>([this.#state.reconfirmationMemory]) : queryResult<Row>();
      case "reconfirmation-audience":
        return queryResult<Row>(this.#state.reconfirmationAudience.map((id) => ({ id })));
      case "existing-requirements": {
        const requested = new Set(this.#strings(values, 1));
        const rows: Record<string, unknown>[] = [];
        for (const [requirementId, requirement] of this.#state.generatedRequirements) {
          if (!requested.has(requirementId)) continue;
          for (const assignmentKey of this.#state.generatedAssignments.keys()) {
            const [actorId, pathId] = assignmentKey.split(":");
            if (pathId === requirement.pathId && actorId) {
              rows.push({ requirement_id: requirementId, actor_id: actorId });
            }
          }
        }
        return queryResult<Row>(rows);
      }
      case "existing-path-assignments": {
        const actorIds = new Set(this.#strings(values, 1));
        const pathIds = new Set(this.#strings(values, 2));
        return queryResult<Row>([...this.#state.generatedAssignments.keys()].flatMap((key) => {
          const [actorId, pathId] = key.split(":");
          return actorId && pathId && actorIds.has(actorId) && pathIds.has(pathId)
            ? [{ actor_id: actorId, path_id: pathId }] : [];
        }));
      }
      case "insert-path-initial-activity": {
        const id = this.#string(values, 0);
        const before = this.#state.generatedActivities.size;
        this.#state.generatedActivities.add(id);
        return queryResult<Row>(before === this.#state.generatedActivities.size ? [] : [{ id }]);
      }
      case "insert-path-assignment": {
        const id = this.#string(values, 0);
        const key = `${this.#string(values, 2)}:${this.#string(values, 3)}`;
        if (this.#state.generatedAssignments.has(key)) return queryResult<Row>();
        this.#state.generatedAssignments.set(key, id);
        return queryResult<Row>([{ id }]);
      }
      case "verify-path-assignment": {
        const key = `${this.#string(values, 1)}:${this.#string(values, 2)}`;
        const id = this.#state.generatedAssignments.get(key);
        return id ? queryResult<Row>([{ id }]) : queryResult<Row>();
      }
      case "insert-initial-activity": {
        const id = this.#string(values, 0);
        const before = this.#state.generatedActivities.size;
        this.#state.generatedActivities.add(id);
        return queryResult<Row>(before === this.#state.generatedActivities.size ? [] : [{ id }]);
      }
      case "insert-generated-path": {
        const id = this.#string(values, 0);
        if (!this.#state.generatedPaths.has(id)) {
          this.#state.generatedPaths.set(id, {
            spaceId: values[2] === null ? null : this.#string(values, 2),
            templateKey: this.#string(values, 3),
            version: Number(values[7]),
          });
        }
        return queryResult<Row>();
      }
      case "insert-generated-requirement": {
        const id = this.#string(values, 0);
        if (!this.#state.generatedRequirements.has(id)) {
          this.#state.generatedRequirements.set(id, {
            pathId: this.#string(values, 2),
            resourceId: this.#string(values, 4),
          });
        }
        return queryResult<Row>();
      }
      case "insert-generated-assignment": {
        const id = this.#string(values, 0);
        const actorId = this.#string(values, 2);
        const pathId = this.#string(values, 3);
        const key = `${actorId}:${pathId}`;
        if (this.#state.generatedAssignments.has(key)) return queryResult<Row>();
        this.#state.generatedAssignments.set(key, id);
        return queryResult<Row>([{ id }]);
      }
      case "verify-generated-assignment": {
        const key = `${this.#string(values, 1)}:${this.#string(values, 2)}`;
        const id = this.#state.generatedAssignments.get(key);
        return id ? queryResult<Row>([{ id }]) : queryResult<Row>();
      }
      case "offboarding-connections":
        return queryResult<Row>([...this.#state.connections.values()]
          .filter((connection) => connection.ownerId === this.#string(values, 1) &&
            connection.status !== "revoked")
          .map((connection) => ({ id: connection.id, auth_kind: connection.authKind })));
      case "offboarding-schedules":
        return queryResult<Row>([...this.#state.schedules]
          .filter(([, status]) => status === "active").map(([id]) => ({ id })));
      case "offboarding-workflow-requests":
        return queryResult<Row>([...this.#state.workflowRequests]
          .filter(([, status]) => status === "running").map(([id]) => ({ id })));
      case "offboarding-agent-runs":
        return queryResult<Row>([...this.#state.runs.values()]
          .filter((run) => run.status === "running")
          .map((run) => ({ id: run.id, workflow_instance_id: run.workflowInstanceId })));
      case "offboarding-approvals":
        return queryResult<Row>([...this.#state.approvals]
          .filter(([, status]) => status === "pending").map(([id]) => ({ id })));
      case "offboarding-activities":
        return queryResult<Row>(this.#state.openActivities);
      case "offboarding-files":
        return queryResult<Row>(this.#state.ownedFiles);
      case "offboarding-memory-drafts":
        return queryResult<Row>(this.#state.memoryDrafts);
      case "offboarding-knowledge-drafts":
        return queryResult<Row>(this.#state.knowledgeDrafts);
      case "offboarding-decision-drafts":
        return queryResult<Row>(this.#state.decisionDrafts);
      case "find-offboarding-receipt": {
        const handoverId = this.#string(values, 1);
        const eventId = this.#string(values, 2);
        const handover = this.#state.handoverCases.get(handoverId);
        const event = this.#state.chronicle.get(eventId);
        if (!handover || !event || event.action !== "lifecycle.actor.offboarded") {
          return queryResult<Row>();
        }
        const itemCount = [...this.#state.handoverItems.values()]
          .filter((item) => item.caseId === handoverId).length;
        return queryResult<Row>([{
          handover_id: handoverId,
          actor_id: handover.actorId,
          details: event.details,
          occurred_at: event.occurredAt,
          handover_item_count: String(itemCount),
        }]);
      }
      case "stop-membership": {
        const actorId = this.#string(values, 1);
        const current = this.#state.legacyMembershipStates.get(actorId);
        if (!current || current === "departed") return queryResult<Row>();
        this.#state.legacyMembershipStates.set(actorId, "departed");
        const actor = this.#state.actors.get(actorId);
        if (actor) {
          actor.membershipState = "left";
          actor.membershipOperational = false;
        }
        return queryResult<Row>([{ id: actorId }]);
      }
      case "stop-identity": {
        const actorId = this.#string(values, 1);
        if (this.#state.identityStatuses.get(actorId) !== "active") return queryResult<Row>();
        this.#state.identityStatuses.set(actorId, "disabled");
        const actor = this.#state.actors.get(actorId);
        if (actor) actor.status = "disabled";
        return queryResult<Row>([{ id: actorId }]);
      }
      case "stop-agent-profile": {
        const actorId = this.#string(values, 1);
        if (this.#state.agentProfileStatuses.get(actorId) !== "active") return queryResult<Row>();
        this.#state.agentProfileStatuses.set(actorId, "stopped");
        return queryResult<Row>([{ id: actorId }]);
      }
      case "revoke-connections": {
        const ids = new Set(this.#strings(values, 2));
        const rows: Record<string, unknown>[] = [];
        for (const connection of this.#state.connections.values()) {
          if (ids.has(connection.id) && connection.status === "active") {
            connection.status = "revoked";
            rows.push({ id: connection.id, auth_kind: connection.authKind });
          }
        }
        return queryResult<Row>(rows);
      }
      case "stop-schedules": {
        const rows: Record<string, unknown>[] = [];
        for (const id of this.#strings(values, 1)) {
          if (this.#state.schedules.get(id) === "active") {
            this.#state.schedules.set(id, "paused");
            rows.push({ id });
          }
        }
        return queryResult<Row>(rows);
      }
      case "cancel-workflow-requests": {
        const rows: Record<string, unknown>[] = [];
        for (const id of this.#strings(values, 1)) {
          if (this.#state.workflowRequests.get(id) === "running") {
            this.#state.workflowRequests.set(id, "cancelled");
            rows.push({ id });
          }
        }
        return queryResult<Row>(rows);
      }
      case "kill-agent-runs": {
        const rows: Record<string, unknown>[] = [];
        for (const id of this.#strings(values, 1)) {
          const run = this.#state.runs.get(id);
          if (run?.status === "running") {
            run.status = "killed";
            rows.push({ id });
          }
        }
        return queryResult<Row>(rows);
      }
      case "expire-approvals": {
        const rows: Record<string, unknown>[] = [];
        for (const id of this.#strings(values, 1)) {
          if (this.#state.approvals.get(id) === "pending") {
            this.#state.approvals.set(id, "expired");
            rows.push({ id });
          }
        }
        return queryResult<Row>(rows);
      }
      case "create-handover": {
        const id = this.#string(values, 0);
        if (!this.#state.handoverCases.has(id)) {
          this.#state.handoverCases.set(id, {
            actorId: this.#string(values, 2),
            successorId: values[3] === null ? null : this.#string(values, 3),
          });
        }
        return queryResult<Row>();
      }
      case "create-handover-item": {
        const id = this.#string(values, 0);
        const caseId = this.#string(values, 2);
        const resourceType = this.#string(values, 3);
        const resourceId = this.#string(values, 4);
        const duplicate = [...this.#state.handoverItems.values()].some((item) =>
          item.caseId === caseId && item.resourceType === resourceType &&
          item.resourceId === resourceId);
        if (duplicate) return queryResult<Row>();
        this.#state.handoverItems.set(id, {
          caseId,
          resourceType,
          resourceId,
          title: this.#string(values, 5),
        });
        return queryResult<Row>([{ id }]);
      }
      case "verify-handover-item": {
        const caseId = this.#string(values, 1);
        const resourceType = this.#string(values, 2);
        const resourceId = this.#string(values, 3);
        const found = [...this.#state.handoverItems].find(([, item]) =>
          item.caseId === caseId && item.resourceType === resourceType &&
          item.resourceId === resourceId);
        return found ? queryResult<Row>([{ id: found[0] }]) : queryResult<Row>();
      }
      case "offboarding-seal": {
        const actorId = this.#string(values, 1);
        const actor = this.#state.actors.get(actorId);
        const activeConnections = [...this.#state.connections.values()].filter((connection) =>
          connection.ownerId === actorId && connection.status !== "revoked");
        return queryResult<Row>([{
          identity_operational: actor?.status === "active",
          membership_operational: actor?.membershipOperational ?? false,
          agent_operational: this.#state.agentProfileStatuses.get(actorId) === "active",
          active_access_tokens: String(activeConnections
            .filter((connection) => connection.authKind === "access_token").length),
          active_connector_credentials: String(activeConnections
            .filter((connection) => connection.authKind !== "access_token").length),
          active_schedules: String(
            [...this.#state.schedules.values()].filter((status) => status === "active").length +
            [...this.#state.workflowRequests.values()].filter((status) => status === "running").length,
          ),
          active_agent_runs: String(
            [...this.#state.runs.values()].filter((run) => run.status === "running").length,
          ),
          pending_approvals: String(
            [...this.#state.approvals.values()].filter((status) => status === "pending").length,
          ),
        }]);
      }
      case "append-chronicle": {
        const id = this.#string(values, 0);
        if (this.#state.chronicle.has(id)) return queryResult<Row>();
        const event: ChronicleFixture = {
          action: this.#string(values, 3),
          subjectId: this.#string(values, 5),
          details: parseRecord(values[8]),
          occurredAt: this.#string(values, 7),
        };
        this.#state.chronicle.set(id, event);
        return queryResult<Row>([{ action: event.action, subject_id: event.subjectId }]);
      }
      case "verify-chronicle": {
        const event = this.#state.chronicle.get(this.#string(values, 1));
        return event ? queryResult<Row>([{
          action: event.action,
          subject_id: event.subjectId,
        }]) : queryResult<Row>();
      }
      default:
        throw new Error(`Unhandled lifecycle SQL tag: ${tag}`);
    }
  }
}

class FakeDatabase implements LifecycleDatabase {
  state: FakeState;
  readonly queries: QueryRecord[] = [];
  transactionCount = 0;
  failureTag: string | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(state: FakeState) {
    this.state = state;
  }

  async transaction<T>(
    guildId: string,
    operation: (connection: LifecycleSqlConnection) => Promise<T>,
  ): Promise<T> {
    expect(guildId).toBe(IDS.guild);
    let release = (): void => undefined;
    const previous = this.#tail;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.transactionCount += 1;
    const transactionId = this.transactionCount;
    const working = cloneState(this.state);
    try {
      const result = await operation(new FakeConnection(
        working,
        this.queries,
        transactionId,
        this.failureTag,
      ));
      this.state = working;
      return result;
    } finally {
      release();
    }
  }
}

function runtime(database: LifecycleDatabase): GuildLifecycleRuntime {
  return new GuildLifecycleRuntime(new PostgresLifecycleRuntimeRepository({
    connectionString: "",
    guildId: IDS.guild,
    requesterActorId: IDS.manager,
    database,
  }));
}

function chronicle(reason = "Lifecycle policy reconciliation") {
  return {
    performedByActorId: IDS.manager,
    correlationId: uuid(900),
    occurredAt: NOW,
    reason,
    source: "adapter-test-private-source",
  } as const;
}

describe("PostgresLifecycleRuntimeRepository", () => {
  it("assigns Template, Role, and Space-scoped onboarding once under concurrent calls", async () => {
    const database = new FakeDatabase(onboardingState());
    const coordinator = runtime(database);
    const input = { guildId: IDS.guild, actorId: IDS.human, chronicle: chronicle() };

    const results = await Promise.all([
      coordinator.synchronizeOnboarding(input),
      coordinator.synchronizeOnboarding(input),
    ]);

    expect(results.map((result) => result.insertedRequirementKeys.length).sort()).toEqual([0, 1]);
    expect(database.state.generatedAssignments).toHaveLength(1);
    expect(database.state.generatedActivities).toHaveLength(1);
    expect(database.state.generatedPaths).toHaveLength(0);
    expect(database.state.generatedAssignments.has(`${IDS.human}:${IDS.onboardingPath}`)).toBe(true);
    const memoryQuery = database.queries.find((query) =>
      query.tag === "onboarding-memory-blueprints");
    expect(memoryQuery?.text).toContain("path.template_key = settings.template_key");
    expect(memoryQuery?.text).toContain("actor_role_bindings");
    expect(database.queries.filter((query) => query.tag === "actor-bindings")).not.toHaveLength(0);
    expect(database.queries.filter((query) => query.tag === "advisory-lock")).toHaveLength(2);
  });

  it("creates only version-targeted Canonical Memory reconfirmation assignments", async () => {
    const state = onboardingState();
    state.actors.get(IDS.human)!.membershipState = "active";
    state.legacyMembershipStates.set(IDS.human, "active");
    state.reconfirmationAudience = [IDS.human];
    state.reconfirmationMemory = {
      ...state.onboardingMemories[0]!,
      memory_version: 4,
    };
    const database = new FakeDatabase(state);
    const coordinator = runtime(database);

    const versionFour = await coordinator.reconcileCanonicalMemory({
      guildId: IDS.guild,
      memoryId: IDS.memory,
      chronicle: chronicle(),
    });
    database.state.reconfirmationMemory = {
      ...database.state.reconfirmationMemory!,
      memory_version: 5,
    };
    const versionFive = await coordinator.reconcileCanonicalMemory({
      guildId: IDS.guild,
      memoryId: IDS.memory,
      chronicle: chronicle(),
    });
    const duplicate = await coordinator.reconcileCanonicalMemory({
      guildId: IDS.guild,
      memoryId: IDS.memory,
      chronicle: chronicle(),
    });

    expect(versionFour.insertedRequirementKeys).toHaveLength(1);
    expect(versionFive.insertedRequirementKeys).toHaveLength(1);
    expect(duplicate.insertedRequirementKeys).toEqual([]);
    expect([...database.state.generatedPaths.values()].map((path) => path.version).sort())
      .toEqual([4, 5]);
    expect([...database.state.generatedAssignments.keys()]
      .every((key) => key.startsWith(`${IDS.human}:`))).toBe(true);
    const audienceQuery = database.queries.find((query) => query.tag === "reconfirmation-audience");
    expect(audienceQuery?.text).toContain("path.template_key = settings.template_key");
    expect(audienceQuery?.text).toContain("memory.space_id");
  });

  it("revalidates the current Human permission before every transaction", async () => {
    const state = onboardingState();
    state.requesterIsRoot = false;
    state.requesterCanManageLifecycle = false;
    const database = new FakeDatabase(state);
    const coordinator = runtime(database);
    const input = { guildId: IDS.guild, actorId: IDS.human, chronicle: chronicle() };

    await expect(coordinator.synchronizeOnboarding(input))
      .rejects.toThrow("does not have lifecycle.manage");
    expect(database.state.generatedAssignments).toHaveLength(0);

    database.state.requesterCanManageLifecycle = true;
    await expect(coordinator.synchronizeOnboarding(input)).resolves.toMatchObject({
      insertedRequirementKeys: expect.any(Array),
    });
    expect(database.queries.filter((query) => query.tag === "permission-subject"))
      .toHaveLength(2);
  });

  it("revokes every access surface and records explicit handover without Chronicle plaintext", async () => {
    const database = new FakeDatabase(offboardingState());
    const coordinator = runtime(database);
    const privateReason = "Private departure details secret://connector-reference";

    const receipt = await coordinator.offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: chronicle(privateReason),
    });

    expect(receipt).toMatchObject({
      actorId: IDS.human,
      actorKind: "human",
      revokedAccessTokenCount: 1,
      revokedConnectorCredentialCount: 1,
      stoppedScheduledRunCount: 1,
      killedAgentRunCount: 1,
      expiredApprovalCount: 1,
      handoverItemCount: 5,
    });
    expect(database.state.identityStatuses.get(IDS.human)).toBe("disabled");
    expect(database.state.legacyMembershipStates.get(IDS.human)).toBe("departed");
    expect([...database.state.connections.values()].every((item) => item.status === "revoked"))
      .toBe(true);
    expect(database.state.schedules.get(IDS.schedule)).toBe("paused");
    expect(database.state.workflowRequests.get(IDS.workflowRequest)).toBe("cancelled");
    expect(database.state.runs.get(IDS.run)?.status).toBe("killed");
    expect(database.state.approvals.get(IDS.approval)).toBe("expired");
    expect([...database.state.handoverItems.values()].map((item) => item.resourceType).sort())
      .toEqual(["activity", "decision", "file", "knowledge", "memory"]);

    const storedEvent = [...database.state.chronicle.values()].find((event) =>
      event.action === "lifecycle.actor.offboarded");
    const serializedDetails = JSON.stringify(storedEvent?.details);
    expect(serializedDetails).not.toContain(privateReason);
    expect(serializedDetails).not.toContain("adapter-test-private-source");
    expect(storedEvent?.details).toMatchObject({
      source: "lifecycle-runtime-adapter",
      reasonSupplied: true,
      handoverItemCount: 5,
    });
    expect(database.queries.some((query) => query.text.includes("secret_reference"))).toBe(false);

    const mutationTags = new Set([
      "stop-membership", "stop-identity", "revoke-connections", "stop-schedules",
      "cancel-workflow-requests", "kill-agent-runs", "expire-approvals",
      "create-handover", "create-handover-item", "append-chronicle",
    ]);
    expect(database.queries.filter((query) => mutationTags.has(query.tag))
      .every((query) => query.transactionId === 1)).toBe(true);

    const repeated = await coordinator.offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: chronicle(privateReason),
    });
    expect(repeated).toEqual(receipt);
    expect(database.queries.filter((query) => query.tag === "stop-membership")).toHaveLength(1);
  });

  it("rolls back the entire offboarding transaction after a partial SQL failure", async () => {
    const initial = offboardingState();
    const database = new FakeDatabase(cloneState(initial));
    database.failureTag = "revoke-connections";

    await expect(runtime(database).offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: IDS.successor,
      chronicle: chronicle(),
    })).rejects.toThrow("Injected SQL failure at revoke-connections");

    expect(database.state.identityStatuses.get(IDS.human)).toBe("active");
    expect(database.state.legacyMembershipStates.get(IDS.human)).toBe("active");
    expect([...database.state.connections.values()].every((item) => item.status === "active"))
      .toBe(true);
    expect(database.state.handoverCases).toHaveLength(0);
    expect(database.state.chronicle).toHaveLength(0);
  });

  it("stops the Agent profile in the same offboarding transaction", async () => {
    const state = offboardingState("agent");
    state.openActivities = [];
    state.ownedFiles = [];
    state.memoryDrafts = [];
    state.knowledgeDrafts = [];
    state.decisionDrafts = [];
    const database = new FakeDatabase(state);

    const receipt = await runtime(database).offboardActor({
      guildId: IDS.guild,
      actorId: IDS.human,
      successorActorId: null,
      chronicle: chronicle(),
    });

    expect(receipt.actorKind).toBe("agent");
    expect(database.state.agentProfileStatuses.get(IDS.human)).toBe("stopped");
    const profileStop = database.queries.find((query) => query.tag === "stop-agent-profile");
    expect(profileStop?.transactionId).toBe(1);
  });
});
