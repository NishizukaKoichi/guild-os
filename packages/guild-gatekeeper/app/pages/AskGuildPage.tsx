import {
  AlertTriangle,
  Bot,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileCheck2,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AskGuildCitation,
  AskGuildResponse,
  GuildUiApi,
  UiIntentAction,
  UiIntentProposal,
} from "../../src/management-types";
import type { AppPage } from "../components/AppShell";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

function proposalStatusKey(status: UiIntentProposal["status"]) {
  switch (status) {
    case "ready": return "ask.intent.status.ready" as const;
    case "executing": return "ask.intent.status.executing" as const;
    case "completed": return "ask.intent.status.completed" as const;
    case "rejected": return "ask.intent.status.rejected" as const;
    case "failed": return "ask.intent.status.failed" as const;
    case "expired": return "ask.intent.status.expired" as const;
  }
}

function actionStatusKey(status: UiIntentAction["status"]) {
  switch (status) {
    case "pending": return "ask.intent.actionStatus.pending" as const;
    case "processing": return "ask.intent.actionStatus.processing" as const;
    case "staged": return "ask.intent.actionStatus.staged" as const;
    case "succeeded": return "ask.intent.actionStatus.succeeded" as const;
    case "failed": return "ask.intent.actionStatus.failed" as const;
    case "cancelled": return "ask.intent.actionStatus.cancelled" as const;
  }
}

function actionKindKey(kind: UiIntentAction["kind"]) {
  switch (kind) {
    case "memory.propose": return "ask.intent.action.memoryPropose" as const;
    case "activity.create": return "ask.intent.action.activityCreate" as const;
    case "activity.assign": return "ask.intent.action.activityAssign" as const;
    case "decision.propose": return "ask.intent.action.decisionPropose" as const;
    case "agent.run": return "ask.intent.action.agentRun" as const;
  }
}

function riskKey(risk: UiIntentAction["riskLevel"]) {
  switch (risk) {
    case 0: return "ask.intent.risk.0" as const;
    case 1: return "ask.intent.risk.1" as const;
    case 2: return "ask.intent.risk.2" as const;
    case 3: return "ask.intent.risk.3" as const;
  }
}

function formatEstimatedCost(locale: string, action: UiIntentAction, t: ReturnType<typeof useI18n>["t"]): string {
  if (action.estimatedCostMinor === 0) return t("ask.intent.noProviderCost");
  if (action.estimatedCostMinor === null || action.estimatedCostCurrency === null) {
    return t("ask.intent.estimateUnknown");
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: action.estimatedCostCurrency,
    currencyDisplay: "code",
  }).format(action.estimatedCostMinor / 100);
}

function formatEstimatedDuration(action: UiIntentAction, t: ReturnType<typeof useI18n>["t"]): string {
  if (action.estimatedDurationSeconds === null) return t("ask.intent.estimateUnknown");
  return t("ask.intent.durationSeconds", { count: action.estimatedDurationSeconds });
}

function effectScopeKey(scope: UiIntentAction["effectScope"]) {
  return scope === "external" ? "ask.intent.effectScope.external" as const : "ask.intent.effectScope.guild" as const;
}

function rollbackKey(kind: UiIntentAction["rollbackKind"]) {
  switch (kind) {
    case "reversible": return "ask.intent.rollback.reversible" as const;
    case "compensating_action": return "ask.intent.rollback.compensating_action" as const;
    case "not_applicable": return "ask.intent.rollback.not_applicable" as const;
    case "not_automatic": return "ask.intent.rollback.not_automatic" as const;
  }
}

function outcomeKey(outcome: Awaited<ReturnType<GuildUiApi["actIntent"]>>["outcome"]) {
  switch (outcome) {
    case "busy": return "ask.intent.outcome.busy" as const;
    case "expired": return "ask.intent.outcome.expired" as const;
    case "completed": return "ask.intent.outcome.completed" as const;
    case "failed": return "ask.intent.outcome.failed" as const;
    case "retry_scheduled": return "ask.intent.outcome.retryScheduled" as const;
    case "action_succeeded": return "ask.intent.outcome.actionSucceeded" as const;
    case "agent_staged": return "ask.intent.outcome.agentStaged" as const;
    case "agent_waiting": return "ask.intent.outcome.agentWaiting" as const;
  }
}

function formatTimestamp(locale: string, value: string | null): string {
  if (value === null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function actionIcon(kind: UiIntentAction["kind"]) {
  if (kind === "agent.run") return <Bot size={18} />;
  if (kind === "memory.propose") return <Database size={18} />;
  if (kind === "decision.propose") return <FileCheck2 size={18} />;
  return <ListChecks size={18} />;
}

export function AskGuildPage({ api, onOpenCitation, onNavigate, focusRequestId }: {
  api: GuildUiApi;
  onOpenCitation(citation: AskGuildCitation): void;
  onNavigate(page: AppPage): void;
  focusRequestId?: number;
}) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"ask" | "plan" | "act">("ask");
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AskGuildResponse | null>(null);
  const [objective, setObjective] = useState("");
  const [proposals, setProposals] = useState<readonly UiIntentProposal[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [actBusy, setActBusy] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const handledFocusRequest = useRef<number | null>(null);

  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.id === selectedProposalId) ?? null,
    [proposals, selectedProposalId],
  );

  const refreshProposals = useCallback(async (preferredId: string | null = null) => {
    const next = await api.listIntentProposals();
    setProposals(next);
    setSelectedProposalId((current) => {
      const candidate = preferredId ?? current;
      return candidate && next.some((proposal) => proposal.id === candidate)
        ? candidate
        : next[0]?.id ?? null;
    });
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.listIntentProposals()
      .then((next) => {
        if (!active) return;
        setProposals(next);
        setSelectedProposalId(next[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : t("error.generic"));
      })
      .finally(() => {
        if (active) setLoadingPlans(false);
      });
    return () => {
      active = false;
    };
  }, [api, t]);

  useEffect(() => {
    if (!focusRequestId || handledFocusRequest.current === focusRequestId) return;
    handledFocusRequest.current = focusRequestId;
    setMode("ask");
    requestAnimationFrame(() => questionRef.current?.focus());
  }, [focusRequestId]);

  function selectMode(next: "ask" | "plan" | "act") {
    setMode(next);
    setError(null);
    setOutcome(null);
    setConfirmed(false);
  }

  async function submitAsk(event: React.FormEvent) {
    event.preventDefault();
    setAskBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const answer = await api.askGuild({ question, locale });
      setResponse(answer);
      setObjective(question.trim());
      requestAnimationFrame(() => answerRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setAskBusy(false);
    }
  }

  async function submitPlan(event: React.FormEvent) {
    event.preventDefault();
    if (response === null || !question.trim()) {
      setError(t("ask.intent.planNeedsAsk"));
      return;
    }
    setPlanBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await api.createIntentPlan({
        requestId: crypto.randomUUID(),
        question: question.trim(),
        objective: objective.trim(),
        locale,
        spaceId: response.citations[0]?.spaceId ?? null,
      });
      setProposals((current) => [
        result.proposal,
        ...current.filter((proposal) => proposal.id !== result.proposal.id),
      ]);
      setSelectedProposalId(result.proposal.id);
      setOutcome(t(result.source === "model"
        ? "ask.intent.planCreatedModel"
        : result.source === "deterministic_fallback"
          ? "ask.intent.planCreatedFallback"
          : "ask.intent.planResumed"));
      setMode("act");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setPlanBusy(false);
    }
  }

  async function executeNextAction() {
    if (selectedProposal === null || !confirmed) return;
    setActBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await api.actIntent({
        proposalId: selectedProposal.id,
        confirmation: true,
      });
      setProposals((current) => current.map((proposal) =>
        proposal.id === result.proposal.id ? result.proposal : proposal));
      setOutcome(t(outcomeKey(result.outcome)));
      setConfirmed(false);
      if (result.outcome === "busy" || result.outcome === "retry_scheduled") {
        await refreshProposals(result.proposal.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
      setConfirmed(false);
      try {
        await refreshProposals(selectedProposal.id);
      } catch {
        // Keep the original action error visible; the next manual refresh can resume safely.
      }
    } finally {
      setActBusy(false);
    }
  }

  const stagedAgent = selectedProposal?.actions.find((action) =>
    action.kind === "agent.run" && action.status === "staged") ?? null;

  return (
    <>
      <PageHeader title={t("ask.title")} subtitle={t("ask.subtitle")} />
      <div className="ask-mode-control segmented-control" role="group" aria-label={t("ask.modeLabel")}>
        {(["ask", "plan", "act"] as const).map((value) => (
          <button
            className={mode === value ? "segment-active" : ""}
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => selectMode(value)}
          >
            {value === "ask" ? <Search size={16} /> : value === "plan" ? <Lightbulb size={16} /> : <Play size={16} />}
            <span>{t(`ask.mode.${value}`)}</span>
          </button>
        ))}
      </div>

      {error ? <Notice kind="error">{error}</Notice> : null}
      {outcome ? <Notice>{outcome}</Notice> : null}

      {mode === "ask" ? (
        <>
          <form className="ask-form" onSubmit={(event) => void submitAsk(event)}>
            <label htmlFor="ask-guild-question">{t("ask.question")}</label>
            <div className="ask-input-row">
              <Search size={19} aria-hidden="true" />
              <textarea
                ref={questionRef}
                id="ask-guild-question"
                required
                rows={3}
                maxLength={500}
                value={question}
                placeholder={t("ask.placeholder")}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <button className="primary-button" type="submit" disabled={askBusy || !question.trim()}>
                {askBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                <span>{t("ask.submit")}</span>
              </button>
            </div>
          </form>
          {!response ? (
            <div className="ask-empty">
              <BookOpen size={24} />
              <p>{t("ask.empty")}</p>
              <div className="ask-suggestions" aria-label={t("ask.suggestionsTitle")}>
                <span>{t("ask.suggestionsTitle")}</span>
                {[t("ask.suggestionOne"), t("ask.suggestionTwo"), t("ask.suggestionThree")].map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ask-result">
              <section ref={answerRef} className="ask-answer" aria-live="polite" tabIndex={-1}>
                <h2>{t("ask.answer")}</h2>
                <p>{response.answer}</p>
                {response.inferred ? <Notice>{t("ask.inference")}</Notice> : null}
                <button className="primary-button ask-plan-next" type="button" onClick={() => selectMode("plan")}>
                  <Lightbulb size={17} />
                  <span>{t("ask.intent.useForPlan")}</span>
                  <ChevronRight size={17} />
                </button>
              </section>
              <aside className="ask-sources">
                <h2>{t("ask.sources")}</h2>
                {response.citations.length === 0 ? <p>{t("ask.noSources")}</p> : (
                  <div className="ask-source-list">
                    {response.citations.map((citation, index) => (
                      <button
                        type="button"
                        key={`${citation.resourceType}-${citation.resourceId}-${citation.version}`}
                        onClick={() => onOpenCitation(citation)}
                      >
                        <span>{t(`ask.source.${citation.resourceType}`)}{index + 1}</span>
                        <div>
                          <strong>{citation.title}</strong>
                          <p>{citation.summary}</p>
                          <small>v{citation.version}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          )}
        </>
      ) : null}

      {mode === "plan" ? (
        <section className="ask-plan-workspace">
          <header className="ask-mode-heading">
            <Lightbulb size={22} />
            <div>
              <h2>{t(response === null ? "ask.planTitle" : "ask.intent.planTitle")}</h2>
              <p>{t(response === null ? "ask.planDescription" : "ask.intent.planDescription")}</p>
            </div>
          </header>
          {response === null ? (
            <div className="ask-intent-empty">
              <Search size={22} />
              <p>{t("ask.intent.planNeedsAsk")}</p>
              <button className="secondary-button" type="button" onClick={() => selectMode("ask")}>
                {t("ask.intent.returnToAsk")}
              </button>
            </div>
          ) : (
            <form className="ask-plan-form" onSubmit={(event) => void submitPlan(event)}>
              <div className="ask-plan-evidence">
                <span>{t("ask.intent.evidenceUsed")}</span>
                <strong>{t("ask.intent.evidenceCount", { count: response.citations.length })}</strong>
                <p>{response.answer}</p>
              </div>
              <label htmlFor="ask-plan-objective">
                <span>{t("ask.intent.objective")}</span>
                <textarea
                  id="ask-plan-objective"
                  required
                  rows={4}
                  maxLength={5000}
                  value={objective}
                  placeholder={t("ask.intent.objectivePlaceholder")}
                  onChange={(event) => setObjective(event.target.value)}
                />
              </label>
              <div className="ask-plan-boundary">
                <ShieldCheck size={18} />
                <span>{t("ask.intent.planBoundary")}</span>
              </div>
              <button className="primary-button" type="submit" disabled={planBusy || !objective.trim()}>
                {planBusy ? <LoaderCircle className="spin" size={17} /> : <ListChecks size={17} />}
                <span>{t("ask.intent.createPlan")}</span>
              </button>
            </form>
          )}
        </section>
      ) : null}

      {mode === "act" ? (
        <section className="ask-act-workspace">
          <header className="ask-mode-heading">
            <ShieldCheck size={22} />
            <div>
              <h2>{t("ask.intent.actTitle")}</h2>
              <p>{t("ask.intent.actDescription")}</p>
            </div>
          </header>
          {loadingPlans ? (
            <div className="ask-intent-loading"><LoaderCircle className="spin" size={20} />{t("ask.intent.loading")}</div>
          ) : proposals.length === 0 ? (
            <div className="ask-intent-empty">
              <ListChecks size={22} />
              <p>{t("ask.intent.noPlans")}</p>
              <p>{t("ask.actSafety")}</p>
              <button className="secondary-button" type="button" onClick={() => selectMode(response ? "plan" : "ask")}>
                {response ? t("ask.intent.createFirstPlan") : t("ask.intent.returnToAsk")}
              </button>
            </div>
          ) : (
            <div className="ask-intent-layout">
              <nav className="ask-intent-list" aria-label={t("ask.intent.planList")}>
                <div className="ask-intent-list-heading">
                  <strong>{t("ask.intent.recentPlans")}</strong>
                  <button
                    className="icon-button"
                    type="button"
                    title={t("ask.intent.refresh")}
                    aria-label={t("ask.intent.refresh")}
                    onClick={() => void refreshProposals(selectedProposalId)}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                {proposals.map((proposal) => (
                  <button
                    type="button"
                    key={proposal.id}
                    className={proposal.id === selectedProposalId ? "ask-intent-list-active" : ""}
                    onClick={() => {
                      setSelectedProposalId(proposal.id);
                      setConfirmed(false);
                      setOutcome(null);
                    }}
                  >
                    <span className={`intent-status intent-status-${proposal.status}`}>
                      {t(proposalStatusKey(proposal.status))}
                    </span>
                    <strong>{proposal.objective}</strong>
                    <small>{formatTimestamp(locale, proposal.updatedAt)}</small>
                  </button>
                ))}
              </nav>

              {selectedProposal ? (
                <div className="ask-intent-detail">
                  <header className="ask-intent-summary">
                    <div>
                      <span className={`intent-status intent-status-${selectedProposal.status}`}>
                        {t(proposalStatusKey(selectedProposal.status))}
                      </span>
                      <h3>{selectedProposal.objective}</h3>
                    </div>
                    <dl>
                      <div>
                        <dt>{t("ask.intent.expires")}</dt>
                        <dd><Clock3 size={14} />{formatTimestamp(locale, selectedProposal.expiresAt)}</dd>
                      </div>
                      <div>
                        <dt>{t("ask.intent.maximumRisk")}</dt>
                        <dd>{t(riskKey(selectedProposal.maximumRiskLevel))}</dd>
                      </div>
                      <div>
                        <dt>{t("ask.intent.evidence")}</dt>
                        <dd>{selectedProposal.evidence.length}</dd>
                      </div>
                    </dl>
                  </header>

                  {selectedProposal.evidence.length > 0 ? (
                    <details className="ask-intent-evidence">
                      <summary>{t("ask.intent.evidenceCount", {
                        count: selectedProposal.evidence.length,
                      })}</summary>
                      <ul>
                        {selectedProposal.evidence.map((evidence) => (
                          <li key={`${evidence.sourceType}:${evidence.sourceId}`}>
                            <strong>{evidence.label}</strong>
                            <small>{evidence.sourceType} · {evidence.sourceId}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  <ol className="ask-intent-actions">
                    {selectedProposal.actions.map((action) => (
                      <li key={action.position} className={`intent-action intent-action-${action.status}`}>
                        <div className="intent-action-index">
                          {action.status === "succeeded" ? <Check size={16} /> : action.position + 1}
                        </div>
                        <div className="intent-action-body">
                          <header>
                            <span>{actionIcon(action.kind)}</span>
                            <div>
                              <strong>{t(actionKindKey(action.kind))}</strong>
                              <small>{action.resourceLabel}</small>
                            </div>
                            <span className={`intent-status intent-status-${action.status}`}>
                              {t(actionStatusKey(action.status))}
                            </span>
                          </header>
                          <dl>
                            <div>
                              <dt>{t("ask.intent.risk")}</dt>
                              <dd>{t(riskKey(action.riskLevel))}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.permission")}</dt>
                              <dd><code>{action.requiredPermission}</code></dd>
                            </div>
                            <div>
                              <dt>{action.agentActorId ? t("ask.intent.agent") : t("ask.intent.resource")}</dt>
                              <dd>{action.agentName ?? action.resourceType}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.approval")}</dt>
                              <dd>{action.durableHumanApprovals > 0
                                ? t("ask.intent.humanApprovals", { count: action.durableHumanApprovals })
                                : t("ask.intent.explicitConfirmation")}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.executingActor")}</dt>
                              <dd>{action.executingActorName}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.connection")}</dt>
                              <dd>{action.connectionId ?? t("ask.intent.noConnection")}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.estimatedCost")}</dt>
                              <dd>{formatEstimatedCost(locale, action, t)}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.estimatedDuration")}</dt>
                              <dd>{formatEstimatedDuration(action, t)}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.effectScope")}</dt>
                              <dd>{t(effectScopeKey(action.effectScope))}</dd>
                            </div>
                            <div>
                              <dt>{t("ask.intent.rollback")}</dt>
                              <dd>{t(rollbackKey(action.rollbackKind))}</dd>
                            </div>
                          </dl>
                          <details>
                            <summary>{t("ask.intent.technicalDetails")}</summary>
                            <code>{action.resourceId}</code>
                            <span>{t("ask.intent.attempts", { count: action.attemptCount })}</span>
                            {action.reauthenticationRequired ? <span>{t("ask.intent.reauthentication")}</span> : null}
                            {action.errorSummary ? <span className="intent-action-error">{action.errorSummary}</span> : null}
                          </details>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {selectedProposal.errorSummary ? (
                    <Notice kind="error">{selectedProposal.errorSummary}</Notice>
                  ) : null}

                  {stagedAgent?.durableHumanApprovals ? (
                    <div className="ask-agent-approval">
                      <AlertTriangle size={19} />
                      <div>
                        <strong>{t("ask.intent.agentApprovalTitle")}</strong>
                        <p>{t("ask.intent.agentApprovalDescription", {
                          count: stagedAgent.durableHumanApprovals,
                        })}</p>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => onNavigate("members")}>
                        {t("ask.intent.openAgentRuns")}
                      </button>
                    </div>
                  ) : null}

                  {selectedProposal.canAct ? (
                    <div className="ask-act-confirmation">
                      <label>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        <span>
                          <strong>{t("ask.intent.confirmTitle")}</strong>
                          <small>{t("ask.intent.confirmDescription")}</small>
                        </span>
                      </label>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={!confirmed || actBusy}
                        onClick={() => void executeNextAction()}
                      >
                        {actBusy ? <LoaderCircle className="spin" size={17} /> :
                          stagedAgent ? <RefreshCw size={17} /> : <Play size={17} />}
                        <span>{stagedAgent ? t("ask.intent.checkAgent") : t("ask.intent.executeNext")}</span>
                      </button>
                      <p><ShieldCheck size={15} />{t("ask.intent.recheckNotice")}</p>
                    </div>
                  ) : selectedProposal.status === "completed" ? (
                    <div className="ask-intent-complete">
                      <CheckCircle2 size={20} />
                      <strong>{t("ask.intent.completedTitle")}</strong>
                      <span>{t("ask.intent.completedDescription")}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
