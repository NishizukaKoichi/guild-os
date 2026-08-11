import {
  CalendarRange,
  Filter,
  History,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GuildUiApi,
  UiChroniclePage,
  UiChroniclePageRequest,
  UiDirectory,
} from "../../src/management-types";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { classificationTranslationKey, useI18n } from "../i18n";

interface ChronicleFilters {
  search: string;
  actorIdentityId: string;
  subjectType: string;
  occurredFrom: string;
  occurredTo: string;
}

const EMPTY_FILTERS: ChronicleFilters = {
  search: "",
  actorIdentityId: "",
  subjectType: "",
  occurredFrom: "",
  occurredTo: "",
};

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function timestamp(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function requestFrom(filters: ChronicleFilters, cursor?: string | null): UiChroniclePageRequest {
  return {
    cursor,
    search: filters.search.trim() || null,
    actorIdentityId: filters.actorIdentityId || null,
    subjectType: filters.subjectType.trim() || null,
    occurredFrom: timestamp(filters.occurredFrom),
    occurredTo: timestamp(filters.occurredTo),
  };
}

export function ChroniclePage({
  api,
  directory,
}: {
  api: GuildUiApi;
  directory: UiDirectory | null;
}) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiChroniclePage | null>(null);
  const [draftFilters, setDraftFilters] = useState<ChronicleFilters>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<ChronicleFilters>(EMPTY_FILTERS);
  const [knownSubjectTypes, setKnownSubjectTypes] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }), [locale]);
  const spaceNames = useMemo(() => new Map(
    directory?.spaces.map((space) => [space.id, space.name]) ?? [],
  ), [directory]);

  const fetchPage = useCallback(async (
    filters: ChronicleFilters,
    cursor: string | null = null,
  ) => {
    return api.getChroniclePage(requestFrom(filters, cursor));
  }, [api]);

  const captureSubjectTypes = useCallback((next: UiChroniclePage) => {
    setKnownSubjectTypes((current) => new Set([
      ...current,
      ...next.items.map((event) => event.subjectType),
    ]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPage(EMPTY_FILTERS);
      setPage(next);
      captureSubjectTypes(next);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [captureSubjectTypes, fetchPage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyFilters(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await fetchPage(draftFilters);
      setPage(next);
      setActiveFilters(draftFilters);
      captureSubjectTypes(next);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function clearFilters(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchPage(EMPTY_FILTERS);
      setDraftFilters(EMPTY_FILTERS);
      setActiveFilters(EMPTY_FILTERS);
      setPage(next);
      captureSubjectTypes(next);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fetchPage(activeFilters, page.nextCursor);
      const known = new Set(page.items.map((item) => item.id));
      setPage({
        ...next,
        items: [...page.items, ...next.items.filter((item) => !known.has(item.id))],
      });
      captureSubjectTypes(next);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t("chronicle.title")} subtitle={t("chronicle.subtitle")} />
      {error ? <Notice kind="error">{error}</Notice> : null}

      <form className="chronicle-filters" onSubmit={(event) => void applyFilters(event)}>
        <label className="chronicle-search-field">
          <span>{t("chronicle.search")}</span>
          <div className="input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input value={draftFilters.search} maxLength={120} placeholder={t("chronicle.searchPlaceholder")} onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))} />
          </div>
        </label>
        <label>
          <span>{t("chronicle.actor")}</span>
          <select value={draftFilters.actorIdentityId} onChange={(event) => setDraftFilters((current) => ({ ...current, actorIdentityId: event.target.value }))}>
            <option value="">{t("chronicle.allActors")}</option>
            {directory?.identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}
          </select>
        </label>
        <label>
          <span>{t("chronicle.subjectType")}</span>
          <select value={draftFilters.subjectType} onChange={(event) => setDraftFilters((current) => ({ ...current, subjectType: event.target.value }))}>
            <option value="">{t("chronicle.allSubjects")}</option>
            {[...knownSubjectTypes].sort().map((subjectType) => <option key={subjectType} value={subjectType}>{subjectType}</option>)}
          </select>
        </label>
        <label>
          <span>{t("chronicle.from")}</span>
          <input type="datetime-local" value={draftFilters.occurredFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, occurredFrom: event.target.value }))} />
        </label>
        <label>
          <span>{t("chronicle.to")}</span>
          <input type="datetime-local" value={draftFilters.occurredTo} onChange={(event) => setDraftFilters((current) => ({ ...current, occurredTo: event.target.value }))} />
        </label>
        <div className="chronicle-filter-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void clearFilters()}><RotateCcw size={16} />{t("chronicle.clear")}</button>
          <button className="primary-button" type="submit" disabled={busy}><Filter size={16} />{t("chronicle.apply")}</button>
        </div>
      </form>

      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("common.loading")}</div>
      ) : !page?.items.length ? (
        <p className="empty-state">{t("chronicle.empty")}</p>
      ) : (
        <section className="content-section chronicle-section">
          <div className="chronicle-list">
            {page.items.map((event) => (
              <article className="chronicle-event" key={event.id}>
                <div className="chronicle-marker" aria-hidden="true"><History size={16} /></div>
                <div className="chronicle-event-content">
                  <header>
                    <div>
                      <strong>{event.action}</strong>
                      <span className="status-pill">{event.subjectType}</span>
                    </div>
                    <time dateTime={event.occurredAt}>{dateFormatter.format(new Date(event.occurredAt))}</time>
                  </header>
                  <div className="chronicle-summary">
                    <span><UserRound size={14} />{event.actorDisplayName}</span>
                    <span><ShieldCheck size={14} />{t(classificationTranslationKey(event.classification))}</span>
                    <span><CalendarRange size={14} />{spaceNames.get(event.spaceId ?? "") ?? t("people.global")}</span>
                  </div>
                  <dl className="chronicle-record">
                    <div><dt>{t("chronicle.subject")}</dt><dd><code>{event.subjectId}</code></dd></div>
                    <div><dt>{t("chronicle.sequence")}</dt><dd><code>{event.sequence}</code></dd></div>
                  </dl>
                  {Object.keys(event.details).length ? (
                    <details className="chronicle-details">
                      <summary>{t("chronicle.details")}</summary>
                      <dl>
                        {Object.entries(event.details).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => (
                          <div key={key}><dt>{key}</dt><dd>{value === null ? t("common.none") : String(value)}</dd></div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {page.nextCursor ? (
            <div className="load-more-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => void loadMore()}>{t("common.loadMore")}</button></div>
          ) : null}
        </section>
      )}
    </>
  );
}
