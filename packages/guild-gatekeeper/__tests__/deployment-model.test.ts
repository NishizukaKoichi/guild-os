import { describe, expect, it } from "vitest";
import type { GuildEnv } from "../src/config.js";
import {
  DEFAULT_WORKERS_AI_MODEL,
  DEPLOYMENT_MODEL_SECRET_REFERENCE,
  deploymentBootstrapModel,
  deploymentModelConfiguration,
} from "../src/deployment-model.js";

function env(values: Readonly<Record<string, unknown>>): GuildEnv {
  return values as unknown as GuildEnv;
}

describe("deployment Model configuration", () => {
  it("keeps purpose-first bootstrap on purchaser Workers AI", () => {
    const configured = env({
      GUILD_ASK_MODEL: "external-model",
      GUILD_BOOTSTRAP_MODEL: "@cf/example/bootstrap",
      GUILD_MODEL_PROVIDER_KIND: "openai_compatible",
      GUILD_MODEL_PROVIDER_ENDPOINT: "https://models.example.test/v1",
    });
    expect(deploymentBootstrapModel(configured)).toBe("@cf/example/bootstrap");
    expect(deploymentModelConfiguration(configured, "embedding")).toMatchObject({
      kind: "workers_ai",
      model: "@cf/baai/bge-m3",
      secretReference: null,
    });
  });

  it("maps an external operational route to the fixed runtime Secret binding", () => {
    expect(deploymentModelConfiguration(env({
      GUILD_ASK_MODEL: "owned-model",
      GUILD_MODEL_PROVIDER_KIND: "openai_compatible",
      GUILD_MODEL_PROVIDER_NAME: "Owned endpoint",
      GUILD_MODEL_PROVIDER_ENDPOINT: "https://models.example.test/v1/",
    }), "ask")).toEqual({
      name: "Owned endpoint",
      kind: "openai_compatible",
      endpointUrl: "https://models.example.test/v1",
      secretReference: DEPLOYMENT_MODEL_SECRET_REFERENCE,
      model: "owned-model",
    });
  });

  it("preserves the legacy Workers AI deployment default", () => {
    const configured = env({ GUILD_ASK_MODEL: DEFAULT_WORKERS_AI_MODEL });
    expect(deploymentBootstrapModel(configured)).toBe(DEFAULT_WORKERS_AI_MODEL);
    expect(deploymentModelConfiguration(configured, "plan")).toMatchObject({
      kind: "workers_ai",
      model: DEFAULT_WORKERS_AI_MODEL,
      endpointUrl: null,
      secretReference: null,
    });
  });
});
