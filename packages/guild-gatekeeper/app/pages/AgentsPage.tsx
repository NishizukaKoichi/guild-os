import { Bot, LogOut, Plus, RotateCcw, ShieldPlus, Square } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AssignRoleRequest,
  CreateAgentRequest,
  GuildUiApi,
  UiMemberBootstrapState,
  UiDirectory,
  UiDirectoryIdentity,
} from "../../src/management-types";
import { AgentDialog } from "../components/AgentDialog";
import { AgentRunsPanel } from "../components/AgentRunsPanel";
import { IdentityRoleDialog } from "../components/IdentityRoleDialog";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { classificationTranslationKey, membershipTranslationKey, useI18n } from "../i18n";

export function AgentsPage({
  api,
  bootstrap,
  directory,
  onCreate,
  onMembershipChange,
  onAssignRole,
  onRemoveRole,
}: {
  api: GuildUiApi;
  bootstrap: UiMemberBootstrapState;
  directory: UiDirectory;
  onCreate(input: CreateAgentRequest): Promise<void>;
  onMembershipChange(identityId: string, nextState: "active" | "suspended" | "departed"): Promise<void>;
  onAssignRole(input: AssignRoleRequest): Promise<void>;
  onRemoveRole(bindingId: string): Promise<void>;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [roleIdentity, setRoleIdentity] = useState<UiDirectoryIdentity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agents = directory.identities.filter((identity) => identity.kind === "agent");
  const profiles = useMemo(() => new Map(directory.agentProfiles.map((profile) =>
    [profile.identityId, profile])), [directory.agentProfiles]);
  const roles = useMemo(() => new Map(directory.roles.map((role) => [role.id, role.name])), [directory.roles]);
  const spaces = useMemo(() => new Map(directory.spaces.map((space) => [space.id, space.name])), [directory.spaces]);

  async function change(identity: UiDirectoryIdentity, nextState: "active" | "suspended" | "departed") {
    if (nextState === "suspended" && !window.confirm(t("agents.confirmStop"))) return;
    if (nextState === "departed" && !window.confirm(t("agents.confirmDepart"))) return;
    setBusy(identity.id);
    setError(null);
    try {
      await onMembershipChange(identity.id, nextState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("agents.title")}
        subtitle={t("agents.subtitle")}
        action={directory.capabilities.manageAgents && directory.capabilities.manageRoles ? (
          <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={17} />{t("agents.create")}
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {agents.length === 0 ? <section className="content-section"><p className="empty-state">{t("agents.noAgents")}</p></section> : (
        <section className="content-section agent-list">
          <div className="agent-list-head" aria-hidden="true">
            <span>{t("agents.name")}</span>
            <span>{t("agents.model")}</span>
            <span>{t("agents.scope")}</span>
            <span>{t("agents.limits")}</span>
            <span>{t("people.status")}</span>
            <span>{t("people.actions")}</span>
          </div>
          {agents.map((identity) => {
            const profile = profiles.get(identity.id);
            const bindings = directory.roleBindings.filter((binding) => binding.identityId === identity.id);
            return (
              <article className="agent-row" key={identity.id}>
                <div className="identity-cell agent-identity">
                  <span className="identity-avatar agent-avatar" aria-hidden="true"><Bot size={17} /></span>
                  <div>
                    <strong>{identity.displayName}</strong>
                    <small>{t(classificationTranslationKey(identity.clearance))}</small>
                  </div>
                </div>
                <div className="agent-detail" data-label={t("agents.model")}>
                  <strong>{profile?.model ?? t("common.unknown")}</strong>
                  <small>{profile ? t(`agent.${profile.status}`) : t("agents.profileMissing")}</small>
                </div>
                <div className="agent-detail" data-label={t("agents.scope")}>
                  {bindings.length === 0 ? <span>{t("people.noRole")}</span> : bindings.map((binding) => (
                    <span key={binding.id}>{roles.get(binding.roleId) ?? t("common.unknown")} · {binding.spaceId ? spaces.get(binding.spaceId) ?? t("common.unknown") : t("people.global")}</span>
                  ))}
                </div>
                <div className="agent-detail" data-label={t("agents.limits")}>
                  {profile ? (
                    <>
                      <span>{profile.limits.maxBudgetMinor} {profile.limits.currency}</span>
                      <small>{profile.limits.maxSteps} {t("agents.steps")} · {profile.limits.maxDurationSeconds}s</small>
                    </>
                  ) : <span>{t("common.unknown")}</span>}
                </div>
                <div className="agent-detail" data-label={t("people.status")}>
                  <span className={`status-pill status-${identity.membershipState}`}>{t(membershipTranslationKey(identity.membershipState))}</span>
                </div>
                <div className="row-actions agent-actions">
                  {directory.capabilities.manageRoles ? (
                    <button className="icon-button" type="button" title={t("people.manageRoles")} aria-label={t("people.manageRoles")} onClick={() => setRoleIdentity(identity)}>
                      <ShieldPlus size={17} />
                    </button>
                  ) : null}
                  {directory.capabilities.stopAgents && identity.membershipState === "active" ? (
                    <button className="text-button" type="button" disabled={busy === identity.id} onClick={() => void change(identity, "suspended")}>
                      <Square size={15} />{t("agents.stop")}
                    </button>
                  ) : null}
                  {directory.capabilities.stopAgents && identity.membershipState === "suspended" ? (
                    <>
                      <button className="text-button" type="button" disabled={busy === identity.id} onClick={() => void change(identity, "active")}>
                        <RotateCcw size={15} />{t("agents.restore")}
                      </button>
                      <button className="icon-button danger-button" type="button" disabled={busy === identity.id} title={t("agents.depart")} aria-label={t("agents.depart")} onClick={() => void change(identity, "departed")}>
                        <LogOut size={17} />
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}
      <AgentRunsPanel api={api} directory={directory} />
      {createOpen ? (
        <AgentDialog directory={directory} defaults={bootstrap.agentDefaults} onCreate={onCreate} onClose={() => setCreateOpen(false)} />
      ) : null}
      {roleIdentity ? (
        <IdentityRoleDialog
          directory={directory}
          identity={roleIdentity}
          onAssign={onAssignRole}
          onRemove={onRemoveRole}
          onClose={() => setRoleIdentity(null)}
        />
      ) : null}
    </>
  );
}
