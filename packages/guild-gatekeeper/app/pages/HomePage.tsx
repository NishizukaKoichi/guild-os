import {
  ArrowRight,
  Bell,
  BookOpen,
  BookOpenCheck,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Inbox,
  KeyRound,
  ListTodo,
  MessageCircleQuestion,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { GuildUiApi, UiAgentRun, UiCollectiveContext, UiDirectory, UiMemberBootstrapState } from "../../src/management-types";
import type { AppPage } from "../components/AppShell";
import { useI18n } from "../i18n";

interface HomeOverview {
  memoryCount: number | null;
  openActivityCount: number | null;
  unreadCount: number | null;
  pendingApprovalCount: number | null;
  activeAgentRunCount: number | null;
  memoryReviewCount: number | null;
  highRiskRunCount: number | null;
}

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

export function HomePage({ api, bootstrap, collective, directory, onNavigate }: {
  api: GuildUiApi;
  bootstrap: UiMemberBootstrapState;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onNavigate(page: AppPage): void;
}) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<HomeOverview>(EMPTY_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      api.getMemoryPage(),
      api.getActivityPage({ assigneeActorId: bootstrap.accountId, statuses: ["proposed", "planned", "ready", "active", "paused", "blocked"] }),
      api.getInboxPage({ unreadOnly: true }),
      api.getAgentRunPage(),
      api.getContextPage(),
    ]).then(([knowledge, work, inbox, runs, context]) => {
      if (!current) return;
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
      setOverviewLoading(false);
    });
    return () => {
      current = false;
    };
  }, [api, bootstrap.accountId]);

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

  const actionsByIntent = {
    ask: {
      id: "ask",
      title: t("home.actionAskTitle"),
      description: t("home.actionAskDescription"),
      icon: MessageCircleQuestion,
      page: "ask" as const,
    },
    remember: {
      id: "memory",
      title: collective.labels.remember,
      description: t("home.actionKnowledgeDescription"),
      icon: BookOpen,
      page: "memory" as const,
    },
    start: {
      id: "activity",
      title: collective.labels.startActivity,
      description: t("home.actionWorkDescription"),
      icon: ListTodo,
      page: "activity" as const,
    },
    review: {
      id: "inbox",
      title: t("home.actionInboxTitle"),
      description: t("home.actionInboxDescription"),
      icon: Inbox,
      page: "inbox" as const,
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
    .filter((intent) => intent !== "members" || directory !== null)
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
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <>
      <header className="home-header">
        <span>{bootstrap.guildName}</span>
        <h1>{t("home.title")}</h1>
        <p>{bootstrap.membershipState === "preboarding" ? t("home.subtitlePreboarding") : t("home.subtitle")}</p>
      </header>

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
          <div className="setup-steps">
            {setupSteps.map((step) => {
              const Icon = step.icon;
              return (
                <button className={step.complete ? "setup-step setup-step-complete" : "setup-step"} type="button" key={step.id} onClick={() => onNavigate(step.page)}>
                  <span>{step.complete ? <Check size={17} /> : <Icon size={17} />}</span>
                  <strong>{step.label}</strong>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="home-actions" aria-labelledby="home-actions-title">
        <div className="home-section-heading">
          <h2 id="home-actions-title">{t("home.actionsTitle")}</h2>
          <p>{t("home.actionsDescription")}</p>
        </div>
        <div className="home-action-grid">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button className="home-action" type="button" key={action.id} onClick={() => onNavigate(action.page)}>
                <span className="home-action-icon"><Icon size={21} /></span>
                <span className="home-action-copy"><strong>{action.title}</strong><small>{action.description}</small></span>
                <ArrowRight className="home-action-arrow" size={18} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-attention" aria-labelledby="home-attention-title">
        <div className="home-section-heading">
          <h2 id="home-attention-title">{t("home.attentionTitle")}</h2>
          <p>{t("home.attentionDescription")}</p>
        </div>
        {overviewLoading ? (
          <div className="home-status-loading"><Circle size={15} />{t("home.checking")}</div>
        ) : attentionItems.length ? (
          <div className="home-attention-list">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              return (
                <button type="button" key={item.id} onClick={() => onNavigate(item.page)}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="home-clear"><CheckCircle2 size={20} /><div><strong>{t("home.clearTitle")}</strong><span>{t("home.clearDescription")}</span></div></div>
        )}
      </section>
    </>
  );
}
