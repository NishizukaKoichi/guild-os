import { randomUUID } from "node:crypto";
import {
  COLLECTIVE_TEMPLATES,
  type CollectiveOnboardingAnswers,
  type Constitution,
} from "@guild-os/domain";
import {
  GuildCollectiveRepository,
  GuildPostgresRepository,
  withGuildTransaction,
} from "@guild-os/postgres";
import { describe, expect, it } from "vitest";
import { makeChronicleEvent } from "../src/chronicle.js";
import {
  buildTemplateProvisioningPlan,
  provisionTemplateDefaults,
} from "../src/template-provisioning.js";

const connectionString = process.env.DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
const answers: CollectiveOnboardingAnswers = {
  purpose: "Verify a complete template instance",
  participants: "Humans and governed Agents",
  memoryIntent: "Approved context",
  activityIntent: "Reviewable work",
  decisionStyle: "Human review",
  languageAndStyle: "Clear and practical",
  agentIntent: "Prepare internal drafts",
  humanApprovalIntent: "External and irreversible actions",
};

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

integration("Template production provisioning", () => {
  for (const template of COLLECTIVE_TEMPLATES) {
    it(`persists the full ${template.key} operating preset`, async () => {
      if (!connectionString) throw new Error("DATABASE_URL is required.");
      const guildId = randomUUID();
      const rootId = randomUUID();
      const rootSpaceId = randomUUID();
      const plan = buildTemplateProvisioningPlan(template, answers);
      const guildConstitution = constitution(guildId, rootId);

      await withGuildTransaction(connectionString, guildId, async (connection) => {
        await new GuildPostgresRepository(connection, guildId).bootstrapGuild({
          guildId,
          name: `${template.name} integration Guild`,
          purpose: answers.purpose,
          rootIdentityId: rootId,
          rootDisplayName: "Human Root",
          rootPreferredLocale: "en",
          rootSpaceId,
          rootSpaceName: "Guild",
          constitution: guildConstitution,
          roles: plan.bootstrapRoles,
          chronicleEvent: makeChronicleEvent(
            guildId, rootId, "guild.initialized", "guild", guildId,
            { source: "template-provisioning-integration" },
          ),
        });
        await new GuildCollectiveRepository(connection, guildId).configure({
          templateKey: template.key,
          vocabularyOverrides: {},
          onboardingAnswers: answers,
          actorId: rootId,
          chronicleEvent: makeChronicleEvent(
            guildId, rootId, "collective.configured", "collective", guildId,
            { source: "template-provisioning-integration" },
          ),
        });
        await provisionTemplateDefaults(connection, {
          guildId,
          rootActorId: rootId,
          rootSpaceId,
          locale: "en",
          model: "test/model",
          agentLimits: guildConstitution.agentDefaults,
          plan,
        });

        const state = (await connection.query<{
          knowledge_state: string;
          memory_layer: string;
          memory_governance_state: string | null;
          activity_status: string;
          workflow_count: string;
          onboarding_requirement_count: string;
          agent_count: string;
          access_verifier_count: string;
          federation_runtime_count: string;
        }>(
          `SELECT knowledge_row.state AS knowledge_state,
                  memory.layer AS memory_layer,
                  memory.governance_state AS memory_governance_state,
                  activity.status AS activity_status,
                  (SELECT count(*)::text FROM workflow_definitions workflow
                    WHERE workflow.guild_id = $1 AND workflow.status = 'active') AS workflow_count,
                  (SELECT count(*)::text FROM onboarding_requirements requirement
                    WHERE requirement.guild_id = $1 AND requirement.path_id = $4)
                    AS onboarding_requirement_count,
                  (SELECT count(*)::text FROM identities identity_row
                    WHERE identity_row.guild_id = $1 AND identity_row.kind = 'agent') AS agent_count,
                  (SELECT count(*)::text FROM service_profiles service
                    WHERE service.guild_id = $1 AND service.service_type = 'access-verifier')
                    AS access_verifier_count,
                  (SELECT count(*)::text FROM service_profiles service
                    WHERE service.guild_id = $1 AND service.service_type = 'federation-runtime')
                    AS federation_runtime_count
             FROM knowledge knowledge_row
             JOIN memories memory ON memory.guild_id = knowledge_row.guild_id
                  AND memory.id = knowledge_row.id
             JOIN activities activity ON activity.guild_id = knowledge_row.guild_id
                  AND activity.id = $3
            WHERE knowledge_row.guild_id = $1 AND knowledge_row.id = $2`,
          [guildId, plan.welcomeKnowledge.id, plan.initialActivity.id,
            plan.onboarding.pathId],
        )).rows[0];
        expect(state).toMatchObject({
          knowledge_state: "canonical",
          memory_layer: "canonical",
          memory_governance_state: "canonical",
          activity_status: "proposed",
          workflow_count: String(template.workflows.length),
          onboarding_requirement_count: "3",
          agent_count: template.suggestedAgent ? "1" : "0",
          access_verifier_count: "1",
          federation_runtime_count: "1",
        });
      });
    });
  }
});
