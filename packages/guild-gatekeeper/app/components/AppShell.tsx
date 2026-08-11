import {
  BookOpen,
  Bot,
  Home,
  Languages,
  Menu,
  MessageCircleQuestion,
  ListTodo,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UiBootstrapState } from "../../src/management-types";
import { membershipTranslationKey, useI18n } from "../i18n";

export type AppPage = "home" | "ask" | "knowledge" | "work" | "people" | "agents" | "settings";

interface AppShellProps {
  bootstrap: UiBootstrapState;
  page: AppPage;
  peopleAvailable: boolean;
  agentsAvailable: boolean;
  onPageChange(page: AppPage): void;
  children: ReactNode;
}

export function AppShell({
  bootstrap,
  page,
  peopleAvailable,
  agentsAvailable,
  onPageChange,
  children,
}: AppShellProps) {
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = [
    { id: "home" as const, label: t("nav.home"), icon: Home },
    { id: "ask" as const, label: t("nav.ask"), icon: MessageCircleQuestion },
    { id: "knowledge" as const, label: t("nav.knowledge"), icon: BookOpen },
    { id: "work" as const, label: t("nav.work"), icon: ListTodo },
    ...(peopleAvailable
      ? [{ id: "people" as const, label: t("nav.people"), icon: Users }]
      : []),
    ...(agentsAvailable
      ? [{ id: "agents" as const, label: t("nav.agents"), icon: Bot }]
      : []),
    { id: "settings" as const, label: t("nav.settings"), icon: Settings },
  ];

  function navigate(nextPage: AppPage) {
    onPageChange(nextPage);
    setMobileOpen(false);
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
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={page === item.id ? "nav-item nav-item-active" : "nav-item"}
                type="button"
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
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
              onChange={(event) => setLocale(event.target.value as "en" | "ja" | "zh-CN")}
            >
              <option value="en">{t("language.en")}</option>
              <option value="ja">{t("language.ja")}</option>
              <option value="zh-CN">{t("language.zh-CN")}</option>
            </select>
          </label>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
