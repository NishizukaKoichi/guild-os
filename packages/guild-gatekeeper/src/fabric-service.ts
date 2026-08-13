import {
  CLASSIFICATIONS,
  assertNonBlank,
  authorize,
  isAuthorized,
  type AuthorizationSnapshot,
  type Classification,
  type EmergencyPrivateAccessGrant,
  type OnboardingAssignment,
  type OnboardingPath,
  type OnboardingRequirement,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildFabricRepository,
  GuildFabricGovernanceRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type ContributionProfile,
  type GuildTransactionConnection,
  type HandoverDetail,
  type OnboardingAssignmentDetail,
  type OnboardingPathDetail,
  type PrivateThreadDetail,
  type PrivateThreadSummary,
} from "@guild-os/postgres";
import { drainAgentWorkflowOutbox } from "./agent-dispatch.js";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { GuildFabricGovernanceService } from "./fabric-governance-service.js";
import { offboardLifecycleActor } from "./lifecycle-service.js";
import type {
  AssignOnboardingRequest,
  BeginEmergencyPrivateAccessRequest,
  CloseEmergencyPrivateAccessRequest,
  CompleteHandoverItemRequest,
  CompleteOnboardingRequirementRequest,
  CreateOnboardingPathRequest,
  CreatePrivateThreadRequest,
  OffboardActorRequest,
  PostPrivateMessageRequest,
  RequestContributionCorrectionInput,
  UiActorReference,
  UiContributionProfile,
  UiGovernedContributionCorrection,
  UiHandover,
  UiLifecyclePage,
  UiOnboardingAssignmentDetail,
  UiOnboardingPath,
  UiPrivatePage,
  UiPrivateMessagePromotion,
  UiPrivateThread,
  UiPrivateThreadDetail,
} from "./management-types.js";
import { assertRecentReauthentication } from "./reauthentication.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRIVATE_PARTICIPANTS = 19;
const MAX_EMERGENCY_MINUTES = 60;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertOptionalUuid(value: string | null, field: string): void {
  if (value !== null) assertUuid(value, field);
}

function assertClassification(value: Classification): void {
  if (!(CLASSIFICATIONS as readonly string[]).includes(value)) {
    throw new Error("Classification is invalid.");
  }
}

function privateThreadForUi(thread: PrivateThreadSummary): UiPrivateThread {
  const { guildId: _guildId, ...rest } = thread;
  return rest;
}

function privatePromotionForUi(
  promotion: Awaited<ReturnType<GuildFabricGovernanceRepository["listPrivateMessagePromotions"]>>[number],
): UiPrivateMessagePromotion {
  const {
    guildId: _guildId,
    idempotencyKey: _idempotencyKey,
    idempotentReplay: _idempotentReplay,
    ...rest
  } = promotion;
  return rest;
}

function privateDetailForUi(
  detail: PrivateThreadDetail,
  promotions: readonly UiPrivateMessagePromotion[] = [],
  promotionKinds: UiPrivateThreadDetail["promotionKinds"] = [],
): UiPrivateThreadDetail {
  return {
    thread: privateThreadForUi(detail.thread),
    messages: detail.messages.map(({ guildId: _guildId, ...message }) => message),
    emergencyGrant: detail.emergencyGrant === null
      ? null
      : (({ guildId: _guildId, ...grant }) => grant)(detail.emergencyGrant),
    promotions,
    promotionKinds,
  };
}

function onboardingPathForUi(detail: OnboardingPathDetail): UiOnboardingPath {
  const { guildId: _guildId, ...path } = detail.path;
  return {
    ...path,
    requirements: detail.requirements.map(({ guildId: _requirementGuildId, ...requirement }) =>
      requirement),
  };
}

function onboardingAssignmentForUi(
  detail: OnboardingAssignmentDetail | null,
): UiOnboardingAssignmentDetail | null {
  if (detail === null) return null;
  const { guildId: _assignmentGuildId, ...assignment } = detail.assignment;
  const { guildId: _pathGuildId, ...path } = detail.path;
  return {
    assignment,
    path,
    requirements: detail.requirements.map(({ guildId: _requirementGuildId, ...requirement }) =>
      requirement),
  };
}

function handoverForUi(detail: HandoverDetail): UiHandover {
  const { guildId: _handoverGuildId, ...handover } = detail.handover;
  return {
    ...handover,
    items: detail.items.map(({ guildId: _itemGuildId, ...item }) => item),
  };
}

function contributionForUi(
  profile: ContributionProfile,
  canRequestCorrection: boolean,
  pendingCorrections: readonly UiGovernedContributionCorrection[] = [],
): UiContributionProfile {
  return {
    ...profile,
    corrections: profile.corrections.map(({ guildId: _guildId, ...correction }) => correction),
    pendingCorrections,
    canRequestCorrection,
  };
}

async function listActors(
  connection: GuildTransactionConnection,
  guildId: string,
  visibleSpaceIds: readonly string[] | null = null,
): Promise<readonly UiActorReference[]> {
  const result = await connection.query<{
    id: string;
    display_name: string;
    kind: UiActorReference["kind"];
    membership_state: UiActorReference["membershipState"];
  }>(
    `SELECT identity.id::text, identity.display_name, identity.kind,
            membership.state AS membership_state
       FROM identities identity
       JOIN memberships membership ON membership.guild_id = identity.guild_id
            AND membership.identity_id = identity.id
      WHERE identity.guild_id = $1 AND identity.status = 'active'
        AND ($2::uuid[] IS NULL
          OR identity.id = (SELECT root_owner_identity_id FROM guilds WHERE id = $1)
          OR EXISTS (
            SELECT 1 FROM role_bindings visible_binding
             WHERE visible_binding.guild_id = identity.guild_id
               AND visible_binding.identity_id = identity.id
               AND (visible_binding.space_id IS NULL
                    OR visible_binding.space_id = ANY($2::uuid[]))
          ))
      ORDER BY identity.display_name, identity.id`,
    [guildId, visibleSpaceIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    kind: row.kind,
    membershipState: row.membership_state,
  }));
}

function privateThreadResource(
  guildId: string,
  thread: Pick<PrivateThreadSummary,
    "id" | "spaceId" | "createdByActorId" | "classification" | "participantActorIds">,
): SecuredResource {
  return {
    id: thread.id,
    guildId,
    spaceId: thread.spaceId,
    ownerIdentityId: thread.createdByActorId,
    visibility: "private",
    classification: thread.classification,
    allowedIdentityIds: thread.participantActorIds,
  };
}

function actorIsHumanRoot(snapshot: AuthorizationSnapshot, accountId: string): boolean {
  return snapshot.guild.rootOwnerIdentityId === accountId &&
    snapshot.identities.some((identity) => identity.id === accountId && identity.kind === "human");
}

export class GuildFabricService {
  readonly #env: GuildEnv;
  readonly #accountId: string;
  readonly #verifiedAuthenticatedAt: string | null;

  constructor(env: GuildEnv, accountId: string, verifiedAuthenticatedAt: string | null = null) {
    this.#env = env;
    this.#accountId = accountId;
    this.#verifiedAuthenticatedAt = verifiedAuthenticatedAt;
  }

  async getPrivatePage(): Promise<UiPrivatePage> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
        this.#accountId,
      ]);
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
      );
      const canReadGuildWide = isAuthorized(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "message.read",
      });
      const readableSpaces = await listAuthorizedSpaces(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        "message.read",
      );
      const writableSpaces = await listAuthorizedSpaces(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        "message.create",
      );
      if (!canReadGuildWide && readableSpaces.length === 0) {
        authorize(snapshot, { actorIdentityId: this.#accountId, permission: "message.read" });
      }
      const canCreateGuildWide = isAuthorized(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "message.create",
      });
      const readableSpaceIds = new Set(readableSpaces.map((space) => space.id));
      const repository = new GuildFabricRepository(connection, this.#env.GUILD_ID);
      const candidateThreads = await repository.listPrivateThreads(this.#accountId);
      const actors = await listActors(
        connection,
        this.#env.GUILD_ID,
        canCreateGuildWide ? null : writableSpaces.map((space) => space.id),
      );
      const threads = candidateThreads.filter((thread) => thread.spaceId === null
        ? canReadGuildWide
        : canReadGuildWide || readableSpaceIds.has(thread.spaceId));
      const canUseEmergencyAccess = actorIsHumanRoot(snapshot, this.#accountId);
      const emergencyCandidates = canUseEmergencyAccess ? (await connection.query<{
        id: string;
        classification: Classification;
        created_at: string;
      }>(
        `SELECT thread.id::text, thread.classification, thread.created_at::text
           FROM private_threads thread
          WHERE thread.guild_id = $1 AND thread.status = 'open'
            AND NOT EXISTS (SELECT 1 FROM private_thread_participants participant
                 WHERE participant.guild_id = thread.guild_id
                   AND participant.thread_id = thread.id
                   AND participant.actor_id = $2 AND participant.state = 'active')
          ORDER BY thread.created_at DESC, thread.id DESC LIMIT 100`,
        [this.#env.GUILD_ID, this.#accountId],
      )).rows.map((row) => ({
        id: row.id,
        classification: row.classification,
        createdAt: new Date(row.created_at).toISOString(),
      })) : [];
      return {
        threads: threads.map(privateThreadForUi),
        eligibleActors: actors.filter((actor) =>
          actor.id !== this.#accountId && actor.membershipState === "active"),
        availableSpaces: writableSpaces.map(({ id, name }) => ({ id, name })),
        emergencyCandidates,
        canCreate: canCreateGuildWide || writableSpaces.length > 0,
        canCreateGuildWide,
        canUseEmergencyAccess,
      };
    });
  }

  async getPrivateThread(threadId: string): Promise<UiPrivateThreadDetail> {
    assertUuid(threadId, "Private thread ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
        this.#accountId,
      ]);
      const detail = await new GuildFabricRepository(
        connection,
        this.#env.GUILD_ID,
      ).getPrivateThread(this.#accountId, threadId);
      const participant = detail.thread.participantActorIds.includes(this.#accountId);
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        detail.thread.spaceId,
      );
      if (participant) {
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission: "message.read",
          resource: privateThreadResource(this.#env.GUILD_ID, detail.thread),
        });
      } else if (!detail.emergencyGrant || !actorIsHumanRoot(snapshot, this.#accountId)) {
        throw new Error("Private thread was not found or is not visible.");
      }
      const can = async (permission: "memory.create" | "activity.create" | "decision.propose" |
        "lifecycle.manage") => participant && (
        isAuthorized(snapshot, { actorIdentityId: this.#accountId, permission }) ||
        (await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          permission,
        )).length > 0
      );
      const canCreateMemory = await can("memory.create");
      const canCreateActivity = await can("activity.create");
      const canProposeDecision = await can("decision.propose");
      const canManageLifecycle = await can("lifecycle.manage");
      const promotionKinds: UiPrivateThreadDetail["promotionKinds"] = [
        ...(canCreateMemory ? ["memory" as const] : []),
        ...(canCreateActivity ? ["activity" as const] : []),
        ...(canProposeDecision ? ["decision" as const] : []),
        ...(canManageLifecycle ? ["handover" as const] : []),
      ];
      const promotions = participant
        ? (await new GuildFabricGovernanceRepository(connection, this.#env.GUILD_ID)
          .listPrivateMessagePromotions(this.#accountId, threadId)).map(privatePromotionForUi)
        : [];
      return privateDetailForUi(detail, promotions, promotionKinds);
    });
  }

  async createPrivateThread(input: CreatePrivateThreadRequest): Promise<string> {
    assertNonBlank(input.subject, "Private thread subject", 200);
    assertNonBlank(input.body, "Private message", 20_000);
    assertOptionalUuid(input.spaceId, "Space ID");
    assertClassification(input.classification);
    if (input.participantActorIds.length < 1 ||
        input.participantActorIds.length > MAX_PRIVATE_PARTICIPANTS ||
        new Set(input.participantActorIds).size !== input.participantActorIds.length ||
        input.participantActorIds.includes(this.#accountId)) {
      throw new Error(`Select between one and ${MAX_PRIVATE_PARTICIPANTS} unique participants.`);
    }
    input.participantActorIds.forEach((id) => assertUuid(id, "Participant Actor ID"));
    const threadId = crypto.randomUUID();
    await this.#authorized("message.create", async (connection) => {
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).createPrivateThread({
        id: threadId,
        actorId: this.#accountId,
        participantActorIds: input.participantActorIds,
        spaceId: input.spaceId,
        subject: input.subject,
        classification: input.classification,
        initialMessageId: crypto.randomUUID(),
        initialBody: input.body,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "private_thread.created",
          "private_thread",
          threadId,
          { participantCount: input.participantActorIds.length + 1, source: "guild-ui" },
        ),
      });
    }, input.spaceId);
    return threadId;
  }

  async postPrivateMessage(input: PostPrivateMessageRequest): Promise<void> {
    assertUuid(input.threadId, "Private thread ID");
    assertNonBlank(input.body, "Private message", 20_000);
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
        this.#accountId,
      ]);
      const repository = new GuildFabricRepository(connection, this.#env.GUILD_ID);
      const detail = await repository.getPrivateThread(this.#accountId, input.threadId);
      if (!detail.thread.participantActorIds.includes(this.#accountId)) {
        throw new Error("Only an active private-thread participant can post a message.");
      }
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        detail.thread.spaceId,
      );
      authorize(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "message.create",
        resource: privateThreadResource(this.#env.GUILD_ID, detail.thread),
      });
      const messageId = crypto.randomUUID();
      await repository.postPrivateMessage(
        this.#accountId,
        input.threadId,
        messageId,
        input.body,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "private_message.posted",
          "private_thread",
          input.threadId,
          { messageId, source: "guild-ui", plaintextRecorded: false },
        ),
      );
    });
  }

  async beginEmergencyPrivateAccess(input: BeginEmergencyPrivateAccessRequest): Promise<string> {
    assertUuid(input.threadId, "Private thread ID");
    assertNonBlank(input.reason, "Emergency reason", 5_000);
    assertNonBlank(input.intendedAccess, "Intended emergency access", 5_000);
    if (input.confirmation !== "BREAK GLASS") {
      throw new Error("Type BREAK GLASS to confirm emergency private access.");
    }
    if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 ||
        input.durationMinutes > MAX_EMERGENCY_MINUTES) {
      throw new Error(`Emergency access must expire within ${MAX_EMERGENCY_MINUTES} minutes.`);
    }
    assertRecentReauthentication(this.#verifiedAuthenticatedAt, {
      missingMessage: "Emergency access requires a recent identity-provider reauthentication.",
      expiredMessage: "Emergency access requires reauthentication within the last five minutes.",
    });
    const grantId = crypto.randomUUID();
    await this.#authorized("break-glass.use", async (connection, snapshot) => {
      if (!actorIsHumanRoot(snapshot, this.#accountId)) {
        throw new Error("Only the human Root Owner can open emergency private access.");
      }
      const grant: EmergencyPrivateAccessGrant = {
        id: grantId,
        guildId: this.#env.GUILD_ID,
        threadId: input.threadId,
        grantedToActorId: this.#accountId,
        grantedByActorId: this.#accountId,
        reason: input.reason,
        intendedAccess: input.intendedAccess,
        viewedInformation: "",
        changesMade: "",
        status: "active",
        expiresAt: new Date(Date.now() + input.durationMinutes * 60_000).toISOString(),
        closedAt: null,
        version: 1,
        createdAt: new Date().toISOString(),
      };
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).createEmergencyGrant(
        grant,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "private_access.break_glass.opened",
          "private_thread",
          input.threadId,
          {
            grantId,
            reason: input.reason,
            intendedAccess: input.intendedAccess,
            expiresAt: grant.expiresAt,
            source: "guild-ui",
          },
        ),
      );
    });
    return grantId;
  }

  async closeEmergencyPrivateAccess(input: CloseEmergencyPrivateAccessRequest): Promise<void> {
    assertUuid(input.grantId, "Emergency access grant ID");
    assertNonBlank(input.viewedInformation, "Viewed information", 10_000);
    await this.#authorized("break-glass.use", async (connection, snapshot) => {
      if (!actorIsHumanRoot(snapshot, this.#accountId)) {
        throw new Error("Only the human Root Owner can close emergency private access.");
      }
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).closeEmergencyGrant(
        input.grantId,
        this.#accountId,
        input.viewedInformation,
        input.changesMade,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "private_access.break_glass.closed",
          "emergency_private_access",
          input.grantId,
          { source: "guild-ui", accessAccountedFor: true },
        ),
      );
    });
  }

  async getLifecyclePage(): Promise<UiLifecyclePage> {
    return this.#authorizedInAnySpace("lifecycle.read", async (connection) => {
      const repository = new GuildFabricRepository(connection, this.#env.GUILD_ID);
      const globalSnapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
      );
      const hasGlobalRead = isAuthorized(globalSnapshot, {
        actorIdentityId: this.#accountId,
        permission: "lifecycle.read",
      });
      const hasGlobalManage = isAuthorized(globalSnapshot, {
        actorIdentityId: this.#accountId,
        permission: "lifecycle.manage",
      });
      const readSpaceIds = hasGlobalRead ? null : (await listAuthorizedSpaces(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        "lifecycle.read",
      )).map((space) => space.id);
      const manageSpaceIds = hasGlobalManage ? null : (await listAuthorizedSpaces(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        "lifecycle.manage",
      )).map((space) => space.id);
      const canManage = hasGlobalManage || (manageSpaceIds?.length ?? 0) > 0;
      const loadedAssignments = await repository.listOnboardingAssignmentDetails(this.#accountId);
      const myAssignments = loadedAssignments.filter((assignment) =>
        readSpaceIds === null || assignment.path.spaceId !== null &&
          readSpaceIds.includes(assignment.path.spaceId));
      const paths = canManage ? await repository.listOnboardingPaths(manageSpaceIds) : [];
      const actors = canManage
        ? await listActors(connection, this.#env.GUILD_ID, manageSpaceIds)
        : [];
      const assignments = canManage
        ? await repository.listOnboardingAssignments(manageSpaceIds)
        : [];
      const handovers = canManage ? await repository.listHandovers(manageSpaceIds) : [];
      return {
        paths: paths.map(onboardingPathForUi),
        assignments: assignments.map(({ guildId: _guildId, ...assignment }) => assignment),
        myAssignments: myAssignments.map((assignment) =>
          onboardingAssignmentForUi(assignment)!),
        handovers: handovers.map(handoverForUi),
        preboardingActors: actors.filter((actor) => actor.membershipState === "preboarding"),
        successorActors: actors.filter((actor) =>
          actor.id !== this.#accountId && actor.membershipState === "active"),
        canManage,
      };
    });
  }

  async createOnboardingPath(input: CreateOnboardingPathRequest): Promise<string> {
    assertNonBlank(input.name, "Onboarding path name", 200);
    assertOptionalUuid(input.spaceId, "Space ID");
    if (input.roleIds.length > 100 || new Set(input.roleIds).size !== input.roleIds.length) {
      throw new Error("Onboarding Role scope must contain at most one hundred unique Roles.");
    }
    input.roleIds.forEach((roleId) => assertUuid(roleId, "Onboarding Role ID"));
    if (input.requirements.length < 1 || input.requirements.length > 100) {
      throw new Error("Onboarding paths require between one and one hundred requirements.");
    }
    const pathId = crypto.randomUUID();
    await this.#authorized("lifecycle.manage", async (connection) => {
      const template = await connection.query<{ template_key: OnboardingPath["templateKey"] }>(
        `SELECT template_key FROM guild_collective_settings WHERE guild_id = $1`,
        [this.#env.GUILD_ID],
      );
      const now = new Date().toISOString();
      const path: OnboardingPath = {
        id: pathId,
        guildId: this.#env.GUILD_ID,
        spaceId: input.spaceId,
        templateKey: template.rows[0]?.template_key ?? null,
        applicableRoleIds: input.roleIds,
        name: input.name,
        description: input.description,
        status: "active",
        createdByActorId: this.#accountId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const requirements: OnboardingRequirement[] = input.requirements.map((requirement, position) => {
        assertNonBlank(requirement.title, "Onboarding requirement title", 200);
        assertOptionalUuid(requirement.resourceId, "Onboarding resource ID");
        if (requirement.kind === "checklist" && requirement.resourceId !== null ||
            requirement.kind !== "checklist" && requirement.resourceId === null) {
          throw new Error("Only checklist requirements omit a linked resource.");
        }
        return {
          id: crypto.randomUUID(),
          guildId: this.#env.GUILD_ID,
          pathId,
          kind: requirement.kind,
          resourceId: requirement.resourceId,
          title: requirement.title,
          instructions: requirement.instructions,
          required: requirement.required,
          position,
          createdAt: now,
        };
      });
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).createOnboardingPath(
        path,
        requirements,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "onboarding.path.created",
          "onboarding_path",
          pathId,
          {
            requirementCount: requirements.length,
            roleCount: input.roleIds.length,
            spaceId: input.spaceId,
            source: "guild-ui",
          },
        ),
      );
    }, input.spaceId);
    return pathId;
  }

  async assignOnboarding(input: AssignOnboardingRequest): Promise<string> {
    assertUuid(input.actorId, "Actor ID");
    assertUuid(input.pathId, "Onboarding path ID");
    if (input.dueAt !== null && Number.isNaN(Date.parse(input.dueAt))) {
      throw new Error("Onboarding due date is invalid.");
    }
    const assignmentId = crypto.randomUUID();
    await this.#authorizedInAnySpace("lifecycle.manage", async (connection) => {
      const path = (await connection.query<{ space_id: string | null }>(
        `SELECT space_id::text FROM onboarding_paths
          WHERE guild_id = $1 AND id = $2 AND status = 'active'`,
        [this.#env.GUILD_ID, input.pathId],
      )).rows[0];
      if (!path) throw new Error("Active onboarding path was not found.");
      const snapshot = await loadActorAuthorizationSnapshot(
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        path.space_id,
      );
      authorize(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "lifecycle.manage",
        ...(path.space_id === null ? {} : {
          resource: {
            id: input.pathId,
            guildId: this.#env.GUILD_ID,
            spaceId: path.space_id,
            ownerIdentityId: this.#accountId,
            visibility: "space" as const,
            classification: "internal" as const,
            allowedIdentityIds: [],
          },
        }),
      });
      const now = new Date().toISOString();
      const assignment: OnboardingAssignment = {
        id: assignmentId,
        guildId: this.#env.GUILD_ID,
        actorId: input.actorId,
        pathId: input.pathId,
        managerActorId: this.#accountId,
        status: "assigned",
        dueAt: input.dueAt,
        completedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).assignOnboarding(
        assignment,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "onboarding.assigned",
          "onboarding_assignment",
          assignmentId,
          { actorId: input.actorId, pathId: input.pathId, dueAt: input.dueAt, source: "guild-ui" },
        ),
      );
    });
    return assignmentId;
  }

  async completeOnboardingRequirement(
    input: CompleteOnboardingRequirementRequest,
  ): Promise<void> {
    assertUuid(input.assignmentId, "Onboarding assignment ID");
    assertUuid(input.requirementId, "Onboarding requirement ID");
    await this.#authorizedInAnySpace("lifecycle.read", async (connection) => {
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).completeOnboardingRequirement(
        input.assignmentId,
        input.requirementId,
        this.#accountId,
        input.evidence,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "onboarding.requirement.completed",
          "onboarding_assignment",
          input.assignmentId,
          { requirementId: input.requirementId, source: "guild-ui" },
        ),
      );
    });
  }

  async offboardActor(input: OffboardActorRequest): Promise<UiHandover> {
    assertUuid(input.actorId, "Departing Actor ID");
    assertOptionalUuid(input.successorActorId, "Successor Actor ID");
    assertNonBlank(input.reason, "Offboarding reason", 5_000);
    await this.#authorized("lifecycle.manage", async (connection, snapshot) => {
      if (snapshot.guild.rootOwnerIdentityId === input.actorId) {
        throw new Error("Transfer Root ownership before offboarding the Root Owner.");
      }
      if (input.actorId === this.#accountId) {
        throw new Error("An administrator cannot offboard their own active session.");
      }
      const actors = await listActors(connection, this.#env.GUILD_ID);
      const target = actors.find((actor) => actor.id === input.actorId);
      if (!target || !["active", "suspended", "preboarding"].includes(target.membershipState)) {
        throw new Error("The departing Actor is not operational.");
      }
      if (input.successorActorId !== null) {
        const successor = actors.find((actor) => actor.id === input.successorActorId);
        if (!successor || successor.membershipState !== "active" || successor.id === input.actorId) {
          throw new Error("The successor must be a different active Actor.");
        }
      }
    });
    const detail = await offboardLifecycleActor({
      env: this.#env,
      requesterActorId: this.#accountId,
      targetActorId: input.actorId,
      successorActorId: input.successorActorId,
      reason: input.reason,
    });
    await drainAgentWorkflowOutbox(this.#env);
    return handoverForUi(detail.handover);
  }

  async completeHandoverItem(input: CompleteHandoverItemRequest): Promise<void> {
    assertUuid(input.caseId, "Handover case ID");
    assertUuid(input.itemId, "Handover item ID");
    if (!["transfer", "retain", "archive"].includes(input.disposition)) {
      throw new Error("Handover disposition is invalid.");
    }
    await this.#authorized("lifecycle.manage", async (connection) => {
      await new GuildFabricRepository(connection, this.#env.GUILD_ID).completeHandoverItem(
        input.caseId,
        input.itemId,
        input.disposition,
        input.note,
        makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "handover.item.completed",
          "handover_item",
          input.itemId,
          { caseId: input.caseId, disposition: input.disposition, source: "guild-ui" },
        ),
      );
    });
  }

  async getContributionProfile(actorId: string | null = null): Promise<UiContributionProfile> {
    const subjectActorId = actorId ?? this.#accountId;
    assertUuid(subjectActorId, "Contribution Actor ID");
    const profile = await this.#authorizedInAnySpace("contribution.read", async (connection) =>
      contributionForUi(
        await new GuildFabricRepository(connection, this.#env.GUILD_ID)
          .getContributionProfile(subjectActorId),
        subjectActorId === this.#accountId,
      ));
    const pendingCorrections = await new GuildFabricGovernanceService(
      this.#env,
      this.#accountId,
    ).listPendingContributionCorrections();
    return {
      ...profile,
      pendingCorrections: pendingCorrections.map(({ guildId: _guildId, ...correction }) =>
        correction),
    };
  }

  async requestContributionCorrection(input: RequestContributionCorrectionInput): Promise<string> {
    if (input.chronicleEventId === null) {
      throw new Error("A Chronicle evidence event is required for a Contribution correction.");
    }
    assertUuid(input.chronicleEventId, "Chronicle event ID");
    assertNonBlank(input.reason, "Correction reason", 5_000);
    return (await new GuildFabricGovernanceService(
      this.#env,
      this.#accountId,
    ).requestContributionCorrection({
      evidenceEventId: input.chronicleEventId,
      reason: input.reason,
    })).id;
  }

  async #authorized<T>(
    permission: Parameters<typeof authorize>[1]["permission"],
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
    spaceId: string | null = null,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          spaceId,
        );
        authorize(snapshot, {
          actorIdentityId: this.#accountId,
          permission,
          ...(spaceId === null ? {} : {
            resource: {
              id: spaceId,
              guildId: this.#env.GUILD_ID,
              spaceId,
              ownerIdentityId: this.#accountId,
              visibility: "space" as const,
              classification: "public" as const,
              allowedIdentityIds: [],
            },
          }),
        });
        return operation(connection, snapshot);
      },
    );
  }

  async #authorizedInAnySpace<T>(
    permission: Parameters<typeof authorize>[1]["permission"],
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        let snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        if (!isAuthorized(snapshot, { actorIdentityId: this.#accountId, permission })) {
          const firstSpace = (await listAuthorizedSpaces(
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            permission,
          ))[0];
          if (!firstSpace) {
            authorize(snapshot, { actorIdentityId: this.#accountId, permission });
          }
          snapshot = await loadActorAuthorizationSnapshot(
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            firstSpace!.id,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission,
            resource: {
              id: firstSpace!.id,
              guildId: this.#env.GUILD_ID,
              spaceId: firstSpace!.id,
              ownerIdentityId: this.#accountId,
              visibility: "space",
              classification: "public",
              allowedIdentityIds: [],
            },
          });
        }
        return operation(connection, snapshot);
      },
    );
  }
}
