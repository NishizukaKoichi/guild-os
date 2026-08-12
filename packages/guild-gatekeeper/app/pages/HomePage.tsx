import {
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Inbox,
  KeyRound,
  ListTodo,
  MessageCircleQuestion,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { GuildUiApi, UiDirectory, UiMemberBootstrapState } from "../../src/management-types";
import type { AppPage } from "../components/AppShell";
import { useI18n } from "../i18n";

interface HomeOverview {
  knowledgeCount: number | null;
  openWorkCount: number | null;
  unreadCount: number | null;
  pendingApprovalCount: number | null;
}

const EMPTY_OVERVIEW: HomeOverview = {
  knowledgeCount: null,
  openWorkCount: null,
  unreadCount: null,
  pendingApprovalCount: null,
};

export function HomePage({ api, bootstrap, directory, onNavigate }: {
  api: GuildUiApi;
  bootstrap: UiMemberBootstrapState;
  directory: UiDirectory | null;
  onNavigate(page: AppPage): void;
}) {
  const { t } = useI18n();
  const [overview, setOverview] = useState<HomeOverview>(EMPTY_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    let current = true;
    void Promise.allSettled([
      api.getKnowledgePage(),
      api.getWorkPage({
        assigneeIdentityId: bootstrap.accountId,
        questStatuses: ["backlog", "ready", "in_progress", "blocked"],
      }),
      api.getInboxPage({ unreadOnly: true }),
      api.getAgentRunPage(),
    ]).then(([knowledge, work, inbox, runs]) => {
      if (!current) return;
      setOverview({
        knowledgeCount: knowledge.status === "fulfilled" ? knowledge.value.items.length : null,
        openWorkCount: work.status === "fulfilled" ? work.value.quests.length : null,
        unreadCount: inbox.status === "fulfilled" ? inbox.value.unreadCount : null,
        pendingApprovalCount: runs.status === "fulfilled"
          ? runs.value.items.filter((run) => run.status === "awaiting_approval" && run.capabilities.review).length
          : null,
      });
      setOverviewLoading(false);
    });
    return () => {
      current = false;
    };
  }, [api, bootstrap.accountId]);

  const pendingInvitations = directory?.invitations.filter((invitation) => invitation.state === "pending").length ?? 0;
  const humanCount = directory?.identities.filter((identity) =>
    identity.kind === "human" && identity.membershipState !== "departed").length ?? 0;
  const setupSteps = [
    {
      id: "knowledge",
      label: t("home.setupKnowledge"),
      complete: overview.knowledgeCount !== null && overview.knowledgeCount > 0,
      icon: BookOpen,
      page: "knowledge" as const,
    },
    {
      id: "people",
      label: t("home.setupPeople"),
      complete: humanCount > 1 || pendingInvitations > 0,
      icon: Users,
      page: "people" as const,
    },
    {
      id: "agent",
      label: t("home.setupAgent"),
      complete: Boolean(directory?.agentProfiles.length),
      icon: Bot,
      page: "agents" as const,
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

  const actions = [
    {
      id: "ask",
      title: t("home.actionAskTitle"),
      description: t("home.actionAskDescription"),
      icon: MessageCircleQuestion,
      page: "ask" as const,
    },
    {
      id: "knowledge",
      title: t("home.actionKnowledgeTitle"),
      description: t("home.actionKnowledgeDescription"),
      icon: BookOpen,
      page: "knowledge" as const,
    },
    {
      id: "work",
      title: t("home.actionWorkTitle"),
      description: t("home.actionWorkDescription"),
      icon: ListTodo,
      page: "work" as const,
    },
    {
      id: "inbox",
      title: t("home.actionInboxTitle"),
      description: t("home.actionInboxDescription"),
      icon: Inbox,
      page: "inbox" as const,
    },
  ];

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
      page: "agents" as const,
    } : null,
    overview.openWorkCount !== null && overview.openWorkCount > 0 ? {
      id: "work",
      label: t("home.openWork"),
      value: overview.openWorkCount,
      icon: ListTodo,
      page: "work" as const,
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
