import {
  Archive,
  BookCheck,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveLocalizedText } from "@guild-os/domain";
import type {
  GuildUiApi,
  UiDirectory,
  UiKnowledgeDetail,
  UiKnowledgePage,
} from "../../src/management-types";
import { KnowledgeEditorDialog } from "../components/KnowledgeEditorDialog";
import { KnowledgeReviewDialog } from "../components/KnowledgeReviewDialog";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  classificationTranslationKey,
  knowledgeStateTranslationKey,
  reviewTranslationKey,
  useI18n,
  visibilityTranslationKey,
} from "../i18n";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function byteSize(value: number, locale: string): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_024)} KiB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_048_576)} MiB`;
}

export function KnowledgePage({ api, directory, requestedKnowledgeId }: {
  api: GuildUiApi;
  directory: UiDirectory | null;
  requestedKnowledgeId: string | null;
}) {
  const { locale, t } = useI18n();
  const [page, setPage] = useState<UiKnowledgePage | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UiKnowledgeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const identityNames = useMemo(() => new Map(
    directory?.identities.map((identity) => [identity.id, identity.displayName]) ?? [],
  ), [directory]);
  const spaceNames = useMemo(() => new Map(
    directory?.spaces.map((space) => [space.id, space.name]) ?? [],
  ), [directory]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);

  const loadDetail = useCallback(async (knowledgeId: string) => {
    setDetailLoading(true);
    try {
      const next = await api.getKnowledge(knowledgeId);
      setDetail(next);
      setSelectedId(knowledgeId);
    } catch (cause) {
      setDetail(null);
      setError(errorMessage(cause, t("knowledge.loadError")));
    } finally {
      setDetailLoading(false);
    }
  }, [api, t]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getKnowledgePage();
      setPage(next);
      const nextSelected = requestedKnowledgeId ?? next.items[0]?.id ?? null;
      if (nextSelected) await loadDetail(nextSelected);
      else {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (cause) {
      setError(errorMessage(cause, t("knowledge.loadError")));
    } finally {
      setLoading(false);
    }
  }, [api, loadDetail, requestedKnowledgeId, t]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  async function refreshAfterChange(message: string, knowledgeId = selectedId) {
    const next = await api.getKnowledgePage();
    setPage(next);
    if (knowledgeId) await loadDetail(knowledgeId);
    setSuccess(message);
  }

  async function transition(operation: () => Promise<void>, confirmation: string | null = null) {
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await operation();
      await refreshAfterChange(t("toast.knowledgeChanged"));
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    if (!detail) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.uploadKnowledgeFile({
        knowledgeId: detail.id,
        expectedVersion: detail.currentVersion,
        originalName: file.name,
        mediaType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      await refreshAfterChange(t("toast.fileUploaded"), detail.id);
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(false);
    }
  }

  async function downloadFile(fileId: string, originalName: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.downloadKnowledgeFile(fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = originalName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) {
      setError(errorMessage(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!page?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getKnowledgePage({ cursor: page.nextCursor });
      setPage({
        ...next,
        items: [...page.items, ...next.items],
        canCreate: page.canCreate,
      });
    } catch (cause) {
      setError(errorMessage(cause, t("knowledge.loadError")));
    } finally {
      setBusy(false);
    }
  }

  const visibleVersion = detail?.versions.find((version) =>
    version.version === detail.currentVersion) ?? null;

  return (
    <>
      <PageHeader
        title={t("knowledge.title")}
        subtitle={t("knowledge.subtitle")}
        action={page?.canCreate && directory ? (
          <button className="primary-button" type="button" onClick={() => setEditorMode("create")}>
            <Plus size={17} /><span>{t("knowledge.create")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {success ? <Notice kind="success">{success}</Notice> : null}
      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("common.loading")}</div>
      ) : !page?.items.length ? (
        <p className="empty-state">{t("knowledge.empty")}</p>
      ) : (
        <div className="knowledge-workspace">
          <aside className="knowledge-list" aria-label={t("knowledge.title")}>
            {page.items.map((item) => (
              <button
                className={selectedId === item.id ? "knowledge-list-item knowledge-list-item-active" : "knowledge-list-item"}
                type="button"
                key={item.id}
                onClick={() => void loadDetail(item.id)}
              >
                <span className="knowledge-list-heading">
                  <strong>{resolveLocalizedText(item.title, locale)}</strong>
                  <span className={`knowledge-state knowledge-state-${item.state}`}>{t(knowledgeStateTranslationKey(item.state))}</span>
                </span>
                <span>{resolveLocalizedText(item.summary, locale)}</span>
                <small>{spaceNames.get(item.spaceId ?? "") ?? t("people.global")} · v{item.currentVersion}</small>
              </button>
            ))}
            {page.nextCursor ? (
              <div className="load-more-row">
                <button className="text-button" type="button" disabled={busy} onClick={() => void loadMore()}>{t("common.loadMore")}</button>
              </div>
            ) : null}
          </aside>

          <section className="knowledge-detail" aria-live="polite">
            {detailLoading ? (
              <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("knowledge.loadingDetail")}</div>
            ) : detail && visibleVersion ? (
              <>
                <header className="knowledge-detail-header">
                  <div>
                    <span className={`knowledge-state knowledge-state-${detail.state}`}>{t(knowledgeStateTranslationKey(detail.state))}</span>
                    <h2>{resolveLocalizedText(visibleVersion.title, locale)}</h2>
                    <p>{resolveLocalizedText(visibleVersion.summary, locale)}</p>
                  </div>
                  <div className="action-group knowledge-actions">
                    {detail.capabilities.edit ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditorMode("edit")}>
                        <Pencil size={16} /><span>{t("common.edit")}</span>
                      </button>
                    ) : null}
                    {detail.capabilities.startRevision ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => void transition(
                        async () => { await api.startKnowledgeRevision({ knowledgeId: detail.id, expectedVersion: detail.currentVersion }); },
                        t("knowledge.confirmRevision"),
                      )}>
                        <RotateCcw size={16} /><span>{t("knowledge.startRevision")}</span>
                      </button>
                    ) : null}
                    {detail.capabilities.propose ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => void transition(
                        () => api.proposeKnowledge({ knowledgeId: detail.id, expectedVersion: detail.currentVersion }),
                        t("knowledge.confirmPropose"),
                      )}>
                        <Send size={16} /><span>{t("knowledge.propose")}</span>
                      </button>
                    ) : null}
                    {detail.capabilities.review ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => setReviewOpen(true)}>
                        <BookCheck size={16} /><span>{t("knowledge.approve")}</span>
                      </button>
                    ) : null}
                    {detail.capabilities.deprecate ? (
                      <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void transition(
                        () => api.deprecateKnowledge({ knowledgeId: detail.id, expectedVersion: detail.currentVersion }),
                        t("knowledge.confirmDeprecate"),
                      )}>
                        <Archive size={16} /><span>{t("knowledge.deprecate")}</span>
                      </button>
                    ) : null}
                    {detail.capabilities.archive ? (
                      <button className="secondary-button danger-button" type="button" disabled={busy} onClick={() => void transition(
                        () => api.archiveKnowledge({ knowledgeId: detail.id, expectedVersion: detail.currentVersion }),
                        t("knowledge.confirmArchive"),
                      )}>
                        <Archive size={16} /><span>{t("common.archive")}</span>
                      </button>
                    ) : null}
                  </div>
                </header>

                <dl className="knowledge-meta">
                  <div><dt>{t("knowledge.currentVersion")}</dt><dd>v{detail.currentVersion}</dd></div>
                  <div><dt>{t("knowledge.space")}</dt><dd>{spaceNames.get(detail.spaceId ?? "") ?? t("people.global")}</dd></div>
                  <div><dt>{t("knowledge.visibility")}</dt><dd>{t(visibilityTranslationKey(detail.visibility))}</dd></div>
                  <div><dt>{t("knowledge.classification")}</dt><dd>{t(classificationTranslationKey(detail.classification))}</dd></div>
                  <div><dt>{t("knowledge.owner")}</dt><dd>{identityNames.get(detail.ownerIdentityId) ?? detail.ownerIdentityId}</dd></div>
                  <div><dt>{t("knowledge.updated")}</dt><dd>{formatter.format(new Date(detail.updatedAt))}</dd></div>
                </dl>

                <article className="knowledge-body">
                  <pre>{resolveLocalizedText(visibleVersion.body, locale)}</pre>
                </article>

                {detail.state === "canonical" ? (
                  <div className="knowledge-acknowledgement">
                    {detail.acknowledged ? (
                      <span><CheckCircle2 size={17} />{t("knowledge.acknowledged")}</span>
                    ) : (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => void transition(
                        () => api.acknowledgeKnowledge({ knowledgeId: detail.id, expectedVersion: detail.currentVersion }),
                      )}>
                        <CheckCircle2 size={16} /><span>{t("knowledge.acknowledge")}</span>
                      </button>
                    )}
                  </div>
                ) : null}

                <section className="content-section knowledge-subsection">
                  <div className="section-heading-row compact-heading">
                    <div><h2>{t("knowledge.files")}</h2><p>{t("knowledge.uploadHint")}</p></div>
                    {detail.capabilities.uploadFile ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                        <Upload size={16} /><span>{t("common.upload")}</span>
                      </button>
                    ) : null}
                    <input
                      ref={fileInput}
                      className="sr-only"
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadFile(file);
                      }}
                    />
                  </div>
                  {detail.files.filter((file) => file.status === "ready").length === 0 ? (
                    <p className="empty-state compact-empty">{t("knowledge.noFiles")}</p>
                  ) : (
                    <div className="knowledge-file-list">
                      {detail.files.filter((file) => file.status === "ready").map((file) => (
                        <div key={`${file.id}-${file.knowledgeVersion}`}>
                          <FileText size={18} />
                          <div><strong>{file.originalName}</strong><small>{byteSize(file.byteSize, locale)} · {t("knowledge.fileVersion")} {file.knowledgeVersion}</small></div>
                          <button className="icon-button" type="button" disabled={busy} title={t("common.download")} aria-label={t("common.download")} onClick={() => void downloadFile(file.id, file.originalName)}><Download size={16} /></button>
                          {detail.capabilities.deleteFile && file.knowledgeVersion === detail.currentVersion ? (
                            <button className="icon-button danger-button" type="button" disabled={busy} title={t("common.delete")} aria-label={t("common.delete")} onClick={() => void transition(
                              () => api.deleteKnowledgeFile({ knowledgeId: detail.id, expectedVersion: detail.currentVersion, fileId: file.id }),
                              t("knowledge.confirmDeleteFile"),
                            )}><Trash2 size={16} /></button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <div className="knowledge-history-grid">
                  <section className="content-section knowledge-subsection">
                    <div className="section-heading-row"><BookOpen size={18} /><h2>{t("knowledge.versionHistory")}</h2></div>
                    <div className="knowledge-history-list">
                      {detail.versions.map((version) => (
                        <div key={version.version}>
                          <strong>v{version.version}</strong>
                          <span className={`knowledge-state knowledge-state-${version.state}`}>{t(knowledgeStateTranslationKey(version.state))}</span>
                          <small>{formatter.format(new Date(version.createdAt))}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="content-section knowledge-subsection">
                    <div className="section-heading-row"><BookCheck size={18} /><h2>{t("knowledge.reviewHistory")}</h2></div>
                    {detail.reviews.length === 0 ? <p className="empty-state compact-empty">{t("knowledge.noReviews")}</p> : (
                      <div className="knowledge-review-list">
                        {detail.reviews.map((review) => (
                          <div key={review.id}>
                            <strong>{t(reviewTranslationKey(review.verdict))} · v{review.version}</strong>
                            <p>{review.reason}</p>
                            <small>{identityNames.get(review.reviewerIdentityId) ?? review.reviewerIdentityId} · {formatter.format(new Date(review.createdAt))}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </>
            ) : <p className="empty-state">{t("knowledge.select")}</p>}
          </section>
        </div>
      )}

      {editorMode && directory ? (
        <KnowledgeEditorDialog
          directory={directory}
          knowledge={editorMode === "edit" ? detail : null}
          onCreate={async (input) => {
            const id = await api.createKnowledge(input);
            setSelectedId(id);
            await refreshAfterChange(t("toast.knowledgeCreated"), id);
          }}
          onSave={async (input) => {
            await api.saveKnowledgeDraft(input);
            await refreshAfterChange(t("toast.knowledgeSaved"), input.knowledgeId);
          }}
          onClose={() => setEditorMode(null)}
        />
      ) : null}
      {reviewOpen && detail ? (
        <KnowledgeReviewDialog
          onReview={async (verdict, reason) => {
            await api.reviewKnowledge({
              knowledgeId: detail.id,
              expectedVersion: detail.currentVersion,
              verdict,
              reason,
            });
            await refreshAfterChange(t("toast.knowledgeChanged"), detail.id);
          }}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}
    </>
  );
}
