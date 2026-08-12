import {
  BookOpen,
  Bot,
  ChevronDown,
  History,
  Home,
  Inbox as InboxIcon,
  Languages,
  Menu,
  MessageCircleQuestion,
  Scale,
  ListTodo,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { UiMemberBootstrapState } from "../../src/management-types";
import { membershipTranslationKey, useI18n } from "../i18n";

export type AppPage =
  | "home"
  | "inbox"
  | "ask"
  | "knowledge"
  | "work"
  | "decisions"
  | "people"
  | "agents"
  | "chronicle"
  | "settings";

const WORKSPACE_PAGES: readonly AppPage[] = ["knowledge", "work", "decisions"];
const MORE_PAGES: readonly AppPage[] = ["people", "agents", "chronicle", "settings"];

interface AppShellProps {
  bootstrap: UiMemberBootstrapState;
  page: AppPage;
  peopleAvailable: boolean;
  agentsAvailable: boolean;
  onPageChange(page: AppPage): void;
  onLocaleChange(locale: "en" | "ja" | "zh-CN"): Promise<void>;
  children: ReactNode;
}

interface NavItem {
  id: AppPage;
  label: string;
  icon: LucideIcon;
}

export function AppShell({
  bootstrap,
  page,
  peopleAvailable,
  agentsAvailable,
  onPageChange,
  onLocaleChange,
  children,
}: AppShellProps) {
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(
    peopleAvailable || bootstrap.membershipState === "preboarding" || WORKSPACE_PAGES.includes(page),
  );
  const [moreOpen, setMoreOpen] = useState(MORE_PAGES.includes(page));
  const primaryItems: readonly NavItem[] = [
    { id: "home" as const, label: t("nav.home"), icon: Home },
    { id: "ask" as const, label: t("nav.ask"), icon: MessageCircleQuestion },
    { id: "inbox" as const, label: t("nav.inbox"), icon: InboxIcon },
  ];
  const workspaceItems: readonly NavItem[] = [
    { id: "knowledge" as const, label: t("nav.knowledge"), icon: BookOpen },
    { id: "work" as const, label: t("nav.work"), icon: ListTodo },
    { id: "decisions" as const, label: t("nav.decisions"), icon: Scale },
  ];
  const moreItems: readonly NavItem[] = [
    ...(peopleAvailable
      ? [{ id: "people" as const, label: t("nav.people"), icon: Users }]
      : []),
    ...(agentsAvailable
      ? [{ id: "agents" as const, label: t("nav.agents"), icon: Bot }]
      : []),
    ...(bootstrap.membershipState === "active"
      ? [{ id: "chronicle" as const, label: t("nav.chronicle"), icon: History }]
      : []),
    { id: "settings" as const, label: t("nav.settings"), icon: Settings },
  ];

  useEffect(() => {
    if (WORKSPACE_PAGES.includes(page)) setWorkspaceOpen(true);
    if (MORE_PAGES.includes(page)) setMoreOpen(true);
  }, [page]);

  function navigate(nextPage: AppPage) {
    onPageChange(nextPage);
    setMobileOpen(false);
  }

  async function changeLocale(nextLocale: "en" | "ja" | "zh-CN") {
    const previousLocale = locale;
    setLocale(nextLocale);
    try {
      await onLocaleChange(nextLocale);
    } catch {
      setLocale(previousLocale);
    }
  }

  function renderItems(items: readonly NavItem[]) {
    return items.map((item) => {
      const Icon = item.icon;
      return (
        <button
          key={item.id}
          className={page === item.id ? "nav-item nav-item-active" : "nav-item"}
          type="button"
          aria-current={page === item.id ? "page" : undefined}
          onClick={() => navigate(item.id)}
        >
          <Icon size={18} />
          <span>{item.label}</span>
        </button>
      );
    });
  }

  return (
    <div className="app-layout">
      <aside className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} /></div>
          <div className="brand-copy">
            <span>{t("app.name")}</span>
            <small>{bootstrap.guildName}</small>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            title={t("nav.close")}
            aria-label={t("nav.close")}
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="primary-nav" aria-label={t("app.name")}>
          <div className="nav-section">{renderItems(primaryItems)}</div>
          <div className="nav-section">
            <button
              className={WORKSPACE_PAGES.includes(page) ? "nav-group-toggle nav-group-toggle-active" : "nav-group-toggle"}
              type="button"
              aria-expanded={workspaceOpen}
              onClick={() => setWorkspaceOpen((open) => !open)}
            >
              <span>{t("nav.workspace")}</span>
              <ChevronDown className={workspaceOpen ? "nav-chevron nav-chevron-open" : "nav-chevron"} size={16} />
            </button>
            {workspaceOpen ? <div className="nav-group-items">{renderItems(workspaceItems)}</div> : null}
          </div>
          <div className="nav-section nav-section-more">
            <button
              className={MORE_PAGES.includes(page) ? "nav-group-toggle nav-group-toggle-active" : "nav-group-toggle"}
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <span>{t("nav.manage")}</span>
              <ChevronDown className={moreOpen ? "nav-chevron nav-chevron-open" : "nav-chevron"} size={16} />
            </button>
            {moreOpen ? <div className="nav-group-items">{renderItems(moreItems)}</div> : null}
          </div>
        </nav>
        <div className="sidebar-account">
          <span className={`status-dot status-${bootstrap.membershipState ?? "invited"}`} />
          <div>
            <strong>{bootstrap.rootOwner ? t("people.root") : t("identity.human")}</strong>
            <small>{t(membershipTranslationKey(bootstrap.membershipState))}</small>
          </div>
        </div>
      </aside>

      {mobileOpen ? <button className="sidebar-scrim" type="button" aria-label={t("nav.close")} onClick={() => setMobileOpen(false)} /> : null}

      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            title={t("nav.open")}
            aria-label={t("nav.open")}
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <strong>{bootstrap.guildName}</strong>
            <span>{bootstrap.guildPurpose}</span>
          </div>
          <label className="language-control" title={t("language.label")}>
            <Languages size={17} aria-hidden="true" />
            <span className="sr-only">{t("language.label")}</span>
            <select
              aria-label={t("language.label")}
              value={locale}
              onChange={(event) => {
                const nextLocale = event.target.value as "en" | "ja" | "zh-CN";
                void changeLocale(nextLocale);
              }}
            >
              <option value="en">{t("language.en")}</option>
              <option value="ja">{t("language.ja")}</option>
              <option value="zh-CN">{t("language.zh-CN")}</option>
            </select>
          </label>
        </header>
        <main className="content"><div className="page-surface" key={page}>{children}</div></main>
      </div>

      <nav className="mobile-tabbar" aria-label={t("nav.mobilePrimary")}>
        {primaryItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={page === item.id ? "mobile-tab mobile-tab-active" : "mobile-tab"}
              type="button"
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          className={WORKSPACE_PAGES.includes(page) || MORE_PAGES.includes(page) ? "mobile-tab mobile-tab-active" : "mobile-tab"}
          type="button"
          aria-current={WORKSPACE_PAGES.includes(page) || MORE_PAGES.includes(page) ? "page" : undefined}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} />
          <span>{t("nav.more")}</span>
        </button>
      </nav>
    </div>
  );
}
