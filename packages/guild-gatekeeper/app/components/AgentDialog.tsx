import { Bot, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CLASSIFICATIONS,
  HUMAN_ONLY_PERMISSIONS,
  type AgentLimits,
  type Classification,
} from "@guild-os/domain";
import type { CreateAgentRequest, UiDirectory } from "../../src/management-types";
import { classificationTranslationKey, useI18n } from "../i18n";
import { Notice } from "./Notice";

export function AgentDialog({
  directory,
  defaults,
  onCreate,
  onClose,
}: {
  directory: UiDirectory;
  defaults: AgentLimits;
  onCreate(input: CreateAgentRequest): Promise<void>;
  onClose(): void;
}) {
  const { t } = useI18n();
  const roles = useMemo(() => directory.roles.filter((role) =>
    !role.permissions.some((permission) => HUMAN_ONLY_PERMISSIONS.has(permission))), [directory.roles]);
  const [displayName, setDisplayName] = useState("");
  const [clearance, setClearance] = useState<Classification>("internal");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [spaceId, setSpaceId] = useState("");
  const [model, setModel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tools, setTools] = useState("");
  const [limits, setLimits] = useState<AgentLimits>(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setLimit<Key extends keyof AgentLimits>(key: Key, value: AgentLimits[Key]) {
    setLimits((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const toolIds = [...new Set(tools.split(",").map((value) => value.trim()).filter(Boolean))];
      await onCreate({
        displayName,
        clearance,
        roleId,
        spaceId: spaceId || null,
        instructions,
        model,
        toolIds,
        limits,
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
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title">
        <header className="dialog-header">
          <h2 id="agent-dialog-title">{t("agents.createTitle")}</h2>
          <button className="icon-button" type="button" title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div className="form-grid">
            <label>
              <span>{t("agents.name")}</span>
              <input required maxLength={200} value={displayName} placeholder={t("agents.namePlaceholder")} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              <span>{t("agents.model")}</span>
              <input required maxLength={200} value={model} placeholder={t("agents.modelPlaceholder")} onChange={(event) => setModel(event.target.value)} />
            </label>
          </div>
          <label>
            <span>{t("agents.instructions")}</span>
            <textarea required maxLength={20_000} rows={5} value={instructions} placeholder={t("agents.instructionsPlaceholder")} onChange={(event) => setInstructions(event.target.value)} />
          </label>
          <label>
            <span>{t("agents.tools")}</span>
            <input value={tools} placeholder={t("agents.toolsPlaceholder")} onChange={(event) => setTools(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              <span>{t("people.clearance")}</span>
              <select value={clearance} onChange={(event) => setClearance(event.target.value as Classification)}>
                {CLASSIFICATIONS.map((value) => <option key={value} value={value}>{t(classificationTranslationKey(value))}</option>)}
              </select>
            </label>
            <label>
              <span>{t("people.role")}</span>
              <select required value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span>{t("people.space")}</span>
            <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>
              <option value="">{t("people.global")}</option>
              {directory.spaces.filter((space) => space.status === "active").map((space) => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>{t("agents.limits")}</legend>
            <div className="limits-grid">
              <label><span>{t("agents.currency")}</span><input required maxLength={3} value={limits.currency} onChange={(event) => setLimit("currency", event.target.value.toUpperCase())} /></label>
              <label><span>{t("agents.budget")}</span><input required type="number" min={0} step={1} value={limits.maxBudgetMinor} onChange={(event) => setLimit("maxBudgetMinor", Number(event.target.value))} /></label>
              <label><span>{t("agents.duration")}</span><input required type="number" min={1} step={1} value={limits.maxDurationSeconds} onChange={(event) => setLimit("maxDurationSeconds", Number(event.target.value))} /></label>
              <label><span>{t("agents.steps")}</span><input required type="number" min={1} step={1} value={limits.maxSteps} onChange={(event) => setLimit("maxSteps", Number(event.target.value))} /></label>
              <label><span>{t("agents.retries")}</span><input required type="number" min={0} step={1} value={limits.maxRetries} onChange={(event) => setLimit("maxRetries", Number(event.target.value))} /></label>
              <label><span>{t("agents.delegation")}</span><input required type="number" min={0} step={1} value={limits.maxDelegationDepth} onChange={(event) => setLimit("maxDelegationDepth", Number(event.target.value))} /></label>
            </div>
          </fieldset>
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !roleId}>
              <Bot size={17} />{t("agents.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
