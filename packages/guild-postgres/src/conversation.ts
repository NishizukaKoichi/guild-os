import {
  assertConversationMentions,
  assertConversationStatusTransition,
  normalizeConversationBody,
  type ChronicleEvent,
  type Classification,
  type Conversation,
  type ConversationMessageState,
  type ConversationStatus,
  type ConversationSubjectType,
  type Permission,
  type SecuredResource,
  type Visibility,
} from "@guild-os/domain";
import type { QueryResultRow } from "pg";
import { GuildPostgresRepository } from "./repository.js";
import type { GuildTransactionConnection } from "./transaction.js";

export interface ConversationSubjectResource extends SecuredResource {
  subjectType: ConversationSubjectType;
  readPermission: Permission;
}

export interface ConversationMessageView {
  id: string;
  conversationId: string;
  authorIdentityId: string;
  authorDisplayName: string;
  body: string | null;
  mentionedIdentityIds: readonly string[];
  state: ConversationMessageState;
  version: number;
  redactedByIdentityId: string | null;
  redactedAt: string | null;
  redactionReason: string | null;
  createdAt: string;
}

export interface ConversationMessageCursor {
  createdAt: string;
  id: string;
}

export interface ConversationThreadPage {
  subject: ConversationSubjectResource;
  conversation: Conversation | null;
  messages: readonly ConversationMessageView[];
  nextCursor: ConversationMessageCursor | null;
}

export interface PostConversationMessageInput {
  conversationId: string;
  messageId: string;
  actorIdentityId: string;
  subjectType: ConversationSubjectType;
  subjectId: string;
  body: string;
  mentionedIdentityIds: readonly string[];
  openedEvent: ChronicleEvent;
  postedEvent: ChronicleEvent;
}

export interface ModerateConversationInput {
  conversationId: string;
  actorIdentityId: string;
  expectedVersion: number;
  nextStatus: ConversationStatus;
  reason: string;
  chronicleEvent: ChronicleEvent;
}

export interface RedactConversationMessageInput {
  conversationId: string;
  messageId: string;
  actorIdentityId: string;
  expectedVersion: number;
  reason: string;
  chronicleEvent: ChronicleEvent;
}

export interface ConversationMentionCandidate {
  id: string;
  displayName: string;
}

type SubjectRow = QueryResultRow & {
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  read_permission: Permission;
};

type ThreadRow = SubjectRow & {
  conversation_id: string | null;
  conversation_status: ConversationStatus | null;
  conversation_version: number | null;
  conversation_created_at: string | null;
  conversation_updated_at: string | null;
  message_id: string | null;
  message_author_identity_id: string | null;
  message_author_display_name: string | null;
  message_body: string | null;
  message_mentioned_identity_ids: string[] | null;
  message_state: ConversationMessageState | null;
  message_version: number | null;
  message_redacted_by_identity_id: string | null;
  message_redacted_at: string | null;
  message_redaction_reason: string | null;
  message_created_at: string | null;
};

type ConversationRow = QueryResultRow & {
  id: string;
  subject_type: ConversationSubjectType;
  subject_id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
  status: ConversationStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

type MessageRow = QueryResultRow & {
  id: string;
  conversation_id: string;
  author_identity_id: string;
  author_display_name: string;
  body: string | null;
  mentioned_identity_ids: string[];
  state: ConversationMessageState;
  version: number;
  redacted_by_identity_id: string | null;
  redacted_at: string | null;
  redaction_reason: string | null;
  created_at: string;
};

function isoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error("Database contains an invalid Conversation timestamp.");
  }
  return timestamp.toISOString();
}

function sameIdentitySet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((identityId) => right.includes(identityId));
}

function mapSubject(
  guildId: string,
  subjectType: ConversationSubjectType,
  subjectId: string,
  row: SubjectRow,
): ConversationSubjectResource {
  return {
    id: subjectId,
    guildId,
    subjectType,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    readPermission: row.read_permission,
  };
}

function mapConversation(guildId: string, row: ConversationRow): Conversation {
  return {
    id: row.id,
    guildId,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
    status: row.status,
    version: row.version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function mapMessage(row: MessageRow): ConversationMessageView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorIdentityId: row.author_identity_id,
    authorDisplayName: row.author_display_name,
    body: row.body,
    mentionedIdentityIds: row.mentioned_identity_ids,
    state: row.state,
    version: row.version,
    redactedByIdentityId: row.redacted_by_identity_id,
    redactedAt: row.redacted_at === null ? null : isoTimestamp(row.redacted_at),
    redactionReason: row.redaction_reason,
    createdAt: isoTimestamp(row.created_at),
  };
}

export class GuildConversationRepository {
  readonly #connection: GuildTransactionConnection;
  readonly #guildId: string;
  readonly #chronicle: GuildPostgresRepository;

  constructor(connection: GuildTransactionConnection, guildId: string) {
    this.#connection = connection;
    this.#guildId = guildId;
    this.#chronicle = new GuildPostgresRepository(connection, guildId);
  }

  async getSubject(
    actorIdentityId: string,
    subjectType: ConversationSubjectType,
    subjectId: string,
    conversationPermission: "conversation.read" | "conversation.create" | "conversation.moderate",
  ): Promise<ConversationSubjectResource> {
    const row = (await this.#connection.query<SubjectRow>(
      `SELECT subject.space_id::text, subject.owner_identity_id::text,
              subject.visibility, subject.classification,
              subject.allowed_identity_ids::text[], subject.read_permission
         FROM guild_runtime.conversation_subject($1, $3, $4) subject
        WHERE guild_runtime.identity_can_access_conversation_subject(
          $1, $2, $3, $4, $5
        )`,
      [this.#guildId, actorIdentityId, subjectType, subjectId, conversationPermission],
    )).rows[0];
    if (!row) throw new Error("Conversation subject was not found or operation is not authorized.");
    return mapSubject(this.#guildId, subjectType, subjectId, row);
  }

  async getThread(
    actorIdentityId: string,
    subjectType: ConversationSubjectType,
    subjectId: string,
    cursor: ConversationMessageCursor | null,
    limit: number,
  ): Promise<ConversationThreadPage> {
    const result = await this.#connection.query<ThreadRow>(
      `SELECT subject.space_id::text, subject.owner_identity_id::text,
              subject.visibility, subject.classification,
              subject.allowed_identity_ids::text[], subject.read_permission,
              thread.id::text AS conversation_id,
              thread.status AS conversation_status,
              thread.version AS conversation_version,
              thread.created_at::text AS conversation_created_at,
              thread.updated_at::text AS conversation_updated_at,
              message.id::text AS message_id,
              message.author_identity_id::text AS message_author_identity_id,
              message.author_display_name AS message_author_display_name,
              message.body AS message_body,
              message.mentioned_identity_ids::text[] AS message_mentioned_identity_ids,
              message.state AS message_state,
              message.version AS message_version,
              message.redacted_by_identity_id::text AS message_redacted_by_identity_id,
              message.redacted_at::text AS message_redacted_at,
              message.redaction_reason AS message_redaction_reason,
              message.created_at::text AS message_created_at
         FROM guild_runtime.conversation_subject($1, $3, $4) subject
         LEFT JOIN conversations thread
           ON thread.guild_id = $1 AND thread.subject_type = $3
          AND thread.subject_id = $4
         LEFT JOIN LATERAL (
           SELECT message_row.id, message_row.author_identity_id,
                  author.display_name AS author_display_name,
                  CASE WHEN message_row.state = 'redacted' THEN NULL ELSE message_row.body END AS body,
                  message_row.mentioned_identity_ids, message_row.state, message_row.version,
                  message_row.redacted_by_identity_id, message_row.redacted_at,
                  message_row.redaction_reason, message_row.created_at
             FROM conversation_messages message_row
             JOIN identities author
               ON author.guild_id = message_row.guild_id
              AND author.id = message_row.author_identity_id
            WHERE message_row.guild_id = $1 AND message_row.conversation_id = thread.id
              AND ($5::timestamptz IS NULL OR
                (message_row.created_at, message_row.id) < ($5::timestamptz, $6::uuid))
            ORDER BY message_row.created_at DESC, message_row.id DESC
            LIMIT $7
         ) message ON true
        WHERE guild_runtime.identity_can_access_conversation_subject(
          $1, $2, $3, $4, 'conversation.read'
        )
        ORDER BY message.created_at DESC NULLS LAST, message.id DESC NULLS LAST`,
      [
        this.#guildId,
        actorIdentityId,
        subjectType,
        subjectId,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const first = result.rows[0];
    if (!first) throw new Error("Conversation subject was not found or is not readable.");
    const subject = mapSubject(this.#guildId, subjectType, subjectId, first);
    const messageRows = result.rows.filter((row) => row.message_id !== null);
    const selected = messageRows.slice(0, limit);
    const oldest = selected.at(-1);
    const messages = selected.map((row): ConversationMessageView => mapMessage({
      id: row.message_id!,
      conversation_id: row.conversation_id!,
      author_identity_id: row.message_author_identity_id!,
      author_display_name: row.message_author_display_name!,
      body: row.message_body,
      mentioned_identity_ids: row.message_mentioned_identity_ids ?? [],
      state: row.message_state!,
      version: row.message_version!,
      redacted_by_identity_id: row.message_redacted_by_identity_id,
      redacted_at: row.message_redacted_at,
      redaction_reason: row.message_redaction_reason,
      created_at: row.message_created_at!,
    })).reverse();
    const conversation = first.conversation_id === null ? null : mapConversation(this.#guildId, {
      id: first.conversation_id,
      subject_type: subjectType,
      subject_id: subjectId,
      space_id: first.space_id,
      owner_identity_id: first.owner_identity_id,
      visibility: first.visibility,
      classification: first.classification,
      allowed_identity_ids: first.allowed_identity_ids,
      status: first.conversation_status!,
      version: first.conversation_version!,
      created_at: first.conversation_created_at!,
      updated_at: first.conversation_updated_at!,
    });
    return {
      subject,
      conversation,
      messages,
      nextCursor: messageRows.length > limit && oldest ? {
        createdAt: isoTimestamp(oldest.message_created_at!),
        id: oldest.message_id!,
      } : null,
    };
  }

  async postMessage(input: PostConversationMessageInput): Promise<{
    conversation: Conversation;
    message: ConversationMessageView;
    opened: boolean;
    notificationCount: number;
  }> {
    const body = normalizeConversationBody(input.body);
    assertConversationMentions(input.mentionedIdentityIds);
    const subject = await this.getSubject(
      input.actorIdentityId,
      input.subjectType,
      input.subjectId,
      "conversation.create",
    );
    this.#assertEvent(
      input.openedEvent,
      input.actorIdentityId,
      "conversation.opened",
      "conversation",
      input.conversationId,
      subject,
    );
    this.#assertEvent(
      input.postedEvent,
      input.actorIdentityId,
      "conversation.message.posted",
      "conversation_message",
      input.messageId,
      subject,
    );
    await this.#setActor(input.actorIdentityId);
    const inserted = (await this.#connection.query<ConversationRow>(
      `INSERT INTO conversations
         (id, guild_id, space_id, owner_identity_id, subject_type, subject_id,
          visibility, classification, allowed_identity_ids, status, version, last_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], 'open', 1, $10)
       ON CONFLICT (guild_id, subject_type, subject_id) DO NOTHING
       RETURNING id::text, subject_type, subject_id::text, space_id::text,
                 owner_identity_id::text, visibility, classification,
                 allowed_identity_ids::text[], status, version,
                 created_at::text, updated_at::text`,
      [
        input.conversationId,
        this.#guildId,
        subject.spaceId,
        subject.ownerIdentityId,
        input.subjectType,
        input.subjectId,
        subject.visibility,
        subject.classification,
        subject.allowedIdentityIds ?? [],
        input.openedEvent.id,
      ],
    )).rows[0];
    const opened = inserted !== undefined;
    const conversation = inserted ?? (await this.#connection.query<ConversationRow>(
      `SELECT id::text, subject_type, subject_id::text, space_id::text,
              owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], status, version,
              created_at::text, updated_at::text
         FROM conversations
        WHERE guild_id = $1 AND subject_type = $2 AND subject_id = $3
        FOR UPDATE`,
      [this.#guildId, input.subjectType, input.subjectId],
    )).rows[0];
    if (!conversation) throw new Error("Conversation could not be created.");
    if (conversation.status !== "open") throw new Error("Conversation is locked.");
    if (opened) await this.#chronicle.appendChronicle(input.openedEvent);

    const message = (await this.#connection.query<MessageRow>(
      `INSERT INTO conversation_messages
         (id, guild_id, conversation_id, author_identity_id, body,
          mentioned_identity_ids, state, version, last_event_id)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], 'active', 1, $7)
       RETURNING id::text, conversation_id::text, author_identity_id::text,
                 (SELECT display_name FROM identities
                   WHERE guild_id = $2 AND id = $4) AS author_display_name,
                 body, mentioned_identity_ids::text[], state, version,
                 redacted_by_identity_id::text, redacted_at::text,
                 redaction_reason, created_at::text`,
      [
        input.messageId,
        this.#guildId,
        conversation.id,
        input.actorIdentityId,
        body,
        input.mentionedIdentityIds,
        input.postedEvent.id,
      ],
    )).rows[0];
    if (!message) throw new Error("Conversation message was not created.");
    await this.#chronicle.appendChronicle(input.postedEvent);
    const notifications = await this.#connection.query(
       `INSERT INTO inbox_notifications
         (id, guild_id, recipient_identity_id, kind, title, body,
          resource_type, resource_id, space_id, owner_identity_id, visibility,
          classification, allowed_identity_ids, deduplication_key)
       SELECT gen_random_uuid(), $1, mentioned.identity_id, 'mention',
              'You were mentioned in a comment',
              'Open the linked Guild record to review the comment in context.',
              $2, $3, $4, $5, $6, $7, $8::uuid[],
              'conversation-mention:' || $9::text || ':' || mentioned.identity_id::text
         FROM unnest($10::uuid[]) mentioned(identity_id)
       ON CONFLICT (guild_id, recipient_identity_id, deduplication_key)
         WHERE deduplication_key IS NOT NULL DO NOTHING`,
      [
        this.#guildId,
        input.subjectType,
        input.subjectId,
        subject.spaceId,
        subject.ownerIdentityId,
        subject.visibility,
        subject.classification,
        subject.allowedIdentityIds ?? [],
        input.messageId,
        input.mentionedIdentityIds,
      ],
    );
    return {
      conversation: mapConversation(this.#guildId, conversation),
      message: mapMessage(message),
      opened,
      notificationCount: notifications.rowCount ?? 0,
    };
  }

  async setStatus(input: ModerateConversationInput): Promise<Conversation> {
    const subject = await this.#subjectForConversation(
      input.actorIdentityId,
      input.conversationId,
      "conversation.moderate",
    );
    const current = (await this.#connection.query<ConversationRow>(
      `SELECT id::text, subject_type, subject_id::text, space_id::text,
              owner_identity_id::text, visibility, classification,
              allowed_identity_ids::text[], status, version,
              created_at::text, updated_at::text
         FROM conversations WHERE guild_id = $1 AND id = $2 FOR UPDATE`,
      [this.#guildId, input.conversationId],
    )).rows[0];
    if (!current || current.version !== input.expectedVersion) {
      throw new Error("Conversation changed since it was loaded.");
    }
    assertConversationStatusTransition(current.status, input.nextStatus);
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      input.nextStatus === "locked" ? "conversation.locked" : "conversation.unlocked",
      "conversation",
      input.conversationId,
      subject,
    );
    await this.#setActor(input.actorIdentityId);
    const updated = (await this.#connection.query<ConversationRow>(
      `UPDATE conversations
          SET status = $3, version = version + 1, last_event_id = $5
        WHERE guild_id = $1 AND id = $2 AND version = $4
       RETURNING id::text, subject_type, subject_id::text, space_id::text,
                 owner_identity_id::text, visibility, classification,
                 allowed_identity_ids::text[], status, version,
                 created_at::text, updated_at::text`,
      [
        this.#guildId,
        input.conversationId,
        input.nextStatus,
        input.expectedVersion,
        input.chronicleEvent.id,
      ],
    )).rows[0];
    if (!updated) throw new Error("Conversation changed before moderation.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return mapConversation(this.#guildId, updated);
  }

  async redactMessage(input: RedactConversationMessageInput): Promise<number> {
    const subject = await this.#subjectForConversation(
      input.actorIdentityId,
      input.conversationId,
      "conversation.moderate",
    );
    this.#assertEvent(
      input.chronicleEvent,
      input.actorIdentityId,
      "conversation.message.redacted",
      "conversation_message",
      input.messageId,
      subject,
    );
    await this.#setActor(input.actorIdentityId);
    const updated = (await this.#connection.query<{ version: number }>(
      `UPDATE conversation_messages message
          SET state = 'redacted', version = message.version + 1,
              redacted_by_identity_id = $4, redacted_at = now(),
              redaction_reason = $5, last_event_id = $7
         FROM conversations thread
        WHERE message.guild_id = $1 AND message.id = $2
          AND message.conversation_id = $3 AND message.version = $6
          AND message.state = 'active'
          AND thread.guild_id = message.guild_id AND thread.id = message.conversation_id
       RETURNING message.version`,
      [
        this.#guildId,
        input.messageId,
        input.conversationId,
        input.actorIdentityId,
        input.reason,
        input.expectedVersion,
        input.chronicleEvent.id,
      ],
    )).rows[0];
    if (!updated) throw new Error("Conversation message changed before redaction.");
    await this.#chronicle.appendChronicle(input.chronicleEvent);
    return updated.version;
  }

  async searchMentionCandidates(
    actorIdentityId: string,
    subjectType: ConversationSubjectType,
    subjectId: string,
    search: string,
    limit: number,
  ): Promise<readonly ConversationMentionCandidate[]> {
    const result = await this.#connection.query<QueryResultRow & {
      id: string;
      display_name: string;
    }>(
      `WITH authorized_actor AS MATERIALIZED (
         SELECT 1
          WHERE guild_runtime.identity_can_access_conversation_subject(
            $1, $2, $3, $4, 'conversation.create'
          )
       )
       SELECT identity_row.id::text, identity_row.display_name
         FROM identities identity_row
         JOIN memberships membership_row
           ON membership_row.guild_id = identity_row.guild_id
          AND membership_row.identity_id = identity_row.id
         CROSS JOIN authorized_actor
        WHERE identity_row.guild_id = $1 AND identity_row.id <> $2
          AND identity_row.kind = 'human' AND identity_row.status = 'active'
          AND membership_row.state IN ('preboarding', 'active')
          AND lower(identity_row.display_name) LIKE lower($5) || '%'
          AND guild_runtime.identity_can_access_conversation_subject(
            $1, identity_row.id, $3, $4, 'conversation.read'
          )
        ORDER BY lower(identity_row.display_name), identity_row.id
        LIMIT $6`,
      [this.#guildId, actorIdentityId, subjectType, subjectId, search, limit],
    );
    return result.rows.map((row) => ({ id: row.id, displayName: row.display_name }));
  }

  async #subjectForConversation(
    actorIdentityId: string,
    conversationId: string,
    permission: "conversation.moderate",
  ): Promise<ConversationSubjectResource> {
    const row = (await this.#connection.query<SubjectRow & {
      subject_type: ConversationSubjectType;
      subject_id: string;
    }>(
      `SELECT thread.subject_type, thread.subject_id::text,
              subject.space_id::text, subject.owner_identity_id::text,
              subject.visibility, subject.classification,
              subject.allowed_identity_ids::text[], subject.read_permission
         FROM conversations thread
         CROSS JOIN LATERAL guild_runtime.conversation_subject(
           thread.guild_id, thread.subject_type, thread.subject_id
         ) subject
        WHERE thread.guild_id = $1 AND thread.id = $3
          AND guild_runtime.identity_can_access_conversation_subject(
            $1, $2, thread.subject_type, thread.subject_id, $4
          )`,
      [this.#guildId, actorIdentityId, conversationId, permission],
    )).rows[0];
    if (!row) throw new Error("Conversation was not found or moderation is not authorized.");
    return mapSubject(this.#guildId, row.subject_type, row.subject_id, row);
  }

  async #setActor(actorIdentityId: string): Promise<void> {
    await this.#connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
      actorIdentityId,
    ]);
  }

  #assertEvent(
    event: ChronicleEvent,
    actorIdentityId: string,
    action: string,
    subjectType: string,
    subjectId: string,
    boundary: SecuredResource,
  ): void {
    if (event.guildId !== this.#guildId || event.actorIdentityId !== actorIdentityId ||
        event.action !== action || event.subjectType !== subjectType ||
        event.subjectId !== subjectId || event.spaceId !== boundary.spaceId ||
        event.ownerIdentityId !== boundary.ownerIdentityId ||
        event.visibility !== boundary.visibility ||
        event.classification !== boundary.classification ||
        !sameIdentitySet(event.allowedIdentityIds ?? [], boundary.allowedIdentityIds ?? [])) {
      throw new Error("Conversation event crosses the active Guild, actor, subject, or boundary.");
    }
  }
}
