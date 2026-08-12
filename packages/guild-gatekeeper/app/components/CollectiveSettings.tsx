import { Network, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CollectiveTemplateKey,
  CollectiveTemplateLabels,
} from "@guild-os/domain";
import type {
  ConfigureCollectiveRequest,
  SetSpaceVocabularyRequest,
  UiCollectiveContext,
} from "../../src/management-types";
import { Notice } from "./Notice";
import { useI18n } from "../i18n";

export function CollectiveSettings({
  collective,
  onConfigure,
  onSetSpaceVocabulary,
}: {
  collective: UiCollectiveContext;
  onConfigure(input: ConfigureCollectiveRequest): Promise<void>;
  onSetSpaceVocabulary(input: SetSpaceVocabularyRequest): Promise<void>;
}) {
  const { t } = useI18n();
  const [templateKey, setTemplateKey] = useState<CollectiveTemplateKey>(collective.template.key);
  const [overrides, setOverrides] = useState<Partial<CollectiveTemplateLabels>>(collective.vocabularyOverrides);
  const [busy, setBusy] = useState(false);
  const [spaceBusy, setSpaceBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTemplateKey(collective.template.key);
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
      await onConfigure({
        templateKey,
        vocabularyOverrides: overrides,
        onboardingAnswers: collective.onboardingAnswers,
      });
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
      await onSetSpaceVocabulary({
        spaceId,
        templateKey: value ? value as CollectiveTemplateKey : null,
      });
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
        <select id="collective-template" disabled={!collective.canConfigure} value={templateKey} onChange={(event) => setTemplateKey(event.target.value as CollectiveTemplateKey)}>
          {collective.templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
        </select>
      </label>
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
              <label key={key}><span>{t(label)}</span><input maxLength={200} value={overrides[key] ?? ""} placeholder={collective.template.labels[key]} onChange={(event) => setOverride(key, event.target.value)} /></label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {collective.canConfigureSpaces ? (
        <div className="space-vocabulary-list">
          <h3>{t("collective.spaceVocabulary")}</h3>
          {collective.spaces.map((space) => (
            <label key={space.id} htmlFor={`space-vocabulary-${space.id}`}><span>{space.name}</span><select id={`space-vocabulary-${space.id}`} data-space-name={space.name} disabled={!space.canConfigure || spaceBusy === space.id} value={space.vocabularyProfileKey ?? ""} onChange={(event) => void setSpace(space.id, event.target.value)}><option value="">{t("collective.inherit")}</option>{collective.templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</select></label>
          ))}
        </div>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {saved ? <Notice kind="success">{t("collective.saved")}</Notice> : null}
      {collective.canConfigure ? <div className="settings-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => void save()}><Save size={17} />{t("collective.save")}</button></div> : null}
    </section>
  );
}
