import {
  assertNonBlank,
  validateConstitution,
  type AgentLimits,
  type ChronicleEvent,
  type Constitution,
  type RootOwnershipTransfer,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface UpdateConstitutionInput {
  expectedVersion: number;
  level2ApprovalQuorum: number;
  level3ApprovalQuorum: number;
  dataRetentionDays: number;
  agentDefaults: AgentLimits;
  reason: string;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ProposeRootOwnershipTransferInput {
  id: string;
  toIdentityId: string;
  outgoingRoleId: string;
  reason: string;
  expiresAt: string;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface ResolveRootOwnershipTransferInput {
  transferId: string;
  expectedVersion: number;
  reason: string;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

type ConstitutionRow = QueryResultRow & {
  version: number;
  level2_approval_quorum: number;
  level3_approval_quorum: number;
  data_retention_days: number;
  agent_defaults: AgentLimits;
  updated_by_identity_id: string;
  updated_at: string;
};

type RootOwnershipTransferRow = QueryResultRow & {
  id: string;
  from_identity_id: string;
  to_identity_id: string;
  outgoing_role_id: string;
  state: RootOwnershipTransfer["state"];
  reason: string;
  version: number;
  expires_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid governance timestamp.");
  }
  return timestamp.toISOString();
}

function mapRootOwnershipTransfer(
  guildId: string,
  row: RootOwnershipTransferRow,
): RootOwnershipTransfer {
  return {
    id: row.id,
    guildId,
    fromIdentityId: row.from_identity_id,
    toIdentityId: row.to_identity_id,
    outgoingRoleId: row.outgoing_role_id,
    state: row.state,
    reason: row.reason,
    version: row.version,
    expiresAt: isoTimestamp(row.expires_at),
    resolvedAt: row.resolved_at === null ? null : isoTimestamp(row.resolved_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function mapConstitution(guildId: string, row: ConstitutionRow): Constitution {
  return {
    guildId,
    version: row.version,
    level2ApprovalQuorum: row.level2_approval_quorum,
    level3ApprovalQuorum: row.level3_approval_quorum,
    dataRetentionDays: row.data_retention_days,
    agentDefaults: row.agent_defaults,
    updatedByIdentityId: row.updated_by_identity_id,
    updatedAt: row.updated_at,
  };
}

export class GuildGovernanceRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async updateConstitution(input: UpdateConstitutionInput): Promise<Constitution> {
    assertNonBlank(input.reason, "Constitution change reason", 2_000);
    if (input.chronicleEvent.guildId !== this.#guildId ||
        input.chronicleEvent.actorIdentityId !== input.actorIdentityId ||
        input.chronicleEvent.action !== "constitution.updated" ||
        input.chronicleEvent.subjectType !== "constitution" ||
        input.chronicleEvent.subjectId !== this.#guildId ||
        input.chronicleEvent.details.reason !== input.reason) {
      throw new Error("Constitution event crosses the active Guild or actor boundary.");
    }
    const current = (await this.#connection.query<ConstitutionRow & {
      root_owner_identity_id: string;
      root_kind: string;
      root_status: string;
      root_membership_state: string;
    }>(
      `SELECT c.version, c.level2_approval_quorum, c.level3_approval_quorum,
              c.data_retention_days, c.agent_defaults,
              c.updated_by_identity_id::text, c.updated_at::text,
              g.root_owner_identity_id::text, i.kind AS root_kind,
              i.status AS root_status, m.state AS root_membership_state
         FROM constitutions c
         JOIN guilds g ON g.id = c.guild_id
         JOIN identities i ON i.guild_id = g.id AND i.id = g.root_owner_identity_id
         JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
        WHERE c.guild_id = $1
        FOR UPDATE OF c`,
      [this.#guildId],
    )).rows[0];
    if (!current) throw new Error("Guild Constitution was not found.");
    if (current.root_owner_identity_id !== input.actorIdentityId ||
        current.root_kind !== "human" || current.root_status !== "active" ||
        current.root_membership_state !== "active") {
      throw new Error("Only the active human Root Owner can update the Constitution.");
    }
    if (current.version !== input.expectedVersion) {
      throw new Error("Constitution changed since it was loaded. Reload before saving.");
    }

    const candidate: Constitution = {
      guildId: this.#guildId,
      version: current.version + 1,
      level2ApprovalQuorum: input.level2ApprovalQuorum,
      level3ApprovalQuorum: input.level3ApprovalQuorum,
      dataRetentionDays: input.dataRetentionDays,
      agentDefaults: input.agentDefaults,
      updatedByIdentityId: input.actorIdentityId,
      updatedAt: new Date().toISOString(),
    };
    validateConstitution(candidate);
    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    const result = await this.#connection.query<ConstitutionRow>(
      `UPDATE constitutions
          SET version = $3,
              level2_approval_quorum = $4,
              level3_approval_quorum = $5,
              data_retention_days = $6,
              agent_defaults = $7::jsonb,
              updated_by_identity_id = $2
        WHERE guild_id = $1 AND version = $8
      RETURNING version, level2_approval_quorum, level3_approval_quorum,
                data_retention_days, agent_defaults,
                updated_by_identity_id::text, updated_at::text`,
      [
        this.#guildId,
        input.actorIdentityId,
        candidate.version,
        candidate.level2ApprovalQuorum,
        candidate.level3ApprovalQuorum,
        candidate.dataRetentionDays,
        JSON.stringify(candidate.agentDefaults),
        input.expectedVersion,
      ],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("Constitution changed since it was loaded. Reload before saving.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return mapConstitution(this.#guildId, updated);
  }

  async proposeRootOwnershipTransfer(
    input: ProposeRootOwnershipTransferInput,
  ): Promise<RootOwnershipTransfer> {
    assertNonBlank(input.reason, "Root ownership transfer reason", 2_000);
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "root_ownership.transfer.proposed",
      input.id,
      input.reason,
    );
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) {
      throw new Error("Root ownership transfer expiry must be in the future.");
    }
    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    const root = (await this.#connection.query<{
      root_owner_identity_id: string;
      root_kind: string;
      root_status: string;
      membership_state: string;
    }>(
      `SELECT g.root_owner_identity_id::text, root.kind AS root_kind,
              root.status AS root_status, membership.state AS membership_state
         FROM guilds g
         JOIN identities root
           ON root.guild_id = g.id AND root.id = g.root_owner_identity_id
         JOIN memberships membership
           ON membership.guild_id = root.guild_id AND membership.identity_id = root.id
        WHERE g.id = $1
        FOR UPDATE OF g`,
      [this.#guildId],
    )).rows[0];
    if (!root || root.root_owner_identity_id !== input.actorIdentityId ||
        root.root_kind !== "human" || root.root_status !== "active" ||
        root.membership_state !== "active") {
      throw new Error("Only the active human Root Owner can propose an ownership transfer.");
    }

    const expired = await this.#connection.query<{
      id: string;
      expires_at: string;
    }>(
      `UPDATE root_ownership_transfers
          SET state = 'expired', version = version + 1, resolved_at = now()
        WHERE guild_id = $1 AND state = 'pending' AND expires_at <= now()
      RETURNING id::text, expires_at::text`,
      [this.#guildId],
    );
    for (const stale of expired.rows) {
      await this.#chronicle.appendChronicle({
        ...input.chronicleEvent,
        id: crypto.randomUUID(),
        action: "root_ownership.transfer.expired",
        subjectType: "root_ownership_transfer",
        subjectId: stale.id,
        occurredAt: new Date().toISOString(),
        details: {
          reason: "The proposal expired before a replacement was created.",
          expiresAt: isoTimestamp(stale.expires_at),
          source: "guild-governance",
        },
      });
    }
    const target = (await this.#connection.query<{
      display_name: string;
      role_name: string;
    }>(
      `SELECT target.display_name, outgoing_role.name AS role_name
         FROM identities target
         JOIN memberships target_membership
           ON target_membership.guild_id = target.guild_id
          AND target_membership.identity_id = target.id
         JOIN roles outgoing_role ON outgoing_role.guild_id = target.guild_id
        WHERE target.guild_id = $1 AND target.id = $2
          AND target.kind = 'human' AND target.status = 'active'
          AND target_membership.state = 'active' AND outgoing_role.id = $3`,
      [this.#guildId, input.toIdentityId, input.outgoingRoleId],
    )).rows[0];
    if (!target) {
      throw new Error("Select an active human target and a valid outgoing Role.");
    }

    const inserted = (await this.#connection.query<RootOwnershipTransferRow>(
      `INSERT INTO root_ownership_transfers
         (id, guild_id, from_identity_id, to_identity_id, outgoing_role_id,
          reason, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text, from_identity_id::text, to_identity_id::text,
                 outgoing_role_id::text, state, reason, version,
                 expires_at::text, resolved_at::text, created_at::text, updated_at::text`,
      [
        input.id,
        this.#guildId,
        input.actorIdentityId,
        input.toIdentityId,
        input.outgoingRoleId,
        input.reason,
        input.expiresAt,
      ],
    )).rows[0];
    if (!inserted) throw new Error("Root ownership transfer was not created.");
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body,
          resource_type, resource_id, owner_identity_id, visibility,
          classification, allowed_identity_ids, deduplication_key)
       VALUES ($1, $2, $3, 'system', 'Root ownership transfer',
               'Review and explicitly accept the pending Root ownership transfer if you agree.',
               'root_ownership_transfer', $4, $3, 'private', 'restricted',
               ARRAY[$3]::uuid[], $5)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        input.toIdentityId,
        input.id,
        `root-ownership-transfer:${input.id}:proposed`,
      ],
    );
    await this.#chronicle.appendChronicle({
      ...input.chronicleEvent,
      details: {
        ...input.chronicleEvent.details,
        toDisplayName: target.display_name,
        outgoingRoleName: target.role_name,
      },
    });
    return mapRootOwnershipTransfer(this.#guildId, inserted);
  }

  async cancelRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferInput,
  ): Promise<RootOwnershipTransfer> {
    assertNonBlank(input.reason, "Root ownership transfer cancellation reason", 2_000);
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "root_ownership.transfer.cancelled",
      input.transferId,
      input.reason,
    );
    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    const updated = (await this.#connection.query<RootOwnershipTransferRow>(
      `UPDATE root_ownership_transfers transfer
          SET state = 'cancelled', version = transfer.version + 1, resolved_at = now()
         FROM guilds guild_row
        WHERE transfer.guild_id = $1 AND transfer.id = $2
          AND transfer.version = $3 AND transfer.state = 'pending'
          AND guild_row.id = transfer.guild_id
          AND guild_row.root_owner_identity_id = $4
          AND transfer.from_identity_id = $4
       RETURNING transfer.id::text, transfer.from_identity_id::text,
                 transfer.to_identity_id::text, transfer.outgoing_role_id::text,
                 transfer.state, transfer.reason, transfer.version,
                 transfer.expires_at::text, transfer.resolved_at::text,
                 transfer.created_at::text, transfer.updated_at::text`,
      [this.#guildId, input.transferId, input.expectedVersion, input.actorIdentityId],
    )).rows[0];
    if (!updated) {
      throw new Error("Pending Root ownership transfer was not found or changed.");
    }
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return mapRootOwnershipTransfer(this.#guildId, updated);
  }

  async acceptRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferInput,
  ): Promise<RootOwnershipTransfer> {
    assertNonBlank(input.reason, "Root ownership acceptance reason", 2_000);
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "root_ownership.transfer.accepted",
      input.transferId,
      input.reason,
    );
    const transfer = (await this.#connection.query<RootOwnershipTransferRow & {
      current_root_identity_id: string;
      target_display_name: string;
      target_kind: string;
      target_status: string;
      target_membership_state: string;
    }>(
      `SELECT transfer.id::text, transfer.from_identity_id::text,
              transfer.to_identity_id::text, transfer.outgoing_role_id::text,
              transfer.state, transfer.reason, transfer.version,
              transfer.expires_at::text, transfer.resolved_at::text,
              transfer.created_at::text, transfer.updated_at::text,
              guild_row.root_owner_identity_id::text AS current_root_identity_id,
              target.display_name AS target_display_name,
              target.kind AS target_kind, target.status AS target_status,
              membership.state AS target_membership_state
         FROM root_ownership_transfers transfer
         JOIN guilds guild_row ON guild_row.id = transfer.guild_id
         JOIN identities target
           ON target.guild_id = transfer.guild_id AND target.id = transfer.to_identity_id
         JOIN memberships membership
           ON membership.guild_id = target.guild_id AND membership.identity_id = target.id
        WHERE transfer.guild_id = $1 AND transfer.id = $2
        FOR UPDATE OF transfer, guild_row`,
      [this.#guildId, input.transferId],
    )).rows[0];
    if (!transfer || transfer.version !== input.expectedVersion || transfer.state !== "pending" ||
        new Date(transfer.expires_at).valueOf() <= Date.now()) {
      throw new Error("Pending Root ownership transfer was not found, changed, or expired.");
    }
    if (transfer.to_identity_id !== input.actorIdentityId ||
        transfer.current_root_identity_id !== transfer.from_identity_id ||
        transfer.target_kind !== "human" || transfer.target_status !== "active" ||
        transfer.target_membership_state !== "active") {
      throw new Error("Only the designated active Human can accept Root ownership.");
    }

    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    await this.#connection.query("SELECT set_config('app.root_transfer_id', $1, true)", [
      input.transferId,
    ]);
    await this.#connection.query(
      "UPDATE guilds SET root_owner_identity_id = $2 WHERE id = $1",
      [this.#guildId, input.actorIdentityId],
    );
    await this.#connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       SELECT $1, $2, $3, $4, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM role_bindings
           WHERE guild_id = $2 AND identity_id = $3 AND role_id = $4 AND space_id IS NULL
        )`,
      [crypto.randomUUID(), this.#guildId, transfer.from_identity_id, transfer.outgoing_role_id],
    );
    const accepted = (await this.#connection.query<RootOwnershipTransferRow>(
      `UPDATE root_ownership_transfers
          SET state = 'accepted', version = version + 1, resolved_at = now()
        WHERE guild_id = $1 AND id = $2 AND version = $3 AND state = 'pending'
       RETURNING id::text, from_identity_id::text, to_identity_id::text,
                 outgoing_role_id::text, state, reason, version,
                 expires_at::text, resolved_at::text, created_at::text, updated_at::text`,
      [this.#guildId, input.transferId, input.expectedVersion],
    )).rows[0];
    if (!accepted) throw new Error("Root ownership transfer changed before acceptance.");
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body,
          resource_type, resource_id, owner_identity_id, visibility,
          classification, allowed_identity_ids, deduplication_key)
       VALUES ($1, $2, $3, 'system', 'Root ownership transferred',
               'The designated Human accepted Root ownership. Your outgoing Role is now active.',
               'root_ownership_transfer', $4, $3, 'private', 'restricted',
               ARRAY[$3]::uuid[], $5)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        transfer.from_identity_id,
        input.transferId,
        `root-ownership-transfer:${input.transferId}:accepted`,
      ],
    );
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return mapRootOwnershipTransfer(this.#guildId, accepted);
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    action: string,
    subjectId: string,
    reason: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.action !== action || event.subjectType !== "root_ownership_transfer" ||
        event.subjectId !== subjectId || event.details.reason !== reason) {
      throw new Error("Root ownership event crosses the active Guild, actor, or transfer boundary.");
    }
  }
}
