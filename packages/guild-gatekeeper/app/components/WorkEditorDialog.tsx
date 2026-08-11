import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CLASSIFICATIONS,
  VISIBILITIES,
  type Classification,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateGoalRequest,
  CreateProjectRequest,
  CreateQuestRequest,
  CreateStepRequest,
  GuildUiApi,
  UiDirectory,
} from "../../src/management-types";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";
import { Notice } from "./Notice";

export type WorkCreateKind = "goal" | "project" | "quest" | "step";

interface WorkEditorDialogProps {
  api: GuildUiApi;
  directory: UiDirectory;
  kind: WorkCreateKind;
  parentId: string | null;
  parentSpaceId: string | null;
  onCreated(id: string): Promise<void>;
  onClose(): void;
}

function toTimestamp(value: string): string | null {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

export function WorkEditorDialog({
  api,
  directory,
  kind,
  parentId,
  parentSpaceId,
  onCreated,
  onClose,
}: WorkEditorDialogProps) {
  const { t } = useI18n();
  const activeSpaces = useMemo(() => {
    const byId = new Map(directory.spaces.map((space) => [space.id, space]));
    return directory.spaces.filter((space) => {
      if (space.status !== "active" || parentSpaceId === null) return space.status === "active";
      let cursor: typeof space | undefined = space;
      while (cursor) {
        if (cursor.id === parentSpaceId) return true;
        cursor = cursor.parentSpaceId ? byId.get(cursor.parentSpaceId) : undefined;
      }
      return false;
    });
  }, [directory.spaces, parentSpaceId]);
  const assignees = useMemo(() => directory.identities.filter((identity) =>
    identity.kind !== "service" && identity.status === "active" &&
    identity.membershipState === "active"), [directory.identities]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spaceId, setSpaceId] = useState(parentSpaceId ?? activeSpaces[0]?.id ?? "");
  const [visibility, setVisibility] = useState<Visibility>(spaceId ? "space" : "guild");
  const [classification, setClassification] = useState<Classification>("internal");
  const [allowedIdentityIds, setAllowedIdentityIds] = useState<ReadonlySet<string>>(new Set());
  const [sourceText, setSourceText] = useState("");
  const [date, setDate] = useState("");
  const [assigneeIdentityId, setAssigneeIdentityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullResource = kind !== "step";
  const showExplicitAccess = visibility === "restricted" || visibility === "private";
  const dialogTitle = {
    goal: t("work.createGoalTitle"),
    project: t("work.createProjectTitle"),
    quest: t("work.createQuestTitle"),
    step: t("work.createStepTitle"),
  }[kind];

  function toggleIdentity(identityId: string): void {
    setAllowedIdentityIds((current) => {
      const next = new Set(current);
      if (next.has(identityId)) next.delete(identityId);
      else next.add(identityId);
      return next;
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let id: string;
      if (kind === "step") {
        if (!parentId) throw new Error(t("work.selectQuest"));
        const input: CreateStepRequest = {
          questId: parentId,
          title,
          description,
          assigneeIdentityId: assigneeIdentityId || null,
        };
        id = await api.createStep(input);
      } else {
        const resource = {
          spaceId: spaceId || null,
          title,
          description,
          visibility,
          classification,
          allowedIdentityIds: showExplicitAccess ? [...allowedIdentityIds] : [],
          sourceIds: [...new Set(sourceText.split("\n").map((value) => value.trim()).filter(Boolean))],
        };
        if (kind === "goal") {
          const input: CreateGoalRequest = { ...resource, targetAt: toTimestamp(date) };
          id = await api.createGoal(input);
        } else if (kind === "project") {
          if (!parentId) throw new Error(t("work.selectGoal"));
          const input: CreateProjectRequest = {
            ...resource,
            goalId: parentId,
            dueAt: toTimestamp(date),
          };
          id = await api.createProject(input);
        } else {
          if (!parentId) throw new Error(t("work.selectProject"));
          const input: CreateQuestRequest = {
            ...resource,
            projectId: parentId,
            assigneeIdentityId: assigneeIdentityId || null,
            dueAt: toTimestamp(date),
          };
          id = await api.createQuest(input);
        }
      }
      await onCreated(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="work-editor-title">
        <header className="dialog-header">
          <h2 id="work-editor-title">{dialogTitle}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("work.titleLabel")}</span>
            <input required maxLength={200} value={title} placeholder={t("work.titlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>{t("work.descriptionLabel")}</span>
            <textarea rows={4} maxLength={10_000} value={description} placeholder={t("work.descriptionPlaceholder")} onChange={(event) => setDescription(event.target.value)} />
          </label>
          {fullResource ? (
            <>
              <div className="form-grid">
                <label>
                  <span>{t("work.space")}</span>
                  <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                    <option value="">{t("people.global")}</option>
                    {activeSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>{kind === "goal" ? t("work.targetDate") : t("work.dueDate")}</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  <span>{t("work.visibility")}</span>
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                    {VISIBILITIES.map((value) => <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("work.classification")}</span>
                  <select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
                    {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}
                  </select>
                </label>
              </div>
              {showExplicitAccess ? (
                <fieldset>
                  <legend>{t("work.sharedWith")}</legend>
                  <div className="permission-grid">
                    {directory.identities.map((identity) => (
                      <label className="checkbox-row" key={identity.id}>
                        <input type="checkbox" checked={allowedIdentityIds.has(identity.id)} onChange={() => toggleIdentity(identity.id)} />
                        <span>{identity.displayName}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <label>
                <span>{t("work.sources")}</span>
                <textarea rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
                <small>{t("work.sourcesHelp")}</small>
              </label>
            </>
          ) : null}
          {kind === "quest" || kind === "step" ? (
            <label>
              <span>{t("work.assignee")}</span>
              <select value={assigneeIdentityId} onChange={(event) => setAssigneeIdentityId(event.target.value)}>
                <option value="">{t("work.unassigned")}</option>
                {assignees.map((identity) => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}
              </select>
            </label>
          ) : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>
              <Plus size={17} />{t("common.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
