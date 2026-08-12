import {
  CLASSIFICATIONS,
  VISIBILITIES,
  approvalRequirement,
  assertAgentRunPlan,
  assertNonBlank,
  assertUsageWithinLimits,
  authorize,
  authorizeAgent,
  intersectAgentLimits,
  isAuthorized,
  type AgentApprovalRequest,
  type AgentLimits,
  type AgentRun,
  type AgentRunResult,
  type AgentRunUsage,
  type AuthorizationSnapshot,
  type JsonValue,
  type Permission,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  loadAgentAuthorizationSnapshot,
  withGuildTransaction,
  type AgentRunListCursor,
  type GuildTransactionConnection,
  type StoredAgentRun,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  CreateAgentWebhookRunRequest,
  ReviewAgentRunRequest,
  UiAgentRun,
  UiAgentRunDetail,
  UiAgentRunPage,
  UiAgentRunPageRequest,
} from "./management-types.js";
import type { GuildAgentExecutionContext } from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_PAGE_SIZE = 30;
const MAX_ALLOWED_IDENTITIES = 100;
const APPROVAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const WORKFLOW_PERMISSIONS = new Set<Permission>(["integration.execute"]);
const WEBHOOK_TOOL_ID = "https_webhook";

type RunSource = AgentRun["source"];

export interface AgentExecutionClaim {
  runId: string;
  guildId: string;
  agentIdentityId: string;
  requesterIdentityId: string;
  eventType: string;
  payloadJson: string;
  idempotencyKey: string;
  plannedSteps: number;
  endpointUrl: string;
  effectiveLimits: AgentLimits;
}

export interface AgentWorkflowState {
  status: AgentRun["status"];
  workflowInstanceId: string;
  approvalStatus: AgentApprovalRequest["status"] | null;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertVisibilityAndClassification(input: CreateAgentWebhookRunRequest): void {
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Agent run visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Agent run classification is invalid.");
  }
  if (!Array.isArray(input.allowedIdentityIds) ||
      input.allowedIdentityIds.length > MAX_ALLOWED_IDENTITIES ||
      new Set(input.allowedIdentityIds).size !== input.allowedIdentityIds.length) {
    throw new Error(
      `Agent run access list must contain at most ${MAX_ALLOWED_IDENTITIES} unique Identities.`,
    );
  }
  for (const identityId of input.allowedIdentityIds) {
    assertUuid(identityId, "Allowed Identity ID");
  }
  if (!["private", "restricted"].includes(input.visibility) &&
      input.allowedIdentityIds.length > 0) {
    throw new Error("Explicit Identity access is valid only for private or restricted Agent runs.");
  }
}

function assertInput(input: CreateAgentWebhookRunRequest): void {
  assertUuid(input.requestId, "Agent request ID");
  assertUuid(input.agentIdentityId, "Agent Identity ID");
  assertUuid(input.connectorId, "Connector ID");
  assertUuid(input.spaceId, "Space ID");
  if (input.questId !== null) assertUuid(input.questId, "Quest ID");
  assertVisibilityAndClassification(input);
  assertAgentRunPlan({
    objective: input.objective,
    expectedOutcome: input.expectedOutcome,
    steps: input.steps,
    connectorId: input.connectorId,
    questId: input.questId,
    action: {
      kind: "https_webhook",
      eventType: input.eventType,
      payload: input.payload,
    },
    estimatedUsage: input.estimatedUsage,
  });
  if (input.estimatedUsage.budgetMinor !== 0 || input.estimatedUsage.tokens !== 0 ||
      input.estimatedUsage.retries !== 0 ||
      input.estimatedUsage.delegationDepth !== 0) {
    throw new Error(
      "The v1 Webhook action requires zero budget, tokens, retries, and delegation depth.",
    );
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

async function requestHash(
  input: CreateAgentWebhookRunRequest,
  source: RunSource,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({
    ...input,
    source,
    steps: [...input.steps],
    allowedIdentityIds: [...input.allowedIdentityIds].sort(),
  } as unknown as JsonValue));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function encodeCursor(cursor: AgentRunListCursor | null): string | null {
  return cursor === null ? null : bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(cursor)),
  );
}

function decodeCursor(value: string | null | undefined): AgentRunListCursor | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Agent run cursor is malformed.");
  try {
    const candidate: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!candidate || typeof candidate !== "object") throw new Error("invalid cursor");
    const cursor = candidate as Readonly<Record<string, unknown>>;
    if (typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" ||
        Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error("invalid cursor");
    assertUuid(cursor.id, "Agent run cursor ID");
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new Error("Agent run cursor is malformed.");
  }
}

function runResource(run: AgentRun): SecuredResource {
  return {
    id: run.id,
    guildId: run.guildId,
    spaceId: run.spaceId,
    ownerIdentityId: run.ownerIdentityId,
    visibility: run.visibility,
    classification: run.classification,
    allowedIdentityIds: run.allowedIdentityIds,
  };
}

function capabilities(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  run: StoredAgentRun,
) {
  const resource = runResource(run);
  return {
    review: run.status === "awaiting_approval" && run.approval?.status === "pending" &&
      isAuthorized(snapshot, {
        actorIdentityId,
        permission: "agent.approve",
        resource,
      }),
    stop: ["planning", "awaiting_approval", "running"].includes(run.status) &&
      isAuthorized(snapshot, {
        actorIdentityId,
        permission: "agent.stop",
        resource,
      }),
  };
}

function runForUi(
  run: StoredAgentRun,
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
): UiAgentRun {
  const {
    guildId: _guildId,
    workflowPermissions: _workflowPermissions,
    connectorPermissionsSnapshot: _connectorPermissionsSnapshot,
    ...value
  } = run;
  return { ...value, capabilities: capabilities(snapshot, actorIdentityId, run) };
}

function approvalFor(
  guildId: string,
  runId: string,
  snapshot: AuthorizationSnapshot,
): AgentApprovalRequest {
  const now = new Date();
  const requirement = approvalRequirement(snapshot.constitution, 2);
  return {
    id: crypto.randomUUID(),
    guildId,
    agentRunId: runId,
    riskLevel: 2,
    actionKind: "https_webhook.post",
    requiredApprovals: requirement.approvals,
    approvalCount: 0,
    reauthenticationRequired: requirement.reauthenticationRequired,
    status: "pending",
    expiresAt: new Date(now.valueOf() + APPROVAL_LIFETIME_MS).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function assertDeploymentConnector(env: GuildEnv, connector: Awaited<
  ReturnType<GuildAgentRunRepository["getConnector"]>
>): void {
  if (connector.id !== env.GUILD_WEBHOOK_CONNECTOR_ID ||
      connector.endpointUrl !== env.GUILD_WEBHOOK_URL ||
      connector.secretReference !== "GUILD_WEBHOOK_SIGNING_SECRET" ||
      !connector.deploymentManaged || connector.kind !== "https_webhook") {
    throw new Error("Webhook Connector does not match this immutable deployment configuration.");
  }
  if (connector.status !== "active") throw new Error("Webhook Connector is not active.");
}

function currentAgentLimits(snapshot: AuthorizationSnapshot, agentIdentityId: string): AgentLimits {
  const profile = snapshot.agents.find((candidate) => candidate.identityId === agentIdentityId);
  if (!profile || profile.status !== "active") throw new Error("Agent is stopped.");
  if (!profile.toolIds.includes(WEBHOOK_TOOL_ID)) {
    throw new Error("Agent is not allowed to use the HTTPS Webhook tool.");
  }
  return intersectAgentLimits(profile.limits, snapshot.constitution.agentDefaults);
}

function authorizeExecution(
  snapshot: AuthorizationSnapshot,
  run: StoredAgentRun,
  connectorPermissions: ReadonlySet<Permission>,
): AgentLimits {
  const resource = runResource(run);
  authorize(snapshot, {
    actorIdentityId: run.requesterIdentityId,
    permission: "agent.run",
    resource,
  });
  authorizeAgent(snapshot, {
    agentIdentityId: run.agentIdentityId,
    requesterIdentityId: run.requesterIdentityId,
    permission: "integration.execute",
    workflowPermissions: new Set(run.workflowPermissions),
    connectorPermissions,
    resource,
  });
  const current = currentAgentLimits(snapshot, run.agentIdentityId);
  const effective = intersectAgentLimits(run.limits, current);
  assertUsageWithinLimits(effective, run.plan.estimatedUsage);
  return effective;
}

export class GuildAgentService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getExecutionContext(): Promise<GuildAgentExecutionContext> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const runSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "agent.run",
        );
        const readConnectorSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.read",
        );
        const executeSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.execute",
        );
        const readable = new Set(readConnectorSpaces.map((space) => space.id));
        const executable = new Set(executeSpaces.map((space) => space.id));
        const spaces = runSpaces
          .filter((space) => readable.has(space.id) && executable.has(space.id))
          .slice(0, 100);
        const agents = await repository.listRunnableAgents(spaces.map((space) => space.id));
        const connectors = spaces.length === 0 || agents.length === 0
          ? []
          : await repository.listActiveDeploymentConnectors();
        return {
          spaces: spaces.map((space) => ({
            id: space.id,
            name: space.name,
            parentSpaceId: space.parentSpaceId,
          })),
          agents: agents.map((agent) => ({
            identityId: agent.identityId,
            displayName: agent.displayName,
            model: agent.model,
            spaceIds: [...agent.spaceIds],
            limits: agent.limits,
          })),
          connectors: connectors.map((connector) => ({
            id: connector.id,
            name: connector.name,
            kind: connector.kind,
          })),
        };
      },
    );
  }

  async getPage(request: UiAgentRunPageRequest = {}): Promise<UiAgentRunPage> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const page = await repository.listRuns(
          this.#accountId,
          decodeCursor(request.cursor),
          AGENT_PAGE_SIZE,
        );
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const items: UiAgentRun[] = [];
        for (const run of page.items) {
          const key = run.spaceId ?? "global";
          let snapshot = snapshots.get(key);
          if (!snapshot) {
            snapshot = loadActorAuthorizationSnapshot(
              connection,
              this.#env.GUILD_ID,
              this.#accountId,
              run.spaceId,
            );
            snapshots.set(key, snapshot);
          }
          const resolved = await snapshot;
          authorize(resolved, {
            actorIdentityId: this.#accountId,
            permission: "agent.read",
            resource: runResource(run),
          });
          items.push(runForUi(run, resolved, this.#accountId));
        }

        const runSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "agent.run",
        );
        const readConnectorSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.read",
        );
        const executeSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "integration.execute",
        );
        const readIds = new Set(readConnectorSpaces.map((space) => space.id));
        const executeIds = new Set(executeSpaces.map((space) => space.id));
        const runnableSpaceIds = runSpaces
          .map((space) => space.id)
          .filter((spaceId) => readIds.has(spaceId) && executeIds.has(spaceId));
        const runnableAgents = await repository.listRunnableAgents(runnableSpaceIds);
        const connectors = runnableSpaceIds.length === 0 || runnableAgents.length === 0
          ? []
          : (await repository.listActiveDeploymentConnectors()).map((connector) => ({
            id: connector.id,
            name: connector.name,
            kind: connector.kind,
            status: connector.status,
            version: connector.version,
          }));
        return {
          items,
          connectors,
          runnableAgents: runnableAgents.map((agent) => ({
            identityId: agent.identityId,
            displayName: agent.displayName,
            model: agent.model,
            spaceIds: [...agent.spaceIds],
            limits: agent.limits,
          })),
          runnableSpaceIds,
          nextCursor: encodeCursor(page.nextCursor),
        };
      },
    );
  }

  async getRun(runId: string): Promise<UiAgentRunDetail> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const run = await new GuildAgentRunRepository(
          connection,
          this.#env.GUILD_ID,
        ).getRunDetail(runId);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.read",
          resource: runResource(run),
        });
        return { ...runForUi(run, snapshot, this.#accountId), votes: run.votes };
      },
    );
  }

  createRun(input: CreateAgentWebhookRunRequest): Promise<string> {
    return this.#createRun(input, "guild-ui");
  }

  stageCloudflareOsRun(input: CreateAgentWebhookRunRequest): Promise<string> {
    return this.#createRun(input, "cloudflare-os");
  }

  async approveStagedCloudflareOsRun(runId: string): Promise<void> {
    assertUuid(runId, "Agent run ID");
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const staged = await repository.getRun(runId, true);
        if (staged.source !== "cloudflare-os" ||
            staged.requesterIdentityId !== this.#accountId) {
          throw new Error("Cloudflare OS action does not belong to this Guild session.");
        }
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          staged.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.run",
          resource: runResource(staged),
        });
        const opened = await repository.openStagedApproval(
          runId,
          approvalFor(this.#env.GUILD_ID, runId, snapshot),
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.overseer_approved",
            "agent_run",
            runId,
            { source: "cloudflare-os" },
            runResource(staged),
          ),
        );
        if (opened.approval && opened.approval.status === "pending" &&
            isAuthorized(snapshot, {
              actorIdentityId: this.#accountId,
              permission: "agent.approve",
              resource: runResource(opened),
            })) {
          await repository.review({
            runId,
            approvalRequestId: opened.approval.id,
            approverIdentityId: this.#accountId,
            verdict: "approve",
            reason: "Approved through the Cloudflare OS action queue.",
            reauthenticatedAt: null,
            chronicleEvent: makeChronicleEvent(
              this.#env.GUILD_ID,
              this.#accountId,
              "agent.run.approved",
              "agent_run",
              runId,
              { source: "cloudflare-os" },
              runResource(opened),
            ),
          });
        }
      },
    );
  }

  async rejectStagedCloudflareOsRun(runId: string, reason = "rejected"): Promise<void> {
    assertUuid(runId, "Agent run ID");
    assertNonBlank(reason, "Agent rejection reason", 500);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId, true);
        if (run.source !== "cloudflare-os" || run.requesterIdentityId !== this.#accountId) {
          throw new Error("Cloudflare OS action does not belong to this Guild session.");
        }
        await repository.rejectStagedRun(
          runId,
          this.#accountId,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.overseer_rejected",
            "agent_run",
            runId,
            { reason, source: "cloudflare-os" },
            runResource(run),
          ),
        );
      },
    );
  }

  async review(input: ReviewAgentRunRequest): Promise<void> {
    assertUuid(input.runId, "Agent run ID");
    assertUuid(input.approvalRequestId, "Agent approval request ID");
    assertNonBlank(input.reason, "Agent approval reason", 5_000);
    if (!["approve", "reject"].includes(input.verdict)) {
      throw new Error("Agent approval verdict is invalid.");
    }
    if (input.reauthenticatedAt !== null && Number.isNaN(Date.parse(input.reauthenticatedAt))) {
      throw new Error("Agent approval reauthentication timestamp is invalid.");
    }
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(input.runId, true);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.approve",
          resource: runResource(run),
        });
        await repository.review({
          ...input,
          approverIdentityId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            input.verdict === "approve" ? "agent.run.approved" : "agent.run.rejected",
            "agent_run",
            input.runId,
            { source: "guild-ui" },
            runResource(run),
          ),
        });
      },
    );
  }

  async kill(runId: string): Promise<void> {
    assertUuid(runId, "Agent run ID");
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId, true);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          run.spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.stop",
          resource: runResource(run),
        });
        await repository.killRun(
          runId,
          this.#accountId,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.killed",
            "agent_run",
            runId,
            { source: "guild-ui" },
            runResource(run),
          ),
        );
      },
    );
  }

  async claimExecution(runId: string, workflowInstanceId: string): Promise<AgentExecutionClaim> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        if (run.workflowInstanceId !== workflowInstanceId) {
          throw new Error("Workflow instance does not own this Agent run.");
        }
        const connector = await repository.getConnector(run.connectorId);
        assertDeploymentConnector(this.#env, connector);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          run.agentIdentityId,
          run.requesterIdentityId,
          run.spaceId,
        );
        const currentConnectorPermissions = new Set(connector.capabilityPermissions.filter(
          (permission) => run.connectorPermissionsSnapshot.includes(permission),
        ));
        const effectiveLimits = authorizeExecution(snapshot, run, currentConnectorPermissions);
        if (!run.approval || run.approval.status !== "approved" ||
            new Date(run.approval.expiresAt).valueOf() <= Date.now()) {
          throw new Error("Agent run does not have a current durable Human approval.");
        }
        const claimed = await repository.claimExecution(runId, workflowInstanceId);
        return {
          runId: claimed.id,
          guildId: claimed.guildId,
          agentIdentityId: claimed.agentIdentityId,
          requesterIdentityId: claimed.requesterIdentityId,
          eventType: claimed.plan.action.eventType,
          payloadJson: JSON.stringify(claimed.plan.action.payload),
          idempotencyKey: claimed.idempotencyKey,
          plannedSteps: claimed.plan.steps.length,
          endpointUrl: connector.endpointUrl,
          effectiveLimits,
        };
      },
    );
  }

  async completeExecution(
    runId: string,
    workflowInstanceId: string,
    result: AgentRunResult,
    usage: AgentRunUsage,
  ): Promise<"succeeded" | "killed"> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        return repository.completeExecution(
          runId,
          workflowInstanceId,
          result,
          usage,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            run.agentIdentityId,
            "agent.run.succeeded",
            "agent_run",
            runId,
            { statusCode: result.statusCode, source: "agent-workflow" },
            runResource(run),
          ),
        );
      },
    );
  }

  async failExecution(
    runId: string,
    workflowInstanceId: string,
    errorMessage: string,
    usage: AgentRunUsage,
  ): Promise<void> {
    assertNonBlank(errorMessage, "Agent failure", 2_000);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const run = await repository.getRun(runId);
        await repository.failExecution(
          runId,
          workflowInstanceId,
          errorMessage,
          usage,
          makeChronicleEvent(
            this.#env.GUILD_ID,
            run.agentIdentityId,
            "agent.run.failed",
            "agent_run",
            runId,
            { reason: errorMessage, source: "agent-workflow" },
            runResource(run),
          ),
        );
      },
    );
  }

  async getWorkflowState(runId: string): Promise<AgentWorkflowState> {
    assertUuid(runId, "Agent run ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const run = await new GuildAgentRunRepository(
          connection,
          this.#env.GUILD_ID,
        ).getRun(runId);
        return {
          status: run.status,
          workflowInstanceId: run.workflowInstanceId,
          approvalStatus: run.approval?.status ?? null,
        };
      },
    );
  }

  async #createRun(
    input: CreateAgentWebhookRunRequest,
    source: RunSource,
  ): Promise<string> {
    assertInput(input);
    const hash = await requestHash(input, source);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAgentRunRepository(connection, this.#env.GUILD_ID);
        const connector = await repository.getConnector(input.connectorId);
        assertDeploymentConnector(this.#env, connector);
        const snapshot = await loadAgentAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          input.agentIdentityId,
          this.#accountId,
          input.spaceId,
        );
        const now = new Date().toISOString();
        const plan = {
          objective: input.objective,
          expectedOutcome: input.expectedOutcome,
          steps: input.steps,
          connectorId: input.connectorId,
          questId: input.questId,
          action: {
            kind: "https_webhook" as const,
            eventType: input.eventType,
            payload: input.payload,
          },
          estimatedUsage: input.estimatedUsage,
        };
        const limits = currentAgentLimits(snapshot, input.agentIdentityId);
        assertUsageWithinLimits(limits, plan.estimatedUsage);
        const run: AgentRun = {
          id: input.requestId,
          guildId: this.#env.GUILD_ID,
          spaceId: input.spaceId,
          ownerIdentityId: this.#accountId,
          visibility: input.visibility,
          classification: input.classification,
          allowedIdentityIds: input.allowedIdentityIds,
          agentIdentityId: input.agentIdentityId,
          requesterIdentityId: this.#accountId,
          connectorId: input.connectorId,
          questId: input.questId,
          riskLevel: 2,
          status: source === "cloudflare-os" ? "planning" : "awaiting_approval",
          source,
          plan,
          result: null,
          errorMessage: null,
          limits,
          usage: {
            budgetMinor: 0,
            tokens: 0,
            durationSeconds: 0,
            steps: 0,
            retries: 0,
            delegationDepth: 0,
          },
          workflowInstanceId: `agent-run-${input.requestId}`,
          idempotencyKey: `agent-action:${this.#accountId}:${input.requestId}`,
          requestHash: hash,
          estimatedBudgetMinor: input.estimatedUsage.budgetMinor,
          killRequestedAt: null,
          startedAt: null,
          finishedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "agent.run",
          resource: runResource(run),
        });
        authorizeAgent(snapshot, {
          agentIdentityId: input.agentIdentityId,
          requesterIdentityId: this.#accountId,
          permission: "integration.execute",
          workflowPermissions: WORKFLOW_PERMISSIONS,
          connectorPermissions: new Set(connector.capabilityPermissions),
          resource: runResource(run),
        });
        await this.#assertQuestBoundary(connection, snapshot, run);
        await repository.createRun({
          run,
          approval: source === "guild-ui"
            ? approvalFor(this.#env.GUILD_ID, run.id, snapshot)
            : null,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "agent.run.planned",
            "agent_run",
            run.id,
            { eventType: input.eventType, riskLevel: 2, source },
            runResource(run),
          ),
        });
      },
    );
    return input.requestId;
  }

  async #assertQuestBoundary(
    connection: GuildTransactionConnection,
    snapshot: AuthorizationSnapshot,
    run: AgentRun,
  ): Promise<void> {
    if (run.questId === null) return;
    const row = (await connection.query<{
      id: string;
      space_id: string | null;
      owner_identity_id: string;
      visibility: AgentRun["visibility"];
      classification: AgentRun["classification"];
      allowed_identity_ids: string[];
      assignee_identity_id: string | null;
      status: string;
    }>(
      `SELECT id::text, space_id::text, owner_identity_id::text, visibility,
              classification, allowed_identity_ids::text[], assignee_identity_id::text, status
         FROM quests WHERE guild_id = $1 AND id = $2`,
      [this.#env.GUILD_ID, run.questId],
    )).rows[0];
    if (!row) throw new Error("Agent Quest was not found in this Guild.");
    if (row.space_id !== run.spaceId || row.assignee_identity_id !== run.agentIdentityId ||
        ["completed", "cancelled"].includes(row.status)) {
      throw new Error("Agent Quest must be active, in the same Space, and assigned to this Agent.");
    }
    const quest: SecuredResource = {
      id: row.id,
      guildId: this.#env.GUILD_ID,
      spaceId: row.space_id,
      ownerIdentityId: row.owner_identity_id,
      visibility: row.visibility,
      classification: row.classification,
      allowedIdentityIds: row.allowed_identity_ids,
    };
    authorize(snapshot, {
      actorIdentityId: run.requesterIdentityId,
      permission: "work.read",
      resource: quest,
    });
    authorize(snapshot, {
      actorIdentityId: run.agentIdentityId,
      permission: "work.read",
      resource: quest,
    });
  }
}
