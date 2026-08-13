import { Client, type QueryResult, type QueryResultRow } from "pg";

export interface SqlConnection {
  connect(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

declare const guildTransactionConnection: unique symbol;

export interface GuildTransactionConnection extends SqlConnection {
  readonly [guildTransactionConnection]: true;
}

export type SqlConnectionFactory = (connectionString: string) => SqlConnection;

class NodePostgresConnection implements SqlConnection {
  readonly #client: Client;

  constructor(connectionString: string) {
    this.#client = new Client({ connectionString });
  }

  async connect(): Promise<void> {
    await this.#client.connect();
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    return this.#client.query<Row>(text, values ? [...values] : undefined);
  }

  end(): Promise<void> {
    return this.#client.end();
  }
}

const defaultFactory: SqlConnectionFactory = (connectionString) =>
  new NodePostgresConnection(connectionString);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function withGuildTransaction<T>(
  connectionString: string,
  guildId: string,
  operation: (connection: GuildTransactionConnection) => Promise<T>,
  factory: SqlConnectionFactory = defaultFactory,
  isolation: "repeatable read" | "serializable" | null = null,
): Promise<T> {
  if (!UUID_PATTERN.test(guildId)) {
    throw new Error("Guild ID must be a UUID before opening a database transaction.");
  }
  const connection = factory(connectionString);
  await connection.connect();
  try {
    await connection.query("BEGIN");
    if (isolation !== null) {
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${isolation.toUpperCase()}`);
    }
    await connection.query("SELECT set_config('app.guild_id', $1, true)", [guildId]);
    const result = await operation(connection as GuildTransactionConnection);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // Preserve the original operation error. The connection is discarded below.
    }
    throw error;
  } finally {
    await connection.end();
  }
}
