import {
  assertNonBlank,
  authorize,
  type HandoverCase,
  type HandoverItem,
} from "@guild-os/domain";
import {
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
  type HandoverDetail,
  type QueryResultRow,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";
import {
  PostgresLifecycleRuntimeRepository,
  type LifecycleDatabase,
  type LifecycleQueryResult,
  type LifecycleSqlConnection,
} from "./lifecycle-adapter.js";
import {
  GuildLifecycleRuntime,
  type LifecycleChronicleInput,
  type LifecycleRequirementResult,
  type OffboardingReceipt,
} from "./lifecycle-runtime.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIFECYCLE_SERVICE_SOURCE = "guild-lifecycle-service";
const RECONFIRMATION_AUDIENCE_MARKER = "lifecycle-adapter:reconfirmation-audience";
const CANCEL_WORKFLOW_REQUESTS_MARKER = "lifecycle-adapter:cancel-workflow-requests";

interface LifecycleServiceInput {
  env: GuildEnv;
  requesterActorId: string;
  reason: string;
}

export interface SynchronizeLifecycleOnboardingInput extends LifecycleServiceInput {
  targetActorId: string;
}

export interface ReconcilePublishedCanonicalMemoryInput extends LifecycleServiceInput {
  memoryId: string;
}

export interface OffboardLifecycleActorInput extends LifecycleServiceInput {
  targetActorId: string;
  successorActorId: string | null;
}

export interface LifecycleOffboardingResult {
  receipt: OffboardingReceipt;
  handover: HandoverDetail;
}

type HandoverRow = QueryResultRow & {
  id: string;
  guild_id: string;
  departing_actor_id: string;
  successor_actor_id: string | null;
  initiated_by_actor_id: string;
  reason: string;
  status: HandoverCase["status"];
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type HandoverItemRow = QueryResultRow & {
  id: string;
  guild_id: string;
  case_id: string;
  resource_type: HandoverItem["resourceType"];
  resource_id: string;
  title: string;
  disposition: HandoverItem["disposition"];
  status: HandoverItem["status"];
  note: string;
  completed_at: string | null;
  created_at: string;
};

class CurrentSchemaLifecycleDatabase implements LifecycleDatabase {
  readonly #connectionString: string;

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  transaction<T>(
    guildId: string,
    operation: (connection: LifecycleSqlConnection) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(this.#connectionString, guildId, (connection) => operation({
      query: <Row extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<LifecycleQueryResult<Row>> => this.#query(connection, text, values),
    }));
  }

  async #query<Row extends QueryResultRow>(
    connection: GuildTransactionConnection,
    text: string,
    values?: readonly unknown[],
  ): Promise<LifecycleQueryResult<Row>> {
    if (text.includes(CANCEL_WORKFLOW_REQUESTS_MARKER)) {
      // The schema requires queued requests to enter planning before cancellation.
      await connection.query(
        `/* lifecycle-service:stage-workflow-cancellation */
         UPDATE workflow_run_requests
            SET status = 'planning', lease_token = gen_random_uuid(),
                lease_owner = 'guild-lifecycle-offboarding',
                lease_expires_at = now() + interval '1 minute', updated_at = now()
          WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'queued'`,
        values,
      );
    }
    const compatibleText = text.includes(RECONFIRMATION_AUDIENCE_MARKER)
      ? text.replace("ORDER BY actor.id LIMIT $4", "ORDER BY actor.id::text LIMIT $4")
      : text;
    const result = await connection.query<Row>(compatibleText, values);
    return { rows: result.rows, rowCount: result.rowCount };
  }
}

class ExistingConnectionLifecycleDatabase implements LifecycleDatabase {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
  }

  transaction<T>(
    guildId: string,
    operation: (connection: LifecycleSqlConnection) => Promise<T>,
  ): Promise<T> {
    if (guildId !== this.#guildId) {
      throw new Error("Lifecycle transaction crosses the active Guild transaction.");
    }
    return operation({
      query: async <Row extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<LifecycleQueryResult<Row>> => {
        const result = await this.#connection.query<Row>(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    });
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertServiceInput(input: LifecycleServiceInput): void {
  assertUuid(input.env.GUILD_ID, "Guild ID");
  assertUuid(input.requesterActorId, "Requester Actor ID");
  assertNonBlank(input.reason, "Lifecycle reason", 5_000);
  assertNonBlank(
    input.env.HYPERDRIVE.connectionString,
    "PostgreSQL connection string",
    10_000,
  );
}

function chronicle(requesterActorId: string, reason: string): LifecycleChronicleInput {
  return {
    performedByActorId: requesterActorId,
    correlationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    reason,
    source: LIFECYCLE_SERVICE_SOURCE,
  };
}

function runtime(
  input: LifecycleServiceInput,
  database: LifecycleDatabase = new CurrentSchemaLifecycleDatabase(
    input.env.HYPERDRIVE.connectionString,
  ),
): GuildLifecycleRuntime {
  assertServiceInput(input);
  return new GuildLifecycleRuntime(new PostgresLifecycleRuntimeRepository({
    connectionString: input.env.HYPERDRIVE.connectionString,
    guildId: input.env.GUILD_ID,
    requesterActorId: input.requesterActorId,
    database,
  }));
}

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Handover contains an invalid timestamp.");
  return date.toISOString();
}

function optionalIso(value: string | null): string | null {
  return value === null ? null : iso(value);
}

function handoverFromRow(row: HandoverRow): HandoverCase {
  return {
    id: row.id,
    guildId: row.guild_id,
    departingActorId: row.departing_actor_id,
    successorActorId: row.successor_actor_id,
    initiatedByActorId: row.initiated_by_actor_id,
    reason: row.reason,
    status: row.status,
    completedAt: optionalIso(row.completed_at),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function handoverItemFromRow(row: HandoverItemRow): HandoverItem {
  return {
    id: row.id,
    guildId: row.guild_id,
    caseId: row.case_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    title: row.title,
    disposition: row.disposition,
    status: row.status,
    note: row.note,
    completedAt: optionalIso(row.completed_at),
    createdAt: iso(row.created_at),
  };
}

async function loadPersistedHandover(
  input: LifecycleServiceInput,
  handoverId: string,
): Promise<HandoverDetail> {
  assertUuid(handoverId, "Handover ID");
  return withGuildTransaction(
    input.env.HYPERDRIVE.connectionString,
    input.env.GUILD_ID,
    async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
        input.requesterActorId,
      ]);
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        input.env.GUILD_ID,
        input.requesterActorId,
      );
      const requester = snapshot.identities.find((identity) =>
        identity.id === input.requesterActorId);
      const membership = snapshot.memberships.find((candidate) =>
        candidate.identityId === input.requesterActorId);
      if (requester?.kind !== "human" || requester.status !== "active" ||
          membership?.state !== "active") {
        throw new Error("Persisted handover requires a current active Human requester.");
      }
      authorize(snapshot, {
        actorIdentityId: input.requesterActorId,
        permission: "lifecycle.manage",
      });

      const handover = (await connection.query<HandoverRow>(
        `SELECT id::text, guild_id::text, departing_actor_id::text,
                successor_actor_id::text, initiated_by_actor_id::text, reason,
                status, completed_at::text, version, created_at::text, updated_at::text
           FROM handover_cases
          WHERE guild_id = $1 AND id = $2`,
        [input.env.GUILD_ID, handoverId],
      )).rows[0];
      if (!handover) throw new Error("Persisted lifecycle handover was not found.");
      const items = (await connection.query<HandoverItemRow>(
        `SELECT id::text, guild_id::text, case_id::text, resource_type,
                resource_id::text, title, disposition, status, note,
                completed_at::text, created_at::text
           FROM handover_items
          WHERE guild_id = $1 AND case_id = $2
          ORDER BY created_at, id`,
        [input.env.GUILD_ID, handoverId],
      )).rows;
      return {
        handover: handoverFromRow(handover),
        items: items.map(handoverItemFromRow),
      };
    },
  );
}

export async function synchronizeLifecycleOnboarding(
  input: SynchronizeLifecycleOnboardingInput,
): Promise<LifecycleRequirementResult> {
  assertUuid(input.targetActorId, "Target Actor ID");
  return runtime(input).synchronizeOnboarding({
    guildId: input.env.GUILD_ID,
    actorId: input.targetActorId,
    chronicle: chronicle(input.requesterActorId, input.reason),
  });
}

export async function synchronizeLifecycleOnboardingInTransaction(
  input: SynchronizeLifecycleOnboardingInput & { connection: GuildTransactionConnection },
): Promise<LifecycleRequirementResult> {
  assertUuid(input.targetActorId, "Target Actor ID");
  return runtime(
    input,
    new ExistingConnectionLifecycleDatabase(input.connection, input.env.GUILD_ID),
  ).synchronizeOnboarding({
    guildId: input.env.GUILD_ID,
    actorId: input.targetActorId,
    chronicle: chronicle(input.requesterActorId, input.reason),
  });
}

export async function reconcilePublishedCanonicalMemory(
  input: ReconcilePublishedCanonicalMemoryInput,
): Promise<LifecycleRequirementResult> {
  assertUuid(input.memoryId, "Canonical Memory ID");
  return runtime(input).reconcileCanonicalMemory({
    guildId: input.env.GUILD_ID,
    memoryId: input.memoryId,
    chronicle: chronicle(input.requesterActorId, input.reason),
  });
}

export async function offboardLifecycleActor(
  input: OffboardLifecycleActorInput,
): Promise<LifecycleOffboardingResult> {
  assertUuid(input.targetActorId, "Target Actor ID");
  if (input.successorActorId !== null) {
    assertUuid(input.successorActorId, "Successor Actor ID");
  }
  const coordinator = runtime(input);
  const receipt = await coordinator.offboardActor({
    guildId: input.env.GUILD_ID,
    actorId: input.targetActorId,
    successorActorId: input.successorActorId,
    chronicle: chronicle(input.requesterActorId, input.reason),
  });
  return {
    receipt,
    handover: await loadPersistedHandover(input, receipt.handoverId),
  };
}
