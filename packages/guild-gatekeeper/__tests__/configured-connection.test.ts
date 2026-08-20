import type { Connector } from "@guild-os/domain";
import { describe, expect, it, vi } from "vitest";
import { ConnectionAdapterError } from "../src/connection-adapters.js";
import type { GuildEnv } from "../src/config.js";
import { createConfiguredConnectionAdapter } from "../src/configured-connection.js";

function connection(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    guildId: "00000000-0000-4000-8000-000000000002",
    spaceId: null,
    ownerIdentityId: "00000000-0000-4000-8000-000000000003",
    name: "Purchaser Connection",
    kind: "https_webhook",
    status: "active",
    capabilityPermissions: ["connection.execute"],
    endpointUrl: "https://hooks.purchaser.example.test/events",
    secretReference: "PURCHASER_CONNECTION_TOKEN",
    description: "Purchaser-owned integration",
    provider: "purchaser",
    configuration: {},
    authKind: "secret_reference",
    writeRiskLevel: 2,
    healthStatus: "unknown",
    lastCheckedAt: null,
    visibility: "guild",
    classification: "internal",
    allowedIdentityIds: [],
    deploymentManaged: false,
    version: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

function env(bindings: Readonly<Record<string, unknown>> = {}): GuildEnv {
  return bindings as unknown as GuildEnv;
}

describe("configured purchaser Connection", () => {
  it("resolves a fixed webhook credential only at invocation time", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer purchaser-secret");
      return new Response(JSON.stringify({ accepted: true }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const adapter = createConfiguredConnectionAdapter(env({
      PURCHASER_CONNECTION_TOKEN: "purchaser-secret",
    }), connection());

    await expect(adapter.invoke({
      capabilityId: "webhook.send",
      input: { event: "fictional.test" },
      idempotencyKey: "invoke-0001",
    })).resolves.toMatchObject({ capabilityId: "webhook.send", statusCode: 200 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps an MCP Connection to an explicit capability allowlist", async () => {
    const adapter = createConfiguredConnectionAdapter(env(), connection({
      kind: "mcp",
      endpointUrl: "https://mcp.purchaser.example.test/connect",
      secretReference: null,
      authKind: "none",
      configuration: {
        adapterKind: "cloudflare_os_mcp",
        allowedCapabilities: [{ id: "memory.search", title: "Search Memory" }],
      },
    }));
    expect(adapter.kind).toBe("cloudflare_os_mcp");
  });

  it("uses a purchaser Service Binding without accepting an endpoint URL", async () => {
    const binding = { fetch: vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/health")) return new Response(null, { status: 204 });
      throw new Error("Unexpected route");
    }) };
    const adapter = createConfiguredConnectionAdapter(env({ PURCHASER_GATEKEEPER: binding }),
      connection({
        kind: "cloudflare_service",
        endpointUrl: null,
        secretReference: null,
        authKind: "service_binding",
        configuration: {
          bindingReference: "PURCHASER_GATEKEEPER",
          allowedCapabilities: ["knowledge.read"],
        },
      }));
    await expect(adapter.health()).resolves.toMatchObject({ status: "healthy", code: "ok" });
    expect(binding.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "cloudflare_gatekeeper",
    "email",
    "calendar",
    "file_storage",
    "git_repository",
    "external_api",
    "model_provider",
  ] as const)("routes the %s profile through the bounded purchaser Gatekeeper", (kind) => {
    const adapter = createConfiguredConnectionAdapter(env(), connection({
      kind,
      secretReference: null,
      authKind: "none",
      configuration: {
        allowedCapabilities: [{ id: `${kind}.execute` }],
      },
    }));

    expect(adapter.kind).toBe("cloudflare_gatekeeper_https");
  });

  it.each([
    { status: "revoked" as const, kind: "https_webhook" as const, code: "capability_not_allowed" },
    { status: "active" as const, kind: "database" as const, code: "unsupported_operation" },
  ])("fails closed for $status $kind Connections", ({ status, kind, code }) => {
    expect(() => createConfiguredConnectionAdapter(env(), connection({ status, kind })))
      .toThrowError(expect.objectContaining<Partial<ConnectionAdapterError>>({ code }));
  });
});
