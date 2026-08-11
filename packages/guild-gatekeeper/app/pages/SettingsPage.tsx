import { Database, KeyRound, Languages, LockKeyhole, ShieldCheck } from "lucide-react";
import type { AppLocale } from "@guild-os/domain";
import { useState } from "react";
import type {
  CreateRoleRequest,
  CreateSpaceRequest,
  UiBootstrapState,
  UiDirectory,
  UpdateConstitutionRequest,
  UpdateRoleRequest,
} from "../../src/management-types";
import { ConstitutionManager } from "../components/ConstitutionManager";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { RoleManager } from "../components/RoleManager";
import { SpaceManager } from "../components/SpaceManager";
import { useI18n } from "../i18n";

export function SettingsPage({
  bootstrap,
  directory,
  onLocaleChange,
  onUpdateConstitution,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
  onCreateSpace,
  onRenameSpace,
  onArchiveSpace,
}: {
  bootstrap: UiBootstrapState;
  directory: UiDirectory | null;
  onLocaleChange(locale: AppLocale): Promise<void>;
  onUpdateConstitution(input: UpdateConstitutionRequest): Promise<void>;
  onCreateRole(input: CreateRoleRequest): Promise<void>;
  onUpdateRole(input: UpdateRoleRequest): Promise<void>;
  onDeleteRole(roleId: string): Promise<void>;
  onCreateSpace(input: CreateSpaceRequest): Promise<void>;
  onRenameSpace(spaceId: string, name: string): Promise<void>;
  onArchiveSpace(spaceId: string): Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeLocale(nextLocale: AppLocale) {
    setLocale(nextLocale);
    setSaved(false);
    setError(null);
    try {
      await onLocaleChange(nextLocale);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    }
  }

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <section className="content-section settings-section">
        <div className="section-heading-row">
          <Languages size={19} />
          <div><h2>{t("settings.languageTitle")}</h2><p>{t("settings.languageDescription")}</p></div>
        </div>
        <label className="field-inline">
          <span>{t("language.label")}</span>
          <select value={locale} onChange={(event) => void changeLocale(event.target.value as AppLocale)}>
            <option value="en">{t("language.en")}</option>
            <option value="ja">{t("language.ja")}</option>
            <option value="zh-CN">{t("language.zh-CN")}</option>
          </select>
        </label>
        {saved ? <Notice kind="success">{t("toast.saved")}</Notice> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
      </section>

      <ConstitutionManager
        constitution={bootstrap.constitution}
        rootOwner={bootstrap.rootOwner}
        onUpdate={onUpdateConstitution}
      />

      {directory ? (
        <>
          <RoleManager directory={directory} onCreate={onCreateRole} onUpdate={onUpdateRole} onDelete={onDeleteRole} />
          <SpaceManager directory={directory} onCreate={onCreateSpace} onRename={onRenameSpace} onArchive={onArchiveSpace} />
        </>
      ) : null}

      <section className="content-section settings-section">
        <div className="section-heading-row">
          <ShieldCheck size={19} />
          <div><h2>{t("settings.securityTitle")}</h2></div>
        </div>
        <div className="definition-list">
          <div><KeyRound size={18} /><dt>{t("settings.auth")}</dt><dd>{t("settings.authValue")}</dd></div>
          <div><LockKeyhole size={18} /><dt>{t("settings.authorization")}</dt><dd>{t("settings.authorizationValue")}</dd></div>
          <div><Database size={18} /><dt>{t("settings.storage")}</dt><dd>{t("settings.storageValue")}</dd></div>
          <div><ShieldCheck size={18} /><dt>{t("settings.owner")}</dt><dd>{t("settings.ownerValue")}</dd></div>
        </div>
      </section>
    </>
  );
}
