import {
  DurableObject,
  RpcStub,
  WorkerEntrypoint,
} from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  AgentCatalog,
  AgentCatalogRequest,
  AppUiContext,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUiFrame,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ObservationAuthorizer,
  ResourceConfiguratorFrame,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { boundAgentCatalog } from "@gadgets/workshop-shared/gatekeeper";
import { loadGuildOverview } from "./authorization.js";
import { prepareGuildAccount, renderGuildPage } from "./bootstrap.js";
import {
  describeGuildAccount,
  describeGuildVendor,
  type GuildAccountProps,
  type GuildEnv,
} from "./config.js";
import { GuildSessionImpl } from "./session.js";
import { GuildManagementApiImpl } from "./management-api.js";
import { searchKnowledgeForSession, searchMemoryForSession } from "./knowledge-service.js";
import { GuildAgentService } from "./agent-service.js";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";
import type {
  GuildAgentActionReceipt,
  GuildSession,
  GuildWebhookPlanInput,
} from "./types.js";
import TYPES_CODE from "./types-code.js";

export { describeGuildAccount, describeGuildVendor } from "./config.js";
export { GuildSessionImpl } from "./session.js";

interface GuildVerifierApi extends GatekeeperUserVerifier {
  getAccountId(): Promise<string>;
}

interface StoredAgentAction {
  actionId: number;
  runId: string;
  requesterIdentityId: string;
  state: "pending" | "applying" | "applied" | "rejected";
}

@validateRpc()
export class GuildGatekeeper
    extends DurableObject<GuildEnv, GuildAccountProps>
    implements Gatekeeper<GuildSession> {
  async describe(): Promise<ResourceDescription> {
    return {
      url: `guild://${this.env.GUILD_ID}`,
      title: this.env.GUILD_NAME,
      snippet: this.env.GUILD_PURPOSE,
      suggestedBindingName: "GUILD",
      tsType: "GuildSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<[]> {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<GuildSession> {
    const queue = approvalQueue.dup();
    return new GuildSessionImpl(
      queue,
      () => loadGuildOverview(this.env, this.ctx.props.accountId),
      (query, locale) => searchKnowledgeForSession(
        this.env,
        this.ctx.props.accountId,
        query,
        locale,
      ),
      (input) => this.#stageAgentAction(queue, input),
      () => new GuildAgentService(
        this.env,
        this.ctx.props.accountId,
      ).getExecutionContext(),
      (query, locale) => searchMemoryForSession(
        this.env,
        this.ctx.props.accountId,
        query,
        locale,
      ),
    );
  }

  async getAgentCatalog(
    request: AgentCatalogRequest,
    authorizer: RpcStub<ObservationAuthorizer>,
  ): Promise<AgentCatalog> {
    const execution = await new GuildAgentService(
      this.env,
      this.ctx.props.accountId,
    ).getExecutionContext();
    await authorizer.authorizeObservation({
      title: "List governed Guild execution resources",
      description:
        "List bounded Space, Agent, and Connector metadata available to this Guild session.",
    });
    return boundAgentCatalog([
      ...execution.spaces.map((space) => ({
        id: space.id,
        title: space.name,
        description: space.parentSpaceId
          ? `Runnable Guild Space; child of ${space.parentSpaceId}`
          : "Runnable top-level Guild Space",
      })),
      ...execution.agents.map((agent) => ({
        id: agent.identityId,
        title: agent.displayName,
        description: `Runnable Agent using ${agent.model}; Spaces: ${agent.spaceIds.join(", ")}`,
      })),
      ...execution.connectors.map((connector) => ({
        id: connector.id,
        title: connector.name,
        description: "Deployment-owned signed HTTPS Webhook Connector",
      })),
    ], request);
  }

  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<GuildVerifierApi>;
    if (await verifier.getAccountId() !== this.ctx.props.accountId) {
      throw new Error("Guild observations cannot be shared with another account by default.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    const stored = this.#loadAgentAction(action);
    if (stored.state === "applied") return;
    if (stored.state === "rejected") throw new Error(`Guild action ${action} was rejected.`);
    this.ctx.storage.kv.put<StoredAgentAction>(`agent-action:${action}`, {
      ...stored,
      state: "applying",
    });
    try {
      await new GuildAgentService(
        this.env,
        stored.requesterIdentityId,
      ).approveStagedCloudflareOsRun(stored.runId);
      await drainAgentWorkflowOutbox(this.env);
      this.ctx.storage.kv.put<StoredAgentAction>(`agent-action:${action}`, {
        ...stored,
        state: "applied",
      });
    } catch (error) {
      this.ctx.storage.kv.put<StoredAgentAction>(`agent-action:${action}`, {
        ...stored,
        state: "pending",
      });
      throw error;
    }
  }

  async rejectAction(action: number): Promise<void> {
    const stored = this.#loadAgentAction(action);
    if (stored.state === "rejected") return;
    if (stored.state === "applied") {
      throw new Error("An applied Guild action cannot be rejected; stop the Agent run instead.");
    }
    await new GuildAgentService(
      this.env,
      stored.requesterIdentityId,
    ).rejectStagedCloudflareOsRun(stored.runId);
    await drainAgentWorkflowOutbox(this.env);
    this.ctx.storage.kv.put<StoredAgentAction>(`agent-action:${action}`, {
      ...stored,
      state: "rejected",
    });
  }

  async revertAction(_action: number): Promise<{ message: string }> {
    return {
      message:
        "Signed Webhook delivery cannot be automatically reverted. Use the receiving system's " +
        "documented compensating operation, then record that operation in the Guild Chronicle.",
    };
  }

  async #stageAgentAction(
    approvalQueue: RpcStub<ApprovalQueue>,
    input: GuildWebhookPlanInput,
  ): Promise<GuildAgentActionReceipt> {
    const existingActionId = this.ctx.storage.kv.get<number>(`agent-run-action:${input.requestId}`);
    if (existingActionId !== undefined) {
      const existing = this.#loadAgentAction(existingActionId);
      return this.#receipt(existing);
    }
    const actionId = (this.ctx.storage.kv.get<number>("agent-action-counter") ?? 0) + 1;
    this.ctx.storage.kv.put("agent-action-counter", actionId);
    const service = new GuildAgentService(this.env, this.ctx.props.accountId);
    const runId = await service.stageCloudflareOsRun({
      requestId: input.requestId,
      agentIdentityId: input.agentIdentityId,
      connectorId: input.connectorId,
      questId: input.questId ?? null,
      spaceId: input.spaceId,
      objective: input.objective,
      expectedOutcome: input.expectedOutcome,
      steps: input.steps,
      eventType: input.eventType,
      payload: input.payload,
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 0,
        durationSeconds: input.estimatedDurationSeconds,
        steps: input.steps.length,
        retries: 0,
        delegationDepth: 0,
      },
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
    });
    const stored: StoredAgentAction = {
      actionId,
      runId,
      requesterIdentityId: this.ctx.props.accountId,
      state: "pending",
    };
    this.ctx.storage.kv.put(`agent-action:${actionId}`, stored);
    this.ctx.storage.kv.put(`agent-run-action:${runId}`, actionId);
    try {
      await approvalQueue.submitAction(actionId, {
        title: input.objective,
        description: [
          `**Expected outcome:** ${input.expectedOutcome}`,
          `**Agent:** ${input.agentIdentityId}`,
          `**Space:** ${input.spaceId}`,
          `**Target:** ${this.env.GUILD_WEBHOOK_URL}`,
          `**Event:** ${input.eventType}`,
          "",
          "```json",
          JSON.stringify(input.payload, null, 2),
          "```",
        ].join("\n"),
        implementsRevert: false,
        awaitDecision: true,
        autoApprovable: false,
        actionKind: {
          tag: "guild-agent-external-write",
          label: "Guild Agent external write",
        },
      });
      await drainAgentWorkflowOutbox(this.env);
      return this.#receipt(stored);
    } catch (error) {
      await service.rejectStagedCloudflareOsRun(runId, "approval submission failed");
      await drainAgentWorkflowOutbox(this.env);
      this.ctx.storage.kv.delete(`agent-action:${actionId}`);
      this.ctx.storage.kv.delete(`agent-run-action:${runId}`);
      throw error;
    }
  }

  #loadAgentAction(actionId: number): StoredAgentAction {
    if (!Number.isSafeInteger(actionId) || actionId < 1) {
      throw new Error("Guild action ID is invalid.");
    }
    const stored = this.ctx.storage.kv.get<StoredAgentAction>(`agent-action:${actionId}`);
    if (!stored || stored.actionId !== actionId ||
        stored.requesterIdentityId !== this.ctx.props.accountId) {
      throw new Error(`Guild Gatekeeper has no queued action ${actionId}.`);
    }
    return stored;
  }

  #receipt(action: StoredAgentAction): GuildAgentActionReceipt {
    return {
      runId: action.runId,
      actionId: action.actionId,
      status: "pending",
      message: "The external write is staged and awaiting governed Human approval.",
    };
  }
}

@validateRpc()
export class GuildAccount
    extends WorkerEntrypoint<GuildEnv, GuildAccountProps>
    implements GatekeeperUser {
  async describe(): Promise<AccountDescription> {
    return describeGuildAccount();
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<GuildSession>>> {
    return this.ctx.exports.GuildGatekeeper({ props: this.ctx.props });
  }

  async startAppUi(context: AppUiContext): Promise<GatekeeperUiFrame> {
    const state = await prepareGuildAccount(this.env, this.ctx.props.accountId);
    return {
      iframeHtml: renderGuildPage(this.env, state),
      ui: new RpcStub(new GuildManagementApiImpl(
        this.env,
        this.ctx.props.accountId,
        context.isAdmin,
        context.verifiedAuthenticatedAt,
      )),
    };
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error("Guild OS has no URL-addressed resources.");
  }

  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("Guild OS has no URL-addressed resources.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  async revoke(): Promise<void> {}

  reconnect(): Promise<{ url: string }> {
    throw new Error("Guild OS is provisioned by the Workshop and has no reconnect flow.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.GuildVerifier({ props: this.ctx.props });
  }
}

@validateRpc()
export class GuildVerifier
    extends WorkerEntrypoint<GuildEnv, GuildAccountProps>
    implements GuildVerifierApi {
  async getAccountId(): Promise<string> {
    return this.ctx.props.accountId;
  }
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<GuildEnv> {
  async describe(): Promise<VendorDescription> {
    return describeGuildVendor();
  }

  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    return this.ctx.exports.GuildAccount({
      props: { accountId: crypto.randomUUID() },
    });
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("Guild OS is auto-provisioned and has no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}
