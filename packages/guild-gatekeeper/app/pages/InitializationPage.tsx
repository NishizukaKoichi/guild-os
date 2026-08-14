import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  Crown,
  FlaskConical,
  GitFork,
  Languages,
  LoaderCircle,
  Palette,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  COLLECTIVE_TEMPLATES,
  type AppLocale,
  type CollectiveOnboardingAnswers,
  type CollectiveTemplateKey,
} from "@guild-os/domain";
import type {
  InitializeGuildRequest,
  UiInitializationBootstrapState,
} from "../../src/management-types";
import { localizeTemplate } from "../collective-language";
import { ContextProfilePreview } from "../components/ContextProfilePreview";
import { Notice } from "../components/Notice";
import { useI18n } from "../i18n";

const primaryTemplateKeys: readonly CollectiveTemplateKey[] = [
  "personal",
  "company",
  "research",
  "community",
];

const advancedTemplateKeys: readonly CollectiveTemplateKey[] = [
  "creator",
  "open-source",
  "agent-collective",
  "blank",
];

const templateIcons: Record<CollectiveTemplateKey, LucideIcon> = {
  personal: UserRound,
  company: Building2,
  research: FlaskConical,
  community: UsersRound,
  creator: Palette,
  "open-source": GitFork,
  "agent-collective": Bot,
  blank: Shapes,
};

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
  const [templateKey, setTemplateKey] = useState<CollectiveTemplateKey>("personal");
  const [displayName, setDisplayName] = useState("");
  const [answerOverrides, setAnswerOverrides] = useState<Partial<CollectiveOnboardingAnswers>>({});
  const [rootOwnershipAccepted, setRootOwnershipAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.find((template) => template.key === templateKey) ?? templates[0]!;
  const templatesByKey = useMemo(
    () => new Map(templates.map((template) => [template.key, template])),
    [templates],
  );
  const defaultAnswers = useMemo<CollectiveOnboardingAnswers>(() => ({
    purpose: bootstrap.guildPurpose.trim() || t("initialization.defaultPurpose", {
      profile: selectedTemplate.name,
    }),
    participants: t("initialization.defaultParticipants", {
      human: selectedTemplate.labels.human,
      agent: selectedTemplate.labels.agent,
      service: selectedTemplate.labels.service,
    }),
    memoryIntent: t("initialization.defaultMemory", {
      memory: selectedTemplate.labels.memory,
    }),
    activityIntent: t("initialization.defaultActivity", {
      activity: selectedTemplate.labels.activity,
    }),
    decisionStyle: t("initialization.defaultDecision", {
      decisions: selectedTemplate.labels.decisions,
    }),
  }), [bootstrap.guildPurpose, selectedTemplate, t]);

  function answer(key: keyof CollectiveOnboardingAnswers): string {
    return answerOverrides[key] ?? defaultAnswers[key];
  }

  function selectTemplate(nextTemplateKey: CollectiveTemplateKey): void {
    setTemplateKey(nextTemplateKey);
    setAnswerOverrides({});
  }

  function renderTemplateOption(key: CollectiveTemplateKey) {
    const template = templatesByKey.get(key);
    if (!template) return null;
    const selected = template.key === templateKey;
    const Icon = templateIcons[template.key];
    return (
      <button
        className={selected ? "template-option template-option-selected" : "template-option"}
        type="button"
        key={template.key}
        aria-pressed={selected}
        onClick={() => selectTemplate(template.key)}
      >
        <span className="template-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="template-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
        <strong>{template.name}</strong>
        <span>{template.description}</span>
        {template.key === "personal" ? <small>{t("initialization.templateRecommended")}</small> : null}
      </button>
    );
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onInitialize({
        displayName: displayName.trim(),
        preferredLocale: locale,
        rootOwnershipAccepted,
        templateKey,
        purpose: answer("purpose").trim(),
        participants: answer("participants").trim(),
        memoryIntent: answer("memoryIntent").trim(),
        activityIntent: answer("activityIntent").trim(),
        decisionStyle: answer("decisionStyle").trim(),
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
            <span className="step-kicker">{t("initialization.profileStep")}</span>
            <h1 id="template-step-title">{t("initialization.templateTitle")}</h1>
            <p>{t("initialization.templateDescription")}</p>
          </header>
          <div className="template-grid">
            {primaryTemplateKeys.map(renderTemplateOption)}
          </div>
          <details className="initialization-advanced-profiles">
            <summary>{t("initialization.advancedProfilesTitle")}</summary>
            <div className="template-grid template-grid-advanced">
              {advancedTemplateKeys.map(renderTemplateOption)}
            </div>
          </details>
          <div className="initialization-profile-preview initialization-profile-preview-desktop">
            <ContextProfilePreview template={selectedTemplate} />
          </div>
          <details className="initialization-profile-preview-mobile">
            <summary>{t("initialization.profileDetails")}</summary>
            <ContextProfilePreview template={selectedTemplate} />
          </details>
          <footer className="initialization-actions">
            <button className="primary-button" type="button" onClick={() => setStep("details")}>
              <span>{t("common.continue")}</span><ArrowRight size={17} />
            </button>
          </footer>
        </section>
      ) : (
        <section className="access-panel initialization-panel initialization-details-panel">
          <div className="access-symbol"><Crown size={28} /></div>
          <span className="step-kicker">{t("initialization.ownerStep")}</span>
          <h1>{t("initialization.detailsTitle")}</h1>
          <p>{t("initialization.detailsDescription")}</p>
          {selectedTemplate.suggestedAgent ? (
            <Notice kind="info">{t("initialization.includedAgent", {
              agent: selectedTemplate.labels.agent,
            })}</Notice>
          ) : null}
          <form className="stack-form" onSubmit={submit}>
            <div className="form-grid">
              <label>
                <span>{t("initialization.guildName")}</span>
                <input readOnly value={bootstrap.guildName} />
                <small>{t("initialization.guildNameManaged")}</small>
              </label>
              <label>
                <span>{t("initialization.displayName")}</span>
                <input required autoFocus autoComplete="name" maxLength={200} value={displayName} placeholder={t("initialization.displayNamePlaceholder")} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
            </div>
            <label className="initialization-ownership-confirmation">
              <input
                required
                type="checkbox"
                checked={rootOwnershipAccepted}
                onChange={(event) => setRootOwnershipAccepted(event.target.checked)}
              />
              <span>
                <strong>{t("initialization.rootAcceptance")}</strong>
                <small>{t("initialization.rootAcceptanceHelp")}</small>
              </span>
            </label>
            <details className="initialization-context-customization">
              <summary>{t("initialization.advancedTitle")}</summary>
              <p>{t("initialization.advancedDescription")}</p>
              <label>
                <span>{t("initialization.purpose")}</span>
                <textarea required maxLength={2_000} rows={2} value={answer("purpose")} onChange={(event) => setAnswerOverrides((current) => ({ ...current, purpose: event.target.value }))} />
              </label>
              <label>
                <span>{t("initialization.participants")}</span>
                <textarea required maxLength={2_000} rows={2} value={answer("participants")} onChange={(event) => setAnswerOverrides((current) => ({ ...current, participants: event.target.value }))} />
              </label>
              <label>
                <span>{t("initialization.memoryIntent")}</span>
                <textarea required maxLength={2_000} rows={2} value={answer("memoryIntent")} onChange={(event) => setAnswerOverrides((current) => ({ ...current, memoryIntent: event.target.value }))} />
              </label>
              <label>
                <span>{t("initialization.activityIntent")}</span>
                <textarea required maxLength={2_000} rows={2} value={answer("activityIntent")} onChange={(event) => setAnswerOverrides((current) => ({ ...current, activityIntent: event.target.value }))} />
              </label>
              <label>
                <span>{t("initialization.decisionStyle")}</span>
                <textarea required maxLength={2_000} rows={2} value={answer("decisionStyle")} onChange={(event) => setAnswerOverrides((current) => ({ ...current, decisionStyle: event.target.value }))} />
              </label>
            </details>
            {error ? <Notice kind="error">{error}</Notice> : null}
            <footer className="dialog-actions initialization-form-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("template")}>
                <ArrowLeft size={17} /><span>{t("common.back")}</span>
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={submitting || !displayName.trim() || !rootOwnershipAccepted}
              >
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
