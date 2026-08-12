import type {
  ClaimInvitationInput,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  UpdateConstitutionRequest,
  UiAccessBootstrapState,
  UiBootstrapState,
  UiInitializationBootstrapState,
  UiMemberBootstrapState,
  UiAnnouncement,
  UiAgentRunDetail,
  UiChronicleEvent,
  UiConversation,
  UiConversationMessage,
  UiConversationSubject,
  UiCollectiveContext,
  UiDirectory,
  UiDecisionDetail,
  UiActivity,
  UiKnowledgeDetail,
  UiKnowledgeFile,
  UiInboxNotification,
  UiMemory,
  UiGoal,
  UiProject,
  UiQuest,
  UiStep,
} from "../src/management-types";
import {
  PERMISSIONS,
  ROOT_ONLY_PERMISSIONS,
  assertGoalStatus,
  assertGoalTransition,
  assertProjectStatus,
  assertProjectTransition,
  assertQuestStatus,
  assertQuestTransition,
  assertStepStatus,
  assertStepTransition,
  assertDecisionContent,
  assertDecisionMethod,
  assertDecisionOptions,
  assertDecisionReview,
  assertDecisionTransition,
  assertAnnouncementContent,
  assertAnnouncementTransition,
  assertActivityText,
  assertActivityTransition,
  assertMemoryContent,
  collectiveTemplate,
  COLLECTIVE_TEMPLATES,
  validateConstitution,
} from "@guild-os/domain";

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";
const rootId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b";
const memberId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9c";
const agentId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9d";
const serviceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a7d";
const guildActorId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a7e";
const successorId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a8d";
const unknownId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a8c";
const adminRoleId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9e";
const memberRoleId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9f";
const rootSpaceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa0";
const researchSpaceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa1";
const knowledgeId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa3";
const goalId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab0";
const projectId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab1";
const questId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab2";
const completedStepId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab3";
const pendingStepId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ab4";
const decisionId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ac0";
const decisionOptionId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ac1";
const alternativeOptionId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ac2";
const announcementId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad0";
const inboxApprovalId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad1";
const inboxKnowledgeId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad2";
const connectorId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad3";
const agentRunId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad4";
const agentApprovalId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad5";
const recoveryCodeSetId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555ad6";
const knowledgeConversationId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555b01";
const questConversationId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555b02";
const decisionConversationId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555b03";
const directMemoryId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555b10";
const directActivityId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555b11";

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function token(): string {
  return "DemoOnlyTokenForVisualQualityReview1234567890A".slice(0, 43);
}

export function createDevelopmentApi(mode: string): GuildUiApi {
  let bootstrap: UiMemberBootstrapState = {
    guildId,
    guildName: "Commonweal Research Guild",
    guildPurpose: "Preserve shared knowledge and coordinate governed work between people and agents.",
    accountId: rootId,
    screen: "member",
    initialized: true,
    canInitialize: false,
    identityExists: true,
    membershipState: "active",
    rootOwner: true,
    rootOwnerIdentityId: rootId,
    rootOwnerDisplayName: "Avery Morgan",
    preferredLocale: "en",
    constitution: {
      version: 1,
      level2ApprovalQuorum: 1,
      level3ApprovalQuorum: 2,
      dataRetentionDays: 365,
      agentDefaults: {
        currency: "USD",
        maxBudgetMinor: 1000,
        maxTokens: 100_000,
        maxDurationSeconds: 900,
        maxSteps: 20,
        maxRetries: 2,
        maxDelegationDepth: 1,
      },
      updatedByIdentityId: rootId,
      updatedAt: "2026-08-12T02:00:00.000Z",
    },
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
      maxTokens: 100_000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
    rootOwnershipTransfer: null,
    breakGlass: {
      available: true,
      canRecover: false,
      version: 1,
      currentCodeSetId: recoveryCodeSetId,
      generation: 1,
      outgoingRoleId: adminRoleId,
      outgoingRoleName: "Admin",
      reason: "Maintain independent offline recovery custody.",
      expiresAt: "2027-08-12T02:00:00.000Z",
      createdAt: "2026-08-12T02:00:00.000Z",
      remainingCodeCount: 10,
    },
  };
  let restrictedBootstrap: UiAccessBootstrapState | UiInitializationBootstrapState | null = null;
  if (mode === "uninvited") {
    bootstrap = { ...bootstrap, accountId: unknownId, rootOwner: false };
  } else if (mode === "suspended") {
    bootstrap = { ...bootstrap, accountId: memberId, rootOwner: false };
  } else if (mode === "member") {
    bootstrap = { ...bootstrap, accountId: memberId, membershipState: "preboarding", rootOwner: false };
  } else if (mode === "recovery-human") {
    bootstrap = {
      ...bootstrap,
      accountId: successorId,
      membershipState: "active",
      rootOwner: false,
    };
  } else if (mode === "transfer-target") {
    bootstrap = {
      ...bootstrap,
      accountId: successorId,
      membershipState: "active",
      rootOwner: false,
      rootOwnershipTransfer: {
        id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555a8e",
        fromIdentityId: rootId,
        toIdentityId: successorId,
        outgoingRoleId: adminRoleId,
        state: "pending",
        reason: "Transfer operational stewardship to the incoming Guild lead.",
        version: 1,
        expiresAt: "2026-08-19T02:00:00.000Z",
        resolvedAt: null,
        createdAt: "2026-08-12T02:00:00.000Z",
        updatedAt: "2026-08-12T02:00:00.000Z",
        fromDisplayName: "Avery Morgan",
        toDisplayName: "Noah Chen",
        outgoingRoleName: "Admin",
      },
    };
  }
  if (!bootstrap.rootOwner) {
    bootstrap = {
      ...bootstrap,
      breakGlass: {
        ...bootstrap.breakGlass,
        canRecover: mode === "uninvited" || mode === "recovery-human",
        currentCodeSetId: null,
        generation: null,
        outgoingRoleId: null,
        outgoingRoleName: null,
        reason: null,
        expiresAt: null,
        createdAt: null,
        remainingCodeCount: null,
      },
    };
  }
  if (mode === "uninvited" || mode === "suspended") {
    restrictedBootstrap = {
      screen: "access",
      initialized: true,
      canInitialize: false,
      guildId: bootstrap.guildId,
      guildName: bootstrap.guildName,
      guildPurpose: bootstrap.guildPurpose,
      accountId: bootstrap.accountId,
      identityExists: mode === "suspended",
      membershipState: mode === "suspended" ? "suspended" : null,
      preferredLocale: bootstrap.preferredLocale,
      breakGlass: bootstrap.breakGlass,
    };
  } else if (mode === "uninitialized-admin" || mode === "uninitialized-member") {
    restrictedBootstrap = {
      screen: "initialize",
      initialized: false,
      canInitialize: mode === "uninitialized-admin",
      guildId: bootstrap.guildId,
      guildName: bootstrap.guildName,
      guildPurpose: bootstrap.guildPurpose,
      accountId: mode === "uninitialized-admin" ? rootId : unknownId,
      identityExists: false,
      membershipState: null,
      preferredLocale: "en",
    };
  }

  let directory: UiDirectory = {
    identities: [
      {
        id: rootId,
        kind: "human",
        displayName: "Avery Morgan",
        status: "active",
        preferredLocale: "en",
        membershipState: "active",
        clearance: "restricted",
        joinedAt: "2026-08-10T02:00:00.000Z",
        departedAt: null,
      },
      {
        id: memberId,
        kind: "human",
        displayName: "Mina Park",
        status: "active",
        preferredLocale: "ja",
        membershipState: "preboarding",
        clearance: "internal",
        joinedAt: null,
        departedAt: null,
      },
      {
        id: agentId,
        kind: "agent",
        displayName: "Research Synthesizer",
        status: "active",
        preferredLocale: "en",
        membershipState: "active",
        clearance: "confidential",
        joinedAt: "2026-08-11T04:30:00.000Z",
        departedAt: null,
      },
      {
        id: serviceId,
        kind: "service",
        displayName: "Open Archive Bridge",
        status: "active",
        preferredLocale: "en",
        membershipState: "active",
        clearance: "internal",
        joinedAt: "2026-08-11T05:00:00.000Z",
        departedAt: null,
      },
      {
        id: guildActorId,
        kind: "guild",
        displayName: "Fictional Coastal Observatory",
        status: "active",
        preferredLocale: "en",
        membershipState: "active",
        clearance: "internal",
        joinedAt: "2026-08-11T05:30:00.000Z",
        departedAt: null,
      },
      {
        id: successorId,
        kind: "human",
        displayName: "Noah Chen",
        status: "active",
        preferredLocale: "en",
        membershipState: "active",
        clearance: "restricted",
        joinedAt: "2026-08-09T05:00:00.000Z",
        departedAt: null,
      },
    ],
    roles: [
      {
        id: adminRoleId,
        name: "Admin",
        system: true,
        permissions: ["guild.read", "membership.manage", "work.read", "work.create", "work.assign"],
      },
      {
        id: memberRoleId,
        name: "Member",
        system: true,
        permissions: ["guild.read", "space.read", "work.read"],
      },
    ],
    roleBindings: [
      { id: "binding-root", identityId: rootId, roleId: adminRoleId, spaceId: null },
      { id: "binding-member", identityId: memberId, roleId: memberRoleId, spaceId: researchSpaceId },
      { id: "binding-agent", identityId: agentId, roleId: memberRoleId, spaceId: researchSpaceId },
      { id: "binding-service", identityId: serviceId, roleId: memberRoleId, spaceId: researchSpaceId },
      { id: "binding-guild", identityId: guildActorId, roleId: memberRoleId, spaceId: researchSpaceId },
      { id: "binding-successor", identityId: successorId, roleId: memberRoleId, spaceId: null },
    ],
    agentProfiles: [{
      identityId: agentId,
      instructions: "Synthesize research only from Knowledge visible in the assigned Space.",
      model: "workers-ai/default",
      toolIds: ["knowledge-search", "https_webhook"],
      limits: bootstrap.agentDefaults,
      status: "active",
    }],
    spaces: [
      { id: rootSpaceId, parentSpaceId: null, name: "Guild", status: "active" },
      { id: researchSpaceId, parentSpaceId: rootSpaceId, name: "Research", status: "active" },
    ],
    invitations: [{
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa2",
      inviteeLabel: "New archivist",
      roleId: memberRoleId,
      spaceId: researchSpaceId,
      initialMembershipState: "preboarding",
      state: "pending",
      expiresAt: "2026-08-20T02:00:00.000Z",
      createdByIdentityId: rootId,
      acceptedByIdentityId: null,
      acceptedAt: null,
      createdAt: "2026-08-12T02:00:00.000Z",
    }],
    capabilities: {
      manageMemberships: mode === "root",
      manageRoles: mode === "root",
      manageSpaces: mode === "root",
      manageIdentities: mode === "root",
      manageAgents: mode === "root",
      stopAgents: mode === "root",
    },
    grantablePermissions: mode === "root"
      ? PERMISSIONS.filter((permission) => !ROOT_ONLY_PERMISSIONS.has(permission))
      : [],
    nextIdentityCursor: null,
    nextInvitationCursor: null,
  };

  const initialTemplate = collectiveTemplate("research");
  let collective: UiCollectiveContext = {
    template: initialTemplate,
    templates: COLLECTIVE_TEMPLATES,
    labels: initialTemplate.labels,
    vocabularyOverrides: {},
    onboardingAnswers: {
      purpose: "Preserve evidence and turn inquiry into shared, reviewable memory.",
      participants: "Researchers, research agents, and external research services.",
      memoryIntent: "Research notes, data, decisions, failures, and reusable methods.",
      activityIntent: "Studies, experiments, investigations, and peer review.",
      decisionStyle: "Evidence review followed by accountable human approval.",
    },
    templateVersion: 1,
    spaces: directory.spaces.map((space) => ({
      id: space.id,
      parentSpaceId: space.parentSpaceId,
      name: space.name,
      vocabularyProfileKey: space.id === researchSpaceId ? "research" : null,
      labels: initialTemplate.labels,
      canConfigure: mode === "root",
    })),
    canConfigure: mode === "root",
    canConfigureSpaces: mode === "root",
  };

  const fullKnowledgeCapabilities = {
    edit: false,
    propose: false,
    review: false,
    startRevision: mode === "root",
    archive: false,
    deprecate: mode === "root",
    uploadFile: false,
    deleteFile: false,
  };
  let knowledge: UiKnowledgeDetail[] = [{
    id: knowledgeId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    state: "canonical",
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    currentVersion: 2,
    canonicalVersion: 2,
    title: { en: "Research intake procedure", ja: "調査受付手順" },
    summary: {
      en: "How the Guild records and verifies a new research request.",
      ja: "Guildが新しい調査依頼を記録し検証する方法です。",
    },
    sourceIds: [],
    createdByIdentityId: rootId,
    reviewDueAt: "2027-02-01T00:00:00.000Z",
    createdAt: "2026-08-10T02:00:00.000Z",
    updatedAt: "2026-08-12T01:30:00.000Z",
    capabilities: fullKnowledgeCapabilities,
    acknowledged: false,
    versions: [{
      version: 2,
      state: "canonical",
      title: { en: "Research intake procedure", ja: "調査受付手順" },
      summary: {
        en: "How the Guild records and verifies a new research request.",
        ja: "Guildが新しい調査依頼を記録し検証する方法です。",
      },
      body: {
        en: "Record the request in the Research Space. Confirm its owner, expected outcome, classification, and source before assigning work.",
        ja: "依頼をResearch Spaceへ記録し、仕事を割り当てる前に責任者、期待する成果、機密区分、出典を確認します。",
      },
      sourceIds: [],
      createdByIdentityId: rootId,
      createdAt: "2026-08-12T01:30:00.000Z",
    }, {
      version: 1,
      state: "deprecated",
      title: { en: "Research request notes", ja: "調査依頼メモ" },
      summary: { en: "Initial draft.", ja: "初版です。" },
      body: { en: "Write down the request.", ja: "依頼を書き留めます。" },
      sourceIds: [],
      createdByIdentityId: rootId,
      createdAt: "2026-08-10T02:00:00.000Z",
    }],
    reviews: [{
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa4",
      version: 2,
      reviewerIdentityId: rootId,
      verdict: "approve",
      reason: "The scope and verification steps are explicit.",
      createdAt: "2026-08-12T01:30:00.000Z",
    }],
    files: [],
  }];
  let directMemories: UiMemory[] = [{
    id: directMemoryId,
    spaceId: researchSpaceId,
    ownerActorId: rootId,
    createdByActorId: memberId,
    type: "research",
    status: "active",
    workflow: null,
    governanceState: null,
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    currentVersion: 1,
    confidence: 0.82,
    sourceIds: [],
    title: {
      en: "Signals from the fictional coastal habitat study",
      ja: "架空の沿岸生息地調査から得た兆候",
      "zh-CN": "虚构沿海栖息地研究的初步信号",
    },
    summary: {
      en: "A working observation awaiting peer review and promotion into Canonical Memory.",
      ja: "査読とCanonical Memoryへの昇格を待つ作業中の観察記録です。",
      "zh-CN": "等待同行评审并晋升为规范记忆的工作观察记录。",
    },
    body: {
      en: "The fictional sample suggests seasonal variation. The team must validate the method and source set before treating the observation as established knowledge.",
      ja: "架空のサンプルは季節変動を示唆しています。確立した知識として扱う前に、調査方法と出典一式を検証する必要があります。",
      "zh-CN": "虚构样本显示可能存在季节变化。在将其视为既定知识前，团队必须验证研究方法和来源。",
    },
    createdAt: "2026-08-11T08:00:00.000Z",
    updatedAt: "2026-08-12T01:15:00.000Z",
    capabilities: {
      edit: mode === "root",
      archive: mode === "root",
      governed: false,
    },
  }];
  const fileBodies = new Map<string, Blob>();
  const workCapabilities = {
    changeStatus: mode === "root",
    assign: mode === "root",
    addChild: mode === "root",
  };
  let goals: UiGoal[] = [{
    id: goalId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    title: "Build a trustworthy research memory",
    description: "Turn repeatable research practice into governed, cited Guild Knowledge.",
    status: "active",
    creatorIdentityId: rootId,
    sourceIds: [knowledgeId],
    targetAt: "2026-09-30T00:00:00.000Z",
    version: 1,
    createdAt: "2026-08-10T03:00:00.000Z",
    updatedAt: "2026-08-12T02:00:00.000Z",
    capabilities: workCapabilities,
  }];
  let projects: UiProject[] = [{
    id: projectId,
    goalId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    title: "Standardize research intake",
    description: "Validate the intake procedure with a complete Human and Agent workflow.",
    status: "active",
    creatorIdentityId: rootId,
    sourceIds: [knowledgeId],
    dueAt: "2026-08-31T00:00:00.000Z",
    version: 1,
    createdAt: "2026-08-10T03:15:00.000Z",
    updatedAt: "2026-08-12T02:05:00.000Z",
    capabilities: workCapabilities,
  }];
  let quests: UiQuest[] = [{
    id: questId,
    projectId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    assigneeIdentityId: agentId,
    title: "Verify the onboarding research request",
    description: "Check the fictional request against the canonical intake procedure and prepare a reviewable result.",
    status: "in_progress",
    creatorIdentityId: rootId,
    sourceIds: [knowledgeId],
    dueAt: "2026-08-18T05:00:00.000Z",
    version: 1,
    createdAt: "2026-08-11T01:00:00.000Z",
    updatedAt: "2026-08-12T02:10:00.000Z",
    capabilities: workCapabilities,
  }];
  let steps: UiStep[] = [{
    id: completedStepId,
    questId,
    assigneeIdentityId: agentId,
    creatorIdentityId: rootId,
    title: "Read the canonical procedure",
    description: "Use only the current canonical Knowledge version.",
    status: "completed",
    position: 0,
    version: 1,
    createdAt: "2026-08-11T01:05:00.000Z",
    updatedAt: "2026-08-12T01:00:00.000Z",
    capabilities: workCapabilities,
  }, {
    id: pendingStepId,
    questId,
    assigneeIdentityId: agentId,
    creatorIdentityId: rootId,
    title: "Submit findings for human review",
    description: "Include citations and mark every unsupported conclusion as inference.",
    status: "pending",
    position: 1,
    version: 1,
    createdAt: "2026-08-11T01:06:00.000Z",
    updatedAt: "2026-08-11T01:06:00.000Z",
    capabilities: workCapabilities,
  }];
  let directActivities: UiActivity[] = [{
    id: directActivityId,
    parentActivityId: null,
    spaceId: researchSpaceId,
    ownerActorId: rootId,
    creatorActorId: memberId,
    assigneeActorId: agentId,
    type: "study",
    title: "Map evidence gaps in the fictional habitat study",
    description: "Collect unanswered questions and connect each one to a visible source or an explicit inference.",
    status: "active",
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    sourceIds: [directMemoryId],
    startsAt: "2026-08-12T03:00:00.000Z",
    dueAt: "2026-08-22T03:00:00.000Z",
    position: 0,
    version: 1,
    compatibilitySourceType: null,
    createdAt: "2026-08-12T02:50:00.000Z",
    updatedAt: "2026-08-12T03:00:00.000Z",
    capabilities: workCapabilities,
  }, {
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555b12",
    parentActivityId: directActivityId,
    spaceId: researchSpaceId,
    ownerActorId: rootId,
    creatorActorId: rootId,
    assigneeActorId: memberId,
    type: "experiment",
    title: "Validate the fictional sampling method",
    description: "Run a repeatability check before promoting the observation into governed knowledge.",
    status: "planned",
    visibility: "space",
    classification: "internal",
    allowedActorIds: [],
    sourceIds: [directMemoryId],
    startsAt: null,
    dueAt: "2026-08-19T03:00:00.000Z",
    position: 0,
    version: 1,
    compatibilitySourceType: null,
    createdAt: "2026-08-12T03:05:00.000Z",
    updatedAt: "2026-08-12T03:05:00.000Z",
    capabilities: workCapabilities,
  }];
  const decisionCapabilities = (status: UiDecisionDetail["decision"]["status"], reviewed = false) => ({
    edit: mode === "root" && status === "draft",
    propose: mode === "root" && status === "draft",
    review: mode === "root" && status === "proposed" && !reviewed,
    supersede: mode === "root" && status === "approved",
  });
  let decisions: UiDecisionDetail[] = [{
    decision: {
      id: decisionId,
      spaceId: researchSpaceId,
      proposerIdentityId: memberId,
      ownerIdentityId: memberId,
      method: "review",
      title: "Adopt a citation requirement for Agent research",
      description: "Decide whether every Agent research result must cite Canonical Knowledge.",
      rationale: "Citations let reviewers distinguish sourced findings from inference.",
      status: "proposed",
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      sourceIds: [knowledgeId],
      requiredApprovals: 1,
      approvalCount: 0,
      selectedOptionId: null,
      reviewAt: "2026-08-20T00:00:00.000Z",
      decidedAt: null,
      supersededByDecisionId: null,
      version: 2,
      createdAt: "2026-08-11T02:00:00.000Z",
      updatedAt: "2026-08-12T02:20:00.000Z",
      capabilities: decisionCapabilities("proposed"),
    },
    options: [{
      id: decisionOptionId,
      label: "Require citations",
      description: "Every factual Agent finding must reference visible Canonical Knowledge.",
      position: 0,
      selected: false,
    }, {
      id: alternativeOptionId,
      label: "Keep citations optional",
      description: "Reviewers decide when a citation is necessary.",
      position: 1,
      selected: false,
    }],
    approvals: [],
  }];
  const announcementCapabilities = (status: UiAnnouncement["status"]) => ({
    edit: mode === "root" && status === "draft",
    publish: mode === "root" && status === "draft",
    archive: mode === "root" && status !== "archived",
  });
  let announcements: UiAnnouncement[] = [{
    id: announcementId,
    spaceId: researchSpaceId,
    targetRoleId: memberRoleId,
    ownerIdentityId: rootId,
    creatorIdentityId: rootId,
    title: "Research review window opens Monday",
    body: "Submit active research notes by Friday so the review group can verify sources before the Monday session.",
    status: "published",
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    publishedAt: "2026-08-12T02:30:00.000Z",
    expiresAt: "2026-08-31T23:59:00.000Z",
    version: 2,
    createdAt: "2026-08-12T02:25:00.000Z",
    updatedAt: "2026-08-12T02:30:00.000Z",
    capabilities: announcementCapabilities("published"),
  }];
  let inbox: UiInboxNotification[] = [{
    id: inboxApprovalId,
    spaceId: researchSpaceId,
    ownerIdentityId: memberId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    recipientIdentityId: rootId,
    kind: "approval",
    title: "Adopt a citation requirement for Agent research",
    body: "A Decision is waiting for Human review.",
    resourceType: "decision",
    resourceId: decisionId,
    readAt: null,
    createdAt: "2026-08-12T02:20:00.000Z",
  }, {
    id: inboxKnowledgeId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    recipientIdentityId: rootId,
    kind: "knowledge_update",
    title: "Research intake procedure",
    body: "Version 2 is now Canonical.",
    resourceType: "knowledge",
    resourceId: knowledgeId,
    readAt: "2026-08-12T02:00:00.000Z",
    createdAt: "2026-08-12T01:30:00.000Z",
  }];
  let chronicleSequence = 1003;
  let chronicleEvents: UiChronicleEvent[] = [{
    sequence: "1003",
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ae3",
    spaceId: researchSpaceId,
    ownerIdentityId: memberId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: rootId,
    actorDisplayName: "Avery Morgan",
    action: "decision.proposed",
    subjectType: "decision",
    subjectId: decisionId,
    correlationId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555af3",
    occurredAt: "2026-08-12T02:20:00.000Z",
    details: { requiredApprovals: 1, source: "guild-ui" },
  }, {
    sequence: "1002",
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ae2",
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: rootId,
    actorDisplayName: "Avery Morgan",
    action: "knowledge.canonical",
    subjectType: "knowledge",
    subjectId: knowledgeId,
    correlationId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555af2",
    occurredAt: "2026-08-12T01:30:00.000Z",
    details: { version: 2, verdict: "approve", source: "guild-ui" },
  }, {
    sequence: "1001",
    id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555ae1",
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    actorIdentityId: agentId,
    actorDisplayName: "Research Synthesizer",
    action: "quest.status.changed",
    subjectType: "quest",
    subjectId: questId,
    correlationId: "018f1f3e-7b5a-7d40-8f43-4fe1dc555af1",
    occurredAt: "2026-08-12T01:00:00.000Z",
    details: { from: "ready", to: "in_progress", source: "agent-run" },
  }];
  const agentCapabilities = (status: UiAgentRunDetail["status"]) => ({
    review: mode === "root" && status === "awaiting_approval",
    stop: mode === "root" && ["planning", "awaiting_approval", "running"].includes(status),
  });
  let agentRuns: UiAgentRunDetail[] = [{
    id: agentRunId,
    spaceId: researchSpaceId,
    ownerIdentityId: rootId,
    visibility: "space",
    classification: "internal",
    allowedIdentityIds: [],
    agentIdentityId: agentId,
    requesterIdentityId: rootId,
    connectorId,
    questId,
    riskLevel: 2,
    status: "awaiting_approval",
    source: "guild-ui",
    plan: {
      objective: "Publish the verified research completion event",
      expectedOutcome: "The fictional downstream system receives one signed completion event.",
      steps: ["Recheck current authority", "Send one signed webhook"],
      connectorId,
      questId,
      action: {
        kind: "https_webhook",
        eventType: "guild.quest.completed",
        payload: { questId, result: "verified" },
      },
      estimatedUsage: {
        budgetMinor: 0,
        tokens: 0,
        durationSeconds: 15,
        steps: 2,
        retries: 0,
        delegationDepth: 0,
      },
    },
    result: null,
    errorMessage: null,
    limits: bootstrap.agentDefaults,
    usage: {
      budgetMinor: 0,
      tokens: 0,
      durationSeconds: 0,
      steps: 0,
      retries: 0,
      delegationDepth: 0,
    },
    workflowInstanceId: `agent-run-${agentRunId}`,
    idempotencyKey: `demo-agent-action:${agentRunId}`,
    requestHash: "a".repeat(64),
    estimatedBudgetMinor: 0,
    killRequestedAt: null,
    startedAt: null,
    finishedAt: null,
    version: 1,
    createdAt: "2026-08-12T02:35:00.000Z",
    updatedAt: "2026-08-12T02:35:00.000Z",
    agentDisplayName: "Research Synthesizer",
    requesterDisplayName: "Avery Morgan",
    connectorName: "Approved operations webhook",
    approval: {
      id: agentApprovalId,
      guildId,
      agentRunId,
      riskLevel: 2,
      actionKind: "https_webhook.post",
      requiredApprovals: 1,
      approvalCount: 0,
      reauthenticationRequired: false,
      status: "pending",
      expiresAt: "2026-08-19T02:35:00.000Z",
      createdAt: "2026-08-12T02:35:00.000Z",
      updatedAt: "2026-08-12T02:35:00.000Z",
    },
    capabilities: agentCapabilities("awaiting_approval"),
    votes: [],
  }];

  type DemoConversation = {
    conversation: UiConversation;
    messages: UiConversationMessage[];
  };
  type DemoBoundary = Pick<
    UiConversationSubject,
    "spaceId" | "ownerIdentityId" | "visibility" | "classification"
  > & { allowedIdentityIds?: readonly string[] };
  let conversations: DemoConversation[] = [{
    conversation: {
      id: knowledgeConversationId,
      subjectType: "knowledge",
      subjectId: knowledgeId,
      spaceId: researchSpaceId,
      ownerIdentityId: rootId,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      status: "open",
      version: 1,
      createdAt: "2026-08-12T02:40:00.000Z",
      updatedAt: "2026-08-12T02:42:00.000Z",
    },
    messages: [{
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555b11",
      conversationId: knowledgeConversationId,
      authorIdentityId: rootId,
      authorDisplayName: "Avery Morgan",
      body: "Please confirm that the ownership check is clear before the next review.",
      mentionedIdentityIds: [memberId],
      state: "active",
      version: 1,
      redactedByIdentityId: null,
      redactedAt: null,
      redactionReason: null,
      createdAt: "2026-08-12T02:42:00.000Z",
    }],
  }, {
    conversation: {
      id: questConversationId,
      subjectType: "quest",
      subjectId: questId,
      spaceId: researchSpaceId,
      ownerIdentityId: rootId,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      status: "open",
      version: 1,
      createdAt: "2026-08-12T02:43:00.000Z",
      updatedAt: "2026-08-12T02:44:00.000Z",
    },
    messages: [{
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555b12",
      conversationId: questConversationId,
      authorIdentityId: agentId,
      authorDisplayName: "Research Synthesizer",
      body: "Canonical Knowledge was checked. The citation review remains for a Human.",
      mentionedIdentityIds: [],
      state: "active",
      version: 1,
      redactedByIdentityId: null,
      redactedAt: null,
      redactionReason: null,
      createdAt: "2026-08-12T02:44:00.000Z",
    }],
  }, {
    conversation: {
      id: decisionConversationId,
      subjectType: "decision",
      subjectId: decisionId,
      spaceId: researchSpaceId,
      ownerIdentityId: memberId,
      visibility: "space",
      classification: "internal",
      allowedIdentityIds: [],
      status: "open",
      version: 1,
      createdAt: "2026-08-12T02:45:00.000Z",
      updatedAt: "2026-08-12T02:46:00.000Z",
    },
    messages: [{
      id: "018f1f3e-7b5a-7d40-8f43-4fe1dc555b13",
      conversationId: decisionConversationId,
      authorIdentityId: memberId,
      authorDisplayName: "Mina Park",
      body: "The proposal keeps inference visible instead of presenting it as evidence.",
      mentionedIdentityIds: [rootId],
      state: "active",
      version: 1,
      redactedByIdentityId: null,
      redactedAt: null,
      redactionReason: null,
      createdAt: "2026-08-12T02:46:00.000Z",
    }],
  }];

  function conversationSubject(
    subjectType: UiConversationSubject["subjectType"],
    subjectId: string,
  ): UiConversationSubject {
    let resource: DemoBoundary | undefined;
    let readPermission: UiConversationSubject["readPermission"];
    if (subjectType === "knowledge") {
      resource = knowledge.find((item) => item.id === subjectId);
      readPermission = "knowledge.read";
    } else if (subjectType === "goal") {
      resource = goals.find((item) => item.id === subjectId);
      readPermission = "work.read";
    } else if (subjectType === "project") {
      resource = projects.find((item) => item.id === subjectId);
      readPermission = "work.read";
    } else if (subjectType === "quest") {
      resource = quests.find((item) => item.id === subjectId);
      readPermission = "work.read";
    } else if (subjectType === "step") {
      const step = steps.find((item) => item.id === subjectId);
      resource = step ? quests.find((item) => item.id === step.questId) : undefined;
      readPermission = "work.read";
    } else if (subjectType === "decision") {
      resource = decisions.find((item) => item.decision.id === subjectId)?.decision;
      readPermission = "decision.read";
    } else if (subjectType === "announcement") {
      resource = announcements.find((item) => item.id === subjectId);
      readPermission = "announcement.read";
    } else {
      resource = agentRuns.find((item) => item.id === subjectId);
      readPermission = "agent.read";
    }
    if (!resource) throw new Error("Conversation subject was not found.");
    return {
      subjectType,
      subjectId,
      spaceId: resource.spaceId,
      ownerIdentityId: resource.ownerIdentityId,
      visibility: resource.visibility,
      classification: resource.classification,
      allowedIdentityIds: resource.allowedIdentityIds ?? [],
      readPermission,
    };
  }

  function conversationCapabilities() {
    const usableMembership = bootstrap.identityExists &&
      (bootstrap.membershipState === "preboarding" || bootstrap.membershipState === "active");
    return { post: usableMembership, moderate: usableMembership && bootstrap.rootOwner };
  }

  function assertConversationAccess(): void {
    if (!conversationCapabilities().post) {
      throw new Error("Conversation is outside this development identity scope.");
    }
  }

  function findConversation(
    subjectType: UiConversationSubject["subjectType"],
    subjectId: string,
  ): DemoConversation | undefined {
    return conversations.find((item) =>
      item.conversation.subjectType === subjectType && item.conversation.subjectId === subjectId);
  }

  function appendDemoChronicle(
    action: string,
    subjectType: string,
    subjectId: string,
    boundary: Pick<UiAnnouncement, "spaceId" | "ownerIdentityId" | "visibility" | "classification" | "allowedIdentityIds">,
    details: UiChronicleEvent["details"],
  ): void {
    chronicleSequence += 1;
    chronicleEvents = [{
      sequence: String(chronicleSequence),
      id: crypto.randomUUID(),
      spaceId: boundary.spaceId,
      ownerIdentityId: boundary.ownerIdentityId,
      visibility: boundary.visibility,
      classification: boundary.classification,
      allowedIdentityIds: boundary.allowedIdentityIds,
      actorIdentityId: bootstrap.accountId,
      actorDisplayName: directory.identities.find(
        (identity) => identity.id === bootstrap.accountId,
      )?.displayName ?? "Guild Human",
      action,
      subjectType,
      subjectId,
      correlationId: crypto.randomUUID(),
      occurredAt: now(),
      details,
    }, ...chronicleEvents];
  }

  function assertCurrentVersion(current: number, expected: number): void {
    if (current !== expected) throw new Error("Work changed since it was loaded.");
  }

  function assertDecisionVersion(current: number, expected: number): void {
    if (current !== expected) throw new Error("Decision changed since it was loaded.");
  }

  function updateDecisionCapabilities(detail: UiDecisionDetail): UiDecisionDetail {
    const reviewed = detail.approvals.some(
      (approval) => approval.approverIdentityId === bootstrap.accountId,
    );
    return {
      ...detail,
      decision: {
        ...detail.decision,
        capabilities: decisionCapabilities(detail.decision.status, reviewed),
      },
    };
  }

  function assertAssignable(identityId: string | null): void {
    if (identityId === null) return;
    const identity = directory.identities.find((candidate) => candidate.id === identityId);
    if (!identity || identity.status !== "active" ||
        !["preboarding", "active"].includes(identity.membershipState)) {
      throw new Error("Activity can be assigned only to an active Guild Actor.");
    }
  }

  function governedMemories(): UiMemory[] {
    return knowledge.map((item) => {
      const version = item.versions.find((candidate) => candidate.version === item.currentVersion) ??
        item.versions[0];
      if (!version) throw new Error("Knowledge version is missing.");
      return {
        id: item.id,
        spaceId: item.spaceId,
        ownerActorId: item.ownerIdentityId,
        createdByActorId: item.createdByIdentityId,
        type: "knowledge",
        status: item.state === "archived" ? "archived" : "active",
        workflow: "canonical",
        governanceState: item.state,
        visibility: item.visibility,
        classification: item.classification,
        allowedActorIds: item.allowedIdentityIds,
        currentVersion: item.currentVersion,
        confidence: null,
        sourceIds: item.sourceIds,
        title: version.title,
        summary: version.summary,
        body: version.body,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        capabilities: { edit: false, archive: false, governed: true },
      };
    });
  }

  function legacyActivities(): UiActivity[] {
    const readOnly = { changeStatus: false, assign: false, addChild: false };
    const goalItems: UiActivity[] = goals.map((goal) => ({
      id: goal.id,
      parentActivityId: null,
      spaceId: goal.spaceId,
      ownerActorId: goal.ownerIdentityId,
      creatorActorId: goal.creatorIdentityId,
      assigneeActorId: null,
      type: "goal",
      title: goal.title,
      description: goal.description,
      status: goal.status === "draft" ? "proposed" : goal.status,
      visibility: goal.visibility,
      classification: goal.classification,
      allowedActorIds: goal.allowedIdentityIds ?? [],
      sourceIds: goal.sourceIds ?? [],
      startsAt: null,
      dueAt: goal.targetAt,
      position: 0,
      version: goal.version,
      compatibilitySourceType: "goal",
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      capabilities: readOnly,
    }));
    const projectItems: UiActivity[] = projects.map((project) => ({
      id: project.id,
      parentActivityId: project.goalId,
      spaceId: project.spaceId,
      ownerActorId: project.ownerIdentityId,
      creatorActorId: project.creatorIdentityId,
      assigneeActorId: null,
      type: "project",
      title: project.title,
      description: project.description,
      status: project.status,
      visibility: project.visibility,
      classification: project.classification,
      allowedActorIds: project.allowedIdentityIds ?? [],
      sourceIds: project.sourceIds ?? [],
      startsAt: null,
      dueAt: project.dueAt,
      position: 0,
      version: project.version,
      compatibilitySourceType: "project",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      capabilities: readOnly,
    }));
    const questItems: UiActivity[] = quests.map((quest) => ({
      id: quest.id,
      parentActivityId: quest.projectId,
      spaceId: quest.spaceId,
      ownerActorId: quest.ownerIdentityId,
      creatorActorId: quest.creatorIdentityId,
      assigneeActorId: quest.assigneeIdentityId,
      type: "quest",
      title: quest.title,
      description: quest.description,
      status: quest.status === "backlog" ? "proposed" :
        quest.status === "in_progress" ? "active" : quest.status,
      visibility: quest.visibility,
      classification: quest.classification,
      allowedActorIds: quest.allowedIdentityIds ?? [],
      sourceIds: quest.sourceIds ?? [],
      startsAt: null,
      dueAt: quest.dueAt,
      position: 0,
      version: quest.version,
      compatibilitySourceType: "quest",
      createdAt: quest.createdAt,
      updatedAt: quest.updatedAt,
      capabilities: readOnly,
    }));
    const stepItems: UiActivity[] = steps.flatMap((step) => {
      const quest = quests.find((candidate) => candidate.id === step.questId);
      if (!quest) return [];
      return [{
        id: step.id,
        parentActivityId: step.questId,
        spaceId: quest.spaceId,
        ownerActorId: quest.ownerIdentityId,
        creatorActorId: step.creatorIdentityId,
        assigneeActorId: step.assigneeIdentityId,
        type: "step",
        title: step.title,
        description: step.description,
        status: step.status === "pending" ? "planned" :
          step.status === "in_progress" ? "active" :
            step.status === "skipped" ? "cancelled" : step.status,
        visibility: quest.visibility,
        classification: quest.classification,
        allowedActorIds: quest.allowedIdentityIds ?? [],
        sourceIds: quest.sourceIds ?? [],
        startsAt: null,
        dueAt: quest.dueAt,
        position: step.position,
        version: step.version,
        compatibilitySourceType: "step" as const,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        capabilities: readOnly,
      }];
    });
    return [...goalItems, ...projectItems, ...questItems, ...stepItems];
  }

  function now(): string {
    return new Date().toISOString();
  }

  return {
    async getBootstrap() {
      return restrictedBootstrap ?? bootstrap;
    },
    async initializeGuild(input) {
      if (restrictedBootstrap?.screen !== "initialize" ||
          !restrictedBootstrap.canInitialize || input.confirmation !== bootstrap.guildName ||
          !input.displayName.trim() || [
            input.purpose,
            input.participants,
            input.memoryIntent,
            input.activityIntent,
            input.decisionStyle,
          ].some((answer) => !answer.trim())) {
        throw new Error("Only a Cloudflare OS administrator can initialize this Guild.");
      }
      const rootAccountId = restrictedBootstrap.accountId;
      const template = collectiveTemplate(input.templateKey);
      bootstrap = {
        ...bootstrap,
        accountId: rootAccountId,
        rootOwner: true,
        rootOwnerIdentityId: rootAccountId,
        rootOwnerDisplayName: input.displayName.trim(),
        preferredLocale: input.preferredLocale,
        breakGlass: {
          ...bootstrap.breakGlass,
          available: false,
          currentCodeSetId: null,
          generation: null,
          outgoingRoleId: null,
          outgoingRoleName: null,
          reason: null,
          expiresAt: null,
          createdAt: null,
          remainingCodeCount: null,
        },
      };
      const roles = template.roles.map((role) => ({
        id: crypto.randomUUID(),
        name: role.name,
        system: true,
        permissions: role.capabilities,
      }));
      directory = {
        ...directory,
        identities: [{
          id: rootAccountId,
          kind: "human",
          displayName: input.displayName.trim(),
          status: "active",
          preferredLocale: input.preferredLocale,
          membershipState: "active",
          clearance: "restricted",
          joinedAt: now(),
          departedAt: null,
        }],
        roles,
        roleBindings: roles[0] ? [{
          id: crypto.randomUUID(),
          identityId: rootAccountId,
          roleId: roles[0].id,
          spaceId: null,
        }] : [],
        agentProfiles: [],
        spaces: [{ id: rootSpaceId, parentSpaceId: null, name: "Guild", status: "active" }],
        invitations: [],
      };
      collective = {
        ...collective,
        template,
        labels: template.labels,
        vocabularyOverrides: {},
        onboardingAnswers: {
          purpose: input.purpose.trim(),
          participants: input.participants.trim(),
          memoryIntent: input.memoryIntent.trim(),
          activityIntent: input.activityIntent.trim(),
          decisionStyle: input.decisionStyle.trim(),
        },
        templateVersion: collective.templateVersion + 1,
        spaces: directory.spaces.map((space) => ({
          id: space.id,
          parentSpaceId: space.parentSpaceId,
          name: space.name,
          vocabularyProfileKey: null,
          labels: template.labels,
          canConfigure: true,
        })),
        canConfigure: true,
        canConfigureSpaces: true,
      };
      restrictedBootstrap = null;
      return bootstrap;
    },
    async getCollectiveContext() {
      return collective;
    },
    async configureCollective(input) {
      if (!collective.canConfigure) {
        throw new Error("Only a Guild steward can configure the collective template.");
      }
      const template = collectiveTemplate(input.templateKey);
      const labels = { ...template.labels, ...input.vocabularyOverrides };
      collective = {
        ...collective,
        template,
        labels,
        vocabularyOverrides: input.vocabularyOverrides,
        onboardingAnswers: input.onboardingAnswers,
        templateVersion: collective.templateVersion + 1,
        spaces: collective.spaces.map((space) => {
          if (space.vocabularyProfileKey) {
            return { ...space, labels: collectiveTemplate(space.vocabularyProfileKey).labels };
          }
          return { ...space, labels };
        }),
      };
      return collective;
    },
    async setSpaceVocabulary(input) {
      if (!collective.canConfigureSpaces) {
        throw new Error("Only a Guild steward can configure Space vocabulary.");
      }
      if (!collective.spaces.some((space) => space.id === input.spaceId)) {
        throw new Error("Space was not found.");
      }
      const labels = input.templateKey
        ? collectiveTemplate(input.templateKey).labels
        : collective.labels;
      collective = {
        ...collective,
        templateVersion: collective.templateVersion + 1,
        spaces: collective.spaces.map((space) => space.id === input.spaceId ? {
          ...space,
          vocabularyProfileKey: input.templateKey,
          labels,
        } : space),
      };
      return collective;
    },
    async claimInvitation(input: ClaimInvitationInput) {
      bootstrap = {
        ...bootstrap,
        membershipState: "preboarding",
        preferredLocale: input.preferredLocale,
        breakGlass: { ...bootstrap.breakGlass, canRecover: false },
      };
      restrictedBootstrap = null;
      return bootstrap;
    },
    async rotateBreakGlassCodes(input) {
      if (!bootstrap.rootOwner || input.confirmation !== bootstrap.guildName ||
          input.reason.trim() === "" || input.expectedVersion !== bootstrap.breakGlass.version) {
        throw new Error("Only the current Root Owner can rotate recovery codes.");
      }
      const role = directory.roles.find((candidate) => candidate.id === input.outgoingRoleId);
      if (!role || input.expiresInDays < 7 || input.expiresInDays > 730) {
        throw new Error("Select a valid outgoing Role and expiry.");
      }
      const timestamp = now();
      const nextVersion = bootstrap.breakGlass.version + 1;
      const codeSetId = crypto.randomUUID();
      const codes = Array.from({ length: 10 }, (_, index) =>
        `gbr_${`DEMO${nextVersion}${index}`.padEnd(32, String(index)).slice(0, 32)}`);
      const status = {
        available: true,
        canRecover: false,
        version: nextVersion,
        currentCodeSetId: codeSetId,
        generation: nextVersion,
        outgoingRoleId: role.id,
        outgoingRoleName: role.name,
        reason: input.reason.trim(),
        expiresAt: new Date(
          Date.now() + input.expiresInDays * 86_400_000,
        ).toISOString(),
        createdAt: timestamp,
        remainingCodeCount: 10,
      };
      bootstrap = { ...bootstrap, breakGlass: status };
      appendDemoChronicle(
        "break_glass.codes.rotated",
        "break_glass_code_set",
        codeSetId,
        {
          spaceId: null,
          ownerIdentityId: bootstrap.accountId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        { reason: input.reason.trim(), generation: nextVersion, source: "guild-ui" },
      );
      return { status, codes };
    },
    async revokeBreakGlassCodes(input) {
      if (!bootstrap.rootOwner || input.confirmation !== bootstrap.guildName ||
          input.reason.trim() === "" || input.expectedVersion !== bootstrap.breakGlass.version ||
          input.codeSetId !== bootstrap.breakGlass.currentCodeSetId) {
        throw new Error("Active recovery codes were not found or confirmation failed.");
      }
      appendDemoChronicle(
        "break_glass.codes.revoked",
        "break_glass_code_set",
        input.codeSetId,
        {
          spaceId: null,
          ownerIdentityId: bootstrap.accountId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        { reason: input.reason.trim(), source: "guild-ui" },
      );
      const status = {
        ...bootstrap.breakGlass,
        available: false,
        version: bootstrap.breakGlass.version + 1,
        currentCodeSetId: null,
        generation: null,
        outgoingRoleId: null,
        outgoingRoleName: null,
        reason: null,
        expiresAt: null,
        createdAt: null,
        remainingCodeCount: 0,
      };
      bootstrap = { ...bootstrap, breakGlass: status };
      return status;
    },
    async recoverRootOwnership(input) {
      if (!bootstrap.breakGlass.canRecover ||
          !/^gbr_[A-Za-z0-9_-]{32}$/.test(input.code.trim()) ||
          input.confirmation !== bootstrap.guildName || input.displayName.trim() === "" ||
          input.reason.trim() === "") {
        throw new Error("Recovery code is invalid or unavailable.");
      }
      const previousRoot = bootstrap.rootOwnerIdentityId;
      const recoveringUnknown = restrictedBootstrap?.screen === "access" &&
        !restrictedBootstrap.identityExists;
      if (recoveringUnknown) {
        directory = {
          ...directory,
          identities: [...directory.identities, {
            id: bootstrap.accountId,
            kind: "human",
            displayName: input.displayName.trim(),
            status: "active",
            preferredLocale: input.preferredLocale,
            membershipState: "active",
            clearance: "restricted",
            joinedAt: now(),
            departedAt: null,
          }],
        };
      }
      const recoveryId = crypto.randomUUID();
      appendDemoChronicle(
        "break_glass.used",
        "break_glass_recovery",
        recoveryId,
        {
          spaceId: null,
          ownerIdentityId: bootstrap.accountId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        {
          reason: input.reason.trim(),
          previousRootIdentityId: previousRoot,
          newRootIdentityId: bootstrap.accountId,
          source: "guild-recovery",
        },
      );
      bootstrap = {
        ...bootstrap,
        membershipState: "active",
        preferredLocale: input.preferredLocale,
        rootOwner: true,
        rootOwnerIdentityId: bootstrap.accountId,
        rootOwnerDisplayName: input.displayName.trim(),
        rootOwnershipTransfer: null,
        breakGlass: {
          ...bootstrap.breakGlass,
          available: false,
          canRecover: false,
          version: bootstrap.breakGlass.version + 1,
          currentCodeSetId: null,
          generation: null,
          outgoingRoleId: null,
          outgoingRoleName: null,
          reason: null,
          expiresAt: null,
          createdAt: null,
          remainingCodeCount: 0,
        },
      };
      restrictedBootstrap = null;
      return bootstrap;
    },
    async getDirectory() {
      if (mode !== "root" && !bootstrap.rootOwner) {
        throw new Error("Directory is outside this development identity scope.");
      }
      return directory;
    },
    async issueInvitation(input: IssueInvitationInput): Promise<IssuedInvitation> {
      const invitation = {
        id: crypto.randomUUID(),
        inviteeLabel: input.inviteeLabel,
        roleId: input.roleId,
        spaceId: input.spaceId,
        initialMembershipState: input.initialMembershipState,
        state: "pending" as const,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
        createdByIdentityId: rootId,
        acceptedByIdentityId: null,
        acceptedAt: null,
        createdAt: new Date().toISOString(),
      };
      directory = { ...directory, invitations: [invitation, ...directory.invitations] };
      return { invitation, token: token() };
    },
    async revokeInvitation(invitationId: string) {
      directory = {
        ...directory,
        invitations: directory.invitations.map((invitation) =>
          invitation.id === invitationId ? { ...invitation, state: "revoked" as const } : invitation),
      };
    },
    async changeMembership(identityId, nextState) {
      directory = {
        ...directory,
        identities: directory.identities.map((identity) => identity.id === identityId ? {
          ...identity,
          membershipState: nextState,
          status: nextState === "suspended" || nextState === "departed" ? "disabled" : "active",
        } : identity),
      };
    },
    async createRole(input) {
      const id = crypto.randomUUID();
      directory = {
        ...directory,
        roles: [...directory.roles, { id, name: input.name, system: false, permissions: input.permissions }],
      };
      return id;
    },
    async updateRole(input) {
      directory = {
        ...directory,
        roles: directory.roles.map((role) => role.id === input.roleId
          ? { ...role, name: input.name, permissions: input.permissions }
          : role),
      };
    },
    async deleteRole(roleId) {
      directory = { ...directory, roles: directory.roles.filter((role) => role.id !== roleId) };
    },
    async createSpace(input) {
      const id = crypto.randomUUID();
      directory = {
        ...directory,
        spaces: [...directory.spaces, {
          id,
          parentSpaceId: input.parentSpaceId,
          name: input.name,
          status: "active",
        }],
      };
      collective = {
        ...collective,
        spaces: [...collective.spaces, {
          id,
          parentSpaceId: input.parentSpaceId,
          name: input.name,
          vocabularyProfileKey: null,
          labels: collective.labels,
          canConfigure: true,
        }],
      };
      return id;
    },
    async renameSpace(spaceId, name) {
      directory = {
        ...directory,
        spaces: directory.spaces.map((space) => space.id === spaceId ? { ...space, name } : space),
      };
      collective = {
        ...collective,
        spaces: collective.spaces.map((space) => space.id === spaceId ? { ...space, name } : space),
      };
    },
    async archiveSpace(spaceId) {
      directory = {
        ...directory,
        spaces: directory.spaces.map((space) => space.id === spaceId
          ? { ...space, status: "archived" }
          : space),
      };
      collective = {
        ...collective,
        spaces: collective.spaces.filter((space) => space.id !== spaceId),
      };
    },
    async assignRole(input) {
      if (directory.roleBindings.some((binding) =>
        binding.identityId === input.identityId && binding.roleId === input.roleId &&
        binding.spaceId === input.spaceId)) return;
      directory = {
        ...directory,
        roleBindings: [...directory.roleBindings, { id: crypto.randomUUID(), ...input }],
      };
    },
    async removeRoleBinding(bindingId) {
      directory = {
        ...directory,
        roleBindings: directory.roleBindings.filter((binding) => binding.id !== bindingId),
      };
    },
    async createAgent(input) {
      const id = crypto.randomUUID();
      directory = {
        ...directory,
        identities: [...directory.identities, {
          id,
          kind: "agent",
          displayName: input.displayName,
          status: "active",
          preferredLocale: "en",
          membershipState: "active",
          clearance: input.clearance,
          joinedAt: new Date().toISOString(),
          departedAt: null,
        }],
        agentProfiles: [...directory.agentProfiles, {
          identityId: id,
          instructions: input.instructions,
          model: input.model,
          toolIds: input.toolIds,
          limits: input.limits,
          status: "active",
        }],
        roleBindings: [...directory.roleBindings, {
          id: crypto.randomUUID(),
          identityId: id,
          roleId: input.roleId,
          spaceId: input.spaceId,
        }],
      };
      return id;
    },
    async createService(input) {
      const id = crypto.randomUUID();
      directory = {
        ...directory,
        identities: [...directory.identities, {
          id,
          kind: input.kind ?? "service",
          displayName: input.displayName,
          status: "active",
          preferredLocale: "en",
          membershipState: "active",
          clearance: input.clearance,
          joinedAt: new Date().toISOString(),
          departedAt: null,
        }],
        roleBindings: [...directory.roleBindings, {
          id: crypto.randomUUID(),
          identityId: id,
          roleId: input.roleId,
          spaceId: input.spaceId,
        }],
      };
      return id;
    },
    async changeMachineMembership(identityId, nextState) {
      directory = {
        ...directory,
        identities: directory.identities.map((identity) => identity.id === identityId ? {
          ...identity,
          membershipState: nextState,
          status: nextState === "active" ? "active" : "disabled",
        } : identity),
        agentProfiles: directory.agentProfiles.map((profile) => profile.identityId === identityId
          ? { ...profile, status: nextState === "active" ? "active" : "stopped" }
          : profile),
      };
    },
    async getMemoryPage(request = {}) {
      const search = request.search?.trim().toLocaleLowerCase() ?? "";
      const items = [...directMemories, ...governedMemories()].filter((memory) => {
        if (!request.includeArchived && memory.status === "archived") return false;
        if (request.type && memory.type !== request.type) return false;
        if (!search) return true;
        return [memory.title, memory.summary, memory.body]
          .some((value) => Object.values(value)
            .some((text) => text.toLocaleLowerCase().includes(search)));
      });
      return {
        items,
        nextCursor: null,
        creatableSpaceIds: mode === "root" ? collective.spaces.map((space) => space.id) : [],
      };
    },
    async createMemory(input) {
      if (mode !== "root") throw new Error("This Actor cannot add Memory.");
      assertMemoryContent(input.title, input.summary, input.body);
      if (input.confidence !== null &&
          (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
        throw new Error("Confidence must be between 0 and 1.");
      }
      if (input.spaceId !== null && !collective.spaces.some((space) => space.id === input.spaceId)) {
        throw new Error("Space was not found.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      const memory: UiMemory = {
        id,
        spaceId: input.spaceId,
        ownerActorId: bootstrap.accountId,
        createdByActorId: bootstrap.accountId,
        type: input.type,
        status: "active",
        workflow: null,
        governanceState: null,
        visibility: input.visibility,
        classification: input.classification,
        allowedActorIds: input.allowedActorIds,
        currentVersion: 1,
        confidence: input.confidence,
        sourceIds: input.sourceIds,
        title: input.title,
        summary: input.summary,
        body: input.body,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: { edit: true, archive: true, governed: false },
      };
      directMemories = [memory, ...directMemories];
      appendDemoChronicle(
        "memory.created",
        "memory",
        id,
        {
          spaceId: memory.spaceId,
          ownerIdentityId: memory.ownerActorId,
          visibility: memory.visibility,
          classification: memory.classification,
          allowedIdentityIds: memory.allowedActorIds,
        },
        { type: memory.type, changeNote: input.changeNote, source: "guild-ui" },
      );
      return id;
    },
    async saveMemory(input) {
      const memory = directMemories.find((candidate) => candidate.id === input.memoryId);
      if (!memory || memory.workflow !== null) {
        throw new Error("Governed Memory must be changed through its approval workflow.");
      }
      if (!memory.capabilities.edit || memory.currentVersion !== input.expectedVersion) {
        throw new Error("Memory changed since it was loaded.");
      }
      assertMemoryContent(input.title, input.summary, input.body);
      const nextVersion = memory.currentVersion + 1;
      directMemories = directMemories.map((candidate) => candidate.id === input.memoryId ? {
        ...candidate,
        title: input.title,
        summary: input.summary,
        body: input.body,
        sourceIds: input.sourceIds,
        currentVersion: nextVersion,
        updatedAt: now(),
      } : candidate);
      appendDemoChronicle(
        "memory.version.created",
        "memory",
        memory.id,
        {
          spaceId: memory.spaceId,
          ownerIdentityId: memory.ownerActorId,
          visibility: memory.visibility,
          classification: memory.classification,
          allowedIdentityIds: memory.allowedActorIds,
        },
        { version: nextVersion, changeNote: input.changeNote, source: "guild-ui" },
      );
      return nextVersion;
    },
    async archiveMemory(input) {
      const memory = directMemories.find((candidate) => candidate.id === input.memoryId);
      if (!memory || memory.workflow !== null) {
        throw new Error("Governed Memory must be changed through its approval workflow.");
      }
      if (!memory.capabilities.archive || memory.currentVersion !== input.expectedVersion) {
        throw new Error("Memory changed since it was loaded.");
      }
      const nextVersion = memory.currentVersion + 1;
      directMemories = directMemories.map((candidate) => candidate.id === input.memoryId ? {
        ...candidate,
        status: "archived",
        currentVersion: nextVersion,
        updatedAt: now(),
        capabilities: { ...candidate.capabilities, edit: false, archive: false },
      } : candidate);
      return nextVersion;
    },
    async getActivityPage(request = {}) {
      const requestedTypes = request.types ? new Set(request.types) : null;
      const requestedStatuses = request.statuses ? new Set(request.statuses) : null;
      const search = request.search?.trim().toLocaleLowerCase() ?? "";
      const items = [...directActivities, ...legacyActivities()].filter((activity) => {
        if (request.parentActivityId !== undefined &&
            activity.parentActivityId !== request.parentActivityId) return false;
        if (request.assigneeActorId && activity.assigneeActorId !== request.assigneeActorId) return false;
        if (requestedTypes && !requestedTypes.has(activity.type)) return false;
        if (requestedStatuses && !requestedStatuses.has(activity.status)) return false;
        if (search && !`${activity.title} ${activity.description}`.toLocaleLowerCase().includes(search)) {
          return false;
        }
        return true;
      });
      return {
        items,
        nextCursor: null,
        creatableSpaceIds: mode === "root" ? collective.spaces.map((space) => space.id) : [],
      };
    },
    async createActivity(input) {
      if (mode !== "root") throw new Error("This Actor cannot start Activity.");
      assertActivityText(input.title, input.description);
      assertAssignable(input.assigneeActorId);
      const parent = input.parentActivityId === null
        ? null
        : directActivities.find((activity) => activity.id === input.parentActivityId);
      if (input.parentActivityId !== null && !parent) {
        throw new Error("Structured legacy Work cannot accept direct Activity children.");
      }
      if (parent && parent.spaceId !== input.spaceId) {
        throw new Error("A child Activity must remain in its parent Space.");
      }
      if (input.spaceId !== null && !collective.spaces.some((space) => space.id === input.spaceId)) {
        throw new Error("Space was not found.");
      }
      const id = crypto.randomUUID();
      const timestamp = now();
      const activity: UiActivity = {
        ...input,
        id,
        ownerActorId: bootstrap.accountId,
        creatorActorId: bootstrap.accountId,
        version: 1,
        compatibilitySourceType: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: workCapabilities,
      };
      directActivities = [activity, ...directActivities];
      appendDemoChronicle(
        "activity.created",
        "activity",
        id,
        {
          spaceId: activity.spaceId,
          ownerIdentityId: activity.ownerActorId,
          visibility: activity.visibility,
          classification: activity.classification,
          allowedIdentityIds: activity.allowedActorIds,
        },
        { type: activity.type, status: activity.status, source: "guild-ui" },
      );
      return id;
    },
    async changeActivityStatus(input) {
      const activity = directActivities.find((candidate) => candidate.id === input.activityId);
      if (!activity || activity.compatibilitySourceType !== null) {
        throw new Error("Structured legacy Work must be changed through its original workflow.");
      }
      assertCurrentVersion(activity.version, input.expectedVersion);
      assertActivityTransition(activity.status, input.status);
      const nextVersion = activity.version + 1;
      directActivities = directActivities.map((candidate) => candidate.id === input.activityId ? {
        ...candidate,
        status: input.status,
        version: nextVersion,
        updatedAt: now(),
      } : candidate);
      return nextVersion;
    },
    async assignActivity(input) {
      const activity = directActivities.find((candidate) => candidate.id === input.activityId);
      if (!activity || activity.compatibilitySourceType !== null) {
        throw new Error("Structured legacy Work must be changed through its original workflow.");
      }
      assertCurrentVersion(activity.version, input.expectedVersion);
      assertAssignable(input.assigneeActorId);
      const nextVersion = activity.version + 1;
      directActivities = directActivities.map((candidate) => candidate.id === input.activityId ? {
        ...candidate,
        assigneeActorId: input.assigneeActorId,
        version: nextVersion,
        updatedAt: now(),
      } : candidate);
      return nextVersion;
    },
    async getKnowledgePage() {
      return {
        items: knowledge.map(({ versions: _versions, reviews: _reviews, files: _files, ...summary }) => summary),
        nextCursor: null,
        canCreate: mode === "root",
      };
    },
    async getKnowledge(requestedKnowledgeId) {
      const item = knowledge.find((candidate) => candidate.id === requestedKnowledgeId);
      if (!item) throw new Error("Knowledge was not found.");
      return item;
    },
    async createKnowledge(input) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      knowledge = [{
        id,
        spaceId: input.spaceId,
        ownerIdentityId: bootstrap.accountId,
        state: "draft",
        visibility: input.visibility,
        classification: input.classification,
        allowedIdentityIds: input.allowedIdentityIds,
        currentVersion: 1,
        canonicalVersion: null,
        title: input.title,
        summary: input.summary,
        sourceIds: input.sourceIds,
        createdByIdentityId: bootstrap.accountId,
        reviewDueAt: input.reviewDueAt,
        createdAt: now,
        updatedAt: now,
        capabilities: {
          edit: true, propose: true, review: false, startRevision: false,
          archive: true, deprecate: false, uploadFile: true, deleteFile: true,
        },
        acknowledged: false,
        versions: [{
          version: 1,
          state: "draft",
          title: input.title,
          summary: input.summary,
          body: input.body,
          sourceIds: input.sourceIds,
          createdByIdentityId: bootstrap.accountId,
          createdAt: now,
        }],
        reviews: [],
        files: [],
      }, ...knowledge];
      return id;
    },
    async saveKnowledgeDraft(input) {
      const item = knowledge.find((candidate) => candidate.id === input.knowledgeId);
      if (!item || item.currentVersion !== input.expectedVersion || item.state !== "draft") {
        throw new Error("Knowledge changed since it was loaded.");
      }
      const version = Math.max(...item.versions.map((candidate) => candidate.version)) + 1;
      const now = new Date().toISOString();
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        currentVersion: version,
        spaceId: input.spaceId,
        visibility: input.visibility,
        classification: input.classification,
        allowedIdentityIds: input.allowedIdentityIds,
        reviewDueAt: input.reviewDueAt,
        title: input.title,
        summary: input.summary,
        sourceIds: input.sourceIds,
        updatedAt: now,
        versions: [{
          version,
          state: "draft" as const,
          title: input.title,
          summary: input.summary,
          body: input.body,
          sourceIds: input.sourceIds,
          createdByIdentityId: bootstrap.accountId,
          createdAt: now,
        }, ...candidate.versions.map((previous) => previous.state === "draft"
          ? { ...previous, state: "archived" as const }
          : previous)],
      } : candidate);
      return version;
    },
    async startKnowledgeRevision(input) {
      const item = knowledge.find((candidate) => candidate.id === input.knowledgeId);
      if (!item || item.currentVersion !== input.expectedVersion || item.state !== "canonical") {
        throw new Error("Only Canonical Knowledge can start a revision.");
      }
      const canonical = item.versions.find((version) => version.version === item.canonicalVersion);
      if (!canonical) throw new Error("Canonical version is missing.");
      const version = Math.max(...item.versions.map((candidate) => candidate.version)) + 1;
      const now = new Date().toISOString();
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        state: "draft",
        currentVersion: version,
        capabilities: {
          edit: true, propose: true, review: false, startRevision: false,
          archive: true, deprecate: false, uploadFile: true, deleteFile: true,
        },
        versions: [{ ...canonical, version, state: "draft", createdAt: now }, ...candidate.versions],
      } : candidate);
      return version;
    },
    async proposeKnowledge(input) {
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        state: "proposed",
        capabilities: {
          ...candidate.capabilities,
          edit: false, propose: false, review: mode === "root", archive: mode === "root",
          uploadFile: false, deleteFile: false,
        },
        versions: candidate.versions.map((version) => version.version === input.expectedVersion
          ? { ...version, state: "proposed" as const }
          : version),
      } : candidate);
    },
    async reviewKnowledge(input) {
      const nextState = input.verdict === "approve" ? "canonical" as const : "draft" as const;
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        state: nextState,
        canonicalVersion: input.verdict === "approve" ? input.expectedVersion : candidate.canonicalVersion,
        reviews: [{
          id: crypto.randomUUID(),
          version: input.expectedVersion,
          reviewerIdentityId: bootstrap.accountId,
          verdict: input.verdict,
          reason: input.reason,
          createdAt: new Date().toISOString(),
        }, ...candidate.reviews],
        versions: candidate.versions.map((version) => version.version === input.expectedVersion
          ? { ...version, state: nextState }
          : version.state === "canonical" && input.verdict === "approve"
            ? { ...version, state: "deprecated" as const }
            : version),
        capabilities: input.verdict === "approve" ? fullKnowledgeCapabilities : {
          edit: true, propose: true, review: false, startRevision: false,
          archive: true, deprecate: false, uploadFile: true, deleteFile: true,
        },
      } : candidate);
    },
    async archiveKnowledge(input) {
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        state: candidate.canonicalVersion === null ? "archived" : "canonical",
        currentVersion: candidate.canonicalVersion ?? input.expectedVersion,
        capabilities: candidate.canonicalVersion === null ? {
          edit: false, propose: false, review: false, startRevision: false,
          archive: false, deprecate: false, uploadFile: false, deleteFile: false,
        } : fullKnowledgeCapabilities,
        versions: candidate.versions.map((version) => version.version === input.expectedVersion
          ? { ...version, state: "archived" as const }
          : version),
      } : candidate);
    },
    async deprecateKnowledge(input) {
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId ? {
        ...candidate,
        state: "deprecated",
        versions: candidate.versions.map((version) => version.version === input.expectedVersion
          ? { ...version, state: "deprecated" as const }
          : version),
        capabilities: { ...fullKnowledgeCapabilities, startRevision: false, deprecate: false, archive: true },
      } : candidate);
    },
    async acknowledgeKnowledge(input) {
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId
        ? { ...candidate, acknowledged: true }
        : candidate);
    },
    async uploadKnowledgeFile(input) {
      const id = crypto.randomUUID();
      const file: UiKnowledgeFile = {
        id,
        knowledgeVersion: input.expectedVersion,
        ownerIdentityId: bootstrap.accountId,
        originalName: input.originalName,
        mediaType: input.mediaType,
        byteSize: input.bytes.byteLength,
        sha256: "d".repeat(64),
        status: "ready",
        position: 0,
        createdAt: new Date().toISOString(),
      };
      fileBodies.set(id, new Blob([new Uint8Array(input.bytes).buffer], { type: input.mediaType }));
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId
        ? { ...candidate, files: [...candidate.files, file] }
        : candidate);
      return file;
    },
    async downloadKnowledgeFile(fileId) {
      const file = fileBodies.get(fileId);
      if (!file) return new Blob(["Fictional Guild OS demo attachment."], { type: "text/plain" });
      return file;
    },
    async deleteKnowledgeFile(input) {
      fileBodies.delete(input.fileId);
      knowledge = knowledge.map((candidate) => candidate.id === input.knowledgeId
        ? { ...candidate, files: candidate.files.filter((file) => file.id !== input.fileId) }
        : candidate);
    },
    async askGuild(input) {
      const source = knowledge[0]!;
      const title = source.title[input.locale] ?? source.title.ja ?? source.title.en ?? "Knowledge";
      const summary = source.summary[input.locale] ?? source.summary.ja ?? source.summary.en ?? "";
      return {
        answer: input.locale === "ja"
          ? `調査依頼はResearch Spaceへ記録し、責任者・成果・機密区分・出典を確認してから割り当てます。[M1]`
          : `Record the request in the Research Space, then verify its owner, outcome, classification, and source before assignment. [M1]`,
        inferred: true,
        citations: [{
          memoryId: source.id,
          knowledgeId: source.id,
          governed: true,
          version: source.canonicalVersion ?? source.currentVersion,
          title,
          summary,
          spaceId: source.spaceId,
        }],
      };
    },
    async getWorkPage(request = {}) {
      const requestedStatuses = request.questStatuses ? new Set(request.questStatuses) : null;
      return {
        goals,
        projects,
        quests: quests.filter((quest) =>
          (!request.projectId || quest.projectId === request.projectId) &&
          (!request.assigneeIdentityId || quest.assigneeIdentityId === request.assigneeIdentityId) &&
          (!requestedStatuses || requestedStatuses.has(quest.status))),
        nextGoalCursor: null,
        nextProjectCursor: null,
        nextQuestCursor: null,
        canCreate: mode === "root",
      };
    },
    async getQuestDetail(requestedQuestId) {
      const quest = quests.find((candidate) => candidate.id === requestedQuestId);
      if (!quest) throw new Error("Quest was not found.");
      return {
        quest,
        steps: steps.filter((step) => step.questId === requestedQuestId)
          .sort((left, right) => left.position - right.position),
      };
    },
    async createGoal(input) {
      if (mode !== "root") throw new Error("This identity cannot create Work.");
      const id = crypto.randomUUID();
      const timestamp = now();
      goals = [{
        ...input,
        id,
        ownerIdentityId: bootstrap.accountId,
        creatorIdentityId: bootstrap.accountId,
        status: "draft",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: workCapabilities,
      }, ...goals];
      return id;
    },
    async createProject(input) {
      if (mode !== "root") throw new Error("This identity cannot create Work.");
      const parent = goals.find((candidate) => candidate.id === input.goalId);
      if (!parent) throw new Error("Goal was not found.");
      if (!["draft", "active"].includes(parent.status)) {
        throw new Error("This Goal no longer accepts Projects.");
      }
      if (input.spaceId !== parent.spaceId) throw new Error("Project must remain inside its Goal Space.");
      const id = crypto.randomUUID();
      const timestamp = now();
      projects = [{
        ...input,
        id,
        ownerIdentityId: bootstrap.accountId,
        creatorIdentityId: bootstrap.accountId,
        status: "planned",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: workCapabilities,
      }, ...projects];
      return id;
    },
    async createQuest(input) {
      if (mode !== "root") throw new Error("This identity cannot create Work.");
      const parent = projects.find((candidate) => candidate.id === input.projectId);
      if (!parent) throw new Error("Project was not found.");
      if (["completed", "cancelled"].includes(parent.status)) {
        throw new Error("This Project no longer accepts Quests.");
      }
      if (input.spaceId !== parent.spaceId) throw new Error("Quest must remain inside its Project Space.");
      assertAssignable(input.assigneeIdentityId);
      const id = crypto.randomUUID();
      const timestamp = now();
      quests = [{
        ...input,
        id,
        ownerIdentityId: bootstrap.accountId,
        creatorIdentityId: bootstrap.accountId,
        status: "ready",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: workCapabilities,
      }, ...quests];
      return id;
    },
    async createStep(input) {
      if (mode !== "root") throw new Error("This identity cannot create Work.");
      const parent = quests.find((candidate) => candidate.id === input.questId);
      if (!parent) throw new Error("Quest was not found.");
      if (["completed", "cancelled"].includes(parent.status)) {
        throw new Error("This Quest no longer accepts Steps.");
      }
      assertAssignable(input.assigneeIdentityId);
      const id = crypto.randomUUID();
      const timestamp = now();
      const position = steps.filter((step) => step.questId === input.questId)
        .reduce((maximum, step) => Math.max(maximum, step.position), -1) + 1;
      steps = [...steps, {
        ...input,
        id,
        creatorIdentityId: bootstrap.accountId,
        status: "pending",
        position,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: workCapabilities,
      }];
      return id;
    },
    async changeWorkStatus(input) {
      if (mode !== "root") throw new Error("This identity cannot change Work state.");
      const timestamp = now();
      switch (input.kind) {
        case "goal": {
          const item = goals.find((candidate) => candidate.id === input.id);
          if (!item) throw new Error("Goal was not found.");
          assertCurrentVersion(item.version, input.expectedVersion);
          const nextStatus = input.status;
          assertGoalStatus(nextStatus);
          assertGoalTransition(item.status, nextStatus);
          if (["completed", "cancelled"].includes(nextStatus) && projects.some((project) =>
            project.goalId === item.id && !["completed", "cancelled"].includes(project.status))) {
            throw new Error("Complete or cancel every Project first.");
          }
          const version = item.version + 1;
          goals = goals.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: nextStatus, version, updatedAt: timestamp }
            : candidate);
          return version;
        }
        case "project": {
          const item = projects.find((candidate) => candidate.id === input.id);
          if (!item) throw new Error("Project was not found.");
          assertCurrentVersion(item.version, input.expectedVersion);
          const nextStatus = input.status;
          assertProjectStatus(nextStatus);
          assertProjectTransition(item.status, nextStatus);
          if (["completed", "cancelled"].includes(nextStatus) && quests.some((quest) =>
            quest.projectId === item.id && !["completed", "cancelled"].includes(quest.status))) {
            throw new Error("Complete or cancel every Quest first.");
          }
          const version = item.version + 1;
          projects = projects.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: nextStatus, version, updatedAt: timestamp }
            : candidate);
          return version;
        }
        case "quest": {
          const item = quests.find((candidate) => candidate.id === input.id);
          if (!item) throw new Error("Quest was not found.");
          assertCurrentVersion(item.version, input.expectedVersion);
          const nextStatus = input.status;
          assertQuestStatus(nextStatus);
          assertQuestTransition(item.status, nextStatus);
          if (["completed", "cancelled"].includes(nextStatus) && steps.some((step) =>
            step.questId === item.id && !["completed", "skipped"].includes(step.status))) {
            throw new Error("Complete or skip every Step first.");
          }
          const version = item.version + 1;
          quests = quests.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: nextStatus, version, updatedAt: timestamp }
            : candidate);
          return version;
        }
        case "step": {
          const item = steps.find((candidate) => candidate.id === input.id);
          if (!item) throw new Error("Step was not found.");
          assertCurrentVersion(item.version, input.expectedVersion);
          const nextStatus = input.status;
          assertStepStatus(nextStatus);
          assertStepTransition(item.status, nextStatus);
          const version = item.version + 1;
          steps = steps.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: nextStatus, version, updatedAt: timestamp }
            : candidate);
          return version;
        }
      }
    },
    async assignWork(input) {
      if (mode !== "root") throw new Error("This identity cannot assign Work.");
      assertAssignable(input.assigneeIdentityId);
      const timestamp = now();
      if (input.kind === "quest") {
        const item = quests.find((candidate) => candidate.id === input.id);
        if (!item) throw new Error("Quest was not found.");
        assertCurrentVersion(item.version, input.expectedVersion);
        const version = item.version + 1;
        quests = quests.map((candidate) => candidate.id === item.id ? {
          ...candidate,
          assigneeIdentityId: input.assigneeIdentityId,
          version,
          updatedAt: timestamp,
        } : candidate);
        return version;
      }
      const item = steps.find((candidate) => candidate.id === input.id);
      if (!item) throw new Error("Step was not found.");
      assertCurrentVersion(item.version, input.expectedVersion);
      const version = item.version + 1;
      steps = steps.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        assigneeIdentityId: input.assigneeIdentityId,
        version,
        updatedAt: timestamp,
      } : candidate);
      return version;
    },
    async getDecisionPage() {
      return {
        items: decisions.map((detail) => updateDecisionCapabilities(detail).decision),
        nextCursor: null,
        canCreate: mode === "root",
      };
    },
    async getDecision(requestedDecisionId) {
      const detail = decisions.find((candidate) => candidate.decision.id === requestedDecisionId);
      if (!detail) throw new Error("Decision was not found.");
      return updateDecisionCapabilities(detail);
    },
    async createDecision(input) {
      if (mode !== "root") throw new Error("This identity cannot create Decisions.");
      if (input.method !== undefined) assertDecisionMethod(input.method);
      assertDecisionContent(input.title, input.description, input.rationale);
      assertDecisionOptions(input.options);
      const id = crypto.randomUUID();
      const timestamp = now();
      const { options: requestedOptions, ...resource } = input;
      const detail: UiDecisionDetail = {
        decision: {
          ...resource,
          method: resource.method ?? "custodian",
          id,
          proposerIdentityId: bootstrap.accountId,
          ownerIdentityId: bootstrap.accountId,
          status: "draft",
          requiredApprovals: 1,
          approvalCount: 0,
          selectedOptionId: null,
          decidedAt: null,
          supersededByDecisionId: null,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          capabilities: decisionCapabilities("draft"),
        },
        options: requestedOptions.map((option, position) => ({
          ...option,
          id: crypto.randomUUID(),
          position,
          selected: false,
        })),
        approvals: [],
      };
      decisions = [detail, ...decisions];
      return id;
    },
    async saveDecisionDraft(input) {
      if (mode !== "root") throw new Error("This identity cannot edit Decisions.");
      if (input.method !== undefined) assertDecisionMethod(input.method);
      assertDecisionContent(input.title, input.description, input.rationale);
      assertDecisionOptions(input.options);
      const detail = decisions.find((candidate) => candidate.decision.id === input.decisionId);
      if (!detail || detail.decision.status !== "draft") {
        throw new Error("Only a draft Decision can be edited.");
      }
      assertDecisionVersion(detail.decision.version, input.expectedVersion);
      const version = detail.decision.version + 1;
      decisions = decisions.map((candidate) => candidate.decision.id === input.decisionId ? {
        decision: {
          ...candidate.decision,
          method: input.method ?? candidate.decision.method,
          spaceId: input.spaceId,
          title: input.title,
          description: input.description,
          rationale: input.rationale,
          visibility: input.visibility,
          classification: input.classification,
          allowedIdentityIds: input.allowedIdentityIds,
          sourceIds: input.sourceIds,
          reviewAt: input.reviewAt,
          version,
          updatedAt: now(),
        },
        options: input.options.map((option, position) => ({
          ...option,
          id: crypto.randomUUID(),
          position,
          selected: false,
        })),
        approvals: [],
      } : candidate);
      return version;
    },
    async proposeDecision(input) {
      if (mode !== "root") throw new Error("This identity cannot propose Decisions.");
      const detail = decisions.find((candidate) => candidate.decision.id === input.decisionId);
      if (!detail) throw new Error("Decision was not found.");
      assertDecisionVersion(detail.decision.version, input.expectedVersion);
      assertDecisionTransition(detail.decision.status, "proposed");
      const version = detail.decision.version + 1;
      decisions = decisions.map((candidate) => candidate.decision.id === input.decisionId
        ? updateDecisionCapabilities({
          ...candidate,
          decision: {
            ...candidate.decision,
            status: "proposed",
            requiredApprovals: 1,
            version,
            updatedAt: now(),
          },
        })
        : candidate);
      return version;
    },
    async reviewDecision(input) {
      if (mode !== "root") throw new Error("Only a Human approver can review Decisions.");
      assertDecisionReview(input.verdict, input.selectedOptionId, input.reason);
      const detail = decisions.find((candidate) => candidate.decision.id === input.decisionId);
      if (!detail || detail.decision.status !== "proposed") {
        throw new Error("Only a proposed Decision can be reviewed.");
      }
      assertDecisionVersion(detail.decision.version, input.expectedVersion);
      if (detail.approvals.some((approval) => approval.approverIdentityId === bootstrap.accountId)) {
        throw new Error("This Human has already reviewed the Decision.");
      }
      if (input.selectedOptionId !== null &&
          !detail.options.some((option) => option.id === input.selectedOptionId)) {
        throw new Error("Decision option does not belong to this Decision.");
      }
      const approvalCount = detail.decision.approvalCount + (input.verdict === "approve" ? 1 : 0);
      const status = input.verdict === "reject"
        ? "rejected" as const
        : approvalCount >= detail.decision.requiredApprovals ? "approved" as const : "proposed" as const;
      const version = detail.decision.version + 1;
      const timestamp = now();
      decisions = decisions.map((candidate) => candidate.decision.id === input.decisionId
        ? updateDecisionCapabilities({
          decision: {
            ...candidate.decision,
            status,
            approvalCount,
            selectedOptionId: status === "approved" ? input.selectedOptionId : null,
            decidedAt: status === "proposed" ? null : timestamp,
            version,
            updatedAt: timestamp,
          },
          options: candidate.options.map((option) => ({
            ...option,
            selected: status === "approved" && option.id === input.selectedOptionId,
          })),
          approvals: [...candidate.approvals, {
            approverIdentityId: bootstrap.accountId,
            verdict: input.verdict,
            selectedOptionId: input.selectedOptionId,
            reason: input.reason,
            createdAt: timestamp,
          }],
        })
        : candidate);
      return { version, status, approvalCount };
    },
    async supersedeDecision(input) {
      if (mode !== "root") throw new Error("This identity cannot supersede Decisions.");
      const detail = decisions.find((candidate) => candidate.decision.id === input.decisionId);
      const replacement = decisions.find(
        (candidate) => candidate.decision.id === input.replacementDecisionId,
      );
      if (!detail || !replacement) throw new Error("Both Decisions must exist.");
      assertDecisionVersion(detail.decision.version, input.expectedVersion);
      assertDecisionTransition(detail.decision.status, "superseded");
      if (replacement.decision.status !== "approved") {
        throw new Error("Replacement Decision must be approved.");
      }
      const version = detail.decision.version + 1;
      decisions = decisions.map((candidate) => candidate.decision.id === input.decisionId
        ? updateDecisionCapabilities({
          ...candidate,
          decision: {
            ...candidate.decision,
            status: "superseded",
            supersededByDecisionId: input.replacementDecisionId,
            version,
            updatedAt: now(),
          },
        })
        : candidate);
      return version;
    },
    async getConversationThread(request) {
      assertConversationAccess();
      const subject = conversationSubject(request.subjectType, request.subjectId);
      const record = findConversation(request.subjectType, request.subjectId);
      const capabilities = conversationCapabilities();
      return {
        subject,
        conversation: record?.conversation ?? null,
        messages: (record?.messages ?? []).map((message) => capabilities.moderate ? message : {
          ...message,
          redactedByIdentityId: null,
          redactionReason: null,
        }),
        nextCursor: null,
        capabilities,
      };
    },
    async postConversationMessage(input) {
      assertConversationAccess();
      const subject = conversationSubject(input.subjectType, input.subjectId);
      const body = input.body.trim();
      if (!body || body.length > 10_000 || input.mentionedIdentityIds.length > 20 ||
          new Set(input.mentionedIdentityIds).size !== input.mentionedIdentityIds.length ||
          input.mentionedIdentityIds.includes(bootstrap.accountId)) {
        throw new Error("Comment content or mentions are invalid.");
      }
      for (const identityId of input.mentionedIdentityIds) {
        const identity = directory.identities.find((candidate) => candidate.id === identityId);
        if (!identity || identity.kind !== "human" || identity.status !== "active" ||
            !["preboarding", "active"].includes(identity.membershipState)) {
          throw new Error("Mentioned Human cannot read the Conversation subject.");
        }
      }
      let record = findConversation(input.subjectType, input.subjectId);
      const opened = !record;
      const timestamp = now();
      if (!record) {
        record = {
          conversation: {
            id: crypto.randomUUID(),
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            spaceId: subject.spaceId,
            ownerIdentityId: subject.ownerIdentityId,
            visibility: subject.visibility,
            classification: subject.classification,
            allowedIdentityIds: subject.allowedIdentityIds,
            status: "open",
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          messages: [],
        };
        conversations = [...conversations, record];
        appendDemoChronicle(
          "conversation.opened",
          "conversation",
          record.conversation.id,
          subject,
          { source: "guild-ui", subjectType: input.subjectType, subjectId: input.subjectId },
        );
      }
      if (record.conversation.status !== "open") throw new Error("Conversation is locked.");
      const author = directory.identities.find((identity) => identity.id === bootstrap.accountId);
      const message: UiConversationMessage = {
        id: crypto.randomUUID(),
        conversationId: record.conversation.id,
        authorIdentityId: bootstrap.accountId,
        authorDisplayName: author?.displayName ?? "Guild Human",
        body,
        mentionedIdentityIds: input.mentionedIdentityIds,
        state: "active",
        version: 1,
        redactedByIdentityId: null,
        redactedAt: null,
        redactionReason: null,
        createdAt: timestamp,
      };
      record.messages = [...record.messages, message];
      record.conversation = { ...record.conversation, updatedAt: timestamp };
      const notifications: UiInboxNotification[] = input.mentionedIdentityIds.map((identityId) => ({
        id: crypto.randomUUID(),
        spaceId: subject.spaceId,
        ownerIdentityId: subject.ownerIdentityId,
        visibility: subject.visibility,
        classification: subject.classification,
        allowedIdentityIds: subject.allowedIdentityIds,
        recipientIdentityId: identityId,
        kind: "mention",
        title: "You were mentioned in a comment",
        body: "Open the linked Guild record to review the comment in context.",
        resourceType: input.subjectType,
        resourceId: input.subjectId,
        readAt: null,
        createdAt: timestamp,
      }));
      inbox = [...notifications, ...inbox];
      appendDemoChronicle(
        "conversation.message.posted",
        "conversation_message",
        message.id,
        subject,
        {
          source: "guild-ui",
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          bodySha256: await sha256Text(body),
          mentionCount: input.mentionedIdentityIds.length,
        },
      );
      return {
        conversation: record.conversation,
        message,
        opened,
        notificationCount: notifications.length,
      };
    },
    async moderateConversation(input) {
      if (!conversationCapabilities().moderate) {
        throw new Error("Only a Human moderator can change Conversation status.");
      }
      const subject = conversationSubject(input.subjectType, input.subjectId);
      const record = findConversation(input.subjectType, input.subjectId);
      const reason = input.reason.trim();
      if (!record || record.conversation.id !== input.conversationId ||
          record.conversation.version !== input.expectedVersion || !reason ||
          record.conversation.status === input.nextStatus) {
        throw new Error("Conversation changed since it was loaded.");
      }
      record.conversation = {
        ...record.conversation,
        status: input.nextStatus,
        version: record.conversation.version + 1,
        updatedAt: now(),
      };
      appendDemoChronicle(
        input.nextStatus === "locked" ? "conversation.locked" : "conversation.unlocked",
        "conversation",
        input.conversationId,
        subject,
        { source: "guild-ui", reason },
      );
      return record.conversation;
    },
    async redactConversationMessage(input) {
      if (!conversationCapabilities().moderate) {
        throw new Error("Only a Human moderator can redact Conversation messages.");
      }
      const subject = conversationSubject(input.subjectType, input.subjectId);
      const record = findConversation(input.subjectType, input.subjectId);
      const message = record?.messages.find((candidate) => candidate.id === input.messageId);
      const reason = input.reason.trim();
      if (!record || record.conversation.id !== input.conversationId || !message ||
          message.version !== input.expectedVersion || message.state !== "active" || !reason) {
        throw new Error("Conversation message changed since it was loaded.");
      }
      const version = message.version + 1;
      record.messages = record.messages.map((candidate) => candidate.id === message.id ? {
        ...candidate,
        body: null,
        state: "redacted",
        version,
        redactedByIdentityId: bootstrap.accountId,
        redactedAt: now(),
        redactionReason: reason,
      } : candidate);
      appendDemoChronicle(
        "conversation.message.redacted",
        "conversation_message",
        message.id,
        subject,
        { source: "guild-ui", reason },
      );
      return version;
    },
    async searchConversationMentions(input) {
      assertConversationAccess();
      conversationSubject(input.subjectType, input.subjectId);
      const search = input.search.trim().toLocaleLowerCase("en-US");
      if (!search) return [];
      return directory.identities
        .filter((identity) => identity.id !== bootstrap.accountId && identity.kind === "human" &&
          identity.status === "active" && ["preboarding", "active"].includes(identity.membershipState) &&
          identity.displayName.toLocaleLowerCase("en-US").startsWith(search))
        .slice(0, 10)
        .map((identity) => ({ id: identity.id, displayName: identity.displayName }));
    },
    async getAnnouncementPage() {
      return {
        items: announcements,
        nextCursor: null,
        manageableSpaceIds: mode === "root" ? directory.spaces.map((space) => space.id) : [],
        canCreateGuildWide: mode === "root",
      };
    },
    async getAnnouncement(requestedAnnouncementId) {
      const announcement = announcements.find((candidate) => candidate.id === requestedAnnouncementId);
      if (!announcement) throw new Error("Announcement was not found.");
      return announcement;
    },
    async createAnnouncement(input) {
      if (mode !== "root") throw new Error("This identity cannot manage Announcements.");
      assertAnnouncementContent(input.title, input.body);
      const id = crypto.randomUUID();
      const timestamp = now();
      const announcement: UiAnnouncement = {
        ...input,
        id,
        ownerIdentityId: bootstrap.accountId,
        creatorIdentityId: bootstrap.accountId,
        status: "draft",
        publishedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        capabilities: announcementCapabilities("draft"),
      };
      announcements = [announcement, ...announcements];
      appendDemoChronicle(
        "announcement.created",
        "announcement",
        id,
        announcement,
        { status: "draft", source: "guild-ui" },
      );
      return id;
    },
    async saveAnnouncementDraft(input) {
      if (mode !== "root") throw new Error("This identity cannot manage Announcements.");
      assertAnnouncementContent(input.title, input.body);
      const current = announcements.find((candidate) => candidate.id === input.announcementId);
      if (!current || current.status !== "draft" || current.version !== input.expectedVersion) {
        throw new Error("Announcement changed since it was loaded.");
      }
      const version = current.version + 1;
      let updated: UiAnnouncement | null = null;
      announcements = announcements.map((candidate) => candidate.id === current.id ? (updated = {
        ...candidate,
        spaceId: input.spaceId,
        targetRoleId: input.targetRoleId,
        title: input.title,
        body: input.body,
        visibility: input.visibility,
        classification: input.classification,
        allowedIdentityIds: input.allowedIdentityIds,
        expiresAt: input.expiresAt,
        version,
        updatedAt: now(),
        capabilities: announcementCapabilities("draft"),
      }) : candidate);
      if (updated) appendDemoChronicle(
        "announcement.draft.updated",
        "announcement",
        current.id,
        updated,
        { expectedVersion: input.expectedVersion, source: "guild-ui" },
      );
      return version;
    },
    async publishAnnouncement(input) {
      if (mode !== "root") throw new Error("This identity cannot publish Announcements.");
      const current = announcements.find((candidate) => candidate.id === input.announcementId);
      if (!current || current.version !== input.expectedVersion) {
        throw new Error("Announcement changed since it was loaded.");
      }
      assertAnnouncementTransition(current.status, "published");
      const version = current.version + 1;
      const timestamp = now();
      const updated: UiAnnouncement = {
        ...current,
        status: "published",
        publishedAt: timestamp,
        version,
        updatedAt: timestamp,
        capabilities: announcementCapabilities("published"),
      };
      announcements = announcements.map((candidate) => candidate.id === current.id ? updated : candidate);
      appendDemoChronicle(
        "announcement.published",
        "announcement",
        current.id,
        updated,
        { recipientCount: 2, source: "guild-ui" },
      );
      return { version, recipientCount: 2 };
    },
    async archiveAnnouncement(input) {
      if (mode !== "root") throw new Error("This identity cannot archive Announcements.");
      const current = announcements.find((candidate) => candidate.id === input.announcementId);
      if (!current || current.version !== input.expectedVersion) {
        throw new Error("Announcement changed since it was loaded.");
      }
      assertAnnouncementTransition(current.status, "archived");
      const version = current.version + 1;
      const updated: UiAnnouncement = {
        ...current,
        status: "archived",
        publishedAt: current.publishedAt ?? now(),
        version,
        updatedAt: now(),
        capabilities: announcementCapabilities("archived"),
      };
      announcements = announcements.map((candidate) => candidate.id === current.id ? updated : candidate);
      appendDemoChronicle(
        "announcement.archived",
        "announcement",
        current.id,
        updated,
        { source: "guild-ui" },
      );
      return version;
    },
    async getInboxPage(request = {}) {
      const items = inbox.filter((notification) =>
        notification.recipientIdentityId === bootstrap.accountId &&
        (!request.kind || notification.kind === request.kind) &&
        (!request.unreadOnly || notification.readAt === null));
      return {
        items,
        unreadCount: inbox.filter((notification) =>
          notification.recipientIdentityId === bootstrap.accountId && notification.readAt === null).length,
        nextCursor: null,
      };
    },
    async markInboxRead(input) {
      const notification = inbox.find((candidate) =>
        candidate.id === input.notificationId && candidate.recipientIdentityId === bootstrap.accountId);
      if (!notification) throw new Error("Inbox notification was not found.");
      const readAt = input.read ? notification.readAt ?? now() : null;
      inbox = inbox.map((candidate) => candidate.id === notification.id
        ? { ...candidate, readAt }
        : candidate);
      return readAt;
    },
    async markAllInboxRead() {
      const unread = inbox.filter((notification) =>
        notification.recipientIdentityId === bootstrap.accountId && notification.readAt === null);
      const timestamp = now();
      const unreadIds = new Set(unread.map((notification) => notification.id));
      inbox = inbox.map((notification) => unreadIds.has(notification.id)
        ? { ...notification, readAt: timestamp }
        : notification);
      return unread.length;
    },
    async getChroniclePage(request = {}) {
      const search = request.search?.trim().toLocaleLowerCase("en-US") ?? "";
      const from = request.occurredFrom ? Date.parse(request.occurredFrom) : null;
      const to = request.occurredTo ? Date.parse(request.occurredTo) : null;
      return {
        items: chronicleEvents.filter((event) =>
          (!search || `${event.action} ${event.subjectType}`.toLocaleLowerCase("en-US").includes(search)) &&
          (!request.actorIdentityId || event.actorIdentityId === request.actorIdentityId) &&
          (!request.subjectType || event.subjectType === request.subjectType) &&
          (from === null || Date.parse(event.occurredAt) >= from) &&
          (to === null || Date.parse(event.occurredAt) <= to)),
        nextCursor: null,
      };
    },
    async getAgentRunPage() {
      const runnableAgent = directory.identities.find((identity) => identity.id === agentId &&
        identity.kind === "agent" && identity.status === "active" &&
        identity.membershipState === "active");
      const runnableProfile = directory.agentProfiles.find((profile) =>
        profile.identityId === agentId && profile.status === "active");
      const canRunAgent = mode === "root" && Boolean(runnableAgent && runnableProfile);
      return {
        items: agentRuns.map(({ votes: _votes, ...run }) => ({
          ...run,
          capabilities: agentCapabilities(run.status),
        })),
        connectors: mode === "root" ? [{
          id: connectorId,
          name: "Approved operations webhook",
          kind: "https_webhook" as const,
          status: "active" as const,
          version: 1,
        }] : [],
        runnableAgents: canRunAgent ? [{
          identityId: agentId,
          displayName: "Research Synthesizer",
          model: "workers-ai/default",
          spaceIds: [researchSpaceId],
          limits: bootstrap.agentDefaults,
        }] : [],
        runnableSpaceIds: canRunAgent ? [researchSpaceId] : [],
        nextCursor: null,
      };
    },
    async getAgentRun(requestedRunId) {
      const run = agentRuns.find((candidate) => candidate.id === requestedRunId);
      if (!run) throw new Error("Agent run was not found.");
      return { ...run, capabilities: agentCapabilities(run.status) };
    },
    async createAgentWebhookRun(input) {
      if (mode !== "root") throw new Error("This identity cannot run Agents.");
      const timestamp = now();
      const approvalId = crypto.randomUUID();
      agentRuns = [{
        id: input.requestId,
        spaceId: input.spaceId,
        ownerIdentityId: bootstrap.accountId,
        visibility: input.visibility,
        classification: input.classification,
        allowedIdentityIds: input.allowedIdentityIds,
        agentIdentityId: input.agentIdentityId,
        requesterIdentityId: bootstrap.accountId,
        connectorId: input.connectorId,
        questId: input.questId,
        riskLevel: 2,
        status: "awaiting_approval",
        source: "guild-ui",
        plan: {
          objective: input.objective,
          expectedOutcome: input.expectedOutcome,
          steps: input.steps,
          connectorId: input.connectorId,
          questId: input.questId,
          action: { kind: "https_webhook", eventType: input.eventType, payload: input.payload },
          estimatedUsage: input.estimatedUsage,
        },
        result: null,
        errorMessage: null,
        limits: bootstrap.agentDefaults,
        usage: {
          budgetMinor: 0, tokens: 0, durationSeconds: 0, steps: 0, retries: 0, delegationDepth: 0,
        },
        workflowInstanceId: `agent-run-${input.requestId}`,
        idempotencyKey: `demo-agent-action:${input.requestId}`,
        requestHash: "b".repeat(64),
        estimatedBudgetMinor: input.estimatedUsage.budgetMinor,
        killRequestedAt: null,
        startedAt: null,
        finishedAt: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        agentDisplayName: directory.identities.find(
          (identity) => identity.id === input.agentIdentityId,
        )?.displayName ?? "Agent",
        requesterDisplayName: "Avery Morgan",
        connectorName: "Approved operations webhook",
        approval: {
          id: approvalId,
          guildId,
          agentRunId: input.requestId,
          riskLevel: 2,
          actionKind: "https_webhook.post",
          requiredApprovals: 1,
          approvalCount: 0,
          reauthenticationRequired: false,
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        capabilities: agentCapabilities("awaiting_approval"),
        votes: [],
      }, ...agentRuns];
      appendDemoChronicle(
        "agent.run.planned",
        "agent_run",
        input.requestId,
        agentRuns[0]!,
        { eventType: input.eventType, riskLevel: 2, source: "guild-ui" },
      );
      return input.requestId;
    },
    async reviewAgentRun(input) {
      if (mode !== "root") throw new Error("Only an authorized Human can review Agent runs.");
      const current = agentRuns.find((candidate) => candidate.id === input.runId);
      if (!current || current.approval?.id !== input.approvalRequestId ||
          current.approval.status !== "pending") {
        throw new Error("Pending Agent approval was not found.");
      }
      const timestamp = now();
      const approved = input.verdict === "approve";
      agentRuns = agentRuns.map((candidate) => candidate.id === input.runId ? {
        ...candidate,
        status: approved ? "succeeded" : "failed",
        result: approved
          ? { kind: "https_webhook", statusCode: 202, deliveredAt: timestamp }
          : null,
        errorMessage: approved ? null : "Human approval was rejected.",
        usage: approved
          ? { budgetMinor: 0, tokens: 0, durationSeconds: 1, steps: 2, retries: 0, delegationDepth: 0 }
          : candidate.usage,
        startedAt: approved ? timestamp : null,
        finishedAt: timestamp,
        version: candidate.version + 2,
        updatedAt: timestamp,
        approval: {
          ...candidate.approval!,
          approvalCount: approved ? 1 : 0,
          status: approved ? "applied" : "rejected",
          updatedAt: timestamp,
        },
        votes: [...candidate.votes, {
          guildId,
          approvalRequestId: input.approvalRequestId,
          approverIdentityId: bootstrap.accountId,
          verdict: input.verdict,
          reason: input.reason,
          reauthenticatedAt: input.reauthenticatedAt,
          createdAt: timestamp,
        }],
        capabilities: agentCapabilities(approved ? "succeeded" : "failed"),
      } : candidate);
      appendDemoChronicle(
        approved ? "agent.run.succeeded" : "agent.run.rejected",
        "agent_run",
        input.runId,
        current,
        { source: "demo-workflow" },
      );
    },
    async killAgentRun(requestedRunId) {
      if (mode !== "root") throw new Error("This identity cannot stop Agents.");
      const current = agentRuns.find((candidate) => candidate.id === requestedRunId);
      if (!current || !["planning", "awaiting_approval", "running"].includes(current.status)) {
        throw new Error("Active Agent run was not found.");
      }
      const timestamp = now();
      agentRuns = agentRuns.map((candidate) => candidate.id === requestedRunId ? {
        ...candidate,
        status: "killed",
        errorMessage: "Killed by an authorized Human.",
        killRequestedAt: timestamp,
        finishedAt: timestamp,
        version: candidate.version + 1,
        updatedAt: timestamp,
        approval: candidate.approval?.status === "pending"
          ? { ...candidate.approval, status: "expired", updatedAt: timestamp }
          : candidate.approval,
        capabilities: agentCapabilities("killed"),
      } : candidate);
      appendDemoChronicle(
        "agent.run.killed",
        "agent_run",
        requestedRunId,
        current,
        { source: "guild-ui" },
      );
    },
    async setPreferredLocale(locale) {
      bootstrap = { ...bootstrap, preferredLocale: locale };
    },
    async updateConstitution(input: UpdateConstitutionRequest) {
      if (mode !== "root") {
        throw new Error("Only the current human Root Owner can update the Constitution.");
      }
      const timestamp = now();
      validateConstitution({
        guildId,
        version: input.expectedVersion + 1,
        level2ApprovalQuorum: input.level2ApprovalQuorum,
        level3ApprovalQuorum: input.level3ApprovalQuorum,
        dataRetentionDays: input.dataRetentionDays,
        agentDefaults: input.agentDefaults,
        updatedByIdentityId: rootId,
        updatedAt: timestamp,
      });
      if (input.expectedVersion !== bootstrap.constitution.version || input.reason.trim() === "") {
        throw new Error("Constitution changed since it was loaded or the reason is missing.");
      }
      const constitution = {
        version: input.expectedVersion + 1,
        level2ApprovalQuorum: input.level2ApprovalQuorum,
        level3ApprovalQuorum: input.level3ApprovalQuorum,
        dataRetentionDays: input.dataRetentionDays,
        agentDefaults: input.agentDefaults,
        updatedByIdentityId: rootId,
        updatedAt: timestamp,
      };
      bootstrap = { ...bootstrap, constitution, agentDefaults: input.agentDefaults };
      appendDemoChronicle(
        "constitution.updated",
        "constitution",
        guildId,
        {
          spaceId: null,
          ownerIdentityId: rootId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        {
          previousVersion: input.expectedVersion,
          nextVersion: constitution.version,
          reason: input.reason.trim(),
          source: "guild-ui",
        },
      );
      return constitution;
    },
    async proposeRootOwnershipTransfer(input) {
      if (mode !== "root") throw new Error("Only the current Root Owner can propose a transfer.");
      const target = directory.identities.find((identity) =>
        identity.id === input.toIdentityId && identity.kind === "human" &&
        identity.status === "active" && identity.membershipState === "active");
      const role = directory.roles.find((candidate) => candidate.id === input.outgoingRoleId);
      if (!target || !role || input.confirmation !== target.displayName || input.reason.trim() === "") {
        throw new Error("Select an active Human, Role, reason, and exact confirmation.");
      }
      const timestamp = now();
      const transfer = {
        id: crypto.randomUUID(),
        fromIdentityId: rootId,
        toIdentityId: target.id,
        outgoingRoleId: role.id,
        state: "pending" as const,
        reason: input.reason.trim(),
        version: 1,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        resolvedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        fromDisplayName: "Avery Morgan",
        toDisplayName: target.displayName,
        outgoingRoleName: role.name,
      };
      bootstrap = { ...bootstrap, rootOwnershipTransfer: transfer };
      appendDemoChronicle(
        "root_ownership.transfer.proposed",
        "root_ownership_transfer",
        transfer.id,
        {
          spaceId: null,
          ownerIdentityId: rootId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        { reason: transfer.reason, toIdentityId: target.id, source: "guild-ui" },
      );
      return bootstrap;
    },
    async cancelRootOwnershipTransfer(input) {
      const transfer = bootstrap.rootOwnershipTransfer;
      if (mode !== "root" || !transfer || transfer.id !== input.transferId ||
          transfer.version !== input.expectedVersion || input.reason.trim() === "" ||
          input.confirmation !== bootstrap.guildName) {
        throw new Error("Pending Root ownership transfer was not found or confirmation failed.");
      }
      appendDemoChronicle(
        "root_ownership.transfer.cancelled",
        "root_ownership_transfer",
        transfer.id,
        {
          spaceId: null,
          ownerIdentityId: rootId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        { reason: input.reason.trim(), source: "guild-ui" },
      );
      bootstrap = { ...bootstrap, rootOwnershipTransfer: null };
      return bootstrap;
    },
    async acceptRootOwnershipTransfer(input) {
      const transfer = bootstrap.rootOwnershipTransfer;
      if (mode !== "transfer-target" || !transfer || transfer.id !== input.transferId ||
          transfer.version !== input.expectedVersion || input.reason.trim() === "" ||
          input.confirmation !== bootstrap.guildName) {
        throw new Error("Pending Root ownership transfer was not found or confirmation failed.");
      }
      appendDemoChronicle(
        "root_ownership.transfer.accepted",
        "root_ownership_transfer",
        transfer.id,
        {
          spaceId: null,
          ownerIdentityId: successorId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        { reason: input.reason.trim(), source: "guild-ui" },
      );
      appendDemoChronicle(
        "break_glass.codes.revoked",
        "break_glass_code_set",
        recoveryCodeSetId,
        {
          spaceId: null,
          ownerIdentityId: successorId,
          visibility: "guild",
          classification: "restricted",
          allowedIdentityIds: [],
        },
        {
          reason: "Invalidated automatically by an accepted Root ownership transfer.",
          rootOwnershipTransferId: transfer.id,
          source: "guild-governance",
        },
      );
      bootstrap = {
        ...bootstrap,
        rootOwner: true,
        rootOwnerIdentityId: successorId,
        rootOwnerDisplayName: "Noah Chen",
        rootOwnershipTransfer: null,
        breakGlass: {
          ...bootstrap.breakGlass,
          available: false,
          canRecover: false,
          version: bootstrap.breakGlass.version + 1,
          currentCodeSetId: null,
          generation: null,
          outgoingRoleId: null,
          outgoingRoleName: null,
          reason: null,
          expiresAt: null,
          createdAt: null,
          remainingCodeCount: 0,
        },
      };
      return bootstrap;
    },
    async searchRootOwnershipCandidates(search) {
      if (mode !== "root") throw new Error("Only the current Root Owner can search candidates.");
      const prefix = search.trim().toLocaleLowerCase("en-US");
      return directory.identities
        .filter((identity) => identity.kind === "human" && identity.status === "active" &&
          identity.membershipState === "active" && identity.id !== bootstrap.rootOwnerIdentityId &&
          identity.displayName.toLocaleLowerCase("en-US").startsWith(prefix))
        .slice(0, 25)
        .map((identity) => ({ id: identity.id, displayName: identity.displayName }));
    },
  };
}
