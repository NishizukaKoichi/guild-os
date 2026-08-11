import { describe, expect, it } from "vitest";
import {
  GuildSessionImpl,
  describeGuildAccount,
  describeGuildVendor,
} from "../src/guild.js";
import type { GuildOverview } from "../src/types.js";

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
});
