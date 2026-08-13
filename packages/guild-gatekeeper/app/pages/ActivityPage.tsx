import {
  ArrowRight,
  CalendarClock,
  ListTodo,
  LoaderCircle,
  Plus,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ACTIVITY_TRANSITIONS,
  CLASSIFICATIONS,
  VISIBILITIES,
  type ActivityStatus,
  type ActivityType,
  type Classification,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateActivityRequest,
  GuildUiApi,
  UiActivity,
  UiActivityPage,
  UiCollectiveContext,
  UiDirectory,
} from "../../src/management-types";
import {
  contextProfileForSpace,
  visibleActivityTypes,
} from "../collective-context";
import { activityStatusLabel, activityTypeLabel } from "../collective-language";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function ActivityEditor({
  page,
  collective,
  directory,
  suggestedParent,
  onCreate,
  onClose,
}: {
  page: UiActivityPage;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  suggestedParent: UiActivity | null;
  onCreate(input: CreateActivityRequest): Promise<void>;
  onClose(): void;
}) {
  const { locale, t } = useI18n();
  const creatableSpaces = collective.spaces.filter((space) => page.creatableSpaceIds.includes(space.id));
  const defaultSpaceId = suggestedParent?.spaceId ?? creatableSpaces[0]?.id ?? null;
  const defaultProfile = contextProfileForSpace(collective, defaultSpaceId);
  const [parentActivityId, setParentActivityId] = useState(suggestedParent?.id ?? "");
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? "");
  const [assigneeActorId, setAssigneeActorId] = useState("");
  const [type, setType] = useState<ActivityType>(defaultProfile.activityTypes[0] ?? "task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ActivityStatus>("proposed");
  const [visibility, setVisibility] = useState<Visibility>(defaultSpaceId ? "space" : "guild");
  const [classification, setClassification] = useState<Classification>("internal");
  const [startsAt, setStartsAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProfile = contextProfileForSpace(collective, spaceId);
  const workflowOptions = activeProfile.workflows.filter((workflow) => workflow.activityType);
  const activeActors = directory?.identities.filter((identity) =>
    identity.status === "active" && ["preboarding", "active"].includes(identity.membershipState)) ?? [];

  function chooseSpace(nextSpaceId: string) {
    const nextProfile = contextProfileForSpace(collective, nextSpaceId);
    setSpaceId(nextSpaceId);
    setType((current) => nextProfile.activityTypes.includes(current)
      ? current
      : nextProfile.activityTypes[0] ?? "task");
    if (!nextSpaceId && visibility === "space") setVisibility("guild");
  }

  function chooseParent(id: string) {
    setParentActivityId(id);
    const parent = page.items.find((activity) => activity.id === id);
    if (parent) {
      chooseSpace(parent.spaceId ?? "");
      setVisibility(parent.spaceId ? "space" : "guild");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        parentActivityId: parentActivityId || null,
        spaceId: spaceId || null,
        assigneeActorId: assigneeActorId || null,
        type,
        title: title.trim(),
        description: description.trim(),
        status,
        visibility,
        classification,
        allowedActorIds: [],
        sourceIds: [],
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        position: parentActivityId
          ? page.items.filter((activity) => activity.parentActivityId === parentActivityId).length
          : 0,
      });
      onClose();
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="activity-dialog-title">
        <header className="dialog-header">
          <h2 id="activity-dialog-title">{activeProfile.labels.startActivity}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="form-grid">
            <label><span>{t("activity.parent")}</span><select aria-label={t("activity.parent")} value={parentActivityId} onChange={(event) => chooseParent(event.target.value)}><option value="">{t("common.none")}</option>{page.items.filter((activity) => !activity.compatibilitySourceType).map((activity) => <option key={activity.id} value={activity.id}>{activity.title}</option>)}</select></label>
            <label><span>{t("memory.space")}</span><select aria-label={t("memory.space")} value={spaceId} disabled={Boolean(parentActivityId)} onChange={(event) => chooseSpace(event.target.value)}><option value="">{t("people.global")}</option>{creatableSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
          </div>
          <div className="context-profile-indicator"><span>{t("collective.profilePreview")}</span><strong>{activeProfile.name}</strong></div>
          {workflowOptions.length ? (
            <div className="context-workflow-options">
              <span><Workflow size={15} />{t("collective.workflows")}</span>
              <div>{workflowOptions.map((workflow) => workflow.activityType ? (
                <button type="button" key={workflow.key} aria-pressed={type === workflow.activityType} onClick={() => setType(workflow.activityType ?? type)}>{workflow.name}</button>
              ) : null)}</div>
            </div>
          ) : null}
          <div className="form-grid">
            <label><span>{t("activity.type")}</span><select aria-label={t("activity.type")} value={type} onChange={(event) => setType(event.target.value as ActivityType)}>{activeProfile.activityTypes.map((value) => <option key={value} value={value}>{activityTypeLabel(value, locale)}</option>)}</select></label>
            <label><span>{t("activity.status")}</span><select aria-label={t("activity.status")} value={status} onChange={(event) => setStatus(event.target.value as ActivityStatus)}>{(["proposed", "planned", "ready"] as const).map((value) => <option key={value} value={value}>{activityStatusLabel(value, locale)}</option>)}</select></label>
          </div>
          <label><span>{t("activity.titleField")}</span><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label><span>{t("activity.description")}</span><textarea maxLength={10_000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="form-grid">
            <label><span>{t("activity.assignee")}</span><select aria-label={t("activity.assignee")} value={assigneeActorId} onChange={(event) => setAssigneeActorId(event.target.value)}><option value="">{t("activity.unassigned")}</option>{activeActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}</select></label>
            <label><span>{t("memory.visibility")}</span><select aria-label={t("memory.visibility")} value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>{VISIBILITIES.filter((value) => value !== "space" || spaceId !== "").map((value) => <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>)}</select></label>
          </div>
          <div className="form-grid">
            <label><span>{t("memory.classification")}</span><select aria-label={t("memory.classification")} value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>{CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}</select></label>
            <span />
          </div>
          <div className="form-grid">
            <label><span>{t("activity.startsAt")}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
            <label><span>{t("activity.dueAt")}</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          </div>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}<span>{activeProfile.labels.startActivity}</span></button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ActivityPage({
  api,
  collective,
  directory,
  onOpenStructured,
}: {
  api: GuildUiApi;
  collective: UiCollectiveContext;
  directory: UiDirectory | null;
  onOpenStructured(): void;
}) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiActivityPage | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "">("");
  const [editor, setEditor] = useState<UiActivity | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterTypes = useMemo(() => visibleActivityTypes(collective), [collective]);
  const actors = useMemo(() => new Map(directory?.identities.map((identity) => [identity.id, identity.displayName]) ?? []), [directory]);
  const dates = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await api.getActivityPage({ search: search.trim() || null, types: type ? [type] : undefined }));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [api, search, t, type]);

  useEffect(() => { void load(); }, [load]);

  function depth(activity: UiActivity): number {
    let current = activity.parentActivityId;
    let value = 0;
    const seen = new Set<string>();
    while (current && value < 8 && !seen.has(current)) {
      seen.add(current);
      value += 1;
      current = page?.items.find((candidate) => candidate.id === current)?.parentActivityId ?? null;
    }
    return value;
  }

  async function changeStatus(activity: UiActivity, status: ActivityStatus) {
    setBusyId(activity.id);
    setError(null);
    try {
      await api.changeActivityStatus({ activityId: activity.id, expectedVersion: activity.version, status });
      await load();
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusyId(null);
    }
  }

  async function assign(activity: UiActivity, assigneeActorId: string) {
    setBusyId(activity.id);
    setError(null);
    try {
      await api.assignActivity({ activityId: activity.id, expectedVersion: activity.version, assigneeActorId: assigneeActorId || null });
      await load();
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title={collective.labels.activity} subtitle={t("activity.subtitle")} action={page?.creatableSpaceIds.length ? <button className="primary-button" type="button" onClick={() => setEditor("new")}><Plus size={17} /><span>{collective.labels.startActivity}</span></button> : undefined} />
      <section className="collection-toolbar" aria-label={t("activity.title")}>
        <label className="search-field"><Search size={17} /><span className="sr-only">{t("common.search")}</span><input value={search} placeholder={t("activity.searchPlaceholder")} onChange={(event) => setSearch(event.target.value)} /></label>
        <label><span className="sr-only">{t("activity.type")}</span><select value={type} onChange={(event) => setType(event.target.value as ActivityType | "")}><option value="">{t("activity.allTypes")}</option>{filterTypes.map((value) => <option key={value} value={value}>{activityTypeLabel(value, locale)}</option>)}</select></label>
      </section>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {loading && !page ? <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("common.loading")}</div> : null}
      {!loading && page?.items.length === 0 ? <EmptyState icon={ListTodo} title={t("activity.emptyTitle")} description={t("activity.emptyDescription")} action={page.creatableSpaceIds.length ? <button className="primary-button" type="button" onClick={() => setEditor("new")}><Plus size={17} />{collective.labels.startActivity}</button> : undefined} /> : null}
      {page?.items.length ? (
        <section className="activity-list">
          {page.items.map((activity) => {
            const nextStatuses = ACTIVITY_TRANSITIONS[activity.status];
            const activityProfile = contextProfileForSpace(collective, activity.spaceId);
            return (
              <article className="activity-row" key={activity.id} style={{ "--activity-depth": depth(activity) } as React.CSSProperties}>
                <span className="activity-branch" aria-hidden="true"><Workflow size={16} /></span>
                <div className="activity-row-main">
                  <div className="activity-row-meta"><span>{activityTypeLabel(activity.type, locale)}</span><span className={`status-pill activity-status-${activity.status}`}>{activityStatusLabel(activity.status, locale)}</span>{activity.compatibilitySourceType ? <span className="compatibility-badge">{t("activity.compatibility")}</span> : null}</div>
                  <h2>{activity.title}</h2>
                  {activity.description ? <p>{activity.description}</p> : null}
                  <small>{activity.assigneeActorId ? actors.get(activity.assigneeActorId) ?? t("common.unknown") : t("activity.unassigned")}{activity.dueAt ? <> · <CalendarClock size={13} /> {dates.format(new Date(activity.dueAt))}</> : null}</small>
                </div>
                <div className="activity-controls">
                  {activity.compatibilitySourceType ? <button className="text-button" type="button" onClick={onOpenStructured}>{t("activity.openWorkflow")}<ArrowRight size={15} /></button> : null}
                  {activity.capabilities.assign ? <label><span className="sr-only">{t("activity.assignee")}</span><select aria-label={t("activity.assignee")} disabled={busyId === activity.id} value={activity.assigneeActorId ?? ""} onChange={(event) => void assign(activity, event.target.value)}><option value="">{t("activity.unassigned")}</option>{directory?.identities.filter((identity) => identity.status === "active" && ["preboarding", "active"].includes(identity.membershipState)).map((identity) => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}</select></label> : null}
                  {activity.capabilities.changeStatus && nextStatuses.length ? <label><span className="sr-only">{t("activity.status")}</span><select aria-label={t("activity.status")} disabled={busyId === activity.id} value="" onChange={(event) => { if (event.target.value) void changeStatus(activity, event.target.value as ActivityStatus); }}><option value="">{activityStatusLabel(activity.status, locale)}</option>{nextStatuses.map((status) => <option key={status} value={status}>{activityStatusLabel(status, locale)}</option>)}</select></label> : null}
                  {activity.capabilities.addChild ? <button className="icon-button" type="button" title={activityProfile.labels.startActivity} aria-label={activityProfile.labels.startActivity} onClick={() => setEditor(activity)}><Plus size={17} /></button> : null}
                </div>
              </article>
            );
          })}
          {page.nextCursor ? <div className="load-more-row"><button className="secondary-button" type="button" disabled={loading} onClick={async () => { const next = await api.getActivityPage({ cursor: page.nextCursor, search: search.trim() || null, types: type ? [type] : undefined }); setPage({ ...page, items: [...page.items, ...next.items], nextCursor: next.nextCursor }); }}>{t("common.loadMore")}</button></div> : null}
        </section>
      ) : null}
      {editor && page ? <ActivityEditor
        page={page}
        collective={collective}
        directory={directory}
        suggestedParent={editor === "new" ? null : editor}
        onCreate={async (input) => {
          await api.createActivity(input);
          setEditor(null);
          await load();
        }}
        onClose={() => setEditor(null)}
      /> : null}
    </>
  );
}
