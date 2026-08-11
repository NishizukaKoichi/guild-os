import { describe, expect, it } from "vitest";
import {
  GuildSessionImpl,
  describeGuildAccount,
  describeGuildVendor,
} from "../src/guild.js";
import type { GuildAgentExecutionContext, GuildOverview } from "../src/types.js";
import { generateInvitationToken, hashInvitationToken } from "../src/management-api.js";
import { deliverSignedWebhook } from "../src/agent-webhook.js";
import type { AgentExecutionClaim } from "../src/agent-service.js";

describe("guild-gatekeeper", () => {
  it("describes a managed singleton with a full-page Guild surface", () => {
    expect(describeGuildVendor()).toMatchObject({
      displayName: "Guild OS",
      autoProvisionsAccount: true,
      providesAuth: false,
    });
    expect(describeGuildAccount()).toMatchObject({
      displayName: "Guild OS",
      singleton: { tsType: "GuildSession" },
      providesUi: { title: "Guild" },
    });
  });

  it("authorizes an overview observation before returning it", async () => {
    const calls: string[] = [];
    const overview: GuildOverview = {
      guildId: "guild-id",
      name: "Example Guild",
      purpose: "Coordinate people and agents",
      identityId: "identity-id",
      identityKind: "human",
      membershipState: "active",
      rootOwner: true,
      globalPermissions: ["guild.read"],
      spaces: [],
    };
    const session = new GuildSessionImpl({
      async authorizeObservation() {
        calls.push("authorize");
      },
    }, async () => {
      calls.push("load");
      return overview;
    }, async () => []);

    await expect(session.getOverview()).resolves.toEqual(overview);
    expect(calls).toEqual(["load", "authorize"]);
  });

  it("returns permission-filtered Knowledge only after observation authorization", async () => {
    const calls: string[] = [];
    const result = [{
      knowledgeId: "knowledge-id",
      version: 3,
      title: "Safety policy",
      summary: "Approved guidance",
      content: "Use the reviewed procedure.",
      spaceId: "space-id",
    }];
    const session = new GuildSessionImpl({
      async authorizeObservation() {
        calls.push("authorize");
      },
    }, async () => {
      throw new Error("unused");
    }, async (query, locale) => {
      calls.push(`filter:${query}:${locale}`);
      return result;
    });

    await expect(session.searchKnowledge("procedure", "ja")).resolves.toEqual(result);
    expect(calls).toEqual(["filter:procedure:ja", "authorize"]);
  });

  it("does not return filtered Knowledge when observation authorization is denied", async () => {
    const session = new GuildSessionImpl({
      async authorizeObservation() {
        throw new Error("observation denied");
      },
    }, async () => {
      throw new Error("unused");
    }, async () => [{
      knowledgeId: "knowledge-id",
      version: 1,
      title: "Restricted",
      summary: "Restricted",
      content: "Restricted",
      spaceId: null,
    }]);

    await expect(session.searchKnowledge("restricted")).rejects.toThrow("observation denied");
  });

  it("authorizes filtered Agent execution discovery before returning IDs", async () => {
    const calls: string[] = [];
    const context: GuildAgentExecutionContext = {
      spaces: [{ id: "space-id", name: "Research", parentSpaceId: null }],
      agents: [{
        identityId: "agent-id",
        displayName: "Research Agent",
        model: "workers-ai/default",
        spaceIds: ["space-id"],
        limits: {
          currency: "USD",
          maxBudgetMinor: 0,
          maxDurationSeconds: 30,
          maxSteps: 3,
          maxRetries: 0,
          maxDelegationDepth: 0,
        },
      }],
      connectors: [{ id: "connector-id", name: "Operations", kind: "https_webhook" }],
    };
    const session = new GuildSessionImpl({
      async authorizeObservation() { calls.push("authorize"); },
    }, async () => {
      throw new Error("unused");
    }, async () => [], undefined, async () => {
      calls.push("filter");
      return context;
    });

    await expect(session.getAgentExecutionContext()).resolves.toEqual(context);
    expect(calls).toEqual(["filter", "authorize"]);
  });

  it("creates high-entropy invitation tokens and stores only deterministic hashes", async () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    await expect(hashInvitationToken(first)).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(hashInvitationToken(first)).resolves.toBe(await hashInvitationToken(first));
    await expect(hashInvitationToken("short")).rejects.toThrow("malformed");
  });

  it("stages a session Agent action through its governed callback", async () => {
    const input = {
      requestId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa0",
      agentIdentityId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa1",
      connectorId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa2",
      spaceId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa3",
      objective: "Publish completion",
      expectedOutcome: "One signed event is accepted.",
      steps: ["Verify authority", "Send event"],
      eventType: "guild.quest.completed",
      payload: { completed: true },
      estimatedDurationSeconds: 10,
    };
    const session = new GuildSessionImpl({
      async authorizeObservation() {},
    }, async () => {
      throw new Error("unused");
    }, async () => [], async (received) => ({
      runId: received.requestId,
      actionId: 7,
      status: "pending",
      message: "Awaiting approval.",
    }));

    await expect(session.planWebhookAction(input)).resolves.toEqual({
      runId: input.requestId,
      actionId: 7,
      status: "pending",
      message: "Awaiting approval.",
    });
  });

  it("signs exactly one bounded Webhook request with an idempotency key", async () => {
    const claim: AgentExecutionClaim = {
      runId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab0",
      guildId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab1",
      agentIdentityId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab2",
      requesterIdentityId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab3",
      eventType: "guild.quest.completed",
      payloadJson: JSON.stringify({ questId: "quest-1", completed: true }),
      idempotencyKey: "guild-agent:test-run",
      plannedSteps: 2,
      endpointUrl: "https://hooks.example.com/guild-events",
      effectiveLimits: {
        currency: "USD",
        maxBudgetMinor: 0,
        maxDurationSeconds: 30,
        maxSteps: 2,
        maxRetries: 0,
        maxDelegationDepth: 0,
      },
    };
    const requests: { url: string; init: RequestInit }[] = [];
    const result = await deliverSignedWebhook(
      claim.endpointUrl,
      "test-signing-secret-with-at-least-32-characters",
      claim,
      async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 202 });
      },
    );

    expect(result.statusCode).toBe(202);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const headers = new Headers(request.init.headers);
    const body = String(request.init.body);
    const timestamp = headers.get("x-guild-timestamp")!;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("test-signing-secret-with-at-least-32-characters"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = headers.get("x-guild-signature")!.replace(/^v1=/, "");
    const signatureBytes = Uint8Array.from(signature.match(/../g)!, (pair) => Number.parseInt(pair, 16));
    await expect(crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(`${timestamp}.${body}`),
    )).resolves.toBe(true);
    expect(request.url).toBe(claim.endpointUrl);
    expect(request.init.redirect).toBe("error");
    expect(headers.get("idempotency-key")).toBe(claim.idempotencyKey);
    expect(JSON.parse(body)).toMatchObject({
      id: claim.runId,
      type: claim.eventType,
      data: { questId: "quest-1", completed: true },
    });
  });
});
