import { Archive, FolderTree, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import type { CreateSpaceRequest, UiDirectory, UiDirectorySpace } from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function SpaceDialog({
  directory,
  space,
  onSave,
  onClose,
}: {
  directory: UiDirectory;
  space: UiDirectorySpace | null;
  onSave(input: CreateSpaceRequest | { spaceId: string; name: string }): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const activeSpaces = directory.spaces.filter((candidate) => candidate.status === "active");
  const [name, setName] = useState(space?.name ?? "");
  const [parentSpaceId, setParentSpaceId] = useState(activeSpaces[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(space ? { spaceId: space.id, name } : { parentSpaceId, name });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="space-dialog-title">
        <header className="dialog-header">
          <h2 id="space-dialog-title">{t(space ? "settings.editSpace" : "settings.createSpace")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("settings.spaceName")}</span>
            <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {!space ? (
            <label>
              <span>{t("settings.parentSpace")}</span>
              <select required value={parentSpaceId} onChange={(event) => setParentSpaceId(event.target.value)}>
                {activeSpaces.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
          ) : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || (!space && !parentSpaceId)}>{t("common.save")}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function SpaceManager({
  directory,
  onCreate,
  onRename,
  onArchive,
}: {
  directory: UiDirectory;
  onCreate(input: CreateSpaceRequest): Promise<void>;
  onRename(spaceId: string, name: string): Promise<void>;
  onArchive(spaceId: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<UiDirectorySpace | "create" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map(directory.spaces.map((space) => [space.id, space.name]));

  async function archive(space: UiDirectorySpace) {
    if (!window.confirm(t("settings.confirmArchiveSpace"))) return;
    setBusy(space.id);
    setError(null);
    try {
      await onArchive(space.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="content-section settings-section">
      <div className="section-heading-row manager-heading">
        <FolderTree size={19} />
        <div><h2>{t("settings.spacesTitle")}</h2><p>{t("settings.spacesDescription")}</p></div>
        {directory.capabilities.manageSpaces ? (
          <button className="secondary-button" type="button" onClick={() => setDialog("create")}><Plus size={16} />{t("settings.createSpace")}</button>
        ) : null}
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div className="manager-list">
        {directory.spaces.map((space) => (
          <article className="manager-row" key={space.id}>
            <div>
              <strong>{space.name}</strong>
              <small>{space.parentSpaceId ? names.get(space.parentSpaceId) ?? t("common.unknown") : t("settings.rootSpace")}</small>
            </div>
            <span className={`status-pill status-${space.status === "active" ? "active" : "departed"}`}>{t(`space.${space.status}`)}</span>
            <div className="row-actions">
              {directory.capabilities.manageSpaces && space.status === "active" ? (
                <>
                  <button className="icon-button" type="button" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => setDialog(space)}><Pencil size={16} /></button>
                  {space.parentSpaceId ? (
                    <button className="icon-button danger-button" type="button" disabled={busy === space.id} title={t("common.archive")} aria-label={t("common.archive")} onClick={() => void archive(space)}><Archive size={16} /></button>
                  ) : null}
                </>
              ) : <span className="muted-dash">-</span>}
            </div>
          </article>
        ))}
      </div>
      {dialog ? (
        <SpaceDialog
          directory={directory}
          space={dialog === "create" ? null : dialog}
          onSave={async (input) => {
            if ("spaceId" in input) await onRename(input.spaceId, input.name);
            else await onCreate(input);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
