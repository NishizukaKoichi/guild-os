import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import {
  GuildOperationsRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import { runConfiguredModel } from "../src/model-runtime.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(guildId: string, actorId: string, action: string, type: string, id: string): ChronicleEvent {
  return {
    id: randomUUID(), guildId, spaceId: null, ownerIdentityId: actorId,
    visibility: "guild", classification: "restricted", allowedIdentityIds: [],
    actorIdentityId: actorId, action, subjectType: type, subjectId: id,
    correlationId: randomUUID(), occurredAt: new Date().toISOString(), details: { source: "test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId, version: 1, level2ApprovalQuorum: 1, level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD", maxBudgetMinor: 1_000, maxTokens: 100_000,
      maxDurationSeconds: 900, maxSteps: 20, maxRetries: 2, maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId, updatedAt: new Date().toISOString(),
  };
}

async function fixture() {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const guildId = randomUUID();
  const rootId = randomUUID();
  await withGuildTransaction(connectionString, guildId, async (connection) => {
    await new GuildPostgresRepository(connection, guildId).bootstrapGuild({
      guildId, name: "Model Runtime Test Guild", purpose: "Verify purchaser-owned model routing",
      rootIdentityId: rootId, rootDisplayName: "Human Root", rootSpaceId: randomUUID(),
      rootSpaceName: "Guild", constitution: constitution(guildId, rootId),
      roles: [{ id: randomUUID(), name: "Root delegate", permissions: ["guild.read", "data.manage"] }],
      chronicleEvent: event(guildId, rootId, "guild.initialized", "guild", guildId),
    });
  });
  return { guildId, rootId };
}

function env(ids: Awaited<ReturnType<typeof fixture>>, aiRun: GuildEnv["AI"]["run"], secret?: string): GuildEnv {
  return {
    GUILD_ID: ids.guildId,
    GUILD_AI_GATEWAY_ID: "test-gateway",
    HYPERDRIVE: { connectionString: connectionString! },
    AI: { run: aiRun },
    ...(secret ? { PURCHASER_MODEL_TOKEN: secret } : {}),
  } as unknown as GuildEnv;
}

async function createProviderAndRoute(
  ids: Awaited<ReturnType<typeof fixture>>,
  provider: {
    kind: "workers_ai" | "openai_compatible";
    endpointUrl: string | null;
    secretReference: string | null;
    models: readonly string[];
  },
  purpose: "ask" | "embedding",
  primary: string,
  fallback: string | null = null,
) {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  await withGuildTransaction(connectionString, ids.guildId, async (connection) => {
    const repository = new GuildOperationsRepository(connection, ids.guildId);
    const providerId = randomUUID();
    await repository.createModelProvider({
      id: providerId, actorId: ids.rootId, createdByActorId: ids.rootId,
      name: `${provider.kind}-${randomUUID()}`, kind: provider.kind,
      endpointUrl: provider.endpointUrl, secretReference: provider.secretReference,
      allowedModels: provider.models,
      chronicleEvent: event(ids.guildId, ids.rootId, "model.provider_created", "model_provider", providerId),
    });
    const routeId = randomUUID();
    await repository.createModelRoute({
      id: routeId, actorId: ids.rootId, purpose, providerId, primaryModel: primary,
      fallbackModel: fallback, maxTokens: 321, dailyBudgetMinor: 0,
      cacheEnabled: true, status: "active", updatedByActorId: ids.rootId,
      chronicleEvent: event(ids.guildId, ids.rootId, "model.route_created", "model_route", routeId),
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

integration("purchaser-owned Model runtime", () => {
  it("uses the configured Workers AI route, clamps output, and falls back once", async () => {
    const ids = await fixture();
    await createProviderAndRoute(ids, {
      kind: "workers_ai", endpointUrl: null, secretReference: null,
      models: ["primary-model", "fallback-model"],
    }, "ask", "primary-model", "fallback-model");
    const calls: { model: string; input: Readonly<Record<string, unknown>> }[] = [];
    const aiRun: GuildEnv["AI"]["run"] = async (model, input) => {
      calls.push({ model, input });
      if (model === "primary-model") throw new Error("Primary unavailable");
      return { response: "Fallback answer" };
    };
    await expect(runConfiguredModel(env(ids, aiRun), "ask", {
      messages: [{ role: "user", content: "Bounded request" }], max_tokens: 9_999,
    })).resolves.toEqual({ response: "Fallback answer" });
    expect(calls.map((call) => call.model)).toEqual(["primary-model", "fallback-model"]);
    expect(calls.every((call) => call.input.max_tokens === 321)).toBe(true);
  });

  it("resolves an external Secret binding without persisting or returning its value", async () => {
    const ids = await fixture();
    await createProviderAndRoute(ids, {
      kind: "openai_compatible", endpointUrl: "https://models.example.test/v1",
      secretReference: "PURCHASER_MODEL_TOKEN", models: ["owned-model"],
    }, "ask", "owned-model");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://models.example.test/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-test-token");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "Purchaser model answer" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runConfiguredModel(env(ids, async () => ({}), "private-test-token"),
      "ask", { messages: [{ role: "user", content: "Question" }] });
    expect(result).toEqual({
      response: "Purchaser model answer",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed when the purchaser-owned Secret binding is absent", async () => {
    const ids = await fixture();
    await createProviderAndRoute(ids, {
      kind: "openai_compatible", endpointUrl: "https://models.example.test/v1",
      secretReference: "PURCHASER_MODEL_TOKEN", models: ["owned-model"],
    }, "ask", "owned-model");
    await expect(runConfiguredModel(env(ids, async () => ({})), "ask", {
      messages: [{ role: "user", content: "Question" }],
    })).rejects.toThrow("Secret binding PURCHASER_MODEL_TOKEN is not configured");
  });
});
