import { KeyRound, Languages, LogIn, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AppLocale } from "@guild-os/domain";
import type { ClaimInvitationInput, UiBootstrapState } from "../../src/management-types";
import { Notice } from "../components/Notice";
import { membershipTranslationKey, useI18n } from "../i18n";

export function AccessPage({
  bootstrap,
  onClaim,
}: {
  bootstrap: UiBootstrapState;
  onClaim(input: ClaimInvitationInput): Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inactive = bootstrap.membershipState === "suspended" || bootstrap.membershipState === "departed";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onClaim({ token: token.trim(), displayName: displayName.trim(), preferredLocale: locale });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
            <p>{t("access.revokedDescription")}</p>
            <span className={`status-pill status-${bootstrap.membershipState}`}>
              {t(membershipTranslationKey(bootstrap.membershipState))}
            </span>
          </>
        ) : (
          <>
            <div className="access-symbol"><KeyRound size={28} /></div>
            <h1>{t("access.title")}</h1>
            <p>{t("access.description")}</p>
            <form className="stack-form" onSubmit={submit}>
              <label>
                <span>{t("access.token")}</span>
                <input
                  required
                  autoComplete="one-time-code"
                  minLength={43}
                  maxLength={43}
                  placeholder={t("access.tokenPlaceholder")}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
              <label>
                <span>{t("access.displayName")}</span>
                <input
                  required
                  autoComplete="name"
                  maxLength={200}
                  placeholder={t("access.displayNamePlaceholder")}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              {error ? <Notice kind="error">{error}</Notice> : null}
              <button className="primary-button" type="submit" disabled={submitting}>
                <LogIn size={17} />
                <span>{t("access.submit")}</span>
              </button>
            </form>
            <p className="security-note"><ShieldCheck size={15} />{t("access.security")}</p>
          </>
        )}
      </section>
    </main>
  );
}
