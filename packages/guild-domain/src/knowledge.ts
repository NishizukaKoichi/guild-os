import { KNOWLEDGE_TRANSITIONS } from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  AppLocale,
  KnowledgeReviewVerdict,
  KnowledgeState,
  LocalizedText,
} from "./types.js";
import { assertNonBlank } from "./validation.js";

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

export function assertLocalizedText(
  value: LocalizedText,
  label: string,
  maximumLength: number,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must be localized text.`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new GuildDomainError("INVALID_INPUT", `${label} requires at least one language.`);
  }
  for (const [locale, text] of entries) {
    if (!(["en", "ja", "zh-CN"] as const).includes(locale as AppLocale) ||
        typeof text !== "string") {
      throw new GuildDomainError("INVALID_INPUT", `${label} contains an unsupported language.`);
    }
    assertNonBlank(text, `${label} (${locale})`, maximumLength);
  }
}

export function assertKnowledgeContent(
  title: LocalizedText,
  summary: LocalizedText,
  body: LocalizedText,
): void {
  assertLocalizedText(title, "Knowledge title", 200);
  assertLocalizedText(summary, "Knowledge summary", 2_000);
  assertLocalizedText(body, "Knowledge body", 200_000);
  const languages = new Set(Object.keys(title));
  if (Object.keys(summary).some((locale) => !languages.has(locale)) ||
      Object.keys(body).some((locale) => !languages.has(locale)) ||
      [...languages].some((locale) => summary[locale as AppLocale] === undefined ||
        body[locale as AppLocale] === undefined)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Knowledge title, summary, and body must contain the same languages.",
    );
  }
}

export function resolveLocalizedText(
  value: LocalizedText,
  preferredLocale: AppLocale,
): string {
  for (const locale of [preferredLocale, "ja", "en", "zh-CN"] as const) {
    const candidate = value[locale];
    if (candidate?.trim()) return candidate;
  }
  return "";
}

export function assertKnowledgeReview(
  verdict: KnowledgeReviewVerdict,
  reason: string,
): void {
  if (verdict !== "approve" && verdict !== "request_changes") {
    throw new GuildDomainError("INVALID_INPUT", "Knowledge review verdict is invalid.");
  }
  assertNonBlank(reason, "Knowledge review reason", 2_000);
}
