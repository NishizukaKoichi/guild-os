import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection, SqlConnection } from "./transaction.js";

class RepositoryConnection implements SqlConnection {
  readonly statements: string[] = [];

  async connect(): Promise<void> {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    this.statements.push(text);
    const rows = text.includes("SELECT 1 FROM guilds") ? [] : [];
    return { rows: rows as Row[], command: "", rowCount: rows.length, oid: 0, fields: [] };
  }

  async end(): Promise<void> {}
}

function asGuildTransaction(connection: SqlConnection): GuildTransactionConnection {
  return connection as GuildTransactionConnection;
}

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";
const rootId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b";
const spaceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9c";

function constitution(): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 1,
    dataRetentionDays: 2555,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function chronicleEvent(): ChronicleEvent {
  return {
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9d",
    guildId,
    actorIdentityId: rootId,
    action: "guild.initialized",
    subjectType: "guild",
    subjectId: guildId,
    correlationId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9e",
    occurredAt: "2026-08-12T00:00:00.000Z",
    details: { source: "test" },
  };
}

describe("GuildPostgresRepository bootstrap", () => {
  it("writes the Root identity and Chronicle event in the caller transaction", async () => {
    const connection = new RepositoryConnection();
    const repository = new GuildPostgresRepository(asGuildTransaction(connection), guildId);
    await expect(repository.bootstrapGuild({
      guildId,
      name: "Example Guild",
      purpose: "Coordinate people and agents",
      rootIdentityId: rootId,
      rootDisplayName: "Root Owner",
      rootSpaceId: spaceId,
      rootSpaceName: "Guild",
      constitution: constitution(),
      roles: [{
        id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9f",
        name: "Member",
        permissions: ["guild.read"],
      }],
      chronicleEvent: chronicleEvent(),
    })).resolves.toBe(true);

    expect(connection.statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(connection.statements.some((sql) => sql.includes("INSERT INTO guilds"))).toBe(true);
    expect(connection.statements.some((sql) => sql.includes("INSERT INTO identities"))).toBe(true);
    expect(connection.statements.some((sql) => sql.includes("INSERT INTO chronicle_events"))).toBe(true);
  });

  it("rejects bootstrap data from another Guild", async () => {
    const repository = new GuildPostgresRepository(
      asGuildTransaction(new RepositoryConnection()),
      guildId,
    );
    await expect(repository.bootstrapGuild({
      guildId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aaa",
      name: "Wrong Guild",
      purpose: "Wrong boundary",
      rootIdentityId: rootId,
      rootDisplayName: "Root Owner",
      rootSpaceId: spaceId,
      rootSpaceName: "Guild",
      constitution: constitution(),
      roles: [],
      chronicleEvent: chronicleEvent(),
    })).rejects.toThrow("crosses the active Guild");
  });
});
