import {
  Archive,
  BookOpen,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CLASSIFICATIONS,
  VISIBILITIES,
  type Classification,
  type LocalizedText,
  type MemoryType,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateMemoryRequest,
  GuildUiApi,
  SaveMemoryRequest,
  UiCollectiveContext,
  UiDirectory,
  UiMemory,
  UiMemoryPage,
} from "../../src/management-types";
import {
  contextProfileForSpace,
  visibleMemoryTypes,
} from "../collective-context";
import { memoryTypeLabel } from "../collective-language";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";

function localized(value: LocalizedText, locale: "en" | "ja" | "zh-CN"): string {
  return value[locale] ?? value.en ?? value.ja ?? value["zh-CN"] ?? "";
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function MemoryEditor({
  memory,
  page,
  collective,
  directory,
  onCreate,
  onSave,
  onClose,
}: {
  memory: UiMemory | null;
  page: UiMemoryPage;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onCreate(input: CreateMemoryRequest): Promise<void>;
  onSave(input: SaveMemoryRequest): Promise<void>;
  onClose(): void;
}) {
  const { locale, t } = useI18n();
  const spaces = collective.spaces.filter((space) => page.creatableSpaceIds.includes(space.id));
  const defaultSpaceId = memory?.spaceId ?? spaces[0]?.id ?? null;
  const defaultProfile = contextProfileForSpace(collective, defaultSpaceId);
  const [type, setType] = useState<MemoryType>(memory?.type ?? defaultProfile.memoryTypes[0] ?? "fact");
  const [title, setTitle] = useState(memory ? localized(memory.title, locale) : "");
  const [summary, setSummary] = useState(memory ? localized(memory.summary, locale) : "");
  const [body, setBody] = useState(memory ? localized(memory.body, locale) : "");
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? "");
  const [visibility, setVisibility] = useState<Visibility>(memory?.visibility ?? (defaultSpaceId ? "space" : "guild"));
  const [classification, setClassification] = useState<Classification>(memory?.classification ?? "internal");
  const [allowedActorIds, setAllowedActorIds] = useState<readonly string[]>(memory?.allowedActorIds ?? []);
  const [confidence, setConfidence] = useState(memory?.confidence === null || memory?.confidence === undefined ? "" : String(memory.confidence));
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProfile = contextProfileForSpace(collective, spaceId);
  const workflowOptions = activeProfile.workflows.filter((workflow) => workflow.memoryType);
  const dialogTitle = memory ? t("memory.editTitle") : activeProfile.labels.remember;

  function chooseSpace(nextSpaceId: string) {
    const nextProfile = contextProfileForSpace(collective, nextSpaceId);
    setSpaceId(nextSpaceId);
    setType((current) => nextProfile.memoryTypes.includes(current)
      ? current
      : nextProfile.memoryTypes[0] ?? "fact");
    if (!nextSpaceId && visibility === "space") setVisibility("guild");
  }

  function content(existing: LocalizedText | undefined, value: string): LocalizedText {
    return { ...(existing ?? {}), [locale]: value.trim() };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (memory) {
        await onSave({
          memoryId: memory.id,
          expectedVersion: memory.currentVersion,
          title: content(memory.title, title),
          summary: content(memory.summary, summary),
          body: content(memory.body, body),
          sourceIds: memory.sourceIds,
          changeNote,
        });
      } else {
        await onCreate({
          spaceId: spaceId || null,
          type,
          title: content(undefined, title),
          summary: content(undefined, summary),
          body: content(undefined, body),
          visibility,
          classification,
          allowedActorIds,
          sourceIds: [],
          confidence: confidence === "" ? null : Number(confidence),
          changeNote,
        });
      }
      onClose();
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  function toggleActor(actorId: string) {
    setAllowedActorIds((current) => current.includes(actorId)
      ? current.filter((id) => id !== actorId)
      : [...current, actorId]);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label={dialogTitle}>
        <header className="dialog-header">
          <h2>{dialogTitle}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {!memory ? (
            <>
              <div className="form-grid">
                <label>
                  <span>{t("memory.space")}</span>
                  <select aria-label={t("memory.space")} value={spaceId} onChange={(event) => chooseSpace(event.target.value)}>
                    <option value="">{t("people.global")}</option>
                    {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("memory.type")}</span>
                  <select aria-label={t("memory.type")} value={type} onChange={(event) => setType(event.target.value as MemoryType)}>
                    {activeProfile.memoryTypes.map((value) => <option key={value} value={value}>{memoryTypeLabel(value, locale)}</option>)}
                  </select>
                </label>
              </div>
              <div className="context-profile-indicator"><span>{t("collective.profilePreview")}</span><strong>{activeProfile.name}</strong></div>
              {workflowOptions.length ? (
                <div className="context-workflow-options">
                  <span><Workflow size={15} />{t("collective.workflows")}</span>
                  <div>{workflowOptions.map((workflow) => workflow.memoryType ? (
                    <button type="button" key={workflow.key} aria-pressed={type === workflow.memoryType} onClick={() => setType(workflow.memoryType ?? type)}>{workflow.name}</button>
                  ) : null)}</div>
                </div>
              ) : null}
            </>
          ) : null}
          <label htmlFor="memory-title">
            <span>{t("memory.titleField")}</span>
            <input id="memory-title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label htmlFor="memory-summary">
            <span>{t("memory.summary")}</span>
            <textarea id="memory-summary" required maxLength={2_000} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label htmlFor="memory-body">
            <span>{t("memory.body")}</span>
            <textarea id="memory-body" required maxLength={200_000} rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          {!memory ? (
            <>
              <div className="form-grid">
                <label>
                  <span>{t("memory.visibility")}</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                    {VISIBILITIES.filter((value) => value !== "space" || spaceId !== "").map((value) => <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("memory.classification")}</span>
                  <select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
                    {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}
                  </select>
                </label>
              </div>
              {visibility === "restricted" || visibility === "private" ? (
                <fieldset className="actor-share-list">
                  <legend>{t("people.members")}</legend>
                  {directory?.identities.filter((identity) => identity.membershipState !== "departed").map((identity) => (
                    <label key={identity.id}>
                      <input type="checkbox" checked={allowedActorIds.includes(identity.id)} onChange={() => toggleActor(identity.id)} />
                      <span>{identity.displayName}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label>
                <span>{t("memory.confidence")}</span>
                <input type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} />
              </label>
            </>
          ) : null}
          <label htmlFor="memory-change-note">
            <span>{t("memory.changeNote")}</span>
            <input id="memory-change-note" maxLength={2_000} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : memory ? <Pencil size={17} /> : <Plus size={17} />}
              <span>{memory ? t("common.save") : activeProfile.labels.remember}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function MemoryPage({
  api,
  collective,
  directory,
  onOpenGoverned,
}: {
  api: GuildUiApi;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onOpenGoverned(memoryId: string): void;
}) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiMemoryPage | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<MemoryType | "">("");
  const [editor, setEditor] = useState<UiMemory | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterTypes = useMemo(() => visibleMemoryTypes(collective), [collective]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await api.getMemoryPage({ search: search.trim() || null, type: type || null }));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [api, search, t, type]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const next = await api.getMemoryPage({ cursor: page.nextCursor, search: search.trim() || null, type: type || null });
      setPage({ ...page, items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }

  async function archive(memory: UiMemory) {
    if (!window.confirm(t("memory.archiveConfirm"))) return;
    setBusyId(memory.id);
    try {
      await api.archiveMemory({ memoryId: memory.id, expectedVersion: memory.currentVersion });
      await load();
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title={collective.labels.memory}
        subtitle={t("memory.subtitle")}
        action={page?.creatableSpaceIds.length ? (
          <button className="primary-button" type="button" onClick={() => setEditor("new")}><Plus size={17} /><span>{collective.labels.remember}</span></button>
        ) : undefined}
      />
      <section className="collection-toolbar" aria-label={t("memory.title")}>
        <label className="search-field"><Search size={17} /><span className="sr-only">{t("common.search")}</span><input value={search} placeholder={t("memory.searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} /></label>
        <label><span className="sr-only">{t("memory.type")}</span><select value={type} onChange={(event) => setType(event.target.value as MemoryType | "")}><option value="">{t("memory.allTypes")}</option>{filterTypes.map((value) => <option key={value} value={value}>{memoryTypeLabel(value, locale)}</option>)}</select></label>
      </section>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {loading && !page ? <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("common.loading")}</div> : null}
      {!loading && page?.items.length === 0 ? <EmptyState icon={BookOpen} title={t("memory.emptyTitle")} description={t("memory.emptyDescription")} action={page.creatableSpaceIds.length ? <button className="primary-button" type="button" onClick={() => setEditor("new")}><Plus size={17} />{collective.labels.remember}</button> : undefined} /> : null}
      {page?.items.length ? (
        <section className="memory-list">
          {page.items.map((memory) => (
            <article className="memory-row" key={memory.id}>
              <div className="memory-row-main">
                <div className="memory-row-meta">
                  <span>{memoryTypeLabel(memory.type, locale)}</span>
                  {memory.capabilities.governed ? <span className="governed-badge"><ShieldCheck size={13} />{t("memory.governed")}</span> : null}
                </div>
                <h2>{localized(memory.title, locale)}</h2>
                <p>{localized(memory.summary, locale)}</p>
                <small>{t("memory.updated")} {dateFormatter.format(new Date(memory.updatedAt))}</small>
              </div>
              <div className="row-actions">
                {memory.capabilities.governed ? <button className="text-button" type="button" onClick={() => onOpenGoverned(memory.id)}><ShieldCheck size={16} />{t("memory.openWorkflow")}</button> : null}
                {memory.capabilities.edit ? <button className="icon-button" type="button" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => setEditor(memory)}><Pencil size={17} /></button> : null}
                {memory.capabilities.archive ? <button className="icon-button danger-button" type="button" disabled={busyId === memory.id} title={t("common.archive")} aria-label={t("common.archive")} onClick={() => void archive(memory)}><Archive size={17} /></button> : null}
              </div>
            </article>
          ))}
          {page.nextCursor ? <div className="load-more-row"><button className="secondary-button" type="button" disabled={loading} onClick={() => void loadMore()}>{t("common.loadMore")}</button></div> : null}
        </section>
      ) : null}
      {editor && page ? <MemoryEditor
        memory={editor === "new" ? null : editor}
        page={page}
        collective={collective}
        directory={directory}
        onCreate={async (input) => {
          await api.createMemory(input);
          setEditor(null);
          await load();
        }}
        onSave={async (input) => {
          await api.saveMemory(input);
          setEditor(null);
          await load();
        }}
        onClose={() => setEditor(null)}
      /> : null}
    </>
  );
}
