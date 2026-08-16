import {
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  CheckSquare,
  GitBranch,
  Home,
  Plus,
  ShieldCheck,
  Trash2,
  UsersRound,
  Workflow,
} from "lucide-react";
import {
  COLLECTIVE_TEMPLATE_LABEL_KEYS,
  blueprintCapabilities,
  type ActivityStatus,
  type BlueprintCapabilityBundle,
  type CollectiveBlueprintDraft,
  type CollectiveTemplateLabels,
  type Permission,
} from "@guild-os/domain";
import { Notice } from "./Notice";
import { useI18n, type TranslationKey } from "../i18n";

const vocabularyLabels: Record<keyof CollectiveTemplateLabels, TranslationKey> = {
  members: "blueprint.vocabulary.members",
  member: "blueprint.vocabulary.member",
  human: "blueprint.vocabulary.human",
  agent: "blueprint.vocabulary.agent",
  service: "blueprint.vocabulary.service",
  guildActor: "blueprint.vocabulary.guildActor",
  memory: "blueprint.vocabulary.memory",
  memoryItem: "blueprint.vocabulary.memoryItem",
  remember: "blueprint.vocabulary.remember",
  activity: "blueprint.vocabulary.activity",
  activityItem: "blueprint.vocabulary.activityItem",
  startActivity: "blueprint.vocabulary.startActivity",
  decisions: "blueprint.vocabulary.decisions",
  decision: "blueprint.vocabulary.decision",
  history: "blueprint.vocabulary.history",
  join: "blueprint.vocabulary.join",
  leave: "blueprint.vocabulary.leave",
  participant: "blueprint.vocabulary.participant",
  coordinator: "blueprint.vocabulary.coordinator",
};

const capabilityBundles: readonly BlueprintCapabilityBundle[] = [
  "observe", "participate", "coordinate", "administer",
];

const lifecyclePresets: readonly {
  key: "simple" | "planned" | "ready";
  states: readonly ActivityStatus[];
}[] = [
  { key: "simple", states: ["proposed", "active", "completed", "archived"] },
  { key: "planned", states: ["proposed", "planned", "active", "completed", "archived"] },
  { key: "ready", states: ["proposed", "ready", "active", "completed", "archived"] },
];

const safeAgentPermissions: readonly Permission[] = [
  "memory.read", "activity.read", "activity.create", "decision.read", "relation.read",
  "conversation.read", "conversation.create", "run.create", "agent.read", "agent.run",
  "event.read",
];

const dashboardIntentOptions = ["ask", "remember", "start", "review", "members"] as const;

function agentPermissionsForRole(role: CollectiveBlueprintDraft["definition"]["roles"][number]): readonly Permission[] {
  return safeAgentPermissions.filter((permission) => role.capabilities.includes(permission));
}

function shortId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function lifecycleKey(states: readonly ActivityStatus[]): "simple" | "planned" | "ready" {
  return lifecyclePresets.find((preset) =>
    preset.states.length === states.length && preset.states.every((state, index) => state === states[index]))
    ?.key ?? "planned";
}

export function BlueprintEditor({
  draft,
  onChange,
  compact = false,
}: {
  draft: CollectiveBlueprintDraft;
  onChange(draft: CollectiveBlueprintDraft): void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const definition = draft.definition;

  function changeDefinition(next: Partial<CollectiveBlueprintDraft["definition"]>): void {
    const nextDefinition = { ...definition, ...next };
    onChange({
      ...draft,
      onboardingAnswers: next.purpose === undefined
        ? draft.onboardingAnswers
        : { ...draft.onboardingAnswers, purpose: nextDefinition.purpose },
      definition: nextDefinition,
    });
  }

  function removeRole(key: string): void {
    if (definition.roles.length <= 2 || definition.suggestedAgent?.roleKey === key) return;
    changeDefinition({ roles: definition.roles.filter((role) => role.key !== key) });
  }

  function addRole(): void {
    const capabilityBundle: BlueprintCapabilityBundle = "participate";
    changeDefinition({
      roles: [...definition.roles, {
        key: `role-${shortId()}`,
        name: t("blueprint.newRole"),
        description: t("blueprint.newRoleDescription"),
        capabilityBundle,
        capabilities: blueprintCapabilities(capabilityBundle),
      }],
    });
  }

  function removeSpace(key: string): void {
    if (definition.spaces.length <= 1 || definition.spaces.some((space) => space.parentKey === key)) return;
    changeDefinition({ spaces: definition.spaces.filter((space) => space.key !== key) });
  }

  function addSpace(): void {
    changeDefinition({
      spaces: [...definition.spaces, {
        key: `space-${shortId()}`,
        name: t("blueprint.newSpace"),
        description: t("blueprint.newSpaceDescription"),
        parentKey: null,
      }],
    });
  }

  function addMemoryType(): void {
    changeDefinition({
      memoryTypes: [...definition.memoryTypes, {
        type: `custom:memory_${shortId()}`,
        label: t("blueprint.newMemoryType"),
        description: t("blueprint.newMemoryTypeDescription"),
      }],
    });
  }

  function addActivityType(): void {
    changeDefinition({
      activityTypes: [...definition.activityTypes, {
        type: `custom:activity_${shortId()}`,
        label: t("blueprint.newActivityType"),
        description: t("blueprint.newActivityTypeDescription"),
        states: lifecyclePresets[1].states,
      }],
    });
  }

  function addDecisionMethod(): void {
    changeDefinition({
      decisionMethods: [...definition.decisionMethods, {
        key: `decision-${shortId()}`,
        label: t("blueprint.newDecisionMethod"),
        description: t("blueprint.newDecisionMethodDescription"),
        method: "review",
      }],
    });
  }

  function addWorkflow(): void {
    changeDefinition({
      workflows: [...definition.workflows, {
        key: `workflow-${shortId()}`,
        name: t("blueprint.newWorkflow"),
        description: t("blueprint.newWorkflowDescription"),
        activityType: definition.activityTypes[0]?.type ?? null,
        memoryType: definition.memoryTypes[0]?.type ?? null,
        decisionMethodKey: definition.decisionMethods[0]?.key ?? null,
      }],
    });
  }

  function changeRoleBundle(roleKey: string, capabilityBundle: BlueprintCapabilityBundle): void {
    const roles = definition.roles.map((role) => role.key === roleKey
      ? { ...role, capabilityBundle, capabilities: blueprintCapabilities(capabilityBundle) }
      : role);
    const suggestedAgent = definition.suggestedAgent?.roleKey === roleKey
      ? {
          ...definition.suggestedAgent,
          permissions: agentPermissionsForRole(roles.find((role) => role.key === roleKey)!),
        }
      : definition.suggestedAgent;
    changeDefinition({ roles, suggestedAgent });
  }

  function moveDashboardIntent(intent: CollectiveBlueprintDraft["definition"]["dashboardIntents"][number], offset: -1 | 1): void {
    const currentIndex = definition.dashboardIntents.indexOf(intent);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= definition.dashboardIntents.length) return;
    const next = [...definition.dashboardIntents];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex]!, next[currentIndex]!];
    changeDefinition({ dashboardIntents: next });
  }

  const roleReferencedByAgent = definition.suggestedAgent?.roleKey ?? null;

  return (
    <div className={compact ? "blueprint-editor blueprint-editor-compact" : "blueprint-editor"}>
      <section className="blueprint-editor-overview" aria-labelledby="blueprint-overview-title">
        <div className="section-heading-row">
          <Home size={19} />
          <div><h2 id="blueprint-overview-title">{t("blueprint.overview")}</h2><p>{t("blueprint.overviewDescription")}</p></div>
        </div>
        <div className="form-grid">
          <label><span>{t("blueprint.name")}</span><input required maxLength={100} value={definition.name} onChange={(event) => changeDefinition({ name: event.target.value })} /></label>
          <label><span>{t("blueprint.description")}</span><input required maxLength={2_000} value={definition.description} onChange={(event) => changeDefinition({ description: event.target.value })} /></label>
        </div>
        <label><span>{t("blueprint.purpose")}</span><textarea required rows={3} maxLength={2_000} value={definition.purpose} onChange={(event) => changeDefinition({ purpose: event.target.value })} /></label>
      </section>

      <details className="blueprint-editor-section" open={!compact}>
        <summary><Brain size={18} /><span><strong>{t("blueprint.vocabularyTitle")}</strong><small>{t("blueprint.vocabularyDescription")}</small></span></summary>
        <div className="form-grid blueprint-vocabulary-grid">
          {COLLECTIVE_TEMPLATE_LABEL_KEYS.map((key) => (
            <label key={key}>
              <span>{t(vocabularyLabels[key])}</span>
              <input required maxLength={200} value={definition.labels[key]} onChange={(event) => changeDefinition({ labels: { ...definition.labels, [key]: event.target.value } })} />
            </label>
          ))}
        </div>
      </details>

      <details className="blueprint-editor-section" open={!compact}>
        <summary><UsersRound size={18} /><span><strong>{t("blueprint.rolesTitle")}</strong><small>{t("blueprint.rolesDescription")}</small></span></summary>
        <Notice>{t("blueprint.roleSafety")}</Notice>
        <div className="blueprint-editor-list">
          {definition.roles.map((role, index) => (
            <article className="blueprint-editor-item" key={role.key}>
              <div className="blueprint-editor-item-heading">
                <strong>{t("blueprint.roleNumber", { number: index + 1 })}</strong>
                <button className="icon-button" type="button" title={t("blueprint.removeRole")} aria-label={t("blueprint.removeRole")} disabled={definition.roles.length <= 2 || roleReferencedByAgent === role.key} onClick={() => removeRole(role.key)}><Trash2 size={16} /></button>
              </div>
              <div className="form-grid">
                <label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={role.name} onChange={(event) => changeDefinition({ roles: definition.roles.map((item) => item.key === role.key ? { ...item, name: event.target.value } : item) })} /></label>
                <label><span>{t("blueprint.capabilityBundle")}</span><select value={role.capabilityBundle} onChange={(event) => changeRoleBundle(role.key, event.target.value as BlueprintCapabilityBundle)}>{capabilityBundles.map((bundle) => <option value={bundle} key={bundle}>{t(`blueprint.bundle.${bundle}` as TranslationKey)}</option>)}</select><small>{t("blueprint.capabilityCount", { count: role.capabilities.length })}</small></label>
              </div>
              <label><span>{t("blueprint.itemDescription")}</span><textarea required rows={2} maxLength={500} value={role.description} onChange={(event) => changeDefinition({ roles: definition.roles.map((item) => item.key === role.key ? { ...item, description: event.target.value } : item) })} /></label>
            </article>
          ))}
        </div>
        <button className="secondary-button" type="button" disabled={definition.roles.length >= 8} onClick={addRole}><Plus size={16} />{t("blueprint.addRole")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><GitBranch size={18} /><span><strong>{t("blueprint.spacesTitle")}</strong><small>{t("blueprint.spacesDescription")}</small></span></summary>
        <div className="blueprint-editor-list">
          {definition.spaces.map((space, index) => (
            <article className="blueprint-editor-item" key={space.key}>
              <div className="blueprint-editor-item-heading"><strong>{t("blueprint.spaceNumber", { number: index + 1 })}</strong><button className="icon-button" type="button" title={t("blueprint.removeSpace")} aria-label={t("blueprint.removeSpace")} disabled={definition.spaces.length <= 1 || definition.spaces.some((item) => item.parentKey === space.key)} onClick={() => removeSpace(space.key)}><Trash2 size={16} /></button></div>
              <div className="form-grid">
                <label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={space.name} onChange={(event) => changeDefinition({ spaces: definition.spaces.map((item) => item.key === space.key ? { ...item, name: event.target.value } : item) })} /></label>
                <label><span>{t("blueprint.parentSpace")}</span><select value={space.parentKey ?? ""} onChange={(event) => changeDefinition({ spaces: definition.spaces.map((item) => item.key === space.key ? { ...item, parentKey: event.target.value || null } : item) })}><option value="">{t("blueprint.guildRoot")}</option>{definition.spaces.slice(0, index).map((parent) => <option value={parent.key} key={parent.key}>{parent.name}</option>)}</select></label>
              </div>
              <label><span>{t("blueprint.itemDescription")}</span><textarea required rows={2} maxLength={500} value={space.description} onChange={(event) => changeDefinition({ spaces: definition.spaces.map((item) => item.key === space.key ? { ...item, description: event.target.value } : item) })} /></label>
            </article>
          ))}
        </div>
        <button className="secondary-button" type="button" disabled={definition.spaces.length >= 12} onClick={addSpace}><Plus size={16} />{t("blueprint.addSpace")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><Brain size={18} /><span><strong>{t("blueprint.memoryTypesTitle")}</strong><small>{t("blueprint.memoryTypesDescription")}</small></span></summary>
        <div className="blueprint-editor-list blueprint-editor-list-compact">
          {definition.memoryTypes.map((memory) => {
            const referenced = definition.workflows.some((workflow) => workflow.memoryType === memory.type);
            return <article className="blueprint-editor-item" key={memory.type}><div className="blueprint-editor-item-heading"><strong>{memory.label}</strong><button className="icon-button" type="button" title={t("blueprint.removeMemoryType")} aria-label={t("blueprint.removeMemoryType")} disabled={definition.memoryTypes.length <= 1 || referenced} onClick={() => changeDefinition({ memoryTypes: definition.memoryTypes.filter((item) => item.type !== memory.type) })}><Trash2 size={16} /></button></div><div className="form-grid"><label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={memory.label} onChange={(event) => changeDefinition({ memoryTypes: definition.memoryTypes.map((item) => item.type === memory.type ? { ...item, label: event.target.value } : item) })} /></label><label><span>{t("blueprint.itemDescription")}</span><input required maxLength={500} value={memory.description} onChange={(event) => changeDefinition({ memoryTypes: definition.memoryTypes.map((item) => item.type === memory.type ? { ...item, description: event.target.value } : item) })} /></label></div></article>;
          })}
        </div>
        <button className="secondary-button" type="button" disabled={definition.memoryTypes.length >= 12} onClick={addMemoryType}><Plus size={16} />{t("blueprint.addMemoryType")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><CheckSquare size={18} /><span><strong>{t("blueprint.activityTypesTitle")}</strong><small>{t("blueprint.activityTypesDescription")}</small></span></summary>
        <div className="blueprint-editor-list blueprint-editor-list-compact">
          {definition.activityTypes.map((activity) => {
            const referenced = definition.workflows.some((workflow) => workflow.activityType === activity.type);
            return <article className="blueprint-editor-item" key={activity.type}><div className="blueprint-editor-item-heading"><strong>{activity.label}</strong><button className="icon-button" type="button" title={t("blueprint.removeActivityType")} aria-label={t("blueprint.removeActivityType")} disabled={definition.activityTypes.length <= 1 || referenced} onClick={() => changeDefinition({ activityTypes: definition.activityTypes.filter((item) => item.type !== activity.type) })}><Trash2 size={16} /></button></div><div className="form-grid"><label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={activity.label} onChange={(event) => changeDefinition({ activityTypes: definition.activityTypes.map((item) => item.type === activity.type ? { ...item, label: event.target.value } : item) })} /></label><label><span>{t("blueprint.lifecycle")}</span><select value={lifecycleKey(activity.states)} onChange={(event) => { const states = lifecyclePresets.find((preset) => preset.key === event.target.value)?.states ?? lifecyclePresets[1].states; changeDefinition({ activityTypes: definition.activityTypes.map((item) => item.type === activity.type ? { ...item, states } : item) }); }}>{lifecyclePresets.map((preset) => <option value={preset.key} key={preset.key}>{t(`blueprint.lifecycle.${preset.key}` as TranslationKey)}</option>)}</select></label></div><label><span>{t("blueprint.itemDescription")}</span><textarea required rows={2} maxLength={500} value={activity.description} onChange={(event) => changeDefinition({ activityTypes: definition.activityTypes.map((item) => item.type === activity.type ? { ...item, description: event.target.value } : item) })} /></label></article>;
          })}
        </div>
        <button className="secondary-button" type="button" disabled={definition.activityTypes.length >= 12} onClick={addActivityType}><Plus size={16} />{t("blueprint.addActivityType")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><ShieldCheck size={18} /><span><strong>{t("blueprint.decisionsTitle")}</strong><small>{t("blueprint.decisionsDescription")}</small></span></summary>
        <div className="blueprint-editor-list blueprint-editor-list-compact">
          {definition.decisionMethods.map((decision) => {
            const referenced = definition.workflows.some((workflow) => workflow.decisionMethodKey === decision.key);
            return <article className="blueprint-editor-item" key={decision.key}><div className="blueprint-editor-item-heading"><strong>{decision.label}</strong><button className="icon-button" type="button" title={t("blueprint.removeDecisionMethod")} aria-label={t("blueprint.removeDecisionMethod")} disabled={definition.decisionMethods.length <= 1 || referenced} onClick={() => changeDefinition({ decisionMethods: definition.decisionMethods.filter((item) => item.key !== decision.key) })}><Trash2 size={16} /></button></div><div className="form-grid"><label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={decision.label} onChange={(event) => changeDefinition({ decisionMethods: definition.decisionMethods.map((item) => item.key === decision.key ? { ...item, label: event.target.value } : item) })} /></label><label><span>{t("blueprint.decisionEngine")}</span><select value={decision.method} onChange={(event) => changeDefinition({ decisionMethods: definition.decisionMethods.map((item) => item.key === decision.key ? { ...item, method: event.target.value as typeof item.method } : item) })}>{["custodian", "consent", "vote", "review", "editorial", "policy", "hybrid"].map((method) => <option value={method} key={method}>{t(`blueprint.decision.${method}` as TranslationKey)}</option>)}</select></label></div><label><span>{t("blueprint.itemDescription")}</span><textarea required rows={2} maxLength={500} value={decision.description} onChange={(event) => changeDefinition({ decisionMethods: definition.decisionMethods.map((item) => item.key === decision.key ? { ...item, description: event.target.value } : item) })} /></label></article>;
          })}
        </div>
        <button className="secondary-button" type="button" disabled={definition.decisionMethods.length >= 8} onClick={addDecisionMethod}><Plus size={16} />{t("blueprint.addDecisionMethod")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><Home size={18} /><span><strong>{t("blueprint.homeTitle")}</strong><small>{t("blueprint.homeDescription")}</small></span></summary>
        <div className="blueprint-home-options">{[
          ...definition.dashboardIntents,
          ...dashboardIntentOptions.filter((intent) => !definition.dashboardIntents.includes(intent)),
        ].map((intent) => {
          const index = definition.dashboardIntents.indexOf(intent);
          const selected = index >= 0;
          return <div className="blueprint-home-row" key={intent}>
            <label className="checkbox-row"><input type="checkbox" checked={selected} disabled={selected && definition.dashboardIntents.length <= 3} onChange={(event) => changeDefinition({ dashboardIntents: event.target.checked ? [...definition.dashboardIntents, intent] : definition.dashboardIntents.filter((item) => item !== intent) })} /><span>{t(`blueprint.home.${intent}` as TranslationKey)}</span></label>
            {selected ? <span className="blueprint-order-controls">
              <button className="icon-button" type="button" title={t("blueprint.moveEarlier")} aria-label={`${t("blueprint.moveEarlier")}: ${t(`blueprint.home.${intent}` as TranslationKey)}`} disabled={index === 0} onClick={() => moveDashboardIntent(intent, -1)}><ArrowUp size={15} /></button>
              <button className="icon-button" type="button" title={t("blueprint.moveLater")} aria-label={`${t("blueprint.moveLater")}: ${t(`blueprint.home.${intent}` as TranslationKey)}`} disabled={index === definition.dashboardIntents.length - 1} onClick={() => moveDashboardIntent(intent, 1)}><ArrowDown size={15} /></button>
            </span> : null}
          </div>;
        })}</div>
      </details>

      <details className="blueprint-editor-section">
        <summary><Workflow size={18} /><span><strong>{t("blueprint.workflowsTitle")}</strong><small>{t("blueprint.workflowsDescription")}</small></span></summary>
        <div className="blueprint-editor-list">
          {definition.workflows.map((workflow) => <article className="blueprint-editor-item" key={workflow.key}><div className="blueprint-editor-item-heading"><strong>{workflow.name}</strong><button className="icon-button" type="button" title={t("blueprint.removeWorkflow")} aria-label={t("blueprint.removeWorkflow")} disabled={definition.workflows.length <= 1} onClick={() => changeDefinition({ workflows: definition.workflows.filter((item) => item.key !== workflow.key) })}><Trash2 size={16} /></button></div><div className="form-grid"><label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={workflow.name} onChange={(event) => changeDefinition({ workflows: definition.workflows.map((item) => item.key === workflow.key ? { ...item, name: event.target.value } : item) })} /></label><label><span>{t("blueprint.workflowActivity")}</span><select value={workflow.activityType ?? ""} onChange={(event) => changeDefinition({ workflows: definition.workflows.map((item) => item.key === workflow.key ? { ...item, activityType: event.target.value as typeof item.activityType || null } : item) })}><option value="">{t("common.none")}</option>{definition.activityTypes.map((item) => <option value={item.type} key={item.type}>{item.label}</option>)}</select></label><label><span>{t("blueprint.workflowMemory")}</span><select value={workflow.memoryType ?? ""} onChange={(event) => changeDefinition({ workflows: definition.workflows.map((item) => item.key === workflow.key ? { ...item, memoryType: event.target.value as typeof item.memoryType || null } : item) })}><option value="">{t("common.none")}</option>{definition.memoryTypes.map((item) => <option value={item.type} key={item.type}>{item.label}</option>)}</select></label><label><span>{t("blueprint.workflowDecision")}</span><select value={workflow.decisionMethodKey ?? ""} onChange={(event) => changeDefinition({ workflows: definition.workflows.map((item) => item.key === workflow.key ? { ...item, decisionMethodKey: event.target.value || null } : item) })}><option value="">{t("common.none")}</option>{definition.decisionMethods.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label></div><label><span>{t("blueprint.itemDescription")}</span><textarea required rows={2} maxLength={500} value={workflow.description} onChange={(event) => changeDefinition({ workflows: definition.workflows.map((item) => item.key === workflow.key ? { ...item, description: event.target.value } : item) })} /></label></article>)}
        </div>
        <button className="secondary-button" type="button" disabled={definition.workflows.length >= 12} onClick={addWorkflow}><Plus size={16} />{t("blueprint.addWorkflow")}</button>
      </details>

      <details className="blueprint-editor-section">
        <summary><Bot size={18} /><span><strong>{t("blueprint.agentTitle")}</strong><small>{t("blueprint.agentDescription")}</small></span></summary>
        <label className="checkbox-row"><input type="checkbox" checked={definition.suggestedAgent !== null} onChange={(event) => {
          if (!event.target.checked) return changeDefinition({ suggestedAgent: null });
          const role = definition.roles.find((item) => item.capabilityBundle === "participate") ?? definition.roles[0]!;
          changeDefinition({ suggestedAgent: { name: t("blueprint.newAgent"), purpose: t("blueprint.newAgentPurpose"), roleKey: role.key, permissions: agentPermissionsForRole(role), toolIds: ["memory_search", "activity_draft"] } });
        }} /><span>{t("blueprint.includeAgent")}</span></label>
        {definition.suggestedAgent ? <div className="blueprint-agent-fields"><div className="form-grid"><label><span>{t("blueprint.itemName")}</span><input required maxLength={100} value={definition.suggestedAgent.name} onChange={(event) => changeDefinition({ suggestedAgent: { ...definition.suggestedAgent!, name: event.target.value } })} /></label><label><span>{t("blueprint.agentRole")}</span><select value={definition.suggestedAgent.roleKey} onChange={(event) => { const role = definition.roles.find((item) => item.key === event.target.value)!; changeDefinition({ suggestedAgent: { ...definition.suggestedAgent!, roleKey: role.key, permissions: agentPermissionsForRole(role) } }); }}>{definition.roles.map((role) => <option value={role.key} key={role.key}>{role.name}</option>)}</select></label></div><label><span>{t("blueprint.agentPurpose")}</span><textarea required rows={3} maxLength={1_000} value={definition.suggestedAgent.purpose} onChange={(event) => changeDefinition({ suggestedAgent: { ...definition.suggestedAgent!, purpose: event.target.value } })} /></label><Notice>{t("blueprint.agentSafety", { count: definition.suggestedAgent.permissions.length })}</Notice><details className="blueprint-permission-details"><summary>{t("settings.permissions")} ({definition.suggestedAgent.permissions.length})</summary><div className="permission-grid">{definition.suggestedAgent.permissions.map((permission) => <code key={permission}>{permission}</code>)}</div></details></div> : null}
      </details>
    </div>
  );
}
