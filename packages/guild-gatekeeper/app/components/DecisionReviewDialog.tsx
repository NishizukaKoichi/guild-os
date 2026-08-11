import { Check, X } from "lucide-react";
import { useState } from "react";
import type { GuildUiApi, UiDecisionDetail } from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function DecisionReviewDialog({
  api,
  detail,
  onReviewed,
  onClose,
}: {
  api: GuildUiApi;
  detail: UiDecisionDetail;
  onReviewed(): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<"approve" | "reject">("approve");
  const [selectedOptionId, setSelectedOptionId] = useState(detail.options[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reviewDecision({
        decisionId: detail.decision.id,
        expectedVersion: detail.decision.version,
        verdict,
        selectedOptionId: verdict === "approve" ? selectedOptionId : null,
        reason,
      });
      await onReviewed();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-review-title">
        <header className="dialog-header">
          <div>
            <h2 id="decision-review-title">{t("decision.reviewTitle")}</h2>
            <small>{detail.decision.title}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="segmented-control" role="group" aria-label={t("decision.review") }>
            <button className={verdict === "approve" ? "segment-active" : ""} type="button" onClick={() => setVerdict("approve")}>
              <Check size={16} />{t("decision.approve")}
            </button>
            <button className={verdict === "reject" ? "segment-active segment-danger" : ""} type="button" onClick={() => setVerdict("reject")}>
              <X size={16} />{t("decision.reject")}
            </button>
          </div>
          {verdict === "approve" ? (
            <fieldset className="decision-review-options">
              <legend>{t("decision.options")}</legend>
              {detail.options.map((option) => (
                <label className="decision-review-option" key={option.id}>
                  <input
                    type="radio"
                    name="decision-option"
                    value={option.id}
                    checked={selectedOptionId === option.id}
                    onChange={() => setSelectedOptionId(option.id)}
                  />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <label>
            <span>{t("decision.reviewReason")}</span>
            <textarea required rows={4} maxLength={5_000} value={reason} placeholder={t("decision.reviewReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className={verdict === "reject" ? "secondary-button danger-button" : "primary-button"} type="submit" disabled={busy || verdict === "approve" && !selectedOptionId}>
              {verdict === "approve" ? <Check size={17} /> : <X size={17} />}
              {t(verdict === "approve" ? "decision.approve" : "decision.reject")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
