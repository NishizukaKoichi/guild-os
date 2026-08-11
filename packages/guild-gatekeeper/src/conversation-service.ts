import {
  CONVERSATION_STATUSES,
  assertConversationMentions,
  assertConversationSubjectType,
  assertNonBlank,
  authorize,
  isAuthorized,
  normalizeConversationBody,
  type AuthorizationSnapshot,
  type ConversationSubjectType,
  type Permission,
} from "@guild-os/domain";
import {
  GuildConversationRepository,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type ConversationMessageCursor,
  type ConversationMessageView,
  type ConversationSubjectResource,
  type ConversationThreadPage,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  ModerateConversationRequest,
  PostConversationMessageRequest,
  PostConversationMessageResponse,
  RedactConversationMessageRequest,
  SearchConversationMentionsRequest,
  UiConversation,
  UiConversationCapabilities,
  UiConversationMessage,
  UiConversationThread,
  UiConversationThreadRequest,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSATION_PAGE_SIZE = 30;
const MENTION_CANDIDATE_LIMIT = 10;
const MAX_MENTION_SEARCH_LENGTH = 100;
const MAX_MODERATION_REASON_LENGTH = 2_000;

function assertUuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
}

function assertSubject(subjectType: string, subjectId: string): asserts subjectType is ConversationSubjectType {
  assertConversationSubjectType(subjectType);
  assertUuid(subjectId, "Conversation subject ID");
}

function assertExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Expected Conversation version must be a positive integer.");
  }
}

function assertReason(reason: string): string {
  if (typeof reason !== "string") throw new Error("Moderation reason is required.");
  const normalized = reason.trim();
  assertNonBlank(normalized, "Moderation reason", MAX_MODERATION_REASON_LENGTH);
  return normalized;
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

function encodeCursor(cursor: ConversationMessageCursor | null): string | null {
  return cursor === null
    ? null
    : bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string | null | undefined): ConversationMessageCursor | null {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 1_000) {
    throw new Error("Conversation cursor is malformed.");
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const cursor = parsed as Readonly<Record<string, unknown>>;
    if (typeof cursor.createdAt !== "string" || Number.isNaN(Date.parse(cursor.createdAt)) ||
        typeof cursor.id !== "string") {
      throw new Error("invalid cursor");
    }
    assertUuid(cursor.id, "Conversation cursor ID");
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    throw new Error("Conversation cursor is malformed.");
  }
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function conversationForUi(conversation: ConversationThreadPage["conversation"]): UiConversation | null {
  if (!conversation) return null;
  const { guildId: _guildId, ...visible } = conversation;
  return visible;
}

function messageForUi(
  message: ConversationMessageView,
  canModerate: boolean,
): UiConversationMessage {
  return {
    ...message,
    redactedByIdentityId: canModerate ? message.redactedByIdentityId : null,
    redactionReason: canModerate ? message.redactionReason : null,
  };
}

function capabilitiesFor(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  subject: ConversationSubjectResource,
): UiConversationCapabilities {
  const can = (permission: Permission) => isAuthorized(snapshot, {
    actorIdentityId,
    permission,
    resource: subject,
  });
  return {
    post: can("conversation.create"),
    moderate: can("conversation.moderate"),
  };
}

function threadForUi(
  page: ConversationThreadPage,
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
): UiConversationThread {
  const capabilities = capabilitiesFor(snapshot, actorIdentityId, page.subject);
  return {
    subject: {
      subjectType: page.subject.subjectType,
      subjectId: page.subject.id,
      spaceId: page.subject.spaceId,
      ownerIdentityId: page.subject.ownerIdentityId,
      visibility: page.subject.visibility,
      classification: page.subject.classification,
      allowedIdentityIds: page.subject.allowedIdentityIds ?? [],
      readPermission: page.subject.readPermission,
    },
    conversation: conversationForUi(page.conversation),
    messages: page.messages.map((message) => messageForUi(message, capabilities.moderate)),
    nextCursor: encodeCursor(page.nextCursor),
    capabilities,
  };
}

export class GuildConversationService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getThread(request: UiConversationThreadRequest): Promise<UiConversationThread> {
    assertSubject(request.subjectType, request.subjectId);
    const cursor = decodeCursor(request.cursor);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const page = await new GuildConversationRepository(
          connection,
          this.#env.GUILD_ID,
        ).getThread(
          this.#accountId,
          request.subjectType,
          request.subjectId,
          cursor,
          CONVERSATION_PAGE_SIZE,
        );
        const snapshot = await this.#authorize(
          connection,
          page.subject,
          "conversation.read",
        );
        return threadForUi(page, snapshot, this.#accountId);
      },
    );
  }

  async post(input: PostConversationMessageRequest): Promise<PostConversationMessageResponse> {
    assertSubject(input.subjectType, input.subjectId);
    if (typeof input.body !== "string") throw new Error("Comment body is required.");
    const body = normalizeConversationBody(input.body);
    assertConversationMentions(input.mentionedIdentityIds);
    for (const identityId of input.mentionedIdentityIds) {
      assertUuid(identityId, "Mentioned Identity ID");
      if (identityId === this.#accountId) throw new Error("A comment cannot mention its author.");
    }
    const bodySha256 = await sha256Text(body);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildConversationRepository(connection, this.#env.GUILD_ID);
        const subject = await repository.getSubject(
          this.#accountId,
          input.subjectType,
          input.subjectId,
          "conversation.create",
        );
        const snapshot = await this.#authorize(connection, subject, "conversation.create");
        const conversationId = crypto.randomUUID();
        const messageId = crypto.randomUUID();
        const result = await repository.postMessage({
          conversationId,
          messageId,
          actorIdentityId: this.#accountId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          body,
          mentionedIdentityIds: input.mentionedIdentityIds,
          openedEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "conversation.opened",
            "conversation",
            conversationId,
            { source: "guild-ui", subjectType: input.subjectType, subjectId: input.subjectId },
            subject,
          ),
          postedEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "conversation.message.posted",
            "conversation_message",
            messageId,
            {
              source: "guild-ui",
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              bodySha256,
              mentionCount: input.mentionedIdentityIds.length,
            },
            subject,
          ),
        });
        return {
          conversation: conversationForUi(result.conversation)!,
          message: messageForUi(
            result.message,
            capabilitiesFor(snapshot, this.#accountId, subject).moderate,
          ),
          opened: result.opened,
          notificationCount: result.notificationCount,
        };
      },
    );
  }

  async moderate(input: ModerateConversationRequest): Promise<UiConversation> {
    assertSubject(input.subjectType, input.subjectId);
    assertUuid(input.conversationId, "Conversation ID");
    assertExpectedVersion(input.expectedVersion);
    if (!(CONVERSATION_STATUSES as readonly string[]).includes(input.nextStatus)) {
      throw new Error("Conversation status is invalid.");
    }
    const reason = assertReason(input.reason);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildConversationRepository(connection, this.#env.GUILD_ID);
        const subject = await repository.getSubject(
          this.#accountId,
          input.subjectType,
          input.subjectId,
          "conversation.moderate",
        );
        await this.#authorize(connection, subject, "conversation.moderate");
        const conversation = await repository.setStatus({
          conversationId: input.conversationId,
          actorIdentityId: this.#accountId,
          expectedVersion: input.expectedVersion,
          nextStatus: input.nextStatus,
          reason,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            input.nextStatus === "locked" ? "conversation.locked" : "conversation.unlocked",
            "conversation",
            input.conversationId,
            { source: "guild-ui", reason },
            subject,
          ),
        });
        return conversationForUi(conversation)!;
      },
    );
  }

  async redact(input: RedactConversationMessageRequest): Promise<number> {
    assertSubject(input.subjectType, input.subjectId);
    assertUuid(input.conversationId, "Conversation ID");
    assertUuid(input.messageId, "Conversation message ID");
    assertExpectedVersion(input.expectedVersion);
    const reason = assertReason(input.reason);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildConversationRepository(connection, this.#env.GUILD_ID);
        const subject = await repository.getSubject(
          this.#accountId,
          input.subjectType,
          input.subjectId,
          "conversation.moderate",
        );
        await this.#authorize(connection, subject, "conversation.moderate");
        return repository.redactMessage({
          conversationId: input.conversationId,
          messageId: input.messageId,
          actorIdentityId: this.#accountId,
          expectedVersion: input.expectedVersion,
          reason,
          chronicleEvent: makeChronicleEvent(
            this.#env.GUILD_ID,
            this.#accountId,
            "conversation.message.redacted",
            "conversation_message",
            input.messageId,
            { source: "guild-ui", reason },
            subject,
          ),
        });
      },
    );
  }

  async searchMentions(input: SearchConversationMentionsRequest) {
    assertSubject(input.subjectType, input.subjectId);
    if (typeof input.search !== "string" || input.search.length > MAX_MENTION_SEARCH_LENGTH) {
      throw new Error(`Mention search must be at most ${MAX_MENTION_SEARCH_LENGTH} characters.`);
    }
    const search = input.search.trim();
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildConversationRepository(connection, this.#env.GUILD_ID);
        const subject = await repository.getSubject(
          this.#accountId,
          input.subjectType,
          input.subjectId,
          "conversation.create",
        );
        await this.#authorize(connection, subject, "conversation.create");
        if (!search) return [];
        return repository.searchMentionCandidates(
          this.#accountId,
          input.subjectType,
          input.subjectId,
          search,
          MENTION_CANDIDATE_LIMIT,
        );
      },
    );
  }

  async #authorize(
    connection: GuildTransactionConnection,
    subject: ConversationSubjectResource,
    conversationPermission: "conversation.read" | "conversation.create" | "conversation.moderate",
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      subject.spaceId,
    );
    authorize(snapshot, {
      actorIdentityId: this.#accountId,
      permission: subject.readPermission,
      resource: subject,
    });
    authorize(snapshot, {
      actorIdentityId: this.#accountId,
      permission: conversationPermission,
      resource: subject,
    });
    return snapshot;
  }
}
