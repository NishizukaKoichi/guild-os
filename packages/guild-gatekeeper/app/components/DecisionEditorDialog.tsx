import { Plus, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CLASSIFICATIONS,
  VISIBILITIES,
  type Classification,
  type DecisionMethod,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateDecisionRequest,
  GuildUiApi,
  SaveDecisionDraftRequest,
  UiDecisionDetail,
  UiCollectiveContext,
  UiDirectory,
} from "../../src/management-types";
import { decisionMethodLabel } from "../collective-language";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";
import { Notice } from "./Notice";

interface DraftOption {
  key: string;
  label: string;
  description: string;
}

interface DecisionEditorDialogProps {
  api: GuildUiApi;
  collective: UiCollectiveContext;
  directory: UiDirectory;
  detail: UiDecisionDetail | null;
  onSaved(decisionId: string): Promise<void>;
  onClose(): void;
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timestamp(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function initialOptions(detail: UiDecisionDetail | null): DraftOption[] {
  if (detail) {
    return detail.options.map((option) => ({
      key: option.id,
      label: option.label,
      description: option.description,
    }));
  }
  return Array.from({ length: 2 }, () => ({
    key: crypto.randomUUID(),
    label: "",
    description: "",
  }));
}

function templateForSpace(collective: UiCollectiveContext, targetSpaceId: string) {
  const profileKey = collective.spaces.find((space) => space.id === targetSpaceId)
    ?.vocabularyProfileKey;
  return collective.templates.find((template) => template.key === profileKey) ?? collective.template;
}

export function DecisionEditorDialog({
  api,
  collective,
  directory,
  detail,
  onSaved,
  onClose,
}: DecisionEditorDialogProps) {
  const { locale, t } = useI18n();
  const activeSpaces = useMemo(
    () => directory.spaces.filter((space) => space.status === "active"),
    [directory.spaces],
  );
  const current = detail?.decision;
  const [title, setTitle] = useState(current?.title ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [rationale, setRationale] = useState(current?.rationale ?? "");
  const [spaceId, setSpaceId] = useState(current?.spaceId ?? activeSpaces[0]?.id ?? "");
  const [method, setMethod] = useState<DecisionMethod>(
    current?.method ?? templateForSpace(collective, current?.spaceId ?? activeSpaces[0]?.id ?? "")
      .decisionMethods[0] ?? "custodian",
  );
  const methodOptions = useMemo(() => {
    const methods = templateForSpace(collective, spaceId).decisionMethods;
    return methods.includes(method) ? methods : [method, ...methods];
  }, [collective, method, spaceId]);
  const [visibility, setVisibility] = useState<Visibility>(current?.visibility ?? "space");
  const [classification, setClassification] = useState<Classification>(
    current?.classification ?? "internal",
  );
  const [allowedIdentityIds, setAllowedIdentityIds] = useState<ReadonlySet<string>>(
    new Set(current?.allowedIdentityIds ?? []),
  );
  const [sourceText, setSourceText] = useState((current?.sourceIds ?? []).join("\n"));
  const [reviewAt, setReviewAt] = useState(localDateTime(current?.reviewAt ?? null));
  const [options, setOptions] = useState<DraftOption[]>(() => initialOptions(detail));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explicitAccess = visibility === "restricted" || visibility === "private";

  function toggleIdentity(identityId: string): void {
    setAllowedIdentityIds((currentIds) => {
      const next = new Set(currentIds);
      if (next.has(identityId)) next.delete(identityId);
      else next.add(identityId);
      return next;
    });
  }

  function updateOption(key: string, field: "label" | "description", value: string): void {
    setOptions((currentOptions) => currentOptions.map((option) =>
      option.key === key ? { ...option, [field]: value } : option));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resource: CreateDecisionRequest = {
        spaceId: spaceId || null,
        method,
        title,
        description,
        rationale,
        visibility,
        classification,
        allowedIdentityIds: explicitAccess ? [...allowedIdentityIds] : [],
        sourceIds: [...new Set(sourceText.split("\n").map((value) => value.trim()).filter(Boolean))],
        reviewAt: timestamp(reviewAt),
        options: options.map(({ label, description: optionDescription }) => ({
          label,
          description: optionDescription,
        })),
      };
      let decisionId: string;
      if (current) {
        const input: SaveDecisionDraftRequest = {
          ...resource,
          decisionId: current.id,
          expectedVersion: current.version,
        };
        await api.saveDecisionDraft(input);
        decisionId = current.id;
      } else {
        decisionId = await api.createDecision(resource);
      }
      await onSaved(decisionId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide dialog-decision" role="dialog" aria-modal="true" aria-labelledby="decision-editor-title">
        <header className="dialog-header">
          <h2 id="decision-editor-title">{t(current ? "decision.editTitle" : "decision.createTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("decision.titleLabel")}</span>
            <input required maxLength={200} value={title} placeholder={t("decision.titlePlaceholder")} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>{t("decision.descriptionLabel")}</span>
            <textarea required rows={4} maxLength={10_000} value={description} placeholder={t("decision.descriptionPlaceholder")} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>
            <span>{t("decision.rationale")}</span>
            <textarea rows={3} maxLength={10_000} value={rationale} placeholder={t("decision.rationalePlaceholder")} onChange={(event) => setRationale(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("decision.space")}</span>
              <select value={spaceId} onChange={(event) => {
                const nextSpaceId = event.target.value;
                const nextMethods = templateForSpace(collective, nextSpaceId).decisionMethods;
                setSpaceId(nextSpaceId);
                if (!nextMethods.includes(method)) setMethod(nextMethods[0] ?? "custodian");
              }}>
                <option value="">{t("people.global")}</option>
                {activeSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("decision.reviewAt")}</span>
              <input type="datetime-local" value={reviewAt} onChange={(event) => setReviewAt(event.target.value)} />
            </label>
            <label>
              <span>{t("decision.method")}</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as DecisionMethod)}>
                {methodOptions.map((value) => (
                  <option key={value} value={value}>{decisionMethodLabel(value, locale)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>{t("decision.visibility")}</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                {VISIBILITIES.map((value) => <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>)}
              </select>
            </label>
            <label>
              <span>{t("decision.classification")}</span>
              <select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
                {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}
              </select>
            </label>
          </div>
          {explicitAccess ? (
            <fieldset>
              <legend>{t("decision.sharedWith")}</legend>
              <div className="permission-grid">
                {directory.identities.filter((identity) => identity.status === "active").map((identity) => (
                  <label className="checkbox-row" key={identity.id}>
                    <input type="checkbox" checked={allowedIdentityIds.has(identity.id)} onChange={() => toggleIdentity(identity.id)} />
                    <span>{identity.displayName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label>
            <span>{t("decision.sources")}</span>
            <textarea rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
            <small>{t("decision.sourcesHelp")}</small>
          </label>
          <fieldset className="decision-options-editor">
            <legend>{t("decision.options")}</legend>
            <div className="decision-option-editor-list">
              {options.map((option, index) => (
                <div className="decision-option-editor" key={option.key}>
                  <span className="decision-option-index">{index + 1}</span>
                  <label>
                    <span>{t("decision.optionLabel")}</span>
                    <input required maxLength={200} value={option.label} placeholder={t("decision.optionLabelPlaceholder")} onChange={(event) => updateOption(option.key, "label", event.target.value)} />
                  </label>
                  <label>
                    <span>{t("decision.optionDescription")}</span>
                    <textarea rows={2} maxLength={5_000} value={option.description} placeholder={t("decision.optionDescriptionPlaceholder")} onChange={(event) => updateOption(option.key, "description", event.target.value)} />
                  </label>
                  <button
                    className="icon-button danger-button"
                    type="button"
                    disabled={options.length <= 2}
                    title={t("decision.removeOption")}
                    aria-label={t("decision.removeOption")}
                    onClick={() => setOptions((currentOptions) => currentOptions.filter((candidate) => candidate.key !== option.key))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={options.length >= 20}
              onClick={() => setOptions((currentOptions) => [...currentOptions, {
                key: crypto.randomUUID(), label: "", description: "",
              }])}
            >
              <Plus size={16} />{t("decision.addOption")}
            </button>
          </fieldset>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>
              {current ? <Save size={17} /> : <Plus size={17} />}
              {t(current ? "common.save" : "common.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
