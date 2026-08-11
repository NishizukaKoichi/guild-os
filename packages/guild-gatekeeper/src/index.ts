export * from "./guild.js";

import type { GuildEnv } from "./config.js";
import { drainKnowledgeFileDeletionQueue } from "./knowledge-service.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("Guild Gatekeeper worker is running.", {
      headers: { "content-type": "text/plain" },
    });
  },
  async scheduled(
    _controller: ScheduledController,
    env: GuildEnv,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(drainKnowledgeFileDeletionQueue(env));
  },
} satisfies ExportedHandler<GuildEnv>;
