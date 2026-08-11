import {
  CONVERSATION_STATUSES,
  CONVERSATION_SUBJECT_TYPES,
} from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  ConversationStatus,
  ConversationSubjectType,
} from "./types.js";
import { assertNonBlank } from "./validation.js";

export const MAX_CONVERSATION_BODY_LENGTH = 10_000;
export const MAX_CONVERSATION_MENTIONS = 20;

export function assertConversationSubjectType(
  value: string,
): asserts value is ConversationSubjectType {
  if (!(CONVERSATION_SUBJECT_TYPES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Conversation subject type is not supported.");
  }
}

export function normalizeConversationBody(body: string): string {
  const normalized = body.trim();
  assertNonBlank(normalized, "Comment", MAX_CONVERSATION_BODY_LENGTH);
  return normalized;
}

export function assertConversationMentions(identityIds: readonly string[]): void {
  if (!Array.isArray(identityIds) || identityIds.length > MAX_CONVERSATION_MENTIONS ||
      new Set(identityIds).size !== identityIds.length) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `A comment supports at most ${MAX_CONVERSATION_MENTIONS} unique mentions.`,
    );
  }
}

export function assertConversationStatusTransition(
  current: ConversationStatus,
  next: ConversationStatus,
): void {
  if (!(CONVERSATION_STATUSES as readonly string[]).includes(next) || current === next) {
    throw new GuildDomainError(
      "INVALID_CONVERSATION_TRANSITION",
      "Conversation status must change once per update.",
    );
  }
}
