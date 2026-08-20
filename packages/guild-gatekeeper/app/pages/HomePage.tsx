import {
  ArrowRight,
  Bell,
  BookOpen,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  Circle,
  Inbox,
  KeyRound,
  ListTodo,
  MessageCircleQuestion,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { GuildUiApi, UiAgentRun, UiCollectiveContext, UiDirectory, UiMemberBootstrapState } from "../../src/management-types";
import type { AppPage } from "../components/AppShell";
import { Notice } from "../components/Notice";
import { useI18n } from "../i18n";
import type { QuickAction } from "../navigation";

interface HomeOverview {
  memoryCount: number | null;
  openActivityCount: number | null;
  unreadCount: number | null;
  pendingApprovalCount: number | null;
  activeAgentRunCount: number | null;
  memoryReviewCount: number | null;
  highRiskRunCount: number | null;
}

type HomeOverviewSource = "memory" | "activity" | "inbox" | "agentRuns" | "context";

function runNeedsAttention(run: UiAgentRun): boolean {
  if (run.status === "failed") return true;
  if (["planning", "awaiting_approval", "running"].includes(run.status) && run.riskLevel >= 2) {
    return true;
  }
  const ratios = [
    [run.usage.budgetMinor, run.limits.maxBudgetMinor],
    [run.usage.tokens, run.limits.maxTokens],
    [run.usage.durationSeconds, run.limits.maxDurationSeconds],
    [run.usage.steps, run.limits.maxSteps],
    [run.usage.retries, run.limits.maxRetries],
    [run.usage.delegationDepth, run.limits.maxDelegationDepth],
  ] as const;
  return ratios.some(([usage, limit]) => limit > 0 && usage / limit >= 0.8);
}

const EMPTY_OVERVIEW: HomeOverview = {
  memoryCount: null,
  openActivityCount: null,
  unreadCount: null,
  pendingApprovalCount: null,
  activeAgentRunCount: null,
  memoryReviewCount: null,
  highRiskRunCount: null,
};

export function HomePage({ api, bootstrap, collective, directory, onNavigate, onQuickAction }: {
  api: GuildUiApi;
  bootstrap: UiMemberBootstrapState;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onNavigate(page: AppPage): void;
  onQuickAction(action: QuickAction): void;
}) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<HomeOverview>(EMPTY_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [failedSources, setFailedSources] = useState<readonly HomeOverviewSource[]>([]);

  const loadOverview = useCallback(async (isCurrent: () => boolean = () => true) => {
    setOverviewLoading(true);
    const results = await Promise.allSettled([
      api.getMemoryPage(),
      api.getActivityPage({ assigneeActorId: bootstrap.accountId, statuses: ["proposed", "planned", "ready", "active", "paused", "blocked"] }),
      api.getInboxPage({ unreadOnly: true }),
      api.getAgentRunPage(),
      api.getContextPage(),
    ]);
    if (!isCurrent()) return;
    const [knowledge, work, inbox, runs, context] = results;
    const activeRuns = runs.status === "fulfilled"
      ? runs.value.items.filter((run) => ["planning", "awaiting_approval", "running"].includes(run.status))
      : null;
    setOverview({
      memoryCount: knowledge.status === "fulfilled" ? knowledge.value.items.length : null,
      openActivityCount: work.status === "fulfilled" ? work.value.items.length : null,
      unreadCount: inbox.status === "fulfilled" ? inbox.value.unreadCount : null,
      pendingApprovalCount: runs.status === "fulfilled"
        ? runs.value.items.filter((run) => run.status === "awaiting_approval" && run.capabilities.review).length
        : null,
      activeAgentRunCount: activeRuns?.length ?? null,
      memoryReviewCount: context.status === "fulfilled"
        ? context.value.reviewSignals.filter((signal) => signal.status === "open").length
        : null,
      highRiskRunCount: runs.status === "fulfilled"
        ? runs.value.items.filter(runNeedsAttention).length
        : null,
    });
    const sources: readonly HomeOverviewSource[] = ["memory", "activity", "inbox", "agentRuns", "context"];
    setFailedSources(sources.filter((_, index) => results[index]?.status === "rejected"));
    setOverviewLoading(false);
  }, [api, bootstrap.accountId]);

  useEffect(() => {
    let current = true;
    void loadOverview(() => current);
    return () => {
      current = false;
    };
  }, [loadOverview]);

  const pendingInvitations = directory?.invitations.filter((invitation) => invitation.state === "pending").length ?? 0;
  const memberCount = directory?.identities.filter((identity) =>
    identity.membershipState !== "departed").length ?? 0;
  const setupSteps = [
    {
      id: "memory",
      label: t("home.setupKnowledge"),
      complete: overview.memoryCount !== null && overview.memoryCount > 0,
      icon: BookOpen,
      page: "memory" as const,
    },
    {
      id: "members",
      label: t("home.setupPeople"),
      complete: memberCount > 1 || pendingInvitations > 0,
      icon: Users,
      page: "members" as const,
    },
    {
      id: "agent",
      label: collective.template.suggestedAgent
        ? `${t("home.setupAgent")}: ${collective.template.suggestedAgent}`
        : t("home.setupAgent"),
      complete: Boolean(directory?.agentProfiles.length),
      icon: Bot,
      page: "members" as const,
    },
    {
      id: "recovery",
      label: t("home.setupRecovery"),
      complete: bootstrap.breakGlass.available,
      icon: KeyRound,
      page: "settings" as const,
    },
  ];
  const completedSetupSteps = setupSteps.filter((step) => step.complete).length;
  const showSetup = bootstrap.rootOwner && directory !== null && completedSetupSteps < setupSteps.length;
  const nextSetupStep = setupSteps.find((step) => !step.complete) ?? null;
  const NextSetupIcon = nextSetupStep?.icon ?? Circle;

  const actionsByIntent = {
    ask: {
      id: "ask",
      title: t("home.actionAskTitle"),
      description: t("home.actionAskDescription"),
      icon: MessageCircleQuestion,
      page: "ask" as const,
      quickAction: "ask" as const,
    },
    remember: {
      id: "memory",
      title: collective.labels.remember,
      description: t("home.actionKnowledgeDescription"),
      icon: BookOpen,
      page: "memory" as const,
      quickAction: "remember" as const,
    },
    start: {
      id: "activity",
      title: collective.labels.startActivity,
      description: t("home.actionWorkDescription"),
      icon: ListTodo,
      page: "activity" as const,
      quickAction: "start" as const,
    },
    review: {
      id: "inbox",
      title: t("home.actionInboxTitle"),
      description: t("home.actionInboxDescription"),
      icon: Inbox,
      page: "inbox" as const,
      quickAction: "review" as const,
    },
    members: {
      id: "members",
      title: collective.labels.members,
      description: t("home.actionMembersDescription"),
      icon: Users,
      page: "members" as const,
    },
  };
  const actions = collective.template.dashboardIntents
    .filter((intent) => intent !== "members")
    .map((intent) => actionsByIntent[intent]);

  const attentionItems = [
    overview.unreadCount !== null && overview.unreadCount > 0 ? {
      id: "unread",
      label: t("home.unreadItems"),
      value: overview.unreadCount,
      icon: Bell,
      page: "inbox" as const,
    } : null,
    overview.pendingApprovalCount !== null && overview.pendingApprovalCount > 0 ? {
      id: "approvals",
      label: t("home.pendingApprovals"),
      value: overview.pendingApprovalCount,
      icon: CheckCircle2,
      page: "members" as const,
      quickAction: "agent-runs" as const,
    } : null,
    overview.openActivityCount !== null && overview.openActivityCount > 0 ? {
      id: "activity",
      label: t("home.openWork"),
      value: overview.openActivityCount,
      icon: ListTodo,
      page: "activity" as const,
    } : null,
    overview.activeAgentRunCount !== null && overview.activeAgentRunCount > 0 ? {
      id: "agent-progress",
      label: t("home.agentProgress"),
      value: overview.activeAgentRunCount,
      icon: Bot,
      page: "members" as const,
      quickAction: "agent-runs" as const,
    } : null,
    overview.memoryReviewCount !== null && overview.memoryReviewCount > 0 ? {
      id: "memory-review",
      label: t("home.memoryReviews"),
      value: overview.memoryReviewCount,
      icon: BookOpenCheck,
      page: "context" as const,
    } : null,
    overview.highRiskRunCount !== null && overview.highRiskRunCount > 0 ? {
      id: "current-risks",
      label: t("home.currentRisks"),
      value: overview.highRiskRunCount,
      icon: ShieldAlert,
      page: "members" as const,
      quickAction: "agent-runs" as const,
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <>
      <header className="home-header">
        <span>{bootstrap.guildName}</span>
        <h1>{t("home.title")}</h1>
        <p>{bootstrap.membershipState === "preboarding" ? t("home.subtitlePreboarding") : t("home.subtitle")}</p>
      </header>

      <section className="home-actions" aria-labelledby="home-actions-title">
        <div className="home-section-heading">
          <h2 id="home-actions-title">{t("home.actionsTitle")}</h2>
          <p>{t("home.actionsDescription")}</p>
        </div>
        <div className="home-action-grid">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button className="home-action" type="button" key={action.id} onClick={() => {
                onQuickAction(action.quickAction);
              }}>
                <span className="home-action-icon"><Icon size={21} /></span>
                <span className="home-action-copy"><strong>{action.title}</strong><small>{action.description}</small></span>
                <ArrowRight className="home-action-arrow" size={18} />
              </button>
            );
          })}
        </div>
      </section>

      {showSetup ? (
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="setup-heading">
            <div>
              <span>{t("home.setupProgress")} {completedSetupSteps}/{setupSteps.length}</span>
              <h2 id="setup-title">{t("home.setupTitle")}</h2>
              <p>{t("home.setupDescription")}</p>
            </div>
            <progress aria-label={t("home.setupProgress")} value={completedSetupSteps} max={setupSteps.length} />
          </div>
          {nextSetupStep ? (
            <div className="setup-steps">
              <button className="setup-step" type="button" onClick={() => onNavigate(nextSetupStep.page)}>
                <span><NextSetupIcon size={17} /></span>
                <strong>{nextSetupStep.label}</strong>
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="home-attention" aria-labelledby="home-attention-title">
        <div className="home-section-heading">
          <h2 id="home-attention-title">{t("home.attentionTitle")}</h2>
          <p>{t("home.attentionDescription")}</p>
        </div>
        {failedSources.length ? (
          <Notice kind="warning" title={t("home.partialTitle")}>
            <p>{t("home.partialDescription", {
              sources: failedSources.map((source) => source === "memory"
                ? t("home.source.memory")
                : source === "activity"
                  ? t("home.source.activity")
                  : source === "inbox"
                    ? t("home.source.inbox")
                    : source === "agentRuns"
                      ? t("home.source.agentRuns")
                      : t("home.source.context")).join(", "),
            })}</p>
            <button className="secondary-button" type="button" disabled={overviewLoading} onClick={() => void loadOverview()}>
              <RefreshCw className={overviewLoading ? "spin" : undefined} size={16} />
              <span>{t("home.retryOverview")}</span>
            </button>
          </Notice>
        ) : null}
        {overviewLoading ? (
          <div className="home-status-loading" role="status" aria-live="polite"><Circle size={15} />{t("home.checking")}</div>
        ) : attentionItems.length ? (
          <div className="home-attention-list">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              const quickAction = "quickAction" in item ? item.quickAction : undefined;
              return (
                <button type="button" key={item.id} onClick={() => {
                  if (quickAction) onQuickAction(quickAction);
                  else onNavigate(item.page);
                }}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        ) : failedSources.length === 0 ? (
          <div className="home-clear"><CheckCircle2 size={20} /><div><strong>{t("home.clearTitle")}</strong><span>{t("home.clearDescription")}</span></div></div>
        ) : null}
      </section>
    </>
  );
}
