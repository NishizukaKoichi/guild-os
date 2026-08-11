import type {
  ClaimInvitationInput,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  UiBootstrapState,
  UiDirectory,
} from "../src/management-types";

const guildId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9a";
const rootId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9b";
const memberId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9c";
const agentId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9d";
const adminRoleId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9e";
const memberRoleId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555a9f";
const rootSpaceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa0";
const researchSpaceId = "018f1f3e-7b5a-7d40-8f43-4fe1dc555aa1";

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
      { id: adminRoleId, name: "Admin", system: true, permissions: ["guild.read", "membership.manage"] },
      { id: memberRoleId, name: "Member", system: true, permissions: ["guild.read", "space.read"] },
    ],
    roleBindings: [
      { id: "binding-root", identityId: rootId, roleId: adminRoleId, spaceId: null },
      { id: "binding-member", identityId: memberId, roleId: memberRoleId, spaceId: researchSpaceId },
      { id: "binding-agent", identityId: agentId, roleId: memberRoleId, spaceId: researchSpaceId },
    ],
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
    canManageMemberships: mode === "root",
    nextIdentityCursor: null,
    nextInvitationCursor: null,
  };

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
    async setPreferredLocale(locale) {
      bootstrap = { ...bootstrap, preferredLocale: locale };
    },
  };
}
