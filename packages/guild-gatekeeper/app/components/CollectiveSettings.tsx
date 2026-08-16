import { Network, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  blueprintToCollectiveTemplate,
  type CollectiveBlueprintDraft,
  type CollectiveTemplateKey,
  type CollectiveTemplateLabels,
} from "@guild-os/domain";
import type {
  ConfigureCollectiveRequest,
  GenerateCollectiveBlueprintRequest,
  SaveCollectiveBlueprintRequest,
  SetSpaceVocabularyRequest,
  UiCollectiveContext,
} from "../../src/management-types";
import { CollectiveBlueprintBuilder } from "./CollectiveBlueprintBuilder";
import { ContextProfilePreview } from "./ContextProfilePreview";
import { Notice } from "./Notice";
import { useI18n } from "../i18n";

type ContextSelection = `template:${CollectiveTemplateKey}` | `blueprint:custom-${string}`;

function currentSelection(collective: UiCollectiveContext): ContextSelection {
  return collective.blueprint
    ? `blueprint:${collective.blueprint.key}`
    : `template:${collective.template.key}`;
}

function isBlueprintSelection(value: ContextSelection): value is `blueprint:custom-${string}` {
  return value.startsWith("blueprint:");
}

export function CollectiveSettings({
  collective,
  onGenerateBlueprint,
  onSaveBlueprint,
  onConfigure,
  onSetSpaceVocabulary,
}: {
  collective: UiCollectiveContext;
  onGenerateBlueprint(input: GenerateCollectiveBlueprintRequest): Promise<CollectiveBlueprintDraft>;
  onSaveBlueprint(input: SaveCollectiveBlueprintRequest): Promise<void>;
  onConfigure(input: ConfigureCollectiveRequest): Promise<void>;
  onSetSpaceVocabulary(input: SetSpaceVocabularyRequest): Promise<void>;
}) {
  const { t } = useI18n();
  const [selection, setSelection] = useState<ContextSelection>(currentSelection(collective));
  const [overrides, setOverrides] = useState<Partial<CollectiveTemplateLabels>>(collective.vocabularyOverrides);
  const [busy, setBusy] = useState(false);
  const [spaceBusy, setSpaceBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeBlueprints = collective.blueprints.filter((blueprint) => blueprint.status === "active");
  const selectedTemplate = useMemo(() => {
    if (isBlueprintSelection(selection)) {
      const key = selection.slice("blueprint:".length);
      const blueprint = activeBlueprints.find((candidate) => candidate.key === key);
      return blueprint ? blueprintToCollectiveTemplate(blueprint) : collective.template;
    }
    const key = selection.slice("template:".length) as CollectiveTemplateKey;
    return collective.templates.find((template) => template.key === key) ?? collective.template;
  }, [activeBlueprints, collective.template, collective.templates, selection]);

  useEffect(() => {
    setSelection(currentSelection(collective));
    setOverrides(collective.vocabularyOverrides);
  }, [collective]);

  function setOverride(key: keyof CollectiveTemplateLabels, value: string) {
    setOverrides((current) => {
      const next = { ...current };
      if (value.trim()) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      if (isBlueprintSelection(selection)) {
        await onConfigure({
          templateKey: "blank",
          blueprintKey: selection.slice("blueprint:".length) as `custom-${string}`,
          vocabularyOverrides: overrides,
          onboardingAnswers: collective.onboardingAnswers,
        });
      } else {
        await onConfigure({
          templateKey: selection.slice("template:".length) as CollectiveTemplateKey,
          blueprintKey: null,
          vocabularyOverrides: overrides,
          onboardingAnswers: collective.onboardingAnswers,
        });
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function setSpace(spaceId: string, value: string) {
    setSpaceBusy(spaceId);
    setSaved(false);
    setError(null);
    try {
      if (value.startsWith("blueprint:")) {
        await onSetSpaceVocabulary({
          spaceId,
          templateKey: null,
          blueprintKey: value.slice("blueprint:".length) as `custom-${string}`,
        });
      } else {
        await onSetSpaceVocabulary({
          spaceId,
          templateKey: value ? value.slice("template:".length) as CollectiveTemplateKey : null,
          blueprintKey: null,
        });
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setSpaceBusy(null);
    }
  }

  return (
    <section className="content-section settings-section collective-settings">
      <div className="section-heading-row">
        <Network size={19} />
        <div><h2>{t("collective.title")}</h2><p>{t("collective.subtitle")}</p></div>
      </div>
      <label htmlFor="collective-template">
        <span>{t("collective.template")}</span>
        <select id="collective-template" disabled={!collective.canConfigure} value={selection} onChange={(event) => setSelection(event.target.value as ContextSelection)}>
          <optgroup label={t("collective.builtInProfiles")}>
            {collective.templates.map((template) => <option key={template.key} value={`template:${template.key}`}>{template.name}</option>)}
          </optgroup>
          {activeBlueprints.length > 0 ? (
            <optgroup label={t("collective.savedBlueprints")}>
              {activeBlueprints.map((blueprint) => <option key={blueprint.key} value={`blueprint:${blueprint.key}`}>{blueprint.definition.name}</option>)}
            </optgroup>
          ) : null}
        </select>
      </label>
      <ContextProfilePreview template={selectedTemplate} />
      <Notice kind="info">{t("collective.profileEffect")}</Notice>
      <Notice>{t("collective.roleSafety")}</Notice>
      {collective.canConfigure ? (
        <fieldset>
          <legend>{t("collective.overrides")}</legend>
          <div className="form-grid">
            {([
              ["members", "collective.membersLabel"],
              ["memory", "collective.memoryLabel"],
              ["activity", "collective.activityLabel"],
              ["decisions", "collective.decisionsLabel"],
            ] as const).map(([key, label]) => (
              <label key={key}><span>{t(label)}</span><input maxLength={200} value={overrides[key] ?? ""} placeholder={selectedTemplate.labels[key]} onChange={(event) => setOverride(key, event.target.value)} /></label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <CollectiveBlueprintBuilder
        blueprints={collective.blueprints}
        canConfigure={collective.canConfigure}
        onGenerate={onGenerateBlueprint}
        onSave={onSaveBlueprint}
      />

      {collective.canConfigureSpaces ? (
        <div className="space-context-profile-list">
          <h3>{t("collective.spaceVocabulary")}</h3>
          <p>{t("collective.spaceVocabularyDescription")}</p>
          {collective.spaces.map((space) => {
            const value = space.blueprintKey
              ? `blueprint:${space.blueprintKey}`
              : space.vocabularyProfileKey ? `template:${space.vocabularyProfileKey}` : "";
            return (
              <label key={space.id} htmlFor={`space-vocabulary-${space.id}`}>
                <span>{space.name}</span>
                <select id={`space-vocabulary-${space.id}`} data-space-name={space.name} disabled={!space.canConfigure || spaceBusy === space.id} value={value} onChange={(event) => void setSpace(space.id, event.target.value)}>
                  <option value="">{t("collective.inherit")}</option>
                  <optgroup label={t("collective.builtInProfiles")}>
                    {collective.templates.map((template) => <option key={template.key} value={`template:${template.key}`}>{template.name}</option>)}
                  </optgroup>
                  {activeBlueprints.length > 0 ? (
                    <optgroup label={t("collective.savedBlueprints")}>
                      {activeBlueprints.map((blueprint) => <option key={blueprint.key} value={`blueprint:${blueprint.key}`}>{blueprint.definition.name}</option>)}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            );
          })}
        </div>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {saved ? <Notice kind="success">{t("collective.saved")}</Notice> : null}
      {collective.canConfigure ? <div className="settings-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => void save()}><Save size={17} />{t("collective.save")}</button></div> : null}
    </section>
  );
}
