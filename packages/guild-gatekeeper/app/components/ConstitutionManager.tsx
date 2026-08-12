import { Landmark, Pencil, Save, X } from "lucide-react";
import { useState } from "react";
import type { AgentLimits } from "@guild-os/domain";
import type {
  UiConstitution,
  UpdateConstitutionRequest,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function ConstitutionDialog({
  constitution,
  onSave,
  onClose,
}: {
  constitution: UiConstitution;
  onSave(input: UpdateConstitutionRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const [level2ApprovalQuorum, setLevel2ApprovalQuorum] = useState(
    constitution.level2ApprovalQuorum,
  );
  const [level3ApprovalQuorum, setLevel3ApprovalQuorum] = useState(
    constitution.level3ApprovalQuorum,
  );
  const [dataRetentionDays, setDataRetentionDays] = useState(
    constitution.dataRetentionDays,
  );
  const [agentDefaults, setAgentDefaults] = useState<AgentLimits>(constitution.agentDefaults);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLimit<Key extends keyof AgentLimits>(key: Key, value: AgentLimits[Key]) {
    setAgentDefaults((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        expectedVersion: constitution.version,
        level2ApprovalQuorum,
        level3ApprovalQuorum,
        dataRetentionDays,
        agentDefaults,
        reason: reason.trim(),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="constitution-dialog-title"
      >
        <header className="dialog-header">
          <div>
            <h2 id="constitution-dialog-title">{t("settings.constitutionEditTitle")}</h2>
            <small>{t("settings.constitutionRootOnly")}</small>
          </div>
          <button
            className="icon-button"
            type="button"
            title={t("common.close")}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <fieldset>
            <legend>{t("settings.approvalPolicy")}</legend>
            <div className="form-grid">
              <label>
                <span>{t("settings.level2Quorum")}</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={level2ApprovalQuorum}
                  onChange={(event) => setLevel2ApprovalQuorum(Number(event.target.value))}
                />
              </label>
              <label>
                <span>{t("settings.level3Quorum")}</span>
                <input
                  required
                  type="number"
                  min={level2ApprovalQuorum || 1}
                  max={100}
                  step={1}
                  value={level3ApprovalQuorum}
                  onChange={(event) => setLevel3ApprovalQuorum(Number(event.target.value))}
                />
              </label>
            </div>
          </fieldset>
          <label>
            <span>{t("settings.retentionDays")}</span>
            <input
              required
              type="number"
              min={1}
              max={36_500}
              step={1}
              value={dataRetentionDays}
              onChange={(event) => setDataRetentionDays(Number(event.target.value))}
            />
          </label>
          <fieldset>
            <legend>{t("settings.agentDefaults")}</legend>
            <div className="limits-grid">
              <label>
                <span>{t("agents.currency")}</span>
                <input
                  required
                  maxLength={3}
                  value={agentDefaults.currency}
                  onChange={(event) => setLimit("currency", event.target.value.toUpperCase())}
                />
              </label>
              <label>
                <span>{t("agents.budget")}</span>
                <input required type="number" min={0} step={1} value={agentDefaults.maxBudgetMinor} onChange={(event) => setLimit("maxBudgetMinor", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agents.tokens")}</span>
                <input required type="number" min={1} step={1} value={agentDefaults.maxTokens} onChange={(event) => setLimit("maxTokens", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agents.duration")}</span>
                <input required type="number" min={1} step={1} value={agentDefaults.maxDurationSeconds} onChange={(event) => setLimit("maxDurationSeconds", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agents.steps")}</span>
                <input required type="number" min={1} step={1} value={agentDefaults.maxSteps} onChange={(event) => setLimit("maxSteps", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agents.retries")}</span>
                <input required type="number" min={0} step={1} value={agentDefaults.maxRetries} onChange={(event) => setLimit("maxRetries", Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agents.delegation")}</span>
                <input required type="number" min={0} step={1} value={agentDefaults.maxDelegationDepth} onChange={(event) => setLimit("maxDelegationDepth", Number(event.target.value))} />
              </label>
            </div>
          </fieldset>
          <label>
            <span>{t("settings.changeReason")}</span>
            <textarea
              required
              maxLength={2_000}
              rows={3}
              value={reason}
              placeholder={t("settings.changeReasonPlaceholder")}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-button" type="submit" disabled={busy || reason.trim() === ""}>
              <Save size={17} />{t("common.save")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ConstitutionManager({
  constitution,
  rootOwner,
  onUpdate,
}: {
  constitution: UiConstitution;
  rootOwner: boolean;
  onUpdate(input: UpdateConstitutionRequest): Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const updatedAt = new Date(constitution.updatedAt);
  const updatedLabel = Number.isNaN(updatedAt.valueOf())
    ? constitution.updatedAt
    : updatedAt.toLocaleString(locale);

  return (
    <section className="content-section settings-section">
      <div className="section-heading-row manager-heading">
        <Landmark size={19} />
        <div>
          <h2>{t("settings.constitutionTitle")}</h2>
          <p>{t("settings.constitutionDescription")}</p>
        </div>
        {rootOwner ? (
          <button className="secondary-button" type="button" onClick={() => setDialogOpen(true)}>
            <Pencil size={16} />{t("settings.constitutionEdit")}
          </button>
        ) : null}
      </div>
      <dl className="constitution-summary">
        <div><dt>{t("settings.constitutionVersion")}</dt><dd>{constitution.version}</dd></div>
        <div><dt>{t("settings.level2Quorum")}</dt><dd>{constitution.level2ApprovalQuorum}</dd></div>
        <div><dt>{t("settings.level3Quorum")}</dt><dd>{constitution.level3ApprovalQuorum}</dd></div>
        <div><dt>{t("settings.retentionDays")}</dt><dd>{constitution.dataRetentionDays}</dd></div>
        <div><dt>{t("settings.agentBudget")}</dt><dd>{constitution.agentDefaults.maxBudgetMinor} {constitution.agentDefaults.currency}</dd></div>
        <div><dt>{t("settings.agentTokens")}</dt><dd>{constitution.agentDefaults.maxTokens}</dd></div>
        <div><dt>{t("settings.constitutionUpdated")}</dt><dd>{updatedLabel}</dd></div>
      </dl>
      <Notice>{t(rootOwner ? "settings.constitutionRootOnly" : "settings.constitutionReadOnly")}</Notice>
      {dialogOpen ? (
        <ConstitutionDialog
          constitution={constitution}
          onSave={onUpdate}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}
