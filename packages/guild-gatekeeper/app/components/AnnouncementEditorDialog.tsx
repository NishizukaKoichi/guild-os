import { Megaphone, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CLASSIFICATIONS,
  VISIBILITIES,
  type Classification,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateAnnouncementRequest,
  GuildUiApi,
  SaveAnnouncementDraftRequest,
  UiAnnouncement,
  UiDirectory,
} from "../../src/management-types";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";
import { Notice } from "./Notice";

interface AnnouncementEditorDialogProps {
  api: GuildUiApi;
  directory: UiDirectory;
  announcement: UiAnnouncement | null;
  manageableSpaceIds: readonly string[];
  canCreateGuildWide: boolean;
  onSaved(announcementId: string): Promise<void>;
  onClose(): void;
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timestamp(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function AnnouncementEditorDialog({
  api,
  directory,
  announcement,
  manageableSpaceIds,
  canCreateGuildWide,
  onSaved,
  onClose,
}: AnnouncementEditorDialogProps) {
  const { t } = useI18n();
  const manageable = useMemo(() => new Set(manageableSpaceIds), [manageableSpaceIds]);
  const spaces = useMemo(
    () => directory.spaces.filter((space) =>
      space.status === "active" &&
      (manageable.has(space.id) || space.id === announcement?.spaceId)),
    [announcement?.spaceId, directory.spaces, manageable],
  );
  const defaultSpaceId = announcement?.spaceId ?? spaces[0]?.id ?? null;
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? "");
  const [targetRoleId, setTargetRoleId] = useState(announcement?.targetRoleId ?? "");
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [visibility, setVisibility] = useState<Visibility>(
    announcement?.visibility ?? (defaultSpaceId ? "space" : "guild"),
  );
  const [classification, setClassification] = useState<Classification>(
    announcement?.classification ?? "internal",
  );
  const [allowedIdentityIds, setAllowedIdentityIds] = useState<ReadonlySet<string>>(
    new Set(announcement?.allowedIdentityIds ?? []),
  );
  const [expiresAt, setExpiresAt] = useState(localDateTime(announcement?.expiresAt ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explicitAccess = visibility === "restricted" || visibility === "private";

  function selectSpace(nextSpaceId: string): void {
    setSpaceId(nextSpaceId);
    if (!nextSpaceId && visibility === "space") setVisibility("guild");
    if (nextSpaceId && visibility === "guild") setVisibility("space");
  }

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
      const input: CreateAnnouncementRequest = {
        spaceId: spaceId || null,
        targetRoleId: targetRoleId || null,
        title,
        body,
        visibility,
        classification,
        allowedIdentityIds: explicitAccess ? [...allowedIdentityIds] : [],
        expiresAt: timestamp(expiresAt),
      };
      let announcementId: string;
      if (announcement) {
        const update: SaveAnnouncementDraftRequest = {
          ...input,
          announcementId: announcement.id,
          expectedVersion: announcement.version,
        };
        await api.saveAnnouncementDraft(update);
        announcementId = announcement.id;
      } else {
        announcementId = await api.createAnnouncement(input);
      }
      await onSaved(announcementId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="announcement-editor-title">
        <header className="dialog-header">
          <h2 id="announcement-editor-title">
            {t(announcement ? "announcement.editTitle" : "announcement.createTitle")}
          </h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("announcement.title")}</span>
            <input required maxLength={200} value={title} placeholder={t("announcement.titlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>{t("announcement.body")}</span>
            <textarea required rows={7} maxLength={10_000} value={body} placeholder={t("announcement.bodyPlaceholder")} onChange={(event) => setBody(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("announcement.space")}</span>
              <select value={spaceId} onChange={(event) => selectSpace(event.target.value)}>
                {canCreateGuildWide ? <option value="">{t("announcement.guildWide")}</option> : null}
                {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("announcement.targetRole")}</span>
              <select value={targetRoleId} onChange={(event) => setTargetRoleId(event.target.value)}>
                <option value="">{t("announcement.allRoles")}</option>
                {directory.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>{t("announcement.visibility")}</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                {VISIBILITIES.filter((value) =>
                  (value !== "guild" || spaceId === "") &&
                  (value !== "space" || spaceId !== "")).map((value) => (
                    <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>
                  ))}
              </select>
            </label>
            <label>
              <span>{t("announcement.classification")}</span>
              <select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
                {CLASSIFICATIONS.map((value) => (
                  <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>
                ))}
              </select>
            </label>
          </div>
          {explicitAccess ? (
            <fieldset>
              <legend>{t("announcement.explicitAudience")}</legend>
              <div className="permission-grid">
                {directory.identities.filter((identity) => identity.status === "active").map((identity) => (
                  <label className="checkbox-row" key={identity.id}>
                    <input type="checkbox" checked={allowedIdentityIds.has(identity.id)} onChange={() => toggleIdentity(identity.id)} />
                    <span>{identity.displayName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label>
            <span>{t("announcement.expiry")}</span>
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            <small>{t("announcement.expiryHelp")}</small>
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || (!canCreateGuildWide && !spaceId)}>
              {announcement ? <Save size={17} /> : <Megaphone size={17} />}
              {t(announcement ? "common.save" : "common.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
