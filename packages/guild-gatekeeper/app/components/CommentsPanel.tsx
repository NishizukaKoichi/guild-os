import {
  AtSign,
  Bot,
  EyeOff,
  LoaderCircle,
  Lock,
  LockOpen,
  MessageSquare,
  Send,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationSubjectType } from "@guild-os/domain";
import type {
  GuildUiApi,
  UiConversationMentionCandidate,
  UiConversationThread,
  UiDirectoryIdentity,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

type ModerationAction =
  | { kind: "status"; nextStatus: "open" | "locked" }
  | { kind: "redact"; messageId: string; expectedVersion: number };

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function CommentsPanel({
  api,
  subjectType,
  subjectId,
  identities = [],
}: {
  api: GuildUiApi;
  subjectType: ConversationSubjectType;
  subjectId: string;
  identities?: readonly UiDirectoryIdentity[];
}) {
  const { locale, t } = useI18n();
  const [thread, setThread] = useState<UiConversationThread | null>(null);
  const [body, setBody] = useState("");
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionCandidates, setMentionCandidates] = useState<readonly UiConversationMentionCandidate[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moderation, setModeration] = useState<ModerationAction | null>(null);
  const [moderationReason, setModerationReason] = useState("");
  const loadSequence = useRef(0);
  const mentionSequence = useRef(0);
  const identityById = useMemo(
    () => new Map(identities.map((identity) => [identity.id, identity])),
    [identities],
  );
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  const loadThread = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await api.getConversationThread({ subjectType, subjectId });
      if (sequence === loadSequence.current) setThread(next);
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setThread(null);
        setError(messageFrom(cause, t("conversation.loadError")));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [api, subjectId, subjectType, t]);

  useEffect(() => {
    setBody("");
    setSelectedMentionIds([]);
    setMentionSearch("");
    setMentionCandidates([]);
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!moderation) return;
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape" && !busy) setModeration(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, moderation]);

  useEffect(() => {
    const search = mentionSearch.trim();
    const sequence = ++mentionSequence.current;
    if (!thread?.capabilities.post || !search) {
      setMentionCandidates([]);
      setMentionLoading(false);
      return;
    }
    setMentionLoading(true);
    const timer = window.setTimeout(() => {
      void api.searchConversationMentions({ subjectType, subjectId, search })
        .then((candidates) => {
          if (sequence === mentionSequence.current) {
            setMentionCandidates(candidates.filter((candidate) =>
              !selectedMentionIds.includes(candidate.id)));
          }
        })
        .catch((cause) => {
          if (sequence === mentionSequence.current) {
            setMentionCandidates([]);
            setError(messageFrom(cause, t("conversation.mentionError")));
          }
        })
        .finally(() => {
          if (sequence === mentionSequence.current) setMentionLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [api, mentionSearch, selectedMentionIds, subjectId, subjectType, t, thread?.capabilities.post]);

  async function loadOlder(): Promise<void> {
    if (!thread?.nextCursor) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const older = await api.getConversationThread({
        subjectType,
        subjectId,
        cursor: thread.nextCursor,
      });
      const known = new Set(thread.messages.map((message) => message.id));
      setThread({
        ...older,
        messages: [
          ...older.messages.filter((message) => !known.has(message.id)),
          ...thread.messages,
        ],
      });
    } catch (cause) {
      setError(messageFrom(cause, t("conversation.loadError")));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function post(): Promise<void> {
    const normalized = body.trim();
    if (!normalized || !thread?.capabilities.post || thread.conversation?.status === "locked") return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.postConversationMessage({
        subjectType,
        subjectId,
        body: normalized,
        mentionedIdentityIds: selectedMentionIds,
      });
      setThread((current) => current ? {
        ...current,
        conversation: result.conversation,
        messages: current.messages.some((message) => message.id === result.message.id)
          ? current.messages
          : [...current.messages, result.message],
      } : current);
      setBody("");
      setSelectedMentionIds([]);
      setMentionSearch("");
      setMentionCandidates([]);
    } catch (cause) {
      setError(messageFrom(cause, t("conversation.postError")));
    } finally {
      setBusy(false);
    }
  }

  async function submitModeration(): Promise<void> {
    if (!moderation || !thread?.conversation || !moderationReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (moderation.kind === "status") {
        const conversation = await api.moderateConversation({
          subjectType,
          subjectId,
          conversationId: thread.conversation.id,
          expectedVersion: thread.conversation.version,
          nextStatus: moderation.nextStatus,
          reason: moderationReason.trim(),
        });
        setThread((current) => current ? { ...current, conversation } : current);
      } else {
        const version = await api.redactConversationMessage({
          subjectType,
          subjectId,
          conversationId: thread.conversation.id,
          messageId: moderation.messageId,
          expectedVersion: moderation.expectedVersion,
          reason: moderationReason.trim(),
        });
        const timestamp = new Date().toISOString();
        setThread((current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === moderation.messageId ? {
            ...message,
            body: null,
            state: "redacted",
            version,
            redactedAt: timestamp,
            redactionReason: moderationReason.trim(),
          } : message),
        } : current);
      }
      setModeration(null);
      setModerationReason("");
    } catch (cause) {
      setError(messageFrom(cause, t("conversation.moderationError")));
    } finally {
      setBusy(false);
    }
  }

  function selectMention(candidate: UiConversationMentionCandidate): void {
    setSelectedMentionIds((current) => [...current, candidate.id]);
    setMentionSearch("");
    setMentionCandidates([]);
  }

  function openModeration(action: ModerationAction): void {
    setModerationReason("");
    setModeration(action);
  }

  return (
    <section className="conversation-panel" aria-labelledby={`conversation-${subjectType}-${subjectId}`}>
      <header className="conversation-header">
        <div>
          <MessageSquare size={18} />
          <h3 id={`conversation-${subjectType}-${subjectId}`}>{t("conversation.title")}</h3>
          {thread?.messages.length ? <span>{thread.messages.length}</span> : null}
        </div>
        {thread?.conversation ? (
          <div className="conversation-status-group">
            <span className={`conversation-status conversation-status-${thread.conversation.status}`}>
              {thread.conversation.status === "locked" ? <Lock size={13} /> : <LockOpen size={13} />}
              {t(thread.conversation.status === "locked"
                ? "conversation.status.locked"
                : "conversation.status.open")}
            </span>
            {thread.capabilities.moderate ? (
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                title={t(thread.conversation.status === "locked"
                  ? "conversation.unlock"
                  : "conversation.lock")}
                aria-label={t(thread.conversation.status === "locked"
                  ? "conversation.unlock"
                  : "conversation.lock")}
                onClick={() => openModeration({
                  kind: "status",
                  nextStatus: thread.conversation?.status === "locked" ? "open" : "locked",
                })}
              >
                {thread.conversation.status === "locked" ? <LockOpen size={16} /> : <Lock size={16} />}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {loading ? (
        <div className="conversation-loading">
          <LoaderCircle className="spin" size={18} />{t("conversation.loading")}
        </div>
      ) : !thread ? (
        <button className="secondary-button" type="button" onClick={() => void loadThread()}>
          {t("common.retry")}
        </button>
      ) : (
        <>
          {thread.nextCursor ? (
            <button
              className="text-button conversation-load-older"
              type="button"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? <LoaderCircle className="spin" size={15} /> : null}
              {t("conversation.loadOlder")}
            </button>
          ) : null}

          {!thread.messages.length ? (
            <p className="conversation-empty">{t("conversation.empty")}</p>
          ) : (
            <div className="conversation-messages">
              {thread.messages.map((message) => {
                const identity = identityById.get(message.authorIdentityId);
                return (
                  <article className="conversation-message" key={message.id}>
                    <span className="conversation-avatar" aria-hidden="true">
                      {identity?.kind === "agent" ? <Bot size={16} /> : <UserRound size={16} />}
                    </span>
                    <div className="conversation-message-content">
                      <header>
                        <strong>{message.authorDisplayName}</strong>
                        <time dateTime={message.createdAt}>{formatter.format(new Date(message.createdAt))}</time>
                        {thread.capabilities.moderate && message.state === "active" ? (
                          <button
                            className="icon-button conversation-redact-button"
                            type="button"
                            disabled={busy}
                            title={t("conversation.redact")}
                            aria-label={t("conversation.redact")}
                            onClick={() => openModeration({
                              kind: "redact",
                              messageId: message.id,
                              expectedVersion: message.version,
                            })}
                          >
                            <EyeOff size={15} />
                          </button>
                        ) : null}
                      </header>
                      {message.state === "redacted" ? (
                        <div className="conversation-redacted">
                          <EyeOff size={15} />
                          <span>{t("conversation.redacted")}</span>
                          {message.redactionReason ? <small>{message.redactionReason}</small> : null}
                        </div>
                      ) : <p>{message.body}</p>}
                      {message.mentionedIdentityIds.length ? (
                        <div className="conversation-message-mentions">
                          {message.mentionedIdentityIds.map((identityId) => (
                            <span key={identityId}>@{identityById.get(identityId)?.displayName ?? t("common.unknown")}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {thread.conversation?.status === "locked" ? (
            <div className="conversation-locked-notice">
              <Lock size={16} />{t("conversation.lockedNotice")}
            </div>
          ) : thread.capabilities.post ? (
            <form
              className="conversation-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void post();
              }}
            >
              {selectedMentionIds.length ? (
                <div className="conversation-selected-mentions" aria-label={t("conversation.mentions")}>
                  {selectedMentionIds.map((identityId) => (
                    <span key={identityId}>
                      @{identityById.get(identityId)?.displayName ?? t("common.unknown")}
                      <button
                        type="button"
                        title={t("conversation.removeMention")}
                        aria-label={t("conversation.removeMention")}
                        onClick={() => setSelectedMentionIds((current) =>
                          current.filter((candidate) => candidate !== identityId))}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <label className="conversation-body-field">
                <span className="sr-only">{t("conversation.bodyLabel")}</span>
                <textarea
                  value={body}
                  maxLength={10_000}
                  rows={3}
                  disabled={busy}
                  placeholder={t("conversation.bodyPlaceholder")}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <div className="conversation-composer-footer">
                <div className="conversation-mention-search">
                  <AtSign size={16} />
                  <label>
                    <span className="sr-only">{t("conversation.mentionLabel")}</span>
                    <input
                      value={mentionSearch}
                      maxLength={100}
                      disabled={busy || selectedMentionIds.length >= 20}
                      placeholder={t("conversation.mentionPlaceholder")}
                      autoComplete="off"
                      onChange={(event) => setMentionSearch(event.target.value)}
                    />
                  </label>
                  {mentionLoading ? <LoaderCircle className="spin" size={15} /> : null}
                  {mentionSearch.trim() && !mentionLoading ? (
                    <div className="conversation-mention-results" role="listbox">
                      {mentionCandidates.length ? mentionCandidates.map((candidate) => (
                        <button
                          type="button"
                          role="option"
                          key={candidate.id}
                          onClick={() => selectMention(candidate)}
                        >
                          <UserRound size={15} />{candidate.displayName}
                        </button>
                      )) : <span>{t("conversation.noMentions")}</span>}
                    </div>
                  ) : null}
                </div>
                <span className="conversation-character-count">{body.length}/10000</span>
                <button className="primary-button" type="submit" disabled={busy || !body.trim()}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                  <span>{t("conversation.post")}</span>
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}

      {moderation ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog conversation-moderation-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-moderation-title">
            <header className="dialog-header">
              <div>
                <h2 id="conversation-moderation-title">
                  {t(moderation.kind === "redact"
                    ? "conversation.redactTitle"
                    : moderation.nextStatus === "locked"
                      ? "conversation.lockTitle"
                      : "conversation.unlockTitle")}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title={t("common.close")}
                aria-label={t("common.close")}
                disabled={busy}
                onClick={() => setModeration(null)}
              >
                <X size={18} />
              </button>
            </header>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitModeration();
              }}
            >
              <label>
                <span>{t("conversation.reasonLabel")}</span>
                <textarea
                  required
                  autoFocus
                  rows={4}
                  maxLength={2_000}
                  value={moderationReason}
                  placeholder={t("conversation.reasonPlaceholder")}
                  onChange={(event) => setModerationReason(event.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setModeration(null)}>
                  {t("common.cancel")}
                </button>
                <button className="primary-button" type="submit" disabled={busy || !moderationReason.trim()}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : null}
                  {t("conversation.confirm")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
