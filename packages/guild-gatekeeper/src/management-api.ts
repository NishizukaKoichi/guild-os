import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  SUPPORTED_LOCALES,
  authorize,
  assertNonBlank,
  isAuthorized,
  type AppLocale,
  type Permission,
} from "@guild-os/domain";
import {
  GuildDirectoryRepository,
  GuildPostgresRepository,
  loadActorAuthorizationSnapshot,
  type GuildTransactionConnection,
  withGuildTransaction,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  ClaimInvitationInput,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  UiBootstrapState,
  UiDirectory,
  UiDirectoryRequest,
} from "./management-types.js";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INVITATION_DAYS = 90;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(value: Readonly<object> | null): string | null {
  return value === null ? null : bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeCursor<T extends Readonly<Record<string, string>>>(
  value: string | null | undefined,
  fields: readonly (keyof T)[],
): T | null {
  if (!value) return null;
  if (value.length > 1000) throw new Error("Directory cursor is malformed.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object" || !fields.every((field) =>
      typeof (parsed as Record<string, unknown>)[String(field)] === "string")) {
      throw new Error("invalid cursor shape");
    }
    return parsed as T;
  } catch {
    throw new Error("Directory cursor is malformed.");
  }
}

export function generateInvitationToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashInvitationToken(token: string): Promise<string> {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    throw new Error("Invitation token is malformed.");
  }
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  )));
}

function assertLocale(locale: AppLocale): void {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    throw new Error("Unsupported locale.");
  }
}

function assertInvitationDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_INVITATION_DAYS) {
    throw new Error(`Invitation expiry must be between 1 and ${MAX_INVITATION_DAYS} days.`);
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

@validateRpc()
export class GuildManagementApiImpl extends RpcTarget implements GuildUiApi {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    super();
    this.#env = env;
    this.#accountId = accountId;
  }

  async getBootstrap(): Promise<UiBootstrapState> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildPostgresRepository(connection, this.#env.GUILD_ID);
        const state = await repository.getSetupState(this.#accountId);
        const result = await connection.query<{
          root_owner_identity_id: string;
          preferred_locale: AppLocale | null;
        }>(
          `SELECT g.root_owner_identity_id::text,
                  (SELECT preferred_locale FROM identities
                    WHERE guild_id = g.id AND id = $2) AS preferred_locale
             FROM guilds g WHERE g.id = $1`,
          [this.#env.GUILD_ID, this.#accountId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Guild is not initialized.");
        return {
          guildId: this.#env.GUILD_ID,
          guildName: this.#env.GUILD_NAME,
          guildPurpose: this.#env.GUILD_PURPOSE,
          accountId: this.#accountId,
          identityExists: state.identityExists,
          membershipState: state.membershipState,
          rootOwner: row.root_owner_identity_id === this.#accountId,
          rootOwnerIdentityId: row.root_owner_identity_id,
          preferredLocale: row.preferred_locale ?? "en",
        };
      },
    );
  }

  async claimInvitation(input: ClaimInvitationInput): Promise<UiBootstrapState> {
    assertNonBlank(input.displayName, "Display name");
    assertLocale(input.preferredLocale);
    const tokenHash = await hashInvitationToken(input.token);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const directory = new GuildDirectoryRepository(connection, this.#env.GUILD_ID);
        await directory.claimInvitation({
          tokenHash,
          identityId: this.#accountId,
          displayName: input.displayName,
          preferredLocale: input.preferredLocale,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "membership.invitation.accepted",
            "identity",
            this.#accountId,
            { source: "guild-ui" },
          ),
        });
      },
    );
    return this.getBootstrap();
  }

  async getDirectory(request: UiDirectoryRequest = {}): Promise<UiDirectory> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        for (const permission of [
          "identity.read",
          "membership.read",
          "role.read",
          "space.read",
        ] as const) {
          authorize(snapshot, { actorIdentityId: this.#accountId, permission });
        }
        const canManageMemberships = isAuthorized(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "membership.manage",
        });
        const identityCursor = decodeCursor<{ displayName: string; id: string }>(
          request.identityCursor,
          ["displayName", "id"],
        );
        const invitationCursor = decodeCursor<{ createdAt: string; id: string }>(
          request.invitationCursor,
          ["createdAt", "id"],
        );
        if (identityCursor) assertUuid(identityCursor.id, "Identity cursor ID");
        if (invitationCursor) assertUuid(invitationCursor.id, "Invitation cursor ID");
        const directory = await new GuildDirectoryRepository(
          connection,
          this.#env.GUILD_ID,
        ).listDirectory({
          identityCursor,
          invitationCursor,
          includeIdentities: request.includeIdentities !== false,
          includeInvitations: canManageMemberships && request.includeInvitations !== false,
        });
        return {
          ...directory,
          nextIdentityCursor: encodeCursor(directory.nextIdentityCursor),
          nextInvitationCursor: encodeCursor(directory.nextInvitationCursor),
          canManageMemberships,
        };
      },
    );
  }

  async issueInvitation(input: IssueInvitationInput): Promise<IssuedInvitation> {
    assertNonBlank(input.inviteeLabel, "Invitee label");
    assertUuid(input.roleId, "Role ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
    if (input.initialMembershipState !== "preboarding" && input.initialMembershipState !== "active") {
      throw new Error("Initial membership state is invalid.");
    }
    assertInvitationDays(input.expiresInDays);
    const invitationId = crypto.randomUUID();
    const token = generateInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const invitation = await this.#authorizedWrite(
      "membership.manage",
      async (connection) => new GuildDirectoryRepository(
        connection,
        this.#env.GUILD_ID,
      ).createInvitation({
        id: invitationId,
        tokenHash,
        inviteeLabel: input.inviteeLabel,
        roleId: input.roleId,
        spaceId: input.spaceId,
        initialMembershipState: input.initialMembershipState,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
        createdByIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "membership.invitation.created",
          "invitation",
          invitationId,
          {
            roleId: input.roleId,
            spaceId: input.spaceId,
            initialMembershipState: input.initialMembershipState,
          },
        ),
      }),
    );
    return { invitation, token };
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    assertUuid(invitationId, "Invitation ID");
    await this.#authorizedWrite("membership.manage", async (connection) => {
      await new GuildDirectoryRepository(connection, this.#env.GUILD_ID).revokeInvitation(
        invitationId,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "membership.invitation.revoked",
          "invitation",
          invitationId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async changeMembership(
    identityId: string,
    nextState: "preboarding" | "active" | "suspended" | "departed",
  ): Promise<void> {
    assertUuid(identityId, "Identity ID");
    if (!["preboarding", "active", "suspended", "departed"].includes(nextState)) {
      throw new Error("Membership state is invalid.");
    }
    await this.#authorizedWrite("membership.manage", async (connection) => {
      await new GuildDirectoryRepository(connection, this.#env.GUILD_ID).changeMembership({
        actorIdentityId: this.#accountId,
        identityId,
        nextState,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          `membership.${nextState}`,
          "identity",
          identityId,
          { source: "guild-ui" },
        ),
      });
    });
  }

  async setPreferredLocale(locale: AppLocale): Promise<void> {
    assertLocale(locale);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const result = await connection.query(
          `UPDATE identities i
              SET preferred_locale = $3
             FROM memberships m
            WHERE i.guild_id = $1 AND i.id = $2 AND i.status = 'active'
              AND m.guild_id = i.guild_id AND m.identity_id = i.id
              AND m.state IN ('preboarding', 'active')`,
          [this.#env.GUILD_ID, this.#accountId, locale],
        );
        if (result.rowCount !== 1) throw new Error("Active Guild identity was not found.");
      },
    );
  }

  async #authorizedWrite<T>(
    permission: Permission,
    operation: (connection: GuildTransactionConnection) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        authorize(snapshot, { actorIdentityId: this.#accountId, permission });
        return operation(connection);
      },
    );
  }
}
