import { KNOWLEDGE_TRANSITIONS } from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type { KnowledgeState } from "./types.js";

export function assertKnowledgeTransition(from: KnowledgeState, to: KnowledgeState): void {
  const allowed: readonly KnowledgeState[] = KNOWLEDGE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new GuildDomainError(
      "INVALID_KNOWLEDGE_TRANSITION",
      `Knowledge cannot transition from ${from} to ${to}.`,
    );
  }
}

export function canTransitionKnowledge(from: KnowledgeState, to: KnowledgeState): boolean {
  try {
    assertKnowledgeTransition(from, to);
    return true;
  } catch (error) {
    if (error instanceof GuildDomainError) return false;
    throw error;
  }
}
