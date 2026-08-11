import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { KnowledgeReviewVerdict } from "@guild-os/domain";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function KnowledgeReviewDialog({
  onReview,
  onClose,
}: {
  onReview(verdict: KnowledgeReviewVerdict, reason: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<KnowledgeReviewVerdict>("approve");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onReview(verdict, reason);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-review-title">
        <header className="dialog-header">
          <h2 id="knowledge-review-title">{t("knowledge.reviewTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <fieldset>
            <legend>{t("knowledge.reviewTitle")}</legend>
            <div className="segmented-control">
              <label className={verdict === "approve" ? "segment segment-active" : "segment"}>
                <input type="radio" checked={verdict === "approve"} onChange={() => setVerdict("approve")} />
                <CheckCircle2 size={16} />
                <span>{t("knowledge.approve")}</span>
              </label>
              <label className={verdict === "request_changes" ? "segment segment-active" : "segment"}>
                <input type="radio" checked={verdict === "request_changes"} onChange={() => setVerdict("request_changes")} />
                <RotateCcw size={16} />
                <span>{t("knowledge.requestChanges")}</span>
              </label>
            </div>
          </fieldset>
          <label>
            <span>{t("knowledge.reviewReason")}</span>
            <textarea
              required
              rows={5}
              maxLength={2_000}
              value={reason}
              placeholder={t("knowledge.reviewReasonPlaceholder")}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy}>
              {verdict === "approve" ? <CheckCircle2 size={17} /> : <RotateCcw size={17} />}
              <span>{t(verdict === "approve" ? "knowledge.approve" : "knowledge.requestChanges")}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
