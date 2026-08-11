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

type BindingRow = QueryResultRow & {
  guild_id: string;
  identity_id: string;
  role_id: string;
  space_id: string | null;
};

type RoleRow = QueryResultRow & {
  id: string;
  guild_id: string;
  name: string;
  system: boolean;
  permissions: string[];
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

function requireRow<Row>(rows: readonly Row[], entity: string): Row {
  const row = rows[0];
  if (!row) throw new Error(`${entity} was not found in the active Guild.`);
  return row;
}

export async function loadActorAuthorizationSnapshot(
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityId: string,
  resourceSpaceId: string | null = null,
): Promise<AuthorizationSnapshot> {
  return loadBoundedAuthorizationSnapshot(
    connection,
    guildId,
    [actorIdentityId],
    resourceSpaceId,
  );
}

export async function loadAgentAuthorizationSnapshot(
  connection: GuildTransactionConnection,
  guildId: string,
  agentIdentityId: string,
  requesterIdentityId: string,
  resourceSpaceId: string | null = null,
): Promise<AuthorizationSnapshot> {
  return loadBoundedAuthorizationSnapshot(
    connection,
    guildId,
    [agentIdentityId, requesterIdentityId],
    resourceSpaceId,
  );
}

async function loadBoundedAuthorizationSnapshot(
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityIds: readonly string[],
  resourceSpaceId: string | null,
): Promise<AuthorizationSnapshot> {
  if (actorIdentityIds.length < 1 || new Set(actorIdentityIds).size !== actorIdentityIds.length) {
    throw new Error("Authorization subjects must contain unique Identity IDs.");
  }
  const guildRow = requireRow((await connection.query<GuildRow>(
    `SELECT id::text, name, purpose, root_owner_identity_id::text,
            created_at::text, updated_at::text
       FROM guilds WHERE id = $1`,
    [guildId],
  )).rows, "Guild");
  const constitutionRow = requireRow((await connection.query<ConstitutionRow>(
    `SELECT guild_id::text, version, level2_approval_quorum, level3_approval_quorum,
            data_retention_days, agent_defaults, updated_by_identity_id::text, updated_at::text
       FROM constitutions WHERE guild_id = $1`,
    [guildId],
  )).rows, "Constitution");

  const spaces = resourceSpaceId === null ? [] : (await connection.query<SpaceRow>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, guild_id, parent_space_id, name, status
         FROM spaces WHERE guild_id = $1 AND id = $2
       UNION ALL
       SELECT parent.id, parent.guild_id, parent.parent_space_id, parent.name, parent.status
         FROM spaces parent
         JOIN ancestors child
           ON child.guild_id = parent.guild_id AND child.parent_space_id = parent.id
     )
     SELECT id::text, guild_id::text, parent_space_id::text, name, status FROM ancestors`,
    [guildId, resourceSpaceId],
  )).rows;
  if (resourceSpaceId !== null && spaces.length === 0) {
    throw new Error("The requested Space was not found in the active Guild.");
  }

  const identityIds = [...new Set([...actorIdentityIds, guildRow.root_owner_identity_id])];
  const identities = (await connection.query<IdentityRow>(
    `SELECT id::text, guild_id::text, kind, display_name, status
       FROM identities WHERE guild_id = $1 AND id = ANY($2::uuid[])`,
    [guildId, identityIds],
  )).rows;
  const memberships = (await connection.query<MembershipRow>(
    `SELECT guild_id::text, identity_id::text, state, clearance,
            joined_at::text, departed_at::text
       FROM memberships WHERE guild_id = $1 AND identity_id = ANY($2::uuid[])`,
    [guildId, identityIds],
  )).rows;
  const spaceIds = spaces.map((space) => space.id);
  const bindings = (await connection.query<BindingRow>(
    `SELECT guild_id::text, identity_id::text, role_id::text, space_id::text
       FROM role_bindings
      WHERE guild_id = $1 AND identity_id = ANY($2::uuid[])
        AND (space_id IS NULL OR space_id = ANY($3::uuid[]))`,
    [guildId, actorIdentityIds, spaceIds],
  )).rows;
  const roleIds = bindings.map((binding) => binding.role_id);
  const roles = roleIds.length === 0 ? [] : (await connection.query<RoleRow>(
    `SELECT r.id::text, r.guild_id::text, r.name, r.system,
            COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.guild_id = r.guild_id AND rp.role_id = r.id
      WHERE r.guild_id = $1 AND r.id = ANY($2::uuid[])
      GROUP BY r.id`,
    [guildId, roleIds],
  )).rows;
  const agents = (await connection.query<AgentRow>(
    `SELECT guild_id::text, identity_id::text, instructions, model, tool_ids, limits, status
       FROM agent_profiles WHERE guild_id = $1 AND identity_id = ANY($2::uuid[])`,
    [guildId, actorIdentityIds],
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

export async function listAuthorizedSpaces(
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityId: string,
  permission: Permission,
): Promise<Space[]> {
  const result = await connection.query<SpaceRow>(
    `WITH RECURSIVE actor AS (
       SELECT i.id, m.state
         FROM identities i
         JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
        WHERE i.guild_id = $1 AND i.id = $2 AND i.status = 'active'
          AND m.state IN ('preboarding', 'active')
     ),
     grants AS (
       SELECT rb.space_id
         FROM role_bindings rb
         JOIN role_permissions rp ON rp.guild_id = rb.guild_id AND rp.role_id = rb.role_id
         JOIN actor ON actor.id = rb.identity_id
        WHERE rb.guild_id = $1 AND rb.identity_id = $2 AND rp.permission = $3
     ),
     permitted AS (
       SELECT s.id, s.guild_id
         FROM spaces s
         JOIN grants g ON g.space_id = s.id
        WHERE s.guild_id = $1 AND s.status = 'active'
       UNION
       SELECT child.id, child.guild_id
         FROM spaces child
         JOIN permitted parent
           ON child.guild_id = parent.guild_id AND child.parent_space_id = parent.id
        WHERE child.status = 'active'
     ),
     flags AS (
       SELECT
         EXISTS (SELECT 1 FROM actor) AS actor_valid,
         EXISTS (SELECT 1 FROM guilds WHERE id = $1 AND root_owner_identity_id = $2) AS is_root,
         EXISTS (SELECT 1 FROM grants WHERE space_id IS NULL) AS has_global_grant
     )
     SELECT DISTINCT s.id::text, s.guild_id::text, s.parent_space_id::text, s.name, s.status
       FROM spaces s CROSS JOIN flags
      WHERE s.guild_id = $1 AND s.status = 'active' AND flags.actor_valid
        AND (flags.is_root OR flags.has_global_grant OR EXISTS (
          SELECT 1 FROM permitted p WHERE p.guild_id = s.guild_id AND p.id = s.id
        ))
      ORDER BY 4, 1`,
    [guildId, actorIdentityId, permission],
  );
  return result.rows.map((row): Space => ({
    id: row.id,
    guildId: row.guild_id,
    parentSpaceId: row.parent_space_id,
    name: row.name,
    status: row.status,
  }));
}
