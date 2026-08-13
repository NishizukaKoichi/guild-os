import {
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  ListTodo,
  LockKeyhole,
  MessageSquarePlus,
  Scale,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  Classification,
} from "@guild-os/domain";
import type {
  GuildUiApi,
  PrivateMessagePromotionKind,
  PromotePrivateMessageRequest,
  UiDirectory,
  UiPrivatePage,
  UiPrivateThreadDetail,
} from "../../src/management-types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { classificationTranslationKey, useI18n } from "../i18n";

export function MessagesPage({ api, directory }: { api: GuildUiApi; directory: UiDirectory | null }) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiPrivatePage | null>(null);
  const [detail, setDetail] = useState<UiPrivateThreadDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [promotionSource, setPromotionSource] = useState<
    UiPrivateThreadDetail["messages"][number] | null
  >(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actorNames = useMemo(() => new Map(directory?.identities.map((actor) =>
    [actor.id, actor.displayName]) ?? []), [directory?.identities]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  async function load(selectedId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getPrivatePage();
      setPage(next);
      const target = selectedId ?? detail?.thread.id ?? next.threads[0]?.id ?? null;
      setDetail(target ? await api.getPrivateThread(target) : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // The API identity is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!detail || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.postPrivateMessage({ threadId: detail.thread.id, body: message.trim() });
      setMessage("");
      await load(detail.thread.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("messages.title")}
        subtitle={t("messages.subtitle")}
        action={page?.canCreate ? (
          <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
            <MessageSquarePlus size={17} /><span>{t("messages.new")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Notice><strong>{t("messages.privacyTitle")}</strong> {t("messages.privacyBody")}</Notice>
      {loading && !page ? <p className="empty-state">{t("common.loading")}</p> : null}
      {page && page.threads.length === 0 ? (
        <EmptyState icon={LockKeyhole} title={t("messages.emptyTitle")} description={t("messages.emptyDescription")} />
      ) : null}
      {page && page.threads.length > 0 ? (
        <section className="private-workspace">
          <aside className="private-thread-list" aria-label={t("messages.threads")}>
            {page.threads.map((thread) => (
              <button className={detail?.thread.id === thread.id ? "private-thread-row private-thread-active" : "private-thread-row"} type="button" key={thread.id} onClick={() => void load(thread.id)}>
                <strong>{thread.subject}</strong>
                <span>{thread.lastMessagePreview ?? t("messages.noPreview")}</span>
                <small>{thread.lastMessageAt ? formatter.format(new Date(thread.lastMessageAt)) : ""}</small>
              </button>
            ))}
          </aside>
          <div className="private-thread-detail">
            {detail ? (
              <>
                <header className="private-thread-header">
                  <div><h2>{detail.thread.subject}</h2><p>{detail.thread.participantActorIds.map((id) => actorNames.get(id) ?? t("common.unknown")).join(", ")}</p></div>
                  <span className={`status-pill classification-${detail.thread.classification}`}>{t(classificationTranslationKey(detail.thread.classification))}</span>
                </header>
                {detail.emergencyGrant ? <Notice kind="warning">{t("messages.emergencyActive")}</Notice> : null}
                <div className="private-message-list">
                  {detail.messages.map((item) => (
                    <article className="private-message" key={item.id}>
                      <header><strong>{actorNames.get(item.authorActorId) ?? t("common.unknown")}</strong><time>{formatter.format(new Date(item.createdAt))}</time></header>
                      <p>{item.state === "redacted" ? t("messages.redacted") : item.body}</p>
                      {item.state === "active" && detail.promotionKinds.length > 0 ? (
                        <footer className="private-message-actions">
                          <button className="secondary-button" type="button" onClick={() => setPromotionSource(item)}>
                            <ArrowUpRight size={16} />{t("messages.promote")}
                          </button>
                        </footer>
                      ) : null}
                    </article>
                  ))}
                </div>
                {detail.promotions.length > 0 ? (
                  <section className="private-promotion-history" aria-label={t("messages.promotionHistory")}>
                    <div className="section-heading-row compact-heading">
                      <h3>{t("messages.promotionHistory")}</h3>
                      <span>{detail.promotions.length}</span>
                    </div>
                    <div className="private-promotion-list">
                      {detail.promotions.map((promotion) => (
                        <article key={promotion.id}>
                          <PromotionIcon kind={promotion.destinationKind} />
                          <div>
                            <strong>{t(`messages.promotion.${promotion.destinationKind}`)}</strong>
                            <span>{actorNames.get(promotion.promotedByActorId) ?? t("common.unknown")}</span>
                            <code>{promotion.destinationDraftId}</code>
                          </div>
                          <time>{formatter.format(new Date(promotion.createdAt))}</time>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
                <form className="private-composer" onSubmit={(event) => void post(event)}>
                  <label className="sr-only" htmlFor="private-message-body">{t("messages.reply")}</label>
                  <textarea id="private-message-body" required rows={2} maxLength={20_000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("messages.replyPlaceholder")} />
                  <button className="primary-button" type="submit" disabled={busy || !message.trim()} title={t("messages.send")} aria-label={t("messages.send")}><Send size={18} /></button>
                </form>
              </>
            ) : null}
          </div>
        </section>
      ) : null}
      {page?.canUseEmergencyAccess && page.emergencyCandidates.length > 0 ? (
        <section className="content-section emergency-access-entry">
          <div><ShieldAlert size={20} /><div><h2>{t("messages.breakGlassTitle")}</h2><p>{t("messages.breakGlassDescription")}</p></div></div>
          <button className="secondary-button" type="button" onClick={() => setEmergencyOpen(true)}>{t("messages.breakGlassOpen")}</button>
        </section>
      ) : null}
      {createOpen && page ? (
        <CreatePrivateThreadDialog
          page={page}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const id = await api.createPrivateThread(input);
            setCreateOpen(false);
            await load(id);
          }}
        />
      ) : null}
      {emergencyOpen && page ? (
        <EmergencyAccessDialog
          page={page}
          onClose={() => setEmergencyOpen(false)}
          onOpen={async (input) => {
            await api.beginEmergencyPrivateAccess(input);
            setEmergencyOpen(false);
            await load(input.threadId);
          }}
        />
      ) : null}
      {promotionSource && detail ? (
        <PromotePrivateMessageDialog
          detail={detail}
          source={promotionSource}
          directory={directory}
          onClose={() => setPromotionSource(null)}
          onPromote={async (input) => {
            setBusy(true);
            setError(null);
            try {
              await api.promotePrivateMessage(input);
              setPromotionSource(null);
              await load(input.threadId);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t("error.generic"));
              throw cause;
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function PromotionIcon({ kind }: { kind: PrivateMessagePromotionKind }) {
  const Icon = kind === "memory" ? BookOpen
    : kind === "activity" ? ListTodo
      : kind === "decision" ? Scale
        : ClipboardCheck;
  return <Icon size={18} aria-hidden="true" />;
}

function PromotePrivateMessageDialog({ detail, source, directory, onClose, onPromote }: {
  detail: UiPrivateThreadDetail;
  source: UiPrivateThreadDetail["messages"][number];
  directory: UiDirectory | null;
  onClose(): void;
  onPromote(input: PromotePrivateMessageRequest): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [kind, setKind] = useState<PrivateMessagePromotionKind>(
    detail.promotionKinds[0] ?? "memory",
  );
  const [title, setTitle] = useState(detail.thread.subject);
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const humans = directory?.identities.filter((identity) =>
    identity.kind === "human" && identity.status === "active" &&
    ["preboarding", "active", "suspended"].includes(identity.membershipState)) ?? [];
  const initialDepartingActorId = humans.find((identity) =>
    identity.id === source.authorActorId)?.id ?? humans[0]?.id ?? "";
  const [departingActorId, setDepartingActorId] = useState(initialDepartingActorId);
  const [successorActorId, setSuccessorActorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const boundary = {
      spaceId: detail.thread.spaceId,
      visibility: detail.thread.spaceId === null ? "guild" as const : "space" as const,
      classification: detail.thread.classification,
      allowedActorIds: [] as readonly string[],
    };
    const destination: PromotePrivateMessageRequest["destination"] = kind === "memory"
      ? {
        ...boundary,
        kind,
        locale,
        memoryType: "knowledge",
        title: title.trim(),
        summary: summary.trim(),
      }
      : kind === "activity"
        ? {
          ...boundary,
          kind,
          activityType: "task",
          title: title.trim(),
          assigneeActorId: null,
        }
        : kind === "decision"
          ? {
            ...boundary,
            kind,
            method: "consent",
            title: title.trim(),
            rationale: rationale.trim(),
          }
          : {
            kind,
            departingActorId,
            successorActorId: successorActorId || null,
          };
    try {
      await onPromote({
        threadId: detail.thread.id,
        sourceMessageId: source.id,
        selectionStart: 0,
        selectionLength: source.body.length,
        idempotencyKey: crypto.randomUUID(),
        destination,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setBusy(false);
    }
  }

  const valid = kind === "handover"
    ? Boolean(departingActorId)
    : Boolean(title.trim()) && (kind !== "memory" || Boolean(summary.trim()));

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog private-promotion-dialog" role="dialog" aria-modal="true" aria-labelledby="private-promotion-title">
        <header className="dialog-header">
          <h2 id="private-promotion-title">{t("messages.promoteTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <blockquote className="private-promotion-source">{source.body}</blockquote>
          <fieldset>
            <legend>{t("messages.destination")}</legend>
            <div className="promotion-kind-grid">
              {detail.promotionKinds.map((candidate) => (
                <label className={kind === candidate ? "promotion-kind-active" : ""} key={candidate}>
                  <input type="radio" name="promotion-kind" value={candidate} checked={kind === candidate} onChange={() => setKind(candidate)} />
                  <PromotionIcon kind={candidate} />
                  <span>{t(`messages.promotion.${candidate}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {kind === "handover" ? (
            <div className="form-grid two-columns">
              <label><span>{t("messages.departingActor")}</span><select required value={departingActorId} onChange={(event) => setDepartingActorId(event.target.value)}>{humans.map((human) => <option key={human.id} value={human.id}>{human.displayName}</option>)}</select></label>
              <label><span>{t("messages.successorActor")}</span><select value={successorActorId} onChange={(event) => setSuccessorActorId(event.target.value)}><option value="">{t("messages.noSuccessor")}</option>{humans.filter((human) => human.id !== departingActorId && human.membershipState === "active").map((human) => <option key={human.id} value={human.id}>{human.displayName}</option>)}</select></label>
            </div>
          ) : (
            <>
              <label><span>{t("messages.destinationTitle")}</span><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              {kind === "memory" ? <label><span>{t("messages.destinationSummary")}</span><textarea required rows={3} maxLength={2_000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label> : null}
              {kind === "decision" ? <label><span>{t("messages.destinationRationale")}</span><textarea rows={3} maxLength={10_000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label> : null}
            </>
          )}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !valid}><ArrowUpRight size={17} />{t("messages.createDraft")}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CreatePrivateThreadDialog({ page, onClose, onCreate }: {
  page: UiPrivatePage;
  onClose(): void;
  onCreate(input: Parameters<GuildUiApi["createPrivateThread"]>[0]): Promise<void>;
}) {
  const { t } = useI18n();
  const [participants, setParticipants] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [classification, setClassification] = useState<Classification>("internal");
  const [spaceId, setSpaceId] = useState<string | null>(
    page.canCreateGuildWide ? null : page.availableSpaces[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ participantActorIds: participants, spaceId, subject, body, classification });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-private-thread-title">
        <header className="dialog-header"><h2 id="new-private-thread-title">{t("messages.newTitle")}</h2><button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <fieldset><legend>{t("messages.participants")}</legend><div className="check-list">{page.eligibleActors.map((actor) => (
            <label key={actor.id}><input type="checkbox" checked={participants.includes(actor.id)} onChange={(event) => setParticipants((current) => event.target.checked ? [...current, actor.id] : current.filter((id) => id !== actor.id))} /><span>{actor.displayName}</span></label>
          ))}</div></fieldset>
          <label><span>{t("messages.space")}</span><select value={spaceId ?? ""} onChange={(event) => setSpaceId(event.target.value || null)}>{page.canCreateGuildWide ? <option value="">{t("messages.guildWide")}</option> : null}{page.availableSpaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label>
          <label><span>{t("messages.subject")}</span><input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label><span>{t("messages.classification")}</span><select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>{(["internal", "confidential", "restricted"] as const).map((value) => <option value={value} key={value}>{t(classificationTranslationKey(value))}</option>)}</select></label>
          <label><span>{t("messages.firstMessage")}</span><textarea required rows={5} maxLength={20_000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || participants.length === 0 || (!page.canCreateGuildWide && !spaceId) || !subject.trim() || !body.trim()}><Send size={17} />{t("common.create")}</button></footer>
        </form>
      </section>
    </div>
  );
}

function EmergencyAccessDialog({ page, onClose, onOpen }: {
  page: UiPrivatePage;
  onClose(): void;
  onOpen(input: Parameters<GuildUiApi["beginEmergencyPrivateAccess"]>[0]): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const first = page.emergencyCandidates[0]?.id ?? "";
  const [threadId, setThreadId] = useState(first);
  const [reason, setReason] = useState("");
  const [intendedAccess, setIntendedAccess] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onOpen({ threadId, reason, intendedAccess, durationMinutes: 15, confirmation });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="emergency-private-title">
        <header className="dialog-header"><h2 id="emergency-private-title">{t("messages.breakGlassTitle")}</h2><button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <Notice kind="warning">{t("messages.breakGlassWarning")}</Notice>
          <label><span>{t("messages.thread")}</span><select value={threadId} onChange={(event) => setThreadId(event.target.value)}>{page.emergencyCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{formatter.format(new Date(candidate.createdAt))} · {candidate.id.slice(0, 8)}</option>)}</select></label>
          <label><span>{t("messages.emergencyReason")}</span><textarea required minLength={10} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label><span>{t("messages.intendedAccess")}</span><textarea required minLength={10} rows={3} value={intendedAccess} onChange={(event) => setIntendedAccess(event.target.value)} /></label>
          <label><span>{t("messages.breakGlassConfirmation")}</span><input required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="BREAK GLASS" /></label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="danger-button text-button" type="submit" disabled={busy || confirmation !== "BREAK GLASS"}><ShieldAlert size={17} />{t("messages.breakGlassOpen")}</button></footer>
        </form>
      </section>
    </div>
  );
}
