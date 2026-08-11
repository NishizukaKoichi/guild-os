import type {
  ClaimInvitationInput,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  UiBootstrapState,
  UiDirectory,
  UiKnowledgeDetail,
  UiKnowledgeFile,
  UiGoal,
  UiProject,
  UiQuest,
  UiStep,
} from "../src/management-types";
import {
  PERMISSIONS,
  assertGoalStatus,
  assertGoalTransition,
  assertProjectStatus,
  assertProjectTransition,
  assertQuestStatus,
  assertQuestTransition,
  assertStepStatus,
  assertStepTransition,
} from "@guild-os/domain";

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";
const rootId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b";
const memberId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9c";
const agentId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9d";
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

function token(): string {
  return "DemoOnlyTokenForVisualQualityReview1234567890A".slice(0, 43);
}

export function createDevelopmentApi(mode: string): GuildUiApi {
  let bootstrap: UiBootstrapState = {
    guildId,
    guildName: "Commonweal Research Guild",
    guildPurpose: "Preserve shared knowledge and coordinate governed work between people and agents.",
    accountId: rootId,
    identityExists: true,
    membershipState: "active",
    rootOwner: true,
    rootOwnerIdentityId: rootId,
    preferredLocale: "en",
    agentDefaults: {
      currency: "USD",
      maxBudgetMinor: 1000,
      maxDurationSeconds: 900,
      maxSteps: 20,
      maxRetries: 2,
      maxDelegationDepth: 1,
    },
  };
  if (mode === "uninvited") {
    bootstrap = { ...bootstrap, accountId: memberId, identityExists: false, membershipState: null, rootOwner: false };
  } else if (mode === "suspended") {
    bootstrap = { ...bootstrap, accountId: memberId, membershipState: "suspended", rootOwner: false };
  } else if (mode === "member") {
    bootstrap = { ...bootstrap, accountId: memberId, membershipState: "preboarding", rootOwner: false };
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
    ],
    agentProfiles: [{
      identityId: agentId,
      instructions: "Synthesize research only from Knowledge visible in the assigned Space.",
      model: "workers-ai/default",
      toolIds: ["knowledge-search"],
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
      ? PERMISSIONS.filter((permission) => permission !== "break-glass.use")
      : [],
    nextIdentityCursor: null,
    nextInvitationCursor: null,
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

  function assertCurrentVersion(current: number, expected: number): void {
    if (current !== expected) throw new Error("Work changed since it was loaded.");
  }

  function assertAssignable(identityId: string | null): void {
    if (identityId === null) return;
    const identity = directory.identities.find((candidate) => candidate.id === identityId);
    if (!identity || identity.kind === "service" || identity.status !== "active" ||
        identity.membershipState !== "active") {
      throw new Error("Work can be assigned only to an active Human or Agent.");
    }
  }

  function now(): string {
    return new Date().toISOString();
  }

  return {
    async getBootstrap() {
      return bootstrap;
    },
    async claimInvitation(input: ClaimInvitationInput) {
      bootstrap = {
        ...bootstrap,
        identityExists: true,
        membershipState: "preboarding",
        preferredLocale: input.preferredLocale,
      };
      return bootstrap;
    },
    async getDirectory() {
      if (mode !== "root") throw new Error("Directory is outside this development identity scope.");
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
      return id;
    },
    async renameSpace(spaceId, name) {
      directory = {
        ...directory,
        spaces: directory.spaces.map((space) => space.id === spaceId ? { ...space, name } : space),
      };
    },
    async archiveSpace(spaceId) {
      directory = {
        ...directory,
        spaces: directory.spaces.map((space) => space.id === spaceId
          ? { ...space, status: "archived" }
          : space),
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
          kind: "service",
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
          ? `調査依頼はResearch Spaceへ記録し、責任者・成果・機密区分・出典を確認してから割り当てます。[K1]`
          : `Record the request in the Research Space, then verify its owner, outcome, classification, and source before assignment. [K1]`,
        inferred: true,
        citations: [{
          knowledgeId: source.id,
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
    async setPreferredLocale(locale) {
      bootstrap = { ...bootstrap, preferredLocale: locale };
    },
  };
}
