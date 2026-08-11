import {
  SUPPORTED_LOCALES,
  assertNonBlank,
  assertNonNegativeInteger,
  assertPositiveInteger,
  type AppLocale,
  type BreakGlassRecovery,
  type ChronicleEvent,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

const CODE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CODE_HINT_PATTERN = /^[A-Za-z0-9_-]{6}$/;
const BREAK_GLASS_CODE_COUNT = 10;
const MIN_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 730;
const GENERIC_RECOVERY_ERROR = "Recovery code is invalid or unavailable.";

export interface BreakGlassCodeHash {
  id: string;
  hash: string;
  hint: string;
}

export interface BreakGlassStatus {
  available: boolean;
  version: number;
  currentCodeSetId: string | null;
  generation: number | null;
  outgoingRoleId: string | null;
  outgoingRoleName: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  remainingCodeCount: number;
}

export interface RotateBreakGlassCodesInput {
  codeSetId: string;
  expectedVersion: number;
  outgoingRoleId: string;
  reason: string;
  expiresInDays: number;
  actorIdentityId: string;
  codes: readonly BreakGlassCodeHash[];
  chronicleEvent: ChronicleEvent;
}

export interface RevokeBreakGlassCodesInput {
  expectedVersion: number;
  reason: string;
  actorIdentityId: string;
  chronicleEvent: ChronicleEvent;
}

export interface RecoverRootOwnershipInput {
  recoveryId: string;
  codeHash: string;
  accountIdentityId: string;
  displayName: string;
  preferredLocale: AppLocale;
  reason: string;
  viewedInformation: string;
  changesMade: string;
  chronicleEvent: ChronicleEvent;
}

type BreakGlassStatusRow = QueryResultRow & {
  version: number;
  current_code_set_id: string | null;
  generation: number | null;
  outgoing_role_id: string | null;
  outgoing_role_name: string | null;
  reason: string | null;
  expires_at: string | null;
  created_at: string | null;
  remaining_code_count: string;
};

type RecoveryRow = QueryResultRow & {
  id: string;
  code_set_id: string;
  code_id: string;
  previous_root_identity_id: string;
  new_root_identity_id: string;
  outgoing_role_id: string;
  reason: string;
  actor_was_existing_identity: boolean;
  viewed_information: string;
  changes_made: string;
  state: BreakGlassRecovery["state"];
  completed_at: string | null;
  created_at: string;
};

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid Break Glass timestamp.");
  }
  return timestamp.toISOString();
}

function mapStatus(row: BreakGlassStatusRow | undefined): BreakGlassStatus {
  if (!row) {
    return {
      available: false,
      version: 0,
      currentCodeSetId: null,
      generation: null,
      outgoingRoleId: null,
      outgoingRoleName: null,
      reason: null,
      expiresAt: null,
      createdAt: null,
      remainingCodeCount: 0,
    };
  }
  const remainingCodeCount = Number(row.remaining_code_count);
  if (!Number.isSafeInteger(remainingCodeCount) || remainingCodeCount < 0) {
    throw new Error("Database contains an invalid Break Glass code count.");
  }
  const expiresAt = row.expires_at === null ? null : isoTimestamp(row.expires_at);
  return {
    available: row.current_code_set_id !== null && expiresAt !== null &&
      new Date(expiresAt).valueOf() > Date.now() && remainingCodeCount > 0,
    version: row.version,
    currentCodeSetId: row.current_code_set_id,
    generation: row.generation,
    outgoingRoleId: row.outgoing_role_id,
    outgoingRoleName: row.outgoing_role_name,
    reason: row.reason,
    expiresAt,
    createdAt: row.created_at === null ? null : isoTimestamp(row.created_at),
    remainingCodeCount,
  };
}

function mapRecovery(guildId: string, row: RecoveryRow): BreakGlassRecovery {
  return {
    id: row.id,
    guildId,
    codeSetId: row.code_set_id,
    codeId: row.code_id,
    previousRootIdentityId: row.previous_root_identity_id,
    newRootIdentityId: row.new_root_identity_id,
    outgoingRoleId: row.outgoing_role_id,
    reason: row.reason,
    actorWasExistingIdentity: row.actor_was_existing_identity,
    viewedInformation: row.viewed_information,
    changesMade: row.changes_made,
    state: row.state,
    completedAt: row.completed_at === null ? null : isoTimestamp(row.completed_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

export class GuildRecoveryRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async getBreakGlassStatus(): Promise<BreakGlassStatus> {
    const result = await this.#connection.query<BreakGlassStatusRow>(
      `SELECT configuration.version,
              configuration.current_code_set_id::text,
              code_set.generation,
              code_set.outgoing_role_id::text,
              outgoing_role.name AS outgoing_role_name,
              code_set.reason,
              code_set.expires_at::text,
              code_set.created_at::text,
              count(code.id) FILTER (WHERE code.consumed_at IS NULL)::text
                AS remaining_code_count
         FROM break_glass_configurations configuration
         LEFT JOIN break_glass_code_sets code_set
           ON code_set.guild_id = configuration.guild_id
          AND code_set.id = configuration.current_code_set_id
         LEFT JOIN roles outgoing_role
           ON outgoing_role.guild_id = code_set.guild_id
          AND outgoing_role.id = code_set.outgoing_role_id
         LEFT JOIN break_glass_codes code
           ON code.guild_id = code_set.guild_id AND code.code_set_id = code_set.id
        WHERE configuration.guild_id = $1
        GROUP BY configuration.version, configuration.current_code_set_id,
                 code_set.generation, code_set.outgoing_role_id, outgoing_role.name,
                 code_set.reason, code_set.expires_at, code_set.created_at`,
      [this.#guildId],
    );
    return mapStatus(result.rows[0]);
  }

  async rotateBreakGlassCodes(input: RotateBreakGlassCodesInput): Promise<BreakGlassStatus> {
    assertNonNegativeInteger(input.expectedVersion, "Expected Break Glass version");
    assertNonBlank(input.reason, "Break Glass rotation reason", 2_000);
    this.#assertCodes(input.codes);
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "break_glass.codes.rotated",
      "break_glass_code_set",
      input.codeSetId,
      input.reason,
    );
    assertPositiveInteger(input.expiresInDays, "Break Glass expiry");
    if (input.expiresInDays < MIN_EXPIRY_DAYS || input.expiresInDays > MAX_EXPIRY_DAYS) {
      throw new Error("Break Glass codes must expire between 7 and 730 days from now.");
    }
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.valueOf() + input.expiresInDays * 86_400_000,
    ).toISOString();
    const root = await this.#lockActiveHumanRoot();
    if (root !== input.actorIdentityId) {
      throw new Error("Only the active human Root Owner can rotate Break Glass codes.");
    }
    const configuration = (await this.#connection.query<{ version: number }>(
      `SELECT version FROM break_glass_configurations
        WHERE guild_id = $1 FOR UPDATE`,
      [this.#guildId],
    )).rows[0];
    const currentVersion = configuration?.version ?? 0;
    if (currentVersion !== input.expectedVersion) {
      throw new Error("Break Glass configuration changed since it was loaded. Reload before saving.");
    }
    const role = (await this.#connection.query<{ name: string }>(
      "SELECT name FROM roles WHERE guild_id = $1 AND id = $2",
      [this.#guildId, input.outgoingRoleId],
    )).rows[0];
    if (!role) throw new Error("Select a valid outgoing Role for the current Root Owner.");

    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    const generation = currentVersion + 1;
    await this.#connection.query(
      `INSERT INTO break_glass_code_sets
         (id, guild_id, generation, created_by_identity_id, outgoing_role_id,
          reason, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.codeSetId,
        this.#guildId,
        generation,
        input.actorIdentityId,
        input.outgoingRoleId,
        input.reason,
        expiresAt,
        createdAt.toISOString(),
      ],
    );
    for (const code of input.codes) {
      await this.#connection.query(
        `INSERT INTO break_glass_codes
           (id, guild_id, code_set_id, code_hash, code_hint)
         VALUES ($1, $2, $3, $4, $5)`,
        [code.id, this.#guildId, input.codeSetId, code.hash, code.hint],
      );
    }
    if (configuration) {
      const updated = await this.#connection.query(
        `UPDATE break_glass_configurations
            SET current_code_set_id = $2, version = $3, updated_by_identity_id = $4,
                updated_at = now()
          WHERE guild_id = $1 AND version = $5`,
        [
          this.#guildId,
          input.codeSetId,
          generation,
          input.actorIdentityId,
          input.expectedVersion,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("Break Glass configuration changed since it was loaded. Reload before saving.");
      }
    } else {
      await this.#connection.query(
        `INSERT INTO break_glass_configurations
           (guild_id, current_code_set_id, version, updated_by_identity_id)
         VALUES ($1, $2, 1, $3)`,
        [this.#guildId, input.codeSetId, input.actorIdentityId],
      );
    }
    await this.#chronicle.appendChronicle({
      ...input.chronicleEvent,
      details: {
        ...input.chronicleEvent.details,
        generation,
        outgoingRoleId: input.outgoingRoleId,
        outgoingRoleName: role.name,
        expiresAt,
        codeCount: input.codes.length,
      },
    });
    return this.getBreakGlassStatus();
  }

  async revokeBreakGlassCodes(input: RevokeBreakGlassCodesInput): Promise<BreakGlassStatus> {
    assertNonNegativeInteger(input.expectedVersion, "Expected Break Glass version");
    assertNonBlank(input.reason, "Break Glass revocation reason", 2_000);
    const root = await this.#lockActiveHumanRoot();
    if (root !== input.actorIdentityId) {
      throw new Error("Only the active human Root Owner can revoke Break Glass codes.");
    }
    const configuration = (await this.#connection.query<{
      version: number;
      current_code_set_id: string | null;
    }>(
      `SELECT version, current_code_set_id::text
         FROM break_glass_configurations
        WHERE guild_id = $1 FOR UPDATE`,
      [this.#guildId],
    )).rows[0];
    if (!configuration || configuration.version !== input.expectedVersion ||
        configuration.current_code_set_id === null) {
      throw new Error("Active Break Glass codes were not found or changed.");
    }
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "break_glass.codes.revoked",
      "break_glass_code_set",
      configuration.current_code_set_id,
      input.reason,
    );
    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.actorIdentityId,
    ]);
    const updated = await this.#connection.query(
      `UPDATE break_glass_configurations
          SET current_code_set_id = NULL, version = version + 1,
              updated_by_identity_id = $2, updated_at = now()
        WHERE guild_id = $1 AND version = $3 AND current_code_set_id = $4`,
      [
        this.#guildId,
        input.actorIdentityId,
        input.expectedVersion,
        configuration.current_code_set_id,
      ],
    );
    if (updated.rowCount !== 1) throw new Error("Active Break Glass codes changed before revocation.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return this.getBreakGlassStatus();
  }

  async recoverRootOwnership(input: RecoverRootOwnershipInput): Promise<BreakGlassRecovery> {
    if (!CODE_HASH_PATTERN.test(input.codeHash)) throw new Error(GENERIC_RECOVERY_ERROR);
    assertNonBlank(input.displayName, "Recovery display name");
    assertNonBlank(input.reason, "Break Glass recovery reason", 2_000);
    assertNonBlank(input.viewedInformation, "Break Glass viewed information", 2_000);
    assertNonBlank(input.changesMade, "Break Glass changes", 2_000);
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(input.preferredLocale)) {
      throw new Error("Unsupported locale.");
    }
    this.#assertEvent(
      input.chronicleEvent,
      input.accountIdentityId,
      "break_glass.used",
      "break_glass_recovery",
      input.recoveryId,
      input.reason,
    );
    if (input.chronicleEvent.details.viewedInformation !== input.viewedInformation ||
        input.chronicleEvent.details.changesMade !== input.changesMade) {
      throw new Error("Break Glass event is missing its disclosure and change record.");
    }

    const code = (await this.#connection.query<{
      code_id: string;
      code_set_id: string;
      outgoing_role_id: string;
      previous_root_identity_id: string;
      configuration_version: number;
    }>(
      `SELECT code.id::text AS code_id, code_set.id::text AS code_set_id,
              code_set.outgoing_role_id::text,
              guild_row.root_owner_identity_id::text AS previous_root_identity_id,
              configuration.version AS configuration_version
         FROM break_glass_configurations configuration
         JOIN guilds guild_row ON guild_row.id = configuration.guild_id
         JOIN break_glass_code_sets code_set
           ON code_set.guild_id = configuration.guild_id
          AND code_set.id = configuration.current_code_set_id
         JOIN break_glass_codes code
           ON code.guild_id = code_set.guild_id AND code.code_set_id = code_set.id
        WHERE configuration.guild_id = $1 AND code.code_hash = $2
          AND code.consumed_at IS NULL AND code_set.expires_at > now()
        FOR UPDATE OF configuration, guild_row, code`,
      [this.#guildId, input.codeHash],
    )).rows[0];
    if (!code || code.previous_root_identity_id === input.accountIdentityId) {
      throw new Error(GENERIC_RECOVERY_ERROR);
    }

    const accessSubject = `cloudflare-os-account:${input.accountIdentityId}`;
    const identities = await this.#connection.query<{
      id: string;
      kind: string;
      status: string;
    }>(
      `SELECT id::text, kind, status
         FROM identities
        WHERE guild_id = $1 AND (id = $2 OR access_subject = $3)
        FOR UPDATE`,
      [this.#guildId, input.accountIdentityId, accessSubject],
    );
    if (identities.rows.length > 1 ||
        identities.rows[0] !== undefined && identities.rows[0].id !== input.accountIdentityId) {
      throw new Error(GENERIC_RECOVERY_ERROR);
    }
    const existing = identities.rows[0];
    let actorWasExistingIdentity = existing !== undefined;
    if (existing) {
      const membership = (await this.#connection.query<{ state: string }>(
        `SELECT state FROM memberships
          WHERE guild_id = $1 AND identity_id = $2 FOR UPDATE`,
        [this.#guildId, input.accountIdentityId],
      )).rows[0];
      if (existing.kind !== "human" || existing.status !== "active" ||
          membership?.state !== "active") {
        throw new Error(GENERIC_RECOVERY_ERROR);
      }
    } else {
      actorWasExistingIdentity = false;
      await this.#connection.query(
        `INSERT INTO identities
           (id, guild_id, kind, display_name, status, access_subject, preferred_locale)
         VALUES ($1, $2, 'human', $3, 'active', $4, $5)`,
        [
          input.accountIdentityId,
          this.#guildId,
          input.displayName,
          accessSubject,
          input.preferredLocale,
        ],
      );
      await this.#connection.query(
        `INSERT INTO memberships
           (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'restricted', now())`,
        [this.#guildId, input.accountIdentityId],
      );
    }

    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      input.accountIdentityId,
    ]);
    await this.#connection.query("SELECT set_config('app.break_glass_recovery_id', $1, true)", [
      input.recoveryId,
    ]);
    await this.#connection.query(
      `INSERT INTO break_glass_recoveries
         (id, guild_id, code_set_id, code_id, previous_root_identity_id,
          new_root_identity_id, outgoing_role_id, reason,
          actor_was_existing_identity, viewed_information, changes_made)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.recoveryId,
        this.#guildId,
        code.code_set_id,
        code.code_id,
        code.previous_root_identity_id,
        input.accountIdentityId,
        code.outgoing_role_id,
        input.reason,
        actorWasExistingIdentity,
        input.viewedInformation,
        input.changesMade,
      ],
    );
    await this.#connection.query(
      "UPDATE guilds SET root_owner_identity_id = $2 WHERE id = $1",
      [this.#guildId, input.accountIdentityId],
    );
    await this.#connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       SELECT $1, $2, $3, $4, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM role_bindings
           WHERE guild_id = $2 AND identity_id = $3 AND role_id = $4 AND space_id IS NULL
        )`,
      [crypto.randomUUID(), this.#guildId, code.previous_root_identity_id, code.outgoing_role_id],
    );
    const superseded = await this.#connection.query<{ id: string }>(
      `UPDATE root_ownership_transfers
          SET state = 'superseded', version = version + 1, resolved_at = now()
        WHERE guild_id = $1 AND state = 'pending'
       RETURNING id::text`,
      [this.#guildId],
    );
    for (const transfer of superseded.rows) {
      await this.#chronicle.appendChronicle({
        ...input.chronicleEvent,
        id: crypto.randomUUID(),
        action: "root_ownership.transfer.superseded",
        subjectType: "root_ownership_transfer",
        subjectId: transfer.id,
        occurredAt: new Date().toISOString(),
        details: {
          reason: "Superseded by a completed Break Glass ownership recovery.",
          recoveryId: input.recoveryId,
          source: "guild-recovery",
        },
      });
    }
    const consumed = await this.#connection.query(
      `UPDATE break_glass_codes
          SET consumed_by_identity_id = $3, consumed_at = now()
        WHERE guild_id = $1 AND id = $2 AND consumed_at IS NULL`,
      [this.#guildId, code.code_id, input.accountIdentityId],
    );
    if (consumed.rowCount !== 1) throw new Error(GENERIC_RECOVERY_ERROR);
    const invalidated = await this.#connection.query(
      `UPDATE break_glass_configurations
          SET current_code_set_id = NULL, version = version + 1,
              updated_by_identity_id = $3, updated_at = now()
        WHERE guild_id = $1 AND version = $2 AND current_code_set_id = $4`,
      [
        this.#guildId,
        code.configuration_version,
        input.accountIdentityId,
        code.code_set_id,
      ],
    );
    if (invalidated.rowCount !== 1) throw new Error(GENERIC_RECOVERY_ERROR);
    const completed = (await this.#connection.query<RecoveryRow>(
      `UPDATE break_glass_recoveries
          SET state = 'completed', completed_at = now()
        WHERE guild_id = $1 AND id = $2 AND state = 'pending'
       RETURNING id::text, code_set_id::text, code_id::text,
                 previous_root_identity_id::text, new_root_identity_id::text,
                 outgoing_role_id::text, reason, actor_was_existing_identity,
                 viewed_information, changes_made, state,
                 completed_at::text, created_at::text`,
      [this.#guildId, input.recoveryId],
    )).rows[0];
    if (!completed) throw new Error("Break Glass recovery did not complete.");
    await this.#chronicle.appendChronicle({
      ...input.chronicleEvent,
      details: {
        ...input.chronicleEvent.details,
        previousRootIdentityId: code.previous_root_identity_id,
        newRootIdentityId: input.accountIdentityId,
        outgoingRoleId: code.outgoing_role_id,
        codeSetId: code.code_set_id,
        actorWasExistingIdentity: String(actorWasExistingIdentity),
        source: "guild-recovery",
      },
    });
    await this.#connection.query(
      `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body,
          resource_type, resource_id, owner_identity_id, visibility,
          classification, allowed_identity_ids, deduplication_key)
       VALUES ($1, $2, $3, 'system', 'Break Glass ownership recovery',
               'Root ownership changed through the emergency recovery procedure. Review the Chronicle immediately.',
               'break_glass_recovery', $4, $3, 'private', 'restricted',
               ARRAY[$3]::uuid[], $5)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        this.#guildId,
        code.previous_root_identity_id,
        input.recoveryId,
        `break-glass:${input.recoveryId}:previous-root`,
      ],
    );
    return mapRecovery(this.#guildId, completed);
  }

  async #lockActiveHumanRoot(): Promise<string> {
    const root = (await this.#connection.query<{
      root_owner_identity_id: string;
      kind: string;
      status: string;
      membership_state: string;
    }>(
      `SELECT guild_row.root_owner_identity_id::text,
              identity_row.kind, identity_row.status,
              membership_row.state AS membership_state
         FROM guilds guild_row
         JOIN identities identity_row
           ON identity_row.guild_id = guild_row.id
          AND identity_row.id = guild_row.root_owner_identity_id
         JOIN memberships membership_row
           ON membership_row.guild_id = identity_row.guild_id
          AND membership_row.identity_id = identity_row.id
        WHERE guild_row.id = $1
        FOR UPDATE OF guild_row`,
      [this.#guildId],
    )).rows[0];
    if (!root || root.kind !== "human" || root.status !== "active" ||
        root.membership_state !== "active") {
      throw new Error("Guild requires an active human Root Owner.");
    }
    return root.root_owner_identity_id;
  }

  #assertCodes(codes: readonly BreakGlassCodeHash[]): void {
    if (!Array.isArray(codes) || codes.length !== BREAK_GLASS_CODE_COUNT ||
        new Set(codes.map((code) => code.id)).size !== codes.length ||
        new Set(codes.map((code) => code.hash)).size !== codes.length) {
      throw new Error(`Generate exactly ${BREAK_GLASS_CODE_COUNT} unique Break Glass codes.`);
    }
    for (const code of codes) {
      if (!CODE_HASH_PATTERN.test(code.hash) || !CODE_HINT_PATTERN.test(code.hint)) {
        throw new Error("Break Glass code hashes or hints are malformed.");
      }
    }
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    action: string,
    subjectType: string,
    subjectId: string,
    reason: string,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.action !== action || event.subjectType !== subjectType ||
        event.subjectId !== subjectId || event.details.reason !== reason) {
      throw new Error("Break Glass event crosses the active Guild, actor, or subject boundary.");
    }
  }
}
