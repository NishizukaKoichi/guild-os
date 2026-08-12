import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type {
  GuildAgentActionReceipt,
  GuildAgentExecutionContext,
  GuildKnowledgeSearchResult,
  GuildMemorySearchResult,
  GuildOverview,
  GuildSession,
  GuildWebhookPlanInput,
} from "./types.js";

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> &
  Partial<{ [Symbol.dispose](): void }>;

@validateRpc()
export class GuildSessionImpl extends RpcTarget implements GuildSession {
  readonly #approvalQueue: ObservationQueue;
  readonly #loadOverview: () => Promise<GuildOverview>;
  readonly #searchKnowledge: (
    query: string,
    locale: "en" | "ja" | "zh-CN",
  ) => Promise<GuildKnowledgeSearchResult[]>;
  readonly #searchMemory: (
    query: string,
    locale: "en" | "ja" | "zh-CN",
  ) => Promise<GuildMemorySearchResult[]>;
  readonly #planWebhookAction: (
    input: GuildWebhookPlanInput,
  ) => Promise<GuildAgentActionReceipt>;
  readonly #loadAgentExecutionContext: () => Promise<GuildAgentExecutionContext>;

  constructor(
    approvalQueue: ObservationQueue,
    loadOverview: () => Promise<GuildOverview>,
    searchKnowledge: (
      query: string,
      locale: "en" | "ja" | "zh-CN",
    ) => Promise<GuildKnowledgeSearchResult[]>,
    planWebhookAction: (
      input: GuildWebhookPlanInput,
    ) => Promise<GuildAgentActionReceipt> = async () => {
      throw new Error("Agent action planning is unavailable in this session.");
    },
    loadAgentExecutionContext: () => Promise<GuildAgentExecutionContext> = async () => ({
      spaces: [],
      agents: [],
      connectors: [],
    }),
    searchMemory: (
      query: string,
      locale: "en" | "ja" | "zh-CN",
    ) => Promise<GuildMemorySearchResult[]> = async () => [],
  ) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#loadOverview = loadOverview;
    this.#searchKnowledge = searchKnowledge;
    this.#planWebhookAction = planWebhookAction;
    this.#loadAgentExecutionContext = loadAgentExecutionContext;
    this.#searchMemory = searchMemory;
  }

  async getOverview(): Promise<GuildOverview> {
    const overview = await this.#loadOverview();
    await this.#approvalQueue.authorizeObservation({
      title: `Read Guild overview: ${overview.name}`,
      description: "Read the current account's Guild membership, global permissions, and Spaces.",
    });
    return overview;
  }

  async searchKnowledge(
    query: string,
    locale: "en" | "ja" | "zh-CN" = "en",
  ): Promise<GuildKnowledgeSearchResult[]> {
    const results = await this.#searchKnowledge(query, locale);
    await this.#approvalQueue.authorizeObservation({
      title: "Search approved Guild Knowledge",
      description: `Return ${results.length} permission-filtered Canonical Knowledge result(s).`,
    });
    return results;
  }

  async searchMemory(
    query: string,
    locale: "en" | "ja" | "zh-CN" = "en",
  ): Promise<GuildMemorySearchResult[]> {
    const results = await this.#searchMemory(query, locale);
    await this.#approvalQueue.authorizeObservation({
      title: "Search authorized Guild Memory",
      description: `Return ${results.length} permission-filtered Memory result(s).`,
    });
    return results;
  }

  planWebhookAction(input: GuildWebhookPlanInput): Promise<GuildAgentActionReceipt> {
    return this.#planWebhookAction(input);
  }

  async getAgentExecutionContext(): Promise<GuildAgentExecutionContext> {
    const context = await this.#loadAgentExecutionContext();
    await this.#approvalQueue.authorizeObservation({
      title: "Discover governed Agent execution context",
      description:
        `Return ${context.agents.length} runnable Agent(s), ${context.spaces.length} Space(s), ` +
        `and ${context.connectors.length} deployment Connector(s).`,
    });
    return context;
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}
