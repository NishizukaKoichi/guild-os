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
  Sparkles,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  COLLECTIVE_TEMPLATES,
  assertCollectiveBlueprintDraft,
  type AppLocale,
  type CollectiveBlueprintDraft,
  type CollectiveOnboardingAnswers,
  type CollectiveTemplate,
  type CollectiveTemplateKey,
} from "@guild-os/domain";
import type {
  InitializeGuildRequest,
  UiInitializationBootstrapState,
} from "../../src/management-types";
import { localizeTemplate } from "../collective-language";
import { BlueprintEditor } from "../components/BlueprintEditor";
import { ContextProfilePreview } from "../components/ContextProfilePreview";
import { Notice } from "../components/Notice";
import { useI18n, type TranslationKey } from "../i18n";

type InitializationChoice = CollectiveTemplateKey | "custom";

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
  onGenerateBlueprint,
  onInitialize,
}: {
  bootstrap: UiInitializationBootstrapState;
  onGenerateBlueprint(input: {
    locale: AppLocale;
    purpose: string;
    participants: string;
    memoryIntent: string;
    activityIntent: string;
    decisionStyle: string;
  }): Promise<CollectiveBlueprintDraft>;
  onInitialize(input: InitializeGuildRequest): Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const templates = useMemo(
    () => COLLECTIVE_TEMPLATES.map((template) => localizeTemplate(template, locale)),
    [locale],
  );
  const [step, setStep] = useState<"template" | "purpose" | "review" | "owner">("template");
  const [choice, setChoice] = useState<InitializationChoice>("personal");
  const [displayName, setDisplayName] = useState("");
  const [answerOverrides, setAnswerOverrides] = useState<Partial<CollectiveOnboardingAnswers>>({});
  const [blueprint, setBlueprint] = useState<CollectiveBlueprintDraft | null>(null);
  const [rootOwnershipAccepted, setRootOwnershipAccepted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const generateLock = useRef(false);
  const submitLock = useRef(false);
  const templatesByKey = useMemo(
    () => new Map(templates.map((template) => [template.key, template])),
    [templates],
  );
  const isCustom = choice === "custom";
  const templateKey: CollectiveTemplateKey = isCustom ? "blank" : choice;
  const selectedTemplate = useMemo<CollectiveTemplate>(() => {
    const template = templatesByKey.get(templateKey) ?? templates[0]!;
    if (!isCustom) return template;
    return {
      ...template,
      name: t("initialization.customProfileName"),
      description: t("initialization.customProfileDescription"),
    };
  }, [isCustom, templateKey, templates, templatesByKey, t]);
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
  const dirty = step !== "template" || choice !== "personal" || displayName.trim() !== "" ||
    Object.keys(answerOverrides).length > 0 || blueprint !== null || rootOwnershipAccepted;

  useEffect(() => {
    if (!dirty || submitting) return;
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty, submitting]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function answer(key: keyof CollectiveOnboardingAnswers): string {
    return answerOverrides[key] ?? (isCustom ? "" : defaultAnswers[key]);
  }

  function selectChoice(nextChoice: InitializationChoice): void {
    setChoice(nextChoice);
    setAnswerOverrides({});
    setBlueprint(null);
    setError(null);
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
        data-template-choice="custom"
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

  function renderContextFields(fields = contextFields) {
    return fields.map((field) => (
      <label key={field.key}>
        <span>{t(field.label)}</span>
        <textarea
          data-onboarding-field={field.key}
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
  const canSubmit = Boolean(displayName.trim() && rootOwnershipAccepted &&
    (!isCustom ? contextComplete : blueprint));
  const summaryAnswers = blueprint?.onboardingAnswers ?? {
    purpose: answer("purpose"),
    participants: answer("participants"),
    memoryIntent: answer("memoryIntent"),
    activityIntent: answer("activityIntent"),
    decisionStyle: answer("decisionStyle"),
  };

  async function generateBlueprint(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (generateLock.current) return;
    generateLock.current = true;
    setGenerating(true);
    setError(null);
    try {
      const generated = await onGenerateBlueprint({
        locale,
        purpose: answer("purpose").trim(),
        participants: answer("participants").trim(),
        memoryIntent: answer("memoryIntent").trim(),
        activityIntent: answer("activityIntent").trim(),
        decisionStyle: answer("decisionStyle").trim(),
      });
      setBlueprint(generated);
      setStep("review");
    } catch (cause) {
      setError(messageFrom(cause, t("initialization.blueprintError")));
    } finally {
      generateLock.current = false;
      setGenerating(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const reviewedAnswers = blueprint?.onboardingAnswers;
      await onInitialize({
        displayName: displayName.trim(),
        preferredLocale: locale,
        rootOwnershipAccepted,
        templateKey,
        purpose: reviewedAnswers?.purpose ?? answer("purpose").trim(),
        participants: reviewedAnswers?.participants ?? answer("participants").trim(),
        memoryIntent: reviewedAnswers?.memoryIntent ?? answer("memoryIntent").trim(),
        activityIntent: reviewedAnswers?.activityIntent ?? answer("activityIntent").trim(),
        decisionStyle: reviewedAnswers?.decisionStyle ?? answer("decisionStyle").trim(),
        vocabularyOverrides: {},
        ...(blueprint ? { blueprint } : {}),
      });
    } catch (cause) {
      setError(messageFrom(cause, t("initialization.error")));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function acceptBlueprint(event: FormEvent): void {
    event.preventDefault();
    if (!blueprint) return;
    setError(null);
    try {
      assertCollectiveBlueprintDraft(blueprint);
      setStep("owner");
    } catch (cause) {
      setError(messageFrom(cause, t("initialization.blueprintError")));
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
            <span className="step-kicker">{t(isCustom ? "initialization.builderProfileStep" : "initialization.profileStep")}</span>
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
          <details className="initialization-profile-preview-mobile" open>
            <summary>{t("initialization.profileDetails")}</summary>
            <ContextProfilePreview template={selectedTemplate} />
          </details>
          <footer className="initialization-actions">
            <button className="primary-button" type="button" onClick={() => setStep(isCustom ? "purpose" : "owner")}>
              <span>{t("common.continue")}</span><ArrowRight size={17} />
            </button>
          </footer>
        </section>
      ) : step === "purpose" ? (
        <section className="access-panel initialization-panel initialization-purpose-panel">
          <div className="access-symbol"><Sparkles size={28} /></div>
          <span className="step-kicker">{t("initialization.builderPurposeStep")}</span>
          <h1>{t("initialization.builderPurposeTitle")}</h1>
          <p>{t("initialization.builderPurposeDescription")}</p>
          <form className="stack-form" onSubmit={generateBlueprint}>
            {renderContextFields()}
            {!contextComplete ? <p className="form-guidance" id="blueprint-required-help">{t("initialization.completePurposeAnswers")}</p> : null}
            {error ? <div ref={errorRef} tabIndex={-1}><Notice kind="error">{error}</Notice></div> : null}
            <footer className="dialog-actions initialization-form-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("template")}><ArrowLeft size={17} /><span>{t("common.back")}</span></button>
              <button className="primary-button" data-blueprint-action="generate" type="submit" aria-describedby={!contextComplete ? "blueprint-required-help" : undefined} disabled={generating || !contextComplete}>
                {generating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                <span>{t(generating ? "initialization.blueprintGenerating" : "initialization.blueprintGenerate")}</span>
              </button>
            </footer>
          </form>
        </section>
      ) : step === "review" && blueprint ? (
        <section className="collective-template-step blueprint-review-step" data-blueprint-review aria-labelledby="blueprint-review-title">
          <header className="initialization-heading">
            <span className="step-kicker">{t("initialization.builderReviewStep")}</span>
            <h1 id="blueprint-review-title">{t("initialization.builderReviewTitle")}</h1>
            <p>{t("initialization.builderReviewDescription")}</p>
          </header>
          {blueprint.generationWarnings.includes("model-fallback") ? <Notice kind="info">{t("initialization.blueprintFallback")}</Notice> : null}
          <Notice>{t("initialization.blueprintAuthoritySafety")}</Notice>
          <form noValidate onSubmit={acceptBlueprint}>
            <BlueprintEditor draft={blueprint} onChange={setBlueprint} />
            {error ? <div ref={errorRef} tabIndex={-1}><Notice kind="error">{error}</Notice></div> : null}
            <footer className="initialization-actions blueprint-review-actions">
              <button className="secondary-button" type="button" onClick={() => setStep("purpose")}><ArrowLeft size={17} /><span>{t("initialization.changeAnswers")}</span></button>
              <button className="primary-button" data-blueprint-action="accept" type="submit"><span>{t("initialization.acceptBlueprint")}</span><ArrowRight size={17} /></button>
            </footer>
          </form>
        </section>
      ) : (
        <section className="access-panel initialization-panel initialization-details-panel">
          <div className="access-symbol"><Crown size={28} /></div>
          <span className="step-kicker">{t(isCustom ? "initialization.builderOwnerStep" : "initialization.ownerStep")}</span>
          <h1>{t("initialization.detailsTitle")}</h1>
          <p>{t("initialization.detailsDescription")}</p>
          {(blueprint?.definition.suggestedAgent ?? selectedTemplate.suggestedAgent) ? (
            <Notice kind="info">{t("initialization.includedAgent", {
              agent: blueprint?.definition.labels.agent ?? selectedTemplate.labels.agent,
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
                <input id="initialization-owner-display-name" required autoFocus autoComplete="name" maxLength={200} value={displayName} placeholder={t("initialization.displayNamePlaceholder")} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
            </div>
            {!isCustom ? (
              <label>
                <span>{t("initialization.purpose")}</span>
                <textarea
                  required
                  maxLength={2_000}
                  rows={2}
                  value={answer("purpose")}
                  placeholder={t("initialization.purposePlaceholder")}
                  onChange={(event) => setAnswerOverrides((current) => ({ ...current, purpose: event.target.value }))}
                />
                <small>{t("initialization.purposeHelp")}</small>
              </label>
            ) : null}
            <section className="initialization-creation-summary" aria-labelledby="initialization-creation-summary-title">
              <h2 id="initialization-creation-summary-title">{t("initialization.creationSummaryTitle")}</h2>
              <p>{t("initialization.creationSummaryDescription")}</p>
              <dl>
                <div><dt>{t("initialization.summaryParticipants")}</dt><dd>{summaryAnswers.participants}</dd></div>
                <div><dt>{t("initialization.summaryMemory")}</dt><dd>{summaryAnswers.memoryIntent}</dd></div>
                <div><dt>{t("initialization.summaryActivity")}</dt><dd>{summaryAnswers.activityIntent}</dd></div>
                <div><dt>{t("initialization.summaryDecision")}</dt><dd>{summaryAnswers.decisionStyle}</dd></div>
              </dl>
            </section>
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
            {isCustom && blueprint ? (
              <section className="initialization-blueprint-summary" aria-labelledby="initialization-blueprint-summary-title">
                <div className="section-heading-row"><Sparkles size={18} /><div><h2 id="initialization-blueprint-summary-title">{blueprint.definition.name}</h2><p>{blueprint.definition.description}</p></div></div>
                <dl>
                  <div><dt>{t("blueprint.rolesTitle")}</dt><dd>{blueprint.definition.roles.length}</dd></div>
                  <div><dt>{t("blueprint.spacesTitle")}</dt><dd>{blueprint.definition.spaces.length}</dd></div>
                  <div><dt>{t("blueprint.memoryTypesTitle")}</dt><dd>{blueprint.definition.memoryTypes.length}</dd></div>
                  <div><dt>{t("blueprint.workflowsTitle")}</dt><dd>{blueprint.definition.workflows.length}</dd></div>
                </dl>
              </section>
            ) : (
              <details className="initialization-context-customization">
                <summary>{t("initialization.advancedTitle")}</summary>
                <p>{t("initialization.advancedDescription")}</p>
                {renderContextFields(contextFields.filter((field) => field.key !== "purpose"))}
              </details>
            )}
            {!canSubmit ? <p className="form-guidance" id="initialization-create-help">{t("initialization.createRequirements")}</p> : null}
            {error ? <div ref={errorRef} tabIndex={-1}><Notice kind="error">{error}</Notice></div> : null}
            <footer className="dialog-actions initialization-form-actions">
              <button className="secondary-button" type="button" onClick={() => setStep(isCustom ? "review" : "template")}>
                <ArrowLeft size={17} /><span>{t("common.back")}</span>
              </button>
              <button
                className="primary-button"
                data-initialization-action="create"
                type="submit"
                aria-describedby={!canSubmit ? "initialization-create-help" : undefined}
                disabled={submitting || !canSubmit}
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
