import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActIntentRequest } from "../src/management-types.js";
import type { GuildEnv } from "../src/config.js";
import { GuildManagementApiImpl } from "../src/management-api.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function messagesFrom(input: Readonly<Record<string, unknown>>): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(input.messages)
    ? input.messages.filter((message): message is Readonly<Record<string, unknown>> =>
      message !== null && typeof message === "object" && !Array.isArray(message))
    : [];
}

function systemPrompt(input: Readonly<Record<string, unknown>>): string {
  return messagesFrom(input)
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content as string)
    .join("\n");
}

function guildEnv(
  guildId: string,
  planContext: { spaceId: string | null; sourceMemoryId: string | null },
): GuildEnv {
  const env = {
    GUILD_ID: guildId,
    GUILD_NAME: "Intent Journey Guild",
    GUILD_PURPOSE: "Verify the durable Ask, Plan, and Act production path.",
    GUILD_ROOT_SPACE_NAME: "Guild",
    GUILD_LEVEL2_QUORUM: "1",
    GUILD_LEVEL3_QUORUM: "2",
    GUILD_RETENTION_DAYS: "365",
    GUILD_ASK_MODEL: "@cf/test/intent-model",
    GUILD_AI_GATEWAY_ID: "",
    GUILD_WEBHOOK_CONNECTOR_ID: randomUUID(),
    GUILD_WEBHOOK_CONNECTOR_NAME: "Intent integration webhook",
    GUILD_WEBHOOK_URL: "https://hooks.example.com/intent",
    GUILD_WEBHOOK_SIGNING_SECRET: "integration-secret",
    HYPERDRIVE: { connectionString: connectionString! },
    ASK_RATE_LIMITER: {
      limit: async () => ({ success: true }),
    },
    RECOVERY_RATE_LIMITER: {
      limit: async () => ({ success: true }),
    },
    AI: {
      async run(_model: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
        if (Array.isArray(input.text)) {
          return { data: [Array.from({ length: 1_024 }, (_, index) => index === 0 ? 1 : 0)] };
        }
        if (systemPrompt(input).includes("Create an inspectable Guild OS Plan proposal")) {
          if (planContext.spaceId === null || planContext.sourceMemoryId === null) {
            throw new Error("Plan fixture was not initialized.");
          }
          return {
            response: JSON.stringify({
              actions: [{
                kind: "memory.propose",
                riskLevel: 1,
                request: {
                  spaceId: planContext.spaceId,
                  type: "agent_output",
                  title: { en: "Inspectable Plan output" },
                  summary: { en: "A governed output created from authorized Ask evidence." },
                  body: { en: "The Plan preserved its source and required an explicit Act." },
                  visibility: "space",
                  classification: "internal",
                  allowedActorIds: [],
                  sourceIds: [planContext.sourceMemoryId],
                  confidence: 0.9,
                  custody: "guild",
                  layer: "working",
                  provenance: { source: "intent-integration-test" },
                  lastVerifiedAt: null,
                  changeNote: "Created through the durable Plan and Act path.",
                },
              }],
            }),
          };
        }
        return { response: "Use the authorized procedure. [C1]" };
      },
    },
  };
  return env as unknown as GuildEnv;
}

integration("Ask, Plan, and Act management API", () => {
  it("keeps Ask read-only and durably executes one explicitly confirmed action", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const guildId = randomUUID();
    const rootId = randomUUID();
    const planContext = { spaceId: null as string | null, sourceMemoryId: null as string | null };
    const api = new GuildManagementApiImpl(guildEnv(guildId, planContext), rootId, true);

    await api.initializeGuild({
      templateKey: "blank",
      purpose: "Coordinate governed work from shared evidence.",
      participants: "Humans and bounded Agents.",
      memoryIntent: "Approved evidence and inspectable working records.",
      activityIntent: "Explicitly planned and authorized work.",
      decisionStyle: "Human confirmation with durable approval for consequential actions.",
      languageAndStyle: "Clear, calm, and accountable.",
      agentIntent: "Prepare reversible internal plans.",
      humanApprovalIntent: "External and irreversible actions.",
      displayName: "Intent Root",
      preferredLocale: "en",
      rootOwnershipAccepted: true,
    });
    const context = await api.getCollectiveContext();
    const rootSpace = context.spaces[0];
    if (!rootSpace) throw new Error("Root Space was not initialized.");
    planContext.spaceId = rootSpace.id;
    planContext.sourceMemoryId = await api.createMemory({
      spaceId: rootSpace.id,
      type: "manual",
      title: { en: "Intent integration evidence" },
      summary: { en: "Evidence used to verify the Ask to Plan boundary." },
      body: { en: "Create an inspectable proposal before executing a write." },
      visibility: "space",
      classification: "internal",
      allowedActorIds: [],
      sourceIds: [],
      confidence: 1,
      custody: "guild",
      layer: "working",
      provenance: { source: "integration-test" },
      lastVerifiedAt: null,
      changeNote: "Seed the authorized Ask context.",
    });

    const ask = await api.askGuild({ question: "Intent integration evidence", locale: "en" });
    expect(ask.citations.some((citation) => citation.resourceId === planContext.sourceMemoryId)).toBe(true);
    expect(await api.listIntentProposals()).toEqual([]);

    const planned = await api.createIntentPlan({
      requestId: randomUUID(),
      question: "Intent integration evidence",
      objective: "Create an inspectable working record from the approved procedure",
      locale: "en",
      spaceId: rootSpace.id,
    });
    expect(planned.created).toBe(true);
    expect(planned.proposal).toMatchObject({
      status: "ready",
      canAct: true,
      nextActionPosition: 0,
    });
    expect(planned.proposal.actions).toHaveLength(1);
    expect(planned.proposal.actions[0]).toMatchObject({
      kind: "memory.propose",
      riskLevel: 1,
      requiredPermission: "memory.create",
      explicitConfirmationRequired: true,
    });

    expect(() => api.actIntent({
      proposalId: planned.proposal.id,
      confirmation: false,
    } as unknown as ActIntentRequest)).toThrow(/expected true|Explicit Act confirmation/);

    const acted = await api.actIntent({
      proposalId: planned.proposal.id,
      confirmation: true,
    });
    expect(acted.outcome).toBe("completed");
    expect(acted.proposal.status).toBe("completed");
    expect(acted.proposal.actions[0]?.status).toBe("succeeded");

    const resourceId = acted.proposal.actions[0]!.resourceId;
    const memoryPage = await api.getMemoryPage();
    expect(memoryPage.items.filter((memory) => memory.id === resourceId)).toHaveLength(1);

    const replay = await api.actIntent({
      proposalId: planned.proposal.id,
      confirmation: true,
    });
    expect(replay.outcome).toBe("completed");
    expect((await api.getMemoryPage()).items.filter((memory) => memory.id === resourceId)).toHaveLength(1);

    const chronicle = await api.getChroniclePage({ search: "intent action succeeded" });
    expect(chronicle.items.some((event) => event.subjectId === planned.proposal.id)).toBe(true);
  }, 30_000);
});
