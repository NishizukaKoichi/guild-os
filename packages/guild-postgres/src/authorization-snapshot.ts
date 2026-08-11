import {
  PERMISSIONS,
  assertSnapshotIntegrity,
  type AgentLimits,
  type AgentProfile,
  type AuthorizationSnapshot,
  type Classification,
  type Constitution,
  type Guild,
  type Identity,
  type IdentityKind,
  type IdentityStatus,
  type Membership,
  type MembershipState,
  type Permission,
  type Role,
  type RoleBinding,
  type Space,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import type { GuildTransactionConnection } from "./transaction.js";

type GuildRow = QueryResultRow & {
  id: string;
  name: string;
  purpose: string;
  root_owner_identity_id: string;
  created_at: string;
  updated_at: string;
};

type ConstitutionRow = QueryResultRow & {
  guild_id: string;
  version: number;
  level2_approval_quorum: number;
  level3_approval_quorum: number;
  data_retention_days: number;
  agent_defaults: AgentLimits;
  updated_by_identity_id: string;
  updated_at: string;
};

type SpaceRow = QueryResultRow & {
  id: string;
  guild_id: string;
  parent_space_id: string | null;
  name: string;
  status: "active" | "archived";
};

type IdentityRow = QueryResultRow & {
  id: string;
  guild_id: string;
  kind: IdentityKind;
  display_name: string;
  status: IdentityStatus;
};

type MembershipRow = QueryResultRow & {
  guild_id: string;
  identity_id: string;
  state: MembershipState;
  clearance: Classification;
  joined_at: string | null;
  departed_at: string | null;
};

type RoleRow = QueryResultRow & {
  id: string;
  guild_id: string;
  name: string;
  system: boolean;
  permissions: string[];
};

type BindingRow = QueryResultRow & {
  guild_id: string;
  identity_id: string;
  role_id: string;
  space_id: string | null;
};

type AgentRow = QueryResultRow & {
  guild_id: string;
  identity_id: string;
  instructions: string;
  model: string;
  tool_ids: string[];
  limits: AgentLimits;
  status: "active" | "stopped";
};

const permissionSet = new Set<string>(PERMISSIONS);

function parsePermissions(values: readonly string[]): Permission[] {
  if (!values.every((value) => permissionSet.has(value))) {
    throw new Error("Database contains an unknown Guild permission.");
  }
  return values as Permission[];
}

function requireOne<Row>(rows: readonly Row[], entity: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`${entity} was not found in the current Guild transaction.`);
  return row;
}

export async function loadAuthorizationSnapshot(
  connection: GuildTransactionConnection,
  guildId: string,
): Promise<AuthorizationSnapshot> {
  const guildRow = requireOne((await connection.query<GuildRow>(
    `SELECT id::text, name, purpose, root_owner_identity_id::text,
            created_at::text, updated_at::text
       FROM guilds WHERE id = $1`,
    [guildId],
  )).rows, "Guild");
  const constitutionRow = requireOne((await connection.query<ConstitutionRow>(
    `SELECT guild_id::text, version, level2_approval_quorum, level3_approval_quorum,
            data_retention_days, agent_defaults, updated_by_identity_id::text, updated_at::text
       FROM constitutions WHERE guild_id = $1`,
    [guildId],
  )).rows, "Constitution");
  const spaces = (await connection.query<SpaceRow>(
    `SELECT id::text, guild_id::text, parent_space_id::text, name, status
       FROM spaces WHERE guild_id = $1`,
    [guildId],
  )).rows;
  const identities = (await connection.query<IdentityRow>(
    `SELECT id::text, guild_id::text, kind, display_name, status
       FROM identities WHERE guild_id = $1`,
    [guildId],
  )).rows;
  const memberships = (await connection.query<MembershipRow>(
    `SELECT guild_id::text, identity_id::text, state, clearance,
            joined_at::text, departed_at::text
       FROM memberships WHERE guild_id = $1`,
    [guildId],
  )).rows;
  const roles = (await connection.query<RoleRow>(
    `SELECT r.id::text, r.guild_id::text, r.name, r.system,
            COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.guild_id = r.guild_id AND rp.role_id = r.id
      WHERE r.guild_id = $1
      GROUP BY r.id`,
    [guildId],
  )).rows;
  const bindings = (await connection.query<BindingRow>(
    `SELECT guild_id::text, identity_id::text, role_id::text, space_id::text
       FROM role_bindings WHERE guild_id = $1`,
    [guildId],
  )).rows;
  const agents = (await connection.query<AgentRow>(
    `SELECT guild_id::text, identity_id::text, instructions, model, tool_ids, limits, status
       FROM agent_profiles WHERE guild_id = $1`,
    [guildId],
  )).rows;

  const guild: Guild = {
    id: guildRow.id,
    name: guildRow.name,
    purpose: guildRow.purpose,
    rootOwnerIdentityId: guildRow.root_owner_identity_id,
    createdAt: guildRow.created_at,
    updatedAt: guildRow.updated_at,
  };
  const constitution: Constitution = {
    guildId: constitutionRow.guild_id,
    version: constitutionRow.version,
    level2ApprovalQuorum: constitutionRow.level2_approval_quorum,
    level3ApprovalQuorum: constitutionRow.level3_approval_quorum,
    dataRetentionDays: constitutionRow.data_retention_days,
    agentDefaults: constitutionRow.agent_defaults,
    updatedByIdentityId: constitutionRow.updated_by_identity_id,
    updatedAt: constitutionRow.updated_at,
  };
  const snapshot: AuthorizationSnapshot = {
    guild,
    constitution,
    spaces: spaces.map((row): Space => ({
      id: row.id,
      guildId: row.guild_id,
      parentSpaceId: row.parent_space_id,
      name: row.name,
      status: row.status,
    })),
    identities: identities.map((row): Identity => ({
      id: row.id,
      guildId: row.guild_id,
      kind: row.kind,
      displayName: row.display_name,
      status: row.status,
    })),
    memberships: memberships.map((row): Membership => ({
      guildId: row.guild_id,
      identityId: row.identity_id,
      state: row.state,
      clearance: row.clearance,
      joinedAt: row.joined_at,
      departedAt: row.departed_at,
    })),
    roles: roles.map((row): Role => ({
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      system: row.system,
      permissions: parsePermissions(row.permissions),
    })),
    roleBindings: bindings.map((row): RoleBinding => ({
      guildId: row.guild_id,
      identityId: row.identity_id,
      roleId: row.role_id,
      spaceId: row.space_id,
    })),
    agents: agents.map((row): AgentProfile => ({
      guildId: row.guild_id,
      identityId: row.identity_id,
      instructions: row.instructions,
      model: row.model,
      toolIds: row.tool_ids,
      limits: row.limits,
      status: row.status,
    })),
  };
  assertSnapshotIntegrity(snapshot);
  return snapshot;
}
