import {
  ArrowRight,
  BookOpen,
  Inbox,
  ListTodo,
  MessageCircleQuestion,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppPage, QuickAction } from "../navigation";
import { useI18n } from "../i18n";

export interface GlobalDestination {
  id: AppPage;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface GlobalActionMenuProps {
  open: boolean;
  destinations: readonly GlobalDestination[];
  memoryLabel: string;
  activityLabel: string;
  onClose(): void;
  onNavigate(page: AppPage): void;
  onQuickAction(action: QuickAction): void;
}

interface MenuItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  select(): void;
}

export function GlobalActionMenu({
  open,
  destinations,
  memoryLabel,
  activityLabel,
  onClose,
  onNavigate,
  onQuickAction,
}: GlobalActionMenuProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const actionItems = useMemo<readonly MenuItem[]>(() => [
    {
      id: "quick-ask",
      label: t("globalAction.ask"),
      description: t("globalAction.askDescription"),
      icon: MessageCircleQuestion,
      select: () => onQuickAction("ask"),
    },
    {
      id: "quick-remember",
      label: memoryLabel,
      description: t("globalAction.rememberDescription"),
      icon: BookOpen,
      select: () => onQuickAction("remember"),
    },
    {
      id: "quick-start",
      label: activityLabel,
      description: t("globalAction.startDescription"),
      icon: ListTodo,
      select: () => onQuickAction("start"),
    },
    {
      id: "quick-review",
      label: t("globalAction.review"),
      description: t("globalAction.reviewDescription"),
      icon: Inbox,
      select: () => onQuickAction("review"),
    },
  ], [activityLabel, memoryLabel, onQuickAction, t]);
  const destinationItems = useMemo<readonly MenuItem[]>(() => destinations.map((destination) => ({
      ...destination,
      id: `page-${destination.id}`,
      select: () => onNavigate(destination.id),
    })), [destinations, onNavigate]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (item: MenuItem) => !normalizedQuery ||
    `${item.label} ${item.description}`.toLocaleLowerCase().includes(normalizedQuery);
  const filteredActions = actionItems.filter(matches);
  const filteredDestinations = destinationItems.filter(matches);
  const filtered = [...filteredActions, ...filteredDestinations];

  function choose(item: MenuItem): void {
    item.select();
    onClose();
  }

  function renderItem(item: MenuItem) {
    const Icon = item.icon;
    return (
      <button type="button" key={item.id} onClick={() => choose(item)}>
        <span className="global-action-icon"><Icon size={18} /></span>
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    );
  }

  if (!open) return null;

  return (
    <div className="dialog-backdrop global-action-backdrop" role="presentation">
      <section className="global-action-dialog" role="dialog" aria-modal="true" aria-labelledby="global-action-title">
        <header className="global-action-header">
          <div>
            <h2 id="global-action-title">{t("globalAction.title")}</h2>
            <p>{t("globalAction.description")}</p>
          </div>
          <button className="text-button" type="button" data-dialog-close onClick={onClose}>
            {t("common.close")}
          </button>
        </header>
        <label className="global-action-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">{t("globalAction.searchLabel")}</span>
          <input
            ref={searchRef}
            value={query}
            autoComplete="off"
            placeholder={t("globalAction.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filtered[0]) {
                event.preventDefault();
                choose(filtered[0]);
              }
            }}
          />
          <kbd aria-label={t("globalAction.shortcut")}>⌘K</kbd>
        </label>
        <p className="sr-only" aria-live="polite">{t("globalAction.resultCount", { count: filtered.length })}</p>
        <div className="global-action-results">
          {filtered.length ? (
            <>
              {filteredActions.length ? (
                <section className="global-action-group" aria-labelledby="global-action-common-title">
                  <h3 id="global-action-common-title">{t("globalAction.commonActions")}</h3>
                  {filteredActions.map(renderItem)}
                </section>
              ) : null}
              {filteredDestinations.length ? (
                <section className="global-action-group" aria-labelledby="global-action-places-title">
                  <h3 id="global-action-places-title">{t("globalAction.places")}</h3>
                  {filteredDestinations.map(renderItem)}
                </section>
              ) : null}
            </>
          ) : (
            <div className="global-action-empty">
              <strong>{t("globalAction.emptyTitle")}</strong>
              <span>{t("globalAction.emptyDescription")}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
