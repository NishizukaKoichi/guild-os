import { RpcTarget } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_RANK,
  PERMISSIONS,
  ROOT_ONLY_PERMISSIONS,
  SUPPORTED_LOCALES,
  authorize,
  assertAgentLimits,
  assertCanDelegatePermissions,
  assertNonBlank,
  assertNonNegativeInteger,
  assertPositiveInteger,
  isAuthorized,
  validateConstitution,
  validateRolePermissions,
  type AppLocale,
  type AuthorizationSnapshot,
  type Classification,
  type Permission,
} from "@guild-os/domain";
import {
  GuildAdministrationRepository,
  GuildDirectoryRepository,
  GuildGovernanceRepository,
  GuildPostgresRepository,
  GuildRecoveryRepository,
  loadActorAuthorizationSnapshot,
  type BreakGlassStatus,
  type GuildTransactionConnection,
  withGuildTransaction,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { GuildKnowledgeService } from "./knowledge-service.js";
import { GuildWorkService } from "./work-service.js";
import { GuildDecisionService } from "./decision-service.js";
import { GuildConversationService } from "./conversation-service.js";
import { GuildCommunicationService } from "./communication-service.js";
import { GuildAgentService } from "./agent-service.js";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";
import type {
  AnnouncementTransitionRequest,
  AskGuildRequest,
  AskGuildResponse,
  AssignRoleRequest,
  ClaimInvitationInput,
  CreateAgentRequest,
  CreateAgentWebhookRunRequest,
  CreateAnnouncementRequest,
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
  MarkInboxReadRequest,
  ModerateConversationRequest,
  PostConversationMessageRequest,
  PostConversationMessageResponse,
  PublishAnnouncementResponse,
  ProposeRootOwnershipTransferRequest,
  RecoverRootOwnershipRequest,
  RedactConversationMessageRequest,
  RevokeBreakGlassCodesRequest,
  ReviewKnowledgeRequest,
  ReviewAgentRunRequest,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  ResolveRootOwnershipTransferRequest,
  RotateBreakGlassCodesRequest,
  RotatedBreakGlassCodes,
  SaveKnowledgeDraftRequest,
  SearchConversationMentionsRequest,
  SaveAnnouncementDraftRequest,
  SaveDecisionDraftRequest,
  SupersedeDecisionRequest,
  UiBootstrapState,
  UiBreakGlassStatus,
  UiConstitution,
  UiConversation,
  UiConversationMentionCandidate,
  UiConversationThread,
  UiConversationThreadRequest,
  UiAgentRunDetail,
  UiAgentRunPage,
  UiAgentRunPageRequest,
  UiAnnouncement,
  UiAnnouncementPage,
  UiAnnouncementPageRequest,
  UiChroniclePage,
  UiChroniclePageRequest,
  UiDirectory,
  UiDirectoryRequest,
  UiKnowledgeDetail,
  UiKnowledgeFile,
  UiKnowledgePage,
  UiKnowledgePageRequest,
  UiInboxPage,
  UiInboxPageRequest,
  UiDecisionDetail,
  UiDecisionPage,
  UiDecisionPageRequest,
  UiQuestDetail,
  UiRootOwnershipCandidate,
  UiRootOwnershipTransfer,
  UiWorkPage,
  UiWorkPageRequest,
  UpdateRoleRequest,
  UpdateConstitutionRequest,
  UploadKnowledgeFileRequest,
  WorkAssignmentRequest,
  WorkStatusRequest,
} from "./management-types.js";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BREAK_GLASS_CODE_PATTERN = /^gbr_[A-Za-z0-9_-]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INVITATION_DAYS = 90;
const MAX_AGENT_TOOLS = 50;
const ROOT_TRANSFER_EXPIRY_DAYS = 7;
const BREAK_GLASS_CODE_COUNT = 10;
const MIN_BREAK_GLASS_EXPIRY_DAYS = 7;
const MAX_BREAK_GLASS_EXPIRY_DAYS = 730;
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

export function generateBreakGlassCode(): string {
  return `gbr_${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export async function hashBreakGlassCode(code: string): Promise<string> {
  if (!BREAK_GLASS_CODE_PATTERN.test(code)) {
    throw new Error("Recovery code is invalid or unavailable.");
  }
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  )));
}

function toUiBreakGlassStatus(
  status: BreakGlassStatus,
  rootOwner: boolean,
  identityExists: boolean,
  membershipState: UiBootstrapState["membershipState"],
): UiBreakGlassStatus {
  const canRecover = status.available && !rootOwner &&
    (!identityExists || membershipState === "active");
  return {
    available: status.available,
    canRecover,
    version: status.version,
    currentCodeSetId: rootOwner ? status.currentCodeSetId : null,
    generation: rootOwner ? status.generation : null,
    outgoingRoleId: rootOwner ? status.outgoingRoleId : null,
    outgoingRoleName: rootOwner ? status.outgoingRoleName : null,
    reason: rootOwner ? status.reason : null,
    expiresAt: rootOwner ? status.expiresAt : null,
    createdAt: rootOwner ? status.createdAt : null,
    remainingCodeCount: rootOwner ? status.remainingCodeCount : null,
  };
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
          root_owner_display_name: string;
          preferred_locale: AppLocale | null;
          constitution_version: number;
          level2_approval_quorum: number;
          level3_approval_quorum: number;
          data_retention_days: number;
          agent_defaults: UiBootstrapState["agentDefaults"];
          updated_by_identity_id: string;
          constitution_updated_at: string;
        }>(
          `SELECT g.root_owner_identity_id::text,
                  root.display_name AS root_owner_display_name,
                  (SELECT preferred_locale FROM identities
                    WHERE guild_id = g.id AND id = $2) AS preferred_locale,
                  c.version AS constitution_version,
                  c.level2_approval_quorum,
                  c.level3_approval_quorum,
                  c.data_retention_days,
                  c.agent_defaults,
                  c.updated_by_identity_id::text,
                  c.updated_at::text AS constitution_updated_at
             FROM guilds g
             JOIN constitutions c ON c.guild_id = g.id
             JOIN identities root
               ON root.guild_id = g.id AND root.id = g.root_owner_identity_id
            WHERE g.id = $1`,
          [this.#env.GUILD_ID, this.#accountId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("Guild is not initialized.");
        const transfer = state.identityExists ? (await connection.query<{
          id: string;
          from_identity_id: string;
          to_identity_id: string;
          outgoing_role_id: string;
          state: "pending";
          reason: string;
          version: number;
          expires_at: string;
          resolved_at: null;
          created_at: string;
          updated_at: string;
          from_display_name: string;
          to_display_name: string;
          outgoing_role_name: string;
        }>(
          `SELECT transfer.id::text, transfer.from_identity_id::text,
                  transfer.to_identity_id::text, transfer.outgoing_role_id::text,
                  transfer.state, transfer.reason, transfer.version,
                  transfer.expires_at::text, transfer.resolved_at::text,
                  transfer.created_at::text, transfer.updated_at::text,
                  source.display_name AS from_display_name,
                  target.display_name AS to_display_name,
                  outgoing_role.name AS outgoing_role_name
             FROM root_ownership_transfers transfer
             JOIN identities source
               ON source.guild_id = transfer.guild_id AND source.id = transfer.from_identity_id
             JOIN identities target
               ON target.guild_id = transfer.guild_id AND target.id = transfer.to_identity_id
             JOIN roles outgoing_role
               ON outgoing_role.guild_id = transfer.guild_id
              AND outgoing_role.id = transfer.outgoing_role_id
            WHERE transfer.guild_id = $1 AND transfer.state = 'pending'
              AND transfer.expires_at > now()
              AND $2::uuid IN (transfer.from_identity_id, transfer.to_identity_id)
            ORDER BY transfer.created_at DESC LIMIT 1`,
          [this.#env.GUILD_ID, this.#accountId],
        )).rows[0] : undefined;
        const rootOwnershipTransfer: UiRootOwnershipTransfer | null = transfer ? {
          id: transfer.id,
          fromIdentityId: transfer.from_identity_id,
          toIdentityId: transfer.to_identity_id,
          outgoingRoleId: transfer.outgoing_role_id,
          state: transfer.state,
          reason: transfer.reason,
          version: transfer.version,
          expiresAt: new Date(transfer.expires_at).toISOString(),
          resolvedAt: transfer.resolved_at,
          createdAt: new Date(transfer.created_at).toISOString(),
          updatedAt: new Date(transfer.updated_at).toISOString(),
          fromDisplayName: transfer.from_display_name,
          toDisplayName: transfer.to_display_name,
          outgoingRoleName: transfer.outgoing_role_name,
        } : null;
        const rootOwner = row.root_owner_identity_id === this.#accountId;
        const breakGlass = toUiBreakGlassStatus(
          await new GuildRecoveryRepository(
            connection,
            this.#env.GUILD_ID,
          ).getBreakGlassStatus(),
          rootOwner,
          state.identityExists,
          state.membershipState,
        );
        return {
          guildId: this.#env.GUILD_ID,
          guildName: this.#env.GUILD_NAME,
          guildPurpose: this.#env.GUILD_PURPOSE,
          accountId: this.#accountId,
          identityExists: state.identityExists,
          membershipState: state.membershipState,
          rootOwner,
          rootOwnerIdentityId: row.root_owner_identity_id,
          rootOwnerDisplayName: row.root_owner_display_name,
          preferredLocale: row.preferred_locale ?? "en",
          constitution: {
            version: row.constitution_version,
            level2ApprovalQuorum: row.level2_approval_quorum,
            level3ApprovalQuorum: row.level3_approval_quorum,
            dataRetentionDays: row.data_retention_days,
            agentDefaults: row.agent_defaults,
            updatedByIdentityId: row.updated_by_identity_id,
            updatedAt: row.constitution_updated_at,
          },
          agentDefaults: row.agent_defaults,
          rootOwnershipTransfer,
          breakGlass,
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

  async rotateBreakGlassCodes(
    input: RotateBreakGlassCodesRequest,
  ): Promise<RotatedBreakGlassCodes> {
    assertNonNegativeInteger(input.expectedVersion, "Expected Break Glass version");
    assertUuid(input.outgoingRoleId, "Outgoing Role ID");
    assertPositiveInteger(input.expiresInDays, "Break Glass expiry");
    if (input.expiresInDays < MIN_BREAK_GLASS_EXPIRY_DAYS ||
        input.expiresInDays > MAX_BREAK_GLASS_EXPIRY_DAYS) {
      throw new Error("Break Glass expiry must be between 7 and 730 days.");
    }
    assertNonBlank(input.reason, "Break Glass rotation reason", 2_000);
    if (input.confirmation !== this.#env.GUILD_NAME) {
      throw new Error("Type the Guild name exactly to rotate emergency recovery codes.");
    }
    const plaintextCodes = Array.from(
      { length: BREAK_GLASS_CODE_COUNT },
      () => generateBreakGlassCode(),
    );
    if (new Set(plaintextCodes).size !== BREAK_GLASS_CODE_COUNT) {
      throw new Error("Secure recovery code generation failed. Try again.");
    }
    const codeSetId = crypto.randomUUID();
    const storedCodes = await Promise.all(plaintextCodes.map(async (code) => ({
      id: crypto.randomUUID(),
      hash: await hashBreakGlassCode(code),
      hint: code.slice(-6),
    })));
    const status = await this.#authorizedWrite(
      "constitution.update",
      async (connection, snapshot) => {
        if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
          throw new Error("Only the current human Root Owner can rotate recovery codes.");
        }
        return new GuildRecoveryRepository(
          connection,
          this.#env.GUILD_ID,
        ).rotateBreakGlassCodes({
          codeSetId,
          expectedVersion: input.expectedVersion,
          outgoingRoleId: input.outgoingRoleId,
          expiresInDays: input.expiresInDays,
          reason: input.reason,
          actorIdentityId: this.#accountId,
          codes: storedCodes,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "break_glass.codes.rotated",
            "break_glass_code_set",
            codeSetId,
            { reason: input.reason, source: "guild-ui" },
          ),
        });
      },
    );
    return {
      status: toUiBreakGlassStatus(status, true, true, "active"),
      codes: plaintextCodes,
    };
  }

  async revokeBreakGlassCodes(
    input: RevokeBreakGlassCodesRequest,
  ): Promise<UiBreakGlassStatus> {
    assertPositiveInteger(input.expectedVersion, "Expected Break Glass version");
    assertUuid(input.codeSetId, "Break Glass code set ID");
    assertNonBlank(input.reason, "Break Glass revocation reason", 2_000);
    if (input.confirmation !== this.#env.GUILD_NAME) {
      throw new Error("Type the Guild name exactly to revoke emergency recovery codes.");
    }
    const status = await this.#authorizedWrite(
      "constitution.update",
      async (connection, snapshot) => {
        if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
          throw new Error("Only the current human Root Owner can revoke recovery codes.");
        }
        return new GuildRecoveryRepository(
          connection,
          this.#env.GUILD_ID,
        ).revokeBreakGlassCodes({
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          actorIdentityId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "break_glass.codes.revoked",
            "break_glass_code_set",
            input.codeSetId,
            { reason: input.reason, source: "guild-ui" },
          ),
        });
      },
    );
    return toUiBreakGlassStatus(status, true, true, "active");
  }

  async recoverRootOwnership(
    input: RecoverRootOwnershipRequest,
  ): Promise<UiBootstrapState> {
    const rateLimit = await this.#env.RECOVERY_RATE_LIMITER.limit({ key: this.#accountId });
    if (!rateLimit.success) {
      throw new Error("Too many emergency recovery attempts. Wait before trying again.");
    }
    assertNonBlank(input.displayName, "Recovery display name");
    assertLocale(input.preferredLocale);
    assertNonBlank(input.reason, "Break Glass recovery reason", 2_000);
    if (input.confirmation !== this.#env.GUILD_NAME) {
      throw new Error("Type the Guild name exactly to use emergency recovery.");
    }
    const codeHash = await hashBreakGlassCode(input.code.trim());
    const recoveryId = crypto.randomUUID();
    const viewedInformation =
      "Guild name, current Root identity, recovery generation, and outgoing Role.";
    const changesMade =
      "Transferred Root ownership, assigned the configured Role to the previous Root, " +
      "invalidated the entire recovery generation, and superseded pending ownership transfers.";
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await new GuildRecoveryRepository(
          connection,
          this.#env.GUILD_ID,
        ).recoverRootOwnership({
          recoveryId,
          codeHash,
          accountIdentityId: this.#accountId,
          displayName: input.displayName,
          preferredLocale: input.preferredLocale,
          reason: input.reason,
          viewedInformation,
          changesMade,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "break_glass.used",
            "break_glass_recovery",
            recoveryId,
            {
              reason: input.reason,
              viewedInformation,
              changesMade,
              source: "guild-ui",
            },
          ),
        });
      },
    );
    return this.getBootstrap();
  }

  async updateConstitution(input: UpdateConstitutionRequest): Promise<UiConstitution> {
    assertPositiveInteger(input.expectedVersion, "Expected Constitution version");
    assertNonBlank(input.reason, "Constitution change reason", 2_000);
    validateConstitution({
      guildId: this.#env.GUILD_ID,
      version: input.expectedVersion + 1,
      level2ApprovalQuorum: input.level2ApprovalQuorum,
      level3ApprovalQuorum: input.level3ApprovalQuorum,
      dataRetentionDays: input.dataRetentionDays,
      agentDefaults: input.agentDefaults,
      updatedByIdentityId: this.#accountId,
      updatedAt: new Date().toISOString(),
    });
    const updated = await this.#authorizedWrite(
      "constitution.update",
      async (connection, snapshot) => {
        if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
          throw new Error("Only the current human Root Owner can update the Constitution.");
        }
        return new GuildGovernanceRepository(
          connection,
          this.#env.GUILD_ID,
        ).updateConstitution({
          expectedVersion: input.expectedVersion,
          level2ApprovalQuorum: input.level2ApprovalQuorum,
          level3ApprovalQuorum: input.level3ApprovalQuorum,
          dataRetentionDays: input.dataRetentionDays,
          agentDefaults: input.agentDefaults,
          reason: input.reason,
          actorIdentityId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "constitution.updated",
            "constitution",
            this.#env.GUILD_ID,
            {
              previousVersion: input.expectedVersion,
              nextVersion: input.expectedVersion + 1,
              reason: input.reason,
              source: "guild-ui",
            },
          ),
        });
      },
    );
    const { guildId: _guildId, ...constitution } = updated;
    return constitution;
  }

  async proposeRootOwnershipTransfer(
    input: ProposeRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState> {
    assertUuid(input.toIdentityId, "Target Identity ID");
    assertUuid(input.outgoingRoleId, "Outgoing Role ID");
    assertNonBlank(input.reason, "Root ownership transfer reason", 2_000);
    assertNonBlank(input.confirmation, "Root ownership transfer confirmation", 200);
    const transferId = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + ROOT_TRANSFER_EXPIRY_DAYS * 86_400_000,
    ).toISOString();
    await this.#authorizedWrite("constitution.update", async (connection, snapshot) => {
      if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
        throw new Error("Only the current human Root Owner can propose a transfer.");
      }
      const target = (await connection.query<{ display_name: string }>(
        `SELECT identity_row.display_name
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
          WHERE identity_row.guild_id = $1 AND identity_row.id = $2
            AND identity_row.kind = 'human' AND identity_row.status = 'active'
            AND membership_row.state = 'active'`,
        [this.#env.GUILD_ID, input.toIdentityId],
      )).rows[0];
      if (!target || input.confirmation !== target.display_name) {
        throw new Error("Type the selected Human's display name exactly to confirm the transfer.");
      }
      await new GuildGovernanceRepository(
        connection,
        this.#env.GUILD_ID,
      ).proposeRootOwnershipTransfer({
        id: transferId,
        toIdentityId: input.toIdentityId,
        outgoingRoleId: input.outgoingRoleId,
        reason: input.reason,
        expiresAt,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "root_ownership.transfer.proposed",
          "root_ownership_transfer",
          transferId,
          {
            toIdentityId: input.toIdentityId,
            outgoingRoleId: input.outgoingRoleId,
            reason: input.reason,
            expiresAt,
            source: "guild-ui",
          },
        ),
      });
    });
    return this.getBootstrap();
  }

  async cancelRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState> {
    assertUuid(input.transferId, "Root ownership transfer ID");
    assertPositiveInteger(input.expectedVersion, "Expected transfer version");
    assertNonBlank(input.reason, "Root ownership cancellation reason", 2_000);
    if (input.confirmation !== this.#env.GUILD_NAME) {
      throw new Error("Type the Guild name exactly to cancel the transfer.");
    }
    await this.#authorizedWrite("constitution.update", async (connection, snapshot) => {
      if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
        throw new Error("Only the current human Root Owner can cancel the transfer.");
      }
      await new GuildGovernanceRepository(
        connection,
        this.#env.GUILD_ID,
      ).cancelRootOwnershipTransfer({
        transferId: input.transferId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        actorIdentityId: this.#accountId,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "root_ownership.transfer.cancelled",
          "root_ownership_transfer",
          input.transferId,
          { reason: input.reason, source: "guild-ui" },
        ),
      });
    });
    return this.getBootstrap();
  }

  async acceptRootOwnershipTransfer(
    input: ResolveRootOwnershipTransferRequest,
  ): Promise<UiBootstrapState> {
    assertUuid(input.transferId, "Root ownership transfer ID");
    assertPositiveInteger(input.expectedVersion, "Expected transfer version");
    assertNonBlank(input.reason, "Root ownership acceptance reason", 2_000);
    if (input.confirmation !== this.#env.GUILD_NAME) {
      throw new Error("Type the Guild name exactly to accept Root ownership.");
    }
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await new GuildGovernanceRepository(
          connection,
          this.#env.GUILD_ID,
        ).acceptRootOwnershipTransfer({
          transferId: input.transferId,
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          actorIdentityId: this.#accountId,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "root_ownership.transfer.accepted",
            "root_ownership_transfer",
            input.transferId,
            { reason: input.reason, source: "guild-ui" },
          ),
        });
      },
    );
    return this.getBootstrap();
  }

  async searchRootOwnershipCandidates(
    search: string,
  ): Promise<readonly UiRootOwnershipCandidate[]> {
    if (typeof search !== "string" || search.length > 100) {
      throw new Error("Successor search must be at most 100 characters.");
    }
    const prefix = search.trim();
    return this.#authorizedWrite("constitution.update", async (connection, snapshot) => {
      if (snapshot.guild.rootOwnerIdentityId !== this.#accountId) {
        throw new Error("Only the current human Root Owner can search transfer candidates.");
      }
      const result = await connection.query<{ id: string; display_name: string }>(
        `SELECT identity_row.id::text, identity_row.display_name
           FROM identities identity_row
           JOIN memberships membership_row
             ON membership_row.guild_id = identity_row.guild_id
            AND membership_row.identity_id = identity_row.id
          WHERE identity_row.guild_id = $1
            AND identity_row.id <> $2
            AND identity_row.kind = 'human' AND identity_row.status = 'active'
            AND membership_row.state = 'active'
            AND ($3 = '' OR lower(identity_row.display_name) LIKE lower($3) || '%')
          ORDER BY lower(identity_row.display_name), identity_row.id
          LIMIT 25`,
        [this.#env.GUILD_ID, this.#accountId, prefix],
      );
      return result.rows.map((row) => ({ id: row.id, displayName: row.display_name }));
    });
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
          grantablePermissions: PERMISSIONS.filter((permission) =>
            !ROOT_ONLY_PERMISSIONS.has(permission) && this.#can(snapshot, permission)),
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
    if (["suspended", "departed"].includes(nextState)) {
      await drainAgentWorkflowOutbox(this.#env);
    }
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
    if (["suspended", "departed"].includes(nextState)) {
      await drainAgentWorkflowOutbox(this.#env);
    }
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

  getConversationThread(request: UiConversationThreadRequest): Promise<UiConversationThread> {
    return new GuildConversationService(this.#env, this.#accountId).getThread(request);
  }

  postConversationMessage(
    input: PostConversationMessageRequest,
  ): Promise<PostConversationMessageResponse> {
    return new GuildConversationService(this.#env, this.#accountId).post(input);
  }

  moderateConversation(input: ModerateConversationRequest): Promise<UiConversation> {
    return new GuildConversationService(this.#env, this.#accountId).moderate(input);
  }

  redactConversationMessage(input: RedactConversationMessageRequest): Promise<number> {
    return new GuildConversationService(this.#env, this.#accountId).redact(input);
  }

  searchConversationMentions(
    input: SearchConversationMentionsRequest,
  ): Promise<readonly UiConversationMentionCandidate[]> {
    return new GuildConversationService(this.#env, this.#accountId).searchMentions(input);
  }

  getAnnouncementPage(request: UiAnnouncementPageRequest = {}): Promise<UiAnnouncementPage> {
    return new GuildCommunicationService(this.#env, this.#accountId).getAnnouncementPage(request);
  }

  getAnnouncement(announcementId: string): Promise<UiAnnouncement> {
    return new GuildCommunicationService(this.#env, this.#accountId).getAnnouncement(announcementId);
  }

  createAnnouncement(input: CreateAnnouncementRequest): Promise<string> {
    return new GuildCommunicationService(this.#env, this.#accountId).createAnnouncement(input);
  }

  saveAnnouncementDraft(input: SaveAnnouncementDraftRequest): Promise<number> {
    return new GuildCommunicationService(this.#env, this.#accountId).saveAnnouncementDraft(input);
  }

  publishAnnouncement(
    input: AnnouncementTransitionRequest,
  ): Promise<PublishAnnouncementResponse> {
    return new GuildCommunicationService(this.#env, this.#accountId).publishAnnouncement(input);
  }

  archiveAnnouncement(input: AnnouncementTransitionRequest): Promise<number> {
    return new GuildCommunicationService(this.#env, this.#accountId).archiveAnnouncement(input);
  }

  getInboxPage(request: UiInboxPageRequest = {}): Promise<UiInboxPage> {
    return new GuildCommunicationService(this.#env, this.#accountId).getInboxPage(request);
  }

  markInboxRead(input: MarkInboxReadRequest): Promise<string | null> {
    return new GuildCommunicationService(this.#env, this.#accountId).markInboxRead(input);
  }

  markAllInboxRead(): Promise<number> {
    return new GuildCommunicationService(this.#env, this.#accountId).markAllInboxRead();
  }

  getChroniclePage(request: UiChroniclePageRequest = {}): Promise<UiChroniclePage> {
    return new GuildCommunicationService(this.#env, this.#accountId).getChroniclePage(request);
  }

  getAgentRunPage(request: UiAgentRunPageRequest = {}): Promise<UiAgentRunPage> {
    return new GuildAgentService(this.#env, this.#accountId).getPage(request);
  }

  getAgentRun(runId: string): Promise<UiAgentRunDetail> {
    return new GuildAgentService(this.#env, this.#accountId).getRun(runId);
  }

  async createAgentWebhookRun(input: CreateAgentWebhookRunRequest): Promise<string> {
    const runId = await new GuildAgentService(this.#env, this.#accountId).createRun(input);
    await drainAgentWorkflowOutbox(this.#env);
    return runId;
  }

  async reviewAgentRun(input: ReviewAgentRunRequest): Promise<void> {
    await new GuildAgentService(this.#env, this.#accountId).review(input);
    await drainAgentWorkflowOutbox(this.#env);
  }

  async killAgentRun(runId: string): Promise<void> {
    await new GuildAgentService(this.#env, this.#accountId).kill(runId);
    await drainAgentWorkflowOutbox(this.#env);
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
