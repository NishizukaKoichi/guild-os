import {
  Check,
  Copy,
  Download,
  KeyRound,
  RotateCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { AppLocale } from "@guild-os/domain";
import type {
  RecoverRootOwnershipRequest,
  RevokeBreakGlassCodesRequest,
  RotateBreakGlassCodesRequest,
  RotatedBreakGlassCodes,
  UiBreakGlassStatus,
  UiDirectory,
  UiMemberBootstrapState,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function RecoveryDialog({
  guildName,
  onRecover,
  onClose,
}: {
  guildName: string;
  onRecover(input: RecoverRootOwnershipRequest): Promise<void>;
  onClose(): void;
}) {
  const { locale, t } = useI18n();
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onRecover({
        code: code.trim(),
        displayName: displayName.trim(),
        preferredLocale: locale as AppLocale,
        reason: reason.trim(),
        confirmation,
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section className="dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-use-title">
        <header className="dialog-header">
          <div>
            <h2 id="recovery-use-title">{t("settings.recoveryUseTitle")}</h2>
            <small>{t("settings.recoveryUseDescription")}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="stack-form" onSubmit={submit}>
          <Notice kind="error"><ShieldAlert size={16} />{t("settings.recoveryUseWarning")}</Notice>
          <label>
            <span>{t("settings.recoveryCode")}</span>
            <input
              required
              autoComplete="one-time-code"
              minLength={36}
              maxLength={36}
              pattern="gbr_(?:[A-Za-z0-9_]|-){32}"
              placeholder={t("settings.recoveryCodePlaceholder")}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <label>
            <span>{t("settings.recoveryDisplayName")}</span>
            <input
              required
              autoComplete="name"
              maxLength={200}
              placeholder={t("settings.recoveryDisplayNamePlaceholder")}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea
              required
              maxLength={2_000}
              rows={4}
              placeholder={t("settings.recoveryReasonPlaceholder")}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            <span>{t("settings.ownershipTypeGuild")}</span>
            <input
              required
              maxLength={200}
              autoComplete="off"
              placeholder={guildName}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="danger-action-button" type="submit" disabled={submitting}>
              <KeyRound size={17} />{t("settings.recoveryUseSubmit")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CodeReveal({
  guildName,
  result,
  onStored,
}: {
  guildName: string;
  result: RotatedBreakGlassCodes;
  onStored(): void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const body = useMemo(() => [
    `${guildName} - ${t("settings.recoveryDownloadTitle")}`,
    t("settings.recoveryRevealWarning"),
    "",
    ...result.codes,
    "",
    `${t("settings.recoveryGeneration")}: ${result.status.generation ?? ""}`,
    `${t("settings.recoveryExpires")}: ${result.status.expiresAt ?? ""}`,
  ].join("\n"), [guildName, result, t]);

  async function copy() {
    await navigator.clipboard.writeText(result.codes.join("\n"));
    setCopied(true);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `guild-os-recovery-generation-${result.status.generation ?? "unknown"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dialog-backdrop">
      <section className="dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-reveal-title">
        <header className="dialog-header">
          <div>
            <h2 id="recovery-reveal-title">{t("settings.recoveryRevealTitle")}</h2>
            <small>{t("settings.recoveryRevealSubtitle")}</small>
          </div>
        </header>
        <Notice kind="error"><ShieldAlert size={16} />{t("settings.recoveryRevealWarning")}</Notice>
        <ol className="recovery-code-list" aria-label={t("settings.recoveryRevealTitle")}>
          {result.codes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ol>
        <div className="recovery-code-actions">
          <button className="secondary-button" type="button" onClick={() => void copy()}>
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {t(copied ? "common.copied" : "settings.recoveryCopyAll")}
          </button>
          <button className="secondary-button" type="button" onClick={download}>
            <Download size={17} />{t("settings.recoveryDownload")}
          </button>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={onStored}>
            <Check size={17} />{t("settings.recoveryStored")}
          </button>
        </div>
      </section>
    </div>
  );
}

function RotateDialog({
  bootstrap,
  directory,
  onRotate,
  onClose,
}: {
  bootstrap: UiMemberBootstrapState;
  directory: UiDirectory;
  onRotate(input: RotateBreakGlassCodesRequest): Promise<RotatedBreakGlassCodes>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const defaultRoleId = bootstrap.breakGlass.outgoingRoleId ?? directory.roles[0]?.id ?? "";
  const [outgoingRoleId, setOutgoingRoleId] = useState(defaultRoleId);
  const [expiresInDays, setExpiresInDays] = useState(365);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onRotate({
        expectedVersion: bootstrap.breakGlass.version,
        outgoingRoleId,
        expiresInDays,
        reason: reason.trim(),
        confirmation,
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section className="dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-rotate-title">
        <header className="dialog-header">
          <div>
            <h2 id="recovery-rotate-title">{t("settings.recoveryRotateTitle")}</h2>
            <small>{t("settings.recoveryRotateWarning")}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="stack-form" onSubmit={submit}>
          <label>
            <span>{t("settings.recoveryOutgoingRole")}</span>
            <select required value={outgoingRoleId} onChange={(event) => setOutgoingRoleId(event.target.value)}>
              {directory.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("settings.recoveryExpiry")}</span>
            <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
              {[30, 90, 365, 730].map((days) => <option key={days} value={days}>{days} {t("common.days")}</option>)}
            </select>
          </label>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea required maxLength={2_000} rows={4} placeholder={t("settings.recoveryRotateReasonPlaceholder")} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <span>{t("settings.ownershipTypeGuild")}</span>
            <input required maxLength={200} autoComplete="off" placeholder={bootstrap.guildName} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={submitting || !outgoingRoleId}>
              <RotateCw size={17} />{t("settings.recoveryGenerate")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RevokeDialog({
  bootstrap,
  onRevoke,
  onClose,
}: {
  bootstrap: UiMemberBootstrapState;
  onRevoke(input: RevokeBreakGlassCodesRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const codeSetId = bootstrap.breakGlass.currentCodeSetId;
    if (!codeSetId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRevoke({
        expectedVersion: bootstrap.breakGlass.version,
        codeSetId,
        reason: reason.trim(),
        confirmation,
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section className="dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-revoke-title">
        <header className="dialog-header">
          <div>
            <h2 id="recovery-revoke-title">{t("settings.recoveryRevokeTitle")}</h2>
            <small>{t("settings.recoveryRevokeWarning")}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="stack-form" onSubmit={submit}>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea required maxLength={2_000} rows={4} placeholder={t("settings.recoveryRevokeReasonPlaceholder")} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <span>{t("settings.ownershipTypeGuild")}</span>
            <input required maxLength={200} autoComplete="off" placeholder={bootstrap.guildName} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="danger-action-button" type="submit" disabled={submitting}>
              <Trash2 size={17} />{t("settings.recoveryRevoke")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function RecoveryManager({
  bootstrap,
  directory,
  onRotate,
  onRevoke,
  onRecover,
}: {
  bootstrap: UiMemberBootstrapState;
  directory: UiDirectory | null;
  onRotate(input: RotateBreakGlassCodesRequest): Promise<RotatedBreakGlassCodes>;
  onRevoke(input: RevokeBreakGlassCodesRequest): Promise<void>;
  onRecover(input: RecoverRootOwnershipRequest): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [dialog, setDialog] = useState<"rotate" | "revoke" | "recover" | null>(null);
  const [generated, setGenerated] = useState<RotatedBreakGlassCodes | null>(null);
  const status = bootstrap.breakGlass;
  const createdAt = status.createdAt ? new Date(status.createdAt).toLocaleString(locale) : t("common.none");
  const expiresAt = status.expiresAt ? new Date(status.expiresAt).toLocaleString(locale) : t("common.none");

  if (!bootstrap.rootOwner && !status.canRecover) return null;

  return (
    <>
      <section className="content-section settings-section recovery-manager">
        <div className="manager-heading">
          <KeyRound size={20} />
          <div>
            <h2>{t("settings.recoveryTitle")}</h2>
            <p>{t(bootstrap.rootOwner ? "settings.recoveryDescription" : "settings.recoveryUseDescription")}</p>
          </div>
          {bootstrap.rootOwner ? (
            <button className="secondary-button" type="button" disabled={!directory?.roles.length} onClick={() => setDialog("rotate")}>
              <RotateCw size={16} />{t(status.currentCodeSetId ? "settings.recoveryRotate" : "settings.recoveryGenerate")}
            </button>
          ) : (
            <button className="danger-action-button" type="button" onClick={() => setDialog("recover")}>
              <ShieldAlert size={16} />{t("settings.recoveryUseAction")}
            </button>
          )}
        </div>
        {bootstrap.rootOwner ? (
          <>
            <dl className="recovery-summary">
              <div><dt>{t("settings.recoveryStatus")}</dt><dd><span className={`status-pill status-${status.available ? "active" : "suspended"}`}>{t(status.available ? "settings.recoveryReady" : "settings.recoveryInactive")}</span></dd></div>
              <div><dt>{t("settings.recoveryGeneration")}</dt><dd>{status.generation ?? t("common.none")}</dd></div>
              <div><dt>{t("settings.recoveryCodesRemaining")}</dt><dd>{status.remainingCodeCount ?? 0}</dd></div>
              <div><dt>{t("settings.recoveryOutgoingRole")}</dt><dd>{status.outgoingRoleName ?? t("common.none")}</dd></div>
              <div><dt>{t("settings.recoveryCreated")}</dt><dd>{createdAt}</dd></div>
              <div><dt>{t("settings.recoveryExpires")}</dt><dd>{expiresAt}</dd></div>
            </dl>
            <Notice>{status.reason ?? t("settings.recoveryNoCodes")}</Notice>
            {status.currentCodeSetId ? (
              <div className="ownership-actions">
                <button className="danger-action-button" type="button" onClick={() => setDialog("revoke")}>
                  <Trash2 size={16} />{t("settings.recoveryRevoke")}
                </button>
              </div>
            ) : null}
          </>
        ) : <Notice kind="error"><ShieldAlert size={16} />{t("settings.recoveryUseWarning")}</Notice>}
      </section>

      {dialog === "rotate" && directory ? (
        <RotateDialog
          bootstrap={bootstrap}
          directory={directory}
          onClose={() => setDialog(null)}
          onRotate={async (input) => {
            const result = await onRotate(input);
            setGenerated(result);
            return result;
          }}
        />
      ) : null}
      {dialog === "revoke" ? <RevokeDialog bootstrap={bootstrap} onRevoke={onRevoke} onClose={() => setDialog(null)} /> : null}
      {dialog === "recover" ? <RecoveryDialog guildName={bootstrap.guildName} onRecover={onRecover} onClose={() => setDialog(null)} /> : null}
      {generated ? <CodeReveal guildName={bootstrap.guildName} result={generated} onStored={() => setGenerated(null)} /> : null}
    </>
  );
}
