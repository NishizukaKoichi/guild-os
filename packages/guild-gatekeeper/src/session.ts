import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import type { GuildOverview, GuildSession } from "./types.js";

type ObservationQueue = Pick<ApprovalQueue, "authorizeObservation"> &
  Partial<{ [Symbol.dispose](): void }>;

@validateRpc()
export class GuildSessionImpl extends RpcTarget implements GuildSession {
  readonly #approvalQueue: ObservationQueue;
  readonly #loadOverview: () => Promise<GuildOverview>;

  constructor(approvalQueue: ObservationQueue, loadOverview: () => Promise<GuildOverview>) {
    super();
    this.#approvalQueue = approvalQueue;
    this.#loadOverview = loadOverview;
  }

  async getOverview(): Promise<GuildOverview> {
    const overview = await this.#loadOverview();
    await this.#approvalQueue.authorizeObservation({
      title: `Read Guild overview: ${overview.name}`,
      description: "Read the current account's Guild membership, global permissions, and Spaces.",
    });
    return overview;
  }

  [Symbol.dispose](): void {
    this.#approvalQueue[Symbol.dispose]?.();
  }
}
