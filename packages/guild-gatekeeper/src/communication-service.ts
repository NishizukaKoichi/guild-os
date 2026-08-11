import {
  CLASSIFICATIONS,
  VISIBILITIES,
  assertAnnouncementContent,
  assertAnnouncementExpiry,
  authorize,
  isAuthorized,
  type Announcement,
  type AuthorizationSnapshot,
  type InboxNotificationKind,
  type Permission,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildAnnouncementRepository,
  GuildChronicleQueryRepository,
  GuildInboxRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type AnnouncementListCursor,
  type GuildTransactionConnection,
  type InboxListCursor,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  AnnouncementResourceRequest,
  AnnouncementTransitionRequest,
  CreateAnnouncementRequest,
  MarkInboxReadRequest,
  PublishAnnouncementResponse,
  SaveAnnouncementDraftRequest,
  UiAnnouncement,
  UiAnnouncementCapabilities,
  UiAnnouncementPage,
  UiAnnouncementPageRequest,
  UiChroniclePage,
  UiChroniclePageRequest,
  UiInboxPage,
  UiInboxPageRequest,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AUDIENCE_IDENTITIES = 100;
const ANNOUNCEMENT_PAGE_SIZE = 30;
const INBOX_PAGE_SIZE = 40;
const CHRONICLE_PAGE_SIZE = 50;
const INBOX_KINDS = new Set<InboxNotificationKind>([
  "announcement",
  "mention",
  "quest",
  "approval",
  "knowledge_update",
  "agent_question",
  "system",
]);

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Expected Announcement version must be a positive integer.");
  }
}

function assertOptionalTimestamp(value: string | null | undefined, field: string): void {
  if (value != null && Number.isNaN(Date.parse(value))) throw new Error(`${field} is invalid.`);
}

function assertAnnouncementInput(input: AnnouncementResourceRequest): void {
  assertAnnouncementContent(input.title, input.body);
  assertAnnouncementExpiry(input.expiresAt);
  if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
  if (input.targetRoleId !== null) assertUuid(input.targetRoleId, "Target Role ID");
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Announcement visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Announcement classification is invalid.");
  }
  if (input.visibility === "space" && input.spaceId === null) {
    throw new Error("Space-visible Announcements require a Space.");
  }
  if (input.visibility === "guild" && input.spaceId !== null) {
    throw new Error("Guild-visible Announcements cannot be scoped to a Space.");
  }
  if (!Array.isArray(input.allowedIdentityIds) ||
      input.allowedIdentityIds.length > MAX_AUDIENCE_IDENTITIES ||
      new Set(input.allowedIdentityIds).size !== input.allowedIdentityIds.length) {
    throw new Error(`Announcement audience supports at most ${MAX_AUDIENCE_IDENTITIES} unique Identities.`);
  }
  if (!input.allowedIdentityIds.every((identityId) => UUID_PATTERN.test(identityId))) {
    throw new Error("Announcement audience contains an invalid Identity ID.");
  }
  if (!["restricted", "private"].includes(input.visibility) && input.allowedIdentityIds.length > 0) {
    throw new Error("Explicit Announcement access is valid only for restricted or private visibility.");
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(value: Readonly<object> | null): string | null {
  return value === null ? null : bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeCursor<T extends object>(
  value: string | null | undefined,
  fields: readonly (keyof T)[],
  label: string,
): T | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error(`${label} cursor is malformed.`);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object" || !fields.every((field) =>
      typeof (parsed as Record<string, unknown>)[String(field)] === "string")) {
      throw new Error("invalid cursor");
    }
    const cursor = parsed as T;
    if ("id" in cursor) assertUuid((cursor as { id: string }).id, `${label} cursor ID`);
    return cursor;
  } catch {
    throw new Error(`${label} cursor is malformed.`);
  }
}

async function snapshotFor(
  cache: Map<string, Promise<AuthorizationSnapshot>>,
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityId: string,
  spaceId: string | null,
): Promise<AuthorizationSnapshot> {
  const key = spaceId ?? "global";
  let snapshot = cache.get(key);
  if (!snapshot) {
    snapshot = loadActorAuthorizationSnapshot(connection, guildId, actorIdentityId, spaceId);
    cache.set(key, snapshot);
  }
  return snapshot;
}

function announcementCapabilities(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  announcement: Announcement,
): UiAnnouncementCapabilities {
  const manage = isAuthorized(snapshot, {
    actorIdentityId,
    permission: "announcement.manage",
    resource: announcement,
  });
  return {
    edit: announcement.status === "draft" && manage,
    publish: announcement.status === "draft" && manage,
    archive: announcement.status !== "archived" && manage,
  };
}

function announcementForUi(
  announcement: Announcement,
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
): UiAnnouncement {
  const { guildId: _guildId, ...rest } = announcement;
  return { ...rest, capabilities: announcementCapabilities(snapshot, actorIdentityId, announcement) };
}

export class GuildCommunicationService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getAnnouncementPage(
    request: UiAnnouncementPageRequest = {},
  ): Promise<UiAnnouncementPage> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAnnouncementRepository(connection, this.#env.GUILD_ID);
        const page = await repository.listAnnouncements(
          this.#accountId,
          decodeCursor<AnnouncementListCursor>(request.cursor, ["updatedAt", "id"], "Announcement"),
          ANNOUNCEMENT_PAGE_SIZE,
        );
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const items: UiAnnouncement[] = [];
        for (const announcement of page.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            announcement.spaceId,
          );
          this.#authorizeAnnouncementRead(snapshot, announcement);
          items.push(announcementForUi(announcement, snapshot, this.#accountId));
        }
        const manageableSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "announcement.manage",
        );
        const globalSnapshot = await snapshotFor(
          snapshots,
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          null,
        );
        return {
          items,
          nextCursor: encodeCursor(page.nextCursor),
          manageableSpaceIds: manageableSpaces.map((space) => space.id),
          canCreateGuildWide: isAuthorized(globalSnapshot, {
            actorIdentityId: this.#accountId,
            permission: "announcement.manage",
          }),
        };
      },
    );
  }

  async getAnnouncement(announcementId: string): Promise<UiAnnouncement> {
    assertUuid(announcementId, "Announcement ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const announcement = await new GuildAnnouncementRepository(
          connection,
          this.#env.GUILD_ID,
        ).getAnnouncement(this.#accountId, announcementId);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          announcement.spaceId,
        );
        this.#authorizeAnnouncementRead(snapshot, announcement);
        return announcementForUi(announcement, snapshot, this.#accountId);
      },
    );
  }

  async createAnnouncement(input: CreateAnnouncementRequest): Promise<string> {
    assertAnnouncementInput(input);
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const resource = this.#newAnnouncementResource(id, this.#accountId, input);
        await this.#authorize(connection, resource, "announcement.manage");
        await new GuildAnnouncementRepository(connection, this.#env.GUILD_ID).createAnnouncement({
          ...input,
          id,
          actorIdentityId: this.#accountId,
          ownerIdentityId: this.#accountId,
          chronicleEvent: this.#event("announcement.created", id, { status: "draft" }, resource),
        });
      },
    );
    return id;
  }

  async saveAnnouncementDraft(input: SaveAnnouncementDraftRequest): Promise<number> {
    assertUuid(input.announcementId, "Announcement ID");
    assertExpectedVersion(input.expectedVersion);
    assertAnnouncementInput(input);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAnnouncementRepository(connection, this.#env.GUILD_ID);
        const current = await repository.getAnnouncement(this.#accountId, input.announcementId);
        await this.#authorize(connection, current, "announcement.manage");
        const proposed = this.#newAnnouncementResource(
          input.announcementId,
          current.ownerIdentityId,
          input,
        );
        await this.#authorize(connection, proposed, "announcement.manage");
        return repository.saveDraft({
          ...input,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event(
            "announcement.draft.updated",
            input.announcementId,
            { expectedVersion: input.expectedVersion },
            proposed,
          ),
        });
      },
    );
  }

  async publishAnnouncement(
    input: AnnouncementTransitionRequest,
  ): Promise<PublishAnnouncementResponse> {
    this.#assertTransition(input);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAnnouncementRepository(connection, this.#env.GUILD_ID);
        const announcement = await repository.getAnnouncement(this.#accountId, input.announcementId);
        await this.#authorize(connection, announcement, "announcement.manage");
        return repository.publish({
          ...input,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event(
            "announcement.published",
            input.announcementId,
            { expectedVersion: input.expectedVersion },
            announcement,
          ),
        });
      },
    );
  }

  async archiveAnnouncement(input: AnnouncementTransitionRequest): Promise<number> {
    this.#assertTransition(input);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildAnnouncementRepository(connection, this.#env.GUILD_ID);
        const announcement = await repository.getAnnouncement(this.#accountId, input.announcementId);
        await this.#authorize(connection, announcement, "announcement.manage");
        return repository.archive({
          ...input,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event(
            "announcement.archived",
            input.announcementId,
            { expectedVersion: input.expectedVersion },
            announcement,
          ),
        });
      },
    );
  }

  async getInboxPage(request: UiInboxPageRequest = {}): Promise<UiInboxPage> {
    if (request.kind != null && !INBOX_KINDS.has(request.kind)) {
      throw new Error("Inbox kind is invalid.");
    }
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#assertAnyPermission(connection, "inbox.read", true);
        const page = await new GuildInboxRepository(connection, this.#env.GUILD_ID).listNotifications(
          this.#accountId,
          {
            cursor: decodeCursor<InboxListCursor>(request.cursor, ["createdAt", "id"], "Inbox"),
            kind: request.kind ?? null,
            unreadOnly: request.unreadOnly ?? false,
            pageSize: INBOX_PAGE_SIZE,
          },
        );
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        return {
          items: await Promise.all(page.items.map(async (notification) => {
            const snapshot = await snapshotFor(
              snapshots,
              connection,
              this.#env.GUILD_ID,
              this.#accountId,
              notification.spaceId,
            );
            authorize(snapshot, {
              actorIdentityId: this.#accountId,
              permission: "inbox.read",
              resource: notification,
            });
            if (notification.recipientIdentityId !== this.#accountId) {
              throw new Error("Inbox notification belongs to a different Identity.");
            }
            const { guildId: _guildId, ...rest } = notification;
            return rest;
          })),
          unreadCount: page.unreadCount,
          nextCursor: encodeCursor(page.nextCursor),
        };
      },
    );
  }

  async markInboxRead(input: MarkInboxReadRequest): Promise<string | null> {
    assertUuid(input.notificationId, "Inbox notification ID");
    if (typeof input.read !== "boolean") throw new Error("Inbox read state is invalid.");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#assertAnyPermission(connection, "inbox.read", true);
        return new GuildInboxRepository(connection, this.#env.GUILD_ID).markRead(
          this.#accountId,
          input.notificationId,
          input.read,
        );
      },
    );
  }

  async markAllInboxRead(): Promise<number> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#assertAnyPermission(connection, "inbox.read", true);
        return new GuildInboxRepository(connection, this.#env.GUILD_ID).markAllRead(this.#accountId);
      },
    );
  }

  async getChroniclePage(request: UiChroniclePageRequest = {}): Promise<UiChroniclePage> {
    const search = request.search?.trim() || null;
    if (search && search.length > 200) throw new Error("Chronicle search is too long.");
    const subjectType = request.subjectType?.trim() || null;
    if (subjectType && (subjectType.length > 100 || !/^[a-z][a-z0-9_-]*$/i.test(subjectType))) {
      throw new Error("Chronicle subject type is invalid.");
    }
    if (request.actorIdentityId) assertUuid(request.actorIdentityId, "Chronicle actor Identity ID");
    assertOptionalTimestamp(request.occurredFrom, "Chronicle start date");
    assertOptionalTimestamp(request.occurredTo, "Chronicle end date");
    if (request.occurredFrom && request.occurredTo &&
        Date.parse(request.occurredFrom) > Date.parse(request.occurredTo)) {
      throw new Error("Chronicle start date must be before its end date.");
    }
    const cursor = request.cursor ?? null;
    if (cursor !== null && !/^\d+$/.test(cursor)) throw new Error("Chronicle cursor is malformed.");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await this.#assertAnyPermission(connection, "chronicle.read", false);
        const page = await new GuildChronicleQueryRepository(
          connection,
          this.#env.GUILD_ID,
        ).listEvents(this.#accountId, {
          cursor,
          search,
          actorIdentityId: request.actorIdentityId ?? null,
          subjectType,
          occurredFrom: request.occurredFrom ?? null,
          occurredTo: request.occurredTo ?? null,
          pageSize: CHRONICLE_PAGE_SIZE,
        });
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        return {
          items: await Promise.all(page.items.map(async (event) => {
            const snapshot = await snapshotFor(
              snapshots,
              connection,
              this.#env.GUILD_ID,
              this.#accountId,
              event.spaceId,
            );
            authorize(snapshot, {
              actorIdentityId: this.#accountId,
              permission: "chronicle.read",
              resource: event,
            });
            const { guildId: _guildId, ...rest } = event;
            return rest;
          })),
          nextCursor: page.nextCursor,
        };
      },
    );
  }

  async #authorize(
    connection: GuildTransactionConnection,
    resource: SecuredResource,
    permission: Permission,
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      resource.spaceId,
    );
    authorize(snapshot, { actorIdentityId: this.#accountId, permission, resource });
    return snapshot;
  }

  async #assertAnyPermission(
    connection: GuildTransactionConnection,
    permission: "inbox.read" | "chronicle.read",
    preboardingAllowed: boolean,
  ): Promise<void> {
    const spaces = await listAuthorizedSpaces(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      permission,
    );
    const spaceId = spaces[0]?.id ?? null;
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      spaceId,
    );
    if (!preboardingAllowed) {
      const membership = snapshot.memberships.find((item) => item.identityId === this.#accountId);
      if (membership?.state !== "active") {
        throw new Error("Chronicle is available only to active Guild members.");
      }
    }
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
  }

  #authorizeAnnouncementRead(
    snapshot: AuthorizationSnapshot,
    announcement: Announcement,
  ): void {
    authorize(snapshot, {
      actorIdentityId: this.#accountId,
      permission: "announcement.read",
      resource: announcement,
    });
    const manages = isAuthorized(snapshot, {
      actorIdentityId: this.#accountId,
      permission: "announcement.manage",
      resource: announcement,
    });
    if (announcement.status !== "published" ||
        announcement.expiresAt !== null && Date.parse(announcement.expiresAt) <= Date.now()) {
      if (!manages && announcement.ownerIdentityId !== this.#accountId) {
        throw new Error("Unpublished Announcement requires management authority.");
      }
      return;
    }
    if (announcement.targetRoleId !== null && !manages &&
        announcement.ownerIdentityId !== this.#accountId &&
        !snapshot.roleBindings.some((binding) =>
          binding.identityId === this.#accountId && binding.roleId === announcement.targetRoleId)) {
      throw new Error("Announcement is targeted to a different Role.");
    }
  }

  #assertTransition(input: AnnouncementTransitionRequest): void {
    assertUuid(input.announcementId, "Announcement ID");
    assertExpectedVersion(input.expectedVersion);
  }

  #newAnnouncementResource(
    id: string,
    ownerIdentityId: string,
    input: AnnouncementResourceRequest,
  ): SecuredResource {
    return {
      id,
      guildId: this.#env.GUILD_ID,
      spaceId: input.spaceId,
      ownerIdentityId,
      visibility: input.visibility,
      classification: input.classification,
      allowedIdentityIds: input.allowedIdentityIds,
    };
  }

  #event(
    action: string,
    subjectId: string,
    details: Readonly<Record<string, string | number | boolean | null>>,
    resource: SecuredResource,
  ) {
    return makeChronicleEvent(
      this.#env.GUILD_ID,
      this.#accountId,
      action,
      "announcement",
      subjectId,
      { ...details, source: "guild-ui" },
      resource,
    );
  }
}
