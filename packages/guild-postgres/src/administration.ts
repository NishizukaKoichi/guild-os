import {
  PERMISSIONS,
  assertAgentIdentity,
  assertRoleAssignableToIdentity,
  validateRolePermissions,
  type AgentLimits,
  type AgentProfile,
  type ChronicleEvent,
  type Classification,
  type Identity,
  type IdentityKind,
  type Permission,
  type Role,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface CreateRoleInput {
  id: string;
  name: string;
  permissions: readonly Permission[];
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface UpdateRoleInput {
  roleId: string;
  name: string;
  permissions: readonly Permission[];
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface CreateSpaceInput {
  id: string;
  parentSpaceId: string;
  name: string;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface AssignRoleInput {
  bindingId: string;
  identityId: string;
  roleId: string;
  spaceId: string | null;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface CreateAgentInput {
  identityId: string;
  displayName: string;
  clearance: Classification;
  roleId: string;
  spaceId: string | null;
  instructions: string;
  model: string;
  toolIds: readonly string[];
  limits: AgentLimits;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface CreateServiceInput {
  identityId: string;
  kind?: "service" | "guild";
  displayName: string;
  clearance: Classification;
  roleId: string;
  spaceId: string | null;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

type RoleRow = QueryResultRow & {
  id: string;
  name: string;
  system: boolean;
  permissions: string[];
};

type IdentityRow = QueryResultRow & {
  id: string;
  kind: IdentityKind;
  display_name: string;
  status: "active" | "disabled";
  membership_state: string;
};

const knownPermission = new Set<string>(PERMISSIONS);

function parsePermissions(values: readonly string[]): Permission[] {
  if (!values.every((value) => knownPermission.has(value))) {
    throw new Error("Database contains an unknown Guild permission.");
  }
  return values as Permission[];
}

export class GuildAdministrationRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async createRole(input: CreateRoleInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    validateRolePermissions(input.permissions);
    await this.#connection.query(
      "INSERT INTO roles (id, guild_id, name, system) VALUES ($1, $2, $3, false)",
      [input.id, this.#guildId, input.name],
    );
    await this.#replaceRolePermissions(input.id, input.permissions);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async updateRole(input: UpdateRoleInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    validateRolePermissions(input.permissions);
    const role = await this.#loadRole(input.roleId, true);
    if (role.system) throw new Error("Built-in Roles cannot be modified.");

    const nonHuman = (await this.#connection.query<QueryResultRow>(
      `SELECT 1
         FROM role_bindings rb
         JOIN identities i ON i.guild_id = rb.guild_id AND i.id = rb.identity_id
        WHERE rb.guild_id = $1 AND rb.role_id = $2 AND i.kind <> 'human'
        LIMIT 1`,
      [this.#guildId, input.roleId],
    )).rows.length > 0;
    if (nonHuman) {
      assertRoleAssignableToIdentity({
        ...role,
        name: input.name,
        permissions: input.permissions,
      }, {
        id: "00000000-0000-4000-8000-000000000000",
        guildId: this.#guildId,
        kind: "agent",
        displayName: "Bound machine identity",
        status: "active",
      });
    }

    await this.#connection.query(
      "UPDATE roles SET name = $3 WHERE guild_id = $1 AND id = $2",
      [this.#guildId, input.roleId, input.name],
    );
    await this.#replaceRolePermissions(input.roleId, input.permissions);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async deleteRole(
    roleId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const role = await this.#loadRole(roleId, true);
    if (role.system) throw new Error("Built-in Roles cannot be deleted.");
    const references = await this.#connection.query<QueryResultRow & { reference_count: string }>(
      `SELECT
         (SELECT count(*) FROM role_bindings WHERE guild_id = $1 AND role_id = $2) +
         (SELECT count(*) FROM guild_invitations
           WHERE guild_id = $1 AND role_id = $2 AND state = 'pending'
             AND expires_at > now()) +
         (SELECT count(*) FROM root_ownership_transfers
           WHERE guild_id = $1 AND outgoing_role_id = $2) AS reference_count`,
      [this.#guildId, roleId],
    );
    if (Number(references.rows[0]?.reference_count ?? 0) > 0) {
      throw new Error("Remove Role bindings and pending invitations, and retain Roles referenced by ownership history.");
    }
    await this.#connection.query(
      "DELETE FROM role_permissions WHERE guild_id = $1 AND role_id = $2",
      [this.#guildId, roleId],
    );
    await this.#connection.query("DELETE FROM roles WHERE guild_id = $1 AND id = $2", [
      this.#guildId,
      roleId,
    ]);
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async createSpace(input: CreateSpaceInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const parent = await this.#connection.query<QueryResultRow>(
      "SELECT 1 FROM spaces WHERE guild_id = $1 AND id = $2 AND status = 'active'",
      [this.#guildId, input.parentSpaceId],
    );
    if (parent.rows.length !== 1) throw new Error("Active parent Space was not found.");
    await this.#connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [input.id, this.#guildId, input.parentSpaceId, input.name],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async renameSpace(
    spaceId: string,
    name: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const result = await this.#connection.query(
      "UPDATE spaces SET name = $3 WHERE guild_id = $1 AND id = $2 AND status = 'active'",
      [this.#guildId, spaceId, name],
    );
    if (result.rowCount !== 1) throw new Error("Active Space was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async archiveSpace(
    spaceId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const space = (await this.#connection.query<QueryResultRow & { parent_space_id: string | null }>(
      `SELECT parent_space_id::text FROM spaces
        WHERE guild_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
      [this.#guildId, spaceId],
    )).rows[0];
    if (!space) throw new Error("Active Space was not found.");
    if (space.parent_space_id === null) throw new Error("The root Space cannot be archived.");
    const references = await this.#connection.query<QueryResultRow>(
      `SELECT 1 FROM (
         SELECT id FROM spaces WHERE guild_id = $1 AND parent_space_id = $2 AND status = 'active'
         UNION ALL SELECT id FROM role_bindings WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM files WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM knowledge WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM goals WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM projects WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM quests WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM decisions WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM connectors WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM announcements WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM conversations WHERE guild_id = $1 AND space_id = $2
         UNION ALL SELECT id FROM guild_invitations
           WHERE guild_id = $1 AND space_id = $2 AND state = 'pending' AND expires_at > now()
       ) resource_refs LIMIT 1`,
      [this.#guildId, spaceId],
    );
    if (references.rows.length > 0) {
      throw new Error("Move or remove child Spaces, bindings, and data before archiving this Space.");
    }
    await this.#connection.query(
      "UPDATE spaces SET status = 'archived' WHERE guild_id = $1 AND id = $2",
      [this.#guildId, spaceId],
    );
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async assignRole(input: AssignRoleInput): Promise<boolean> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const identity = await this.#loadIdentity(input.identityId);
    const role = await this.#loadRole(input.roleId);
    assertRoleAssignableToIdentity(role, identity);
    if (input.spaceId !== null) {
      const space = await this.#connection.query<QueryResultRow>(
        "SELECT 1 FROM spaces WHERE guild_id = $1 AND id = $2 AND status = 'active'",
        [this.#guildId, input.spaceId],
      );
      if (space.rows.length !== 1) throw new Error("Active Space was not found.");
    }
    const existing = await this.#connection.query<QueryResultRow>(
      `SELECT 1 FROM role_bindings
        WHERE guild_id = $1 AND identity_id = $2 AND role_id = $3
          AND space_id IS NOT DISTINCT FROM $4::uuid`,
      [this.#guildId, input.identityId, input.roleId, input.spaceId],
    );
    if (existing.rows.length > 0) return false;
    await this.#connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.bindingId, this.#guildId, input.identityId, input.roleId, input.spaceId],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return true;
  }

  async removeRoleBinding(
    bindingId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const result = await this.#connection.query(
      "DELETE FROM role_bindings WHERE guild_id = $1 AND id = $2",
      [this.#guildId, bindingId],
    );
    if (result.rowCount !== 1) throw new Error("Role binding was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async createAgent(input: CreateAgentInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const identity: Identity = {
      id: input.identityId,
      guildId: this.#guildId,
      kind: "agent",
      displayName: input.displayName,
      status: "active",
    };
    const profile: AgentProfile = {
      guildId: this.#guildId,
      identityId: input.identityId,
      instructions: input.instructions,
      model: input.model,
      toolIds: input.toolIds,
      limits: input.limits,
      status: "active",
    };
    assertAgentIdentity(identity, profile);
    const role = await this.#loadRole(input.roleId);
    assertRoleAssignableToIdentity(role, identity);
    await this.#assertActiveSpace(input.spaceId);
    await this.#insertMachineIdentity(identity, input.clearance);
    await this.#connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'active')`,
      [
        this.#guildId,
        input.identityId,
        input.instructions,
        input.model,
        input.toolIds,
        JSON.stringify(input.limits),
      ],
    );
    await this.#insertRoleBinding(crypto.randomUUID(), input.identityId, input.roleId, input.spaceId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async createService(input: CreateServiceInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const identity: Identity = {
      id: input.identityId,
      guildId: this.#guildId,
      kind: input.kind ?? "service",
      displayName: input.displayName,
      status: "active",
    };
    const role = await this.#loadRole(input.roleId);
    assertRoleAssignableToIdentity(role, identity);
    await this.#assertActiveSpace(input.spaceId);
    await this.#insertMachineIdentity(identity, input.clearance);
    await this.#insertRoleBinding(crypto.randomUUID(), input.identityId, input.roleId, input.spaceId);
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  async #loadRole(roleId: string, forUpdate = false): Promise<Role> {
    if (forUpdate) {
      const locked = await this.#connection.query<QueryResultRow>(
        "SELECT 1 FROM roles WHERE guild_id = $1 AND id = $2 FOR UPDATE",
        [this.#guildId, roleId],
      );
      if (locked.rows.length !== 1) throw new Error("Role was not found.");
    }
    const row = (await this.#connection.query<RoleRow>(
      `SELECT r.id::text, r.name, r.system,
              COALESCE(array_agg(rp.permission ORDER BY rp.permission)
                FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.guild_id = r.guild_id AND rp.role_id = r.id
        WHERE r.guild_id = $1 AND r.id = $2
        GROUP BY r.id`,
      [this.#guildId, roleId],
    )).rows[0];
    if (!row) throw new Error("Role was not found.");
    return {
      id: row.id,
      guildId: this.#guildId,
      name: row.name,
      system: row.system,
      permissions: parsePermissions(row.permissions),
    };
  }

  async #loadIdentity(identityId: string): Promise<Identity> {
    const row = (await this.#connection.query<IdentityRow>(
      `SELECT i.id::text, i.kind, i.display_name, i.status, m.state AS membership_state
         FROM identities i
         JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
        WHERE i.guild_id = $1 AND i.id = $2`,
      [this.#guildId, identityId],
    )).rows[0];
    if (!row) throw new Error("Identity was not found.");
    if (row.status !== "active" || !["preboarding", "active"].includes(row.membership_state)) {
      throw new Error("Roles can be assigned only to an enabled Identity with usable membership.");
    }
    return {
      id: row.id,
      guildId: this.#guildId,
      kind: row.kind,
      displayName: row.display_name,
      status: row.status,
    };
  }

  async #replaceRolePermissions(roleId: string, permissions: readonly Permission[]): Promise<void> {
    await this.#connection.query(
      "DELETE FROM role_permissions WHERE guild_id = $1 AND role_id = $2",
      [this.#guildId, roleId],
    );
    await this.#connection.query(
      `INSERT INTO role_permissions (guild_id, role_id, permission)
       SELECT $1, $2, permission FROM unnest($3::text[]) AS permissions(permission)`,
      [this.#guildId, roleId, permissions],
    );
  }

  async #assertActiveSpace(spaceId: string | null): Promise<void> {
    if (spaceId === null) return;
    const result = await this.#connection.query<QueryResultRow>(
      "SELECT 1 FROM spaces WHERE guild_id = $1 AND id = $2 AND status = 'active'",
      [this.#guildId, spaceId],
    );
    if (result.rows.length !== 1) throw new Error("Active Space was not found.");
  }

  async #insertMachineIdentity(identity: Identity, clearance: Classification): Promise<void> {
    await this.#connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [identity.id, this.#guildId, identity.kind, identity.displayName],
    );
    await this.#connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
       VALUES ($1, $2, 'active', $3, now())`,
      [this.#guildId, identity.id, clearance],
    );
  }

  async #insertRoleBinding(
    bindingId: string,
    identityId: string,
    roleId: string,
    spaceId: string | null,
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [bindingId, this.#guildId, identityId, roleId, spaceId],
    );
  }

  #assertEvent(event: ChronicleEvent, actorIdentityId: string): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId) {
      throw new Error("Administration event crosses the active Guild or actor boundary.");
    }
  }
}
