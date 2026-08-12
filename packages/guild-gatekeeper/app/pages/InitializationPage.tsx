import { Crown, Languages, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AppLocale } from "@guild-os/domain";
import type {
  InitializeGuildRequest,
  UiInitializationBootstrapState,
} from "../../src/management-types";
import { Notice } from "../components/Notice";
import { useI18n } from "../i18n";

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function InitializationPage({
  bootstrap,
  onInitialize,
}: {
  bootstrap: UiInitializationBootstrapState;
  onInitialize(input: InitializeGuildRequest): Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onInitialize({
        displayName: displayName.trim(),
        preferredLocale: locale,
        confirmation,
      });
    } catch (cause) {
      setError(messageFrom(cause, t("initialization.error")));
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

      <section className="access-panel initialization-panel">
        {bootstrap.canInitialize ? (
          <>
            <div className="access-symbol"><Crown size={28} /></div>
            <h1>{t("initialization.title")}</h1>
            <p>{bootstrap.guildPurpose}</p>
            <Notice kind="info">{t("initialization.warning")}</Notice>
            <form className="stack-form" onSubmit={submit}>
              <label>
                <span>{t("initialization.displayName")}</span>
                <input
                  required
                  autoComplete="name"
                  maxLength={200}
                  value={displayName}
                  placeholder={t("initialization.displayNamePlaceholder")}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                <span>{t("initialization.confirmation")}</span>
                <input
                  required
                  autoComplete="off"
                  maxLength={200}
                  value={confirmation}
                  placeholder={bootstrap.guildName}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              {error ? <Notice kind="error">{error}</Notice> : null}
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="spin" size={17} /> : <Crown size={17} />}
                <span>{t("initialization.submit")}</span>
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="access-symbol access-symbol-error"><ShieldAlert size={28} /></div>
            <h1>{t("initialization.adminRequiredTitle")}</h1>
            <p>{t("initialization.adminRequiredDescription")}</p>
          </>
        )}
      </section>
    </main>
  );
}
