import { Check, ClipboardCheck, LogOut, Plus, UserRoundCheck, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { OnboardingRequirement } from "@guild-os/domain";
import type {
  GuildUiApi,
  UiDirectory,
  UiLifecyclePage,
} from "../../src/management-types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

export function LifecyclePage({ api, directory }: { api: GuildUiApi; directory: UiDirectory | null }) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiLifecyclePage | null>(null);
  const [createPathOpen, setCreatePathOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actorNames = useMemo(() => new Map(directory?.identities.map((actor) =>
    [actor.id, actor.displayName]) ?? []), [directory?.identities]);
  const roleNames = useMemo(() => new Map(directory?.roles.map((role) =>
    [role.id, role.name]) ?? []), [directory?.roles]);
  const spaceNames = useMemo(() => new Map(directory?.spaces.map((space) =>
    [space.id, space.name]) ?? []), [directory?.spaces]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  async function load() {
    setError(null);
    try {
      setPage(await api.getLifecyclePage());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function completeRequirement(assignmentId: string, requirementId: string) {
    setBusy(requirementId);
    setError(null);
    try {
      await api.completeOnboardingRequirement({ assignmentId, requirementId, evidence: t("lifecycle.selfAcknowledgement") });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function completeHandover(caseId: string, itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      await api.completeHandoverItem({ caseId, itemId, disposition: "transfer", note: t("lifecycle.handoverConfirmed") });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("lifecycle.title")}
        subtitle={t("lifecycle.subtitle")}
        action={page?.canManage ? (
          <div className="action-group">
            <button className="secondary-button" type="button" onClick={() => setAssignOpen(true)} disabled={page.paths.length === 0 || page.preboardingActors.length === 0}><UserRoundCheck size={17} />{t("lifecycle.assign")}</button>
            <button className="primary-button" type="button" onClick={() => setCreatePathOpen(true)}><Plus size={17} />{t("lifecycle.createPath")}</button>
          </div>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {!page ? <p className="empty-state">{t("common.loading")}</p> : null}
      {page?.myAssignments.map((assignment) => (
        <section className="content-section onboarding-self" key={assignment.assignment.id}>
          <div className="section-heading-row"><div><h2>{t("lifecycle.yourOnboarding")}</h2><p>{assignment.path.name}</p></div><span className={`status-pill status-${assignment.assignment.status}`}>{t(`lifecycle.status.${assignment.assignment.status}`)}</span></div>
          <div className="onboarding-progress"><span style={{ width: `${Math.round(assignment.requirements.filter((item) => item.completedAt).length / Math.max(1, assignment.requirements.length) * 100)}%` }} /></div>
          <div className="requirement-list">
            {assignment.requirements.map((requirement) => (
              <article className="requirement-row" key={requirement.id}>
                <span className={requirement.completedAt ? "requirement-check requirement-complete" : "requirement-check"}>{requirement.completedAt ? <Check size={16} /> : requirement.position + 1}</span>
                <div><strong>{requirement.title}</strong><p>{requirement.instructions}</p></div>
                {requirement.completedAt ? <small>{formatter.format(new Date(requirement.completedAt))}</small> : <button className="primary-button" type="button" disabled={busy === requirement.id} onClick={() => void completeRequirement(assignment.assignment.id, requirement.id)}>{t("lifecycle.complete")}</button>}
              </article>
            ))}
          </div>
        </section>
      ))}
      {page?.canManage ? (
        <>
          <section className="content-section">
            <div className="section-heading-row compact-heading"><h2>{t("lifecycle.assignments")}</h2><span>{page.assignments.length}</span></div>
            {page.assignments.length === 0 ? <p className="empty-state">{t("lifecycle.noAssignments")}</p> : <div className="data-table lifecycle-table">
              <div className="data-table-head"><span>{t("lifecycle.member")}</span><span>{t("lifecycle.path")}</span><span>{t("lifecycle.progress")}</span><span>{t("people.status")}</span></div>
              {page.assignments.map((assignment) => <article className="data-row" key={assignment.id}><strong>{assignment.actorDisplayName}</strong><span>{assignment.pathName}</span><span>{assignment.completedRequirementCount}/{assignment.totalRequirementCount}</span><span className={`status-pill status-${assignment.status}`}>{t(`lifecycle.status.${assignment.status}`)}</span></article>)}
            </div>}
          </section>
          <section className="content-section">
            <div className="section-heading-row compact-heading"><h2>{t("lifecycle.paths")}</h2><span>{page.paths.length}</span></div>
            <div className="lifecycle-path-grid">{page.paths.map((path) => <article className="lifecycle-path" key={path.id}><ClipboardCheck size={20} /><div><strong>{path.name}</strong><p>{path.description}</p><small>{path.spaceId ? spaceNames.get(path.spaceId) ?? t("common.unknown") : t("lifecycle.allSpaces")} · {(path.applicableRoleIds?.length ?? 0) > 0 ? path.applicableRoleIds!.map((roleId) => roleNames.get(roleId) ?? t("common.unknown")).join(", ") : t("lifecycle.allRoles")} · {t("lifecycle.requirementCount", { count: path.requirements.length })}</small></div></article>)}</div>
          </section>
          <section className="content-section">
            <div className="section-heading-row compact-heading"><h2>{t("lifecycle.handovers")}</h2><span>{page.handovers.length}</span></div>
            {page.handovers.length === 0 ? <EmptyState icon={LogOut} title={t("lifecycle.noHandoversTitle")} description={t("lifecycle.noHandovers")} /> : <div className="handover-list">{page.handovers.map((handover) => (
              <article className="handover-case" key={handover.id}>
                <header><div><strong>{actorNames.get(handover.departingActorId) ?? t("common.unknown")}</strong><span>{t("lifecycle.toSuccessor")} {handover.successorActorId ? actorNames.get(handover.successorActorId) ?? t("common.unknown") : t("lifecycle.noSuccessor")}</span></div><span className={`status-pill status-${handover.status}`}>{t(`lifecycle.handoverStatus.${handover.status}`)}</span></header>
                <p>{handover.reason}</p>
                <div className="handover-items">{handover.items.map((item) => <div key={item.id}><span><strong>{item.title}</strong><small>{t(`lifecycle.resource.${item.resourceType}`)}</small></span>{item.status === "pending" ? <button className="secondary-button" type="button" disabled={busy === item.id} onClick={() => void completeHandover(handover.id, item.id)}><Check size={16} />{t("lifecycle.confirmTransfer")}</button> : <span className="status-pill status-completed">{t("lifecycle.completed")}</span>}</div>)}</div>
              </article>
            ))}</div>}
          </section>
        </>
      ) : null}
      {createPathOpen && page ? <OnboardingPathDialog directory={directory} onClose={() => setCreatePathOpen(false)} onCreate={async (input) => { await api.createOnboardingPath(input); setCreatePathOpen(false); await load(); }} /> : null}
      {assignOpen && page ? <AssignOnboardingDialog page={page} onClose={() => setAssignOpen(false)} onAssign={async (input) => { await api.assignOnboarding(input); setAssignOpen(false); await load(); }} /> : null}
    </>
  );
}

type RequirementDraft = {
  kind: OnboardingRequirement["kind"];
  resourceId: string;
  title: string;
  instructions: string;
  required: boolean;
};

function OnboardingPathDialog({ directory, onClose, onCreate }: {
  directory: UiDirectory | null;
  onClose(): void;
  onCreate(input: Parameters<GuildUiApi["createOnboardingPath"]>[0]): Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<RequirementDraft[]>([{ kind: "checklist", resourceId: "", title: "", instructions: "", required: true }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await onCreate({ name, description, spaceId: spaceId || null, roleIds, requirements: requirements.map((requirement) => ({ ...requirement, resourceId: requirement.kind === "checklist" ? null : requirement.resourceId })) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.generic")); setBusy(false); }
  }

  return <div className="dialog-backdrop" role="presentation"><section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="path-dialog-title"><header className="dialog-header"><h2 id="path-dialog-title">{t("lifecycle.createPath")}</h2><button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header><form className="stack-form" onSubmit={(event) => void submit(event)}><label><span>{t("lifecycle.pathName")}</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>{t("lifecycle.pathDescription")}</span><textarea rows={3} maxLength={10_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="form-grid"><label><span>{t("lifecycle.scopeSpace")}</span><select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}><option value="">{t("lifecycle.allSpaces")}</option>{directory?.spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label><fieldset><legend>{t("lifecycle.scopeRoles")}</legend><div className="check-list lifecycle-role-scope">{directory?.roles.map((role) => <label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} onChange={(event) => setRoleIds((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} /><span>{role.name}</span></label>)}</div><small>{t("lifecycle.allRolesHelp")}</small></fieldset></div><fieldset><legend>{t("lifecycle.requirements")}</legend><div className="requirement-editor">{requirements.map((requirement, index) => <div key={index} className="requirement-editor-row"><select value={requirement.kind} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as OnboardingRequirement["kind"], resourceId: "" } : item))}><option value="checklist">{t("lifecycle.requirement.checklist")}</option><option value="memory">{t("lifecycle.requirement.memory")}</option><option value="activity">{t("lifecycle.requirement.activity")}</option><option value="acknowledgement">{t("lifecycle.requirement.acknowledgement")}</option></select><input required maxLength={200} value={requirement.title} placeholder={t("lifecycle.requirementTitle")} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />{requirement.kind !== "checklist" ? <input required value={requirement.resourceId} placeholder={t("lifecycle.resourceId")} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, resourceId: event.target.value } : item))} /> : null}<textarea rows={2} maxLength={10_000} value={requirement.instructions} placeholder={t("lifecycle.instructions")} onChange={(event) => setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item))} /><button className="icon-button" type="button" title={t("common.remove")} aria-label={t("common.remove")} disabled={requirements.length === 1} onClick={() => setRequirements((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}</div><button className="text-button" type="button" onClick={() => setRequirements((current) => [...current, { kind: "checklist", resourceId: "", title: "", instructions: "", required: true }])}><Plus size={16} />{t("lifecycle.addRequirement")}</button></fieldset>{error ? <Notice kind="error">{error}</Notice> : null}<footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || !name.trim()}>{t("common.create")}</button></footer></form></section></div>;
}

function AssignOnboardingDialog({ page, onClose, onAssign }: {
  page: UiLifecyclePage;
  onClose(): void;
  onAssign(input: Parameters<GuildUiApi["assignOnboarding"]>[0]): Promise<void>;
}) {
  const { t } = useI18n();
  const [actorId, setActorId] = useState(page.preboardingActors[0]?.id ?? "");
  const [pathId, setPathId] = useState(page.paths[0]?.id ?? "");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await onAssign({ actorId, pathId, dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null }); } catch (cause) { setError(cause instanceof Error ? cause.message : t("error.generic")); setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="assign-onboarding-title"><header className="dialog-header"><h2 id="assign-onboarding-title">{t("lifecycle.assign")}</h2><button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header><form className="stack-form" onSubmit={(event) => void submit(event)}><label><span>{t("lifecycle.member")}</span><select value={actorId} onChange={(event) => setActorId(event.target.value)}>{page.preboardingActors.map((actor) => <option value={actor.id} key={actor.id}>{actor.displayName}</option>)}</select></label><label><span>{t("lifecycle.path")}</span><select value={pathId} onChange={(event) => setPathId(event.target.value)}>{page.paths.map((path) => <option value={path.id} key={path.id}>{path.name}</option>)}</select></label><label><span>{t("lifecycle.dueDate")}</span><input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>{error ? <Notice kind="error">{error}</Notice> : null}<footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busy || !actorId || !pathId}>{t("lifecycle.assign")}</button></footer></form></section></div>;
}
