import { Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ROOT_ONLY_PERMISSIONS, type Permission } from "@guild-os/domain";
import type {
  CreateRoleRequest,
  UiDirectory,
  UiDirectoryRole,
  UpdateRoleRequest,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function RoleDialog({
  directory,
  role,
  onSave,
  onClose,
}: {
  directory: UiDirectory;
  role: UiDirectoryRole | null;
  onSave(input: CreateRoleRequest | UpdateRoleRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(role?.name ?? "");
  const [selected, setSelected] = useState<ReadonlySet<Permission>>(
    new Set(role?.permissions ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permissions = directory.grantablePermissions.filter((permission) =>
    !ROOT_ONLY_PERMISSIONS.has(permission));

  function toggle(permission: Permission) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = { name, permissions: [...selected] };
      await onSave(role ? { ...input, roleId: role.id } : input);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="role-dialog-title">
        <header className="dialog-header">
          <h2 id="role-dialog-title">{t(role ? "settings.editRole" : "settings.createRole")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("settings.roleName")}</span>
            <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <fieldset>
            <legend>{t("settings.permissions")}</legend>
            <div className="permission-grid">
              {permissions.map((permission) => (
                <label key={permission} className="checkbox-row">
                  <input type="checkbox" checked={selected.has(permission)} onChange={() => toggle(permission)} />
                  <code>{permission}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || selected.size === 0}>{t("common.save")}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function RoleManager({
  directory,
  onCreate,
  onUpdate,
  onDelete,
}: {
  directory: UiDirectory;
  onCreate(input: CreateRoleRequest): Promise<void>;
  onUpdate(input: UpdateRoleRequest): Promise<void>;
  onDelete(roleId: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<UiDirectoryRole | "create" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(role: UiDirectoryRole) {
    if (!window.confirm(t("settings.confirmDeleteRole"))) return;
    setBusy(role.id);
    setError(null);
    try {
      await onDelete(role.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="content-section settings-section">
      <div className="section-heading-row manager-heading">
        <ShieldCheck size={19} />
        <div><h2>{t("settings.rolesTitle")}</h2><p>{t("settings.rolesDescription")}</p></div>
        {directory.capabilities.manageRoles ? (
          <button className="secondary-button" type="button" onClick={() => setDialog("create")}><Plus size={16} />{t("settings.createRole")}</button>
        ) : null}
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div className="manager-list">
        {directory.roles.map((role) => (
          <article className="manager-row" key={role.id}>
            <div><strong>{role.name}</strong><small>{t(role.system ? "settings.systemRole" : "settings.customRole")}</small></div>
            <div className="permission-summary">
              {role.permissions.slice(0, 4).map((permission) => <code key={permission}>{permission}</code>)}
              {role.permissions.length > 4 ? <span>+{role.permissions.length - 4}</span> : null}
            </div>
            <div className="row-actions">
              {directory.capabilities.manageRoles && !role.system ? (
                <>
                  <button className="icon-button" type="button" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => setDialog(role)}><Pencil size={16} /></button>
                  <button className="icon-button danger-button" type="button" disabled={busy === role.id} title={t("common.delete")} aria-label={t("common.delete")} onClick={() => void remove(role)}><Trash2 size={16} /></button>
                </>
              ) : <span className="muted-dash">-</span>}
            </div>
          </article>
        ))}
      </div>
      {dialog ? (
        <RoleDialog
          directory={directory}
          role={dialog === "create" ? null : dialog}
          onSave={async (input) => {
            if ("roleId" in input) await onUpdate(input);
            else await onCreate(input);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </section>
  );
}
