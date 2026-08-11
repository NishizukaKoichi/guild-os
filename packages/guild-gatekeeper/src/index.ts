export * from "./guild.js";
export { AgentExecutionWorkflow } from "./agent-workflow.js";

import type { GuildEnv } from "./config.js";
import { drainKnowledgeFileDeletionQueue } from "./knowledge-service.js";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";

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
    context.waitUntil(Promise.all([
      drainKnowledgeFileDeletionQueue(env),
      drainAgentWorkflowOutbox(env),
    ]).then(() => undefined));
  },
} satisfies ExportedHandler<GuildEnv>;
