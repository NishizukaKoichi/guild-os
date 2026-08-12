import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChronicleEvent, Constitution } from "@guild-os/domain";
import {
  GuildKnowledgeRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import {
  GuildKnowledgeService,
  drainKnowledgeFileDeletionQueue,
  searchAuthorizedKnowledge,
} from "../src/knowledge-service.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

function event(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId,
    spaceId: null,
    ownerIdentityId: actorIdentityId,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "knowledge-service-integration-test" },
  };
}

function constitution(guildId: string, rootId: string): Constitution {
  return {
    guildId,
    version: 1,
    level2ApprovalQuorum: 1,
    level3ApprovalQuorum: 2,
    dataRetentionDays: 365,
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

integration("Guild Knowledge service authorization boundary", () => {
  it("removes unauthorized candidates before Ask Guild constructs model context", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test.");
    const ids = {
      guild: randomUUID(),
      root: randomUUID(),
      member: randomUUID(),
      rootSpace: randomUUID(),
      allowedSpace: randomUUID(),
      deniedSpace: randomUUID(),
      readerRole: randomUUID(),
      allowed: randomUUID(),
      wrongSpace: randomUUID(),
      restricted: randomUUID(),
      overClearance: randomUUID(),
    };

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
        guildId: ids.guild,
        name: "Context Boundary Guild",
        purpose: "Prove authorization happens before model context construction",
        rootIdentityId: ids.root,
        rootDisplayName: "Root",
        rootSpaceId: ids.rootSpace,
        rootSpaceName: "Guild",
        constitution: constitution(ids.guild, ids.root),
        roles: [{
          id: ids.readerRole,
          name: "Scoped reader",
          permissions: ["guild.read", "space.read", "knowledge.read", "file.read"],
        }],
        chronicleEvent: event(ids.guild, ids.root, "guild.initialized", "guild", ids.guild),
      });
      await connection.query(
        `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
         VALUES ($1, $3, $4, 'Allowed', 'active'), ($2, $3, $4, 'Denied', 'active')`,
        [ids.allowedSpace, ids.deniedSpace, ids.guild, ids.rootSpace],
      );
      await connection.query(
        `INSERT INTO identities (id, guild_id, kind, display_name, status)
         VALUES ($1, $2, 'human', 'Scoped reader', 'active')`,
        [ids.member, ids.guild],
      );
      await connection.query(
        `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
         VALUES ($1, $2, 'active', 'internal', now())`,
        [ids.guild, ids.member],
      );
      await connection.query(
        `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), ids.guild, ids.member, ids.readerRole, ids.allowedSpace],
      );

      const repository = new GuildKnowledgeRepository(connection, ids.guild);
      const publish = async (
        knowledgeId: string,
        spaceId: string,
        marker: string,
        classification: "internal" | "confidential",
        visibility: "space" | "restricted",
        allowedIdentityIds: readonly string[] = [],
      ) => {
        await repository.createKnowledge({
          id: knowledgeId,
          spaceId,
          ownerIdentityId: ids.root,
          visibility,
          classification,
          allowedIdentityIds,
          reviewDueAt: null,
          changeNote: `Create ${marker}.`,
          title: { en: `Phoenix containment ${marker}` },
          summary: { en: `Search boundary marker ${marker}.` },
          body: { en: `Phoenix containment evidence ${marker}.` },
          sourceIds: [],
          chronicleEvent: event(ids.guild, ids.root, "knowledge.created", "knowledge", knowledgeId),
        });
        await repository.propose({
          knowledgeId,
          expectedVersion: 1,
          actorIdentityId: ids.root,
          chronicleEvent: event(ids.guild, ids.root, "knowledge.proposed", "knowledge", knowledgeId),
        });
        await repository.review({
          knowledgeId,
          expectedVersion: 1,
          actorIdentityId: ids.root,
          reviewId: randomUUID(),
          verdict: "approve",
          reason: "Fixture approved for authorization testing.",
          chronicleEvent: event(ids.guild, ids.root, "knowledge.canonical", "knowledge", knowledgeId),
        });
      };

      await publish(ids.allowed, ids.allowedSpace, "VISIBLE_MARKER", "internal", "space");
      await publish(ids.wrongSpace, ids.deniedSpace, "WRONG_SPACE_SECRET", "internal", "space");
      await publish(
        ids.restricted,
        ids.allowedSpace,
        "UNSHARED_SECRET",
        "internal",
        "restricted",
        [ids.root],
      );
      await publish(
        ids.overClearance,
        ids.allowedSpace,
        "CONFIDENTIAL_SECRET",
        "confidential",
        "space",
      );
    });

    let modelInput: unknown = null;
    const objects = new Map<string, Uint8Array>();
    let deleteFailures = 0;
    const knowledgeFiles = {
      async put(key: string, value: Uint8Array) {
        objects.set(key, new Uint8Array(value));
        return { key, size: value.byteLength };
      },
      async get(key: string) {
        const value = objects.get(key);
        return value ? {
          size: value.byteLength,
          async blob() {
            return new Blob([new Uint8Array(value).buffer], { type: "text/plain" });
          },
        } : null;
      },
      async delete(key: string) {
        if (deleteFailures > 0) {
          deleteFailures -= 1;
          throw new Error("Synthetic R2 outage");
        }
        objects.delete(key);
      },
    };
    const env = {
      GUILD_ID: ids.guild,
      GUILD_NAME: "Context Boundary Guild",
      GUILD_PURPOSE: "Authorization test",
      GUILD_ROOT_SPACE_NAME: "Guild",
      GUILD_LEVEL2_QUORUM: "1",
      GUILD_LEVEL3_QUORUM: "2",
      GUILD_RETENTION_DAYS: "365",
      GUILD_ASK_MODEL: "@cf/meta/llama-3.1-8b-instruct-fast",
      GUILD_AI_GATEWAY_ID: "default",
      HYPERDRIVE: { connectionString },
      AI: {
        async run(_model: string, input: Readonly<Record<string, unknown>>) {
          modelInput = input;
          return { response: "Use the visible procedure. [K1]" };
        },
      },
      KNOWLEDGE_FILES: knowledgeFiles,
      ASK_RATE_LIMITER: { async limit() { return { success: true }; } },
    } as unknown as GuildEnv;

    const candidates = await searchAuthorizedKnowledge(
      env,
      ids.member,
      "phoenix containment",
      "en",
    );
    expect(candidates.map((item) => item.candidate.id)).toEqual([ids.allowed]);

    const naturalQuestionCandidates = await searchAuthorizedKnowledge(
      env,
      ids.member,
      "What is phoenix containment?",
      "en",
    );
    expect(naturalQuestionCandidates.map((item) => item.candidate.id)).toEqual([ids.allowed]);

    const response = await new GuildKnowledgeService(env, ids.member).ask({
      question: "phoenix containment",
      locale: "en",
    });
    expect(response.citations.map((citation) => citation.knowledgeId)).toEqual([ids.allowed]);
    const serializedInput = JSON.stringify(modelInput);
    expect(serializedInput).toContain("VISIBLE_MARKER");
    expect(serializedInput).not.toContain("WRONG_SPACE_SECRET");
    expect(serializedInput).not.toContain("UNSHARED_SECRET");
    expect(serializedInput).not.toContain("CONFIDENTIAL_SECRET");

    let rejectedModelCalls = 0;
    const rateLimitedEnv = {
      ...env,
      ASK_RATE_LIMITER: { async limit() { return { success: false }; } },
      AI: { async run() { rejectedModelCalls += 1; return { response: "unexpected" }; } },
    } as GuildEnv;
    await expect(new GuildKnowledgeService(rateLimitedEnv, ids.member).ask({
      question: "phoenix containment",
      locale: "en",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(rejectedModelCalls).toBe(0);

    const rootService = new GuildKnowledgeService(env, ids.root);
    const revision = await rootService.startRevision({
      knowledgeId: ids.allowed,
      expectedVersion: 1,
    });
    await expect(rootService.saveDraft({
      knowledgeId: ids.allowed,
      expectedVersion: revision,
      spaceId: ids.allowedSpace,
      visibility: "restricted",
      classification: "internal",
      allowedIdentityIds: [ids.root],
      reviewDueAt: "2030-01-01T00:00:00.000Z",
      title: { en: "Phoenix containment VISIBLE_MARKER" },
      summary: { en: "Search boundary marker VISIBLE_MARKER." },
      body: { en: "Phoenix containment evidence VISIBLE_MARKER revised." },
      sourceIds: [],
      changeNote: "Restrict the working revision.",
    })).rejects.toThrow("security boundaries are immutable");
    const securedRevision = await rootService.saveDraft({
      knowledgeId: ids.allowed,
      expectedVersion: revision,
      spaceId: ids.allowedSpace,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      reviewDueAt: "2030-01-01T00:00:00.000Z",
      title: { en: "Phoenix containment VISIBLE_MARKER" },
      summary: { en: "Search boundary marker VISIBLE_MARKER." },
      body: { en: "Phoenix containment evidence VISIBLE_MARKER revised." },
      sourceIds: [],
      changeNote: "Revise the working content.",
    });
    expect((await rootService.getKnowledge(ids.allowed))).toMatchObject({
      currentVersion: securedRevision,
      visibility: "space",
      allowedIdentityIds: [],
      reviewDueAt: "2030-01-01T00:00:00.000Z",
    });
    expect(await searchAuthorizedKnowledge(env, ids.member, "phoenix containment", "en"))
      .toHaveLength(1);
    const uploaded = await rootService.uploadFile({
      knowledgeId: ids.allowed,
      expectedVersion: securedRevision,
      originalName: "containment.txt",
      mediaType: "text/plain",
      bytes: new TextEncoder().encode("fictional containment attachment"),
    });
    expect(uploaded).toMatchObject({ status: "ready", knowledgeVersion: securedRevision });
    expect(objects.size).toBe(1);
    await expect((await rootService.downloadFile(uploaded.id)).text())
      .resolves.toBe("fictional containment attachment");
    deleteFailures = 1;
    await rootService.deleteFile({
      knowledgeId: ids.allowed,
      expectedVersion: securedRevision,
      fileId: uploaded.id,
    });
    expect(objects.size).toBe(1);
    await withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      `UPDATE outbox SET available_at = now()
        WHERE guild_id = $1 AND topic = 'knowledge.file.delete' AND status = 'pending'`,
      [ids.guild],
    ));
    expect(await drainKnowledgeFileDeletionQueue(env)).toMatchObject({
      claimed: 1,
      completed: 1,
      deferred: 0,
    });
    expect(objects.size).toBe(0);
  });
});
