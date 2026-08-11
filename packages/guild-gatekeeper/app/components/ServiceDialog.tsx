import { ServerCog, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CLASSIFICATIONS, HUMAN_ONLY_PERMISSIONS, type Classification } from "@guild-os/domain";
import type { CreateServiceRequest, UiDirectory } from "../../src/management-types";
import { classificationTranslationKey, useI18n } from "../i18n";
import { Notice } from "./Notice";

export function ServiceDialog({
  directory,
  onCreate,
  onClose,
}: {
  directory: UiDirectory;
  onCreate(input: CreateServiceRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const roles = useMemo(() => directory.roles.filter((role) =>
    !role.permissions.some((permission) => HUMAN_ONLY_PERMISSIONS.has(permission))), [directory.roles]);
  const [displayName, setDisplayName] = useState("");
  const [clearance, setClearance] = useState<Classification>("internal");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ displayName, clearance, roleId, spaceId: spaceId || null });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="service-dialog-title">
        <header className="dialog-header">
          <h2 id="service-dialog-title">{t("people.serviceTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("people.serviceName")}</span>
            <input required maxLength={200} value={displayName} placeholder={t("people.serviceNamePlaceholder")} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("people.clearance")}</span>
              <select value={clearance} onChange={(event) => setClearance(event.target.value as Classification)}>
                {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}
              </select>
            </label>
            <label>
              <span>{t("people.role")}</span>
              <select required value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>{t("people.space")}</span>
            <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
              <option value="">{t("people.global")}</option>
              {directory.spaces.filter((space) => space.status === "active").map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !roleId}>
              <ServerCog size={17} />{t("people.createService")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
