import { KeyRound, Languages, LoaderCircle, LogIn, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppLocale } from "@guild-os/domain";
import type {
  ClaimInvitationInput,
  RecoverRootOwnershipRequest,
  UiAccessBootstrapState,
} from "../../src/management-types";
import { Notice } from "../components/Notice";
import { RecoveryDialog } from "../components/RecoveryManager";
import { membershipTranslationKey, useI18n } from "../i18n";
import { invitationTokenFromLocation, scrubLocationHash } from "../navigation";

export function AccessPage({
  bootstrap,
  onClaim,
  onRecover,
}: {
  bootstrap: UiAccessBootstrapState;
  onClaim(input: ClaimInvitationInput): Promise<void>;
  onRecover(input: RecoverRootOwnershipRequest): Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenFromLink, setTokenFromLink] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const submitLock = useRef(false);
  const inactive = bootstrap.membershipState === "suspended" || bootstrap.membershipState === "departed";

  useEffect(() => {
    const invitationToken = invitationTokenFromLocation();
    if (!invitationToken) return;
    setToken(invitationToken);
    setTokenFromLink(true);
    scrubLocationHash();
    requestAnimationFrame(() => displayNameRef.current?.focus());
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function claimError(cause: unknown): string {
    const message = cause instanceof Error ? cause.message.toLocaleLowerCase() : "";
    if (message.includes("expired")) return t("access.errorExpired");
    if (message.includes("used") || message.includes("accepted")) return t("access.errorUsed");
    if (message.includes("invalid") || message.includes("not found")) return t("access.errorInvalid");
    return t("access.errorGeneric");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onClaim({ token: token.trim(), displayName: displayName.trim(), preferredLocale: locale });
    } catch (cause) {
      setError(claimError(cause));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
    <main className="access-layout">
      <header className="access-header">
        <div className="brand-mark" aria-hidden="true"><ShieldCheck size={22} /></div>
        <div>
          <span>{t("app.name")}</span>
          <strong>{bootstrap.guildName}</strong>
        </div>
        <label className="language-control access-language" title={t("language.label")}>
          <Languages size={17} aria-hidden="true" />
          <select
            aria-label={t("language.label")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as AppLocale)}
          >
            <option value="en">{t("language.en")}</option>
            <option value="ja">{t("language.ja")}</option>
            <option value="zh-CN">{t("language.zh-CN")}</option>
          </select>
        </label>
      </header>

      <section className="access-panel">
        {inactive ? (
          <>
            <div className="access-symbol access-symbol-error"><ShieldAlert size={28} /></div>
            <h1>{t("access.revokedTitle")}</h1>
            <p>{t(bootstrap.membershipState === "departed"
              ? "access.departedDescription"
              : "access.suspendedDescription")}</p>
            <span className={`status-pill status-${bootstrap.membershipState}`}>
              {t(membershipTranslationKey(bootstrap.membershipState))}
            </span>
          </>
        ) : (
          <>
            <div className="access-symbol"><KeyRound size={28} /></div>
            <h1>{t("access.title")}</h1>
            <p>{t("access.description")}</p>
            {tokenFromLink ? <Notice kind="success">{t("access.linkReady")}</Notice> : null}
            <form className="stack-form" aria-busy={submitting} onSubmit={submit}>
              <label>
                <span>{t("access.token")}</span>
                <input
                  required
                  autoComplete="one-time-code"
                  minLength={43}
                  maxLength={43}
                  placeholder={t("access.tokenPlaceholder")}
                  value={token}
                  aria-invalid={error ? true : undefined}
                  aria-describedby="access-token-help"
                  onChange={(event) => {
                    setToken(event.target.value);
                    setTokenFromLink(false);
                    setError(null);
                  }}
                />
                <small id="access-token-help">{t("access.tokenHelp")}</small>
              </label>
              <label>
                <span>{t("access.displayName")}</span>
                <input
                  ref={displayNameRef}
                  required
                  autoComplete="name"
                  maxLength={200}
                  placeholder={t("access.displayNamePlaceholder")}
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              {error ? (
                <div ref={errorRef} tabIndex={-1}>
                  <Notice kind="error" title={t("access.errorTitle")}>
                    <p>{error}</p>
                    <p>{t("access.errorHelp")}</p>
                  </Notice>
                </div>
              ) : null}
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="spin" size={17} /> : <LogIn size={17} />}
                <span>{t("access.submit")}</span>
              </button>
            </form>
            <p className="security-note"><ShieldCheck size={15} />{t("access.security")}</p>
            {bootstrap.breakGlass.canRecover ? (
              <div className="access-recovery">
                <span>{t("access.recoveryPrompt")}</span>
                <button className="danger-action-button" type="button" onClick={() => setRecoveryOpen(true)}>
                  <ShieldAlert size={16} />{t("settings.recoveryUseAction")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
    {recoveryOpen ? (
      <RecoveryDialog
        guildName={bootstrap.guildName}
        onRecover={onRecover}
        onClose={() => setRecoveryOpen(false)}
      />
    ) : null}
    </>
  );
}
