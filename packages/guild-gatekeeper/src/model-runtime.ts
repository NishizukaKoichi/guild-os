import type { ModelProvider, ModelRoute } from "@guild-os/domain";
import type { ResolvedModelRoute } from "@guild-os/postgres";
import { GuildOperationsRepository, withGuildTransaction } from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";

const MAX_MODEL_RESPONSE_BYTES = 2_000_000;
type ModelPurpose = ModelRoute["purpose"];

function secretBinding(env: GuildEnv, reference: string | null): string {
  if (!reference) throw new Error("The selected Model provider has no Secret reference.");
  const value = (env as unknown as Readonly<Record<string, unknown>>)[reference];
  if (typeof value !== "string" || value.length < 1) {
    throw new Error(`Cloudflare Secret binding ${reference} is not configured.`);
  }
  return value;
}

function modelEndpoint(provider: ModelProvider, purpose: ModelPurpose): URL {
  if (!provider.endpointUrl) throw new Error("The selected Model provider has no endpoint.");
  const endpoint = new URL(provider.endpointUrl);
  const suffix = purpose === "embedding" ? "embeddings" : "chat/completions";
  if (!endpoint.pathname.endsWith(`/${suffix}`)) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${suffix}`;
  }
  return endpoint;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_MODEL_RESPONSE_BYTES) {
    throw new Error("Model provider response exceeded the allowed size.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MODEL_RESPONSE_BYTES) {
    throw new Error("Model provider response exceeded the allowed size.");
  }
  if (!response.ok) {
    throw new Error(`Model provider request failed with HTTP ${response.status}.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Model provider returned invalid JSON.");
  }
}

function normalizedExternalResponse(value: unknown, purpose: ModelPurpose): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Model provider returned an invalid response.");
  }
  if (purpose === "embedding") {
    const data = (value as { data?: unknown }).data;
    const first = Array.isArray(data) ? data[0] : undefined;
    const embedding = first && typeof first === "object" && !Array.isArray(first)
      ? (first as { embedding?: unknown }).embedding
      : undefined;
    if (!Array.isArray(embedding)) throw new Error("Model provider returned no embedding.");
    return { data: [embedding], usage: (value as { usage?: unknown }).usage };
  }
  const choices = (value as { choices?: unknown }).choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = first && typeof first === "object" && !Array.isArray(first)
    ? (first as { message?: unknown }).message
    : undefined;
  const content = message && typeof message === "object" && !Array.isArray(message)
    ? (message as { content?: unknown }).content
    : undefined;
  if (typeof content !== "string") throw new Error("Model provider returned no text response.");
  return { response: content, usage: (value as { usage?: unknown }).usage };
}

async function executeModel(
  env: GuildEnv,
  resolved: ResolvedModelRoute,
  model: string,
  purpose: ModelPurpose,
  input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  if (resolved.provider.kind === "workers_ai") {
    const workerInput = purpose === "embedding" && Array.isArray(input.input)
      ? { ...input, input: undefined, text: input.input }
      : input;
    return env.AI.run(model, workerInput, {
      gateway: env.GUILD_AI_GATEWAY_ID
        ? {
            id: env.GUILD_AI_GATEWAY_ID,
            skipCache: !resolved.route.cacheEnabled,
            collectLog: false,
            metadata: { guildId: env.GUILD_ID, purpose },
          }
        : undefined,
    });
  }
  const endpoint = modelEndpoint(resolved.provider, purpose);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretBinding(env, resolved.provider.secretReference)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...input, model }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return normalizedExternalResponse(await readBoundedJson(response), purpose);
}

export async function resolveConfiguredModel(
  env: GuildEnv,
  purpose: ModelPurpose,
): Promise<ResolvedModelRoute> {
  try {
    return await withGuildTransaction(
      env.HYPERDRIVE.connectionString,
      env.GUILD_ID,
      (connection) => new GuildOperationsRepository(connection, env.GUILD_ID)
        .resolveModelRoute(purpose),
    );
  } catch (error) {
    if (!(error instanceof Error) ||
        !error.message.includes("No active Model route is configured")) throw error;
    const now = new Date(0).toISOString();
    const primaryModel = purpose === "embedding" ? "@cf/baai/bge-m3" : env.GUILD_ASK_MODEL;
    console.warn(JSON.stringify({ event: "guild.model.deployment_fallback", purpose }));
    return {
      provider: {
        id: env.GUILD_ID,
        guildId: env.GUILD_ID,
        name: "Cloudflare Workers AI deployment fallback",
        kind: "workers_ai",
        endpointUrl: null,
        secretReference: null,
        allowedModels: [env.GUILD_ASK_MODEL, "@cf/baai/bge-m3"],
        status: "active",
        deploymentManaged: true,
        createdByActorId: env.GUILD_ID,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      route: {
        id: env.GUILD_ID,
        guildId: env.GUILD_ID,
        purpose,
        providerId: env.GUILD_ID,
        primaryModel,
        fallbackModel: null,
        maxTokens: purpose === "plan" ? 4_096 : 2_048,
        dailyBudgetMinor: 0,
        cacheEnabled: purpose === "embedding",
        status: "active",
        updatedByActorId: env.GUILD_ID,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    };
  }
}

export async function runConfiguredModel(
  env: GuildEnv,
  purpose: ModelPurpose,
  input: Readonly<Record<string, unknown>>,
  requestedModel: string | null = null,
): Promise<unknown> {
  const resolved = await resolveConfiguredModel(env, purpose);
  const model = requestedModel ?? resolved.route.primaryModel;
  if (!resolved.provider.allowedModels.includes(model)) {
    throw new Error("The requested Model is not allowed by the active provider.");
  }
  const boundedInput = purpose === "embedding" ? input : {
    ...input,
    max_tokens: Math.min(
      typeof input.max_tokens === "number" ? input.max_tokens : resolved.route.maxTokens,
      resolved.route.maxTokens,
    ),
  };
  try {
    return await executeModel(env, resolved, model, purpose, boundedInput);
  } catch (error) {
    const fallback = requestedModel === null ? resolved.route.fallbackModel : null;
    if (!fallback || fallback === model) throw error;
    return executeModel(env, resolved, fallback, purpose, boundedInput);
  }
}
