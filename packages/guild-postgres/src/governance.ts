import {
  assertNonBlank,
  validateConstitution,
  type AgentLimits,
  type ChronicleEvent,
  type Constitution,
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

type ConstitutionRow = QueryResultRow & {
  version: number;
  level2_approval_quorum: number;
  level3_approval_quorum: number;
  data_retention_days: number;
  agent_defaults: AgentLimits;
  updated_by_identity_id: string;
  updated_at: string;
};

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
}
