import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Languages,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  COLLECTIVE_TEMPLATES,
  type AppLocale,
  type CollectiveTemplateKey,
} from "@guild-os/domain";
import type {
  InitializeGuildRequest,
  UiInitializationBootstrapState,
} from "../../src/management-types";
import { localizeTemplate } from "../collective-language";
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
  const templates = useMemo(
    () => COLLECTIVE_TEMPLATES.map((template) => localizeTemplate(template, locale)),
    [locale],
  );
  const [step, setStep] = useState<"template" | "details">("template");
  const [templateKey, setTemplateKey] = useState<CollectiveTemplateKey>("blank");
  const [displayName, setDisplayName] = useState("");
  const [purpose, setPurpose] = useState(bootstrap.guildPurpose);
  const [participants, setParticipants] = useState("");
  const [memoryIntent, setMemoryIntent] = useState("");
  const [activityIntent, setActivityIntent] = useState("");
  const [decisionStyle, setDecisionStyle] = useState("");
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
        templateKey,
        purpose: purpose.trim(),
        participants: participants.trim(),
        memoryIntent: memoryIntent.trim(),
        activityIntent: activityIntent.trim(),
        decisionStyle: decisionStyle.trim(),
      });
    } catch (cause) {
      setError(messageFrom(cause, t("initialization.error")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-layout collective-initialization-layout">
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

      {!bootstrap.canInitialize ? (
        <section className="access-panel initialization-panel">
          <div className="access-symbol access-symbol-error"><ShieldAlert size={28} /></div>
          <h1>{t("initialization.adminRequiredTitle")}</h1>
          <p>{t("initialization.adminRequiredDescription")}</p>
        </section>
      ) : step === "template" ? (
        <section className="collective-template-step" aria-labelledby="template-step-title">
          <header className="initialization-heading">
            <span className="step-kicker">1 / 2</span>
            <h1 id="template-step-title">{t("initialization.templateTitle")}</h1>
            <p>{t("initialization.templateDescription")}</p>
          </header>
          <div className="template-grid">
            {templates.map((template) => {
              const selected = template.key === templateKey;
              return (
                <button
                  className={selected ? "template-option template-option-selected" : "template-option"}
                  type="button"
                  key={template.key}
                  aria-pressed={selected}
                  onClick={() => setTemplateKey(template.key)}
                >
                  <span className="template-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                  {selected ? <small>{t("initialization.templateSelected")}</small> : null}
                </button>
              );
            })}
          </div>
          <footer className="initialization-actions">
            <button className="primary-button" type="button" onClick={() => setStep("details")}>
              <span>{t("common.continue")}</span><ArrowRight size={17} />
            </button>
          </footer>
        </section>
      ) : (
        <section className="access-panel initialization-panel initialization-details-panel">
          <div className="access-symbol"><Crown size={28} /></div>
          <span className="step-kicker">2 / 2</span>
          <h1>{t("initialization.detailsTitle")}</h1>
          <p>{t("initialization.detailsDescription")}</p>
          <Notice kind="info">{t("initialization.warning")}</Notice>
          <form className="stack-form" onSubmit={submit}>
            <label>
              <span>{t("initialization.purpose")}</span>
              <textarea required maxLength={2_000} rows={2} value={purpose} placeholder={t("initialization.purposePlaceholder")} onChange={(event) => setPurpose(event.target.value)} />
            </label>
            <label>
              <span>{t("initialization.participants")}</span>
              <textarea required maxLength={2_000} rows={2} value={participants} placeholder={t("initialization.participantsPlaceholder")} onChange={(event) => setParticipants(event.target.value)} />
            </label>
            <label>
              <span>{t("initialization.memoryIntent")}</span>
              <textarea required maxLength={2_000} rows={2} value={memoryIntent} placeholder={t("initialization.memoryIntentPlaceholder")} onChange={(event) => setMemoryIntent(event.target.value)} />
            </label>
            <label>
              <span>{t("initialization.activityIntent")}</span>
              <textarea required maxLength={2_000} rows={2} value={activityIntent} placeholder={t("initialization.activityIntentPlaceholder")} onChange={(event) => setActivityIntent(event.target.value)} />
            </label>
            <label>
              <span>{t("initialization.decisionStyle")}</span>
              <textarea required maxLength={2_000} rows={2} value={decisionStyle} placeholder={t("initialization.decisionStylePlaceholder")} onChange={(event) => setDecisionStyle(event.target.value)} />
            </label>
            <div className="form-grid">
              <label>
                <span>{t("initialization.displayName")}</span>
                <input required autoComplete="name" maxLength={200} value={displayName} placeholder={t("initialization.displayNamePlaceholder")} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label>
                <span>{t("initialization.confirmation")}</span>
                <input required autoComplete="off" maxLength={200} value={confirmation} placeholder={bootstrap.guildName} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
            </div>
            {error ? <Notice kind="error">{error}</Notice> : null}
            <footer className="dialog-actions initialization-form-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("template")}>
                <ArrowLeft size={17} /><span>{t("common.back")}</span>
              </button>
              <button className="primary-button" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="spin" size={17} /> : <Crown size={17} />}
                <span>{t("initialization.submit")}</span>
              </button>
            </footer>
          </form>
        </section>
      )}
    </main>
  );
}
