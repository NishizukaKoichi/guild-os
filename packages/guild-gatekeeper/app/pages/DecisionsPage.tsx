import {
  BookOpen,
  CalendarClock,
  Check,
  FileCheck2,
  LoaderCircle,
  Pencil,
  Plus,
  Replace,
  Scale,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState, useEffect } from "react";
import type {
  GuildUiApi,
  UiCollectiveContext,
  UiDecisionDetail,
  UiDecisionPage,
  UiDecisionSummary,
  UiDirectory,
} from "../../src/management-types";
import { decisionMethodLabel } from "../collective-language";
import { CommentsPanel } from "../components/CommentsPanel";
import { DecisionEditorDialog } from "../components/DecisionEditorDialog";
import { DecisionReviewDialog } from "../components/DecisionReviewDialog";
import { DecisionSupersedeDialog } from "../components/DecisionSupersedeDialog";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  classificationTranslationKey,
  decisionStatusTranslationKey,
  decisionVerdictTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";

type EditorState = "create" | UiDecisionDetail | null;

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function sameBoundary(left: UiDecisionSummary, right: UiDecisionSummary): boolean {
  const allowed = (value: readonly string[] | undefined) => [...(value ?? [])].sort().join(",");
  return left.spaceId === right.spaceId && left.visibility === right.visibility &&
    left.classification === right.classification &&
    allowed(left.allowedIdentityIds) === allowed(right.allowedIdentityIds);
}

export function DecisionsPage({
  api,
  collective,
  directory,
  onOpenKnowledge,
}: {
  api: GuildUiApi;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiDecisionPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UiDecisionDetail | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [reviewing, setReviewing] = useState(false);
  const [superseding, setSuperseding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);
  const identityNames = useMemo(() => new Map(
    directory?.identities.map((identity) => [identity.id, identity.displayName]) ?? [],
  ), [directory]);
  const spaceNames = useMemo(() => new Map(
    directory?.spaces.map((space) => [space.id, space.name]) ?? [],
  ), [directory]);

  const load = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getDecisionPage();
      const nextId = preferredId && next.items.some((decision) => decision.id === preferredId)
        ? preferredId
        : next.items[0]?.id ?? null;
      setPage(next);
      setSelectedId(nextId);
      setDetail(nextId ? await api.getDecision(nextId) : null);
    } catch (cause) {
      setError(messageFrom(cause, t("decision.loadError")));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectDecision(decisionId: string): Promise<void> {
    setSelectedId(decisionId);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await api.getDecision(decisionId));
    } catch (cause) {
      setDetail(null);
      setError(messageFrom(cause, t("decision.loadError")));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refresh(decisionId: string, message: string): Promise<void> {
    await load(decisionId);
    setSuccess(message);
  }

  async function propose(): Promise<void> {
    if (!detail || !window.confirm(t("decision.confirmPropose"))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.proposeDecision({
        decisionId: detail.decision.id,
        expectedVersion: detail.decision.version,
      });
      await refresh(detail.decision.id, t("decision.toastProposed"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getDecisionPage({ cursor: page.nextCursor });
      const known = new Set(page.items.map((decision) => decision.id));
      setPage({
        ...page,
        items: [...page.items, ...next.items.filter((decision) => !known.has(decision.id))],
        nextCursor: next.nextCursor,
      });
    } catch (cause) {
      setError(messageFrom(cause, t("decision.loadError")));
    } finally {
      setBusy(false);
    }
  }

  const replacements = useMemo(() => detail && page ? page.items.filter((candidate) =>
    candidate.id !== detail.decision.id && candidate.status === "approved" &&
    sameBoundary(detail.decision, candidate)) : [], [detail, page]);

  return (
    <>
      <PageHeader
        title={t("decision.title")}
        subtitle={t("decision.subtitle")}
        action={page?.canCreate && directory ? (
          <button className="primary-button" type="button" onClick={() => setEditor("create")}>
            <Plus size={17} /><span>{t("decision.create")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {success ? <Notice kind="success">{success}</Notice> : null}
      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("decision.loading")}</div>
      ) : !page?.items.length ? (
        <EmptyState
          icon={Scale}
          title={t("decision.emptyTitle")}
          description={t("decision.empty")}
          action={page?.canCreate && directory ? (
            <button className="primary-button" type="button" onClick={() => setEditor("create")}>
              <Plus size={17} /><span>{t("decision.create")}</span>
            </button>
          ) : undefined}
        />
      ) : (
        <section className="content-section decision-workspace">
          <nav className="decision-list" aria-label={t("decision.title")}>
            {page.items.map((decision) => (
              <button
                className={decision.id === selectedId ? "decision-list-item decision-list-item-active" : "decision-list-item"}
                type="button"
                key={decision.id}
                onClick={() => void selectDecision(decision.id)}
              >
                <span className={`decision-status decision-status-${decision.status}`}>
                  {t(decisionStatusTranslationKey(decision.status))}
                </span>
                <strong>{decision.title}</strong>
                <small>{spaceNames.get(decision.spaceId ?? "") ?? t("people.global")}</small>
                <small>{decisionMethodLabel(decision.method, locale)}</small>
                <span>{decision.approvalCount}/{decision.requiredApprovals}</span>
              </button>
            ))}
            {page.nextCursor ? (
              <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore()}>
                {t("common.loadMore")}
              </button>
            ) : null}
          </nav>

          <article className="decision-detail">
            {detailLoading ? (
              <div className="inline-loading"><LoaderCircle className="spin" size={19} />{t("decision.loadingDetail")}</div>
            ) : !detail ? (
              <p className="empty-state">{t("decision.select")}</p>
            ) : (
              <>
                <header className="decision-detail-header">
                  <div>
                    <span className={`decision-status decision-status-${detail.decision.status}`}>
                      {t(decisionStatusTranslationKey(detail.decision.status))}
                    </span>
                    <h2>{detail.decision.title}</h2>
                    <p>{detail.decision.description}</p>
                  </div>
                  <div className="action-group decision-actions">
                    {detail.decision.capabilities.edit && directory ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditor(detail)}>
                        <Pencil size={16} />{t("common.edit")}
                      </button>
                    ) : null}
                    {detail.decision.capabilities.propose ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => void propose()}>
                        <Send size={16} />{t("decision.propose")}
                      </button>
                    ) : null}
                    {detail.decision.capabilities.review ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => setReviewing(true)}>
                        <Scale size={16} />{t("decision.review")}
                      </button>
                    ) : null}
                    {detail.decision.capabilities.supersede ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => setSuperseding(true)}>
                        <Replace size={16} />{t("decision.supersede")}
                      </button>
                    ) : null}
                  </div>
                </header>

                <dl className="decision-meta">
                  <div><UserRound size={16} /><dt>{t("decision.proposer")}</dt><dd>{identityNames.get(detail.decision.proposerIdentityId) ?? t("common.unknown")}</dd></div>
                  <div><Scale size={16} /><dt>{t("decision.method")}</dt><dd>{decisionMethodLabel(detail.decision.method, locale)}</dd></div>
                  <div><ShieldCheck size={16} /><dt>{t("decision.classification")}</dt><dd>{t(classificationTranslationKey(detail.decision.classification))}</dd></div>
                  <div><CalendarClock size={16} /><dt>{t("decision.reviewDate")}</dt><dd>{detail.decision.reviewAt ? dateFormatter.format(new Date(detail.decision.reviewAt)) : t("common.none")}</dd></div>
                  <div><FileCheck2 size={16} /><dt>{t("decision.version")}</dt><dd>v{detail.decision.version}</dd></div>
                </dl>

                {detail.decision.rationale ? (
                  <section className="decision-rationale">
                    <h3>{t("decision.rationale")}</h3>
                    <p>{detail.decision.rationale}</p>
                  </section>
                ) : null}

                <section className="decision-progress" aria-label={t("decision.approvals")}>
                  <div>
                    <span>{t("decision.approvalCount")}</span>
                    <strong>{detail.decision.approvalCount}</strong>
                  </div>
                  <progress value={Math.min(detail.decision.approvalCount, detail.decision.requiredApprovals)} max={detail.decision.requiredApprovals} />
                  <div>
                    <span>{t("decision.requiredApprovals")}</span>
                    <strong>{detail.decision.requiredApprovals}</strong>
                  </div>
                </section>

                <section className="decision-section">
                  <h3><Scale size={16} />{t("decision.options")}</h3>
                  <div className="decision-option-list">
                    {detail.options.map((option) => {
                      const votes = detail.approvals.filter((approval) =>
                        approval.verdict === "approve" && approval.selectedOptionId === option.id).length;
                      return (
                        <div className={option.selected ? "decision-option decision-option-selected" : "decision-option"} key={option.id}>
                          <span className="decision-option-position">{option.position + 1}</span>
                          <div><strong>{option.label}</strong><p>{option.description}</p></div>
                          <span className="decision-option-votes">{votes}</span>
                          {option.selected ? <span className="decision-selected"><Check size={15} />{t("decision.selected")}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="decision-section">
                  <h3><BookOpen size={16} />{t("decision.evidence")}</h3>
                  {!detail.decision.sourceIds.length ? <p className="compact-empty">{t("decision.noEvidence")}</p> : (
                    <div className="decision-evidence-list">
                      {detail.decision.sourceIds.map((sourceId) => (
                        <button className="text-button" type="button" key={sourceId} onClick={() => onOpenKnowledge(sourceId)}>{sourceId}</button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="decision-section">
                  <h3><FileCheck2 size={16} />{t("decision.approvals")}</h3>
                  {!detail.approvals.length ? <p className="compact-empty">{t("decision.noApprovals")}</p> : (
                    <div className="decision-approval-list">
                      {detail.approvals.map((approval) => (
                        <div key={approval.approverIdentityId}>
                          <span className={approval.verdict === "approve" ? "decision-verdict decision-verdict-approve" : "decision-verdict decision-verdict-reject"}>
                            {approval.verdict === "approve" ? <Check size={14} /> : <X size={14} />}
                            {t(decisionVerdictTranslationKey(approval.verdict))}
                          </span>
                          <div>
                            <strong>{identityNames.get(approval.approverIdentityId) ?? t("common.unknown")}</strong>
                            <p>{approval.reason}</p>
                            <small>{dateFormatter.format(new Date(approval.createdAt))}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <CommentsPanel
                  key={`decision-${detail.decision.id}`}
                  api={api}
                  subjectType="decision"
                  subjectId={detail.decision.id}
                  identities={directory?.identities ?? []}
                />
              </>
            )}
          </article>
        </section>
      )}

      {editor && directory ? (
        <DecisionEditorDialog
          api={api}
          collective={collective}
          directory={directory}
          detail={editor === "create" ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={async (decisionId) => {
            await refresh(
              decisionId,
              t(editor === "create" ? "decision.toastCreated" : "decision.toastSaved"),
            );
          }}
        />
      ) : null}
      {reviewing && detail ? (
        <DecisionReviewDialog
          api={api}
          detail={detail}
          onClose={() => setReviewing(false)}
          onReviewed={async () => refresh(detail.decision.id, t("decision.toastReviewed"))}
        />
      ) : null}
      {superseding && detail ? (
        <DecisionSupersedeDialog
          api={api}
          decision={detail.decision}
          replacements={replacements}
          onClose={() => setSuperseding(false)}
          onSuperseded={async () => refresh(detail.decision.id, t("decision.toastSuperseded"))}
        />
      ) : null}
    </>
  );
}
