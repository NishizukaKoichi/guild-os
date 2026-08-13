import {
  HUMAN_ONLY_PERMISSIONS,
  type AgentLimits,
  type AppLocale,
  type CollectiveOnboardingAnswers,
  type CollectiveTemplate,
  type CollectiveTemplateKey,
  type OnboardingPath,
  type OnboardingRequirement,
  type Permission,
} from "@guild-os/domain";
import {
  GuildAdministrationRepository,
  GuildCollectiveRepository,
  GuildFabricRepository,
  GuildKnowledgeRepository,
  GuildOperationsRepository,
  type BootstrapRole,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";

const DEFAULT_AGENT_PERMISSIONS: readonly Permission[] = [
  "memory.read",
  "activity.read",
  "activity.create",
  "decision.read",
  "relation.read",
  "conversation.read",
  "conversation.create",
  "connection.read",
  "connection.execute",
  "run.create",
  "agent.read",
  "agent.run",
  "event.read",
];

export interface TemplateProvisioningIds {
  readonly roles: readonly string[];
  readonly agentRole: string | null;
  readonly agent: string | null;
  readonly accessVerifierRole: string;
  readonly accessVerifierService: string;
  readonly federationRuntimeRole: string;
  readonly federationRuntimeService: string;
  readonly workflows: readonly string[];
  readonly welcomeKnowledge: string;
  readonly welcomeKnowledgeReview: string;
  readonly initialActivity: string;
  readonly onboardingPath: string;
  readonly onboardingRequirements: readonly [string, string, string];
}

export interface TemplateProvisioningPlan {
  readonly templateKey: CollectiveTemplateKey;
  readonly bootstrapRoles: readonly BootstrapRole[];
  readonly suggestedAgent: {
    readonly id: string;
    readonly roleId: string;
    readonly displayName: string;
    readonly instructions: string;
    readonly toolIds: readonly string[];
  } | null;
  readonly accessVerifier: {
    readonly id: string;
    readonly roleId: string;
    readonly displayName: string;
  };
  readonly federationRuntime: {
    readonly id: string;
    readonly roleId: string;
    readonly displayName: string;
  };
  readonly workflows: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly nodes: readonly Record<string, string | null>[];
    readonly edges: readonly Record<string, string>[];
    readonly allowedActionKinds: readonly (
      "memory_search" | "activity_draft" | "agent_delegate" | "connection_invoke"
    )[];
    readonly capabilityPermissions: readonly Permission[];
  }[];
  readonly welcomeKnowledge: {
    readonly id: string;
    readonly reviewId: string;
    readonly title: string;
    readonly summary: string;
    readonly body: string;
  };
  readonly initialActivity: {
    readonly id: string;
    readonly type: CollectiveTemplate["activityTypes"][number];
    readonly title: string;
    readonly description: string;
  };
  readonly onboarding: {
    readonly pathId: string;
    readonly name: string;
    readonly description: string;
    readonly requirements: readonly {
      readonly id: string;
      readonly kind: "memory" | "acknowledgement" | "activity";
      readonly resourceId: string;
      readonly title: string;
      readonly instructions: string;
    }[];
  };
}

export interface ProvisionTemplateDefaultsInput {
  readonly guildId: string;
  readonly rootActorId: string;
  readonly rootSpaceId: string;
  readonly locale: AppLocale;
  readonly model: string;
  readonly agentLimits: AgentLimits;
  readonly plan: TemplateProvisioningPlan;
}

function randomIds(template: CollectiveTemplate): TemplateProvisioningIds {
  return {
    roles: template.roles.map(() => crypto.randomUUID()),
    agentRole: template.suggestedAgent ? crypto.randomUUID() : null,
    agent: template.suggestedAgent ? crypto.randomUUID() : null,
    accessVerifierRole: crypto.randomUUID(),
    accessVerifierService: crypto.randomUUID(),
    federationRuntimeRole: crypto.randomUUID(),
    federationRuntimeService: crypto.randomUUID(),
    workflows: template.workflows.map(() => crypto.randomUUID()),
    welcomeKnowledge: crypto.randomUUID(),
    welcomeKnowledgeReview: crypto.randomUUID(),
    initialActivity: crypto.randomUUID(),
    onboardingPath: crypto.randomUUID(),
    onboardingRequirements: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  };
}

function nonBlank(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function agentPermissions(template: CollectiveTemplate): readonly Permission[] {
  const leastPrivileged = template.roles.reduce<readonly Permission[]>((current, role) =>
    current.length === 0 || role.capabilities.length < current.length
      ? role.capabilities
      : current, []);
  const safe = [...new Set([...leastPrivileged, ...DEFAULT_AGENT_PERMISSIONS])]
    .filter((permission): permission is Permission => !HUMAN_ONLY_PERMISSIONS.has(permission));
  return safe;
}

export function buildTemplateProvisioningPlan(
  template: CollectiveTemplate,
  onboardingAnswers: CollectiveOnboardingAnswers,
  ids: TemplateProvisioningIds = randomIds(template),
): TemplateProvisioningPlan {
  if (ids.roles.length !== template.roles.length || ids.workflows.length !== template.workflows.length ||
      ids.onboardingRequirements.length !== 3 ||
      (template.suggestedAgent === null) !== (ids.agent === null || ids.agentRole === null)) {
    throw new Error("Template provisioning IDs do not match the selected Template.");
  }
  const purpose = nonBlank(onboardingAnswers.purpose, "Preserve shared context and coordinate work.");
  const participants = nonBlank(onboardingAnswers.participants, "Humans and governed AI Agents");
  const memoryIntent = nonBlank(onboardingAnswers.memoryIntent, "Shared knowledge and decisions");
  const activityIntent = nonBlank(onboardingAnswers.activityIntent, "Purpose-aligned work");
  const decisionStyle = nonBlank(onboardingAnswers.decisionStyle, "Human-governed review");
  const agentRole = template.suggestedAgent && ids.agentRole ? {
    id: ids.agentRole,
    name: `${template.suggestedAgent} role`,
    permissions: agentPermissions(template),
  } satisfies BootstrapRole : null;
  const activityType = template.activityTypes[0] ?? "task";
  const templateToolIds = [...new Set(template.workflows.flatMap(() =>
    template.key === "agent-collective"
      ? ["memory_search", "activity_draft", "agent_delegate"]
      : ["memory_search", "activity_draft"]))];

  return {
    templateKey: template.key,
    bootstrapRoles: [
      ...template.roles.map((role, index) => ({
        id: ids.roles[index]!,
        name: role.name,
        permissions: role.capabilities,
      })),
      ...(agentRole ? [agentRole] : []),
      {
        id: ids.accessVerifierRole,
        name: "Access verification service",
        permissions: ["data.read"],
      },
      {
        id: ids.federationRuntimeRole,
        name: "Federation runtime service",
        permissions: ["federation.read"],
      },
    ],
    suggestedAgent: template.suggestedAgent && ids.agent && ids.agentRole ? {
      id: ids.agent,
      roleId: ids.agentRole,
      displayName: template.suggestedAgent,
      instructions: [
        `Support this ${template.name} using only currently authorized Guild context.`,
        `Purpose: ${purpose}`,
        "Prefer Canonical Memory, show evidence, create reversible drafts, and stop for required Human approval.",
        "Never acquire permissions, expose Personal data, promote drafts to Canonical Memory, or perform an external write without policy approval.",
      ].join("\n"),
      toolIds: templateToolIds,
    } : null,
    accessVerifier: {
      id: ids.accessVerifierService,
      roleId: ids.accessVerifierRole,
      displayName: "Cloudflare Access verifier",
    },
    federationRuntime: {
      id: ids.federationRuntimeService,
      roleId: ids.federationRuntimeRole,
      displayName: "Guild Federation runtime",
    },
    workflows: template.workflows.map((workflow, index) => ({
      id: ids.workflows[index]!,
      name: workflow.name,
      description: `Template workflow for ${template.name}. Human decision method: ${workflow.decisionMethod ?? decisionStyle}.`,
      nodes: [
        { id: "context", kind: "memory-search", memoryType: workflow.memoryType,
          activityType: null, decisionMethod: null },
        { id: "draft", kind: "activity-draft", memoryType: null,
          activityType: workflow.activityType, decisionMethod: null },
        { id: "review", kind: "human-review", memoryType: null,
          activityType: null, decisionMethod: workflow.decisionMethod },
      ],
      edges: [
        { from: "context", to: "draft" },
        { from: "draft", to: "review" },
      ],
      allowedActionKinds: template.key === "agent-collective"
        ? ["memory_search", "activity_draft", "agent_delegate"]
        : ["memory_search", "activity_draft"],
      capabilityPermissions: template.key === "agent-collective"
        ? ["memory.read", "activity.create", "agent.run"]
        : ["memory.read", "activity.create"],
    })),
    welcomeKnowledge: {
      id: ids.welcomeKnowledge,
      reviewId: ids.welcomeKnowledgeReview,
      title: `Welcome to ${template.name}`,
      summary: `The starting context for this ${template.name}.`,
      body: [
        `Purpose\n${purpose}`,
        `Participants\n${participants}`,
        `What we preserve\n${memoryIntent}`,
        `How we work\n${activityIntent}`,
        `How we decide\n${decisionStyle}`,
        "This record is the initial Canonical Memory. A Human must govern later revisions.",
      ].join("\n\n"),
    },
    initialActivity: {
      id: ids.initialActivity,
      type: activityType,
      title: `${template.labels.startActivity}: ${activityIntent}`.slice(0, 200),
      description: `Use the Guild's authorized Memory and follow ${decisionStyle}.`,
    },
    onboarding: {
      pathId: ids.onboardingPath,
      name: `${template.name} onboarding`,
      description: `Template-aware onboarding for ${participants}.`,
      requirements: [
        {
          id: ids.onboardingRequirements[0],
          kind: "memory",
          resourceId: ids.welcomeKnowledge,
          title: "Read the shared purpose and operating context",
          instructions: "Read the Canonical Memory before beginning work.",
        },
        {
          id: ids.onboardingRequirements[1],
          kind: "acknowledgement",
          resourceId: ids.welcomeKnowledge,
          title: "Confirm the shared operating context",
          instructions: "Confirm that you understand the current purpose, boundaries, and decision method.",
        },
        {
          id: ids.onboardingRequirements[2],
          kind: "activity",
          resourceId: ids.initialActivity,
          title: "Complete the first guided activity",
          instructions: "Use this template-specific activity to learn how work is proposed and reviewed.",
        },
      ],
    },
  };
}

export async function provisionTemplateDefaults(
  connection: GuildTransactionConnection,
  input: ProvisionTemplateDefaultsInput,
): Promise<void> {
  const { guildId, rootActorId, rootSpaceId, locale, plan } = input;
  const knowledge = new GuildKnowledgeRepository(connection, guildId);
  const collective = new GuildCollectiveRepository(connection, guildId);
  const operations = new GuildOperationsRepository(connection, guildId);

  await knowledge.createKnowledge({
    id: plan.welcomeKnowledge.id,
    spaceId: rootSpaceId,
    ownerIdentityId: rootActorId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    reviewDueAt: null,
    title: { [locale]: plan.welcomeKnowledge.title },
    summary: { [locale]: plan.welcomeKnowledge.summary },
    body: { [locale]: plan.welcomeKnowledge.body },
    sourceIds: [],
    changeNote: "Provisioned from the selected Collective Template.",
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "knowledge.created", "knowledge", plan.welcomeKnowledge.id,
      { templateKey: plan.templateKey, source: "template-provisioning" },
    ),
  });
  await knowledge.propose({
    knowledgeId: plan.welcomeKnowledge.id,
    expectedVersion: 1,
    actorIdentityId: rootActorId,
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "knowledge.proposed", "knowledge", plan.welcomeKnowledge.id,
      { templateKey: plan.templateKey, source: "template-provisioning" },
    ),
  });
  await knowledge.review({
    reviewId: plan.welcomeKnowledge.reviewId,
    knowledgeId: plan.welcomeKnowledge.id,
    expectedVersion: 1,
    actorIdentityId: rootActorId,
    verdict: "approve",
    reason: "Approve the purchaser-selected Template's initial operating context.",
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "knowledge.canonicalized", "knowledge", plan.welcomeKnowledge.id,
      { templateKey: plan.templateKey, source: "template-provisioning" },
    ),
  });

  await collective.createActivity({
    id: plan.initialActivity.id,
    actorId: rootActorId,
    parentActivityId: null,
    spaceId: rootSpaceId,
    ownerActorId: rootActorId,
    assigneeActorId: null,
    type: plan.initialActivity.type,
    title: plan.initialActivity.title,
    description: plan.initialActivity.description,
    status: "proposed",
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    sourceIds: [plan.welcomeKnowledge.id],
    startsAt: null,
    dueAt: null,
    position: 0,
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "activity.created", "activity", plan.initialActivity.id,
      { templateKey: plan.templateKey, onboardingBlueprint: true, source: "template-provisioning" },
    ),
  });

  for (const workflow of plan.workflows) {
    await operations.createWorkflowDefinition({
      id: workflow.id,
      actorId: rootActorId,
      ownerActorId: rootActorId,
      spaceId: rootSpaceId,
      name: workflow.name,
      description: workflow.description,
      status: "active",
      nodes: workflow.nodes,
      edges: workflow.edges,
      allowedActionKinds: workflow.allowedActionKinds,
      capabilityPermissions: workflow.capabilityPermissions,
      visibility: "space",
      classification: "internal",
      allowedActorIds: [],
      maxConcurrentRuns: 1,
      chronicleEvent: makeChronicleEvent(
        guildId, rootActorId, "workflow.created", "workflow_definition", workflow.id,
        { templateKey: plan.templateKey, source: "template-provisioning" },
      ),
    });
  }

  const now = new Date().toISOString();
  const path: OnboardingPath = {
    id: plan.onboarding.pathId,
    guildId,
    spaceId: rootSpaceId,
    templateKey: plan.templateKey,
    name: plan.onboarding.name,
    description: plan.onboarding.description,
    status: "active",
    createdByActorId: rootActorId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const requirements: readonly OnboardingRequirement[] = plan.onboarding.requirements.map(
    (requirement, position) => ({
      ...requirement,
      guildId,
      pathId: path.id,
      required: true,
      position,
      createdAt: now,
    }),
  );
  await new GuildFabricRepository(connection, guildId).createOnboardingPath(
    path,
    requirements,
    makeChronicleEvent(
      guildId, rootActorId, "onboarding.path.created", "onboarding_path", path.id,
      { templateKey: plan.templateKey, requirementCount: requirements.length,
        source: "template-provisioning" },
    ),
  );

  await new GuildAdministrationRepository(connection, guildId).createService({
    identityId: plan.accessVerifier.id,
    displayName: plan.accessVerifier.displayName,
    clearance: "restricted",
    roleId: plan.accessVerifier.roleId,
    spaceId: null,
    actorIdentityId: rootActorId,
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "service.created", "identity", plan.accessVerifier.id,
      { serviceType: "access-verifier", source: "template-provisioning" },
    ),
  });
  const taggedVerifier = await connection.query(
    `UPDATE service_profiles
        SET service_type = 'access-verifier',
            description = 'Verifies recent purchaser-owned Cloudflare Access sessions for governed high-risk operations.',
            updated_at = now()
      WHERE guild_id = $1 AND actor_id = $2 AND service_type = 'service'`,
    [guildId, plan.accessVerifier.id],
  );
  if (taggedVerifier.rowCount !== 1) {
    throw new Error("The Access verification Service profile could not be initialized.");
  }

  await new GuildAdministrationRepository(connection, guildId).createService({
    identityId: plan.federationRuntime.id,
    displayName: plan.federationRuntime.displayName,
    clearance: "restricted",
    roleId: plan.federationRuntime.roleId,
    spaceId: null,
    actorIdentityId: rootActorId,
    chronicleEvent: makeChronicleEvent(
      guildId, rootActorId, "service.created", "identity", plan.federationRuntime.id,
      { serviceType: "federation-runtime", source: "template-provisioning" },
    ),
  });
  const taggedFederationRuntime = await connection.query(
    `UPDATE service_profiles
        SET service_type = 'federation-runtime',
            description = 'Runs signed, leased Federation transport inside the purchaser-owned deployment.',
            updated_at = now()
      WHERE guild_id = $1 AND actor_id = $2 AND service_type = 'service'`,
    [guildId, plan.federationRuntime.id],
  );
  if (taggedFederationRuntime.rowCount !== 1) {
    throw new Error("The Federation runtime Service profile could not be initialized.");
  }

  if (plan.suggestedAgent) {
    await new GuildAdministrationRepository(connection, guildId).createAgent({
      identityId: plan.suggestedAgent.id,
      displayName: plan.suggestedAgent.displayName,
      clearance: "internal",
      roleId: plan.suggestedAgent.roleId,
      spaceId: rootSpaceId,
      instructions: plan.suggestedAgent.instructions,
      model: input.model,
      toolIds: plan.suggestedAgent.toolIds,
      limits: input.agentLimits,
      actorIdentityId: rootActorId,
      chronicleEvent: makeChronicleEvent(
        guildId, rootActorId, "agent.created", "identity", plan.suggestedAgent.id,
        { templateKey: plan.templateKey, source: "template-provisioning" },
      ),
    });
  }
}
