import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the PostgreSQL integration test.");
}

const client = new Client({ connectionString });

async function inGuildTransaction(guildId, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.guild_id', $1, true)", [guildId]);
    await operation();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function bootstrapGuild(label) {
  const guildId = randomUUID();
  const rootIdentityId = randomUUID();
  const spaceId = randomUUID();
  const eventId = randomUUID();
  const correlationId = randomUUID();

  await inGuildTransaction(guildId, async () => {
    await client.query(
      "INSERT INTO guilds (id, name, purpose, root_owner_identity_id) VALUES ($1, $2, $3, $4)",
      [guildId, `${label} Guild`, `${label} integration fixture`, rootIdentityId],
    );
    await client.query(
      "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'human', $3, 'active')",
      [rootIdentityId, guildId, `${label} Root`],
    );
    await client.query(
      "INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES ($1, $2, 'active', 'restricted', now())",
      [guildId, rootIdentityId],
    );
    await client.query("SELECT set_config('app.actor_identity_id', $1, true)", [rootIdentityId]);
    await client.query(
      `INSERT INTO constitutions
         (guild_id, version, level2_approval_quorum, level3_approval_quorum,
          data_retention_days, agent_defaults, updated_by_identity_id)
       VALUES ($1, 1, 1, 2, 365, $2::jsonb, $3)`,
      [
        guildId,
        JSON.stringify({
          currency: "USD",
          maxBudgetMinor: 1000,
          maxTokens: 100_000,
          maxDurationSeconds: 900,
          maxSteps: 20,
          maxRetries: 2,
          maxDelegationDepth: 1,
        }),
        rootIdentityId,
      ],
    );
    await client.query(
      "INSERT INTO spaces (id, guild_id, name, status) VALUES ($1, $2, $3, 'active')",
      [spaceId, guildId, `${label} Root Space`],
    );
    await client.query(
      `INSERT INTO chronicle_events
         (id, guild_id, actor_identity_id, action, subject_type, subject_id,
          correlation_id, occurred_at, details, owner_identity_id)
       VALUES ($1, $2, $3, 'guild.initialized', 'guild', $2, $4, now(), '{}'::jsonb, $3)`,
      [eventId, guildId, rootIdentityId, correlationId],
    );
  });

  return { guildId, rootIdentityId, eventId };
}

async function expectStatementFailure(sql, parameters, message) {
  await client.query("SAVEPOINT expected_failure");
  let failed = false;
  try {
    await client.query(sql, parameters);
  } catch {
    failed = true;
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
  }
  assert.equal(failed, true, message);
  await client.query("RELEASE SAVEPOINT expected_failure");
}

async function expectDeferredFailure(sql, parameters, message) {
  await client.query("SAVEPOINT expected_deferred_failure");
  let failed = false;
  try {
    await client.query(sql, parameters);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch {
    failed = true;
    await client.query("ROLLBACK TO SAVEPOINT expected_deferred_failure");
  }
  assert.equal(failed, true, message);
  await client.query("RELEASE SAVEPOINT expected_deferred_failure");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

await client.connect();
try {
  const guildA = await bootstrapGuild("Alpha");
  const guildB = await bootstrapGuild("Beta");

  const noTenant = await client.query("SELECT id::text FROM guilds");
  assert.deepEqual(noTenant.rows, [], "RLS must return no Guild rows without a tenant context.");

  await inGuildTransaction(guildA.guildId, async () => {
    const visibleGuilds = await client.query("SELECT id::text FROM guilds ORDER BY id");
    assert.deepEqual(visibleGuilds.rows, [{ id: guildA.guildId }]);

    const hiddenIdentities = await client.query(
      "SELECT id::text FROM identities WHERE guild_id = $1",
      [guildB.guildId],
    );
    assert.deepEqual(hiddenIdentities.rows, [], "Cross-Guild identities must be invisible.");

    await expectStatementFailure(
      "INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES ($1, $2, 'human', 'Cross tenant', 'active')",
      [randomUUID(), guildB.guildId],
      "RLS must reject cross-Guild inserts.",
    );

    await expectStatementFailure(
      "UPDATE chronicle_events SET action = 'tampered' WHERE id = $1",
      [guildA.eventId],
      "Chronicle events must reject mutation.",
    );

    await expectDeferredFailure(
      "UPDATE identities SET status = 'disabled' WHERE id = $1",
      [guildA.rootIdentityId],
      "The Root Owner identity must remain active.",
    );

    await expectDeferredFailure(
      "UPDATE memberships SET state = 'suspended' WHERE identity_id = $1",
      [guildA.rootIdentityId],
      "The Root Owner membership must remain active.",
    );
  });

  process.stdout.write(
    "PostgreSQL migration, tenant RLS, Root integrity, and Chronicle immutability verified.\n",
  );
} finally {
  await client.end();
}
