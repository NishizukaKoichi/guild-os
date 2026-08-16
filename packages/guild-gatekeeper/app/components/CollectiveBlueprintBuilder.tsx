import { Check, Pencil, Save, Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  assertCollectiveBlueprintDraft,
  type CollectiveBlueprintDraft,
  type CollectiveOnboardingAnswers,
} from "@guild-os/domain";
import type {
  GenerateCollectiveBlueprintRequest,
  SaveCollectiveBlueprintRequest,
  UiCollectiveBlueprint,
} from "../../src/management-types";
import { useI18n, type TranslationKey } from "../i18n";
import { BlueprintEditor } from "./BlueprintEditor";
import { Notice } from "./Notice";

const questionFields: readonly {
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

const emptyAnswers: CollectiveOnboardingAnswers = {
  purpose: "",
  participants: "",
  memoryIntent: "",
  activityIntent: "",
  decisionStyle: "",
};

function editableDraft(record: UiCollectiveBlueprint): CollectiveBlueprintDraft {
  return {
    key: record.key,
    locale: record.locale,
    generationMode: record.generationMode,
    generationWarnings: record.generationWarnings,
    onboardingAnswers: record.onboardingAnswers,
    definition: record.definition,
  };
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function CollectiveBlueprintBuilder({
  blueprints,
  canConfigure,
  onGenerate,
  onSave,
}: {
  blueprints: readonly UiCollectiveBlueprint[];
  canConfigure: boolean;
  onGenerate(input: GenerateCollectiveBlueprintRequest): Promise<CollectiveBlueprintDraft>;
  onSave(input: SaveCollectiveBlueprintRequest): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<"closed" | "questions" | "review">("closed");
  const [answers, setAnswers] = useState<CollectiveOnboardingAnswers>(emptyAnswers);
  const [draft, setDraft] = useState<CollectiveBlueprintDraft | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setMode("closed");
    setDraft(null);
    setExpectedVersion(null);
    setError(null);
  }

  function startNew(): void {
    setAnswers(emptyAnswers);
    setDraft(null);
    setExpectedVersion(null);
    setSaved(false);
    setError(null);
    setMode("questions");
  }

  function startEdit(record: UiCollectiveBlueprint): void {
    setAnswers(record.onboardingAnswers);
    setDraft(editableDraft(record));
    setExpectedVersion(record.version);
    setSaved(false);
    setError(null);
    setMode("review");
  }

  async function generate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setGenerating(true);
    setSaved(false);
    setError(null);
    try {
      const generated = await onGenerate({ locale, ...answers });
      setDraft(generated);
      setExpectedVersion(null);
      setMode("review");
    } catch (cause) {
      setError(messageFrom(cause, t("collective.blueprintGenerateError")));
    } finally {
      setGenerating(false);
    }
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      assertCollectiveBlueprintDraft(draft);
      await onSave({ draft, expectedVersion, status: "active" });
      setSaved(true);
      setMode("closed");
      setDraft(null);
      setExpectedVersion(null);
    } catch (cause) {
      setError(messageFrom(cause, t("collective.blueprintSaveError")));
    } finally {
      setSaving(false);
    }
  }

  const complete = questionFields.every((field) => answers[field.key].trim().length > 0);
  const activeBlueprints = blueprints.filter((blueprint) => blueprint.status === "active");

  return (
    <section className="collective-blueprint-library" aria-labelledby="collective-blueprint-title">
      <header className="manager-heading">
        <div>
          <h3 id="collective-blueprint-title">{t("collective.blueprintsTitle")}</h3>
          <p>{t("collective.blueprintsDescription")}</p>
        </div>
        {canConfigure && mode === "closed" ? (
          <button className="secondary-button" type="button" onClick={startNew}>
            <Sparkles size={16} />{t("collective.createBlueprint")}
          </button>
        ) : null}
      </header>

      {activeBlueprints.length > 0 ? (
        <div className="collective-blueprint-list">
          {activeBlueprints.map((blueprint) => (
            <div className="collective-blueprint-row" key={blueprint.key}>
              <div>
                <strong>{blueprint.definition.name}</strong>
                <small>{t("collective.blueprintVersion", { version: blueprint.version })}</small>
              </div>
              <span>{blueprint.definition.description}</span>
              {canConfigure ? (
                <button className="icon-button" type="button" title={t("collective.editBlueprint")} aria-label={`${t("collective.editBlueprint")}: ${blueprint.definition.name}`} onClick={() => startEdit(blueprint)}>
                  <Pencil size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : mode === "closed" ? <Notice>{t("collective.noBlueprints")}</Notice> : null}

      {mode === "questions" ? (
        <form className="collective-blueprint-builder stack-form" data-blueprint-builder="questions" onSubmit={generate}>
          <div className="section-heading-row">
            <Sparkles size={18} />
            <div><h3>{t("collective.builderTitle")}</h3><p>{t("collective.builderDescription")}</p></div>
          </div>
          {questionFields.map((field) => (
            <label key={field.key}>
              <span>{t(field.label)}</span>
              <textarea data-onboarding-field={field.key} required rows={2} maxLength={2_000} value={answers[field.key]} placeholder={t(field.placeholder)} onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} />
            </label>
          ))}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={close}><X size={16} />{t("common.cancel")}</button>
            <button className="primary-button" data-blueprint-action="generate" type="submit" disabled={generating || !complete}><Sparkles size={16} />{t(generating ? "initialization.blueprintGenerating" : "initialization.blueprintGenerate")}</button>
          </footer>
        </form>
      ) : null}

      {mode === "review" && draft ? (
        <div className="collective-blueprint-builder collective-blueprint-review" data-blueprint-builder="review">
          <div className="section-heading-row">
            <Check size={18} />
            <div><h3>{t(expectedVersion === null ? "collective.reviewBlueprintTitle" : "collective.editBlueprintTitle")}</h3><p>{t("collective.reviewBlueprintDescription")}</p></div>
          </div>
          <Notice>{t("collective.roleSafety")}</Notice>
          <BlueprintEditor draft={draft} onChange={setDraft} compact />
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={close}><X size={16} />{t("common.cancel")}</button>
            <button className="primary-button" data-blueprint-action="save" type="button" disabled={saving} onClick={() => void save()}><Save size={16} />{t(saving ? "collective.savingBlueprint" : "collective.saveBlueprint")}</button>
          </footer>
        </div>
      ) : null}

      {saved ? <Notice kind="success">{t("collective.blueprintSaved")}</Notice> : null}
    </section>
  );
}
