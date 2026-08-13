import { BookOpenCheck, Bot, CheckCircle2, ClipboardCheck, GitPullRequest, HandHeart, Scale, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  GuildUiApi,
  UiContributionFacet,
  UiContributionProfile,
  UiDirectory,
  UiGovernedContributionCorrection,
} from "../../src/management-types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

const FACET_ICONS: Record<UiContributionFacet["facet"], LucideIcon> = {
  knowledge: BookOpenCheck,
  activity: CheckCircle2,
  decision: Scale,
  support: HandHeart,
  agent_supervision: Bot,
  governance: ShieldCheck,
};

export function ContributionsPage({ api, directory }: { api: GuildUiApi; directory: UiDirectory | null }) {
  const { locale, t } = useI18n();
  const [actorId, setActorId] = useState("");
  const [profile, setProfile] = useState<UiContributionProfile | null>(null);
  const [correctionEventId, setCorrectionEventId] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState<UiGovernedContributionCorrection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const actorNames = useMemo(() => new Map(directory?.identities.map((actor) =>
    [actor.id, actor.displayName]) ?? []), [directory?.identities]);

  async function load(nextActorId: string | null = null) {
    setError(null);
    try {
      const result = await api.getContributionProfile(nextActorId);
      setProfile(result);
      setActorId(result.actorId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return (
    <>
      <PageHeader title={t("contribution.title")} subtitle={t("contribution.subtitle")} />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Notice><strong>{t("contribution.noScoreTitle")}</strong> {t("contribution.noScoreBody")}</Notice>
      {directory ? <label className="contribution-actor-select"><span>{t("contribution.actor")}</span><select value={actorId} onChange={(event) => void load(event.target.value)}>{directory.identities.filter((actor) => actor.kind === "human" || actor.kind === "agent").map((actor) => <option value={actor.id} key={actor.id}>{actor.displayName}</option>)}</select></label> : null}
      {!profile ? <p className="empty-state">{t("common.loading")}</p> : (
        <>
          <section className="contribution-summary" aria-label={t("contribution.facets")}>
            {profile.facets.map((facet) => { const Icon = FACET_ICONS[facet.facet]; return <article key={facet.facet}><Icon size={20} /><div><strong>{facet.count}</strong><span>{t(`contribution.facet.${facet.facet}`)}</span></div></article>; })}
          </section>
          <section className="content-section">
            <div className="section-heading-row compact-heading"><h2>{t("contribution.evidence")}</h2><span>{profile.evidence.length}</span></div>
            {profile.evidence.length === 0 ? <EmptyState icon={GitPullRequest} title={t("contribution.emptyTitle")} description={t("contribution.emptyDescription")} /> : <div className="contribution-evidence-list">{profile.evidence.map((item) => <article key={item.eventId}><span className="event-sequence">#{item.sequence}</span><div><strong>{t(`contribution.facet.${item.facet}`)}</strong><code>{item.action}</code><small>{item.subjectType} · {formatter.format(new Date(item.occurredAt))}</small></div>{profile.canRequestCorrection ? <button className="secondary-button" type="button" onClick={() => setCorrectionEventId(item.eventId)}>{t("contribution.requestCorrection")}</button> : null}</article>)}</div>}
          </section>
          {profile.pendingCorrections.length > 0 ? (
            <section className="content-section">
              <div className="section-heading-row compact-heading">
                <h2>{t("contribution.pendingReviews")}</h2>
                <span>{profile.pendingCorrections.length}</span>
              </div>
              <div className="correction-review-list">
                {profile.pendingCorrections.map((correction) => (
                  <article key={correction.id}>
                    <ClipboardCheck size={19} aria-hidden="true" />
                    <div>
                      <strong>{actorNames.get(correction.subjectActorId) ?? t("common.unknown")}</strong>
                      <p>{correction.reason}</p>
                      <small>{t("contribution.requestedBy")} {actorNames.get(correction.requestedByActorId) ?? t("common.unknown")} · {formatter.format(new Date(correction.createdAt))}</small>
                    </div>
                    <button className="secondary-button" type="button" onClick={() => setReviewRequest(correction)}>{t("contribution.review")}</button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {profile.canRequestCorrection ? <section className="content-section"><div className="section-heading-row compact-heading"><h2>{t("contribution.corrections")}</h2><span>{profile.corrections.length}</span></div>{profile.corrections.length === 0 ? <p className="empty-state">{t("contribution.noCorrections")}</p> : <div className="correction-list">{profile.corrections.map((correction) => <article key={correction.id}><div><strong>{t(`contribution.correctionStatus.${correction.status}`)}</strong><p>{correction.reason}</p></div><time>{formatter.format(new Date(correction.createdAt))}</time></article>)}</div>}</section> : null}
        </>
      )}
      {correctionEventId ? <CorrectionDialog eventId={correctionEventId} onClose={() => setCorrectionEventId(null)} onSubmit={async (reason) => { await api.requestContributionCorrection({ chronicleEventId: correctionEventId, reason }); setCorrectionEventId(null); await load(actorId); }} /> : null}
      {reviewRequest ? <CorrectionReviewDialog request={reviewRequest} onClose={() => setReviewRequest(null)} onSubmit={async (outcome, reason) => { await api.reviewContributionCorrection({ requestId: reviewRequest.id, expectedVersion: reviewRequest.version, outcome, reason }); setReviewRequest(null); await load(actorId); }} /> : null}
    </>
  );
}

function CorrectionReviewDialog({ request, onClose, onSubmit }: {
  request: UiGovernedContributionCorrection;
  onClose(): void;
  onSubmit(outcome: "accepted" | "rejected", reason: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<"accepted" | "rejected">("accepted");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(outcome, reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="correction-review-title">
        <header className="dialog-header">
          <div><h2 id="correction-review-title">{t("contribution.reviewTitle")}</h2><small>{request.evidenceEventId}</small></div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <blockquote className="correction-review-request">{request.reason}</blockquote>
          <fieldset>
            <legend>{t("contribution.reviewOutcome")}</legend>
            <div className="review-outcome-control">
              <label className={outcome === "accepted" ? "review-outcome-active" : ""}><input type="radio" name="correction-outcome" checked={outcome === "accepted"} onChange={() => setOutcome("accepted")} /><CheckCircle2 size={17} /><span>{t("contribution.accept")}</span></label>
              <label className={outcome === "rejected" ? "review-outcome-active" : ""}><input type="radio" name="correction-outcome" checked={outcome === "rejected"} onChange={() => setOutcome("rejected")} /><X size={17} /><span>{t("contribution.reject")}</span></label>
            </div>
          </fieldset>
          <label><span>{t("contribution.reviewReason")}</span><textarea autoFocus required minLength={1} rows={4} maxLength={5_000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || !reason.trim()}>{t("contribution.saveReview")}</button></footer>
        </form>
      </section>
    </div>
  );
}

function CorrectionDialog({ eventId, onClose, onSubmit }: { eventId: string; onClose(): void; onSubmit(reason: string): Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await onSubmit(reason.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.generic")); setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title"><header className="dialog-header"><div><h2 id="correction-title">{t("contribution.requestCorrection")}</h2><small>{eventId}</small></div><button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header><form className="stack-form" onSubmit={(event) => void submit(event)}><label><span>{t("contribution.correctionReason")}</span><textarea autoFocus required rows={5} maxLength={5_000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("contribution.correctionPlaceholder")} /></label>{error ? <Notice kind="error">{error}</Notice> : null}<footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || !reason.trim()}>{t("contribution.submitCorrection")}</button></footer></form></section></div>;
}
