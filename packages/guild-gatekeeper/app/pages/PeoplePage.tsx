import {
  Check,
  Clipboard,
  LogOut,
  Plus,
  RotateCcw,
  Shield,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  IssueInvitationInput,
  IssuedInvitation,
  UiBootstrapState,
  UiDirectory,
} from "../../src/management-types";
import { InviteDialog } from "../components/InviteDialog";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  identityTranslationKey,
  invitationTranslationKey,
  membershipTranslationKey,
  useI18n,
} from "../i18n";

interface PeoplePageProps {
  bootstrap: UiBootstrapState;
  directory: UiDirectory;
  onIssue(input: IssueInvitationInput): Promise<IssuedInvitation>;
  onRevoke(invitationId: string): Promise<void>;
  onMembershipChange(
    identityId: string,
    nextState: "preboarding" | "active" | "suspended" | "departed",
  ): Promise<void>;
  onLoadMoreIdentities: (() => Promise<void>) | null;
  onLoadMoreInvitations: (() => Promise<void>) | null;
}

export function PeoplePage({
  bootstrap,
  directory,
  onIssue,
  onRevoke,
  onMembershipChange,
  onLoadMoreIdentities,
  onLoadMoreInvitations,
}: PeoplePageProps) {
  const { locale, t } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<"identities" | "invitations" | null>(null);
  const roles = useMemo(() => new Map(directory.roles.map((role) => [role.id, role.name])), [directory.roles]);
  const spaces = useMemo(() => new Map(directory.spaces.map((space) => [space.id, space.name])), [directory.spaces]);
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
    identityId: string,
    nextState: "active" | "suspended" | "departed",
  ) {
    if (nextState === "suspended" && !window.confirm(t("people.confirmSuspend"))) return;
    if (nextState === "departed" && !window.confirm(t("people.confirmDepart"))) return;
    setBusy(identityId);
    setError(null);
    try {
      await onMembershipChange(identityId, nextState);
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
        title={t("people.title")}
        subtitle={t("people.subtitle")}
        action={directory.canManageMemberships ? (
          <button className="primary-button" type="button" onClick={() => setInviteOpen(true)}>
            <Plus size={17} /><span>{t("people.invite")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}

      <section className="content-section">
        <div className="section-heading-row compact-heading"><h2>{t("people.members")}</h2><span>{directory.identities.length}</span></div>
        <div className="data-table identity-table">
          <div className="data-table-head">
            <span>{t("people.members")}</span>
            <span>{t("people.kind")}</span>
            <span>{t("people.role")}</span>
            <span>{t("people.status")}</span>
            <span className="align-right">{t("people.actions")}</span>
          </div>
          {directory.identities.map((identity) => {
            const bindings = bindingsByIdentity.get(identity.id) ?? [];
            const isRoot = identity.id === bootstrap.rootOwnerIdentityId;
            const isBusy = busy === identity.id;
            return (
              <article className="data-row" key={identity.id}>
                <div className="identity-cell">
                  <span className="identity-avatar" aria-hidden="true">{identity.displayName.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{identity.displayName}</strong>{isRoot ? <small><Shield size={12} />{t("people.root")}</small> : null}</div>
                </div>
                <div data-label={t("people.kind")}>{t(identityTranslationKey(identity.kind))}</div>
                <div className="binding-list" data-label={t("people.role")}>
                  {bindings.length === 0 ? <span>{t("people.noRole")}</span> : bindings.map((binding) => (
                    <span key={binding.id}>{roles.get(binding.roleId) ?? t("common.unknown")} · {binding.spaceId ? spaces.get(binding.spaceId) ?? t("common.unknown") : t("people.global")}</span>
                  ))}
                </div>
                <div data-label={t("people.status")}>
                  <span className={`status-pill status-${identity.membershipState}`}>{t(membershipTranslationKey(identity.membershipState))}</span>
                </div>
                <div className="row-actions">
                  {directory.canManageMemberships && identity.kind === "human" && !isRoot ? (
                    <>
                      {identity.membershipState === "preboarding" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity.id, "active")}><UserCheck size={16} />{t("people.activate")}</button>
                      ) : null}
                      {identity.membershipState === "active" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity.id, "suspended")}><UserX size={16} />{t("people.suspend")}</button>
                      ) : null}
                      {identity.membershipState === "suspended" ? (
                        <button className="text-button" type="button" disabled={isBusy} onClick={() => void change(identity.id, "active")}><RotateCcw size={16} />{t("people.restore")}</button>
                      ) : null}
                      {identity.membershipState !== "departed" ? (
                        <button className="icon-button danger-button" type="button" disabled={isBusy} title={t("people.depart")} aria-label={t("people.depart")} onClick={() => void change(identity.id, "departed")}><LogOut size={17} /></button>
                      ) : null}
                    </>
                  ) : <span className="muted-dash">-</span>}
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

      {directory.canManageMemberships ? (
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

      {inviteOpen ? <InviteDialog directory={directory} onClose={() => setInviteOpen(false)} onIssue={issue} /> : null}
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
