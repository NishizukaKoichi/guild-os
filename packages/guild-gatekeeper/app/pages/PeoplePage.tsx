import {
  Check,
  Bot,
  Clipboard,
  LogOut,
  Plus,
  RotateCcw,
  ServerCog,
  Shield,
  ShieldPlus,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AssignRoleRequest,
  CreateAgentRequest,
  CreateServiceRequest,
  GuildUiApi,
  IssueInvitationInput,
  IssuedInvitation,
  UiMemberBootstrapState,
  UiDirectory,
  UiDirectoryIdentity,
  UiCollectiveContext,
} from "../../src/management-types";
import { AgentDialog } from "../components/AgentDialog";
import { AgentRunsPanel } from "../components/AgentRunsPanel";
import { IdentityRoleDialog } from "../components/IdentityRoleDialog";
import { InviteDialog } from "../components/InviteDialog";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { ServiceDialog } from "../components/ServiceDialog";
import { actorKindLabel, membershipStateLabel } from "../collective-language";
import {
  invitationTranslationKey,
  useI18n,
} from "../i18n";

interface PeoplePageProps {
  api: GuildUiApi;
  bootstrap: UiMemberBootstrapState;
  collective: UiCollectiveContext;
  directory: UiDirectory;
  onIssue(input: IssueInvitationInput): Promise<IssuedInvitation>;
  onRevoke(invitationId: string): Promise<void>;
  onMembershipChange(
    identityId: string,
    nextState: "preboarding" | "active" | "suspended" | "departed",
  ): Promise<void>;
  onMachineMembershipChange(
    identityId: string,
    nextState: "active" | "suspended" | "departed",
  ): Promise<void>;
  onAssignRole(input: AssignRoleRequest): Promise<void>;
  onRemoveRole(bindingId: string): Promise<void>;
  onCreateService(input: CreateServiceRequest): Promise<void>;
  onCreateAgent(input: CreateAgentRequest): Promise<void>;
  onLoadMoreIdentities: (() => Promise<void>) | null;
  onLoadMoreInvitations: (() => Promise<void>) | null;
}

export function PeoplePage({
  api,
  bootstrap,
  collective,
  directory,
  onIssue,
  onRevoke,
  onMembershipChange,
  onMachineMembershipChange,
  onAssignRole,
  onRemoveRole,
  onCreateService,
  onCreateAgent,
  onLoadMoreIdentities,
  onLoadMoreInvitations,
}: PeoplePageProps) {
  const { locale, t } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | UiDirectoryIdentity["kind"]>("all");
  const [roleIdentity, setRoleIdentity] = useState<UiDirectoryIdentity | null>(null);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<"identities" | "invitations" | null>(null);
  const roles = useMemo(() => new Map(directory.roles.map((role) => [role.id, role.name])), [directory.roles]);
  const spaces = useMemo(() => new Map(directory.spaces.map((space) => [space.id, space.name])), [directory.spaces]);
  const profiles = useMemo(() => new Map(directory.agentProfiles.map((profile) => [profile.identityId, profile])), [directory.agentProfiles]);
  const operationalIdentities = useMemo(() => collective.template.key === "agent-collective"
    ? directory.identities.filter((identity) => identity.id !== bootstrap.rootOwnerIdentityId)
    : directory.identities, [bootstrap.rootOwnerIdentityId, collective.template.key, directory.identities]);
  const visibleIdentities = useMemo(() => kindFilter === "all"
    ? operationalIdentities
    : operationalIdentities.filter((identity) => identity.kind === kindFilter), [kindFilter, operationalIdentities]);
  const bindingsByIdentity = useMemo(() => {
    const map = new Map<string, typeof directory.roleBindings>();
    for (const identity of directory.identities) {
      map.set(identity.id, directory.roleBindings.filter((binding) => binding.identityId === identity.id));
    }
    return map;
  }, [directory.identities, directory.roleBindings]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  async function issue(input: IssueInvitationInput) {
    const result = await onIssue(input);
    setIssued(result);
    setInviteOpen(false);
  }

  async function revoke(invitationId: string) {
    setBusy(invitationId);
    setError(null);
    try {
      await onRevoke(invitationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function change(
    identity: UiDirectoryIdentity,
    nextState: "active" | "suspended" | "departed",
  ) {
    if (nextState === "suspended" && !window.confirm(t("people.confirmSuspend"))) return;
    if (identity.kind === "human" && nextState === "departed" &&
        !window.confirm(t("people.confirmDepart"))) return;
    if (identity.kind !== "human" && nextState === "departed" &&
        !window.confirm(t("people.confirmServiceDepart"))) return;
    setBusy(identity.id);
    setError(null);
    try {
      if (identity.kind === "human") await onMembershipChange(identity.id, nextState);
      else await onMachineMembershipChange(identity.id, nextState);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function copyToken() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function loadMore(
    kind: "identities" | "invitations",
    operation: (() => Promise<void>) | null,
  ) {
    if (!operation) return;
    setLoadingMore(kind);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setLoadingMore(null);
    }
  }

  return (
    <>
      <PageHeader
        title={collective.labels.members}
        subtitle={t("members.subtitle")}
        action={directory.capabilities.manageMemberships ||
          directory.capabilities.manageIdentities && directory.capabilities.manageRoles ? (
            <div className="action-group">
              {directory.capabilities.manageAgents && directory.capabilities.manageRoles ? (
                <button className="secondary-button" type="button" onClick={() => setAgentOpen(true)}>
                  <Bot size={17} /><span>{t("agents.create")}</span>
                </button>
              ) : null}
              {directory.capabilities.manageIdentities && directory.capabilities.manageRoles ? (
                <button className="secondary-button" type="button" onClick={() => setServiceOpen(true)}>
                  <ServerCog size={17} /><span>{t("members.addMachine")}</span>
                </button>
              ) : null}
              {directory.capabilities.manageMemberships ? (
                <button className="primary-button" type="button" onClick={() => setInviteOpen(true)}>
                  <Plus size={17} /><span>{t("people.invite")}</span>
                </button>
              ) : null}
            </div>
          ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}

      <section className="content-section">
        <div className="section-heading-row compact-heading members-heading-row">
          <div><h2>{collective.labels.members}</h2><span>{visibleIdentities.length}</span></div>
          <div className="segmented-control" role="group" aria-label={t("members.filter")}>
            {(["all", "human", "agent", "service", "guild"] as const).map((kind) => (
              <button className={kindFilter === kind ? "segment-active" : ""} type="button" key={kind} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>
                {kind === "all" ? t("members.filterAll") : actorKindLabel(kind, collective.labels)}
              </button>
            ))}
          </div>
        </div>
        <div className="data-table identity-table">
          <div className="data-table-head">
            <span>{t("people.members")}</span>
            <span>{t("people.kind")}</span>
            <span>{t("people.role")}</span>
            <span>{t("people.status")}</span>
            <span className="align-right">{t("people.actions")}</span>
          </div>
          {visibleIdentities.map((identity) => {
            const bindings = bindingsByIdentity.get(identity.id) ?? [];
            const profile = profiles.get(identity.id);
            const isRoot = identity.id === bootstrap.rootOwnerIdentityId;
            const isBusy = busy === identity.id;
            return (
              <article className="data-row" key={identity.id}>
                <div className="identity-cell">
                  <span className="identity-avatar" aria-hidden="true">{identity.displayName.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{identity.displayName}</strong>{isRoot ? <small><Shield size={12} />{t("people.root")}</small> : profile ? <small>{profile.model} · {profile.limits.maxBudgetMinor} {profile.limits.currency}</small> : null}</div>
                </div>
                <div data-label={t("people.kind")}>{actorKindLabel(identity.kind, collective.labels)}</div>
                <div className="binding-list" data-label={t("people.role")}>
                  {bindings.length === 0 ? <span>{t("people.noRole")}</span> : bindings.map((binding) => (
                    <span key={binding.id}>{roles.get(binding.roleId) ?? t("common.unknown")} · {binding.spaceId ? spaces.get(binding.spaceId) ?? t("common.unknown") : t("people.global")}</span>
                  ))}
                </div>
                <div data-label={t("people.status")}>
                  <span className={`status-pill status-${identity.membershipState}`}>{membershipStateLabel(identity.membershipState, collective.template.key, locale)}</span>
                </div>
                <div className="row-actions">
                  {directory.capabilities.manageRoles ? (
                    <button className="icon-button" type="button" title={t("people.manageRoles")} aria-label={t("people.manageRoles")} onClick={() => setRoleIdentity(identity)}><ShieldPlus size={17} /></button>
                  ) : null}
                  {directory.capabilities.manageMemberships && identity.kind === "human" && !isRoot ? (
                    <>
                      {identity.membershipState === "preboarding" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity, "active")}><UserCheck size={16} />{t("people.activate")}</button>
                      ) : null}
                      {identity.membershipState === "active" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity, "suspended")}><UserX size={16} />{t("people.suspend")}</button>
                      ) : null}
                      {identity.membershipState === "suspended" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity, "active")}><RotateCcw size={16} />{t("people.restore")}</button>
                      ) : null}
                      {identity.membershipState !== "departed" ? (
                        <button className="icon-button danger-button" type="button" disabled={isBusy} title={t("people.depart")} aria-label={t("people.depart")} onClick={() => void change(identity, "departed")}><LogOut size={17} /></button>
                      ) : null}
                    </>
                  ) : null}
                  {(identity.kind === "agent" ? directory.capabilities.stopAgents : directory.capabilities.manageIdentities) &&
                    (identity.kind === "agent" || identity.kind === "service" || identity.kind === "guild") ? (
                    <>
                      {identity.membershipState === "active" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity, "suspended")}><UserX size={16} />{t("people.suspend")}</button>
                      ) : null}
                      {identity.membershipState === "suspended" ? (
                        <>
                          <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity, "active")}><RotateCcw size={16} />{t("people.restore")}</button>
                          <button className="icon-button danger-button" type="button" disabled={isBusy} title={t("people.depart")} aria-label={t("people.depart")} onClick={() => void change(identity, "departed")}><LogOut size={17} /></button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  {!directory.capabilities.manageRoles &&
                    !(directory.capabilities.manageMemberships && identity.kind === "human" && !isRoot) &&
                    !((identity.kind === "agent" ? directory.capabilities.stopAgents : directory.capabilities.manageIdentities) && identity.kind !== "human") ? <span className="muted-dash">-</span> : null}
                </div>
              </article>
            );
          })}
        </div>
        {onLoadMoreIdentities ? (
          <div className="load-more-row">
            <button className="secondary-button" type="button" disabled={loadingMore !== null} onClick={() => void loadMore("identities", onLoadMoreIdentities)}>{t("common.loadMore")}</button>
          </div>
        ) : null}
      </section>

      {directory.capabilities.manageMemberships ? (
        <section className="content-section">
          <div className="section-heading-row compact-heading"><h2>{t("people.invitations")}</h2><span>{directory.invitations.length}</span></div>
          {directory.invitations.length === 0 ? <p className="empty-state">{t("people.noInvitations")}</p> : (
            <div className="invitation-list">
              {directory.invitations.map((invitation) => (
                <div className="invitation-row" key={invitation.id}>
                  <div><strong>{invitation.inviteeLabel}</strong><span>{roles.get(invitation.roleId) ?? t("common.unknown")} · {invitation.spaceId ? spaces.get(invitation.spaceId) ?? t("common.unknown") : t("people.global")}</span></div>
                  <span className={`status-pill invitation-${invitation.state}`}>{t(invitationTranslationKey(invitation.state))}</span>
                  <span>{t("people.expires")} {dateFormatter.format(new Date(invitation.expiresAt))}</span>
                  {invitation.state === "pending" ? (
                    <button className="text-button" type="button" disabled={busy === invitation.id} onClick={() => void revoke(invitation.id)}><X size={16} />{t("people.revoke")}</button>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}
          {onLoadMoreInvitations ? (
            <div className="load-more-row">
              <button className="secondary-button" type="button" disabled={loadingMore !== null} onClick={() => void loadMore("invitations", onLoadMoreInvitations)}>{t("common.loadMore")}</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <AgentRunsPanel api={api} directory={directory} />

      {inviteOpen ? <InviteDialog collective={collective} directory={directory} onClose={() => setInviteOpen(false)} onIssue={issue} /> : null}
      {serviceOpen ? <ServiceDialog directory={directory} onCreate={onCreateService} onClose={() => setServiceOpen(false)} /> : null}
      {agentOpen ? <AgentDialog directory={directory} defaults={bootstrap.agentDefaults} collective={collective} onCreate={onCreateAgent} onClose={() => setAgentOpen(false)} /> : null}
      {roleIdentity ? (
        <IdentityRoleDialog
          directory={directory}
          identity={roleIdentity}
          onAssign={onAssignRole}
          onRemove={onRemoveRole}
          onClose={() => setRoleIdentity(null)}
        />
      ) : null}
      {issued ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog token-dialog" role="dialog" aria-modal="true" aria-labelledby="token-title">
            <header className="dialog-header">
              <h2 id="token-title">{t("people.tokenTitle")}</h2>
              <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={() => setIssued(null)}><X size={19} /></button>
            </header>
            <Notice>{t("people.tokenWarning")}</Notice>
            <label className="token-field"><span>{t("people.tokenLabel")}</span><code>{issued.token}</code></label>
            <footer className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => void copyToken()}>
                {copied ? <Check size={17} /> : <Clipboard size={17} />}
                <span>{copied ? t("common.copied") : t("common.copy")}</span>
              </button>
              <button className="primary-button" type="button" onClick={() => setIssued(null)}>{t("common.close")}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
