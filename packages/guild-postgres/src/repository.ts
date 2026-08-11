import type {
  AuthorizationSnapshot,
  ChronicleEvent,
  Constitution,
  MembershipState,
  Permission,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { loadAuthorizationSnapshot } from "./authorization-snapshot.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface BootstrapRole {
  id: string;
  name: string;
  permissions: readonly Permission[];
}

export interface BootstrapGuildInput {
  guildId: string;
  name: string;
  purpose: string;
  rootIdentityId: string;
  rootDisplayName: string;
  rootSpaceId: string;
  rootSpaceName: string;
  constitution: Constitution;
  roles: readonly BootstrapRole[];
  chronicleEvent: ChronicleEvent;
}

export interface EnrollMemberInput {
  identityId: string;
  displayName: string;
  chronicleEvent: ChronicleEvent;
}

export interface GuildSetupState {
  initialized: boolean;
  identityExists: boolean;
  membershipState: MembershipState | null;
}

export class GuildPostgresRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
  }

  async getSetupState(identityId: string): Promise<GuildSetupState> {
    const guild = await this.#connection.query<QueryResultRow>(
      "SELECT 1 FROM guilds WHERE id = $1",
      [this.#guildId],
    );
    if (guild.rows.length === 0) {
      return { initialized: false, identityExists: false, membershipState: null };
    }
    const identity = await this.#connection.query<QueryResultRow & { state: MembershipState | null }>(
      `SELECT m.state
         FROM identities i
         LEFT JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
        WHERE i.guild_id = $1 AND i.id = $2`,
      [this.#guildId, identityId],
    );
    const row = identity.rows[0];
    return {
      initialized: true,
      identityExists: row !== undefined,
      membershipState: row?.state ?? null,
    };
  }

  async bootstrapGuild(input: BootstrapGuildInput): Promise<boolean> {
    if (input.guildId !== this.#guildId || input.constitution.guildId !== this.#guildId ||
        input.chronicleEvent.guildId !== this.#guildId ||
        input.constitution.updatedByIdentityId !== input.rootIdentityId ||
        input.chronicleEvent.actorIdentityId !== input.rootIdentityId) {
      throw new Error("Bootstrap input crosses the active Guild transaction.");
    }
    await this.#connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      this.#guildId,
    ]);
    const existing = await this.#connection.query<QueryResultRow>(
      "SELECT 1 FROM guilds WHERE id = $1",
      [this.#guildId],
    );
    if (existing.rows.length > 0) return false;

    await this.#connection.query(
      `INSERT INTO guilds (id, name, purpose, root_owner_identity_id)
       VALUES ($1, $2, $3, $4)`,
      [input.guildId, input.name, input.purpose, input.rootIdentityId],
    );
    await this.#connection.query(
      `INSERT INTO identities
         (id, guild_id, kind, display_name, status, access_subject)
       VALUES ($1::uuid, $2, 'human', $3, 'active',
               'cloudflare-os-account:' || $1::uuid::text)`,
      [input.rootIdentityId, input.guildId, input.rootDisplayName],
    );
    await this.#connection.query(
      `INSERT INTO memberships
         (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', 'restricted', now())`,
      [input.guildId, input.rootIdentityId],
    );
    await this.#connection.query(
      `INSERT INTO constitutions
         (guild_id, version, level2_approval_quorum, level3_approval_quorum,
          data_retention_days, agent_defaults, updated_by_identity_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        input.guildId,
        input.constitution.version,
        input.constitution.level2ApprovalQuorum,
        input.constitution.level3ApprovalQuorum,
        input.constitution.dataRetentionDays,
        JSON.stringify(input.constitution.agentDefaults),
        input.constitution.updatedByIdentityId,
        input.constitution.updatedAt,
      ],
    );
    await this.#connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, NULL, $3, 'active')`,
      [input.rootSpaceId, input.guildId, input.rootSpaceName],
    );
    for (const role of input.roles) {
      await this.#connection.query(
        `INSERT INTO roles (id, guild_id, name, system)
         VALUES ($1, $2, $3, true)`,
        [role.id, input.guildId, role.name],
      );
      for (const permission of role.permissions) {
        await this.#connection.query(
          `INSERT INTO role_permissions (guild_id, role_id, permission)
           VALUES ($1, $2, $3)`,
          [input.guildId, role.id, permission],
        );
      }
    }
    await this.appendChronicle(input.chronicleEvent);
    return true;
  }

  async enrollPreboardingMember(input: EnrollMemberInput): Promise<boolean> {
    if (input.chronicleEvent.guildId !== this.#guildId ||
        input.chronicleEvent.actorIdentityId !== input.identityId) {
      throw new Error("Enrollment event must be authored by the enrolling identity.");
    }
    const existing = await this.getSetupState(input.identityId);
    if (!existing.initialized) throw new Error("Guild must be initialized before member enrollment.");
    if (existing.identityExists) return false;
    await this.#connection.query(
      `INSERT INTO identities
         (id, guild_id, kind, display_name, status, access_subject)
       VALUES ($1::uuid, $2, 'human', $3, 'active',
               'cloudflare-os-account:' || $1::uuid::text)`,
      [input.identityId, this.#guildId, input.displayName],
    );
    await this.#connection.query(
      `INSERT INTO memberships
         (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'preboarding', 'internal', NULL)`,
      [this.#guildId, input.identityId],
    );
    await this.appendChronicle(input.chronicleEvent);
    return true;
  }

  loadAuthorizationSnapshot(): Promise<AuthorizationSnapshot> {
    return loadAuthorizationSnapshot(this.#connection, this.#guildId);
  }

  async appendChronicle(event: ChronicleEvent): Promise<void> {
    if (event.guildId !== this.#guildId) {
      throw new Error("Chronicle event crosses the active Guild transaction.");
    }
    await this.#connection.query(
      `INSERT INTO chronicle_events
         (id, guild_id, actor_identity_id, action, subject_type, subject_id,
          correlation_id, occurred_at, details, space_id, owner_identity_id,
          visibility, classification, allowed_identity_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::uuid[])`,
      [
        event.id,
        event.guildId,
        event.actorIdentityId,
        event.action,
        event.subjectType,
        event.subjectId,
        event.correlationId,
        event.occurredAt,
        JSON.stringify(event.details),
        event.spaceId,
        event.ownerIdentityId,
        event.visibility,
        event.classification,
        event.allowedIdentityIds ?? [],
      ],
    );
  }
}
