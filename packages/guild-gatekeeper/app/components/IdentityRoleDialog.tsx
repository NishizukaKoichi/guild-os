import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { HUMAN_ONLY_PERMISSIONS } from "@guild-os/domain";
import type {
  AssignRoleRequest,
  UiDirectory,
  UiDirectoryIdentity,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function IdentityRoleDialog({
  directory,
  identity,
  onAssign,
  onRemove,
  onClose,
}: {
  directory: UiDirectory;
  identity: UiDirectoryIdentity;
  onAssign(input: AssignRoleRequest): Promise<void>;
  onRemove(bindingId: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const compatibleRoles = useMemo(() => directory.roles.filter((role) =>
    identity.kind === "human" || !role.permissions.some((permission) =>
      HUMAN_ONLY_PERMISSIONS.has(permission))), [directory.roles, identity.kind]);
  const bindings = directory.roleBindings.filter((binding) => binding.identityId === identity.id);
  const roles = new Map(directory.roles.map((role) => [role.id, role.name]));
  const spaces = new Map(directory.spaces.map((space) => [space.id, space.name]));
  const [roleId, setRoleId] = useState(compatibleRoles[0]?.id ?? "");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!roleId) return;
    setBusy("assign");
    setError(null);
    try {
      await onAssign({ identityId: identity.id, roleId, spaceId: spaceId || null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(bindingId: string) {
    setBusy(bindingId);
    setError(null);
    try {
      await onRemove(bindingId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="role-assignment-title">
        <header className="dialog-header">
          <div>
            <h2 id="role-assignment-title">{t("people.roleDialogTitle")}</h2>
            <small>{identity.displayName}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <div className="stack-form">
          {error ? <Notice kind="error">{error}</Notice> : null}
          <fieldset>
            <legend>{t("people.assignedRoles")}</legend>
            {bindings.length === 0 ? <p className="empty-state compact-empty">{t("people.noRole")}</p> : (
              <div className="assignment-list">
                {bindings.map((binding) => (
                  <div key={binding.id}>
                    <span>{roles.get(binding.roleId) ?? t("common.unknown")}</span>
                    <small>{binding.spaceId ? spaces.get(binding.spaceId) ?? t("common.unknown") : t("people.global")}</small>
                    <button
                      className="icon-button danger-button"
                      type="button"
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                      disabled={busy !== null}
                      onClick={() => void remove(binding.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>{t("people.addRole")}</legend>
            <div className="form-grid">
              <label>
                <span>{t("people.role")}</span>
                <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                  {compatibleRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
              <label>
                <span>{t("people.space")}</span>
                <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                  <option value="">{t("people.global")}</option>
                  {directory.spaces.filter((space) => space.status === "active").map((space) => (
                    <option key={space.id} value={space.id}>{space.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.close")}</button>
            <button className="primary-button" type="button" disabled={busy !== null || !roleId} onClick={() => void assign()}>
              <Plus size={17} />{t("people.addRole")}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
