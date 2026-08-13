import { Check, X } from "lucide-react";
import { useState } from "react";
import type { GuildUiApi, UiAgentRunDetail } from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

export function AgentRunReviewDialog({
  api,
  run,
  onReviewed,
  onClose,
}: {
  api: GuildUiApi;
  run: UiAgentRunDetail;
  onReviewed(): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<"approve" | "reject">("approve");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!run.approval) return;
    setBusy(true);
    setError(null);
    try {
      await api.reviewAgentRun({
        runId: run.id,
        approvalRequestId: run.approval.id,
        verdict,
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
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="agent-run-review-title">
        <header className="dialog-header">
          <div>
            <h2 id="agent-run-review-title">{t("agentRun.reviewTitle")}</h2>
            <small>{run.plan.objective}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="segmented-control" role="group" aria-label={t("agentRun.review")}>
            <button className={verdict === "approve" ? "segment-active" : ""} type="button" onClick={() => setVerdict("approve")}>
              <Check size={16} />{t("agentRun.approve")}
            </button>
            <button className={verdict === "reject" ? "segment-active segment-danger" : ""} type="button" onClick={() => setVerdict("reject")}>
              <X size={16} />{t("agentRun.reject")}
            </button>
          </div>
          <label>
            <span>{t("agentRun.reviewReason")}</span>
            <textarea required rows={4} maxLength={5_000} value={reason} placeholder={t("agentRun.reviewReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className={verdict === "reject" ? "secondary-button danger-button" : "primary-button"} type="submit" disabled={busy}>
              {verdict === "approve" ? <Check size={17} /> : <X size={17} />}
              {t(verdict === "approve" ? "agentRun.approve" : "agentRun.reject")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
