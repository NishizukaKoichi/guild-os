import type { Permission } from "@guild-os/domain";
import {
  Activity,
  Archive,
  BrainCircuit,
  CheckCircle2,
  CircleOff,
  Clock3,
  CloudCog,
  Database,
  Download,
  FileArchive,
  GitBranch,
  HardDrive,
  Link2,
  LoaderCircle,
  Network,
  Play,
  Plug,
  Plus,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  TableProperties,
  Trash2,
  Unlink,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  CreateAutomationRuleRequest,
  CreateConnectionRequest,
  CreateFederationGrantRequest,
  CreateFederationLinkRequest,
  CreateModelProviderRequest,
  CreateWorkflowRequest,
  GuildUiApi,
  PlanRetentionRequest,
  RunWorkflowRequest,
  SetModelRouteRequest,
  UiConnectionDiscoveryResult,
  UiConnectionHealthResult,
  UiOperationsPage,
  UiRetentionActionKind,
  UiRetentionCategory,
} from "../../src/management-types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

type OperationsTab = "connections" | "automation" | "federation" | "models" | "data";
type OperationsTranslationKey = `operations.${string}` | `common.${string}`;
type TranslationValues = Readonly<Record<string, string | number>>;
type OperationsTranslator = (
  key: OperationsTranslationKey,
  values?: TranslationValues,
) => string;
type MutationRunner = (
  operationKey: string,
  operation: () => Promise<unknown>,
) => Promise<boolean>;

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

const CONNECTION_KINDS = [
  "https_webhook",
  "mcp",
  "oauth",
  "cloudflare_gatekeeper",
  "cloudflare_service",
  "email",
  "calendar",
  "file_storage",
  "git_repository",
  "external_api",
  "model_provider",
] as const satisfies readonly CreateConnectionRequest["kind"][];

const ACTION_ENDPOINT_CONNECTION_KINDS: readonly CreateConnectionRequest["kind"][] = [
  "api",
  "cloudflare_gatekeeper",
  "email",
  "calendar",
  "file_storage",
  "git_repository",
  "external_api",
  "model_provider",
];

const AUTH_KINDS = [
  "none",
  "secret_reference",
  "oauth",
  "service_binding",
  "access_token",
] as const satisfies readonly CreateConnectionRequest["authKind"][];

const VISIBILITIES = ["guild", "space", "restricted", "private"] as const;
const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
const FEDERATION_DIRECTIONS = ["inbound", "outbound", "bidirectional"] as const;
const FEDERATION_RESOURCES = ["memory", "activity", "decision", "agent"] as const;
const MODEL_PROVIDER_KINDS = [
  "workers_ai",
  "cloudflare_ai_gateway",
  "openai_compatible",
] as const satisfies readonly CreateModelProviderRequest["kind"][];
const MODEL_PURPOSES = ["ask", "plan", "act", "embedding", "review"] as const;
const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const;
const AUTOMATION_STATUSES = ["active", "paused", "archived"] as const;
const AUTOMATION_TRIGGERS = ["schedule", "event", "manual"] as const;

const CONNECTION_CAPABILITY_PRESETS = {
  observe: ["connection.read"],
  execute: ["connection.read", "connection.execute"],
  integrate: ["integration.read", "integration.execute"],
} as const satisfies Record<string, readonly Permission[]>;

const SCHEDULE_PRESETS = ["daily", "weekdays", "weekly"] as const;
const RETENTION_CATEGORIES = [
  "memories",
  "activities",
  "decisions",
  "conversations",
  "files",
  "agent_runs",
  "chronicle",
] as const satisfies readonly UiRetentionCategory[];

const RETENTION_ACTIONS: Readonly<Record<UiRetentionCategory, readonly UiRetentionActionKind[]>> = {
  memories: ["retain", "archive"],
  activities: ["retain", "archive"],
  decisions: ["retain"],
  conversations: ["retain"],
  files: ["retain", "purge"],
  agent_runs: ["retain"],
  chronicle: ["retain"],
};
const DEFAULT_RETENTION_SELECTION: Readonly<Record<UiRetentionCategory, UiRetentionActionKind>> = {
  memories: "retain",
  activities: "retain",
  decisions: "retain",
  conversations: "retain",
  files: "retain",
  agent_runs: "retain",
  chronicle: "retain",
};

const TAB_ITEMS: readonly { id: OperationsTab; icon: LucideIcon }[] = [
  { id: "connections", icon: Plug },
  { id: "automation", icon: Workflow },
  { id: "federation", icon: Network },
  { id: "models", icon: BrainCircuit },
  { id: "data", icon: Database },
];

function useOperationsI18n(): {
  locale: ReturnType<typeof useI18n>["locale"];
  t: OperationsTranslator;
} {
  const { locale, t: translate } = useI18n();
  const t = useCallback<OperationsTranslator>(
    (key, values) => translate(key as Parameters<typeof translate>[0], values),
    [translate],
  );
  return { locale, t };
}

function getErrorMessage(cause: unknown, t: OperationsTranslator): string {
  return cause instanceof Error && cause.message
    ? t("operations.error.detail", { message: cause.message })
    : t("operations.error.generic");
}

function formatDate(
  value: string | null,
  locale: string,
  t: OperationsTranslator,
): string {
  if (!value) return t("common.none");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("operations.date.invalid");
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function nextHourLocalValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1_000);
  date.setMinutes(0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function retentionCutoffLocalValue(retentionDays: number): string {
  const date = new Date(Date.now() - (retentionDays + 1) * 86_400_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoToLocalValue(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function uniqueLines(value: string): readonly string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

function configuredCapabilityIds(configuration: unknown): readonly string[] {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) ||
      !("allowedCapabilities" in configuration)) return [];
  const values = configuration.allowedCapabilities;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object" && !Array.isArray(value) && "id" in value &&
        typeof value.id === "string") return [value.id];
    return [];
  });
}

function scheduleExpression(
  preset: (typeof SCHEDULE_PRESETS)[number],
  nextRunAt: string,
): string {
  const firstRun = new Date(nextRunAt);
  const minute = firstRun.getMinutes();
  const hour = firstRun.getHours();
  if (preset === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (preset === "weekly") return `${minute} ${hour} * * ${firstRun.getDay()}`;
  return `${minute} ${hour} * * *`;
}

function statusClass(status: string): string {
  if (["active", "healthy", "succeeded"].includes(status)) return "status-active";
  if (["pending", "queued", "planning", "running"].includes(status)) return "status-preboarding";
  if (["disabled", "revoked", "failed", "cancelled", "archived"].includes(status)) {
    return "status-suspended";
  }
  return "";
}

function StatusPill({
  namespace,
  status,
  t,
}: {
  namespace: string;
  status: string;
  t: OperationsTranslator;
}) {
  return (
    <span className={`status-pill ${statusClass(status)}`}>
      {t(`operations.${namespace}.${status}`)}
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
  count,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  count?: number;
}) {
  return (
    <div className={`section-heading-row${count === undefined ? "" : " compact-heading"}`}>
      <Icon size={19} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {count === undefined ? null : <span>{count}</span>}
    </div>
  );
}

function FormHeading({
  icon: Icon,
  title,
  closeLabel,
  onClose,
}: {
  icon: LucideIcon;
  title: string;
  closeLabel: string;
  onClose(): void;
}) {
  return (
    <div className="section-heading-row compact-heading">
      <Icon size={19} aria-hidden="true" />
      <h2>{title}</h2>
      <button
        className="icon-button"
        type="button"
        title={closeLabel}
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </div>
  );
}

function NoAccess({ t }: { t: OperationsTranslator }) {
  return (
    <EmptyState
      icon={ShieldCheck}
      title={t("operations.access.deniedTitle")}
      description={t("operations.access.deniedDescription")}
    />
  );
}

function EmptyCollection({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return <EmptyState icon={icon} title={title} description={description} />;
}

export function OperationsPage({ api }: { api: GuildUiApi }) {
  const { t } = useOperationsI18n();
  const [tab, setTab] = useState<OperationsTab>("connections");
  const [page, setPage] = useState<UiOperationsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      setPage(await api.getOperationsPage());
    } catch (cause) {
      setLoadError(getErrorMessage(cause, t));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = useCallback<MutationRunner>(async (operationKey, operation) => {
    setBusyKey(operationKey);
    setMutationError(null);
    try {
      await operation();
      await load(false);
      return true;
    } catch (cause) {
      setMutationError(getErrorMessage(cause, t));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [load, t]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % TAB_ITEMS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + TAB_ITEMS.length) % TAB_ITEMS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TAB_ITEMS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TAB_ITEMS[nextIndex];
    if (!nextTab) return;
    setTab(nextTab.id);
    requestAnimationFrame(() => document.getElementById(`operations-tab-${nextTab.id}`)?.focus());
  }

  if (loading && !page) {
    return (
      <div className="center-state" aria-live="polite">
        <LoaderCircle className="spin" size={28} />
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="center-state error-state">
        <CircleOff size={30} />
        <h1>{t("operations.error.title")}</h1>
        <p>{loadError ?? t("operations.error.generic")}</p>
        <button className="primary-button" type="button" onClick={() => void load()}>
          <RotateCcw size={17} />
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t("operations.title")}
        subtitle={t("operations.subtitle")}
        action={(
          <button
            className="secondary-button"
            type="button"
            disabled={loading || busyKey !== null}
            onClick={() => void load()}
          >
            {loading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
            {t("operations.action.refresh")}
          </button>
        )}
      />

      <div className="segmented-control" role="tablist" aria-label={t("operations.tabs.label")} aria-orientation="horizontal">
        {TAB_ITEMS.map(({ id, icon: Icon }, index) => (
          <button
            id={`operations-tab-${id}`}
            className={tab === id ? "segment-active" : ""}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`operations-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            key={id}
            onClick={() => {
              setTab(id);
              setMutationError(null);
            }}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{t(`operations.tabs.${id}`)}</span>
          </button>
        ))}
      </div>

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {mutationError ? <Notice kind="error">{mutationError}</Notice> : null}

      <div
        id={`operations-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`operations-tab-${tab}`}
      >
        {tab === "connections" ? (
          <ConnectionsTab api={api} page={page} busyKey={busyKey} run={runMutation} />
        ) : tab === "automation" ? (
          <AutomationTab api={api} page={page} busyKey={busyKey} run={runMutation} />
        ) : tab === "federation" ? (
          <FederationTab api={api} page={page} busyKey={busyKey} run={runMutation} />
        ) : tab === "models" ? (
          <ModelsTab api={api} page={page} busyKey={busyKey} run={runMutation} />
        ) : (
          <DataTab api={api} page={page} busyKey={busyKey} run={runMutation} />
        )}
      </div>
    </>
  );
}

function ConnectionsTab({
  api,
  page,
  busyKey,
  run,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
}) {
  const { locale, t } = useOperationsI18n();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState<CreateConnectionRequest["kind"]>("https_webhook");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authKind, setAuthKind] = useState<CreateConnectionRequest["authKind"]>("secret_reference");
  const [secretReference, setSecretReference] = useState("");
  const [secretHeaderName, setSecretHeaderName] = useState("Authorization");
  const [secretFormat, setSecretFormat] = useState<"bearer" | "raw">("bearer");
  const [allowedCapabilitiesText, setAllowedCapabilitiesText] = useState("");
  const [mcpAdapterKind, setMcpAdapterKind] = useState<"mcp_https" | "cloudflare_os_mcp">("mcp_https");
  const [bindingReference, setBindingReference] = useState("");
  const [healthRoute, setHealthRoute] = useState("health");
  const [discoveryRoute, setDiscoveryRoute] = useState("capabilities");
  const [invokeRoute, setInvokeRoute] = useState("invoke");
  const [capabilityPreset, setCapabilityPreset] = useState<keyof typeof CONNECTION_CAPABILITY_PRESETS>("execute");
  const [visibility, setVisibility] = useState<CreateConnectionRequest["visibility"]>("guild");
  const [classification, setClassification] = useState<CreateConnectionRequest["classification"]>("internal");
  const [writeRiskLevel, setWriteRiskLevel] = useState<CreateConnectionRequest["writeRiskLevel"]>(2);
  const [healthResults, setHealthResults] = useState<Readonly<Record<string, UiConnectionHealthResult>>>({});
  const [discoveryResults, setDiscoveryResults] = useState<Readonly<Record<string, UiConnectionDiscoveryResult>>>({});

  const endpointRequired = kind !== "cloudflare_service";
  const secretRequired = !["none", "service_binding"].includes(authKind);
  const capabilityIds = useMemo(() => uniqueLines(allowedCapabilitiesText), [allowedCapabilitiesText]);
  const actionEndpoint = ACTION_ENDPOINT_CONNECTION_KINDS.includes(kind);
  const capabilityAllowlistRequired = kind === "mcp" || kind === "cloudflare_service" ||
    actionEndpoint;
  const capabilitiesValid = capabilityIds.length <= 200 && capabilityIds.every((id) =>
    id.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id));
  const routesReady = !(actionEndpoint || kind === "cloudflare_service") ||
    Boolean(healthRoute.trim() && discoveryRoute.trim() && invokeRoute.trim());
  const formReady = Boolean(name.trim() && provider.trim() && description.trim() &&
    (!endpointRequired || endpointUrl.trim()) && (!secretRequired || secretReference.trim()) &&
    (!capabilityAllowlistRequired || capabilityIds.length > 0) && capabilitiesValid && routesReady &&
    (kind !== "cloudflare_service" || bindingReference.trim()));

  function reset() {
    setName("");
    setDescription("");
    setProvider("");
    setKind("https_webhook");
    setEndpointUrl("");
    setAuthKind("secret_reference");
    setSecretReference("");
    setSecretHeaderName("Authorization");
    setSecretFormat("bearer");
    setAllowedCapabilitiesText("");
    setMcpAdapterKind("mcp_https");
    setBindingReference("");
    setHealthRoute("health");
    setDiscoveryRoute("capabilities");
    setInvokeRoute("invoke");
    setCapabilityPreset("execute");
    setVisibility("guild");
    setClassification("internal");
    setWriteRiskLevel(2);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await run("connection.create", () => api.createConnection({
      spaceId: null,
      name: name.trim(),
      description: description.trim(),
      provider: provider.trim(),
      kind,
      endpointUrl: endpointUrl.trim() || null,
      authKind,
      secretReference: secretReference.trim() || null,
      capabilityPermissions: CONNECTION_CAPABILITY_PRESETS[capabilityPreset],
      visibility,
      classification,
      writeRiskLevel,
      configuration: {
        setup: "operations_ui",
        capabilityPreset,
        allowedCapabilities: capabilityIds.map((id) => ({ id })),
        ...(kind === "mcp" ? { adapterKind: mcpAdapterKind } : {}),
        ...(kind === "cloudflare_service" ? { bindingReference: bindingReference.trim() } : {}),
        ...(actionEndpoint || kind === "cloudflare_service" ? {
          routes: {
            health: healthRoute.trim(),
            discovery: discoveryRoute.trim(),
            invoke: invokeRoute.trim(),
          },
        } : {}),
        ...(secretReference.trim() ? {
          secretHeaderName: secretHeaderName.trim(),
          secretFormat,
        } : {}),
      },
    }));
    if (succeeded) {
      reset();
      setCreating(false);
    }
  }

  async function revoke(id: string, expectedVersion: number, nameToConfirm: string) {
    if (!window.confirm(t("operations.connections.revokeConfirm", { name: nameToConfirm }))) return;
    await run(`connection.revoke.${id}`, () => api.revokeConnection({
      id,
      expectedVersion,
      status: "revoked",
    }));
  }

  async function checkHealth(id: string) {
    await run(`connection.health.${id}`, async () => {
      const result = await api.checkConnectionHealth(id);
      setHealthResults((current) => ({ ...current, [id]: result }));
    });
  }

  async function discover(id: string) {
    await run(`connection.discover.${id}`, async () => {
      const result = await api.discoverConnection(id);
      setDiscoveryResults((current) => ({ ...current, [id]: result }));
    });
  }

  if (!page.capabilities.readConnections) return <NoAccess t={t} />;

  return (
    <>
      <section className="content-section">
        <SectionHeading
          icon={Plug}
          title={t("operations.connections.title")}
          description={t("operations.connections.description")}
          count={page.connections.length}
        />
        {page.capabilities.manageConnections ? (
          <div className="action-group">
            <button className="primary-button" type="button" onClick={() => setCreating(true)}>
              <Plus size={17} />
              {t("operations.connections.add")}
            </button>
          </div>
        ) : null}
      </section>

      {creating ? (
        <section className="content-section">
          <FormHeading
            icon={CloudCog}
            title={t("operations.connections.createTitle")}
            closeLabel={t("common.close")}
            onClose={() => setCreating(false)}
          />
          <form className="stack-form" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <label>
                <span>{t("operations.connections.name")}</span>
                <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("operations.connections.namePlaceholder")} />
              </label>
              <label>
                <span>{t("operations.connections.provider")}</span>
                <input required maxLength={200} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder={t("operations.connections.providerPlaceholder")} />
              </label>
            </div>
            <label>
              <span>{t("operations.connections.descriptionField")}</span>
              <textarea required rows={3} maxLength={2_000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("operations.connections.descriptionPlaceholder")} />
            </label>
            <div className="form-grid">
              <label>
                <span>{t("operations.connections.kind")}</span>
                <select value={kind} onChange={(event) => {
                  const nextKind = event.target.value as CreateConnectionRequest["kind"];
                  setKind(nextKind);
                  if (nextKind === "cloudflare_service") setAuthKind("service_binding");
                  else if (authKind === "service_binding") setAuthKind("secret_reference");
                }}>
                  {CONNECTION_KINDS.map((value) => <option value={value} key={value}>{t(`operations.connections.kind.${value}`)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("operations.connections.capability")}</span>
                <select value={capabilityPreset} onChange={(event) => setCapabilityPreset(event.target.value as keyof typeof CONNECTION_CAPABILITY_PRESETS)}>
                  {Object.keys(CONNECTION_CAPABILITY_PRESETS).map((value) => <option value={value} key={value}>{t(`operations.connections.capability.${value}`)}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span>{t("operations.connections.remoteCapabilities")}</span>
              <textarea
                required={capabilityAllowlistRequired}
                rows={3}
                maxLength={26_000}
                value={allowedCapabilitiesText}
                onChange={(event) => setAllowedCapabilitiesText(event.target.value)}
                placeholder={t("operations.connections.remoteCapabilitiesPlaceholder")}
              />
              <small className="field-help">
                {capabilityAllowlistRequired
                  ? t("operations.connections.remoteCapabilitiesRequired")
                  : t("operations.connections.remoteCapabilitiesOptional")}
              </small>
            </label>
            {kind === "mcp" ? (
              <label>
                <span>{t("operations.connections.mcpProfile")}</span>
                <select value={mcpAdapterKind} onChange={(event) => setMcpAdapterKind(event.target.value as typeof mcpAdapterKind)}>
                  <option value="mcp_https">{t("operations.connections.mcpProfile.standard")}</option>
                  <option value="cloudflare_os_mcp">{t("operations.connections.mcpProfile.cloudflareOs")}</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>{t("operations.connections.endpoint")}</span>
              <input type="url" inputMode="url" required={endpointRequired} value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder={t("operations.connections.endpointPlaceholder")} />
              <small className="field-help">{endpointRequired ? t("operations.connections.endpointRequired") : t("operations.connections.endpointOptional")}</small>
            </label>
            {kind === "cloudflare_service" ? (
              <label>
                <span>{t("operations.connections.bindingReference")}</span>
                <input
                  required
                  autoComplete="off"
                  spellCheck={false}
                  pattern="[A-Z][A-Z0-9_]{2,127}"
                  value={bindingReference}
                  onChange={(event) => setBindingReference(event.target.value.toUpperCase())}
                  placeholder={t("operations.connections.bindingReferencePlaceholder")}
                />
                <small className="field-help">{t("operations.connections.bindingReferenceHelp")}</small>
              </label>
            ) : null}
            {actionEndpoint || kind === "cloudflare_service" ? (
              <div className="form-grid three-column-form-grid">
                <label><span>{t("operations.connections.route.health")}</span><input required maxLength={200} value={healthRoute} onChange={(event) => setHealthRoute(event.target.value)} /></label>
                <label><span>{t("operations.connections.route.discovery")}</span><input required maxLength={200} value={discoveryRoute} onChange={(event) => setDiscoveryRoute(event.target.value)} /></label>
                <label><span>{t("operations.connections.route.invoke")}</span><input required maxLength={200} value={invokeRoute} onChange={(event) => setInvokeRoute(event.target.value)} /></label>
              </div>
            ) : null}
            <div className="form-grid">
              <label>
                <span>{t("operations.connections.authentication")}</span>
                <select value={authKind} onChange={(event) => setAuthKind(event.target.value as CreateConnectionRequest["authKind"])}>
                  {AUTH_KINDS.map((value) => <option value={value} key={value}>{t(`operations.connections.auth.${value}`)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("operations.connections.secretReference")}</span>
                <input
                  required={secretRequired}
                  autoComplete="off"
                  spellCheck={false}
                  pattern="[A-Z][A-Z0-9_]{2,127}"
                  value={secretReference}
                  onChange={(event) => setSecretReference(event.target.value.toUpperCase())}
                  placeholder={t("operations.connections.secretReferencePlaceholder")}
                />
              </label>
            </div>
            {secretReference.trim() ? (
              <div className="form-grid">
                <label>
                  <span>{t("operations.connections.secretHeader")}</span>
                  <input required maxLength={200} value={secretHeaderName} onChange={(event) => setSecretHeaderName(event.target.value)} />
                </label>
                <label>
                  <span>{t("operations.connections.secretFormat")}</span>
                  <select value={secretFormat} onChange={(event) => setSecretFormat(event.target.value as typeof secretFormat)}>
                    <option value="bearer">{t("operations.connections.secretFormat.bearer")}</option>
                    <option value="raw">{t("operations.connections.secretFormat.raw")}</option>
                  </select>
                </label>
              </div>
            ) : null}
            <Notice>{t("operations.secretReferenceNotice")}</Notice>
            <div className="form-grid">
              <label>
                <span>{t("operations.security.visibility")}</span>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value as CreateConnectionRequest["visibility"])}>
                  {VISIBILITIES.map((value) => <option value={value} key={value}>{t(`operations.security.visibility.${value}`)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("operations.security.classification")}</span>
                <select value={classification} onChange={(event) => setClassification(event.target.value as CreateConnectionRequest["classification"])}>
                  {CLASSIFICATIONS.map((value) => <option value={value} key={value}>{t(`operations.security.classification.${value}`)}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span>{t("operations.connections.writeRisk")}</span>
              <select value={writeRiskLevel} onChange={(event) => setWriteRiskLevel(Number(event.target.value) as CreateConnectionRequest["writeRiskLevel"])}>
                {[0, 1, 2, 3].map((value) => <option value={value} key={value}>{t(`operations.risk.${value}`)}</option>)}
              </select>
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={busyKey !== null} onClick={() => setCreating(false)}>{t("common.cancel")}</button>
              <button className="primary-button" type="submit" disabled={busyKey !== null || !formReady}>
                {busyKey === "connection.create" ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
                {t("operations.connections.create")}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="content-section">
        {page.connections.length === 0 ? (
          <EmptyCollection icon={Plug} title={t("operations.connections.emptyTitle")} description={t("operations.connections.emptyDescription")} />
        ) : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.connections.column.connection")}</span>
              <span>{t("operations.connections.column.type")}</span>
              <span>{t("operations.connections.column.endpoint")}</span>
              <span>{t("operations.connections.column.health")}</span>
              <span className="align-right">{t("operations.connections.column.actions")}</span>
            </div>
            {page.connections.map((connection) => {
              const healthResult = healthResults[connection.id];
              const discoveryResult = discoveryResults[connection.id];
              const configuredIds = configuredCapabilityIds(connection.configuration);
              return (
              <article className="data-row" key={connection.id}>
                <div className="identity-cell">
                  <span className="identity-avatar"><Plug size={17} /></span>
                  <div>
                    <strong>{connection.name}</strong>
                    <small>{connection.provider ?? t("common.unknown")}</small>
                  </div>
                </div>
                <div data-label={t("operations.connections.column.type")}>
                  <span>{t(`operations.connections.kind.${connection.kind}`)}</span>
                </div>
                <div data-label={t("operations.connections.column.endpoint")}>
                  <strong>{connection.endpointUrl ?? t("common.none")}</strong>
                  <small>{connection.secretConfigured ? t("operations.secret.configured") : t("operations.secret.notConfigured")}</small>
                  <small>{t("operations.connections.configuredCapabilities", { count: configuredIds.length })}</small>
                </div>
                <div data-label={t("operations.connections.column.health")}>
                  <StatusPill namespace="health" status={connection.healthStatus ?? "unknown"} t={t} />
                </div>
                <div className="row-actions">
                  <StatusPill namespace="status" status={connection.status} t={t} />
                  {connection.status === "active" && page.capabilities.manageConnections ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={t("operations.connections.checkHealth")}
                      aria-label={t("operations.connections.checkHealthNamed", { name: connection.name })}
                      disabled={busyKey !== null}
                      onClick={() => void checkHealth(connection.id)}
                    >
                      {busyKey === `connection.health.${connection.id}` ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}
                    </button>
                  ) : null}
                  {connection.status === "active" ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={t("operations.connections.discover")}
                      aria-label={t("operations.connections.discoverNamed", { name: connection.name })}
                      disabled={busyKey !== null}
                      onClick={() => void discover(connection.id)}
                    >
                      {busyKey === `connection.discover.${connection.id}` ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}
                    </button>
                  ) : null}
                  {page.capabilities.manageConnections && connection.status !== "revoked" ? (
                    <button
                      className="icon-button danger-button"
                      type="button"
                      title={t("operations.connections.revoke")}
                      aria-label={t("operations.connections.revokeNamed", { name: connection.name })}
                      disabled={busyKey !== null}
                      onClick={() => void revoke(connection.id, connection.version, connection.name)}
                    >
                      {busyKey === `connection.revoke.${connection.id}` ? <LoaderCircle className="spin" size={17} /> : <Unlink size={17} />}
                    </button>
                  ) : null}
                </div>
                {healthResult || discoveryResult ? (
                  <div className="connection-diagnostic" aria-live="polite">
                    {healthResult ? (
                      <div>
                        <CheckCircle2 size={16} aria-hidden="true" />
                        <strong>{t(`operations.connectionHealth.${healthResult.status}`)}</strong>
                        <span>{t("operations.connections.healthDetail", { code: healthResult.code })}</span>
                        <small>{formatDate(healthResult.checkedAt, locale, t)}</small>
                      </div>
                    ) : null}
                    {discoveryResult ? (
                      <div>
                        <ScanSearch size={16} aria-hidden="true" />
                        <strong>{t("operations.connections.discoveryResult", { count: discoveryResult.capabilities.length })}</strong>
                        <span>{discoveryResult.capabilities.map((capability) => capability.title).join(", ") || t("operations.connections.discoveryEmpty")}</span>
                        {discoveryResult.oauth ? <small>{t("operations.connections.oauthIssuer", { issuer: discoveryResult.oauth.issuer })}</small> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

type AutomationForm = "workflow" | "rule" | "run" | null;

function AutomationTab({
  api,
  page,
  busyKey,
  run,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
}) {
  const { locale, t } = useOperationsI18n();
  const [openForm, setOpenForm] = useState<AutomationForm>(null);

  async function changeWorkflowStatus(
    workflow: UiOperationsPage["workflows"][number],
    status: UiOperationsPage["workflows"][number]["status"],
  ) {
    if (status === "archived" && !window.confirm(t("operations.automation.workflow.archiveConfirm", { name: workflow.name }))) return;
    await run(`workflow.status.${workflow.id}`, () => api.setWorkflowStatus({
      id: workflow.id,
      expectedVersion: workflow.version,
      status,
    }));
  }

  async function changeRuleStatus(
    rule: UiOperationsPage["automationRules"][number],
    status: UiOperationsPage["automationRules"][number]["status"],
  ) {
    if (status === "archived" && !window.confirm(t("operations.automation.rule.archiveConfirm", { name: rule.name }))) return;
    await run(`automation.status.${rule.id}`, () => api.setAutomationRuleStatus({
      id: rule.id,
      expectedVersion: rule.version,
      status,
    }));
  }

  if (!page.capabilities.readAutomation) return <NoAccess t={t} />;

  return (
    <>
      <section className="content-section">
        <SectionHeading icon={Workflow} title={t("operations.automation.title")} description={t("operations.automation.description")} />
        {page.capabilities.manageAutomation ? (
          <div className="action-group">
            <button className="secondary-button" type="button" onClick={() => setOpenForm("workflow")}><Plus size={17} />{t("operations.automation.workflow.add")}</button>
            <button className="secondary-button" type="button" disabled={!page.workflows.some((workflow) => workflow.status !== "archived") || page.agents.length === 0} onClick={() => setOpenForm("rule")}><Clock3 size={17} />{t("operations.automation.rule.add")}</button>
            <button className="primary-button" type="button" disabled={!page.workflows.some((workflow) => workflow.status === "active") || page.agents.length === 0} onClick={() => setOpenForm("run")}><Play size={17} />{t("operations.automation.run.open")}</button>
          </div>
        ) : null}
      </section>

      {openForm === "workflow" ? <WorkflowForm api={api} page={page} busyKey={busyKey} run={run} onClose={() => setOpenForm(null)} /> : null}
      {openForm === "rule" ? <AutomationRuleForm api={api} page={page} busyKey={busyKey} run={run} onClose={() => setOpenForm(null)} /> : null}
      {openForm === "run" ? <ManualRunForm api={api} page={page} busyKey={busyKey} run={run} onClose={() => setOpenForm(null)} /> : null}

      <section className="content-section">
        <SectionHeading icon={GitBranch} title={t("operations.automation.workflow.title")} description={t("operations.automation.workflow.description")} count={page.workflows.length} />
        {page.workflows.length === 0 ? (
          <EmptyCollection icon={GitBranch} title={t("operations.automation.workflow.emptyTitle")} description={t("operations.automation.workflow.emptyDescription")} />
        ) : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.automation.column.workflow")}</span>
              <span>{t("operations.automation.column.status")}</span>
              <span>{t("operations.automation.column.description")}</span>
              <span>{t("operations.automation.column.concurrency")}</span>
              <span className="align-right">{t("operations.automation.column.actions")}</span>
            </div>
            {page.workflows.map((workflow) => (
              <article className="data-row" key={workflow.id}>
                <div className="identity-cell"><span className="identity-avatar"><GitBranch size={17} /></span><div><strong>{workflow.name}</strong><small>{t("operations.version", { version: workflow.version })}</small></div></div>
                <div data-label={t("operations.automation.column.status")}><StatusPill namespace="status" status={workflow.status} t={t} /></div>
                <div data-label={t("operations.automation.column.description")}>{workflow.description}</div>
                <div data-label={t("operations.automation.column.concurrency")}>{workflow.maxConcurrentRuns}</div>
                <div className="row-actions">
                  {page.capabilities.manageAutomation ? (
                    <label>
                      <span className="sr-only">{t("operations.automation.workflow.changeStatusNamed", { name: workflow.name })}</span>
                      <select
                        aria-label={t("operations.automation.workflow.changeStatusNamed", { name: workflow.name })}
                        value={workflow.status}
                        disabled={busyKey !== null}
                        onChange={(event) => void changeWorkflowStatus(workflow, event.target.value as typeof workflow.status)}
                      >
                        {WORKFLOW_STATUSES.map((status) => <option value={status} key={status}>{t(`operations.status.${status}`)}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeading icon={Clock3} title={t("operations.automation.rule.title")} description={t("operations.automation.rule.description")} count={page.automationRules.length} />
        {page.automationRules.length === 0 ? (
          <EmptyCollection icon={Clock3} title={t("operations.automation.rule.emptyTitle")} description={t("operations.automation.rule.emptyDescription")} />
        ) : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.automation.column.automation")}</span>
              <span>{t("operations.automation.column.trigger")}</span>
              <span>{t("operations.automation.column.nextRun")}</span>
              <span>{t("operations.automation.column.failures")}</span>
              <span className="align-right">{t("operations.automation.column.actions")}</span>
            </div>
            {page.automationRules.map((rule) => (
              <article className="data-row" key={rule.id}>
                <div className="identity-cell"><span className="identity-avatar"><Clock3 size={17} /></span><div><strong>{rule.name}</strong><small>{t(`operations.automation.trigger.${rule.triggerKind}`)}</small></div></div>
                <div data-label={t("operations.automation.column.trigger")}><StatusPill namespace="status" status={rule.status} t={t} /></div>
                <div data-label={t("operations.automation.column.nextRun")}>{formatDate(rule.nextRunAt, locale, t)}</div>
                <div data-label={t("operations.automation.column.failures")}>{rule.consecutiveFailures}</div>
                <div className="row-actions">
                  {page.capabilities.manageAutomation ? (
                    <label>
                      <span className="sr-only">{t("operations.automation.rule.changeStatusNamed", { name: rule.name })}</span>
                      <select
                        aria-label={t("operations.automation.rule.changeStatusNamed", { name: rule.name })}
                        value={rule.status}
                        disabled={busyKey !== null}
                        onChange={(event) => void changeRuleStatus(rule, event.target.value as typeof rule.status)}
                      >
                        {AUTOMATION_STATUSES.map((status) => <option value={status} key={status}>{t(`operations.status.${status}`)}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeading icon={Activity} title={t("operations.automation.runs.title")} description={t("operations.automation.runs.description")} count={page.workflowRuns.length} />
        {page.workflowRuns.length === 0 ? (
          <EmptyCollection icon={Activity} title={t("operations.automation.runs.emptyTitle")} description={t("operations.automation.runs.emptyDescription")} />
        ) : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.automation.runs.column.run")}</span>
              <span>{t("operations.automation.runs.column.trigger")}</span>
              <span>{t("operations.automation.runs.column.created")}</span>
              <span>{t("operations.automation.runs.column.finished")}</span>
              <span>{t("operations.automation.runs.column.result")}</span>
            </div>
            {page.workflowRuns.map((workflowRun) => (
              <article className="data-row" key={workflowRun.id}>
                <div className="identity-cell"><span className="identity-avatar"><Activity size={17} /></span><div><strong>{workflowRun.id}</strong><small>{workflowRun.workflowId}</small></div></div>
                <div data-label={t("operations.automation.runs.column.trigger")}>{t(`operations.automation.trigger.${workflowRun.triggerKind}`)}</div>
                <div data-label={t("operations.automation.runs.column.created")}>{formatDate(workflowRun.createdAt, locale, t)}</div>
                <div data-label={t("operations.automation.runs.column.finished")}>{formatDate(workflowRun.finishedAt, locale, t)}</div>
                <div data-label={t("operations.automation.runs.column.result")}><StatusPill namespace="runStatus" status={workflowRun.status} t={t} />{workflowRun.errorMessage ? <small>{t("operations.automation.runs.error", { message: workflowRun.errorMessage })}</small> : null}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function WorkflowForm({
  api,
  page,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(1);
  const [allowConnectionAction, setAllowConnectionAction] = useState(
    page.connections.some((connection) => connection.status === "active"),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateWorkflowRequest = {
      spaceId: null,
      name: name.trim(),
      description: description.trim(),
      visibility: "guild",
      classification: "internal",
      maxConcurrentRuns,
      nodes: [{
        id: "approved-agent-run",
        type: "agent_action",
        configuration: {
          approvalMode: "risk_based",
          source: "operations_ui",
          connectionActionsAllowed: allowConnectionAction,
        },
      }],
      edges: [],
      allowedActionKinds: [
        "memory_search",
        "activity_draft",
        ...(allowConnectionAction ? ["connection_invoke" as const] : []),
      ],
      capabilityPermissions: [
        "memory.read",
        "activity.create",
        ...(allowConnectionAction ? ["connection.execute" as const] : []),
      ],
    };
    if (await run("workflow.create", () => api.createWorkflow(input))) onClose();
  }

  return (
    <section className="content-section">
      <FormHeading icon={GitBranch} title={t("operations.automation.workflow.createTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <label><span>{t("operations.automation.workflow.name")}</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("operations.automation.workflow.namePlaceholder")} /></label>
        <label><span>{t("operations.automation.workflow.descriptionField")}</span><textarea required rows={3} maxLength={2_000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("operations.automation.workflow.descriptionPlaceholder")} /></label>
        <label><span>{t("operations.automation.workflow.concurrency")}</span><input type="number" min={1} max={100} required value={maxConcurrentRuns} onChange={(event) => setMaxConcurrentRuns(Number(event.target.value))} /><small className="field-help">{t("operations.automation.workflow.concurrencyHelp")}</small></label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allowConnectionAction}
            disabled={!page.connections.some((connection) => connection.status === "active")}
            onChange={(event) => setAllowConnectionAction(event.target.checked)}
          />
          <span>{t("operations.automation.workflow.allowConnections")}</span>
        </label>
        <small className="field-help">{page.connections.some((connection) => connection.status === "active")
          ? t("operations.automation.workflow.allowConnectionsHelp")
          : t("operations.automation.workflow.noConnectionsHelp")}</small>
        <Notice>{t("operations.automation.workflow.defaultPlanNotice")}</Notice>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !name.trim() || !description.trim()}>{busyKey === "workflow.create" ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{t("operations.automation.workflow.create")}</button></div>
      </form>
    </section>
  );
}

function AutomationRuleForm({
  api,
  page,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const [workflowId, setWorkflowId] = useState(page.workflows.find((workflow) => workflow.status === "active")?.id ?? page.workflows.find((workflow) => workflow.status !== "archived")?.id ?? "");
  const [agentActorId, setAgentActorId] = useState(page.agents[0]?.id ?? "");
  const [name, setName] = useState("");
  const [triggerKind, setTriggerKind] = useState<CreateAutomationRuleRequest["triggerKind"]>("schedule");
  const [schedulePreset, setSchedulePreset] = useState<(typeof SCHEDULE_PRESETS)[number]>("weekdays");
  const [eventName, setEventName] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [nextRunAt, setNextRunAt] = useState(nextHourLocalValue);
  const [objective, setObjective] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const triggerExpression = triggerKind === "schedule"
      ? scheduleExpression(schedulePreset, nextRunAt)
      : triggerKind === "event"
        ? eventName.trim()
        : "manual";
    const input: CreateAutomationRuleRequest = {
      workflowId,
      agentActorId,
      name: name.trim(),
      triggerKind,
      triggerExpression,
      timezone,
      inputTemplate: { objective: objective.trim(), source: "operations_ui" },
      nextRunAt: triggerKind === "schedule" ? new Date(nextRunAt).toISOString() : null,
    };
    if (await run("automation.create", () => api.createAutomationRule(input))) onClose();
  }

  const ready = workflowId && agentActorId && name.trim() && objective.trim() &&
    (triggerKind !== "event" || eventName.trim()) && (triggerKind !== "schedule" || nextRunAt);

  return (
    <section className="content-section">
      <FormHeading icon={Clock3} title={t("operations.automation.rule.createTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label><span>{t("operations.automation.rule.name")}</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("operations.automation.rule.namePlaceholder")} /></label>
          <label><span>{t("operations.automation.rule.trigger")}</span><select value={triggerKind} onChange={(event) => setTriggerKind(event.target.value as CreateAutomationRuleRequest["triggerKind"])}>{AUTOMATION_TRIGGERS.map((value) => <option value={value} key={value}>{t(`operations.automation.trigger.${value}`)}</option>)}</select></label>
        </div>
        <div className="form-grid">
          <label><span>{t("operations.automation.rule.workflow")}</span><select required value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>{page.workflows.filter((workflow) => workflow.status !== "archived").map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select></label>
          <label><span>{t("operations.automation.rule.agent")}</span><select required value={agentActorId} onChange={(event) => setAgentActorId(event.target.value)}>{page.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}</select></label>
        </div>
        {triggerKind === "schedule" ? (
          <div className="form-grid">
            <label><span>{t("operations.automation.rule.schedule")}</span><select value={schedulePreset} onChange={(event) => setSchedulePreset(event.target.value as (typeof SCHEDULE_PRESETS)[number])}>{SCHEDULE_PRESETS.map((value) => <option value={value} key={value}>{t(`operations.automation.schedule.${value}`)}</option>)}</select></label>
            <label><span>{t("operations.automation.rule.firstRun")}</span><input type="datetime-local" required value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></label>
          </div>
        ) : triggerKind === "event" ? (
          <label><span>{t("operations.automation.rule.event")}</span><input required maxLength={500} value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder={t("operations.automation.rule.eventPlaceholder")} /></label>
        ) : null}
        <label><span>{t("operations.automation.rule.timezone")}</span><input required maxLength={100} value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
        <label><span>{t("operations.automation.rule.objective")}</span><textarea required rows={3} maxLength={2_000} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={t("operations.automation.rule.objectivePlaceholder")} /></label>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !ready}>{busyKey === "automation.create" ? <LoaderCircle className="spin" size={17} /> : <Clock3 size={17} />}{t("operations.automation.rule.create")}</button></div>
      </form>
    </section>
  );
}

function ManualRunForm({
  api,
  page,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const [workflowId, setWorkflowId] = useState(page.workflows.find((workflow) => workflow.status === "active")?.id ?? page.workflows[0]?.id ?? "");
  const [agentActorId, setAgentActorId] = useState(page.agents[0]?.id ?? "");
  const [objective, setObjective] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: RunWorkflowRequest = {
      workflowId,
      agentActorId,
      input: { objective: objective.trim(), source: "operations_ui" },
      idempotencyKey: `manual-${crypto.randomUUID()}`,
    };
    if (await run("workflow.run", () => api.runWorkflow(input))) onClose();
  }

  return (
    <section className="content-section">
      <FormHeading icon={Play} title={t("operations.automation.run.title")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label><span>{t("operations.automation.run.workflow")}</span><select required value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>{page.workflows.filter((workflow) => workflow.status === "active").map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select></label>
          <label><span>{t("operations.automation.run.agent")}</span><select required value={agentActorId} onChange={(event) => setAgentActorId(event.target.value)}>{page.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.displayName}</option>)}</select></label>
        </div>
        <label><span>{t("operations.automation.run.objective")}</span><textarea required rows={4} maxLength={5_000} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={t("operations.automation.run.objectivePlaceholder")} /></label>
        <Notice>{t("operations.automation.run.approvalNotice")}</Notice>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !workflowId || !agentActorId || !objective.trim()}>{busyKey === "workflow.run" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{t("operations.automation.run.submit")}</button></div>
      </form>
    </section>
  );
}

function FederationTab({
  api,
  page,
  busyKey,
  run,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
}) {
  const { t } = useOperationsI18n();
  const [form, setForm] = useState<"link" | "grant" | null>(null);

  async function activate(link: UiOperationsPage["federationLinks"][number]) {
    await run(`federation.activate.${link.id}`, () => api.activateFederationLink({ id: link.id, expectedVersion: link.version, status: "active" }));
  }

  async function revokeLink(link: UiOperationsPage["federationLinks"][number]) {
    if (!window.confirm(t("operations.federation.link.revokeConfirm", { name: link.remoteName }))) return;
    await run(`federation.revoke.${link.id}`, () => api.revokeFederationLink({ id: link.id, expectedVersion: link.version, status: "revoked" }));
  }

  async function revokeGrant(grant: UiOperationsPage["federationGrants"][number]) {
    if (!window.confirm(t("operations.federation.grant.revokeConfirm"))) return;
    await run(`federation.grant.revoke.${grant.id}`, () => api.revokeFederationGrant({ id: grant.id, expectedVersion: grant.version, status: "revoked" }));
  }

  if (!page.capabilities.readFederation) return <NoAccess t={t} />;

  return (
    <>
      <section className="content-section">
        <SectionHeading icon={Network} title={t("operations.federation.title")} description={t("operations.federation.description")} />
        {page.capabilities.manageFederation ? <div className="action-group"><button className="secondary-button" type="button" onClick={() => setForm("link")}><Link2 size={17} />{t("operations.federation.link.add")}</button><button className="primary-button" type="button" disabled={!page.federationLinks.some((link) => link.status === "active")} onClick={() => setForm("grant")}><ShieldCheck size={17} />{t("operations.federation.grant.add")}</button></div> : null}
      </section>

      {form === "link" ? <FederationLinkForm api={api} busyKey={busyKey} run={run} onClose={() => setForm(null)} /> : null}
      {form === "grant" ? <FederationGrantForm api={api} page={page} busyKey={busyKey} run={run} onClose={() => setForm(null)} /> : null}

      <section className="content-section">
        <SectionHeading icon={RadioTower} title={t("operations.federation.linksTitle")} description={t("operations.federation.linksDescription")} count={page.federationLinks.length} />
        {page.federationLinks.length === 0 ? <EmptyCollection icon={RadioTower} title={t("operations.federation.link.emptyTitle")} description={t("operations.federation.link.emptyDescription")} /> : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true"><span>{t("operations.federation.column.guild")}</span><span>{t("operations.federation.column.direction")}</span><span>{t("operations.federation.column.endpoint")}</span><span>{t("operations.federation.column.status")}</span><span className="align-right">{t("operations.federation.column.actions")}</span></div>
            {page.federationLinks.map((link) => <article className="data-row" key={link.id}>
              <div className="identity-cell"><span className="identity-avatar"><RadioTower size={17} /></span><div><strong>{link.remoteName}</strong><small>{link.remoteGuildId}</small></div></div>
              <div data-label={t("operations.federation.column.direction")}>{t(`operations.federation.direction.${link.direction}`)}</div>
              <div data-label={t("operations.federation.column.endpoint")}><strong>{link.endpointUrl}</strong><small>{link.secretConfigured ? t("operations.secret.configured") : t("operations.secret.notConfigured")}</small></div>
              <div data-label={t("operations.federation.column.status")}><StatusPill namespace="status" status={link.status} t={t} /></div>
              <div className="row-actions">
                {page.capabilities.manageFederation && link.status === "pending" ? <button className="text-button" type="button" disabled={busyKey !== null} onClick={() => void activate(link)}>{busyKey === `federation.activate.${link.id}` ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{t("operations.federation.link.activate")}</button> : null}
                {page.capabilities.manageFederation && link.status !== "revoked" ? <button className="icon-button danger-button" type="button" title={t("operations.federation.link.revoke")} aria-label={t("operations.federation.link.revokeNamed", { name: link.remoteName })} disabled={busyKey !== null} onClick={() => void revokeLink(link)}>{busyKey === `federation.revoke.${link.id}` ? <LoaderCircle className="spin" size={17} /> : <Unlink size={17} />}</button> : null}
              </div>
            </article>)}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeading icon={ShieldCheck} title={t("operations.federation.grantsTitle")} description={t("operations.federation.grantsDescription")} count={page.federationGrants.length} />
        {page.federationGrants.length === 0 ? <EmptyCollection icon={ShieldCheck} title={t("operations.federation.grant.emptyTitle")} description={t("operations.federation.grant.emptyDescription")} /> : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true"><span>{t("operations.federation.grant.column.resource")}</span><span>{t("operations.federation.grant.column.type")}</span><span>{t("operations.federation.grant.column.permission")}</span><span>{t("operations.federation.grant.column.status")}</span><span className="align-right">{t("operations.federation.grant.column.actions")}</span></div>
            {page.federationGrants.map((grant) => <article className="data-row" key={grant.id}>
              <div className="identity-cell"><span className="identity-avatar"><ShieldCheck size={17} /></span><div><strong>{grant.resourceId}</strong><small>{grant.federationLinkId}</small></div></div>
              <div data-label={t("operations.federation.grant.column.type")}>{t(`operations.federation.resource.${grant.resourceType}`)}</div>
              <div data-label={t("operations.federation.grant.column.permission")}>{t(`operations.federation.permission.${grant.permission}`)}</div>
              <div data-label={t("operations.federation.grant.column.status")}><StatusPill namespace="status" status={grant.status} t={t} /></div>
              <div className="row-actions">{page.capabilities.manageFederation && grant.status !== "revoked" ? <button className="icon-button danger-button" type="button" title={t("operations.federation.grant.revoke")} aria-label={t("operations.federation.grant.revoke")} disabled={busyKey !== null} onClick={() => void revokeGrant(grant)}>{busyKey === `federation.grant.revoke.${grant.id}` ? <LoaderCircle className="spin" size={17} /> : <Unlink size={17} />}</button> : null}</div>
            </article>)}
          </div>
        )}
      </section>
    </>
  );
}

function FederationLinkForm({
  api,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const [remoteGuildId, setRemoteGuildId] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secretReference, setSecretReference] = useState("");
  const [direction, setDirection] = useState<CreateFederationLinkRequest["direction"]>("bidirectional");
  const [resources, setResources] = useState<CreateFederationLinkRequest["allowedResourceTypes"]>(["memory"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateFederationLinkRequest = { remoteGuildId: remoteGuildId.trim(), remoteName: remoteName.trim(), endpointUrl: endpointUrl.trim(), secretReference: secretReference.trim(), direction, allowedResourceTypes: resources };
    if (await run("federation.create", () => api.createFederationLink(input))) onClose();
  }

  function toggleResource(resource: (typeof FEDERATION_RESOURCES)[number]) {
    setResources((current) => current.includes(resource) ? current.filter((value) => value !== resource) : [...current, resource]);
  }

  return (
    <section className="content-section">
      <FormHeading icon={Link2} title={t("operations.federation.link.createTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid"><label><span>{t("operations.federation.link.remoteName")}</span><input required maxLength={200} value={remoteName} onChange={(event) => setRemoteName(event.target.value)} placeholder={t("operations.federation.link.remoteNamePlaceholder")} /></label><label><span>{t("operations.federation.link.remoteGuildId")}</span><input required autoComplete="off" pattern={UUID_PATTERN} value={remoteGuildId} onChange={(event) => setRemoteGuildId(event.target.value)} placeholder={t("operations.federation.link.remoteGuildIdPlaceholder")} /></label></div>
        <label><span>{t("operations.federation.link.endpoint")}</span><input type="url" inputMode="url" required value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder={t("operations.federation.link.endpointPlaceholder")} /></label>
        <div className="form-grid"><label><span>{t("operations.federation.link.direction")}</span><select value={direction} onChange={(event) => setDirection(event.target.value as CreateFederationLinkRequest["direction"])}>{FEDERATION_DIRECTIONS.map((value) => <option value={value} key={value}>{t(`operations.federation.direction.${value}`)}</option>)}</select></label><label><span>{t("operations.federation.link.secretReference")}</span><input required autoComplete="off" spellCheck={false} pattern="[A-Z][A-Z0-9_]{2,127}" value={secretReference} onChange={(event) => setSecretReference(event.target.value.toUpperCase())} placeholder={t("operations.federation.link.secretReferencePlaceholder")} /></label></div>
        <Notice>{t("operations.secretReferenceNotice")}</Notice>
        <fieldset><legend>{t("operations.federation.link.resources")}</legend><div className="permission-grid">{FEDERATION_RESOURCES.map((resource) => <label className="checkbox-row" key={resource}><input type="checkbox" checked={resources.includes(resource)} onChange={() => toggleResource(resource)} /><span>{t(`operations.federation.resource.${resource}`)}</span></label>)}</div></fieldset>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !remoteGuildId.trim() || !remoteName.trim() || !endpointUrl.trim() || !secretReference.trim() || resources.length === 0}>{busyKey === "federation.create" ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}{t("operations.federation.link.create")}</button></div>
      </form>
    </section>
  );
}

function FederationGrantForm({
  api,
  page,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const activeLinks = page.federationLinks.filter((link) => link.status === "active");
  const [federationLinkId, setFederationLinkId] = useState(activeLinks[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<CreateFederationGrantRequest["resourceType"]>("memory");
  const [resourceId, setResourceId] = useState("");
  const [permission, setPermission] = useState<CreateFederationGrantRequest["permission"]>("read");
  const selectedLink = activeLinks.find((link) => link.id === federationLinkId);
  const availableResources = FEDERATION_RESOURCES.filter((value) => selectedLink?.allowedResourceTypes.includes(value));

  function chooseLink(value: string) {
    const link = activeLinks.find((candidate) => candidate.id === value);
    const firstAllowed = FEDERATION_RESOURCES.find((resource) =>
      link?.allowedResourceTypes.includes(resource));
    setFederationLinkId(value);
    setResourceType(firstAllowed ?? "memory");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateFederationGrantRequest = { federationLinkId, resourceType, resourceId: resourceId.trim(), permission };
    if (await run("federation.grant.create", () => api.createFederationGrant(input))) onClose();
  }

  return (
    <section className="content-section">
      <FormHeading icon={ShieldCheck} title={t("operations.federation.grant.createTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <label><span>{t("operations.federation.grant.link")}</span><select required value={federationLinkId} onChange={(event) => chooseLink(event.target.value)}>{activeLinks.map((link) => <option value={link.id} key={link.id}>{link.remoteName}</option>)}</select></label>
        <div className="form-grid"><label><span>{t("operations.federation.grant.resourceType")}</span><select value={resourceType} onChange={(event) => setResourceType(event.target.value as CreateFederationGrantRequest["resourceType"])}>{availableResources.map((value) => <option value={value} key={value}>{t(`operations.federation.resource.${value}`)}</option>)}</select></label><label><span>{t("operations.federation.grant.permission")}</span><select value={permission} onChange={(event) => setPermission(event.target.value as CreateFederationGrantRequest["permission"])}><option value="read">{t("operations.federation.permission.read")}</option><option value="participate">{t("operations.federation.permission.participate")}</option></select></label></div>
        <label><span>{t("operations.federation.grant.resourceId")}</span><input required autoComplete="off" pattern={UUID_PATTERN} value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder={t("operations.federation.grant.resourceIdPlaceholder")} /><small className="field-help">{t("operations.federation.grant.resourceIdHelp")}</small></label>
        <Notice>{t("operations.federation.grant.explicitNotice")}</Notice>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !federationLinkId || !resourceId.trim()}>{busyKey === "federation.grant.create" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}{t("operations.federation.grant.create")}</button></div>
      </form>
    </section>
  );
}

function ModelsTab({
  api,
  page,
  busyKey,
  run,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
}) {
  const { t } = useOperationsI18n();
  const [form, setForm] = useState<"provider" | "route" | null>(null);
  const [routeToEdit, setRouteToEdit] = useState<UiOperationsPage["modelRoutes"][number] | null>(null);

  async function revokeProvider(provider: UiOperationsPage["modelProviders"][number]) {
    if (!window.confirm(t("operations.models.provider.revokeConfirm", { name: provider.name }))) return;
    await run(`model.provider.revoke.${provider.id}`, () => api.revokeModelProvider({ id: provider.id, expectedVersion: provider.version, status: "revoked" }));
  }

  if (!page.capabilities.readData) return <NoAccess t={t} />;

  return (
    <>
      <section className="content-section">
        <SectionHeading icon={BrainCircuit} title={t("operations.models.title")} description={t("operations.models.description")} />
        {page.capabilities.manageData ? <div className="action-group"><button className="secondary-button" type="button" onClick={() => setForm("provider")}><Plus size={17} />{t("operations.models.provider.add")}</button><button className="primary-button" type="button" disabled={!page.modelProviders.some((provider) => provider.status === "active")} onClick={() => { setRouteToEdit(null); setForm("route"); }}><GitBranch size={17} />{t("operations.models.route.configure")}</button></div> : null}
      </section>

      {form === "provider" ? <ModelProviderForm api={api} busyKey={busyKey} run={run} onClose={() => setForm(null)} /> : null}
      {form === "route" ? <ModelRouteForm key={routeToEdit?.id ?? "new-route"} api={api} page={page} initialRoute={routeToEdit} busyKey={busyKey} run={run} onClose={() => { setForm(null); setRouteToEdit(null); }} /> : null}

      <section className="content-section">
        <SectionHeading icon={CloudCog} title={t("operations.models.providersTitle")} description={t("operations.models.providersDescription")} count={page.modelProviders.length} />
        {page.modelProviders.length === 0 ? <EmptyCollection icon={CloudCog} title={t("operations.models.provider.emptyTitle")} description={t("operations.models.provider.emptyDescription")} /> : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true"><span>{t("operations.models.provider.column.provider")}</span><span>{t("operations.models.provider.column.type")}</span><span>{t("operations.models.provider.column.models")}</span><span>{t("operations.models.provider.column.status")}</span><span className="align-right">{t("operations.models.provider.column.actions")}</span></div>
            {page.modelProviders.map((provider) => <article className="data-row" key={provider.id}>
              <div className="identity-cell"><span className="identity-avatar"><CloudCog size={17} /></span><div><strong>{provider.name}</strong><small>{provider.secretConfigured ? t("operations.secret.configured") : t("operations.secret.notConfigured")}</small></div></div>
              <div data-label={t("operations.models.provider.column.type")}>{t(`operations.models.provider.kind.${provider.kind}`)}</div>
              <div data-label={t("operations.models.provider.column.models")}>{t("operations.models.provider.modelCount", { count: provider.allowedModels.length })}</div>
              <div data-label={t("operations.models.provider.column.status")}><StatusPill namespace="status" status={provider.status} t={t} /></div>
              <div className="row-actions">{page.capabilities.manageData && provider.status !== "revoked" ? <button className="icon-button danger-button" type="button" title={t("operations.models.provider.revoke")} aria-label={t("operations.models.provider.revokeNamed", { name: provider.name })} disabled={busyKey !== null} onClick={() => void revokeProvider(provider)}>{busyKey === `model.provider.revoke.${provider.id}` ? <LoaderCircle className="spin" size={17} /> : <Unlink size={17} />}</button> : null}</div>
            </article>)}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeading icon={GitBranch} title={t("operations.models.routesTitle")} description={t("operations.models.routesDescription")} count={page.modelRoutes.length} />
        {page.modelRoutes.length === 0 ? <EmptyCollection icon={GitBranch} title={t("operations.models.route.emptyTitle")} description={t("operations.models.route.emptyDescription")} /> : (
          <div className="data-table">
            <div className="data-table-head" aria-hidden="true"><span>{t("operations.models.route.column.purpose")}</span><span>{t("operations.models.route.column.provider")}</span><span>{t("operations.models.route.column.model")}</span><span>{t("operations.models.route.column.status")}</span><span className="align-right">{t("operations.models.route.column.actions")}</span></div>
            {page.modelRoutes.map((route) => {
              const provider = page.modelProviders.find((candidate) => candidate.id === route.providerId);
              return <article className="data-row" key={route.id}>
                <div className="identity-cell"><span className="identity-avatar"><BrainCircuit size={17} /></span><div><strong>{t(`operations.models.purpose.${route.purpose}`)}</strong><small>{t("operations.version", { version: route.version })}</small></div></div>
                <div data-label={t("operations.models.route.column.provider")}>{provider?.name ?? t("common.unknown")}</div>
                <div data-label={t("operations.models.route.column.model")}><strong>{route.primaryModel}</strong><small>{route.fallbackModel ? t("operations.models.route.fallbackValue", { model: route.fallbackModel }) : t("operations.models.route.noFallback")}</small></div>
                <div data-label={t("operations.models.route.column.status")}><StatusPill namespace="status" status={route.status} t={t} /></div>
                <div className="row-actions">{page.capabilities.manageData ? <button className="text-button" type="button" onClick={() => { setRouteToEdit(route); setForm("route"); }}><Save size={16} />{t("operations.models.route.edit")}</button> : null}</div>
              </article>;
            })}
          </div>
        )}
      </section>
    </>
  );
}

function ModelProviderForm({
  api,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CreateModelProviderRequest["kind"]>("workers_ai");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secretReference, setSecretReference] = useState("");
  const [models, setModels] = useState("");
  const allowedModels = useMemo(() => [
    ...new Set(models.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)),
  ], [models]);
  const external = kind !== "workers_ai";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateModelProviderRequest = { name: name.trim(), kind, endpointUrl: endpointUrl.trim() || null, secretReference: secretReference.trim() || null, allowedModels };
    if (await run("model.provider.create", () => api.createModelProvider(input))) onClose();
  }

  return (
    <section className="content-section">
      <FormHeading icon={CloudCog} title={t("operations.models.provider.createTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid"><label><span>{t("operations.models.provider.name")}</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("operations.models.provider.namePlaceholder")} /></label><label><span>{t("operations.models.provider.kind")}</span><select value={kind} onChange={(event) => setKind(event.target.value as CreateModelProviderRequest["kind"])}>{MODEL_PROVIDER_KINDS.map((value) => <option value={value} key={value}>{t(`operations.models.provider.kind.${value}`)}</option>)}</select></label></div>
        <label><span>{t("operations.models.provider.endpoint")}</span><input type="url" inputMode="url" required={external} value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder={t("operations.models.provider.endpointPlaceholder")} /><small className="field-help">{external ? t("operations.models.provider.endpointRequired") : t("operations.models.provider.endpointManaged")}</small></label>
        <label><span>{t("operations.models.provider.secretReference")}</span><input required={external} autoComplete="off" spellCheck={false} pattern="[A-Z][A-Z0-9_]{2,127}" value={secretReference} onChange={(event) => setSecretReference(event.target.value.toUpperCase())} placeholder={t("operations.models.provider.secretReferencePlaceholder")} /></label>
        <Notice>{t("operations.secretReferenceNotice")}</Notice>
        <label><span>{t("operations.models.provider.allowedModels")}</span><textarea required rows={4} maxLength={10_000} value={models} onChange={(event) => setModels(event.target.value)} placeholder={t("operations.models.provider.allowedModelsPlaceholder")} /><small className="field-help">{t("operations.models.provider.allowedModelsHelp")}</small></label>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !name.trim() || allowedModels.length === 0 || (external && (!endpointUrl.trim() || !secretReference.trim()))}>{busyKey === "model.provider.create" ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{t("operations.models.provider.create")}</button></div>
      </form>
    </section>
  );
}

function ModelRouteForm({
  api,
  page,
  initialRoute,
  busyKey,
  run,
  onClose,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  initialRoute: UiOperationsPage["modelRoutes"][number] | null;
  busyKey: string | null;
  run: MutationRunner;
  onClose(): void;
}) {
  const { t } = useOperationsI18n();
  const activeProviders = page.modelProviders.filter((provider) => provider.status === "active");
  const initialProvider = activeProviders.find((provider) => provider.id === initialRoute?.providerId) ??
    activeProviders[0];
  const initialProviderId = initialProvider?.id ?? "";
  const [purpose, setPurpose] = useState<SetModelRouteRequest["purpose"]>(initialRoute?.purpose ?? "ask");
  const [providerId, setProviderId] = useState(initialProviderId);
  const initialRouteUsesProvider = initialRoute?.providerId === initialProviderId;
  const [primaryModel, setPrimaryModel] = useState(initialRouteUsesProvider ? initialRoute?.primaryModel ?? "" : initialProvider?.allowedModels[0] ?? "");
  const [fallbackModel, setFallbackModel] = useState(initialRouteUsesProvider ? initialRoute?.fallbackModel ?? "" : "");
  const [maxTokens, setMaxTokens] = useState(initialRoute?.maxTokens ?? 4_096);
  const [dailyBudget, setDailyBudget] = useState((initialRoute?.dailyBudgetMinor ?? 0) / 100);
  const [cacheEnabled, setCacheEnabled] = useState(initialRoute?.cacheEnabled ?? true);
  const [status, setStatus] = useState<SetModelRouteRequest["status"]>(initialRoute?.status ?? "active");
  const provider = activeProviders.find((candidate) => candidate.id === providerId);
  const existingForPurpose = page.modelRoutes.find((route) => route.purpose === purpose);

  function choosePurpose(value: SetModelRouteRequest["purpose"]) {
    const existing = page.modelRoutes.find((route) => route.purpose === value);
    const nextProviderId = existing?.providerId ?? activeProviders[0]?.id ?? "";
    const nextProvider = activeProviders.find((candidate) => candidate.id === nextProviderId);
    setPurpose(value);
    setProviderId(nextProviderId);
    setPrimaryModel(existing?.primaryModel ?? nextProvider?.allowedModels[0] ?? "");
    setFallbackModel(existing?.fallbackModel ?? "");
    setMaxTokens(existing?.maxTokens ?? 4_096);
    setDailyBudget((existing?.dailyBudgetMinor ?? 0) / 100);
    setCacheEnabled(existing?.cacheEnabled ?? true);
    setStatus(existing?.status ?? "active");
  }

  function chooseProvider(value: string) {
    const selected = activeProviders.find((candidate) => candidate.id === value);
    setProviderId(value);
    setPrimaryModel(selected?.allowedModels[0] ?? "");
    setFallbackModel("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: SetModelRouteRequest = {
      purpose,
      providerId,
      primaryModel,
      fallbackModel: fallbackModel || null,
      maxTokens,
      dailyBudgetMinor: Math.round(dailyBudget * 100),
      cacheEnabled,
      status,
      expectedVersion: existingForPurpose?.version ?? null,
    };
    if (await run("model.route.save", () => api.setModelRoute(input))) onClose();
  }

  return (
    <section className="content-section">
      <FormHeading icon={GitBranch} title={t("operations.models.route.formTitle")} closeLabel={t("common.close")} onClose={onClose} />
      <form className="stack-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid"><label><span>{t("operations.models.route.purpose")}</span><select value={purpose} onChange={(event) => choosePurpose(event.target.value as SetModelRouteRequest["purpose"])}>{MODEL_PURPOSES.map((value) => <option value={value} key={value}>{t(`operations.models.purpose.${value}`)}</option>)}</select></label><label><span>{t("operations.models.route.provider")}</span><select required value={providerId} onChange={(event) => chooseProvider(event.target.value)}>{activeProviders.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label></div>
        <div className="form-grid"><label><span>{t("operations.models.route.primaryModel")}</span><select required value={primaryModel} onChange={(event) => setPrimaryModel(event.target.value)}>{provider?.allowedModels.map((model) => <option value={model} key={model}>{model}</option>)}</select></label><label><span>{t("operations.models.route.fallbackModel")}</span><select value={fallbackModel} onChange={(event) => setFallbackModel(event.target.value)}><option value="">{t("common.none")}</option>{provider?.allowedModels.filter((model) => model !== primaryModel).map((model) => <option value={model} key={model}>{model}</option>)}</select></label></div>
        <div className="form-grid"><label><span>{t("operations.models.route.maxTokens")}</span><input type="number" min={1} max={1_000_000} required value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label><label><span>{t("operations.models.route.dailyBudget")}</span><input type="number" min={0} step="0.01" required value={dailyBudget} onChange={(event) => setDailyBudget(Number(event.target.value))} /><small className="field-help">{t("operations.models.route.dailyBudgetHelp")}</small></label></div>
        <div className="form-grid"><label><span>{t("operations.models.route.status")}</span><select value={status} onChange={(event) => setStatus(event.target.value as SetModelRouteRequest["status"])}><option value="active">{t("operations.status.active")}</option><option value="disabled">{t("operations.status.disabled")}</option></select></label><label className="checkbox-row"><input type="checkbox" checked={cacheEnabled} onChange={(event) => setCacheEnabled(event.target.checked)} /><span>{t("operations.models.route.cache")}</span></label></div>
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busyKey !== null} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" type="submit" disabled={busyKey !== null || !providerId || !primaryModel || maxTokens < 1 || dailyBudget < 0}>{busyKey === "model.route.save" ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{t("operations.models.route.save")}</button></div>
      </form>
    </section>
  );
}

function DataTab({
  api,
  page,
  busyKey,
  run,
}: {
  api: GuildUiApi;
  page: UiOperationsPage;
  busyKey: string | null;
  run: MutationRunner;
}) {
  const { locale, t } = useOperationsI18n();
  const [includePersonal, setIncludePersonal] = useState(false);
  const [retentionCutoff, setRetentionCutoff] = useState(() =>
    retentionCutoffLocalValue(page.dataRetentionDays));
  const [retentionSelection, setRetentionSelection] = useState<
    Record<UiRetentionCategory, UiRetentionActionKind>
  >({ ...DEFAULT_RETENTION_SELECTION });
  const [selectedPreviewId, setSelectedPreviewId] = useState("");
  const [retentionConfirmation, setRetentionConfirmation] = useState("");
  const inventory = page.exportInventory;
  const retentionPlan = RETENTION_CATEGORIES.map((category) => ({
    category,
    action: retentionSelection[category],
  }));
  const selectedPreview = page.retentionRuns.find((retentionRun) =>
    retentionRun.id === selectedPreviewId && retentionRun.dryRun &&
    retentionRun.status === "completed");
  const retentionHasMutation = retentionPlan.some((action) => action.action !== "retain");
  const retentionHasPurge = retentionPlan.some((action) => action.action === "purge");
  const expectedRetentionConfirmation = retentionHasPurge ? "PURGE" : "APPLY";

  function chooseRetentionPreview(id: string) {
    setSelectedPreviewId(id);
    setRetentionConfirmation("");
    const preview = page.retentionRuns.find((runItem) => runItem.id === id);
    if (!preview) return;
    setRetentionCutoff(isoToLocalValue(preview.cutoffAt));
    setRetentionSelection({
      ...DEFAULT_RETENTION_SELECTION,
      ...Object.fromEntries(preview.actions.map((action) => [action.category, action.action])),
    });
  }

  function retentionRequest(dryRun: boolean): PlanRetentionRequest {
    return {
      dryRun,
      cutoffAt: new Date(retentionCutoff).toISOString(),
      actions: retentionPlan,
      previewRunId: dryRun ? null : selectedPreviewId || null,
      confirmation: dryRun ? "" : retentionConfirmation,
      idempotencyKey: `guild-ui:retention:${dryRun ? "preview" : "apply"}:${crypto.randomUUID()}`,
    };
  }
  if (!page.capabilities.readData) return <NoAccess t={t} />;
  if (!inventory) return <EmptyCollection icon={Database} title={t("operations.data.emptyTitle")} description={t("operations.data.emptyDescription")} />;

  return (
    <>
      <section className="content-section">
        <SectionHeading icon={Database} title={t("operations.data.title")} description={t("operations.data.description")} />
        <Notice>{t("operations.data.ownershipNotice")}</Notice>
        <div className="metric-strip">
          <div><Database size={19} /><strong>{inventory.guild.name}</strong><span>{t("operations.data.guild")}</span></div>
          <div><TableProperties size={19} /><strong>{inventory.totalRows}</strong><span>{t("operations.data.rows")}</span></div>
          <div><HardDrive size={19} /><strong>{inventory.files.length}</strong><span>{t("operations.data.files")}</span></div>
          <div><Clock3 size={19} /><strong>{formatDate(inventory.generatedAt, locale, t)}</strong><span>{t("operations.data.generated")}</span></div>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading icon={TableProperties} title={t("operations.data.tablesTitle")} description={t("operations.data.tablesDescription")} count={inventory.tables.length} />
        {inventory.tables.length === 0 ? <EmptyCollection icon={TableProperties} title={t("operations.data.tablesEmptyTitle")} description={t("operations.data.tablesEmptyDescription")} /> : <dl className="definition-list">{inventory.tables.map((table) => <div key={table.tableName}><TableProperties size={18} /><dt>{table.tableName}</dt><dd>{t("operations.data.rowCount", { count: table.rowCount })}</dd></div>)}</dl>}
      </section>

      <section className="content-section">
        <SectionHeading icon={FileArchive} title={t("operations.data.filesTitle")} description={t("operations.data.filesDescription")} count={inventory.files.length} />
        {inventory.files.length === 0 ? <EmptyCollection icon={FileArchive} title={t("operations.data.filesEmptyTitle")} description={t("operations.data.filesEmptyDescription")} /> : <dl className="definition-list">{inventory.files.map((file) => <div key={file.id}><FileArchive size={18} /><dt>{file.r2Key}</dt><dd>{t("operations.data.fileDetail", { mediaType: file.mediaType, byteSize: file.byteSize, createdAt: formatDate(file.createdAt, locale, t) })}</dd></div>)}</dl>}
      </section>

      <section className="content-section">
        <SectionHeading icon={Archive} title={t("operations.data.schemaTitle")} description={t("operations.data.schemaDescription")} count={inventory.schemaMigrations.length} />
        {inventory.schemaMigrations.length === 0 ? <EmptyCollection icon={Archive} title={t("operations.data.schemaEmptyTitle")} description={t("operations.data.schemaEmptyDescription")} /> : <dl className="definition-list">{inventory.schemaMigrations.map((migration) => <div key={migration.name}><Archive size={18} /><dt>{migration.name}</dt><dd>{t("operations.data.migrationDetail", { checksum: migration.checksum, appliedAt: formatDate(migration.appliedAt, locale, t) })}</dd></div>)}</dl>}
      </section>

      <section className="content-section">
        <SectionHeading icon={FileArchive} title={t("operations.data.exportTitle")} description={t("operations.data.exportDescription")} />
        <Notice>{t("operations.data.exportNotice")}</Notice>
        {page.capabilities.manageData ? (
          <div className="section-actions">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includePersonal}
                onChange={(event) => setIncludePersonal(event.target.checked)}
              />
              <span>{t("operations.data.includePersonal")}</span>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={busyKey !== null}
              onClick={() => void run("data.export.request", () => api.requestDataExport({
                includeRequesterPersonal: includePersonal,
                idempotencyKey: `guild-ui:${crypto.randomUUID()}`,
              }))}
            >
              {busyKey === "data.export.request" ? <LoaderCircle className="spin" size={17} /> : <FileArchive size={17} />}
              {t("operations.data.requestExport")}
            </button>
          </div>
        ) : null}
        {page.dataExports.length === 0 ? (
          <EmptyCollection
            icon={FileArchive}
            title={t("operations.data.noExportsTitle")}
            description={t("operations.data.noExportsDescription")}
          />
        ) : (
          <div className="data-table export-jobs-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.data.exportColumn.created")}</span>
              <span>{t("operations.data.exportColumn.status")}</span>
              <span>{t("operations.data.exportColumn.contents")}</span>
              <span>{t("operations.data.exportColumn.verification")}</span>
              <span className="align-right">{t("operations.data.exportColumn.actions")}</span>
            </div>
            {page.dataExports.map((job) => (
              <article className="data-row" key={job.id}>
                <div data-label={t("operations.data.exportColumn.created")}>
                  <strong>{formatDate(job.createdAt, locale, t)}</strong>
                  <small>{job.id.slice(0, 8)}</small>
                </div>
                <div data-label={t("operations.data.exportColumn.status")}>
                  <StatusPill namespace="exportStatus" status={job.status} t={t} />
                  <small>{t("operations.data.exportAttempt", { attempt: job.attemptCount, maximum: job.maxAttempts })}</small>
                </div>
                <div data-label={t("operations.data.exportColumn.contents")}>
                  <strong>{t("operations.data.exportRows", { count: job.rowCount ?? 0 })}</strong>
                  <small>{t("operations.data.exportFiles", { count: job.fileCount ?? 0 })}</small>
                </div>
                <div data-label={t("operations.data.exportColumn.verification")}>
                  <strong>{job.sha256 ? t("operations.data.checksumVerified") : t("operations.data.checksumPending")}</strong>
                  <small>{job.sha256?.slice(0, 16) ?? job.errorSummary ?? t("operations.data.waiting")}</small>
                </div>
                <div className="row-actions" data-label={t("operations.data.exportColumn.actions")}>
                  {job.status === "completed" ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={t("operations.data.downloadExport")}
                      aria-label={t("operations.data.downloadExport")}
                      disabled={busyKey !== null}
                      onClick={() => void run(`data.export.download:${job.id}`, async () => {
                        const blob = await api.downloadDataExport(job.id);
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = `guild-export-${job.id}.ndjson`;
                        anchor.click();
                        setTimeout(() => URL.revokeObjectURL(url), 0);
                      })}
                    >
                      {busyKey === `data.export.download:${job.id}`
                        ? <LoaderCircle className="spin" size={17} />
                        : <Download size={17} />}
                    </button>
                  ) : null}
                  {job.status === "failed" && job.retryable && page.capabilities.manageData ? (
                    <button
                      className="icon-button"
                      type="button"
                      title={t("common.retry")}
                      aria-label={t("common.retry")}
                      disabled={busyKey !== null}
                      onClick={() => void run(`data.export.retry:${job.id}`, () =>
                        api.retryDataExport({ id: job.id, expectedVersion: job.version }))}
                    >
                      {busyKey === `data.export.retry:${job.id}`
                        ? <LoaderCircle className="spin" size={17} />
                        : <RotateCcw size={17} />}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeading
          icon={Archive}
          title={t("operations.retention.title")}
          description={t("operations.retention.description")}
        />
        <Notice>
          {t("operations.retention.policyNotice", {
            days: page.dataRetentionDays,
            version: page.constitutionVersion,
          })}
        </Notice>
        {page.capabilities.manageData ? (
          <div className="stack-form retention-planner">
            <label>
              <span>{t("operations.retention.cutoff")}</span>
              <input
                type="datetime-local"
                required
                value={retentionCutoff}
                max={retentionCutoffLocalValue(page.dataRetentionDays)}
                onChange={(event) => {
                  setRetentionCutoff(event.target.value);
                  setSelectedPreviewId("");
                  setRetentionConfirmation("");
                }}
              />
              <small className="field-help">{t("operations.retention.cutoffHelp", { days: page.dataRetentionDays })}</small>
            </label>
            <div className="retention-action-grid">
              {RETENTION_CATEGORIES.map((category) => (
                <label key={category}>
                  <span>{t(`operations.retention.category.${category}`)}</span>
                  <select
                    value={retentionSelection[category]}
                    onChange={(event) => {
                      setRetentionSelection((current) => ({
                        ...current,
                        [category]: event.target.value as UiRetentionActionKind,
                      }));
                      setSelectedPreviewId("");
                      setRetentionConfirmation("");
                    }}
                  >
                    {RETENTION_ACTIONS[category].map((action) => (
                      <option value={action} key={action}>{t(`operations.retention.action.${action}`)}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="section-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busyKey !== null || !retentionCutoff}
                onClick={() => void run("retention.preview", () => api.planRetention(retentionRequest(true)))}
              >
                {busyKey === "retention.preview" ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}
                {t("operations.retention.preview")}
              </button>
              <label className="retention-preview-select">
                <span>{t("operations.retention.previewToApply")}</span>
                <select value={selectedPreviewId} onChange={(event) => chooseRetentionPreview(event.target.value)}>
                  <option value="">{t("operations.retention.choosePreview")}</option>
                  {page.retentionRuns.filter((runItem) => runItem.dryRun && runItem.status === "completed")
                    .map((runItem) => (
                      <option value={runItem.id} key={runItem.id}>
                        {formatDate(runItem.createdAt, locale, t)} · {runItem.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {selectedPreview ? (
              <div className="retention-apply-row">
                <label>
                  <span>{t("operations.retention.confirmation", { code: expectedRetentionConfirmation })}</span>
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    value={retentionConfirmation}
                    onChange={(event) => setRetentionConfirmation(event.target.value.toUpperCase())}
                    placeholder={expectedRetentionConfirmation}
                  />
                </label>
                <button
                  className={retentionHasPurge ? "danger-action-button" : "primary-button"}
                  type="button"
                  disabled={busyKey !== null || !page.capabilities.applyRetention ||
                    !retentionHasMutation || retentionConfirmation !== expectedRetentionConfirmation}
                  onClick={() => void run("retention.apply", () => api.planRetention(retentionRequest(false)))}
                >
                  {busyKey === "retention.apply" ? <LoaderCircle className="spin" size={17} />
                    : retentionHasPurge ? <Trash2 size={17} /> : <Archive size={17} />}
                  {t("operations.retention.apply")}
                </button>
              </div>
            ) : null}
            {!page.capabilities.applyRetention ? (
              <Notice kind="warning">{t("operations.retention.rootOnly")}</Notice>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="content-section">
        <SectionHeading
          icon={Clock3}
          title={t("operations.retention.historyTitle")}
          description={t("operations.retention.historyDescription")}
          count={page.retentionRuns.length}
        />
        {page.retentionRuns.length === 0 ? (
          <EmptyCollection icon={Archive} title={t("operations.retention.emptyTitle")} description={t("operations.retention.emptyDescription")} />
        ) : (
          <div className="data-table retention-runs-table">
            <div className="data-table-head" aria-hidden="true">
              <span>{t("operations.retention.column.run")}</span>
              <span>{t("operations.retention.column.status")}</span>
              <span>{t("operations.retention.column.plan")}</span>
              <span>{t("operations.retention.column.result")}</span>
              <span>{t("operations.retention.column.evidence")}</span>
            </div>
            {page.retentionRuns.map((runItem) => {
              const candidates = runItem.actions.reduce((sum, action) => sum + action.candidateCount, 0);
              const affected = runItem.actions.reduce((sum, action) => sum + action.affectedCount, 0);
              return (
                <article className="data-row" key={runItem.id}>
                  <div data-label={t("operations.retention.column.run")}>
                    <strong>{runItem.dryRun ? t("operations.retention.previewLabel") : t("operations.retention.applyLabel")}</strong>
                    <small>{formatDate(runItem.createdAt, locale, t)} · {runItem.id.slice(0, 8)}</small>
                  </div>
                  <div data-label={t("operations.retention.column.status")}>
                    <StatusPill namespace="retentionStatus" status={runItem.status} t={t} />
                    <small>{t("operations.version", { version: runItem.policyVersion })}</small>
                  </div>
                  <div data-label={t("operations.retention.column.plan")}>
                    <strong>{formatDate(runItem.cutoffAt, locale, t)}</strong>
                    <small>{runItem.actions.map((action) =>
                      `${t(`operations.retention.category.${action.category}`)}: ${t(`operations.retention.action.${action.action}`)}`).join(" · ")}</small>
                  </div>
                  <div data-label={t("operations.retention.column.result")}>
                    <strong>{t("operations.retention.candidateCount", { count: candidates })}</strong>
                    <small>{t("operations.retention.affectedCount", { count: affected })}</small>
                    {runItem.errorSummary ? <small>{runItem.errorSummary}</small> : null}
                  </div>
                  <div data-label={t("operations.retention.column.evidence")}>
                    <strong>{runItem.irreversibleAuthorizationRecorded
                      ? t("operations.retention.evidenceRecorded")
                      : t("operations.retention.noIrreversibleEvidence")}</strong>
                    <small>{runItem.completedAt ? formatDate(runItem.completedAt, locale, t) : t("operations.data.waiting")}</small>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
