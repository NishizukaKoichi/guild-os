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
import { loadAuthorizedSpaces, loadGuildOverview } from "./authorization.js";
import { ensureGuildAccount, renderGuildPage } from "./bootstrap.js";
import {
  describeGuildAccount,
  describeGuildVendor,
  type GuildAccountProps,
  type GuildEnv,
} from "./config.js";
import { GuildSessionImpl } from "./session.js";
import { GuildManagementApiImpl } from "./management-api.js";
import { searchKnowledgeForSession } from "./knowledge-service.js";
import type { GuildSession } from "./types.js";
import TYPES_CODE from "./types-code.js";

export { describeGuildAccount, describeGuildVendor } from "./config.js";
export { GuildSessionImpl } from "./session.js";

interface GuildVerifierApi extends GatekeeperUserVerifier {
  getAccountId(): Promise<string>;
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
    return new GuildSessionImpl(
      approvalQueue.dup(),
      () => loadGuildOverview(this.env, this.ctx.props.accountId),
      (query, locale) => searchKnowledgeForSession(
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
    const spaces = await loadAuthorizedSpaces(this.env, this.ctx.props.accountId);
    await authorizer.authorizeObservation({
      title: "List Guild Spaces",
      description: "List bounded Space metadata so the agent can discover its organizational scope.",
    });
    return boundAgentCatalog(spaces.map((space) => ({
      id: space.id,
      title: space.name,
      description: space.parentSpaceId ? `Child Space of ${space.parentSpaceId}` : "Top-level Space",
    })), request);
  }

  async addObserver(_id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    const verifier = user as Fetcher<GuildVerifierApi>;
    if (await verifier.getAccountId() !== this.ctx.props.accountId) {
      throw new Error("Guild observations cannot be shared with another account by default.");
    }
  }

  async removeObserver(_id: string): Promise<void> {}

  async applyAction(action: number): Promise<void> {
    throw new Error(`Guild Gatekeeper has no queued action ${action}.`);
  }

  async rejectAction(_action: number): Promise<void> {}

  async revertAction(_action: number): Promise<void> {
    throw new Error("Guild Gatekeeper has no reversible actions yet.");
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
    const state = await ensureGuildAccount(this.env, this.ctx.props.accountId, context.isAdmin);
    return {
      iframeHtml: renderGuildPage(this.env, state),
      ui: new RpcStub(new GuildManagementApiImpl(this.env, this.ctx.props.accountId)),
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
