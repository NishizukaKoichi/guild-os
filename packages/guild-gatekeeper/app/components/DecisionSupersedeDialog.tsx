import { Replace, X } from "lucide-react";
import { useState } from "react";
import type { GuildUiApi, UiDecisionSummary } from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function DecisionSupersedeDialog({
  api,
  decision,
  replacements,
  onSuperseded,
  onClose,
}: {
  api: GuildUiApi;
  decision: UiDecisionSummary;
  replacements: readonly UiDecisionSummary[];
  onSuperseded(): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [replacementDecisionId, setReplacementDecisionId] = useState(replacements[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.supersedeDecision({
        decisionId: decision.id,
        replacementDecisionId,
        expectedVersion: decision.version,
      });
      await onSuperseded();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-supersede-title">
        <header className="dialog-header">
          <div>
            <h2 id="decision-supersede-title">{t("decision.supersedeTitle")}</h2>
            <small>{decision.title}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          {!replacements.length ? <Notice>{t("decision.noReplacement")}</Notice> : (
            <label>
              <span>{t("decision.replacement")}</span>
              <select required value={replacementDecisionId} onChange={(event) => setReplacementDecisionId(event.target.value)}>
                {replacements.map((replacement) => (
                  <option key={replacement.id} value={replacement.id}>{replacement.title}</option>
                ))}
              </select>
            </label>
          )}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !replacementDecisionId}>
              <Replace size={17} />{t("decision.supersede")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
