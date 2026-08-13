import { describe, expect, it, vi } from "vitest";
import {
  ConnectionAdapterError,
  createConnectionAdapter,
  type ConnectionAdapterErrorCode,
  type ConnectionFetch,
} from "../src/connection-adapters.js";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const SECRET = "purchaser-owned-secret-value";

function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function expectAdapterError(
  operation: Promise<unknown>,
  code: ConnectionAdapterErrorCode,
): Promise<ConnectionAdapterError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionAdapterError);
    expect(error).toMatchObject({ code });
    return error as ConnectionAdapterError;
  }
  throw new Error(`Expected ConnectionAdapterError(${code}).`);
}

function parseRequestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function mcpFetch(
  tools: readonly Record<string, unknown>[],
  callResult: Record<string, unknown> = { content: [{ type: "text", text: "done" }] },
): ReturnType<typeof vi.fn<ConnectionFetch>> {
  return vi.fn<ConnectionFetch>(async (_input, init) => {
    expect(init?.redirect).toBe("manual");
    const request = parseRequestBody(init);
    const id = request.id;
    switch (request.method) {
      case "initialize":
        return jsonResponse({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "Purchaser MCP", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        }, { headers: { "mcp-session-id": "session-1" } });
      case "notifications/initialized":
        expect(new Headers(init?.headers).get("mcp-session-id")).toBe("session-1");
        return new Response(null, { status: 202 });
      case "tools/list":
        expect(new Headers(init?.headers).get("mcp-session-id")).toBe("session-1");
        return jsonResponse({ jsonrpc: "2.0", id, result: { tools } });
      case "tools/call":
        expect(new Headers(init?.headers).get("mcp-session-id")).toBe("session-1");
        return jsonResponse({ jsonrpc: "2.0", id, result: callResult });
      default:
        throw new Error("Unexpected MCP method.");
    }
  });
}

const allowedTool = {
  name: "memory.search",
  title: "Search Memory",
  description: "Search authorized Guild Memory.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

const extraTool = {
  name: "admin.delete",
  title: "Delete",
  description: "Not granted to this Connection.",
  inputSchema: { type: "object" },
};

describe("Cloudflare OS and MCP HTTPS adapter", () => {
  it("filters discovery to the configured capabilities and invokes through one typed contract", async () => {
    const fetcher = mcpFetch([extraTool, allowedTool]);
    const adapter = createConnectionAdapter({
      kind: "cloudflare_os_mcp",
      endpointUrl: "https://mcp.purchaser.example.test/connect",
      capabilities: [{
        id: "memory.search",
        title: "Approved Memory Search",
        description: "Purchaser-approved read scope.",
      }],
      secretHeaders: [{
        name: "Authorization",
        secretReference: "PURCHASER_MCP_TOKEN",
        format: "bearer",
      }],
    }, {
      fetch: fetcher,
      resolveSecret: async (reference) => {
        expect(reference).toBe("PURCHASER_MCP_TOKEN");
        return SECRET;
      },
      now: () => NOW,
    });

    const discovered = await adapter.discover();
    expect(discovered).toEqual({
      capabilities: [{
        id: "memory.search",
        title: "Approved Memory Search",
        description: "Purchaser-approved read scope.",
        inputSchema: allowedTool.inputSchema,
        source: "mcp_tool",
      }],
      oauth: null,
    });
    expect(fetcher.mock.calls.every((call) =>
      new Headers(call[1]?.headers).get("authorization") === `Bearer ${SECRET}`)).toBe(true);

    const invoked = await adapter.invoke({
      capabilityId: "memory.search",
      input: { query: "retention policy" },
      idempotencyKey: "run-1",
    });
    expect(invoked).toEqual({
      capabilityId: "memory.search",
      statusCode: 200,
      output: { content: [{ type: "text", text: "done" }] },
    });
    const toolCall = fetcher.mock.calls
      .map((call) => parseRequestBody(call[1]))
      .find((request) => request.method === "tools/call");
    expect(toolCall?.params).toEqual({
      name: "memory.search",
      arguments: { query: "retention policy" },
    });
  });

  it("accepts a bounded Streamable HTTP event response", async () => {
    const fetcher = vi.fn<ConnectionFetch>(async (_input, init) => {
      const request = parseRequestBody(init);
      if (request.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      const id = request.id;
      const result = request.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "SSE MCP", version: "1" },
            capabilities: { tools: {} },
          }
        : { tools: [allowedTool] };
      return new Response(`event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0", id, result,
      })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    });
    const adapter = createConnectionAdapter({
      kind: "mcp_https",
      endpointUrl: "https://stream.purchaser.example.test/mcp",
      capabilities: [{ id: "memory.search" }],
    }, { fetch: fetcher });

    await expect(adapter.discover()).resolves.toMatchObject({
      capabilities: [{ id: "memory.search", source: "mcp_tool" }],
    });
  });

  it.each([
    {
      name: "duplicate",
      tools: [allowedTool, allowedTool],
      configured: "memory.search",
      code: "duplicate_capability" as const,
    },
    {
      name: "unknown configured",
      tools: [extraTool],
      configured: "memory.search",
      code: "capability_mismatch" as const,
    },
    {
      name: "malformed",
      tools: [{ ...allowedTool, inputSchema: "not-a-schema" }],
      configured: "memory.search",
      code: "invalid_response" as const,
    },
  ])("rejects $name MCP discovery results", async ({ tools, configured, code }) => {
    const adapter = createConnectionAdapter({
      kind: "mcp_https",
      endpointUrl: "https://mcp.purchaser.example.test/connect",
      capabilities: [{ id: configured }],
    }, { fetch: mcpFetch(tools) });
    await expectAdapterError(adapter.discover(), code);
  });

  it("returns a deterministic unhealthy result instead of leaking a transport failure", async () => {
    const adapter = createConnectionAdapter({
      kind: "mcp_https",
      endpointUrl: "https://mcp.purchaser.example.test/connect",
      capabilities: [{ id: "memory.search" }],
    }, {
      fetch: async () => {
        throw new Error("socket details that must not reach the UI");
      },
      now: () => NOW,
    });

    await expect(adapter.health()).resolves.toEqual({
      status: "unhealthy",
      code: "network_error",
      message: "Connection could not be reached.",
      checkedAt: NOW.toISOString(),
    });
  });
});

describe("Cloudflare Gatekeeper HTTPS adapter", () => {
  it("checks health, filters actions, and invokes only an allowed action", async () => {
    const fetcher = vi.fn<ConnectionFetch>(async (input, init) => {
      expect(init?.redirect).toBe("manual");
      const url = new URL(String(input));
      if (url.pathname === "/bridge/health") return new Response(null, { status: 204 });
      if (url.pathname === "/bridge/capabilities") {
        return jsonResponse({ actions: [
          { id: "knowledge.read", title: "Read", inputSchema: { type: "object" } },
          { id: "owner.rotate", title: "Rotate owner", inputSchema: { type: "object" } },
        ] });
      }
      if (url.pathname === "/bridge/invoke") {
        expect(parseRequestBody(init)).toEqual({
          capabilityId: "knowledge.read",
          input: { id: "memory-1" },
          idempotencyKey: "request-1",
        });
        return jsonResponse({ accepted: true });
      }
      throw new Error("Unexpected route.");
    });
    const adapter = createConnectionAdapter({
      kind: "cloudflare_gatekeeper_https",
      endpointUrl: "https://gatekeeper.purchaser.example.test/bridge",
      capabilities: [{ id: "knowledge.read" }],
    }, { fetch: fetcher, now: () => NOW });

    await expect(adapter.health()).resolves.toMatchObject({ status: "healthy", code: "ok" });
    await expect(adapter.discover()).resolves.toMatchObject({
      capabilities: [{ id: "knowledge.read", source: "gatekeeper_action" }],
    });
    await expect(adapter.invoke({
      capabilityId: "knowledge.read",
      input: { id: "memory-1" },
      idempotencyKey: "request-1",
    })).resolves.toEqual({
      capabilityId: "knowledge.read",
      statusCode: 200,
      output: { accepted: true },
    });
    await expectAdapterError(adapter.invoke({
      capabilityId: "owner.rotate",
      input: {},
    }), "capability_not_allowed");
  });
});

describe("fixed HTTPS webhook adapter", () => {
  it("uses the configured endpoint for health and invocation without accepting a caller URL", async () => {
    const seenUrls: string[] = [];
    const fetcher = vi.fn<ConnectionFetch>(async (input, init) => {
      seenUrls.push(String(input));
      if (init?.method === "HEAD") return new Response(null, { status: 204 });
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("delivery-1");
      return jsonResponse({ delivered: true });
    });
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/guild-events",
      capabilities: [{ id: "announcement.publish", title: "Publish announcement" }],
    }, { fetch: fetcher, now: () => NOW });

    expect((await adapter.discover()).capabilities).toEqual([{
      id: "announcement.publish",
      title: "Publish announcement",
      description: "",
      inputSchema: null,
      source: "webhook",
    }]);
    await expect(adapter.health()).resolves.toMatchObject({ status: "healthy", code: "ok" });
    await expect(adapter.invoke({
      capabilityId: "announcement.publish",
      input: { title: "Policy updated" },
      idempotencyKey: "delivery-1",
    })).resolves.toMatchObject({ statusCode: 200, output: { delivered: true } });
    expect(new Set(seenUrls)).toEqual(new Set([
      "https://hooks.purchaser.example.test/guild-events",
    ]));
  });
});

describe("OAuth metadata adapter", () => {
  it("discovers and validates metadata without implementing a token exchange", async () => {
    const fetcher = vi.fn<ConnectionFetch>(async (input, init) => {
      expect(String(input)).toBe(
        "https://identity.purchaser.example.test/.well-known/oauth-authorization-server/tenant");
      expect(init?.method).toBe("GET");
      return jsonResponse({
        issuer: "https://identity.purchaser.example.test/tenant",
        authorization_endpoint: "https://identity.purchaser.example.test/authorize",
        token_endpoint: "https://identity.purchaser.example.test/token",
        jwks_uri: "https://identity.purchaser.example.test/jwks",
        revocation_endpoint: "https://identity.purchaser.example.test/revoke",
        scopes_supported: ["openid", "guild.read"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
      });
    });
    const adapter = createConnectionAdapter({
      kind: "oauth_metadata",
      issuerUrl: "https://identity.purchaser.example.test/tenant",
    }, { fetch: fetcher, now: () => NOW });

    const discovery = await adapter.discover();
    expect(discovery.capabilities).toEqual([]);
    expect(discovery.oauth).toEqual({
      issuer: "https://identity.purchaser.example.test/tenant",
      authorizationEndpoint: "https://identity.purchaser.example.test/authorize",
      tokenEndpoint: "https://identity.purchaser.example.test/token",
      jwksUri: "https://identity.purchaser.example.test/jwks",
      registrationEndpoint: null,
      revocationEndpoint: "https://identity.purchaser.example.test/revoke",
      introspectionEndpoint: null,
      scopesSupported: ["openid", "guild.read"],
      responseTypesSupported: ["code"],
      grantTypesSupported: ["authorization_code"],
      codeChallengeMethodsSupported: ["S256"],
    });
    const callsBeforeInvoke = fetcher.mock.calls.length;
    await expectAdapterError(adapter.invoke({ capabilityId: "oauth.exchange", input: {} }),
      "unsupported_operation");
    expect(fetcher).toHaveBeenCalledTimes(callsBeforeInvoke);
  });

  it("rejects metadata that points token handling at an SSRF target", async () => {
    const adapter = createConnectionAdapter({
      kind: "oauth_metadata",
      issuerUrl: "https://identity.purchaser.example.test",
    }, {
      fetch: async () => jsonResponse({
        issuer: "https://identity.purchaser.example.test",
        authorization_endpoint: "https://identity.purchaser.example.test/authorize",
        token_endpoint: "https://127.0.0.1/token",
        response_types_supported: ["code"],
      }),
    });
    await expectAdapterError(adapter.discover(), "unsafe_endpoint");
  });
});

describe("Cloudflare service-binding adapter", () => {
  it("uses only the passed Fetcher-like binding for discovery and invocation", async () => {
    const networkFetch = vi.fn<ConnectionFetch>(async () => {
      throw new Error("Network fetch must not be used.");
    });
    const bindingFetch = vi.fn<ConnectionFetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://guild-service.invalid");
      if (url.pathname.endsWith("/capabilities")) {
        return jsonResponse({ actions: [
          { id: "run.start", title: "Start run", inputSchema: { type: "object" } },
          { id: "secret.read", title: "Read secret", inputSchema: { type: "object" } },
        ] });
      }
      if (url.pathname.endsWith("/invoke")) {
        expect(parseRequestBody(init)).toMatchObject({ capabilityId: "run.start" });
        return jsonResponse({ runId: "run-1" }, { status: 201 });
      }
      if (url.pathname.endsWith("/health")) return new Response(null, { status: 204 });
      throw new Error("Unexpected binding path.");
    });
    const adapter = createConnectionAdapter({
      kind: "cloudflare_service",
      basePath: "/purchaser/gatekeeper",
      capabilities: [{ id: "run.start" }],
    }, {
      fetch: networkFetch,
      serviceBinding: { fetch: bindingFetch },
      now: () => NOW,
    });

    await expect(adapter.health()).resolves.toMatchObject({ status: "healthy" });
    await expect(adapter.discover()).resolves.toMatchObject({
      capabilities: [{ id: "run.start", source: "service_action" }],
    });
    await expect(adapter.invoke({ capabilityId: "run.start", input: { workflow: "review" } }))
      .resolves.toEqual({
        capabilityId: "run.start",
        statusCode: 201,
        output: { runId: "run-1" },
      });
    expect(networkFetch).not.toHaveBeenCalled();
    expect(bindingFetch).toHaveBeenCalled();
  });

  it("fails configuration when a service binding was not supplied", () => {
    expect(() => createConnectionAdapter({
      kind: "cloudflare_service",
      capabilities: [{ id: "run.start" }],
    })).toThrowError(ConnectionAdapterError);
  });
});

describe("common transport safety boundary", () => {
  it.each([
    "http://public.example.test/hook",
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://metadata.google.internal/token",
    "https://service.internal/hook",
    "https://intranet/hook",
  ])("rejects unsafe network endpoint %s", (endpointUrl) => {
    try {
      createConnectionAdapter({
        kind: "https_webhook",
        endpointUrl,
        capabilities: [{ id: "event.send" }],
      });
      throw new Error("Expected unsafe endpoint rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionAdapterError);
      expect(error).toMatchObject({ code: "unsafe_endpoint" });
    }
  });

  it("refuses redirects for both health checks and invocations", async () => {
    const fetcher = vi.fn<ConnectionFetch>(async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" },
    }));
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/event",
      capabilities: [{ id: "event.send" }],
    }, { fetch: fetcher, now: () => NOW });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "unhealthy",
      code: "redirect_refused",
    });
    await expectAdapterError(adapter.invoke({ capabilityId: "event.send", input: {} }),
      "redirect_refused");
    expect(fetcher.mock.calls.every((call) => call[1]?.redirect === "manual")).toBe(true);
  });

  it("bounds streamed response bodies even without Content-Length", async () => {
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/event",
      capabilities: [{ id: "event.send" }],
      limits: { maxResponseBytes: 32 },
    }, {
      fetch: async () => new Response("x".repeat(64), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    });
    await expectAdapterError(adapter.invoke({ capabilityId: "event.send", input: {} }),
      "response_too_large");
  });

  it("enforces a hard timeout even when the injected fetch never settles", async () => {
    const fetcher = vi.fn<ConnectionFetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/event",
      capabilities: [{ id: "event.send" }],
      limits: { timeoutMs: 5 },
    }, { fetch: fetcher, now: () => NOW });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "unhealthy",
      code: "request_timeout",
      message: "Connection request timed out.",
    });
  });

  it("never returns or embeds a resolved secret when an upstream echoes it", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<ConnectionFetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("x-purchaser-key")).toBe(SECRET);
      return jsonResponse({ reflectedCredential: SECRET });
    });
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/event",
      capabilities: [{ id: "event.send" }],
      secretHeaders: [{
        name: "X-Purchaser-Key",
        secretReference: "PURCHASER_WEBHOOK_KEY",
      }],
    }, {
      fetch: fetcher,
      resolveSecret: () => SECRET,
    });

    const error = await expectAdapterError(
      adapter.invoke({ capabilityId: "event.send", input: { value: "public" } }),
      "secret_exposure",
    );
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(error.message).not.toContain(SECRET);
    expect(warning).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    warning.mockRestore();
    errorLog.mockRestore();
  });

  it("fails closed when a configured secret reference cannot be resolved", async () => {
    const fetcher = vi.fn<ConnectionFetch>();
    const adapter = createConnectionAdapter({
      kind: "https_webhook",
      endpointUrl: "https://hooks.purchaser.example.test/event",
      capabilities: [{ id: "event.send" }],
      secretHeaders: [{
        name: "Authorization",
        secretReference: "PURCHASER_WEBHOOK_KEY",
        format: "bearer",
      }],
    }, { fetch: fetcher, now: () => NOW });

    await expect(adapter.health()).resolves.toMatchObject({
      status: "unhealthy",
      code: "secret_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
