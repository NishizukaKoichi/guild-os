import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import {
  withGuildTransaction,
  type SqlConnection,
  type SqlConnectionFactory,
} from "./transaction.js";

class FakeConnection implements SqlConnection {
  readonly calls: string[] = [];
  readonly values: (readonly unknown[] | undefined)[] = [];

  async connect(): Promise<void> {
    this.calls.push("CONNECT");
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    this.calls.push(text);
    this.values.push(values);
    return { rows: [], command: "", rowCount: 0, oid: 0, fields: [] };
  }

  async end(): Promise<void> {
    this.calls.push("END");
  }
}

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";

describe("withGuildTransaction", () => {
  it("sets a transaction-local Guild boundary before application queries", async () => {
    const connection = new FakeConnection();
    const factory: SqlConnectionFactory = () => connection;
    await expect(withGuildTransaction("postgres://example", guildId, async (sql) => {
      await sql.query("SELECT protected_data");
      return "done";
    }, factory)).resolves.toBe("done");

    expect(connection.calls).toEqual([
      "CONNECT",
      "BEGIN",
      "SELECT set_config('app.guild_id', $1, true)",
      "SELECT protected_data",
      "COMMIT",
      "END",
    ]);
    expect(connection.values[1]).toEqual([guildId]);
  });

  it("rolls back and discards the connection when an operation fails", async () => {
    const connection = new FakeConnection();
    await expect(withGuildTransaction("postgres://example", guildId, async () => {
      throw new Error("failed mutation");
    }, () => connection)).rejects.toThrow("failed mutation");
    expect(connection.calls).toEqual([
      "CONNECT",
      "BEGIN",
      "SELECT set_config('app.guild_id', $1, true)",
      "ROLLBACK",
      "END",
    ]);
  });

  it("rejects malformed Guild IDs before opening a connection", async () => {
    let created = false;
    await expect(withGuildTransaction("postgres://example", "not-a-uuid", async () => undefined, () => {
      created = true;
      return new FakeConnection();
    })).rejects.toThrow("Guild ID must be a UUID");
    expect(created).toBe(false);
  });
});
