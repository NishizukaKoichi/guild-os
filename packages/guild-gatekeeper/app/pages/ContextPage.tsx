import {
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleSlash2,
  Database,
  GitBranch,
  Link2,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Unlink,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type {
  CreateContextRelationRequest,
  GuildUiApi,
  UiContextNode,
  UiContextPage,
} from "../../src/management-types";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

type ContextTranslationKey = `context.${string}`;
type TranslationValues = Readonly<Record<string, string | number>>;
type ContextTranslator = (key: ContextTranslationKey, values?: TranslationValues) => string;
type ReviewSignal = UiContextPage["reviewSignals"][number];
type CustodyRecord = UiContextPage["personalCustody"][number];

const ENDPOINT_TYPES = [
  "memory",
  "external_source",
  "activity",
  "knowledge",
  "decision",
  "announcement",
  "agent_run",
  "connection",
  "file",
  "actor",
  "event",
] as const;

const RELATION_TYPES = [
  "assigned_to",
  "created_by",
  "depends_on",
  "derived_from",
  "evidences",
  "governs",
  "informed_by",
  "references",
  "resulted_in",
  "supports",
  "supersedes",
] as const;

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

function useContextI18n(): {
  locale: ReturnType<typeof useI18n>["locale"];
  t: ContextTranslator;
} {
  const { locale, t: translate } = useI18n();
  const t = useCallback<ContextTranslator>((key, values) =>
    translate(key as Parameters<typeof translate>[0], values), [translate]);
  return { locale, t };
}

function errorMessage(cause: unknown, t: ContextTranslator): string {
  return cause instanceof Error && cause.message
    ? t("context.error.detail", { message: cause.message })
    : t("context.error.generic");
}

function nodeKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function identifierLabel(value: string): string {
  const words = value.replace(/[._:-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

function nodeTypeLabel(type: string, t: ContextTranslator): string {
  const key = `context.node.type.${type}` as ContextTranslationKey;
  const translated = t(`context.node.type.${type}`);
  return translated === key ? identifierLabel(type) : translated;
}

function relationTypeLabel(type: string, t: ContextTranslator): string {
  const key = `context.relation.type.${type}` as ContextTranslationKey;
  const translated = t(`context.relation.type.${type}`);
  return translated === key ? identifierLabel(type) : translated;
}

function nodeLabel(
  nodes: readonly UiContextNode[],
  type: string,
  id: string,
  t: ContextTranslator,
): string {
  const node = nodes.find((candidate) => candidate.type === type && candidate.id === id);
  return node?.label ?? t("context.node.fallback", {
    type: nodeTypeLabel(type, t),
    id,
  });
}

function RelationDialog({
  nodes,
  onClose,
  onCreate,
}: {
  nodes: readonly UiContextNode[];
  onClose(): void;
  onCreate(input: CreateContextRelationRequest): Promise<void>;
}) {
  const { t } = useContextI18n();
  const firstNode = nodes[0];
  const secondNode = nodes.find((node) => firstNode && nodeKey(node.type, node.id) !== nodeKey(firstNode.type, firstNode.id));
  const [fromType, setFromType] = useState(firstNode?.type ?? "memory");
  const [fromId, setFromId] = useState(firstNode?.id ?? "");
  const [toType, setToType] = useState(secondNode?.type ?? firstNode?.type ?? "activity");
  const [toId, setToId] = useState(secondNode?.id ?? "");
  const [relationType, setRelationType] = useState<string>(RELATION_TYPES[0]);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodesByType = useMemo(() => {
    const result = new Map<string, UiContextNode[]>();
    for (const node of nodes) {
      const group = result.get(node.type) ?? [];
      group.push(node);
      result.set(node.type, group);
    }
    return result;
  }, [nodes]);

  function selectType(side: "from" | "to", type: string) {
    const suggestedId = nodesByType.get(type)?.[0]?.id ?? "";
    if (side === "from") {
      setFromType(type);
      setFromId(suggestedId);
    } else {
      setToType(type);
      setToId(suggestedId);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        fromType,
        fromId: fromId.trim(),
        relationType,
        toType,
        toId: toId.trim(),
        rationale: rationale.trim(),
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const pointsToSelf = fromType === toType && fromId.trim() === toId.trim();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog dialog-wide context-relation-dialog" role="dialog" aria-modal="true" aria-labelledby="context-relation-dialog-title">
        <header className="dialog-header">
          <div>
            <h2 id="context-relation-dialog-title">{t("context.relation.createTitle")}</h2>
            <small>{t("context.relation.createSubtitle")}</small>
          </div>
          <button className="icon-button" type="button" title={t("context.action.close")} aria-label={t("context.action.close")} disabled={busy} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {nodes.length === 0 ? (
            <Notice>{t("context.relation.noNodeSuggestions")}</Notice>
          ) : null}
          <div className="context-endpoint-grid form-grid">
            <fieldset className="context-endpoint">
              <legend>{t("context.relation.source")}</legend>
              <label>
                <span>{t("context.relation.endpointType")}</span>
                <select value={fromType} onChange={(event) => selectType("from", event.target.value)}>
                  {ENDPOINT_TYPES.map((type) => <option key={type} value={type}>{nodeTypeLabel(type, t)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("context.relation.endpointId")}</span>
                <input required autoComplete="off" pattern={UUID_PATTERN} list="context-source-nodes" value={fromId} onChange={(event) => setFromId(event.target.value)} placeholder={t("context.relation.endpointIdPlaceholder")} />
              </label>
              <datalist id="context-source-nodes">
                {(nodesByType.get(fromType) ?? []).map((node) => <option key={node.id} value={node.id} label={node.label} />)}
              </datalist>
            </fieldset>
            <fieldset className="context-endpoint">
              <legend>{t("context.relation.target")}</legend>
              <label>
                <span>{t("context.relation.endpointType")}</span>
                <select value={toType} onChange={(event) => selectType("to", event.target.value)}>
                  {ENDPOINT_TYPES.map((type) => <option key={type} value={type}>{nodeTypeLabel(type, t)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("context.relation.endpointId")}</span>
                <input required autoComplete="off" pattern={UUID_PATTERN} list="context-target-nodes" value={toId} onChange={(event) => setToId(event.target.value)} placeholder={t("context.relation.endpointIdPlaceholder")} />
              </label>
              <datalist id="context-target-nodes">
                {(nodesByType.get(toType) ?? []).map((node) => <option key={node.id} value={node.id} label={node.label} />)}
              </datalist>
            </fieldset>
          </div>
          <small className="field-help">{t("context.relation.endpointHelp")}</small>
          {pointsToSelf && fromId.trim() ? <Notice kind="warning">{t("context.relation.selfError")}</Notice> : null}
          <label>
            <span>{t("context.relation.type")}</span>
            <select value={relationType} onChange={(event) => setRelationType(event.target.value)}>
              {RELATION_TYPES.map((type) => <option key={type} value={type}>{relationTypeLabel(type, t)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("context.relation.rationale")}</span>
            <textarea required rows={4} maxLength={5_000} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder={t("context.relation.rationalePlaceholder")} />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}><X size={17} />{t("context.action.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || pointsToSelf || !fromId.trim() || !toId.trim() || !rationale.trim()}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}
              {t("context.relation.create")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function ReviewDialog({
  signal,
  status,
  onClose,
  onSubmit,
}: {
  signal: ReviewSignal;
  status: "resolved" | "dismissed";
  onClose(): void;
  onSubmit(resolution: string): Promise<void>;
}) {
  const { t } = useContextI18n();
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(resolution.trim());
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const resolving = status === "resolved";
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog context-review-dialog" role="dialog" aria-modal="true" aria-labelledby="context-review-dialog-title">
        <header className="dialog-header">
          <div>
            <h2 id="context-review-dialog-title">{t(resolving ? "context.review.resolveTitle" : "context.review.dismissTitle")}</h2>
            <small>{t(`context.review.kind.${signal.kind}`)}</small>
          </div>
          <button className="icon-button" type="button" title={t("context.action.close")} aria-label={t("context.action.close")} disabled={busy} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <Notice kind={resolving ? "info" : "warning"}>{t(resolving ? "context.review.resolvePrompt" : "context.review.dismissPrompt")}</Notice>
          <label>
            <span>{t("context.review.resolution")}</span>
            <textarea autoFocus required rows={5} maxLength={5_000} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder={t("context.review.resolutionPlaceholder")} />
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}><X size={17} />{t("context.action.cancel")}</button>
            <button className={resolving ? "primary-button" : "secondary-button"} type="submit" disabled={busy || !resolution.trim()}>
              {busy ? <LoaderCircle className="spin" size={17} /> : resolving ? <CheckCircle2 size={17} /> : <CircleSlash2 size={17} />}
              {t(resolving ? "context.review.resolve" : "context.review.dismiss")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SharePersonalDialog({
  record,
  label,
  onClose,
  onShare,
}: {
  record: CustodyRecord;
  label: string;
  onClose(): void;
  onShare(): Promise<void>;
}) {
  const { t } = useContextI18n();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await onShare();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog context-share-dialog" role="dialog" aria-modal="true" aria-labelledby="context-share-dialog-title">
        <header className="dialog-header">
          <div>
            <h2 id="context-share-dialog-title">{t("context.personal.shareTitle")}</h2>
            <small>{label}</small>
          </div>
          <button className="icon-button" type="button" title={t("context.action.close")} aria-label={t("context.action.close")} disabled={busy} onClick={onClose}><X size={19} /></button>
        </header>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <Notice kind="warning" title={t("context.personal.shareWarningTitle")}>{t("context.personal.shareWarning")}</Notice>
          <dl className="definition-list context-dialog-summary">
            <div><Database size={17} aria-hidden="true" /><dt>{t("context.personal.resourceType")}</dt><dd>{t(`context.resource.type.${record.resourceType}`)}</dd></div>
            <div><ShieldCheck size={17} aria-hidden="true" /><dt>{t("context.personal.currentCustody")}</dt><dd>{t(`context.custody.${record.custody}`)}</dd></div>
          </dl>
          <label className="checkbox-row context-share-confirmation">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>{t("context.personal.shareConfirmation")}</span>
          </label>
          {error ? <Notice kind="error">{error}</Notice> : null}
          <footer className="dialog-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}><X size={17} />{t("context.action.cancel")}</button>
            <button className="primary-button" type="submit" disabled={busy || !confirmed}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Share2 size={17} />}
              {t("context.personal.share")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ContextPage({ api }: { api: GuildUiApi }) {
  const { locale, t } = useContextI18n();
  const [page, setPage] = useState<UiContextPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ContextTranslationKey | null>(null);
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [reviewDialog, setReviewDialog] = useState<{ signal: ReviewSignal; status: "resolved" | "dismissed" } | null>(null);
  const [shareRecord, setShareRecord] = useState<CustodyRecord | null>(null);
  const [busyRelationId, setBusyRelationId] = useState<string | null>(null);

  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      setPage(await api.getContextPage());
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, t]);

  useEffect(() => {
    void load(true);
  }, [load]);

  const nodeByKey = useMemo(() => new Map(
    page?.nodes.map((node) => [nodeKey(node.type, node.id), node]) ?? [],
  ), [page?.nodes]);

  async function createRelation(input: CreateContextRelationRequest) {
    await api.createContextRelation(input);
    await load(false);
    setFeedback("context.feedback.relationCreated");
  }

  async function revokeRelation(relationId: string, expectedVersion: number) {
    if (!window.confirm(t("context.relation.revokeConfirm"))) return;
    setBusyRelationId(relationId);
    setError(null);
    setFeedback(null);
    try {
      await api.revokeContextRelation({ relationId, expectedVersion });
      await load(false);
      setFeedback("context.feedback.relationRevoked");
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusyRelationId(null);
    }
  }

  async function resolveReview(signal: ReviewSignal, status: "resolved" | "dismissed", resolution: string) {
    await api.resolveMemoryReviewSignal({
      signalId: signal.id,
      expectedVersion: signal.version,
      status,
      resolution,
    });
    await load(false);
    setFeedback(status === "resolved" ? "context.feedback.reviewResolved" : "context.feedback.reviewDismissed");
  }

  async function sharePersonal(record: CustodyRecord) {
    await api.sharePersonalData({
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      expectedVersion: record.version,
    });
    await load(false);
    setFeedback("context.feedback.personalShared");
  }

  const openReviewSignals = page?.reviewSignals.filter((signal) => signal.status === "open") ?? [];
  const closedReviewSignals = page?.reviewSignals.filter((signal) => signal.status !== "open") ?? [];
  const orderedReviewSignals = [...openReviewSignals, ...closedReviewSignals];

  return (
    <div className="context-page">
      <PageHeader
        title={t("context.title")}
        subtitle={t("context.subtitle")}
        action={(
          <div className="action-group context-page-actions">
            <button className="icon-button" type="button" title={t("context.action.refresh")} aria-label={t("context.action.refresh")} disabled={loading || refreshing} onClick={() => void load(false)}>
              <RefreshCw className={refreshing ? "spin" : undefined} size={18} />
            </button>
            {page?.canManageRelations ? <button className="primary-button" type="button" onClick={() => setRelationDialogOpen(true)}><Plus size={17} /><span>{t("context.relation.create")}</span></button> : null}
          </div>
        )}
      />

      {error ? <Notice kind="error" title={t("context.error.title")}><span>{error}</span><button className="text-button" type="button" onClick={() => void load(false)}><RefreshCw size={16} />{t("context.action.retry")}</button></Notice> : null}
      {feedback ? <Notice kind="success">{t(feedback)}</Notice> : null}

      {loading && !page ? (
        <div className="context-loading empty-state" role="status"><LoaderCircle className="spin" size={20} /><span>{t("context.loading")}</span></div>
      ) : null}

      {page?.custodyCounts ? (
        <section className="content-section context-custody-overview" aria-labelledby="context-custody-overview-title">
          <div className="section-heading-row">
            <Database size={20} aria-hidden="true" />
            <div><h2 id="context-custody-overview-title">{t("context.custody.title")}</h2><p>{t("context.custody.subtitle")}</p></div>
          </div>
          <dl className="definition-list context-custody-summary">
            {(["guild", "shared", "personal"] as const).map((custody) => (
              <div key={custody}>
                {custody === "guild" ? <Network size={18} aria-hidden="true" /> : custody === "shared" ? <Share2 size={18} aria-hidden="true" /> : <UserRound size={18} aria-hidden="true" />}
                <dt>{t(`context.custody.${custody}`)}</dt>
                <dd>{t("context.custody.count", { count: page.custodyCounts?.[custody] ?? 0 })}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {page ? (
        <section className="content-section context-graph-section" aria-labelledby="context-graph-title">
          <div className="section-heading-row compact-heading">
            <div className="context-heading-copy"><Network size={20} aria-hidden="true" /><div><h2 id="context-graph-title">{t("context.graph.title")}</h2><p>{t("context.graph.subtitle")}</p></div></div>
            <span>{page.relations.length}</span>
          </div>
          {page.relations.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title={t("context.graph.emptyTitle")}
              description={t("context.graph.emptyDescription")}
              action={page.canManageRelations ? <button className="primary-button" type="button" onClick={() => setRelationDialogOpen(true)}><Plus size={17} />{t("context.relation.create")}</button> : undefined}
            />
          ) : (
            <div className="context-relation-list">
              {page.relations.map((relation) => {
                const fromLabel = nodeLabel(page.nodes, relation.fromType, relation.fromId, t);
                const toLabel = nodeLabel(page.nodes, relation.toType, relation.toId, t);
                return (
                  <article className="context-relation-row" key={relation.id}>
                    <div className="context-relation-path">
                      <div className="context-node-chip"><small>{nodeTypeLabel(relation.fromType, t)}</small><strong>{fromLabel}</strong></div>
                      <div className="context-relation-kind"><Link2 size={16} aria-hidden="true" /><span>{relationTypeLabel(relation.relationType, t)}</span></div>
                      <div className="context-node-chip"><small>{nodeTypeLabel(relation.toType, t)}</small><strong>{toLabel}</strong></div>
                    </div>
                    <div className="context-relation-copy">
                      <p>{relation.rationale}</p>
                      <div className="context-meta">
                        <span className={`status-pill status-${relation.status}`}>{t(`context.relation.status.${relation.status}`)}</span>
                        <span>{t(`context.classification.${relation.classification}`)}</span>
                        <span>{t(`context.visibility.${relation.visibility}`)}</span>
                        <time dateTime={relation.createdAt}>{t("context.relation.createdAt", { date: formatter.format(new Date(relation.createdAt)) })}</time>
                      </div>
                    </div>
                    {page.canManageRelations && relation.status === "active" ? (
                      <button className="secondary-button danger-button context-relation-revoke" type="button" disabled={busyRelationId === relation.id} onClick={() => void revokeRelation(relation.id, relation.version)}>
                        {busyRelationId === relation.id ? <LoaderCircle className="spin" size={16} /> : <Unlink size={16} />}
                        {t("context.relation.revoke")}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          {page.nodes.length > 0 ? (
            <div className="context-node-directory" aria-label={t("context.node.directoryLabel")}>
              {page.nodes.map((node) => <span className="status-pill context-node-directory-item" key={nodeKey(node.type, node.id)}>{t("context.node.directoryItem", { type: nodeTypeLabel(node.type, t), label: node.label })}</span>)}
            </div>
          ) : null}
        </section>
      ) : null}

      {page ? (
        <section className="content-section context-review-section" aria-labelledby="context-review-title">
          <div className="section-heading-row compact-heading">
            <div className="context-heading-copy"><BrainCircuit size={20} aria-hidden="true" /><div><h2 id="context-review-title">{t("context.review.title")}</h2><p>{t("context.review.subtitle")}</p></div></div>
            <span>{openReviewSignals.length}</span>
          </div>
          {!page.canReviewMemory ? <Notice>{t("context.review.restricted")}</Notice> : orderedReviewSignals.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t("context.review.emptyTitle")} description={t("context.review.emptyDescription")} />
          ) : (
            <div className="context-review-list">
              {orderedReviewSignals.map((signal) => {
                const memory = nodeByKey.get(nodeKey("memory", signal.memoryId));
                const compared = signal.comparedMemoryId ? nodeByKey.get(nodeKey("memory", signal.comparedMemoryId)) : null;
                return (
                  <article className="context-review-row" key={signal.id}>
                    <header className="context-review-heading">
                      <div><strong>{t(`context.review.kind.${signal.kind}`)}</strong><span>{memory?.label ?? t("context.review.memoryFallback", { id: signal.memoryId })}</span></div>
                      <span className={`status-pill status-${signal.status}`}>{t(`context.review.status.${signal.status}`)}</span>
                    </header>
                    <p className="context-review-evidence">{signal.evidence}</p>
                    <dl className="context-review-details">
                      <div><dt>{t("context.review.comparedWith")}</dt><dd>{compared?.label ?? (signal.comparedMemoryId ? t("context.review.memoryFallback", { id: signal.comparedMemoryId }) : t("context.review.notCompared"))}</dd></div>
                      <div><dt>{t("context.review.detectedAt")}</dt><dd><time dateTime={signal.detectedAt}>{formatter.format(new Date(signal.detectedAt))}</time></dd></div>
                      {signal.resolution ? <div><dt>{t("context.review.resolution")}</dt><dd>{signal.resolution}</dd></div> : null}
                    </dl>
                    {signal.status === "open" ? (
                      <div className="action-group context-review-actions">
                        <button className="secondary-button" type="button" onClick={() => setReviewDialog({ signal, status: "dismissed" })}><CircleSlash2 size={16} />{t("context.review.dismiss")}</button>
                        <button className="primary-button" type="button" onClick={() => setReviewDialog({ signal, status: "resolved" })}><CheckCircle2 size={16} />{t("context.review.resolve")}</button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {page ? (
        <section className="content-section context-personal-section" aria-labelledby="context-personal-title">
          <div className="section-heading-row compact-heading">
            <div className="context-heading-copy"><ShieldCheck size={20} aria-hidden="true" /><div><h2 id="context-personal-title">{t("context.personal.title")}</h2><p>{t("context.personal.subtitle")}</p></div></div>
            <span>{page.personalCustody.filter((record) => record.custody === "personal").length}</span>
          </div>
          <Notice>{t("context.personal.notice")}</Notice>
          {page.personalCustody.length === 0 ? (
            <EmptyState icon={UserRound} title={t("context.personal.emptyTitle")} description={t("context.personal.emptyDescription")} />
          ) : (
            <div className="context-personal-list">
              {page.personalCustody.map((record) => {
                const recordLabel = nodeLabel(page.nodes, record.resourceType, record.resourceId, t);
                return (
                  <article className="context-personal-row" key={nodeKey(record.resourceType, record.resourceId)}>
                    <div className="context-resource-identity">
                      <Database size={18} aria-hidden="true" />
                      <div><strong>{recordLabel}</strong><small>{t(`context.resource.type.${record.resourceType}`)}</small></div>
                    </div>
                    <div className="context-personal-details">
                      <span className={`status-pill context-custody-status context-custody-${record.custody}`}>{t(`context.custody.${record.custody}`)}</span>
                      <span>{record.retentionUntil ? t("context.personal.retentionUntil", { date: formatter.format(new Date(record.retentionUntil)) }) : t("context.personal.noRetentionDate")}</span>
                      <span>{t("context.personal.updatedAt", { date: formatter.format(new Date(record.updatedAt)) })}</span>
                    </div>
                    {record.custody === "personal" ? <button className="secondary-button" type="button" onClick={() => setShareRecord(record)}><Share2 size={16} />{t("context.personal.share")}</button> : <span className="context-shared-indicator"><Check size={16} />{t("context.personal.shared")}</span>}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {relationDialogOpen && page ? <RelationDialog nodes={page.nodes} onClose={() => setRelationDialogOpen(false)} onCreate={createRelation} /> : null}
      {reviewDialog ? <ReviewDialog signal={reviewDialog.signal} status={reviewDialog.status} onClose={() => setReviewDialog(null)} onSubmit={(resolution) => resolveReview(reviewDialog.signal, reviewDialog.status, resolution)} /> : null}
      {shareRecord && page ? <SharePersonalDialog record={shareRecord} label={nodeLabel(page.nodes, shareRecord.resourceType, shareRecord.resourceId, t)} onClose={() => setShareRecord(null)} onShare={() => sharePersonal(shareRecord)} /> : null}
    </div>
  );
}
