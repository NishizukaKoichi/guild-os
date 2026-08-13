import {
  BookCheck,
  BookOpen,
  ChevronDown,
  CloudCog,
  History,
  Home,
  Inbox as InboxIcon,
  Languages,
  ListTodo,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Scale,
  Settings,
  ShieldCheck,
  Users,
  UserRoundCheck,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { UiCollectiveContext, UiMemberBootstrapState } from "../../src/management-types";
import { membershipStateLabel } from "../collective-language";
import { useI18n } from "../i18n";

export type AppPage =
  | "home"
  | "ask"
  | "members"
  | "memory"
  | "activity"
  | "inbox"
  | "messages"
  | "lifecycle"
  | "contributions"
  | "context"
  | "decisions"
  | "knowledge"
  | "work"
  | "chronicle"
  | "operations"
  | "settings";

const MORE_PAGES: readonly AppPage[] = [
  "inbox",
  "messages",
  "lifecycle",
  "contributions",
  "context",
  "decisions",
  "knowledge",
  "work",
  "chronicle",
  "operations",
  "settings",
];

interface AppShellProps {
  bootstrap: UiMemberBootstrapState;
  collective: UiCollectiveContext;
  page: AppPage;
  membersAvailable: boolean;
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
  collective,
  page,
  membersAvailable,
  onPageChange,
  onLocaleChange,
  children,
}: AppShellProps) {
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(MORE_PAGES.includes(page));
  const primaryItems: readonly NavItem[] = [
    { id: "home", label: t("nav.home"), icon: Home },
    { id: "ask", label: t("nav.ask"), icon: MessageCircleQuestion },
    ...(membersAvailable
      ? [{ id: "members" as const, label: collective.labels.members, icon: Users }]
      : []),
    { id: "memory", label: collective.labels.memory, icon: BookOpen },
    { id: "activity", label: collective.labels.activity, icon: ListTodo },
  ];
  const moreItems: readonly NavItem[] = [
    { id: "inbox", label: t("nav.inbox"), icon: InboxIcon },
    { id: "messages", label: t("nav.messages"), icon: MessagesSquare },
    { id: "lifecycle", label: t("nav.lifecycle"), icon: UserRoundCheck },
    { id: "contributions", label: t("nav.contributions"), icon: Waypoints },
    { id: "context", label: t("nav.context"), icon: Network },
    { id: "decisions", label: collective.labels.decisions, icon: Scale },
    { id: "knowledge", label: t("nav.canonicalMemory"), icon: BookCheck },
    { id: "work", label: t("nav.structuredWork"), icon: ListTodo },
    ...(bootstrap.membershipState === "active"
      ? [{ id: "chronicle" as const, label: collective.labels.history, icon: History }]
      : []),
    { id: "operations", label: t("nav.operations"), icon: CloudCog },
    { id: "settings", label: t("nav.settings"), icon: Settings },
  ];

  useEffect(() => {
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

  const mobileItems = primaryItems.filter((item) => item.id !== "members");

  return (
    <div className="app-layout">
      <aside className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} /></div>
          <div className="brand-copy">
            <span>{t("app.name")}</span>
            <small>{bootstrap.guildName}</small>
          </div>
          <button className="icon-button sidebar-close" type="button" title={t("nav.close")} aria-label={t("nav.close")} onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>
        <nav className="primary-nav" aria-label={t("app.name")}>
          <div className="nav-section">{renderItems(primaryItems)}</div>
          <div className="nav-section nav-section-more">
            <button className={MORE_PAGES.includes(page) ? "nav-group-toggle nav-group-toggle-active" : "nav-group-toggle"} type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
              <span>{t("nav.more")}</span>
              <ChevronDown className={moreOpen ? "nav-chevron nav-chevron-open" : "nav-chevron"} size={16} />
            </button>
            {moreOpen ? <div className="nav-group-items">{renderItems(moreItems)}</div> : null}
          </div>
        </nav>
        <div className="sidebar-account">
          <span className={`status-dot status-${bootstrap.membershipState ?? "invited"}`} />
          <div>
            <strong>{bootstrap.rootOwner ? t("people.root") : collective.labels.member}</strong>
            <small>{membershipStateLabel(bootstrap.membershipState, collective.template.key, locale)}</small>
          </div>
        </div>
      </aside>

      {mobileOpen ? <button className="sidebar-scrim" type="button" aria-label={t("nav.close")} onClick={() => setMobileOpen(false)} /> : null}

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" title={t("nav.open")} aria-label={t("nav.open")} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="topbar-context"><strong>{bootstrap.guildName}</strong><span>{collective.template.name}</span></div>
          <label className="language-control" title={t("language.label")}>
            <Languages size={17} aria-hidden="true" />
            <span className="sr-only">{t("language.label")}</span>
            <select aria-label={t("language.label")} value={locale} onChange={(event) => void changeLocale(event.target.value as "en" | "ja" | "zh-CN")}>
              <option value="en">{t("language.en")}</option>
              <option value="ja">{t("language.ja")}</option>
              <option value="zh-CN">{t("language.zh-CN")}</option>
            </select>
          </label>
        </header>
        <main className="content"><div className="page-surface" key={page}>{children}</div></main>
      </div>

      <nav className="mobile-tabbar" aria-label={t("nav.mobilePrimary")}>
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={page === item.id ? "mobile-tab mobile-tab-active" : "mobile-tab"} type="button" aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon size={20} /><span>{item.label}</span></button>;
        })}
        <button className={page === "members" || MORE_PAGES.includes(page) ? "mobile-tab mobile-tab-active" : "mobile-tab"} type="button" aria-current={page === "members" || MORE_PAGES.includes(page) ? "page" : undefined} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20} /><span>{t("nav.more")}</span></button>
      </nav>
    </div>
  );
}
