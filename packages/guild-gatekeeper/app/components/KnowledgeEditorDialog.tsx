import { BookPlus, Save, X } from "lucide-react";
import { useState } from "react";
import {
  CLASSIFICATIONS,
  SUPPORTED_LOCALES,
  VISIBILITIES,
  type AppLocale,
  type Classification,
  type LocalizedText,
  type Visibility,
} from "@guild-os/domain";
import type {
  CreateKnowledgeRequest,
  SaveKnowledgeDraftRequest,
  UiDirectory,
  UiKnowledgeDetail,
} from "../../src/management-types";
import {
  classificationTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";
import { Notice } from "./Notice";

interface KnowledgeEditorDialogProps {
  directory: UiDirectory;
  knowledge: UiKnowledgeDetail | null;
  onCreate(input: CreateKnowledgeRequest): Promise<void>;
  onSave(input: SaveKnowledgeDraftRequest): Promise<void>;
  onClose(): void;
}

function localizedValue(value: LocalizedText, locale: AppLocale): string {
  return value[locale] ?? "";
}

function setLocalizedValue(
  current: LocalizedText,
  locale: AppLocale,
  value: string,
): LocalizedText {
  return { ...current, [locale]: value };
}

export function KnowledgeEditorDialog({
  directory,
  knowledge,
  onCreate,
  onSave,
  onClose,
}: KnowledgeEditorDialogProps) {
  const { locale, t } = useI18n();
  const activeSpaces = directory.spaces.filter((space) => space.status === "active");
  const currentVersion = knowledge?.versions.find((version) =>
    version.version === knowledge.currentVersion) ?? null;
  const [contentLocale, setContentLocale] = useState<AppLocale>(locale);
  const [title, setTitle] = useState<LocalizedText>(currentVersion?.title ?? {});
  const [summary, setSummary] = useState<LocalizedText>(currentVersion?.summary ?? {});
  const [body, setBody] = useState<LocalizedText>(currentVersion?.body ?? {});
  const [changeNote, setChangeNote] = useState("");
  const [spaceId, setSpaceId] = useState(knowledge?.spaceId ?? activeSpaces[0]?.id ?? "");
  const [visibility, setVisibility] = useState<Visibility>(knowledge?.visibility ??
    (activeSpaces.length > 0 ? "space" : "guild"));
  const [classification, setClassification] = useState<Classification>(
    knowledge?.classification ?? "internal",
  );
  const [allowedIdentityIds, setAllowedIdentityIds] = useState<ReadonlySet<string>>(
    new Set(knowledge?.allowedIdentityIds ?? []),
  );
  const [reviewDue, setReviewDue] = useState(knowledge?.reviewDueAt?.slice(0, 10) ?? "");
  const [sourceText, setSourceText] = useState((currentVersion?.sourceIds ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const securityLocked = knowledge?.canonicalVersion !== null && knowledge?.canonicalVersion !== undefined;

  function toggleIdentity(identityId: string) {
    setAllowedIdentityIds((current) => {
      const next = new Set(current);
      if (next.has(identityId)) next.delete(identityId);
      else next.add(identityId);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const sourceIds = sourceText.split("\n").map((value) => value.trim()).filter(Boolean);
      if (knowledge) {
        await onSave({
          knowledgeId: knowledge.id,
          expectedVersion: knowledge.currentVersion,
          spaceId: spaceId || null,
          visibility,
          classification,
          allowedIdentityIds: showExplicitAccess ? [...allowedIdentityIds] : [],
          reviewDueAt: reviewDue ? new Date(`${reviewDue}T00:00:00.000Z`).toISOString() : null,
          title,
          summary,
          body,
          sourceIds,
          changeNote,
        });
      } else {
        await onCreate({
          spaceId: spaceId || null,
          visibility,
          classification,
          allowedIdentityIds: showExplicitAccess ? [...allowedIdentityIds] : [],
          reviewDueAt: reviewDue ? new Date(`${reviewDue}T00:00:00.000Z`).toISOString() : null,
          title,
          summary,
          body,
          sourceIds,
          changeNote,
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  const showExplicitAccess = visibility === "restricted" || visibility === "private";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-knowledge" role="dialog" aria-modal="true" aria-labelledby="knowledge-editor-title">
        <header className="dialog-header">
          <div>
            <h2 id="knowledge-editor-title">{t(knowledge ? "knowledge.editTitle" : "knowledge.createTitle")}</h2>
            {knowledge ? <small>v{knowledge.currentVersion}</small> : null}
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <label>
            <span>{t("knowledge.contentLanguage")}</span>
            <select value={contentLocale} onChange={(event) => setContentLocale(event.target.value as AppLocale)}>
              {SUPPORTED_LOCALES.map((value) => (
                <option key={value} value={value}>{t(`language.${value}`)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("knowledge.titleLabel")}</span>
            <input
              required
              maxLength={200}
              value={localizedValue(title, contentLocale)}
              placeholder={t("knowledge.titlePlaceholder")}
              onChange={(event) => setTitle((current) =>
                setLocalizedValue(current, contentLocale, event.target.value))}
            />
          </label>
          <label>
            <span>{t("knowledge.summaryLabel")}</span>
            <textarea
              required
              rows={3}
              maxLength={2_000}
              value={localizedValue(summary, contentLocale)}
              placeholder={t("knowledge.summaryPlaceholder")}
              onChange={(event) => setSummary((current) =>
                setLocalizedValue(current, contentLocale, event.target.value))}
            />
          </label>
          <label>
            <span>{t("knowledge.bodyLabel")}</span>
            <textarea
              required
              className="knowledge-body-input"
              rows={12}
              maxLength={200_000}
              value={localizedValue(body, contentLocale)}
              placeholder={t("knowledge.bodyPlaceholder")}
              onChange={(event) => setBody((current) =>
                setLocalizedValue(current, contentLocale, event.target.value))}
            />
          </label>
          <>
              <div className="form-grid">
                <label>
                  <span>{t("knowledge.space")}</span>
                  <select disabled={securityLocked} value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                    <option value="">{t("people.global")}</option>
                    {activeSpaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t("knowledge.visibility")}</span>
                  <select disabled={securityLocked} value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
                    {VISIBILITIES.map((value) => (
                      <option key={value} value={value}>{t(visibilityTranslationKey(value))}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  <span>{t("knowledge.classification")}</span>
                  <select disabled={securityLocked} value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>
                    {CLASSIFICATIONS.map((value) => (
                      <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("knowledge.reviewDue")}</span>
                  <input type="date" value={reviewDue} onChange={(event) => setReviewDue(event.target.value)} />
                </label>
              </div>
              {showExplicitAccess ? (
                <fieldset>
                  <legend>{t("knowledge.sharedWith")}</legend>
                  <p className="field-help">{t("knowledge.sharedHelp")}</p>
                  <div className="permission-grid identity-share-grid">
                    {directory.identities.filter((identity) => identity.status === "active").map((identity) => (
                      <label className="checkbox-row" key={identity.id}>
                        <input
                          type="checkbox"
                          disabled={securityLocked}
                          checked={allowedIdentityIds.has(identity.id)}
                          onChange={() => toggleIdentity(identity.id)}
                        />
                        <span>{identity.displayName}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
          </>
          <label>
            <span>{t("knowledge.sources")}</span>
            <textarea rows={3} value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
            <small className="field-help">{t("knowledge.sourcesHelp")}</small>
          </label>
          <label>
            <span>{t("knowledge.changeNote")}</span>
            <textarea
              required
              rows={2}
              maxLength={2_000}
              value={changeNote}
              placeholder={t("knowledge.changeNotePlaceholder")}
              onChange={(event) => setChangeNote(event.target.value)}
            />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>
              {knowledge ? <Save size={17} /> : <BookPlus size={17} />}
              <span>{t(knowledge ? "common.save" : "common.create")}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
