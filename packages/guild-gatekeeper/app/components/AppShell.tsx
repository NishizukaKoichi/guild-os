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
  Search,
  Settings,
  ShieldCheck,
  Users,
  UserRoundCheck,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UiCollectiveContext, UiMemberBootstrapState } from "../../src/management-types";
import { membershipStateLabel } from "../collective-language";
import { useI18n } from "../i18n";
import type { AppPage, QuickAction } from "../navigation";
import { GlobalActionMenu, type GlobalDestination } from "./GlobalActionMenu";

export type { AppPage } from "../navigation";

interface AppShellProps {
  bootstrap: UiMemberBootstrapState;
  collective: UiCollectiveContext;
  page: AppPage;
  availablePages: ReadonlySet<AppPage>;
  onPageChange(page: AppPage): void;
  onQuickAction(action: QuickAction): void;
  onLocaleChange(locale: "en" | "ja" | "zh-CN"): Promise<void>;
  children: ReactNode;
}

interface NavItem {
  id: AppPage;
  label: string;
  icon: LucideIcon;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function compact<T>(values: readonly (T | null)[]): readonly T[] {
  return values.filter((value): value is T => value !== null);
}

export function AppShell({
  bootstrap,
  collective,
  page,
  availablePages,
  onPageChange,
  onQuickAction,
  onLocaleChange,
  children,
}: AppShellProps) {
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [globalActionOpen, setGlobalActionOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const pageFocusReadyRef = useRef(false);

  const item = (id: AppPage, label: string, icon: LucideIcon): NavItem | null =>
    availablePages.has(id) ? { id, label, icon } : null;
  const primaryItems = compact([
    item("home", t("nav.home"), Home),
    item("ask", t("nav.ask"), MessageCircleQuestion),
    item("members", collective.labels.members, Users),
    item("memory", collective.labels.memory, BookOpen),
    item("activity", collective.labels.activity, ListTodo),
  ]);
  const workspaceItems: readonly NavItem[] = [];
  const collaborationItems = compact([
    item("decisions", collective.labels.decisions, Scale),
    item("knowledge", t("nav.canonicalMemory"), BookCheck),
    item("work", t("nav.structuredWork"), ListTodo),
    item("inbox", t("nav.inbox"), InboxIcon),
    item("messages", t("nav.messages"), MessagesSquare),
    item("lifecycle", t("nav.lifecycle"), UserRoundCheck),
    item("contributions", t("nav.contributions"), Waypoints),
    item("context", t("nav.context"), Network),
    item("chronicle", collective.labels.history, History),
    item("settings", t("nav.settings"), Settings),
  ]);
  const managementItems = compact([
    item("operations", t("nav.operations"), CloudCog),
  ]);
  const workspacePage = workspaceItems.some((entry) => entry.id === page);
  const morePage = [...collaborationItems, ...managementItems].some((entry) => entry.id === page);
  const visualTheme = collective.blueprint?.definition.visualTheme;

  useEffect(() => {
    if (morePage) setMoreOpen(true);
  }, [morePage]);

  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobileOpen || !mobileViewport) return;
    requestAnimationFrame(() => {
      sidebarRef.current?.querySelector<HTMLElement>(".sidebar-close")?.focus();
    });

    function handleKeyDown(event: KeyboardEvent): void {
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isVisible);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [mobileOpen, mobileViewport]);

  useEffect(() => {
    function openGlobalAction(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
        setGlobalActionOpen(true);
      }
    }
    document.addEventListener("keydown", openGlobalAction);
    return () => document.removeEventListener("keydown", openGlobalAction);
  }, []);

  useEffect(() => {
    if (!pageFocusReadyRef.current) {
      pageFocusReadyRef.current = true;
      return;
    }
    requestAnimationFrame(() => {
      const main = mainRef.current;
      if (!main) return;
      if (main.contains(document.activeElement) && document.activeElement !== main) return;
      const heading = main.querySelector<HTMLElement>("h1");
      const target = heading ?? main;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  }, [page]);

  function closeMobileNavigation(restoreFocus = false): void {
    setMobileOpen(false);
    if (restoreFocus) requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function navigate(nextPage: AppPage): void {
    onPageChange(nextPage);
    closeMobileNavigation();
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
    return items.map((entry) => {
      const Icon = entry.icon;
      return (
        <button
          key={entry.id}
          data-app-page={entry.id}
          className={page === entry.id ? "nav-item nav-item-active" : "nav-item"}
          type="button"
          aria-current={page === entry.id ? "page" : undefined}
          onClick={() => navigate(entry.id)}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{entry.label}</span>
        </button>
      );
    });
  }

  const allDestinations = useMemo<readonly GlobalDestination[]>(() => [
    ...primaryItems,
    ...workspaceItems,
    ...collaborationItems,
    ...managementItems,
  ].map((entry) => ({
    ...entry,
    description: t("globalAction.openPage", { page: entry.label }),
  })), [collaborationItems, managementItems, primaryItems, t, workspaceItems]);

  return (
    <div
      className="app-layout"
      data-collective-theme={visualTheme?.preset ?? "system"}
      data-collective-accent={visualTheme?.accent ?? "green"}
    >
      <a className="skip-link" href="#main-content">{t("nav.skipToContent")}</a>
      <aside
        ref={sidebarRef}
        className={mobileOpen ? "sidebar sidebar-open" : "sidebar"}
        aria-hidden={mobileViewport && !mobileOpen ? true : undefined}
        aria-label={mobileViewport ? t("nav.navigationDialog") : undefined}
        aria-modal={mobileViewport && mobileOpen ? true : undefined}
        role={mobileViewport ? "dialog" : undefined}
        inert={mobileViewport && !mobileOpen ? true : undefined}
      >
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} /></div>
          <div className="brand-copy">
            <span>{t("app.name")}</span>
            <small>{bootstrap.guildName}</small>
          </div>
          <button className="icon-button sidebar-close" type="button" title={t("nav.close")} aria-label={t("nav.close")} onClick={() => closeMobileNavigation(true)}><X size={20} /></button>
        </div>
        <nav className="primary-nav" aria-label={t("app.name")}>
          <div className="nav-section">{renderItems(primaryItems)}</div>
          {[...collaborationItems, ...managementItems].length ? (
            <div className="nav-section nav-section-more">
              <button className={morePage ? "nav-group-toggle nav-group-toggle-active" : "nav-group-toggle"} type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
                <span>{t("nav.more")}</span>
                <ChevronDown className={moreOpen ? "nav-chevron nav-chevron-open" : "nav-chevron"} size={16} />
              </button>
              {moreOpen ? (
                <div className="nav-group-items">
                  {renderItems(collaborationItems)}
                  {managementItems.length ? <span className="nav-subsection-label">{t("nav.manage")}</span> : null}
                  {renderItems(managementItems)}
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>
        <div className="sidebar-account">
          <span className={`status-dot status-${bootstrap.membershipState ?? "invited"}`} />
          <div>
            <strong>{bootstrap.rootOwner ? t("people.root") : collective.labels.member}</strong>
            <small>{membershipStateLabel(bootstrap.membershipState, collective.template.key, locale)}</small>
          </div>
        </div>
      </aside>

      {mobileOpen ? <button className="sidebar-scrim" type="button" aria-label={t("nav.close")} onClick={() => closeMobileNavigation(true)} /> : null}

      <div className="workspace">
        <header className="topbar">
          <button ref={menuButtonRef} className="icon-button mobile-menu" type="button" title={t("nav.open")} aria-label={t("nav.open")} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
          <div className="topbar-context"><strong>{bootstrap.guildName}</strong><span>{collective.template.name}</span></div>
          <button className="global-action-trigger" type="button" aria-label={t("globalAction.trigger")} onClick={() => setGlobalActionOpen(true)}>
            <Search size={17} aria-hidden="true" />
            <span>{t("globalAction.trigger")}</span>
            <kbd aria-hidden="true">⌘K</kbd>
          </button>
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
        <main id="main-content" ref={mainRef} className="content" tabIndex={-1}>
          <div className="page-surface" key={page}>{children}</div>
        </main>
      </div>

      <nav
        className="mobile-tabbar mobile-tabbar-six"
        aria-label={t("nav.mobilePrimary")}
        aria-hidden={mobileOpen ? true : undefined}
        inert={mobileOpen ? true : undefined}
      >
        {primaryItems.map((entry) => {
          const Icon = entry.icon;
          return <button key={entry.id} data-app-page={entry.id} className={page === entry.id ? "mobile-tab mobile-tab-active" : "mobile-tab"} type="button" aria-current={page === entry.id ? "page" : undefined} onClick={() => navigate(entry.id)}><Icon size={20} aria-hidden="true" /><span>{entry.label}</span></button>;
        })}
        <button className={workspacePage || morePage ? "mobile-tab mobile-tab-active" : "mobile-tab"} type="button" aria-current={workspacePage || morePage ? "page" : undefined} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20} aria-hidden="true" /><span>{t("nav.more")}</span></button>
      </nav>

      <GlobalActionMenu
        open={globalActionOpen}
        destinations={allDestinations}
        memoryLabel={collective.labels.remember}
        activityLabel={collective.labels.startActivity}
        onClose={() => setGlobalActionOpen(false)}
        onNavigate={navigate}
        onQuickAction={onQuickAction}
      />
    </div>
  );
}
