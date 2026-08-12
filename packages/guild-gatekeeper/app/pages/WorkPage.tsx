import {
  BookOpen,
  Bot,
  CalendarClock,
  CheckSquare2,
  FolderKanban,
  ListTodo,
  LoaderCircle,
  Plus,
  Target,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GOAL_TRANSITIONS,
  PROJECT_TRANSITIONS,
  QUEST_TRANSITIONS,
  STEP_TRANSITIONS,
} from "@guild-os/domain";
import type {
  GuildUiApi,
  UiDirectory,
  UiGoal,
  UiProject,
  UiQuest,
  UiQuestDetail,
  UiStep,
  UiWorkPage,
  WorkAssignmentRequest,
  WorkStatusRequest,
} from "../../src/management-types";
import { CommentsPanel } from "../components/CommentsPanel";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { WorkEditorDialog, type WorkCreateKind } from "../components/WorkEditorDialog";
import { EmptyState } from "../components/EmptyState";
import { useI18n, workStatusTranslationKey } from "../i18n";

type WorkKind = WorkStatusRequest["kind"];
type WorkStatus = WorkStatusRequest["status"];

interface WorkSelection {
  goalId?: string | null;
  projectId?: string | null;
  questId?: string | null;
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function nextStatuses(kind: WorkKind, status: WorkStatus): readonly WorkStatus[] {
  switch (kind) {
    case "goal":
      return GOAL_TRANSITIONS[status as keyof typeof GOAL_TRANSITIONS] ?? [];
    case "project":
      return PROJECT_TRANSITIONS[status as keyof typeof PROJECT_TRANSITIONS] ?? [];
    case "quest":
      return QUEST_TRANSITIONS[status as keyof typeof QUEST_TRANSITIONS] ?? [];
    case "step":
      return STEP_TRANSITIONS[status as keyof typeof STEP_TRANSITIONS] ?? [];
  }
}

function StatusSelect({
  kind,
  id,
  version,
  status,
  disabled,
  onChange,
}: {
  kind: WorkKind;
  id: string;
  version: number;
  status: WorkStatus;
  disabled: boolean;
  onChange(input: WorkStatusRequest): Promise<void>;
}) {
  const { t } = useI18n();
  const options = nextStatuses(kind, status);
  return (
    <label className="work-status-control">
      <span className="sr-only">{t("work.changeStatus")}</span>
      <select
        aria-label={t("work.changeStatus")}
        value={status}
        disabled={disabled || options.length === 0}
        onChange={(event) => void onChange({
          kind,
          id,
          expectedVersion: version,
          status: event.target.value as WorkStatus,
        })}
      >
        <option value={status}>{t(workStatusTranslationKey(status))}</option>
        {options.map((next) => <option key={next} value={next}>{t(workStatusTranslationKey(next))}</option>)}
      </select>
    </label>
  );
}

function AssignmentSelect({
  kind,
  item,
  directory,
  disabled,
  onChange,
}: {
  kind: "quest" | "step";
  item: UiQuest | UiStep;
  directory: UiDirectory | null;
  disabled: boolean;
  onChange(input: WorkAssignmentRequest): Promise<void>;
}) {
  const { t } = useI18n();
  const assignees = directory?.identities.filter((identity) =>
    identity.kind !== "service" && identity.status === "active" &&
    identity.membershipState === "active") ?? [];
  return (
    <label className="work-assignment-control">
      <span>{t("work.assignee")}</span>
      <select
        value={item.assigneeIdentityId ?? ""}
        disabled={disabled || !directory}
        onChange={(event) => void onChange({
          kind,
          id: item.id,
          expectedVersion: item.version,
          assigneeIdentityId: event.target.value || null,
        })}
      >
        <option value="">{t("work.unassigned")}</option>
        {assignees.map((identity) => (
          <option key={identity.id} value={identity.id}>{identity.displayName}</option>
        ))}
      </select>
    </label>
  );
}

export function WorkPage({
  api,
  directory,
  onOpenKnowledge,
}: {
  api: GuildUiApi;
  directory: UiDirectory | null;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  const { locale, t } = useI18n();
  const [work, setWork] = useState<UiWorkPage | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UiQuestDetail | null>(null);
  const [createKind, setCreateKind] = useState<WorkCreateKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);
  const identityNames = useMemo(() => new Map(
    directory?.identities.map((identity) => [identity.id, identity.displayName]) ?? [],
  ), [directory]);
  const spaceNames = useMemo(() => new Map(
    directory?.spaces.map((space) => [space.id, space.name]) ?? [],
  ), [directory]);

  const loadWork = useCallback(async (selection: WorkSelection = {}) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getWorkPage();
      const goalId = selection.goalId && next.goals.some((goal) => goal.id === selection.goalId)
        ? selection.goalId
        : next.goals[0]?.id ?? null;
      const projects = next.projects.filter((project) => project.goalId === goalId);
      const projectId = selection.projectId && projects.some((project) => project.id === selection.projectId)
        ? selection.projectId
        : projects[0]?.id ?? null;
      const quests = next.quests.filter((quest) => quest.projectId === projectId);
      const questId = selection.questId && quests.some((quest) => quest.id === selection.questId)
        ? selection.questId
        : quests[0]?.id ?? null;
      setWork(next);
      setSelectedGoalId(goalId);
      setSelectedProjectId(projectId);
      setSelectedQuestId(questId);
      setDetail(questId ? await api.getQuestDetail(questId) : null);
    } catch (cause) {
      setError(messageFrom(cause, t("work.loadError")));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void loadWork();
  }, [loadWork]);

  const selectedGoal = work?.goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const selectedProject = work?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const projects = work?.projects.filter((project) => project.goalId === selectedGoalId) ?? [];
  const quests = work?.quests.filter((quest) => quest.projectId === selectedProjectId) ?? [];

  async function selectGoal(goalId: string): Promise<void> {
    if (!work) return;
    const nextProjects = work.projects.filter((project) => project.goalId === goalId);
    const projectId = nextProjects[0]?.id ?? null;
    const questId = work.quests.find((quest) => quest.projectId === projectId)?.id ?? null;
    setSelectedGoalId(goalId);
    setSelectedProjectId(projectId);
    setSelectedQuestId(questId);
    setDetail(questId ? await api.getQuestDetail(questId) : null);
  }

  async function selectProject(projectId: string): Promise<void> {
    if (!work) return;
    const questId = work.quests.find((quest) => quest.projectId === projectId)?.id ?? null;
    setSelectedProjectId(projectId);
    setSelectedQuestId(questId);
    setDetail(questId ? await api.getQuestDetail(questId) : null);
  }

  async function selectQuest(questId: string): Promise<void> {
    setSelectedQuestId(questId);
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await api.getQuestDetail(questId));
    } catch (cause) {
      setDetail(null);
      setError(messageFrom(cause, t("work.loadError")));
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeStatus(input: WorkStatusRequest): Promise<void> {
    if (["completed", "cancelled"].includes(input.status) && !window.confirm(t("work.confirmTerminal"))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.changeWorkStatus(input);
      await loadWork({ goalId: selectedGoalId, projectId: selectedProjectId, questId: selectedQuestId });
      setSuccess(t("work.toastStatus"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function assign(input: WorkAssignmentRequest): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.assignWork(input);
      await loadWork({ goalId: selectedGoalId, projectId: selectedProjectId, questId: selectedQuestId });
      setSuccess(t("work.toastAssigned"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(kind: "goal" | "project" | "quest"): Promise<void> {
    if (!work) return;
    const cursor = kind === "goal" ? work.nextGoalCursor
      : kind === "project" ? work.nextProjectCursor : work.nextQuestCursor;
    if (!cursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getWorkPage(kind === "goal" ? { goalCursor: cursor }
        : kind === "project" ? { projectCursor: cursor }
          : { questCursor: cursor });
      const merge = <Item extends { id: string }>(current: readonly Item[], incoming: readonly Item[]) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...incoming.filter((item) => !known.has(item.id))];
      };
      setWork({
        ...work,
        goals: kind === "goal" ? merge(work.goals, next.goals) : work.goals,
        projects: kind === "project" ? merge(work.projects, next.projects) : work.projects,
        quests: kind === "quest" ? merge(work.quests, next.quests) : work.quests,
        nextGoalCursor: kind === "goal" ? next.nextGoalCursor : work.nextGoalCursor,
        nextProjectCursor: kind === "project" ? next.nextProjectCursor : work.nextProjectCursor,
        nextQuestCursor: kind === "quest" ? next.nextQuestCursor : work.nextQuestCursor,
      });
    } catch (cause) {
      setError(messageFrom(cause, t("work.loadError")));
    } finally {
      setBusy(false);
    }
  }

  async function created(id: string): Promise<void> {
    const selection = createKind === "goal"
      ? { goalId: id }
      : createKind === "project"
        ? { goalId: selectedGoalId, projectId: id }
        : createKind === "quest"
          ? { goalId: selectedGoalId, projectId: selectedProjectId, questId: id }
          : { goalId: selectedGoalId, projectId: selectedProjectId, questId: selectedQuestId };
    await loadWork(selection);
    setSuccess(t("work.toastCreated"));
  }

  return (
    <>
      <PageHeader
        title={t("work.title")}
        subtitle={t("work.subtitle")}
        action={work?.canCreate && directory ? (
          <button className="primary-button" type="button" onClick={() => setCreateKind("goal")}>
            <Plus size={17} /><span>{t("work.createGoal")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {success ? <Notice kind="success">{success}</Notice> : null}
      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("work.loading")}</div>
      ) : !work?.goals.length ? (
        <EmptyState
          icon={ListTodo}
          title={t("work.emptyTitle")}
          description={t("work.emptyGoals")}
          action={work?.canCreate && directory ? (
            <button className="primary-button" type="button" onClick={() => setCreateKind("goal")}>
              <Plus size={17} /><span>{t("work.createGoal")}</span>
            </button>
          ) : undefined}
        />
      ) : (
        <>
          <div className="work-hierarchy">
            <section className="work-level" aria-labelledby="work-goals-title">
              <div className="work-level-heading">
                <h2 id="work-goals-title"><Target size={17} />{t("work.goals")}</h2>
              </div>
              <div className="work-outline-list">
                {work.goals.map((goal) => (
                  <div className={goal.id === selectedGoalId ? "work-outline-row work-outline-row-active" : "work-outline-row"} key={goal.id}>
                    <button type="button" onClick={() => void selectGoal(goal.id)}>
                      <strong>{goal.title}</strong>
                      <small>{spaceNames.get(goal.spaceId ?? "") ?? t("people.global")}</small>
                    </button>
                    <StatusSelect kind="goal" id={goal.id} version={goal.version} status={goal.status} disabled={busy || !goal.capabilities.changeStatus} onChange={changeStatus} />
                  </div>
                ))}
              </div>
              {work.nextGoalCursor ? <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore("goal")}>{t("common.loadMore")}</button> : null}
            </section>

            <section className="work-level" aria-labelledby="work-projects-title">
              <div className="work-level-heading">
                <h2 id="work-projects-title"><FolderKanban size={17} />{t("work.projects")}</h2>
                {selectedGoal?.capabilities.addChild && directory ? (
                  <button className="icon-button" type="button" title={t("work.createProject")} aria-label={t("work.createProject")} onClick={() => setCreateKind("project")}><Plus size={17} /></button>
                ) : null}
              </div>
              {!selectedGoal ? <p className="compact-empty">{t("work.selectGoal")}</p>
                : !projects.length ? <p className="compact-empty">{t("work.emptyProjects")}</p>
                  : <div className="work-outline-list">
                    {projects.map((project) => (
                      <div className={project.id === selectedProjectId ? "work-outline-row work-outline-row-active" : "work-outline-row"} key={project.id}>
                        <button type="button" onClick={() => void selectProject(project.id)}>
                          <strong>{project.title}</strong>
                          <small>{project.dueAt ? dateFormatter.format(new Date(project.dueAt)) : t("common.none")}</small>
                        </button>
                        <StatusSelect kind="project" id={project.id} version={project.version} status={project.status} disabled={busy || !project.capabilities.changeStatus} onChange={changeStatus} />
                      </div>
                    ))}
                  </div>}
              {work.nextProjectCursor ? <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore("project")}>{t("common.loadMore")}</button> : null}
            </section>
          </div>

          <section className="content-section work-section" aria-labelledby="work-quests-title">
            <div className="section-heading-row">
              <h2 id="work-quests-title"><ListTodo size={17} />{t("work.quests")}</h2>
              {selectedProject?.capabilities.addChild && directory ? (
                <button className="secondary-button" type="button" onClick={() => setCreateKind("quest")}><Plus size={16} />{t("work.createQuest")}</button>
              ) : null}
            </div>
            {!selectedProject ? <p className="empty-state">{t("work.selectProject")}</p>
              : !quests.length ? <p className="empty-state">{t("work.emptyQuests")}</p>
                : (
                  <div className="work-quest-workspace">
                    <nav className="work-quest-list" aria-label={t("work.quests")}>
                      {quests.map((quest) => (
                        <button className={quest.id === selectedQuestId ? "work-quest-item work-quest-item-active" : "work-quest-item"} type="button" key={quest.id} onClick={() => void selectQuest(quest.id)}>
                          <span className={`work-status work-status-${quest.status}`}>{t(workStatusTranslationKey(quest.status))}</span>
                          <strong>{quest.title}</strong>
                          <small>{quest.assigneeIdentityId ? identityNames.get(quest.assigneeIdentityId) ?? t("common.unknown") : t("work.unassigned")}</small>
                        </button>
                      ))}
                      {work.nextQuestCursor ? <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore("quest")}>{t("common.loadMore")}</button> : null}
                    </nav>
                    <article className="work-quest-detail">
                      {detailLoading ? <div className="inline-loading"><LoaderCircle className="spin" size={19} />{t("work.loading")}</div>
                        : !detail ? <p className="empty-state">{t("work.selectQuest")}</p>
                          : (
                            <>
                              <header className="work-detail-header">
                                <div>
                                  <span className={`work-status work-status-${detail.quest.status}`}>{t(workStatusTranslationKey(detail.quest.status))}</span>
                                  <h2>{detail.quest.title}</h2>
                                  <p>{detail.quest.description}</p>
                                </div>
                                <StatusSelect kind="quest" id={detail.quest.id} version={detail.quest.version} status={detail.quest.status} disabled={busy || !detail.quest.capabilities.changeStatus} onChange={changeStatus} />
                              </header>
                              <dl className="work-meta">
                                <div><UserRound size={16} /><dt>{t("work.owner")}</dt><dd>{identityNames.get(detail.quest.ownerIdentityId) ?? t("common.unknown")}</dd></div>
                                <div><CalendarClock size={16} /><dt>{t("work.dueDate")}</dt><dd>{detail.quest.dueAt ? dateFormatter.format(new Date(detail.quest.dueAt)) : t("common.none")}</dd></div>
                                <div><FolderKanban size={16} /><dt>{t("work.space")}</dt><dd>{spaceNames.get(detail.quest.spaceId ?? "") ?? t("people.global")}</dd></div>
                                <div><CheckSquare2 size={16} /><dt>{t("work.version")}</dt><dd>v{detail.quest.version}</dd></div>
                              </dl>
                              <div className="work-assignment-band">
                                {detail.quest.assigneeIdentityId && directory?.identities.find((identity) => identity.id === detail.quest.assigneeIdentityId)?.kind === "agent" ? <Bot size={18} /> : <UserRound size={18} />}
                                <AssignmentSelect kind="quest" item={detail.quest} directory={directory} disabled={busy || !detail.quest.capabilities.assign} onChange={assign} />
                              </div>
                              <section className="work-evidence">
                                <h3><BookOpen size={16} />{t("work.evidence")}</h3>
                                {!detail.quest.sourceIds.length ? <p>{t("work.noEvidence")}</p> : (
                                  <div>{detail.quest.sourceIds.map((sourceId) => <button className="text-button" type="button" key={sourceId} onClick={() => onOpenKnowledge(sourceId)}>{sourceId}</button>)}</div>
                                )}
                              </section>
                              <section className="work-steps">
                                <div className="section-heading-row">
                                  <h3>{t("work.steps")}</h3>
                                  {detail.quest.capabilities.addChild && directory ? <button className="secondary-button" type="button" onClick={() => setCreateKind("step")}><Plus size={16} />{t("work.createStep")}</button> : null}
                                </div>
                                {!detail.steps.length ? <p className="compact-empty">{t("work.emptySteps")}</p> : (
                                  <div className="work-step-list">
                                    {detail.steps.map((step) => (
                                      <div className="work-step-row" key={step.id}>
                                        <StatusSelect kind="step" id={step.id} version={step.version} status={step.status} disabled={busy || !step.capabilities.changeStatus} onChange={changeStatus} />
                                        <div><strong>{step.title}</strong><p>{step.description}</p></div>
                                        <AssignmentSelect kind="step" item={step} directory={directory} disabled={busy || !step.capabilities.assign} onChange={assign} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>
                              <CommentsPanel
                                key={`quest-${detail.quest.id}`}
                                api={api}
                                subjectType="quest"
                                subjectId={detail.quest.id}
                                identities={directory?.identities ?? []}
                              />
                            </>
                          )}
                    </article>
                  </div>
                )}
          </section>
        </>
      )}
      {createKind && directory ? (
        <WorkEditorDialog
          api={api}
          directory={directory}
          kind={createKind}
          parentId={createKind === "project" ? selectedGoalId : createKind === "quest" ? selectedProjectId : createKind === "step" ? selectedQuestId : null}
          parentSpaceId={createKind === "project" ? selectedGoal?.spaceId ?? null : createKind === "quest" ? selectedProject?.spaceId ?? null : null}
          onCreated={created}
          onClose={() => setCreateKind(null)}
        />
      ) : null}
    </>
  );
}
