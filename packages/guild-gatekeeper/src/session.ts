import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type {
  GuildKnowledgeSearchResult,
  GuildOverview,
  GuildSession,
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

  constructor(
    approvalQueue: ObservationQueue,
    loadOverview: () => Promise<GuildOverview>,
    searchKnowledge: (
      query: string,
      locale: "en" | "ja" | "zh-CN",
    ) => Promise<GuildKnowledgeSearchResult[]>,
  ) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#loadOverview = loadOverview;
    this.#searchKnowledge = searchKnowledge;
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

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}
