import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_RANK,
  PERMISSIONS,
  SUPPORTED_LOCALES,
  authorize,
  assertAgentLimits,
  assertCanDelegatePermissions,
  assertNonBlank,
  isAuthorized,
  validateRolePermissions,
  type AppLocale,
  type AuthorizationSnapshot,
  type Classification,
  type Permission,
} from "@guild-os/domain";
import {
  GuildAdministrationRepository,
  GuildDirectoryRepository,
  GuildPostgresRepository,
  loadActorAuthorizationSnapshot,
  type GuildTransactionConnection,
  withGuildTransaction,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { GuildKnowledgeService } from "./knowledge-service.js";
import { GuildWorkService } from "./work-service.js";
import { GuildDecisionService } from "./decision-service.js";
import type {
  AskGuildRequest,
  AskGuildResponse,
  AssignRoleRequest,
  ClaimInvitationInput,
  CreateAgentRequest,
  CreateDecisionRequest,
  CreateGoalRequest,
  CreateKnowledgeRequest,
  CreateProjectRequest,
  CreateQuestRequest,
  CreateRoleRequest,
  CreateServiceRequest,
  CreateSpaceRequest,
  CreateStepRequest,
  DecisionTransitionRequest,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  KnowledgeTransitionRequest,
  ReviewKnowledgeRequest,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  SaveKnowledgeDraftRequest,
  SaveDecisionDraftRequest,
  SupersedeDecisionRequest,
  UiBootstrapState,
  UiDirectory,
  UiDirectoryRequest,
  UiKnowledgeDetail,
  UiKnowledgeFile,
  UiKnowledgePage,
  UiKnowledgePageRequest,
  UiDecisionDetail,
  UiDecisionPage,
  UiDecisionPageRequest,
  UiQuestDetail,
  UiWorkPage,
  UiWorkPageRequest,
  UpdateRoleRequest,
  UploadKnowledgeFileRequest,
  WorkAssignmentRequest,
  WorkStatusRequest,
} from "./management-types.js";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INVITATION_DAYS = 90;
const MAX_AGENT_TOOLS = 50;
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(value: Readonly<object> | null): string | null {
  return value === null ? null : bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeCursor<T extends Readonly<Record<string, string>>>(
  value: string | null | undefined,
  fields: readonly (keyof T)[],
): T | null {
  if (!value) return null;
  if (value.length > 1000) throw new Error("Directory cursor is malformed.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object" || !fields.every((field) =>
      typeof (parsed as Record<string, unknown>)[String(field)] === "string")) {
      throw new Error("invalid cursor shape");
    }
    return parsed as T;
  } catch {
    throw new Error("Directory cursor is malformed.");
  }
}

export function generateInvitationToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashInvitationToken(token: string): Promise<string> {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    throw new Error("Invitation token is malformed.");
  }
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  )));
}

function assertLocale(locale: AppLocale): void {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    throw new Error("Unsupported locale.");
  }
}

function assertInvitationDays(days: number): void {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_INVITATION_DAYS) {
    throw new Error(`Invitation expiry must be between 1 and ${MAX_INVITATION_DAYS} days.`);
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertClassification(value: Classification): void {
  if (!(CLASSIFICATIONS as readonly string[]).includes(value)) {
    throw new Error("Classification is invalid.");
  }
}

function assertRolePermissions(permissions: readonly Permission[]): void {
  if (!Array.isArray(permissions) || !permissions.every((permission) =>
    KNOWN_PERMISSIONS.has(permission))) {
    throw new Error("Role contains an unknown permission.");
  }
  validateRolePermissions(permissions);
}

function assertAgentInput(input: CreateAgentRequest): void {
  assertNonBlank(input.displayName, "Agent display name");
  assertNonBlank(input.instructions, "Agent instructions", 20_000);
  assertNonBlank(input.model, "Agent model");
  assertClassification(input.clearance);
  assertUuid(input.roleId, "Role ID");
  if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
  if (!Array.isArray(input.toolIds) || input.toolIds.length > MAX_AGENT_TOOLS ||
      new Set(input.toolIds).size !== input.toolIds.length) {
    throw new Error(`Agent tools must contain at most ${MAX_AGENT_TOOLS} unique IDs.`);
  }
  for (const toolId of input.toolIds) assertNonBlank(toolId, "Agent tool ID");
  assertAgentLimits(input.limits);
}

@validateRpc()
export class GuildManagementApiImpl extends RpcTarget implements GuildUiApi {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    super();
    this.#env = env;
    this.#accountId = accountId;
  }

  async getBootstrap(): Promise<UiBootstrapState> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildPostgresRepository(connection, this.#env.GUILD_ID);
        const state = await repository.getSetupState(this.#accountId);
        const result = await connection.query<{
          root_owner_identity_id: string;
          preferred_locale: AppLocale | null;
          agent_defaults: UiBootstrapState["agentDefaults"];
        }>(
          `SELECT g.root_owner_identity_id::text,
                  (SELECT preferred_locale FROM identities
                    WHERE guild_id = g.id AND id = $2) AS preferred_locale,
                  c.agent_defaults
             FROM guilds g
             JOIN constitutions c ON c.guild_id = g.id
            WHERE g.id = $1`,
          [this.#env.GUILD_ID, this.#accountId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Guild is not initialized.");
        return {
          guildId: this.#env.GUILD_ID,
          guildName: this.#env.GUILD_NAME,
          guildPurpose: this.#env.GUILD_PURPOSE,
          accountId: this.#accountId,
          identityExists: state.identityExists,
          membershipState: state.membershipState,
          rootOwner: row.root_owner_identity_id === this.#accountId,
          rootOwnerIdentityId: row.root_owner_identity_id,
          preferredLocale: row.preferred_locale ?? "en",
          agentDefaults: row.agent_defaults,
        };
      },
    );
  }

  async claimInvitation(input: ClaimInvitationInput): Promise<UiBootstrapState> {
    assertNonBlank(input.displayName, "Display name");
    assertLocale(input.preferredLocale);
    const tokenHash = await hashInvitationToken(input.token);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const directory = new GuildDirectoryRepository(connection, this.#env.GUILD_ID);
        await directory.claimInvitation({
          tokenHash,
          identityId: this.#accountId,
          displayName: input.displayName,
          preferredLocale: input.preferredLocale,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "membership.invitation.accepted",
            "identity",
            this.#accountId,
            { source: "guild-ui" },
          ),
        });
      },
    );
    return this.getBootstrap();
  }

  async getDirectory(request: UiDirectoryRequest = {}): Promise<UiDirectory> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        for (const permission of [
          "identity.read",
          "membership.read",
          "role.read",
          "space.read",
        ] as const) {
          authorize(snapshot, { actorIdentityId: this.#accountId, permission });
        }
        const capabilities = {
          manageMemberships: this.#can(snapshot, "membership.manage"),
          manageRoles: this.#can(snapshot, "role.manage"),
          manageSpaces: this.#can(snapshot, "space.manage"),
          manageIdentities: this.#can(snapshot, "identity.manage"),
          manageAgents: this.#can(snapshot, "agent.manage"),
          stopAgents: this.#can(snapshot, "agent.stop"),
        };
        const identityCursor = decodeCursor<{ displayName: string; id: string }>(
          request.identityCursor,
          ["displayName", "id"],
        );
        const invitationCursor = decodeCursor<{ createdAt: string; id: string }>(
          request.invitationCursor,
          ["createdAt", "id"],
        );
        if (identityCursor) assertUuid(identityCursor.id, "Identity cursor ID");
        if (invitationCursor) assertUuid(invitationCursor.id, "Invitation cursor ID");
        const directory = await new GuildDirectoryRepository(
          connection,
          this.#env.GUILD_ID,
        ).listDirectory({
          identityCursor,
          invitationCursor,
          includeIdentities: request.includeIdentities !== false,
          includeInvitations: capabilities.manageMemberships && request.includeInvitations !== false,
        });
        return {
          ...directory,
          nextIdentityCursor: encodeCursor(directory.nextIdentityCursor),
          nextInvitationCursor: encodeCursor(directory.nextInvitationCursor),
          capabilities,
          grantablePermissions: PERMISSIONS.filter((permission) => this.#can(snapshot, permission)),
        };
      },
    );
  }

  async issueInvitation(input: IssueInvitationInput): Promise<IssuedInvitation> {
    assertNonBlank(input.inviteeLabel, "Invitee label");
    assertUuid(input.roleId, "Role ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
    if (input.initialMembershipState !== "preboarding" && input.initialMembershipState !== "active") {
      throw new Error("Initial membership state is invalid.");
    }
    assertInvitationDays(input.expiresInDays);
    const invitationId = crypto.randomUUID();
    const token = generateInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const invitation = await this.#authorizedWrite(
      "membership.manage",
      async (connection, snapshot) => {
        await this.#assertCanGrantRole(connection, snapshot, input.roleId);
        return new GuildDirectoryRepository(connection, this.#env.GUILD_ID).createInvitation({
        id: invitationId,
        tokenHash,
        inviteeLabel: input.inviteeLabel,
        roleId: input.roleId,
        spaceId: input.spaceId,
        initialMembershipState: input.initialMembershipState,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString(),
        createdByIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "membership.invitation.created",
          "invitation",
          invitationId,
          {
            roleId: input.roleId,
            spaceId: input.spaceId,
            initialMembershipState: input.initialMembershipState,
          },
        ),
        });
      },
    );
    return { invitation, token };
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    assertUuid(invitationId, "Invitation ID");
    await this.#authorizedWrite("membership.manage", async (connection) => {
      await new GuildDirectoryRepository(connection, this.#env.GUILD_ID).revokeInvitation(
        invitationId,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "membership.invitation.revoked",
          "invitation",
          invitationId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async changeMembership(
    identityId: string,
    nextState: "preboarding" | "active" | "suspended" | "departed",
  ): Promise<void> {
    assertUuid(identityId, "Identity ID");
    if (!["preboarding", "active", "suspended", "departed"].includes(nextState)) {
      throw new Error("Membership state is invalid.");
    }
    await this.#authorizedWrite("membership.manage", async (connection) => {
      const kind = await this.#loadIdentityKind(connection, identityId);
      if (kind !== "human") throw new Error("Use the Agent or Service lifecycle operation.");
      await new GuildDirectoryRepository(connection, this.#env.GUILD_ID).changeMembership({
        actorIdentityId: this.#accountId,
        identityId,
        nextState,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          `membership.${nextState}`,
          "identity",
          identityId,
          { source: "guild-ui" },
        ),
      });
    });
  }

  async createRole(input: CreateRoleRequest): Promise<string> {
    assertNonBlank(input.name, "Role name", 100);
    assertRolePermissions(input.permissions);
    const roleId = crypto.randomUUID();
    await this.#authorizedWrite("role.manage", async (connection, snapshot) => {
      this.#assertCanGrantPermissions(snapshot, input.permissions);
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).createRole({
        id: roleId,
        name: input.name,
        permissions: input.permissions,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "role.created",
          "role",
          roleId,
          { permissionCount: input.permissions.length, source: "guild-ui" },
        ),
      });
    });
    return roleId;
  }

  async updateRole(input: UpdateRoleRequest): Promise<void> {
    assertUuid(input.roleId, "Role ID");
    assertNonBlank(input.name, "Role name", 100);
    assertRolePermissions(input.permissions);
    await this.#authorizedWrite("role.manage", async (connection, snapshot) => {
      this.#assertCanGrantPermissions(snapshot, input.permissions);
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).updateRole({
        roleId: input.roleId,
        name: input.name,
        permissions: input.permissions,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "role.updated",
          "role",
          input.roleId,
          { permissionCount: input.permissions.length, source: "guild-ui" },
        ),
      });
    });
  }

  async deleteRole(roleId: string): Promise<void> {
    assertUuid(roleId, "Role ID");
    await this.#authorizedWrite("role.manage", async (connection) => {
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).deleteRole(
        roleId,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "role.deleted",
          "role",
          roleId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async createSpace(input: CreateSpaceRequest): Promise<string> {
    assertNonBlank(input.name, "Space name");
    assertUuid(input.parentSpaceId, "Parent Space ID");
    const spaceId = crypto.randomUUID();
    await this.#authorizedWrite("space.manage", async (connection) => {
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).createSpace({
        id: spaceId,
        parentSpaceId: input.parentSpaceId,
        name: input.name,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "space.created",
          "space",
          spaceId,
          { parentSpaceId: input.parentSpaceId, source: "guild-ui" },
        ),
      });
    });
    return spaceId;
  }

  async renameSpace(spaceId: string, name: string): Promise<void> {
    assertUuid(spaceId, "Space ID");
    assertNonBlank(name, "Space name");
    await this.#authorizedWrite("space.manage", async (connection) => {
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).renameSpace(
        spaceId,
        name,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "space.renamed",
          "space",
          spaceId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async archiveSpace(spaceId: string): Promise<void> {
    assertUuid(spaceId, "Space ID");
    await this.#authorizedWrite("space.manage", async (connection) => {
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).archiveSpace(
        spaceId,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "space.archived",
          "space",
          spaceId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async assignRole(input: AssignRoleRequest): Promise<void> {
    assertUuid(input.identityId, "Identity ID");
    assertUuid(input.roleId, "Role ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
    const bindingId = crypto.randomUUID();
    await this.#authorizedWrite("role.manage", async (connection, snapshot) => {
      await this.#assertCanGrantRole(connection, snapshot, input.roleId);
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).assignRole({
        bindingId,
        identityId: input.identityId,
        roleId: input.roleId,
        spaceId: input.spaceId,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "role.assigned",
          "role_binding",
          bindingId,
          {
            identityId: input.identityId,
            roleId: input.roleId,
            spaceId: input.spaceId,
            source: "guild-ui",
          },
        ),
      });
    });
  }

  async removeRoleBinding(bindingId: string): Promise<void> {
    assertUuid(bindingId, "Role binding ID");
    await this.#authorizedWrite("role.manage", async (connection) => {
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).removeRoleBinding(
        bindingId,
        this.#accountId,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "role.unassigned",
          "role_binding",
          bindingId,
          { source: "guild-ui" },
        ),
      );
    });
  }

  async createAgent(input: CreateAgentRequest): Promise<string> {
    assertAgentInput(input);
    const identityId = crypto.randomUUID();
    await this.#authorizedWrite(["agent.manage", "role.manage"], async (connection, snapshot) => {
      this.#assertCanAssignClassification(snapshot, input.clearance);
      await this.#assertCanGrantRole(connection, snapshot, input.roleId);
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).createAgent({
        identityId,
        ...input,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "agent.created",
          "identity",
          identityId,
          { model: input.model, source: "guild-ui" },
        ),
      });
    });
    return identityId;
  }

  async createService(input: CreateServiceRequest): Promise<string> {
    assertNonBlank(input.displayName, "Service display name");
    assertClassification(input.clearance);
    assertUuid(input.roleId, "Role ID");
    if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
    const identityId = crypto.randomUUID();
    await this.#authorizedWrite(["identity.manage", "role.manage"], async (connection, snapshot) => {
      this.#assertCanAssignClassification(snapshot, input.clearance);
      await this.#assertCanGrantRole(connection, snapshot, input.roleId);
      await new GuildAdministrationRepository(connection, this.#env.GUILD_ID).createService({
        identityId,
        ...input,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "service.created",
          "identity",
          identityId,
          { source: "guild-ui" },
        ),
      });
    });
    return identityId;
  }

  async changeMachineMembership(
    identityId: string,
    nextState: "active" | "suspended" | "departed",
  ): Promise<void> {
    assertUuid(identityId, "Identity ID");
    if (!["active", "suspended", "departed"].includes(nextState)) {
      throw new Error("Machine membership state is invalid.");
    }
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        const kind = await this.#loadIdentityKind(connection, identityId);
        if (kind === "human") throw new Error("Use the Human membership lifecycle operation.");
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: kind === "agent" ? "agent.stop" : "identity.manage",
        });
        await new GuildDirectoryRepository(connection, this.#env.GUILD_ID).changeMembership({
          actorIdentityId: this.#accountId,
          identityId,
          nextState,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            `${kind}.${nextState}`,
            "identity",
            identityId,
            { source: "guild-ui" },
          ),
        });
      },
    );
  }

  getKnowledgePage(request: UiKnowledgePageRequest = {}): Promise<UiKnowledgePage> {
    return new GuildKnowledgeService(this.#env, this.#accountId).getPage(request);
  }

  getKnowledge(knowledgeId: string): Promise<UiKnowledgeDetail> {
    return new GuildKnowledgeService(this.#env, this.#accountId).getKnowledge(knowledgeId);
  }

  createKnowledge(input: CreateKnowledgeRequest): Promise<string> {
    return new GuildKnowledgeService(this.#env, this.#accountId).create(input);
  }

  saveKnowledgeDraft(input: SaveKnowledgeDraftRequest): Promise<number> {
    return new GuildKnowledgeService(this.#env, this.#accountId).saveDraft(input);
  }

  startKnowledgeRevision(input: KnowledgeTransitionRequest): Promise<number> {
    return new GuildKnowledgeService(this.#env, this.#accountId).startRevision(input);
  }

  proposeKnowledge(input: KnowledgeTransitionRequest): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).propose(input);
  }

  reviewKnowledge(input: ReviewKnowledgeRequest): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).review(input);
  }

  archiveKnowledge(input: KnowledgeTransitionRequest): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).archive(input);
  }

  deprecateKnowledge(input: KnowledgeTransitionRequest): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).deprecate(input);
  }

  acknowledgeKnowledge(input: KnowledgeTransitionRequest): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).acknowledge(input);
  }

  uploadKnowledgeFile(input: UploadKnowledgeFileRequest): Promise<UiKnowledgeFile> {
    return new GuildKnowledgeService(this.#env, this.#accountId).uploadFile(input);
  }

  downloadKnowledgeFile(fileId: string): Promise<Blob> {
    return new GuildKnowledgeService(this.#env, this.#accountId).downloadFile(fileId);
  }

  deleteKnowledgeFile(
    input: KnowledgeTransitionRequest & { fileId: string },
  ): Promise<void> {
    return new GuildKnowledgeService(this.#env, this.#accountId).deleteFile(input);
  }

  askGuild(input: AskGuildRequest): Promise<AskGuildResponse> {
    return new GuildKnowledgeService(this.#env, this.#accountId).ask(input);
  }

  getWorkPage(request: UiWorkPageRequest = {}): Promise<UiWorkPage> {
    return new GuildWorkService(this.#env, this.#accountId).getPage(request);
  }

  getQuestDetail(questId: string): Promise<UiQuestDetail> {
    return new GuildWorkService(this.#env, this.#accountId).getQuestDetail(questId);
  }

  createGoal(input: CreateGoalRequest): Promise<string> {
    return new GuildWorkService(this.#env, this.#accountId).createGoal(input);
  }

  createProject(input: CreateProjectRequest): Promise<string> {
    return new GuildWorkService(this.#env, this.#accountId).createProject(input);
  }

  createQuest(input: CreateQuestRequest): Promise<string> {
    return new GuildWorkService(this.#env, this.#accountId).createQuest(input);
  }

  createStep(input: CreateStepRequest): Promise<string> {
    return new GuildWorkService(this.#env, this.#accountId).createStep(input);
  }

  changeWorkStatus(input: WorkStatusRequest): Promise<number> {
    return new GuildWorkService(this.#env, this.#accountId).changeStatus(input);
  }

  assignWork(input: WorkAssignmentRequest): Promise<number> {
    return new GuildWorkService(this.#env, this.#accountId).assign(input);
  }

  getDecisionPage(request: UiDecisionPageRequest = {}): Promise<UiDecisionPage> {
    return new GuildDecisionService(this.#env, this.#accountId).getPage(request);
  }

  getDecision(decisionId: string): Promise<UiDecisionDetail> {
    return new GuildDecisionService(this.#env, this.#accountId).getDecision(decisionId);
  }

  createDecision(input: CreateDecisionRequest): Promise<string> {
    return new GuildDecisionService(this.#env, this.#accountId).create(input);
  }

  saveDecisionDraft(input: SaveDecisionDraftRequest): Promise<number> {
    return new GuildDecisionService(this.#env, this.#accountId).saveDraft(input);
  }

  proposeDecision(input: DecisionTransitionRequest): Promise<number> {
    return new GuildDecisionService(this.#env, this.#accountId).propose(input);
  }

  reviewDecision(input: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
    return new GuildDecisionService(this.#env, this.#accountId).review(input);
  }

  supersedeDecision(input: SupersedeDecisionRequest): Promise<number> {
    return new GuildDecisionService(this.#env, this.#accountId).supersede(input);
  }

  async setPreferredLocale(locale: AppLocale): Promise<void> {
    assertLocale(locale);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const result = await connection.query(
          `UPDATE identities i
              SET preferred_locale = $3
             FROM memberships m
            WHERE i.guild_id = $1 AND i.id = $2 AND i.status = 'active'
              AND m.guild_id = i.guild_id AND m.identity_id = i.id
              AND m.state IN ('preboarding', 'active')`,
          [this.#env.GUILD_ID, this.#accountId, locale],
        );
        if (result.rowCount !== 1) throw new Error("Active Guild identity was not found.");
      },
    );
  }

  async #authorizedWrite<T>(
    permission: Permission | readonly Permission[],
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        for (const required of Array.isArray(permission) ? permission : [permission]) {
          authorize(snapshot, { actorIdentityId: this.#accountId, permission: required });
        }
        return operation(connection, snapshot);
      },
    );
  }

  #can(snapshot: AuthorizationSnapshot, permission: Permission): boolean {
    return isAuthorized(snapshot, { actorIdentityId: this.#accountId, permission });
  }

  #assertCanGrantPermissions(
    snapshot: AuthorizationSnapshot,
    permissions: readonly Permission[],
  ): void {
    assertCanDelegatePermissions(snapshot, this.#accountId, permissions);
  }

  async #assertCanGrantRole(
    connection: GuildTransactionConnection,
    snapshot: AuthorizationSnapshot,
    roleId: string,
  ): Promise<void> {
    const result = await connection.query<{ permission: string }>(
      `SELECT rp.permission
         FROM roles r
         JOIN role_permissions rp ON rp.guild_id = r.guild_id AND rp.role_id = r.id
        WHERE r.guild_id = $1 AND r.id = $2`,
      [this.#env.GUILD_ID, roleId],
    );
    if (result.rows.length === 0) throw new Error("Role was not found.");
    const permissions = result.rows.map((row) => row.permission);
    if (!permissions.every((permission) => KNOWN_PERMISSIONS.has(permission))) {
      throw new Error("Role contains an unknown permission.");
    }
    this.#assertCanGrantPermissions(snapshot, permissions as Permission[]);
  }

  #assertCanAssignClassification(
    snapshot: AuthorizationSnapshot,
    classification: Classification,
  ): void {
    const membership = snapshot.memberships.find((candidate) =>
      candidate.identityId === this.#accountId);
    if (!membership || CLASSIFICATION_RANK[membership.clearance] <
        CLASSIFICATION_RANK[classification]) {
      throw new Error("You cannot assign a classification above your own clearance.");
    }
  }

  async #loadIdentityKind(
    connection: GuildTransactionConnection,
    identityId: string,
  ): Promise<"human" | "agent" | "service"> {
    const result = await connection.query<{ kind: "human" | "agent" | "service" }>(
      "SELECT kind FROM identities WHERE guild_id = $1 AND id = $2",
      [this.#env.GUILD_ID, identityId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Identity was not found.");
    return row.kind;
  }
}
