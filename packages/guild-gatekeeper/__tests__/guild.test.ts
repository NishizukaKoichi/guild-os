import { describe, expect, it } from "vitest";
import {
  GuildSessionImpl,
  describeGuildAccount,
  describeGuildVendor,
} from "../src/guild.js";
import type { GuildOverview } from "../src/types.js";
import { generateInvitationToken, hashInvitationToken } from "../src/management-api.js";

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
});
