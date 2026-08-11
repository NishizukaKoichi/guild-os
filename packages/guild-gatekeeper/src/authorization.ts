import { PERMISSIONS, authorize, isAuthorized, type Space } from "@guild-os/domain";
import {
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import type { GuildOverview } from "./types.js";

async function loadAuthorizedSnapshot(env: GuildEnv, accountId: string) {
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    async (connection) => {
      const snapshot = await loadActorAuthorizationSnapshot(connection, env.GUILD_ID, accountId);
      const identity = snapshot.identities.find((candidate) => candidate.id === accountId);
      const membership = snapshot.memberships.find((candidate) => candidate.identityId === accountId);
      if (!identity || !membership) throw new Error("Open the Guild page to enroll this account.");
      authorize(snapshot, { actorIdentityId: accountId, permission: "guild.read" });
      return { snapshot, identity, membership };
    },
  );
}

export async function loadGuildOverview(
  env: GuildEnv,
  accountId: string,
): Promise<GuildOverview> {
  const { snapshot, identity, membership } = await loadAuthorizedSnapshot(env, accountId);
  const spaces = await loadAuthorizedSpaces(env, accountId);
  return {
    guildId: snapshot.guild.id,
    name: snapshot.guild.name,
    purpose: snapshot.guild.purpose,
    identityId: identity.id,
    identityKind: identity.kind,
    membershipState: membership.state,
    rootOwner: identity.id === snapshot.guild.rootOwnerIdentityId,
    globalPermissions: PERMISSIONS.filter((permission) => isAuthorized(snapshot, {
      actorIdentityId: accountId,
      permission,
    })),
    spaces: spaces.map((space) => ({
      id: space.id,
      name: space.name,
      parentSpaceId: space.parentSpaceId,
    })),
  };
}

export async function loadAuthorizedSpaces(env: GuildEnv, accountId: string): Promise<Space[]> {
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    (connection) => listAuthorizedSpaces(connection, env.GUILD_ID, accountId, "space.read"),
  );
}
