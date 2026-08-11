import {
  PERMISSIONS,
  assertIdentityStatusTransition,
  assertMembershipTransition,
  type AppLocale,
  type AgentLimits,
  type ChronicleEvent,
  type Classification,
  type IdentityKind,
  type IdentityStatus,
  type MembershipState,
  type Permission,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { loadActorAuthorizationSnapshot } from "./actor-authorization.js";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface DirectoryIdentity {
  id: string;
  kind: IdentityKind;
  displayName: string;
  status: IdentityStatus;
  preferredLocale: AppLocale;
  membershipState: MembershipState;
  clearance: Classification;
  joinedAt: string | null;
  departedAt: string | null;
}

export interface DirectoryRole {
  id: string;
  name: string;
  system: boolean;
  permissions: readonly Permission[];
}

export interface DirectoryRoleBinding {
  id: string;
  identityId: string;
  roleId: string;
  spaceId: string | null;
}

export interface DirectorySpace {
  id: string;
  parentSpaceId: string | null;
  name: string;
  status: "active" | "archived";
}

export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export interface GuildInvitation {
  id: string;
  inviteeLabel: string;
  roleId: string;
  spaceId: string | null;
  initialMembershipState: "preboarding" | "active";
  state: InvitationState;
  expiresAt: string;
  createdByIdentityId: string;
  acceptedByIdentityId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export interface GuildDirectory {
  identities: readonly DirectoryIdentity[];
  roles: readonly DirectoryRole[];
  roleBindings: readonly DirectoryRoleBinding[];
  agentProfiles: readonly DirectoryAgentProfile[];
  spaces: readonly DirectorySpace[];
  invitations: readonly GuildInvitation[];
  nextIdentityCursor: DirectoryIdentityCursor | null;
  nextInvitationCursor: DirectoryInvitationCursor | null;
}

export interface DirectoryAgentProfile {
  identityId: string;
  instructions: string;
  model: string;
  toolIds: readonly string[];
  limits: AgentLimits;
  status: "active" | "stopped";
}

export interface DirectoryIdentityCursor {
  displayName: string;
  id: string;
}

export interface DirectoryInvitationCursor {
  createdAt: string;
  id: string;
}

export interface DirectoryListOptions {
  identityCursor?: DirectoryIdentityCursor | null;
  invitationCursor?: DirectoryInvitationCursor | null;
  includeIdentities?: boolean;
  includeInvitations?: boolean;
}

export interface CreateInvitationInput {
  id: string;
  tokenHash: string;
  inviteeLabel: string;
  roleId: string;
  spaceId: string | null;
  initialMembershipState: "preboarding" | "active";
  expiresAt: string;
  createdByIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ClaimInvitationInput {
  tokenHash: string;
  identityId: string;
  displayName: string;
  preferredLocale: AppLocale;
  chronicleEvent: ChronicleEvent;
}

export interface ChangeMembershipInput {
  actorIdentityId: string;
  identityId: string;
  nextState: Exclude<MembershipState, "invited">;
  chronicleEvent: ChronicleEvent;
}

type IdentityRow = QueryResultRow & {
  id: string;
  kind: IdentityKind;
  display_name: string;
  status: IdentityStatus;
  preferred_locale: AppLocale;
  state: MembershipState;
  clearance: Classification;
  joined_at: string | null;
  departed_at: string | null;
};

type RoleRow = QueryResultRow & {
  id: string;
  name: string;
  system: boolean;
  permissions: string[];
};

type BindingRow = QueryResultRow & {
  id: string;
  identity_id: string;
  role_id: string;
  space_id: string | null;
};

type AgentProfileRow = QueryResultRow & {
  identity_id: string;
  instructions: string;
  model: string;
  tool_ids: string[];
  limits: AgentLimits;
  status: "active" | "stopped";
};

type SpaceRow = QueryResultRow & {
  id: string;
  parent_space_id: string | null;
  name: string;
  status: "active" | "archived";
};

type InvitationRow = QueryResultRow & {
  id: string;
  invitee_label: string;
  role_id: string;
  space_id: string | null;
  initial_membership_state: "preboarding" | "active";
  state: InvitationState;
  expires_at: string;
  created_by_identity_id: string;
  accepted_by_identity_id: string | null;
  accepted_at: string | null;
  created_at: string;
};

type ClaimRow = QueryResultRow & {
  id: string;
  role_id: string;
  space_id: string | null;
  initial_membership_state: "preboarding" | "active";
  expires_at: string;
};

const KNOWN_PERMISSION = new Set<string>(PERMISSIONS);
const IDENTITY_PAGE_SIZE = 50;
const INVITATION_PAGE_SIZE = 25;

function parsePermissions(values: readonly string[]): Permission[] {
  if (!values.every((value) => KNOWN_PERMISSION.has(value))) {
    throw new Error("Database contains an unknown Guild permission.");
  }
  return values as Permission[];
}

function invitationFromRow(row: InvitationRow): GuildInvitation {
  return {
    id: row.id,
    inviteeLabel: row.invitee_label,
    roleId: row.role_id,
    spaceId: row.space_id,
    initialMembershipState: row.initial_membership_state,
    state: row.state,
    expiresAt: row.expires_at,
    createdByIdentityId: row.created_by_identity_id,
    acceptedByIdentityId: row.accepted_by_identity_id,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}

export class GuildDirectoryRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async listDirectory(options: DirectoryListOptions = {}): Promise<GuildDirectory> {
    let identityRows: IdentityRow[] = [];
    let nextIdentityCursor: DirectoryIdentityCursor | null = null;
    if (options.includeIdentities !== false) {
      const identityResult = await this.#connection.query<IdentityRow>(
        `SELECT i.id::text, i.kind, i.display_name, i.status, i.preferred_locale,
                m.state, m.clearance, m.joined_at::text, m.departed_at::text
           FROM identities i
           JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
          WHERE i.guild_id = $1
            AND ($2::text IS NULL OR (i.display_name, i.id) > ($2::text, $3::uuid))
          ORDER BY i.display_name, i.id
          LIMIT $4`,
        [
          this.#guildId,
          options.identityCursor?.displayName ?? null,
          options.identityCursor?.id ?? null,
          IDENTITY_PAGE_SIZE + 1,
        ],
      );
      const hasMoreIdentities = identityResult.rows.length > IDENTITY_PAGE_SIZE;
      identityRows = identityResult.rows.slice(0, IDENTITY_PAGE_SIZE);
      const lastIdentity = identityRows.at(-1);
      if (hasMoreIdentities && lastIdentity) {
        nextIdentityCursor = { displayName: lastIdentity.display_name, id: lastIdentity.id };
      }
    }

    const roleResult = await this.#connection.query<RoleRow>(
      `SELECT r.id::text, r.name, r.system,
              COALESCE(array_agg(rp.permission ORDER BY rp.permission)
                FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.guild_id = r.guild_id AND rp.role_id = r.id
        WHERE r.guild_id = $1
        GROUP BY r.id
        ORDER BY r.system DESC, r.name, r.id`,
      [this.#guildId],
    );
    const identityIds = identityRows.map((row) => row.id);
    const bindingRows = identityIds.length === 0 ? [] : (await this.#connection.query<BindingRow>(
      `SELECT id::text, identity_id::text, role_id::text, space_id::text
         FROM role_bindings
        WHERE guild_id = $1 AND identity_id = ANY($2::uuid[])
        ORDER BY created_at, id`,
      [this.#guildId, identityIds],
    )).rows;
    const agentProfileRows = identityIds.length === 0
      ? []
      : (await this.#connection.query<AgentProfileRow>(
        `SELECT identity_id::text, instructions, model, tool_ids, limits, status
           FROM agent_profiles
          WHERE guild_id = $1 AND identity_id = ANY($2::uuid[])
          ORDER BY identity_id`,
        [this.#guildId, identityIds],
      )).rows;
    const spaceResult = await this.#connection.query<SpaceRow>(
      `SELECT id::text, parent_space_id::text, name, status
         FROM spaces WHERE guild_id = $1 ORDER BY name, id`,
      [this.#guildId],
    );

    let invitationRows: InvitationRow[] = [];
    let nextInvitationCursor: DirectoryInvitationCursor | null = null;
    if (options.includeInvitations === true) {
      const invitationResult = await this.#connection.query<InvitationRow>(
        `SELECT id::text, invitee_label, role_id::text, space_id::text,
                initial_membership_state,
                CASE WHEN state = 'pending' AND expires_at <= now() THEN 'expired' ELSE state END AS state,
                expires_at::text, created_by_identity_id::text, accepted_by_identity_id::text,
                accepted_at::text, created_at::text
           FROM guild_invitations
          WHERE guild_id = $1
            AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT $4`,
        [
          this.#guildId,
          options.invitationCursor?.createdAt ?? null,
          options.invitationCursor?.id ?? null,
          INVITATION_PAGE_SIZE + 1,
        ],
      );
      const hasMoreInvitations = invitationResult.rows.length > INVITATION_PAGE_SIZE;
      invitationRows = invitationResult.rows.slice(0, INVITATION_PAGE_SIZE);
      const lastInvitation = invitationRows.at(-1);
      if (hasMoreInvitations && lastInvitation) {
        nextInvitationCursor = { createdAt: lastInvitation.created_at, id: lastInvitation.id };
      }
    }

    return {
      identities: identityRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        displayName: row.display_name,
        status: row.status,
        preferredLocale: row.preferred_locale,
        membershipState: row.state,
        clearance: row.clearance,
        joinedAt: row.joined_at,
        departedAt: row.departed_at,
      })),
      roles: roleResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        system: row.system,
        permissions: parsePermissions(row.permissions),
      })),
      roleBindings: bindingRows.map((row) => ({
        id: row.id,
        identityId: row.identity_id,
        roleId: row.role_id,
        spaceId: row.space_id,
      })),
      agentProfiles: agentProfileRows.map((row) => ({
        identityId: row.identity_id,
        instructions: row.instructions,
        model: row.model,
        toolIds: row.tool_ids,
        limits: row.limits,
        status: row.status,
      })),
      spaces: spaceResult.rows.map((row) => ({
        id: row.id,
        parentSpaceId: row.parent_space_id,
        name: row.name,
        status: row.status,
      })),
      invitations: invitationRows.map(invitationFromRow),
      nextIdentityCursor,
      nextInvitationCursor,
    };
  }

  async createInvitation(input: CreateInvitationInput): Promise<GuildInvitation> {
    this.#assertEvent(input.chronicleEvent, input.createdByIdentityId);
    const result = await this.#connection.query<InvitationRow>(
      `INSERT INTO guild_invitations
         (id, guild_id, token_hash, invitee_label, role_id, space_id,
          initial_membership_state, state, expires_at, created_by_identity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
       RETURNING id::text, invitee_label, role_id::text, space_id::text,
                 initial_membership_state, state, expires_at::text,
                 created_by_identity_id::text, accepted_by_identity_id::text,
                 accepted_at::text, created_at::text`,
      [
        input.id,
        this.#guildId,
        input.tokenHash,
        input.inviteeLabel,
        input.roleId,
        input.spaceId,
        input.initialMembershipState,
        input.expiresAt,
        input.createdByIdentityId,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    const row = result.rows[0];
    if (!row) throw new Error("Invitation creation did not return a record.");
    return invitationFromRow(row);
  }

  async claimInvitation(input: ClaimInvitationInput): Promise<GuildInvitation> {
    this.#assertEvent(input.chronicleEvent, input.identityId);
    const invitation = (await this.#connection.query<ClaimRow>(
      `SELECT id::text, role_id::text, space_id::text, initial_membership_state, expires_at::text
         FROM guild_invitations
        WHERE guild_id = $1 AND token_hash = $2 AND state = 'pending'
        FOR UPDATE`,
      [this.#guildId, input.tokenHash],
    )).rows[0];
    if (!invitation || Date.parse(invitation.expires_at) <= Date.now()) {
      throw new Error("Invitation is invalid, expired, or already used.");
    }

    const existing = (await this.#connection.query<QueryResultRow & { state: MembershipState }>(
      `SELECT m.state
         FROM identities i
         JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
        WHERE i.guild_id = $1 AND i.id = $2
        FOR UPDATE`,
      [this.#guildId, input.identityId],
    )).rows[0];
    if (existing && existing.state !== "preboarding") {
      throw new Error("This account already has a non-preboarding Guild membership.");
    }

    if (!existing) {
      await this.#connection.query(
        `INSERT INTO identities
           (id, guild_id, kind, display_name, status, access_subject, preferred_locale)
         VALUES ($1::uuid, $2, 'human', $3, 'active',
                 'cloudflare-os-account:' || $1::uuid::text, $4)`,
        [input.identityId, this.#guildId, input.displayName, input.preferredLocale],
      );
      await this.#connection.query(
        `INSERT INTO memberships
           (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, $3, 'internal', CASE WHEN $3 = 'active' THEN now() ELSE NULL END)`,
        [this.#guildId, input.identityId, invitation.initial_membership_state],
      );
    } else {
      await this.#connection.query(
        `UPDATE identities
            SET display_name = $3, preferred_locale = $4, status = 'active'
          WHERE guild_id = $1 AND id = $2`,
        [this.#guildId, input.identityId, input.displayName, input.preferredLocale],
      );
      if (invitation.initial_membership_state === "active") {
        await this.#connection.query(
          `UPDATE memberships SET state = 'active', joined_at = COALESCE(joined_at, now())
            WHERE guild_id = $1 AND identity_id = $2`,
          [this.#guildId, input.identityId],
        );
      }
    }

    await this.#connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUuid(), this.#guildId, input.identityId, invitation.role_id, invitation.space_id],
    );
    const accepted = await this.#connection.query<InvitationRow>(
      `UPDATE guild_invitations
          SET state = 'accepted', accepted_by_identity_id = $3, accepted_at = now()
        WHERE guild_id = $1 AND id = $2
       RETURNING id::text, invitee_label, role_id::text, space_id::text,
                 initial_membership_state, state, expires_at::text,
                 created_by_identity_id::text, accepted_by_identity_id::text,
                 accepted_at::text, created_at::text`,
      [this.#guildId, invitation.id, input.identityId],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    const row = accepted.rows[0];
    if (!row) throw new Error("Invitation acceptance did not return a record.");
    return invitationFromRow(row);
  }

  async revokeInvitation(
    invitationId: string,
    actorIdentityId: string,
    chronicleEvent: ChronicleEvent,
  ): Promise<void> {
    this.#assertEvent(chronicleEvent, actorIdentityId);
    const result = await this.#connection.query(
      `UPDATE guild_invitations SET state = 'revoked', revoked_at = now()
        WHERE guild_id = $1 AND id = $2 AND state = 'pending'`,
      [this.#guildId, invitationId],
    );
    if (result.rowCount !== 1) throw new Error("Pending invitation was not found.");
    await this.#chronicle.appendChronicle(chronicleEvent);
  }

  async changeMembership(input: ChangeMembershipInput): Promise<void> {
    this.#assertEvent(input.chronicleEvent, input.actorIdentityId);
    const snapshot = await loadActorAuthorizationSnapshot(
      this.#connection,
      this.#guildId,
      input.identityId,
    );
    assertMembershipTransition(snapshot, input.identityId, input.nextState);
    const nextStatus: IdentityStatus = ["suspended", "departed"].includes(input.nextState)
      ? "disabled"
      : "active";
    assertIdentityStatusTransition(snapshot, input.identityId, nextStatus);

    await this.#connection.query(
      `UPDATE memberships
          SET state = $3,
              joined_at = CASE WHEN $3 = 'active' THEN COALESCE(joined_at, now()) ELSE joined_at END,
              departed_at = CASE WHEN $3 = 'departed' THEN now() ELSE NULL END
        WHERE guild_id = $1 AND identity_id = $2`,
      [this.#guildId, input.identityId, input.nextState],
    );
    await this.#connection.query(
      "UPDATE identities SET status = $3 WHERE guild_id = $1 AND id = $2",
      [this.#guildId, input.identityId, nextStatus],
    );
    if (nextStatus === "disabled") {
      await this.#connection.query(
        `UPDATE connectors
            SET status = 'revoked', secret_reference = NULL
          WHERE guild_id = $1 AND owner_identity_id = $2 AND status <> 'revoked'`,
        [this.#guildId, input.identityId],
      );
      await this.#connection.query(
        `UPDATE agent_profiles SET status = 'stopped'
          WHERE guild_id = $1 AND identity_id = $2`,
        [this.#guildId, input.identityId],
      );
      await this.#connection.query(
        `UPDATE agent_runs
            SET status = 'killed', kill_requested_at = now(), finished_at = now()
          WHERE guild_id = $1 AND (agent_identity_id = $2 OR requester_identity_id = $2)
            AND status IN ('planning', 'awaiting_approval', 'running')`,
        [this.#guildId, input.identityId],
      );
    } else {
      await this.#connection.query(
        `UPDATE agent_profiles SET status = 'active'
          WHERE guild_id = $1 AND identity_id = $2`,
        [this.#guildId, input.identityId],
      );
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
  }

  #assertEvent(event: ChronicleEvent, actorIdentityId: string): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId) {
      throw new Error("Directory event crosses the active Guild or actor boundary.");
    }
  }
}

function randomUuid(): string {
  return crypto.randomUUID();
}
