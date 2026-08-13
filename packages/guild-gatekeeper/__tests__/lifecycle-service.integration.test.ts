import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AgentApprovalRequest,
  AgentRun,
  ChronicleEvent,
  Constitution,
} from "@guild-os/domain";
import {
  GuildAgentRunRepository,
  GuildOperationsRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import type { GuildEnv } from "../src/config.js";
import {
  offboardLifecycleActor,
  reconcilePublishedCanonicalMemory,
  synchronizeLifecycleOnboarding,
} from "../src/lifecycle-service.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;

interface FixtureIds {
  guild: string;
  root: string;
  rootSpace: string;
  teamSpace: string;
  otherSpace: string;
  staffRole: string;
  otherRole: string;
  onboardingHuman: string;
  outsider: string;
  successor: string;
  agent: string;
  rollbackHuman: string;
  memory: string;
  sourceActivity: string;
  onboardingPath: string;
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
      maxBudgetMinor: 1_000,
      maxTokens: 100_000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    updatedByIdentityId: rootId,
    updatedAt: new Date().toISOString(),
  };
}

function event(
  ids: Pick<FixtureIds, "guild" | "root">,
  action: string,
  subjectType: string,
  subjectId: string,
): ChronicleEvent {
  return {
    id: randomUUID(),
    guildId: ids.guild,
    spaceId: null,
    ownerIdentityId: ids.root,
    visibility: "guild",
    classification: "restricted",
    allowedIdentityIds: [],
    actorIdentityId: ids.root,
    action,
    subjectType,
    subjectId,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    details: { source: "lifecycle-service-integration-fixture" },
  };
}

function guildEnv(guildId: string): GuildEnv {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  return {
    GUILD_ID: guildId,
    HYPERDRIVE: { connectionString },
  } as GuildEnv;
}

async function fixture(): Promise<{ ids: FixtureIds; env: GuildEnv }> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const ids: FixtureIds = {
    guild: randomUUID(),
    root: randomUUID(),
    rootSpace: randomUUID(),
    teamSpace: randomUUID(),
    otherSpace: randomUUID(),
    staffRole: randomUUID(),
    otherRole: randomUUID(),
    onboardingHuman: randomUUID(),
    outsider: randomUUID(),
    successor: randomUUID(),
    agent: randomUUID(),
    rollbackHuman: randomUUID(),
    memory: randomUUID(),
    sourceActivity: randomUUID(),
    onboardingPath: randomUUID(),
  };

  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await new GuildPostgresRepository(connection, ids.guild).bootstrapGuild({
      guildId: ids.guild,
      name: "Lifecycle Service Integration Guild",
      purpose: "Verify the production lifecycle coordinator against PostgreSQL and RLS.",
      rootIdentityId: ids.root,
      rootDisplayName: "Lifecycle Root",
      rootSpaceId: ids.rootSpace,
      rootSpaceName: "Guild",
      constitution: constitution(ids.guild, ids.root),
      roles: [{
        id: ids.staffRole,
        name: "Scoped Staff",
        permissions: ["guild.read", "space.read", "lifecycle.read"],
      }, {
        id: ids.otherRole,
        name: "Unrelated Staff",
        permissions: ["guild.read", "space.read", "lifecycle.read"],
      }],
      chronicleEvent: event(ids, "guild.initialized", "guild", ids.guild),
    });
    await connection.query(
      `INSERT INTO spaces (id, guild_id, parent_space_id, name, status)
       VALUES ($1, $3, $4, 'Team', 'active'),
              ($2, $3, $4, 'Other', 'active')`,
      [ids.teamSpace, ids.otherSpace, ids.guild, ids.rootSpace],
    );
    await connection.query(
      "UPDATE guild_collective_settings SET template_key = 'company' WHERE guild_id = $1",
      [ids.guild],
    );
    await connection.query(
      `INSERT INTO identities (id, guild_id, kind, display_name, status) VALUES
         ($1, $6, 'human', 'Onboarding Human', 'active'),
         ($2, $6, 'human', 'Unprivileged Human', 'active'),
         ($3, $6, 'human', 'Lifecycle Successor', 'active'),
         ($4, $6, 'agent', 'Lifecycle Agent', 'active'),
         ($5, $6, 'human', 'Rollback Human', 'active')`,
      [
        ids.onboardingHuman,
        ids.outsider,
        ids.successor,
        ids.agent,
        ids.rollbackHuman,
        ids.guild,
      ],
    );
    await connection.query(
      `INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at) VALUES
         ($1, $2, 'preboarding', 'internal', NULL),
         ($1, $3, 'active', 'internal', now()),
         ($1, $4, 'active', 'internal', now()),
         ($1, $5, 'active', 'internal', now()),
         ($1, $6, 'active', 'internal', now())`,
      [
        ids.guild,
        ids.onboardingHuman,
        ids.outsider,
        ids.successor,
        ids.agent,
        ids.rollbackHuman,
      ],
    );
    await connection.query(
      `INSERT INTO agent_profiles
         (guild_id, identity_id, instructions, model, tool_ids, limits, status)
       VALUES ($1, $2, 'Execute bounded lifecycle integration work.', 'test/model',
               '{}', $3::jsonb, 'active')`,
      [ids.guild, ids.agent, JSON.stringify(constitution(ids.guild, ids.root).agentDefaults)],
    );
    await connection.query(
      `INSERT INTO memories
         (id, guild_id, space_id, owner_actor_id, creator_actor_id, type, status,
          workflow, governance_state, visibility, classification, current_version,
          canonical_version, confidence)
       VALUES ($1, $2, $3, $4, $4, 'manual', 'active', 'canonical', 'canonical',
               'space', 'internal', 1, 1, 1)`,
      [ids.memory, ids.guild, ids.teamSpace, ids.root],
    );
    await connection.query(
      `INSERT INTO memory_versions
         (guild_id, memory_id, version, title, summary, body, change_note,
          created_by_actor_id)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5::jsonb,
               'Initial canonical publication', $6)`,
      [
        ids.guild,
        ids.memory,
        JSON.stringify({ en: "Team safety manual" }),
        JSON.stringify({ en: "Required Team onboarding knowledge." }),
        JSON.stringify({ en: "Use the verified Team procedure." }),
        ids.root,
      ],
    );
    await connection.query(
      `INSERT INTO activities
         (id, guild_id, space_id, owner_actor_id, creator_actor_id, type, title,
          description, status, visibility, classification)
       VALUES ($1, $2, $3, $4, $4, 'task', 'First Team activity',
               'Complete the first scoped activity.', 'ready', 'space', 'internal')`,
      [ids.sourceActivity, ids.guild, ids.teamSpace, ids.root],
    );
    await connection.query(
      `INSERT INTO onboarding_paths
         (id, guild_id, space_id, template_key, name, description,
          created_by_actor_id, version)
       VALUES ($1, $2, $3, 'company', 'Team onboarding',
               'Applied after a matching Space Role is assigned.', $4, 1)`,
      [ids.onboardingPath, ids.guild, ids.teamSpace, ids.root],
    );
    await connection.query(
      `INSERT INTO onboarding_requirements
         (id, guild_id, path_id, kind, resource_id, title, instructions, required, position)
       VALUES ($1, $3, $4, 'memory', $5, 'Confirm Team safety',
               'Confirm the current Canonical Memory version.', true, 0),
              ($2, $3, $4, 'activity', $6, 'Complete first Team activity',
               'Complete the generated Activity with a coordinator.', true, 1),
              ($7, $3, $4, 'acknowledgement', $5, 'Acknowledge Team policy',
               'Confirm that the Team policy is understood.', true, 2)`,
      [
        randomUUID(),
        randomUUID(),
        ids.guild,
        ids.onboardingPath,
        ids.memory,
        ids.sourceActivity,
        randomUUID(),
      ],
    );
    await connection.query(
      `INSERT INTO onboarding_path_roles (guild_id, path_id, role_id)
       VALUES ($1, $2, $3)`,
      [ids.guild, ids.onboardingPath, ids.staffRole],
    );
  });
  return { ids, env: guildEnv(ids.guild) };
}

function agentRun(ids: FixtureIds, runId: string): AgentRun {
  const now = new Date().toISOString();
  return {
    id: runId,
    guildId: ids.guild,
    spaceId: ids.teamSpace,
    ownerIdentityId: ids.root,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    agentIdentityId: ids.agent,
    requesterIdentityId: ids.root,
    connectorId: null,
    questId: null,
    riskLevel: 1,
    status: "awaiting_approval",
    source: "guild-ui",
    plan: {
      objective: "Draft a continuity Activity",
      expectedOutcome: "One reversible Activity draft is prepared.",
      steps: ["Read current policy", "Draft the Activity"],
      connectorId: null,
      questId: null,
      action: {
        kind: "activity_draft",
        title: "Review continuity",
        description: "Human approval remains required.",
        activityType: "task",
      },
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 100,
        durationSeconds: 10,
        steps: 2,
        retries: 0,
        delegationDepth: 0,
      },
    },
    result: null,
    errorMessage: null,
    limits: constitution(ids.guild, ids.root).agentDefaults,
    usage: {
      budgetMinor: 0,
      tokens: 0,
      durationSeconds: 0,
      steps: 0,
      retries: 0,
      delegationDepth: 0,
    },
    workflowInstanceId: `lifecycle-service-${runId}`,
    idempotencyKey: `lifecycle-service:${runId}`,
    requestHash: "b".repeat(64),
    estimatedBudgetMinor: 0,
    killRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function approval(ids: FixtureIds, runId: string, approvalId: string): AgentApprovalRequest {
  const now = new Date();
  return {
    id: approvalId,
    guildId: ids.guild,
    agentRunId: runId,
    riskLevel: 1,
    actionKind: "activity.draft",
    requiredApprovals: 1,
    approvalCount: 0,
    reauthenticationRequired: false,
    status: "pending",
    expiresAt: new Date(now.valueOf() + 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function createAgentOffboardingResources(ids: FixtureIds): Promise<{
  tokenId: string;
  credentialId: string;
  workflowId: string;
  scheduleId: string;
  workflowRequestId: string;
  runId: string;
  approvalId: string;
  activityId: string;
  fileId: string;
}> {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const resourceIds = {
    tokenId: randomUUID(),
    credentialId: randomUUID(),
    workflowId: randomUUID(),
    scheduleId: randomUUID(),
    workflowRequestId: randomUUID(),
    runId: randomUUID(),
    approvalId: randomUUID(),
    activityId: randomUUID(),
    fileId: randomUUID(),
  };
  await withGuildTransaction(connectionString, ids.guild, async (connection) => {
    await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
    const operations = new GuildOperationsRepository(connection, ids.guild);
    await operations.createConnection({
      id: resourceIds.tokenId,
      actorId: ids.root,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.agent,
      name: "Agent access token",
      kind: "api",
      capabilityPermissions: ["integration.execute"],
      endpointUrl: "https://api.example.test/token",
      secretReference: "AGENT_ACCESS_TOKEN_SECRET",
      visibility: "space",
      classification: "restricted",
      authKind: "access_token",
      writeRiskLevel: 2,
      chronicleEvent: event(ids, "connection.created", "connector", resourceIds.tokenId),
    });
    await operations.createConnection({
      id: resourceIds.credentialId,
      actorId: ids.root,
      spaceId: ids.teamSpace,
      ownerIdentityId: ids.agent,
      name: "Agent OAuth credential",
      kind: "oauth",
      capabilityPermissions: ["integration.execute"],
      endpointUrl: "https://oauth.example.test/actions",
      secretReference: "AGENT_OAUTH_SECRET",
      visibility: "space",
      classification: "restricted",
      authKind: "oauth",
      writeRiskLevel: 2,
      chronicleEvent: event(ids, "connection.created", "connector", resourceIds.credentialId),
    });
    await operations.createWorkflowDefinition({
      id: resourceIds.workflowId,
      actorId: ids.root,
      ownerActorId: ids.root,
      spaceId: ids.teamSpace,
      name: "Lifecycle continuity workflow",
      status: "active",
      nodes: [{ id: "start", kind: "input" }, { id: "draft", kind: "activity_draft" }],
      edges: [{ from: "start", to: "draft" }],
      allowedActionKinds: ["activity_draft"],
      capabilityPermissions: ["activity.create"],
      visibility: "space",
      classification: "internal",
      chronicleEvent: event(
        ids,
        "workflow.created",
        "workflow_definition",
        resourceIds.workflowId,
      ),
    });
    await operations.createAutomationRule({
      id: resourceIds.scheduleId,
      actorId: ids.root,
      workflowId: resourceIds.workflowId,
      agentActorId: ids.agent,
      createdByActorId: ids.root,
      name: "Lifecycle continuity schedule",
      triggerKind: "manual",
      triggerExpression: "manual",
      status: "active",
      nextRunAt: null,
      chronicleEvent: event(
        ids,
        "automation.created",
        "automation_rule",
        resourceIds.scheduleId,
      ),
    });
    const run = agentRun(ids, resourceIds.runId);
    await new GuildAgentRunRepository(connection, ids.guild).createRun({
      run,
      approval: approval(ids, resourceIds.runId, resourceIds.approvalId),
      workflowPermissions: ["activity.create"],
      workflowDefinitionId: resourceIds.workflowId,
      chronicleEvent: event(ids, "agent.run.planned", "agent_run", resourceIds.runId),
    });
    await connection.query(
      `INSERT INTO workflow_run_requests
         (id, guild_id, workflow_id, automation_rule_id, requested_by_actor_id,
          agent_actor_id, trigger_kind, input, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'schedule', '{}'::jsonb,
               'queued', $7)`,
      [
        resourceIds.workflowRequestId,
        ids.guild,
        resourceIds.workflowId,
        resourceIds.scheduleId,
        ids.root,
        ids.agent,
        `lifecycle-workflow-request:${resourceIds.workflowRequestId}`,
      ],
    );
    await connection.query(
      `INSERT INTO activities
         (id, guild_id, space_id, owner_actor_id, creator_actor_id, assignee_actor_id,
          type, title, description, status, visibility, classification)
       VALUES ($1, $2, $3, $4, $5, $4, 'task', 'Agent open Activity', '',
               'active', 'space', 'internal')`,
      [resourceIds.activityId, ids.guild, ids.teamSpace, ids.agent, ids.root],
    );
    await connection.query(
      `INSERT INTO files
         (id, guild_id, space_id, owner_identity_id, owner_actor_id, r2_key,
          sha256, media_type, byte_size, visibility, classification,
          allowed_identity_ids, allowed_actor_ids, original_name, status)
       VALUES ($1, $2, $3, $4, $4, $5, $6, 'text/plain', 12, 'space',
               'internal', '{}'::uuid[], '{}'::uuid[], 'agent-note.txt', 'ready')`,
      [
        resourceIds.fileId,
        ids.guild,
        ids.teamSpace,
        ids.agent,
        `lifecycle/${resourceIds.fileId}`,
        "c".repeat(64),
      ],
    );
  });
  return resourceIds;
}

integration("production lifecycle service", () => {
  it("uses current RLS authority and synchronizes only matching Template, Role, and Space", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env } = await fixture();
    const privateReason = "Invitation accepted and Team Role assigned.";

    await expect(synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.outsider,
      targetActorId: ids.onboardingHuman,
      reason: privateReason,
    })).rejects.toThrow("lifecycle.manage");

    const beforeRole = await synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.onboardingHuman,
      reason: privateReason,
    });
    expect(beforeRole.insertedRequirementKeys).toEqual([]);

    await withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), ids.guild, ids.onboardingHuman, ids.otherRole, ids.teamSpace],
    ));
    await expect(synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.onboardingHuman,
      reason: privateReason,
    })).resolves.toMatchObject({ insertedRequirementKeys: [] });

    await withGuildTransaction(connectionString, ids.guild, (connection) => connection.query(
      `INSERT INTO role_bindings (id, guild_id, identity_id, role_id, space_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), ids.guild, ids.onboardingHuman, ids.staffRole, ids.teamSpace],
    ));
    const assigned = await synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.onboardingHuman,
      reason: privateReason,
    });
    expect(assigned.insertedRequirementKeys).toHaveLength(1);
    await expect(synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.onboardingHuman,
      reason: privateReason,
    })).resolves.toMatchObject({ insertedRequirementKeys: [] });

    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query(
        `INSERT INTO memory_versions
           (guild_id, memory_id, version, title, summary, body, change_note,
            created_by_actor_id)
         VALUES ($1, $2, 2, $3::jsonb, $4::jsonb, $5::jsonb,
                 'Publish revised canonical procedure', $6)`,
        [
          ids.guild,
          ids.memory,
          JSON.stringify({ en: "Team safety manual v2" }),
          JSON.stringify({ en: "Updated Team onboarding knowledge." }),
          JSON.stringify({ en: "Use the revised verified Team procedure." }),
          ids.root,
        ],
      );
      await connection.query(
        `UPDATE memories SET current_version = 2, canonical_version = 2, updated_at = now()
          WHERE guild_id = $1 AND id = $2`,
        [ids.guild, ids.memory],
      );
    });
    const reconfirmation = await reconcilePublishedCanonicalMemory({
      env,
      requesterActorId: ids.root,
      memoryId: ids.memory,
      reason: "Canonical Team procedure version 2 was published.",
    });
    expect(reconfirmation.insertedRequirementKeys).toHaveLength(1);

    const evidence = await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      const assignments = await connection.query<{
        actor_id: string; version: number; generated: boolean; requirement_count: string;
      }>(
        `SELECT assignment.actor_id::text, path.version,
                path.description LIKE 'guild-lifecycle-runtime:v1:%' AS generated,
                count(requirement.id)::text AS requirement_count
           FROM onboarding_assignments assignment
           JOIN onboarding_paths path
             ON path.guild_id = assignment.guild_id AND path.id = assignment.path_id
           LEFT JOIN onboarding_requirements requirement
             ON requirement.guild_id = path.guild_id AND requirement.path_id = path.id
          WHERE assignment.guild_id = $1
          GROUP BY assignment.id, path.id
          ORDER BY path.version, assignment.id`,
        [ids.guild],
      );
      const lifecycleEvents = await connection.query<{
        correlation_id: string;
        occurred_at: string;
        details: string;
      }>(
        `SELECT correlation_id::text, occurred_at::text, details::text
           FROM chronicle_events
          WHERE guild_id = $1 AND action IN (
            'lifecycle.onboarding.assigned',
            'lifecycle.memory.reconfirmation_assigned'
          ) ORDER BY sequence`,
        [ids.guild],
      );
      return { assignments: assignments.rows, lifecycleEvents: lifecycleEvents.rows };
    });
    expect(evidence.assignments).toHaveLength(2);
    expect(evidence.assignments.every((row) => row.actor_id === ids.onboardingHuman)).toBe(true);
    expect(evidence.assignments.map((row) => row.version).sort()).toEqual([1, 2]);
    expect(evidence.assignments).toContainEqual(expect.objectContaining({
      generated: false,
      requirement_count: "3",
    }));
    expect(evidence.lifecycleEvents).toHaveLength(2);
    expect(evidence.lifecycleEvents.every((row) =>
      /^[0-9a-f-]{36}$/i.test(row.correlation_id) && !row.details.includes(privateReason)))
      .toBe(true);
  });

  it("immediately offboards an Agent and rolls back a late Human offboarding failure", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    const { ids, env } = await fixture();
    const resources = await createAgentOffboardingResources(ids);
    const offboardingReason = "Agent access is no longer required for this Guild.";

    const completed = await offboardLifecycleActor({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.agent,
      successorActorId: ids.successor,
      reason: offboardingReason,
    });
    expect(completed.receipt).toMatchObject({
      actorId: ids.agent,
      actorKind: "agent",
      revokedAccessTokenCount: 1,
      revokedConnectorCredentialCount: 1,
      stoppedScheduledRunCount: 1,
      killedAgentRunCount: 1,
      expiredApprovalCount: 1,
    });
    expect(completed.handover.handover.id).toBe(completed.receipt.handoverId);
    expect(completed.handover.items.map((item) => item.resourceId))
      .toEqual(expect.arrayContaining([resources.activityId, resources.fileId]));

    const revoked = await withGuildTransaction(connectionString, ids.guild, async (connection) => ({
      identity: (await connection.query<{ status: string }>(
        "SELECT status FROM identities WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.agent],
      )).rows[0]?.status,
      membership: (await connection.query<{ state: string }>(
        "SELECT state FROM memberships WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, ids.agent],
      )).rows[0]?.state,
      actorOperational: (await connection.query<{ operational: boolean }>(
        "SELECT operational FROM actor_memberships WHERE guild_id = $1 AND actor_id = $2",
        [ids.guild, ids.agent],
      )).rows[0]?.operational,
      agentProfile: (await connection.query<{ status: string }>(
        "SELECT status FROM agent_profiles WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, ids.agent],
      )).rows[0]?.status,
      connectionStatuses: (await connection.query<{ status: string }>(
        "SELECT status FROM connectors WHERE guild_id = $1 AND id = ANY($2::uuid[]) ORDER BY id",
        [ids.guild, [resources.tokenId, resources.credentialId]],
      )).rows.map((row) => row.status),
      schedule: (await connection.query<{ status: string }>(
        "SELECT status FROM automation_rules WHERE guild_id = $1 AND id = $2",
        [ids.guild, resources.scheduleId],
      )).rows[0]?.status,
      workflowRequest: (await connection.query<{ status: string }>(
        "SELECT status FROM workflow_run_requests WHERE guild_id = $1 AND id = $2",
        [ids.guild, resources.workflowRequestId],
      )).rows[0]?.status,
      run: (await connection.query<{ status: string }>(
        "SELECT status FROM agent_runs WHERE guild_id = $1 AND id = $2",
        [ids.guild, resources.runId],
      )).rows[0]?.status,
      approval: (await connection.query<{ status: string }>(
        "SELECT status FROM approval_requests WHERE guild_id = $1 AND id = $2",
        [ids.guild, resources.approvalId],
      )).rows[0]?.status,
    }));
    expect(revoked).toEqual({
      identity: "disabled",
      membership: "departed",
      actorOperational: false,
      agentProfile: "stopped",
      connectionStatuses: ["revoked", "revoked"],
      schedule: "paused",
      workflowRequest: "cancelled",
      run: "killed",
      approval: "expired",
    });
    const offboardingEvents = await withGuildTransaction(
      connectionString,
      ids.guild,
      (connection) => connection.query<{ details: string }>(
        `SELECT details::text
           FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2
            AND action = 'lifecycle.actor.offboarded'`,
        [ids.guild, ids.agent],
      ),
    );
    expect(offboardingEvents.rows).toHaveLength(1);
    expect(offboardingEvents.rows[0]?.details).not.toContain(offboardingReason);
    expect(offboardingEvents.rows[0]?.details).not.toContain("AGENT_ACCESS_TOKEN_SECRET");
    expect(offboardingEvents.rows[0]?.details).not.toContain("AGENT_OAUTH_SECRET");
    await expect(synchronizeLifecycleOnboarding({
      env,
      requesterActorId: ids.agent,
      targetActorId: ids.successor,
      reason: "A stopped Agent cannot claim Human lifecycle authority.",
    })).rejects.toThrow("active Human");

    const rollbackConnectionId = randomUUID();
    const existingHandoverId = randomUUID();
    await withGuildTransaction(connectionString, ids.guild, async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [ids.root]);
      await new GuildOperationsRepository(connection, ids.guild).createConnection({
        id: rollbackConnectionId,
        actorId: ids.root,
        spaceId: ids.teamSpace,
        ownerIdentityId: ids.rollbackHuman,
        name: "Rollback credential",
        kind: "api",
        capabilityPermissions: ["integration.execute"],
        endpointUrl: "https://rollback.example.test/action",
        secretReference: "ROLLBACK_CREDENTIAL_SECRET",
        visibility: "space",
        classification: "restricted",
        authKind: "oauth",
        writeRiskLevel: 2,
        chronicleEvent: event(ids, "connection.created", "connector", rollbackConnectionId),
      });
      await connection.query(
        `INSERT INTO handover_cases
           (id, guild_id, departing_actor_id, successor_actor_id,
            initiated_by_actor_id, reason)
         VALUES ($1, $2, $3, $4, $5, 'Existing open handover forces a late conflict.')`,
        [
          existingHandoverId,
          ids.guild,
          ids.rollbackHuman,
          ids.successor,
          ids.root,
        ],
      );
    });

    await expect(offboardLifecycleActor({
      env,
      requesterActorId: ids.root,
      targetActorId: ids.rollbackHuman,
      successorActorId: ids.successor,
      reason: "This operation must roll back after the forced late conflict.",
    })).rejects.toThrow();

    const rolledBack = await withGuildTransaction(connectionString, ids.guild, async (connection) => ({
      identity: (await connection.query<{ status: string }>(
        "SELECT status FROM identities WHERE guild_id = $1 AND id = $2",
        [ids.guild, ids.rollbackHuman],
      )).rows[0]?.status,
      membership: (await connection.query<{ state: string }>(
        "SELECT state FROM memberships WHERE guild_id = $1 AND identity_id = $2",
        [ids.guild, ids.rollbackHuman],
      )).rows[0]?.state,
      connector: (await connection.query<{ status: string }>(
        "SELECT status FROM connectors WHERE guild_id = $1 AND id = $2",
        [ids.guild, rollbackConnectionId],
      )).rows[0]?.status,
      handoverCount: (await connection.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM handover_cases WHERE guild_id = $1 AND departing_actor_id = $2",
        [ids.guild, ids.rollbackHuman],
      )).rows[0]?.count,
      offboardEventCount: (await connection.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM chronicle_events
          WHERE guild_id = $1 AND subject_id = $2 AND action = 'lifecycle.actor.offboarded'`,
        [ids.guild, ids.rollbackHuman],
      )).rows[0]?.count,
    }));
    expect(rolledBack).toEqual({
      identity: "active",
      membership: "active",
      connector: "active",
      handoverCount: "1",
      offboardEventCount: "0",
    });
  });
});
