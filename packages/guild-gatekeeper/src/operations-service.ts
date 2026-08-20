import {
  AUTOMATION_TRIGGER_KINDS,
  CLASSIFICATIONS,
  CONNECTION_KINDS,
  FEDERATION_DIRECTIONS,
  PERMISSIONS,
  VISIBILITIES,
  assertCanDelegatePermissions,
  assertNonBlank,
  assertPositiveInteger,
  authorize,
  isAuthorized,
  type AuthorizationSnapshot,
  type AutomationRule,
  type FederationGrant,
  type JsonObject,
  type ModelRoute,
  type Permission,
  type WorkflowDefinition,
} from "@guild-os/domain";
import {
  GuildOperationsRepository,
  GuildPortabilityRepository,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
  type WorkflowRunRequest,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import {
  type ConnectionDiscoveryResult,
  type ConnectionHealthResult,
} from "./connection-adapters.js";
import { createConfiguredConnectionAdapter } from "./configured-connection.js";
import type {
  CreateAutomationRuleRequest,
  CreateConnectionRequest,
  CreateFederationGrantRequest,
  CreateFederationLinkRequest,
  CreateModelProviderRequest,
  CreateWorkflowRequest,
  RunWorkflowRequest,
  SetModelRouteRequest,
  SetVersionedStatusRequest,
  UiAutomationRule,
  UiConnection,
  UiFederationGrant,
  UiFederationLink,
  UiModelProvider,
  UiOperationsPage,
  UiWorkflowDefinition,
} from "./management-types.js";
import { retentionRunForUi } from "./retention-service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;
const MODEL_PURPOSES = ["ask", "plan", "act", "embedding", "review"] as const;
const FEDERATED_RESOURCE_TYPES = ["memory", "activity", "decision", "agent"] as const;
const WORKFLOW_ACTION_KINDS = [
  "memory_search", "activity_draft", "agent_delegate", "connection_invoke",
  "https_webhook", "federation_publish",
] as const;
const ACTION_ENDPOINT_CONNECTION_KINDS = new Set<CreateConnectionRequest["kind"]>([
  "api",
  "cloudflare_gatekeeper",
  "email",
  "calendar",
  "file_storage",
  "git_repository",
  "external_api",
  "model_provider",
]);

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertOptionalUuid(value: string | null, field: string): void {
  if (value !== null) assertUuid(value, field);
}

function assertVersion(value: number): void {
  assertPositiveInteger(value, "Expected version");
}

function assertHttpsUrl(value: string | null, field: string, required = false): void {
  if (value === null) {
    if (required) throw new Error(`${field} is required.`);
    return;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${field} must be an HTTPS URL without embedded credentials.`);
  }
}

function assertSecretReference(value: string | null, required = false): void {
  if (value === null || value === "") {
    if (required) throw new Error("A purchaser-owned Secret reference is required.");
    return;
  }
  if (!SECRET_REFERENCE_PATTERN.test(value)) {
    throw new Error("Secret reference must be an uppercase environment binding name.");
  }
}

function assertJsonObject(value: JsonObject, field: string): void {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${field} must be a JSON object.`);
  }
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function assertConnectionConfiguration(
  kind: CreateConnectionRequest["kind"],
  configuration: JsonObject,
): void {
  const record = jsonRecord(configuration);
  if (!record) throw new Error("Connection configuration must be an object.");
  const rawCapabilities = record.allowedCapabilities;
  if (rawCapabilities !== undefined && !Array.isArray(rawCapabilities)) {
    throw new Error("Connection capability allowlist must be an array.");
  }
  const capabilityIds = (Array.isArray(rawCapabilities) ? rawCapabilities : []).map((value) => {
    if (typeof value === "string") return value;
    const item = jsonRecord(value);
    if (!item || typeof item.id !== "string") {
      throw new Error("Every Connection capability must contain an ID.");
    }
    return item.id;
  });
  if (capabilityIds.length > 200 || new Set(capabilityIds).size !== capabilityIds.length ||
      capabilityIds.some((id) => id.length < 1 || id.length > 128 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id))) {
    throw new Error("Connection capability IDs must be unique, bounded identifiers.");
  }
  if ((kind === "mcp" || kind === "cloudflare_service" ||
      ACTION_ENDPOINT_CONNECTION_KINDS.has(kind)) && capabilityIds.length === 0) {
    throw new Error("This Connection type requires an explicit remote capability allowlist.");
  }
  if (kind === "mcp" && record.adapterKind !== undefined &&
      record.adapterKind !== "mcp_https" && record.adapterKind !== "cloudflare_os_mcp") {
    throw new Error("MCP adapter profile is invalid.");
  }
  if (kind === "cloudflare_service") {
    if (typeof record.bindingReference !== "string" ||
        !SECRET_REFERENCE_PATTERN.test(record.bindingReference)) {
      throw new Error("Cloudflare Service Binding reference is required.");
    }
  }
  if (record.routes !== undefined) {
    const configuredRoutes = jsonRecord(record.routes);
    if (!configuredRoutes || ["health", "discovery", "invoke"].some((route) => {
      const value = configuredRoutes[route];
      return value !== undefined && (typeof value !== "string" || value.length < 1 ||
        value.length > 256 || value.includes("\\") || value.includes("..") ||
        value.includes("?") || value.includes("#") || value.startsWith("//") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value));
    })) {
      throw new Error("Connection action routes are invalid.");
    }
  }
  if (record.secretHeaderName !== undefined &&
      (typeof record.secretHeaderName !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(record.secretHeaderName))) {
    throw new Error("Connection secret header name is invalid.");
  }
  if (record.secretFormat !== undefined &&
      record.secretFormat !== "raw" && record.secretFormat !== "bearer") {
    throw new Error("Connection secret format is invalid.");
  }
}

function connectionForUi(value: Awaited<ReturnType<GuildOperationsRepository["getConnection"]>>): UiConnection {
  const { guildId: _guildId, secretReference, ...rest } = value;
  return { ...rest, secretConfigured: Boolean(secretReference) };
}

function workflowForUi(value: WorkflowDefinition): UiWorkflowDefinition {
  const { guildId: _guildId, ...rest } = value;
  return rest;
}

function automationForUi(value: AutomationRule): UiAutomationRule {
  const { guildId: _guildId, ...rest } = value;
  return rest;
}

function workflowRunForUi(value: WorkflowRunRequest): UiOperationsPage["workflowRuns"][number] {
  const { guildId: _guildId, idempotencyKey: _idempotencyKey, ...rest } = value;
  return rest;
}

function federationGrantForUi(value: FederationGrant): UiFederationGrant {
  const { guildId: _guildId, ...rest } = value;
  return rest;
}

function modelRouteForUi(value: ModelRoute): UiOperationsPage["modelRoutes"][number] {
  const { guildId: _guildId, ...rest } = value;
  return rest;
}

function federationLinkForUi(
  value: Awaited<ReturnType<GuildOperationsRepository["getFederationLink"]>>,
): UiFederationLink {
  const { guildId: _guildId, secretReference, ...rest } = value;
  return { ...rest, secretConfigured: Boolean(secretReference) };
}

function providerForUi(
  value: Awaited<ReturnType<GuildOperationsRepository["getModelProvider"]>>,
): UiModelProvider {
  const { guildId: _guildId, secretReference, ...rest } = value;
  return { ...rest, secretConfigured: Boolean(secretReference) };
}

function can(snapshot: AuthorizationSnapshot, actorId: string, permission: Permission): boolean {
  return isAuthorized(snapshot, { actorIdentityId: actorId, permission });
}

export class GuildOperationsService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getPage(): Promise<UiOperationsPage> {
    return this.#transaction(async (connection, snapshot) => {
      const repository = new GuildOperationsRepository(connection, this.#env.GUILD_ID);
      const capabilities = {
        readConnections: can(snapshot, this.#accountId, "connection.read") ||
          can(snapshot, this.#accountId, "integration.read"),
        manageConnections: can(snapshot, this.#accountId, "connection.manage") ||
          can(snapshot, this.#accountId, "integration.manage"),
        readAutomation: can(snapshot, this.#accountId, "automation.read"),
        manageAutomation: can(snapshot, this.#accountId, "automation.manage"),
        readFederation: can(snapshot, this.#accountId, "federation.read"),
        manageFederation: can(snapshot, this.#accountId, "federation.manage"),
        readData: can(snapshot, this.#accountId, "data.read"),
        manageData: can(snapshot, this.#accountId, "data.manage"),
        applyRetention: snapshot.guild.rootOwnerIdentityId === this.#accountId &&
          snapshot.identities.some((identity) => identity.id === this.#accountId &&
            identity.kind === "human" && identity.status === "active"),
      };
      const portability = new GuildPortabilityRepository(connection, this.#env.GUILD_ID);
      const [connections, workflows, automationRules, workflowRuns, federationLinks,
        modelProviders, modelRoutes, exportInventory, dataExports, retentionRuns] = await Promise.all([
        capabilities.readConnections ? repository.listConnections() : [],
        capabilities.readAutomation ? repository.listWorkflowDefinitions() : [],
        capabilities.readAutomation ? repository.listAutomationRules() : [],
        capabilities.readAutomation ? repository.listWorkflowRunRequests() : [],
        capabilities.readFederation ? repository.listFederationLinks() : [],
        capabilities.readData ? repository.listModelProviders() : [],
        capabilities.readData ? repository.listModelRoutes() : [],
        capabilities.readData ? repository.getGuildDataExportInventory() : null,
        capabilities.readData
          ? portability.listExportJobs()
          : [],
        capabilities.readData ? portability.listRetentionRunDetails(100) : [],
      ]);
      const federationGrants = capabilities.readFederation
        ? (await Promise.all(federationLinks.map((link) =>
          repository.listFederationGrants(link.id)))).flat()
        : [];
      const activeAgentIds = new Set(snapshot.agents
        .filter((profile) => profile.status === "active")
        .map((profile) => profile.identityId));
      const agents = snapshot.identities
        .filter((identity) => identity.kind === "agent" && identity.status === "active" &&
          activeAgentIds.has(identity.id))
        .map((identity) => ({
          id: identity.id,
          displayName: identity.displayName,
          kind: identity.kind,
          membershipState: snapshot.memberships.find((membership) =>
            membership.identityId === identity.id)?.state ?? "suspended",
        }));
      return {
        connections: connections.map(connectionForUi),
        workflows: workflows.map(workflowForUi),
        automationRules: automationRules.map(automationForUi),
        workflowRuns: workflowRuns.map(workflowRunForUi),
        federationLinks: federationLinks.map(federationLinkForUi),
        federationGrants: federationGrants.map(federationGrantForUi),
        modelProviders: modelProviders.map(providerForUi),
        modelRoutes: modelRoutes.map(modelRouteForUi),
        exportInventory: exportInventory === null ? null : {
          guild: {
            id: exportInventory.guild.id,
            name: exportInventory.guild.name,
            purpose: exportInventory.guild.purpose,
            createdAt: exportInventory.guild.createdAt,
          },
          generatedAt: exportInventory.generatedAt,
          totalRows: exportInventory.totalRows,
          tables: exportInventory.tables,
          files: exportInventory.files,
          schemaMigrations: exportInventory.schemaMigrations,
        },
        dataExports: dataExports.map((job) => ({
          id: job.id,
          requestedCategories: job.requestedCategories,
          includeRequesterPersonal: job.includeRequesterPersonal,
          status: job.status,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          retryable: job.retryable,
          sha256: job.sha256,
          byteCount: job.byteCount,
          rowCount: job.rowCount,
          fileCount: job.fileCount,
          completedAt: job.completedAt,
          expiresAt: job.expiresAt,
          errorSummary: job.errorSummary,
          version: job.version,
          createdAt: job.createdAt,
        })),
        retentionRuns: retentionRuns.map(retentionRunForUi),
        dataRetentionDays: snapshot.constitution.dataRetentionDays,
        constitutionVersion: snapshot.constitution.version,
        agents,
        capabilities,
      };
    });
  }

  async createConnection(input: CreateConnectionRequest): Promise<string> {
    assertOptionalUuid(input.spaceId, "Space ID");
    assertNonBlank(input.name, "Connection name", 200);
    if (!(CONNECTION_KINDS as readonly string[]).includes(input.kind)) {
      throw new Error("Connection kind is invalid.");
    }
    if (!(VISIBILITIES as readonly string[]).includes(input.visibility) ||
        !(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
      throw new Error("Connection security boundary is invalid.");
    }
    if (!input.capabilityPermissions.length || input.capabilityPermissions.some((permission) =>
      !(PERMISSIONS as readonly string[]).includes(permission))) {
      throw new Error("Connection capabilities must contain known permissions.");
    }
    assertNonBlank(input.description, "Connection description", 2_000);
    assertNonBlank(input.provider, "Connection provider", 200);
    assertJsonObject(input.configuration, "Connection configuration");
    assertConnectionConfiguration(input.kind, input.configuration);
    const needsEndpoint = input.kind !== "cloudflare_service" && input.kind !== "storage" &&
      input.kind !== "database";
    assertHttpsUrl(input.endpointUrl, "Connection endpoint", needsEndpoint);
    const needsSecret = !["none", "service_binding"].includes(input.authKind);
    assertSecretReference(input.secretReference, needsSecret);
    if (!Number.isSafeInteger(input.writeRiskLevel) || input.writeRiskLevel < 0 ||
        input.writeRiskLevel > 3) throw new Error("Connection risk level must be between 0 and 3.");
    const id = crypto.randomUUID();
    await this.#authorized("connection.manage", async (connection, snapshot) => {
      assertCanDelegatePermissions(snapshot, this.#accountId, input.capabilityPermissions);
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createConnection({
        id,
        actorId: this.#accountId,
        ownerIdentityId: this.#accountId,
        ...input,
        secretReference: input.secretReference || null,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "connection.created", "connector", id,
          { kind: input.kind, provider: input.provider, source: "guild-ui" },
        ),
      });
    }, input.spaceId);
    return id;
  }

  async checkConnectionHealth(connectionId: string): Promise<ConnectionHealthResult> {
    assertUuid(connectionId, "Connection ID");
    const configured = await this.#authorized("connection.manage", async (connection) =>
      new GuildOperationsRepository(connection, this.#env.GUILD_ID).getConnection(connectionId));
    const result = await createConfiguredConnectionAdapter(this.#env, configured).health();
    const healthStatus = result.status === "healthy"
      ? "healthy"
      : ["network_error", "request_timeout", "http_error"].includes(result.code)
        ? "unreachable"
        : "degraded";
    await this.#authorized("connection.manage", async (connection) => {
      const repository = new GuildOperationsRepository(connection, this.#env.GUILD_ID);
      const current = await repository.getConnection(connectionId, true);
      if (current.status !== "active" || current.version !== configured.version) {
        throw new Error("Connection changed while its health was being checked.");
      }
      await repository.setConnectionHealth({
        id: current.id,
        expectedVersion: current.version,
        healthStatus,
        checkedAt: result.checkedAt,
        actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "connection.health_checked", "connector",
          current.id, { healthStatus, adapterCode: result.code, source: "guild-ui" },
        ),
      });
    }, configured.spaceId);
    return result;
  }

  async discoverConnection(connectionId: string): Promise<ConnectionDiscoveryResult> {
    assertUuid(connectionId, "Connection ID");
    const configured = await this.#authorized("connection.read", async (connection) =>
      new GuildOperationsRepository(connection, this.#env.GUILD_ID).getConnection(connectionId));
    return createConfiguredConnectionAdapter(this.#env, configured).discover();
  }

  async revokeConnection(input: SetVersionedStatusRequest<"revoked">): Promise<void> {
    assertUuid(input.id, "Connection ID");
    assertVersion(input.expectedVersion);
    await this.#authorized("connection.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).revokeConnection({
        id: input.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "connection.revoked", "connector", input.id,
          { source: "guild-ui" },
        ),
      });
    });
  }

  async createWorkflow(input: CreateWorkflowRequest): Promise<string> {
    assertOptionalUuid(input.spaceId, "Space ID");
    assertNonBlank(input.name, "Workflow name", 200);
    assertNonBlank(input.description, "Workflow description", 2_000);
    if (input.nodes.length < 1 || input.nodes.length > 100 || input.edges.length > 250) {
      throw new Error("Workflow must contain 1-100 nodes and no more than 250 edges.");
    }
    input.nodes.forEach((node) => assertJsonObject(node, "Workflow node"));
    input.edges.forEach((edge) => assertJsonObject(edge, "Workflow edge"));
    if (input.allowedActionKinds.length < 1 ||
        new Set(input.allowedActionKinds).size !== input.allowedActionKinds.length ||
        input.allowedActionKinds.some((kind) =>
          !(WORKFLOW_ACTION_KINDS as readonly string[]).includes(kind))) {
      throw new Error("Workflow actions must contain unique supported Agent actions.");
    }
    if (input.capabilityPermissions.length < 1 ||
        new Set(input.capabilityPermissions).size !== input.capabilityPermissions.length ||
        input.capabilityPermissions.some((permission) =>
          !(PERMISSIONS as readonly string[]).includes(permission))) {
      throw new Error("Workflow capabilities must contain unique known permissions.");
    }
    assertPositiveInteger(input.maxConcurrentRuns, "Maximum concurrent runs");
    const id = crypto.randomUUID();
    await this.#authorized("automation.manage", async (connection, snapshot) => {
      assertCanDelegatePermissions(snapshot, this.#accountId, input.capabilityPermissions);
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createWorkflowDefinition({
        id, actorId: this.#accountId, ownerActorId: this.#accountId, status: "active", ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "workflow.created", "workflow_definition", id,
          { source: "guild-ui" },
        ),
      });
    }, input.spaceId);
    return id;
  }

  async setWorkflowStatus(
    input: SetVersionedStatusRequest<UiWorkflowDefinition["status"]>,
  ): Promise<void> {
    assertUuid(input.id, "Workflow ID");
    assertVersion(input.expectedVersion);
    if (!["draft", "active", "paused", "archived"].includes(input.status)) {
      throw new Error("Workflow status is invalid.");
    }
    await this.#authorized("automation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).setWorkflowStatus({
        ...input, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "workflow.status_changed", "workflow_definition",
          input.id, { status: input.status, source: "guild-ui" },
        ),
      });
    });
  }

  async createAutomationRule(input: CreateAutomationRuleRequest): Promise<string> {
    assertUuid(input.workflowId, "Workflow ID");
    assertUuid(input.agentActorId, "Agent Actor ID");
    assertNonBlank(input.name, "Automation name", 200);
    assertNonBlank(input.triggerExpression, "Trigger expression", 500);
    assertNonBlank(input.timezone, "Timezone", 100);
    assertJsonObject(input.inputTemplate, "Automation input");
    if (!(AUTOMATION_TRIGGER_KINDS as readonly string[]).includes(input.triggerKind)) {
      throw new Error("Automation trigger kind is invalid.");
    }
    if (input.nextRunAt !== null && !Number.isFinite(Date.parse(input.nextRunAt))) {
      throw new Error("Next run time must be an ISO timestamp.");
    }
    const id = crypto.randomUUID();
    await this.#authorized("automation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createAutomationRule({
        id, actorId: this.#accountId, createdByActorId: this.#accountId, status: "active", ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "automation.created", "automation_rule", id,
          { triggerKind: input.triggerKind, source: "guild-ui" },
        ),
      });
    });
    return id;
  }

  async setAutomationRuleStatus(
    input: SetVersionedStatusRequest<UiAutomationRule["status"]>,
  ): Promise<void> {
    assertUuid(input.id, "Automation ID");
    assertVersion(input.expectedVersion);
    if (!["active", "paused", "archived"].includes(input.status)) {
      throw new Error("Automation status is invalid.");
    }
    await this.#authorized("automation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).setAutomationRuleStatus({
        ...input, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "automation.status_changed", "automation_rule",
          input.id, { status: input.status, source: "guild-ui" },
        ),
      });
    });
  }

  async runWorkflow(input: RunWorkflowRequest): Promise<string> {
    assertUuid(input.workflowId, "Workflow ID");
    assertUuid(input.agentActorId, "Agent Actor ID");
    assertJsonObject(input.input, "Workflow input");
    assertNonBlank(input.idempotencyKey, "Idempotency key", 200);
    const id = crypto.randomUUID();
    const result = await this.#authorized("automation.manage", async (connection) =>
      new GuildOperationsRepository(connection, this.#env.GUILD_ID).enqueueManualRun({
        id, workflowId: input.workflowId, agentActorId: input.agentActorId,
        requestedByActorId: this.#accountId, input: input.input,
        idempotencyKey: input.idempotencyKey, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "workflow.run_requested", "workflow_run_request", id,
          { workflowId: input.workflowId, source: "guild-ui" },
        ),
      }));
    return result.value.id;
  }

  async createFederationLink(input: CreateFederationLinkRequest): Promise<string> {
    assertUuid(input.remoteGuildId, "Remote Guild ID");
    if (input.remoteGuildId === this.#env.GUILD_ID) throw new Error("A Guild cannot federate with itself.");
    assertNonBlank(input.remoteName, "Remote Guild name", 200);
    assertHttpsUrl(input.endpointUrl, "Federation endpoint", true);
    assertSecretReference(input.secretReference, true);
    if (!(FEDERATION_DIRECTIONS as readonly string[]).includes(input.direction)) {
      throw new Error("Federation direction is invalid.");
    }
    if (!input.allowedResourceTypes.length || input.allowedResourceTypes.some((type) =>
      !(FEDERATED_RESOURCE_TYPES as readonly string[]).includes(type))) {
      throw new Error("Federation resource types are invalid.");
    }
    const id = crypto.randomUUID();
    await this.#authorized("federation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createFederationLink({
        id, actorId: this.#accountId, createdByActorId: this.#accountId, status: "pending", ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "federation.link_created", "federation_link", id,
          { remoteGuildId: input.remoteGuildId, direction: input.direction, source: "guild-ui" },
        ),
      });
    });
    return id;
  }

  async activateFederationLink(input: SetVersionedStatusRequest<"active">): Promise<void> {
    assertUuid(input.id, "Federation link ID");
    assertVersion(input.expectedVersion);
    await this.#authorized("federation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).activateFederationLink({
        id: input.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "federation.link_activated", "federation_link",
          input.id, { source: "guild-ui" },
        ),
      });
    });
  }

  async revokeFederationLink(input: SetVersionedStatusRequest<"revoked">): Promise<void> {
    assertUuid(input.id, "Federation link ID");
    assertVersion(input.expectedVersion);
    await this.#authorized("federation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).revokeFederationLink({
        id: input.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "federation.link_revoked", "federation_link",
          input.id, { source: "guild-ui" },
        ),
      });
    });
  }

  async createFederationGrant(input: CreateFederationGrantRequest): Promise<string> {
    assertUuid(input.federationLinkId, "Federation link ID");
    assertUuid(input.resourceId, "Federated resource ID");
    if (!(FEDERATED_RESOURCE_TYPES as readonly string[]).includes(input.resourceType) ||
        !["read", "participate"].includes(input.permission)) {
      throw new Error("Federation grant is invalid.");
    }
    const id = crypto.randomUUID();
    await this.#authorized("federation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createFederationGrant({
        id, actorId: this.#accountId, grantedByActorId: this.#accountId, ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "federation.grant_created", "federation_grant", id,
          { resourceType: input.resourceType, resourceId: input.resourceId, source: "guild-ui" },
        ),
      });
    });
    return id;
  }

  async revokeFederationGrant(input: SetVersionedStatusRequest<"revoked">): Promise<void> {
    assertUuid(input.id, "Federation grant ID");
    assertVersion(input.expectedVersion);
    await this.#authorized("federation.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).revokeFederationGrant({
        id: input.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
        revokedByActorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "federation.grant_revoked", "federation_grant",
          input.id, { source: "guild-ui" },
        ),
      });
    });
  }

  async createModelProvider(input: CreateModelProviderRequest): Promise<string> {
    assertNonBlank(input.name, "Model provider name", 200);
    if (!["workers_ai", "cloudflare_ai_gateway", "openai_compatible"].includes(input.kind)) {
      throw new Error("Model provider kind is invalid.");
    }
    if (!input.allowedModels.length || input.allowedModels.length > 100) {
      throw new Error("Model provider must allow between 1 and 100 models.");
    }
    input.allowedModels.forEach((model) => assertNonBlank(model, "Allowed model", 300));
    const externalProvider = input.kind !== "workers_ai";
    assertHttpsUrl(input.endpointUrl, "Model endpoint", externalProvider);
    assertSecretReference(input.secretReference, externalProvider);
    const id = crypto.randomUUID();
    await this.#authorized("data.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).createModelProvider({
        id, actorId: this.#accountId, createdByActorId: this.#accountId,
        status: "active", deploymentManaged: false, ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "model.provider_created", "model_provider", id,
          { kind: input.kind, source: "guild-ui" },
        ),
      });
    });
    return id;
  }

  async revokeModelProvider(input: SetVersionedStatusRequest<"revoked">): Promise<void> {
    assertUuid(input.id, "Model provider ID");
    assertVersion(input.expectedVersion);
    await this.#authorized("data.manage", async (connection) => {
      await new GuildOperationsRepository(connection, this.#env.GUILD_ID).revokeModelProvider({
        id: input.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "model.provider_revoked", "model_provider",
          input.id, { source: "guild-ui" },
        ),
      });
    });
  }

  async setModelRoute(input: SetModelRouteRequest): Promise<string> {
    assertUuid(input.providerId, "Model provider ID");
    if (!(MODEL_PURPOSES as readonly string[]).includes(input.purpose)) {
      throw new Error("Model purpose is invalid.");
    }
    assertNonBlank(input.primaryModel, "Primary model", 300);
    if (input.fallbackModel !== null) assertNonBlank(input.fallbackModel, "Fallback model", 300);
    assertPositiveInteger(input.maxTokens, "Maximum tokens");
    if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 0) {
      throw new Error("Daily model budget must be a non-negative integer.");
    }
    return this.#authorized("data.manage", async (connection) => {
      const repository = new GuildOperationsRepository(connection, this.#env.GUILD_ID);
      const existing = (await repository.listModelRoutes()).find((route) =>
        route.purpose === input.purpose);
      if (existing) {
        if (input.expectedVersion === null || input.expectedVersion !== existing.version) {
          throw new Error("Model route changed. Reload before saving it.");
        }
        await repository.replaceModelRoute({
          id: existing.id, expectedVersion: input.expectedVersion, actorId: this.#accountId,
          replacement: {
            providerId: input.providerId, primaryModel: input.primaryModel,
            fallbackModel: input.fallbackModel, maxTokens: input.maxTokens,
            dailyBudgetMinor: input.dailyBudgetMinor, cacheEnabled: input.cacheEnabled,
            status: input.status, updatedByActorId: this.#accountId,
          },
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID, this.#accountId, "model.route_updated", "model_route", existing.id,
            { purpose: input.purpose, source: "guild-ui" },
          ),
        });
        return existing.id;
      }
      if (input.expectedVersion !== null) throw new Error("Model route no longer exists.");
      const id = crypto.randomUUID();
      await repository.createModelRoute({
        id, actorId: this.#accountId, updatedByActorId: this.#accountId, ...input,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID, this.#accountId, "model.route_created", "model_route", id,
          { purpose: input.purpose, source: "guild-ui" },
        ),
      });
      return id;
    });
  }

  async #transaction<T>(
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection, this.#env.GUILD_ID, this.#accountId,
        );
        authorize(snapshot, { actorIdentityId: this.#accountId, permission: "guild.read" });
        return operation(connection, snapshot);
      },
    );
  }

  async #authorized<T>(
    permission: Permission,
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
    spaceId: string | null = null,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection, this.#env.GUILD_ID, this.#accountId, spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission,
          ...(spaceId === null ? {} : {
            resource: {
              id: spaceId,
              guildId: this.#env.GUILD_ID,
              spaceId,
              ownerIdentityId: this.#accountId,
              visibility: "space" as const,
              classification: "public" as const,
              allowedIdentityIds: [],
            },
          }),
        });
        return operation(connection, snapshot);
      },
    );
  }
}
