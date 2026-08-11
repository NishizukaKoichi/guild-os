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
    });

    await expect(session.getOverview()).resolves.toEqual(overview);
    expect(calls).toEqual(["load", "authorize"]);
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
