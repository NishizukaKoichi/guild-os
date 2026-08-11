import { ArrowRight, Ban, Check, Crown, Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ProposeRootOwnershipTransferRequest,
  ResolveRootOwnershipTransferRequest,
  UiBootstrapState,
  UiDirectory,
  UiRootOwnershipCandidate,
  UiRootOwnershipTransfer,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function ProposeTransferDialog({
  bootstrap,
  directory,
  onPropose,
  onSearchCandidates,
  onClose,
}: {
  bootstrap: UiBootstrapState;
  directory: UiDirectory;
  onPropose(input: ProposeRootOwnershipTransferRequest): Promise<void>;
  onSearchCandidates(search: string): Promise<readonly UiRootOwnershipCandidate[]>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const loadedCandidates = useMemo(() => directory.identities.filter((identity) =>
    identity.kind === "human" && identity.status === "active" &&
    identity.membershipState === "active" && identity.id !== bootstrap.rootOwnerIdentityId)
    .map((identity) => ({ id: identity.id, displayName: identity.displayName })),
  [bootstrap.rootOwnerIdentityId, directory.identities]);
  const roles = directory.roles;
  const defaultRole = roles.find((role) => role.name === "Admin") ?? roles[0];
  const [candidates, setCandidates] = useState<readonly UiRootOwnershipCandidate[]>(loadedCandidates);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toIdentityId, setToIdentityId] = useState(candidates[0]?.id ?? "");
  const [outgoingRoleId, setOutgoingRoleId] = useState(defaultRole?.id ?? "");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = candidates.find((identity) => identity.id === toIdentityId);

  async function searchCandidates() {
    setSearching(true);
    setError(null);
    try {
      const result = await onSearchCandidates(candidateSearch);
      setCandidates(result);
      setToIdentityId(result[0]?.id ?? "");
      setConfirmation("");
      setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setSearching(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onPropose({
        toIdentityId,
        outgoingRoleId,
        reason: reason.trim(),
        confirmation,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="ownership-propose-title">
        <header className="dialog-header">
          <div>
            <h2 id="ownership-propose-title">{t("settings.ownershipProposeTitle")}</h2>
            <small>{t("settings.ownershipTwoParty")}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {!roles.length ? (
            <Notice kind="error">{t("settings.ownershipUnavailable")}</Notice>
          ) : null}
          <div className="ownership-search-field">
            <label htmlFor="ownership-candidate-search">{t("settings.ownershipSearch")}</label>
            <div className="ownership-search-row">
              <input
                id="ownership-candidate-search"
                type="search"
                maxLength={100}
                value={candidateSearch}
                placeholder={t("settings.ownershipSearchPlaceholder")}
                onChange={(event) => setCandidateSearch(event.target.value)}
              />
              <button className="secondary-button" type="button" disabled={searching} onClick={() => void searchCandidates()}>
                <Search size={16} />{t("settings.ownershipSearchAction")}
              </button>
            </div>
          </div>
          {searched && candidates.length === 0 ? <Notice>{t("settings.ownershipSearchEmpty")}</Notice> : null}
          <label>
            <span>{t("settings.ownershipSuccessor")}</span>
            <select required value={toIdentityId} onChange={(event) => {
              setToIdentityId(event.target.value);
              setConfirmation("");
            }}>
              {candidates.map((identity) => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}
            </select>
          </label>
          <label>
            <span>{t("settings.ownershipOutgoingRole")}</span>
            <select required value={outgoingRoleId} onChange={(event) => setOutgoingRoleId(event.target.value)}>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea required maxLength={2_000} rows={4} value={reason} placeholder={t("settings.ownershipReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <span>{t("settings.ownershipTypeSuccessor")}</span>
            <input required value={confirmation} placeholder={target?.displayName ?? ""} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !target || !outgoingRoleId || reason.trim() === "" || confirmation !== target.displayName}>
              <ArrowRight size={17} />{t("settings.ownershipPropose")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ResolveTransferDialog({
  mode,
  guildName,
  transfer,
  onResolve,
  onClose,
}: {
  mode: "accept" | "cancel";
  guildName: string;
  transfer: UiRootOwnershipTransfer;
  onResolve(input: ResolveRootOwnershipTransferRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onResolve({
        transferId: transfer.id,
        expectedVersion: transfer.version,
        reason: reason.trim(),
        confirmation,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="ownership-resolve-title">
        <header className="dialog-header">
          <div>
            <h2 id="ownership-resolve-title">{t(mode === "accept" ? "settings.ownershipAcceptTitle" : "settings.ownershipCancelTitle")}</h2>
            <small>{transfer.fromDisplayName} <ArrowRight size={12} /> {transfer.toDisplayName}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <Notice kind={mode === "accept" ? "info" : "error"}>
            {t(mode === "accept" ? "settings.ownershipAcceptWarning" : "settings.ownershipCancelWarning")}
          </Notice>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea required maxLength={2_000} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <span>{t("settings.ownershipTypeGuild")}</span>
            <input required value={confirmation} placeholder={guildName} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className={mode === "accept" ? "primary-button" : "danger-action-button"} type="submit" disabled={busy || reason.trim() === "" || confirmation !== guildName}>
              {mode === "accept" ? <Check size={17} /> : <Ban size={17} />}
              {t(mode === "accept" ? "settings.ownershipAccept" : "settings.ownershipCancel")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function OwnershipManager({
  bootstrap,
  directory,
  onPropose,
  onCancel,
  onAccept,
  onSearchCandidates,
}: {
  bootstrap: UiBootstrapState;
  directory: UiDirectory | null;
  onPropose(input: ProposeRootOwnershipTransferRequest): Promise<void>;
  onCancel(input: ResolveRootOwnershipTransferRequest): Promise<void>;
  onAccept(input: ResolveRootOwnershipTransferRequest): Promise<void>;
  onSearchCandidates(search: string): Promise<readonly UiRootOwnershipCandidate[]>;
}) {
  const { locale, t } = useI18n();
  const [dialog, setDialog] = useState<"propose" | "cancel" | "accept" | null>(null);
  const transfer = bootstrap.rootOwnershipTransfer;
  const canAccept = transfer?.toIdentityId === bootstrap.accountId;
  const expiresAt = transfer ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(transfer.expiresAt)) : null;

  return (
    <section className="content-section settings-section">
      <div className="section-heading-row manager-heading">
        <Crown size={19} />
        <div>
          <h2>{t("settings.ownershipTitle")}</h2>
          <p>{t("settings.ownershipDescription")}</p>
        </div>
        {bootstrap.rootOwner && !transfer && directory ? (
          <button className="secondary-button" type="button" onClick={() => setDialog("propose")}>
            <ArrowRight size={16} />{t("settings.ownershipPropose")}
          </button>
        ) : null}
      </div>
      <dl className="ownership-summary">
        <div><dt>{t("settings.ownershipCurrent")}</dt><dd><Crown size={15} />{bootstrap.rootOwnerDisplayName}</dd></div>
        {transfer ? (
          <>
            <div><dt>{t("settings.ownershipPending")}</dt><dd>{transfer.fromDisplayName} <ArrowRight size={14} /> {transfer.toDisplayName}</dd></div>
            <div><dt>{t("settings.ownershipOutgoingRole")}</dt><dd><ShieldCheck size={15} />{transfer.outgoingRoleName}</dd></div>
            <div><dt>{t("settings.ownershipExpires")}</dt><dd>{expiresAt}</dd></div>
            <div className="ownership-reason"><dt>{t("settings.changeReason")}</dt><dd>{transfer.reason}</dd></div>
          </>
        ) : null}
      </dl>
      {transfer ? (
        <div className="ownership-actions">
          <Notice>{t("settings.ownershipAwaiting")}</Notice>
          {bootstrap.rootOwner && transfer.fromIdentityId === bootstrap.accountId ? (
            <button className="danger-action-button" type="button" onClick={() => setDialog("cancel")}><Ban size={16} />{t("settings.ownershipCancel")}</button>
          ) : null}
          {canAccept ? (
            <button className="primary-button" type="button" onClick={() => setDialog("accept")}><Check size={16} />{t("settings.ownershipAccept")}</button>
          ) : null}
        </div>
      ) : <Notice>{t("settings.ownershipNoPending")}</Notice>}

      {dialog === "propose" && directory ? (
        <ProposeTransferDialog
          bootstrap={bootstrap}
          directory={directory}
          onPropose={onPropose}
          onSearchCandidates={onSearchCandidates}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "cancel" && transfer ? (
        <ResolveTransferDialog mode="cancel" guildName={bootstrap.guildName} transfer={transfer} onResolve={onCancel} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "accept" && transfer ? (
        <ResolveTransferDialog mode="accept" guildName={bootstrap.guildName} transfer={transfer} onResolve={onAccept} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}
