import {
  Activity,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Code2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  UserRound,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GuildUiApi,
  UiAgentRunDetail,
  UiAgentRunPage,
  UiDirectory,
} from "../../src/management-types";
import { AgentRunDialog } from "./AgentRunDialog";
import { AgentRunReviewDialog } from "./AgentRunReviewDialog";
import { Notice } from "./Notice";
import {
  agentApprovalStatusTranslationKey,
  agentRunStatusTranslationKey,
  classificationTranslationKey,
  useI18n,
} from "../i18n";

const ACTIVE_STATUSES = new Set(["planning", "awaiting_approval", "running"]);

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function AgentRunsPanel({ api, directory }: { api: GuildUiApi; directory: UiDirectory }) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiAgentRunPage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UiAgentRunDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);
  const spaceNames = useMemo(() => new Map(
    directory.spaces.map((space) => [space.id, space.name]),
  ), [directory.spaces]);
  const canCreate = Boolean(page?.connectors.some((connector) => connector.status === "active") &&
    page.runnableSpaceIds.length > 0 && page.runnableAgents.length > 0);

  const load = useCallback(async (preferredId?: string | null, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await api.getAgentRunPage();
      const nextId = preferredId && next.items.some((run) => run.id === preferredId)
        ? preferredId
        : next.items[0]?.id ?? null;
      setPage(next);
      setSelectedId(nextId);
      setDetail(nextId ? await api.getAgentRun(nextId) : null);
    } catch (cause) {
      setError(messageFrom(cause, t("agentRun.loadError")));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!page?.items.some((run) => ACTIVE_STATUSES.has(run.status))) return;
    const timer = window.setInterval(() => void load(selectedId, true), 3_000);
    return () => window.clearInterval(timer);
  }, [load, page, selectedId]);

  async function selectRun(runId: string): Promise<void> {
    setSelectedId(runId);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await api.getAgentRun(runId));
    } catch (cause) {
      setDetail(null);
      setError(messageFrom(cause, t("agentRun.loadError")));
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getAgentRunPage({ cursor: page.nextCursor });
      const known = new Set(page.items.map((run) => run.id));
      setPage({
        ...page,
        items: [...page.items, ...next.items.filter((run) => !known.has(run.id))],
        nextCursor: next.nextCursor,
      });
    } catch (cause) {
      setError(messageFrom(cause, t("agentRun.loadError")));
    } finally {
      setBusy(false);
    }
  }

  async function kill(): Promise<void> {
    if (!detail || !window.confirm(t("agentRun.confirmKill"))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.killAgentRun(detail.id);
      await load(detail.id);
      setSuccess(t("agentRun.toastKilled"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-section agent-runs-section" aria-labelledby="agent-runs-title">
      <div className="section-heading-row agent-runs-heading">
        <Activity size={18} />
        <div>
          <h2 id="agent-runs-title">{t("agentRun.title")}</h2>
          <p>{t("agentRun.subtitle")}</p>
        </div>
        <div className="agent-runs-heading-actions">
          <button className="icon-button" type="button" disabled={loading} title={t("agentRun.refresh")} aria-label={t("agentRun.refresh")} onClick={() => void load(selectedId)}>
            <RefreshCw size={17} />
          </button>
          {canCreate && page ? (
            <button className="primary-button" type="button" onClick={() => setCreating(true)}>
              <Play size={16} />{t("agentRun.create")}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {success ? <Notice kind="success">{success}</Notice> : null}
      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("agentRun.loading")}</div>
      ) : !page?.items.length ? (
        <p className="empty-state">{canCreate ? t("agentRun.empty") : t("agentRun.unavailable")}</p>
      ) : (
        <div className="agent-run-workspace">
          <nav className="agent-run-list" aria-label={t("agentRun.title")}>
            {page.items.map((run) => (
              <button className={run.id === selectedId ? "agent-run-list-item agent-run-list-item-active" : "agent-run-list-item"} type="button" key={run.id} onClick={() => void selectRun(run.id)}>
                <span className={`agent-run-status agent-run-status-${run.status}`}>{t(agentRunStatusTranslationKey(run.status))}</span>
                <span className="agent-run-risk">{t(`agentRun.risk.${run.riskLevel}`)}</span>
                <strong>{run.plan.objective}</strong>
                <small>{run.agentDisplayName} · {spaceNames.get(run.spaceId ?? "") ?? t("people.global")}</small>
              </button>
            ))}
            {page.nextCursor ? <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore()}>{t("common.loadMore")}</button> : null}
          </nav>
          <article className="agent-run-detail">
            {detailLoading ? (
              <div className="inline-loading"><LoaderCircle className="spin" size={19} />{t("agentRun.loadingDetail")}</div>
            ) : !detail ? (
              <p className="empty-state">{t("agentRun.select")}</p>
            ) : (
              <>
                <header className="agent-run-detail-header">
                  <div>
                    <span className={`agent-run-status agent-run-status-${detail.status}`}>{t(agentRunStatusTranslationKey(detail.status))}</span>
                    <h2>{detail.plan.objective}</h2>
                    <p>{detail.plan.expectedOutcome}</p>
                  </div>
                  <div className="action-group agent-run-actions">
                    {detail.capabilities.review && detail.approval?.status === "pending" ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => setReviewing(true)}>
                        <ShieldAlert size={16} />{t("agentRun.review")}
                      </button>
                    ) : null}
                    {detail.capabilities.stop ? (
                      <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void kill()}>
                        <Square size={16} />{t("agentRun.kill")}
                      </button>
                    ) : null}
                  </div>
                </header>

                <dl className="agent-run-meta">
                  <div><Bot size={16} /><dt>{t("agentRun.agent")}</dt><dd>{detail.agentDisplayName}</dd></div>
                  <div><UserRound size={16} /><dt>{t("agentRun.requester")}</dt><dd>{detail.requesterDisplayName}</dd></div>
                  <div><Workflow size={16} /><dt>{t("agentRun.connector")}</dt><dd>{detail.connectorName}</dd></div>
                  <div><CalendarClock size={16} /><dt>{t("agentRun.created")}</dt><dd>{dateFormatter.format(new Date(detail.createdAt))}</dd></div>
                  <div><ShieldAlert size={16} /><dt>{t("agentRun.risk")}</dt><dd>{t(`agentRun.risk.${detail.riskLevel}`)}</dd></div>
                  <div><Code2 size={16} /><dt>{t("agentRun.classification")}</dt><dd>{t(classificationTranslationKey(detail.classification))}</dd></div>
                </dl>

                {detail.errorMessage ? <Notice kind="error" title={t("agentRun.failure")}>{detail.errorMessage}</Notice> : null}
                {detail.result ? <Notice kind="success" title={t("agentRun.delivered")}>{t("agentRun.httpStatus")} {detail.result.statusCode} · {dateFormatter.format(new Date(detail.result.deliveredAt))}</Notice> : null}

                <section className="agent-run-section">
                  <h3><Workflow size={16} />{t("agentRun.plan")}</h3>
                  <ol>{detail.plan.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
                </section>

                <section className="agent-run-section">
                  <h3><Code2 size={16} />{t("agentRun.action")}</h3>
                  <dl className="agent-run-action-meta">
                    <div><dt>{t("agentRun.eventType")}</dt><dd><code>{detail.plan.action.eventType}</code></dd></div>
                    <div><dt>{t("agentRun.idempotency")}</dt><dd><code>{detail.idempotencyKey}</code></dd></div>
                  </dl>
                  <pre className="agent-run-payload"><code>{JSON.stringify(detail.plan.action.payload, null, 2)}</code></pre>
                </section>

                <section className="agent-run-section">
                  <h3><CircleDollarSign size={16} />{t("agentRun.limitsAndUsage")}</h3>
                  <div className="agent-run-limit-grid">
                    <div><strong>{detail.usage.budgetMinor}/{detail.limits.maxBudgetMinor} {detail.limits.currency}</strong><span>{t("agentRun.budget")}</span></div>
                    <div><strong>{detail.usage.durationSeconds}/{detail.limits.maxDurationSeconds}s</strong><span>{t("agentRun.duration")}</span></div>
                    <div><strong>{detail.usage.steps}/{detail.limits.maxSteps}</strong><span>{t("agentRun.steps")}</span></div>
                    <div><strong>{detail.usage.retries}/{detail.limits.maxRetries}</strong><span>{t("agentRun.retries")}</span></div>
                    <div><strong>{detail.usage.delegationDepth}/{detail.limits.maxDelegationDepth}</strong><span>{t("agentRun.delegation")}</span></div>
                  </div>
                </section>

                {detail.approval ? (
                  <section className="agent-run-section">
                    <h3><CheckCircle2 size={16} />{t("agentRun.approval")}</h3>
                    <div className="agent-run-approval-summary">
                      <span className={`agent-run-status approval-status-${detail.approval.status}`}>{t(agentApprovalStatusTranslationKey(detail.approval.status))}</span>
                      <strong>{detail.approval.approvalCount}/{detail.approval.requiredApprovals}</strong>
                      <small><Clock3 size={14} />{dateFormatter.format(new Date(detail.approval.expiresAt))}</small>
                    </div>
                    {detail.votes.length ? (
                      <div className="agent-run-votes">
                        {detail.votes.map((vote) => (
                          <div key={`${vote.approverIdentityId}-${vote.createdAt}`}>
                            <span className={`agent-run-status approval-status-${vote.verdict === "approve" ? "approved" : "rejected"}`}>{t(vote.verdict === "approve" ? "agentRun.approve" : "agentRun.reject")}</span>
                            <p>{vote.reason}</p>
                            <time>{dateFormatter.format(new Date(vote.createdAt))}</time>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </>
            )}
          </article>
        </div>
      )}
      {creating && page ? (
        <AgentRunDialog api={api} page={page} directory={directory} onCreated={async (runId) => {
          await load(runId);
          setSuccess(t("agentRun.toastCreated"));
        }} onClose={() => setCreating(false)} />
      ) : null}
      {reviewing && detail ? (
        <AgentRunReviewDialog api={api} run={detail} onReviewed={async () => {
          await load(detail.id);
          setSuccess(t("agentRun.toastReviewed"));
        }} onClose={() => setReviewing(false)} />
      ) : null}
    </section>
  );
}
