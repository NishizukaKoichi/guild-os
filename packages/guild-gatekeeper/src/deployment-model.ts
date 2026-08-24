import type { ModelProvider, ModelRoute } from "@guild-os/domain";
import type { GuildEnv } from "./config.js";

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const DEPLOYMENT_MODEL_SECRET_REFERENCE = "GUILD_MODEL_PROVIDER_TOKEN";

export interface DeploymentModelConfiguration {
  name: string;
  kind: ModelProvider["kind"];
  endpointUrl: string | null;
  secretReference: string | null;
  model: string;
}

function nonBlank(value: string | undefined, fallback: string, label: string): string {
  const resolved = value?.trim() || fallback;
  if (resolved.length > 300) throw new Error(`${label} is too long.`);
  return resolved;
}

function externalEndpoint(value: string | undefined): string {
  if (!value?.trim()) throw new Error("The deployment Model provider endpoint is missing.");
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash) {
    throw new Error("The deployment Model provider endpoint must be a credential-free HTTPS URL.");
  }
  return endpoint.toString().replace(/\/$/, "");
}

export function deploymentBootstrapModel(env: GuildEnv): string {
  return nonBlank(env.GUILD_BOOTSTRAP_MODEL, DEFAULT_WORKERS_AI_MODEL, "Bootstrap Model");
}

export function deploymentModelConfiguration(
  env: GuildEnv,
  purpose: ModelRoute["purpose"],
): DeploymentModelConfiguration {
  if (purpose === "embedding") {
    return {
      name: "Cloudflare Workers AI",
      kind: "workers_ai",
      endpointUrl: null,
      secretReference: null,
      model: DEFAULT_EMBEDDING_MODEL,
    };
  }

  const kind = env.GUILD_MODEL_PROVIDER_KIND?.trim() || "workers_ai";
  const model = nonBlank(env.GUILD_ASK_MODEL, DEFAULT_WORKERS_AI_MODEL, "Guild Model");
  if (kind === "workers_ai") {
    return {
      name: nonBlank(env.GUILD_MODEL_PROVIDER_NAME, "Cloudflare Workers AI", "Model provider name"),
      kind,
      endpointUrl: null,
      secretReference: null,
      model,
    };
  }
  if (kind !== "openai_compatible") {
    throw new Error("The deployment Model provider kind is unsupported.");
  }
  return {
    name: nonBlank(env.GUILD_MODEL_PROVIDER_NAME, "Purchaser-owned Model provider", "Model provider name"),
    kind,
    endpointUrl: externalEndpoint(env.GUILD_MODEL_PROVIDER_ENDPOINT),
    secretReference: DEPLOYMENT_MODEL_SECRET_REFERENCE,
    model,
  };
}
