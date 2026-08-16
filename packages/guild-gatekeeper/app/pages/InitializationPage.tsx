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
  SlidersHorizontal,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  COLLECTIVE_TEMPLATES,
  type AppLocale,
  type CollectiveOnboardingAnswers,
  type CollectiveTemplate,
  type CollectiveTemplateKey,
  type CollectiveTemplateLabels,
} from "@guild-os/domain";
import type {
  InitializeGuildRequest,
  UiInitializationBootstrapState,
} from "../../src/management-types";
import { localizeTemplate } from "../collective-language";
import { ContextProfilePreview } from "../components/ContextProfilePreview";
import { Notice } from "../components/Notice";
import { useI18n, type TranslationKey } from "../i18n";

type InitializationChoice = CollectiveTemplateKey | "custom";
type CustomVocabularyKey = "members" | "memory" | "activity" | "decisions";

const contextFields: readonly {
  key: keyof CollectiveOnboardingAnswers;
  label: TranslationKey;
  placeholder: TranslationKey;
}[] = [
  { key: "purpose", label: "initialization.purpose", placeholder: "initialization.purposePlaceholder" },
  { key: "participants", label: "initialization.participants", placeholder: "initialization.participantsPlaceholder" },
  { key: "memoryIntent", label: "initialization.memoryIntent", placeholder: "initialization.memoryIntentPlaceholder" },
  { key: "activityIntent", label: "initialization.activityIntent", placeholder: "initialization.activityIntentPlaceholder" },
  { key: "decisionStyle", label: "initialization.decisionStyle", placeholder: "initialization.decisionStylePlaceholder" },
];

const customVocabularyFields: readonly {
  key: CustomVocabularyKey;
  label: TranslationKey;
  placeholder: TranslationKey;
}[] = [
  { key: "members", label: "initialization.customMembers", placeholder: "initialization.customMembersPlaceholder" },
  { key: "memory", label: "initialization.customMemory", placeholder: "initialization.customMemoryPlaceholder" },
  { key: "activity", label: "initialization.customActivity", placeholder: "initialization.customActivityPlaceholder" },
  { key: "decisions", label: "initialization.customDecisions", placeholder: "initialization.customDecisionsPlaceholder" },
];

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
  const [choice, setChoice] = useState<InitializationChoice>("personal");
  const [displayName, setDisplayName] = useState("");
  const [answerOverrides, setAnswerOverrides] = useState<Partial<CollectiveOnboardingAnswers>>({});
  const [customVocabulary, setCustomVocabulary] = useState<Partial<Record<CustomVocabularyKey, string>>>({});
  const [rootOwnershipAccepted, setRootOwnershipAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templatesByKey = useMemo(
    () => new Map(templates.map((template) => [template.key, template])),
    [templates],
  );
  const isCustom = choice === "custom";
  const templateKey: CollectiveTemplateKey = isCustom ? "blank" : choice;
  const defaultCustomVocabulary = useMemo<Record<CustomVocabularyKey, string>>(() => ({
    members: t("initialization.customMembersDefault"),
    memory: t("initialization.customMemoryDefault"),
    activity: t("initialization.customActivityDefault"),
    decisions: t("initialization.customDecisionsDefault"),
  }), [t]);

  function customVocabularyValue(key: CustomVocabularyKey): string {
    return customVocabulary[key] ?? defaultCustomVocabulary[key];
  }

  const vocabularyOverrides = useMemo<Partial<CollectiveTemplateLabels>>(() => {
    if (!isCustom) return {};
    const members = (customVocabulary.members ?? defaultCustomVocabulary.members).trim();
    const memory = (customVocabulary.memory ?? defaultCustomVocabulary.memory).trim();
    const activity = (customVocabulary.activity ?? defaultCustomVocabulary.activity).trim();
    const decisions = (customVocabulary.decisions ?? defaultCustomVocabulary.decisions).trim();
    return {
      members,
      memory,
      remember: t("initialization.customRemember", { memory }),
      activity,
      startActivity: t("initialization.customStartActivity", { activity }),
      decisions,
    };
  }, [customVocabulary, defaultCustomVocabulary, isCustom, t]);
  const selectedTemplate = useMemo<CollectiveTemplate>(() => {
    const template = templatesByKey.get(templateKey) ?? templates[0]!;
    if (!isCustom) return template;
    return {
      ...template,
      name: t("initialization.customProfileName"),
      description: t("initialization.customProfileDescription"),
      labels: { ...template.labels, ...vocabularyOverrides },
    };
  }, [isCustom, templateKey, templates, templatesByKey, t, vocabularyOverrides]);
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
    return answerOverrides[key] ?? (isCustom ? "" : defaultAnswers[key]);
  }

  function selectChoice(nextChoice: InitializationChoice): void {
    setChoice(nextChoice);
    setAnswerOverrides({});
    if (nextChoice === "custom") setCustomVocabulary({});
  }

  function renderTemplateOption(key: CollectiveTemplateKey) {
    const template = templatesByKey.get(key);
    if (!template) return null;
    const selected = template.key === choice;
    const Icon = templateIcons[template.key];
    return (
      <button
        className={selected ? "template-option template-option-selected" : "template-option"}
        type="button"
        key={template.key}
        aria-pressed={selected}
        onClick={() => selectChoice(template.key)}
      >
        <span className="template-icon" aria-hidden="true"><Icon size={20} /></span>
        <span className="template-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
        <strong>{template.name}</strong>
        <span>{template.description}</span>
        {template.key === "personal" ? <small>{t("initialization.templateRecommended")}</small> : null}
      </button>
    );
  }

  function renderCustomOption() {
    const selected = choice === "custom";
    return (
      <button
        className={selected
          ? "template-option template-option-wide template-option-selected"
          : "template-option template-option-wide"}
        type="button"
        key="custom"
        aria-pressed={selected}
        onClick={() => selectChoice("custom")}
      >
        <span className="template-icon" aria-hidden="true"><SlidersHorizontal size={20} /></span>
        <span className="template-check" aria-hidden="true">{selected ? <Check size={16} /> : null}</span>
        <strong>{t("initialization.customProfileName")}</strong>
        <span>{t("initialization.customProfileDescription")}</span>
        <small>{t("initialization.customProfileGuided")}</small>
      </button>
    );
  }

  function renderContextFields() {
    return contextFields.map((field) => (
      <label key={field.key}>
        <span>{t(field.label)}</span>
        <textarea
          required
          maxLength={2_000}
          rows={2}
          value={answer(field.key)}
          placeholder={t(field.placeholder)}
          onChange={(event) => setAnswerOverrides((current) => ({
            ...current,
            [field.key]: event.target.value,
          }))}
        />
      </label>
    ));
  }

  const contextComplete = contextFields.every((field) => answer(field.key).trim().length > 0);
  const customVocabularyComplete = customVocabularyFields.every(
    (field) => customVocabularyValue(field.key).trim().length > 0,
  );

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
        vocabularyOverrides,
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
            {renderCustomOption()}
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
            {isCustom ? (
              <>
                <section className="initialization-custom-vocabulary" aria-labelledby="custom-vocabulary-title">
                  <h2 id="custom-vocabulary-title">{t("initialization.customVocabularyTitle")}</h2>
                  <p>{t("initialization.customVocabularyDescription")}</p>
                  <div className="form-grid">
                    {customVocabularyFields.map((field) => (
                      <label key={field.key}>
                        <span>{t(field.label)}</span>
                        <input
                          required
                          maxLength={200}
                          value={customVocabularyValue(field.key)}
                          placeholder={t(field.placeholder)}
                          onChange={(event) => setCustomVocabulary((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <section className="initialization-context-customization initialization-context-required" aria-labelledby="custom-context-title">
                  <h2 id="custom-context-title">{t("initialization.customContextTitle")}</h2>
                  <p>{t("initialization.customContextDescription")}</p>
                  {renderContextFields()}
                </section>
              </>
            ) : (
              <details className="initialization-context-customization">
                <summary>{t("initialization.advancedTitle")}</summary>
                <p>{t("initialization.advancedDescription")}</p>
                {renderContextFields()}
              </details>
            )}
            {error ? <Notice kind="error">{error}</Notice> : null}
            <footer className="dialog-actions initialization-form-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("template")}>
                <ArrowLeft size={17} /><span>{t("common.back")}</span>
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={submitting || !displayName.trim() || !rootOwnershipAccepted ||
                  !contextComplete || !customVocabularyComplete}
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
