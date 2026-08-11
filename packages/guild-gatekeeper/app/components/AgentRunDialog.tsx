import { Bot, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CreateAgentWebhookRunRequest,
  GuildUiApi,
  UiAgentRunPage,
  UiDirectory,
} from "../../src/management-types";
import { useI18n } from "../i18n";
import { Notice } from "./Notice";

function parsePayload(
  source: string,
  invalidMessage: string,
): CreateAgentWebhookRunRequest["payload"] {
  const value: unknown = JSON.parse(source);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(invalidMessage);
  }
  return value as CreateAgentWebhookRunRequest["payload"];
}

export function AgentRunDialog({
  api,
  page,
  directory,
  onCreated,
  onClose,
}: {
  api: GuildUiApi;
  page: UiAgentRunPage;
  directory: UiDirectory;
  onCreated(runId: string): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const agents = page.runnableAgents;
  const connectors = page.connectors.filter((connector) => connector.status === "active");
  const [agentIdentityId, setAgentIdentityId] = useState(agents[0]?.identityId ?? "");
  const selectedAgent = agents.find((agent) => agent.identityId === agentIdentityId);
  const spaces = useMemo(() => directory.spaces.filter((space) =>
    space.status === "active" && selectedAgent?.spaceIds.includes(space.id)), [
    directory.spaces,
    selectedAgent,
  ]);
  const [spaceId, setSpaceId] = useState(agents[0]?.spaceIds[0] ?? "");
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [objective, setObjective] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [eventType, setEventType] = useState("guild.action.requested");
  const [payload, setPayload] = useState(`{\n  "message": "${t("agentRun.defaultPayloadMessage")}"\n}`);
  const [steps, setSteps] = useState([
    t("agentRun.defaultStepAuthority"),
    t("agentRun.defaultStepWebhook"),
  ].join("\n"));
  const [budgetMinor, setBudgetMinor] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [classification, setClassification] = useState<CreateAgentWebhookRunRequest["classification"]>("internal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const planSteps = steps.split("\n").map((step) => step.trim()).filter(Boolean);
      if (planSteps.length === 0) throw new Error(t("agentRun.stepsRequired"));
      const runId = crypto.randomUUID();
      await api.createAgentWebhookRun({
        requestId: runId,
        agentIdentityId,
        connectorId,
        questId: null,
        spaceId,
        objective,
        expectedOutcome,
        steps: planSteps,
        eventType,
        payload: parsePayload(payload, t("agentRun.invalidPayload")),
        estimatedUsage: {
          budgetMinor,
          durationSeconds,
          steps: planSteps.length,
          retries: 0,
          delegationDepth: 0,
        },
        visibility: "space",
        classification,
        allowedIdentityIds: [],
      });
      await onCreated(runId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="agent-run-create-title">
        <header className="dialog-header">
          <div>
            <h2 id="agent-run-create-title">{t("agentRun.createTitle")}</h2>
            <small>{t("agentRun.risk.2")}</small>
          </div>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="form-grid">
            <label>
              <span>{t("agentRun.agent")}</span>
              <select required value={agentIdentityId} onChange={(event) => {
                const nextId = event.target.value;
                setAgentIdentityId(nextId);
                setSpaceId(agents.find((agent) => agent.identityId === nextId)?.spaceIds[0] ?? "");
              }}>
                {agents.map((agent) => <option value={agent.identityId} key={agent.identityId}>{agent.displayName}</option>)}
              </select>
            </label>
            <label>
              <span>{t("agentRun.space")}</span>
              <select required value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
                {spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("agentRun.connector")}</span>
              <select required value={connectorId} onChange={(event) => setConnectorId(event.target.value)}>
                {connectors.map((connector) => <option value={connector.id} key={connector.id}>{connector.name}</option>)}
              </select>
            </label>
            <label>
              <span>{t("agentRun.classification")}</span>
              <select value={classification} onChange={(event) => setClassification(event.target.value as typeof classification)}>
                <option value="public">{t("classification.public")}</option>
                <option value="internal">{t("classification.internal")}</option>
                <option value="confidential">{t("classification.confidential")}</option>
                <option value="restricted">{t("classification.restricted")}</option>
              </select>
            </label>
          </div>
          <label>
            <span>{t("agentRun.objective")}</span>
            <input required maxLength={500} value={objective} placeholder={t("agentRun.objectivePlaceholder")} onChange={(event) => setObjective(event.target.value)} />
          </label>
          <label>
            <span>{t("agentRun.expectedOutcome")}</span>
            <textarea required rows={3} maxLength={2_000} value={expectedOutcome} placeholder={t("agentRun.expectedOutcomePlaceholder")} onChange={(event) => setExpectedOutcome(event.target.value)} />
          </label>
          <label>
            <span>{t("agentRun.planSteps")}</span>
            <textarea required rows={3} value={steps} onChange={(event) => setSteps(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("agentRun.eventType")}</span>
              <input required maxLength={100} pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]{0,99}"} value={eventType} onChange={(event) => setEventType(event.target.value)} />
            </label>
            <div className="form-grid agent-run-estimates">
              <label>
                <span>{t("agentRun.estimatedDuration")}</span>
                <input required type="number" min={1} step={1} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
              </label>
              <label>
                <span>{t("agentRun.estimatedBudget")}</span>
                <input required type="number" min={0} step={1} value={budgetMinor} onChange={(event) => setBudgetMinor(Number(event.target.value))} />
              </label>
            </div>
          </div>
          <label>
            <span>{t("agentRun.payload")}</span>
            <textarea className="code-input" required rows={7} value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} />
          </label>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !agentIdentityId || !spaceId || !connectorId}>
              <Bot size={17} /><Plus size={14} />{t("agentRun.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
