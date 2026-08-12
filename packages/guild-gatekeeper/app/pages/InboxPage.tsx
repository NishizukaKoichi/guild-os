import {
  Archive,
  Bell,
  BellDot,
  CheckCheck,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InboxNotificationKind } from "@guild-os/domain";
import type {
  GuildUiApi,
  UiAnnouncement,
  UiAnnouncementPage,
  UiDirectory,
  UiInboxPage,
} from "../../src/management-types";
import { AnnouncementEditorDialog } from "../components/AnnouncementEditorDialog";
import { EmptyState } from "../components/EmptyState";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import {
  announcementStatusTranslationKey,
  classificationTranslationKey,
  inboxKindTranslationKey,
  useI18n,
} from "../i18n";

const INBOX_KINDS: readonly InboxNotificationKind[] = [
  "announcement",
  "mention",
  "quest",
  "approval",
  "knowledge_update",
  "agent_question",
  "system",
];

type InboxTab = "notifications" | "announcements";
type EditorState = "create" | UiAnnouncement | null;

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function InboxPage({
  api,
  directory,
}: {
  api: GuildUiApi;
  directory: UiDirectory | null;
}) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<InboxTab>("notifications");
  const [inboxPage, setInboxPage] = useState<UiInboxPage | null>(null);
  const [announcementPage, setAnnouncementPage] = useState<UiAnnouncementPage | null>(null);
  const [kind, setKind] = useState<InboxNotificationKind | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }), [locale]);
  const spaceNames = useMemo(() => new Map(
    directory?.spaces.map((space) => [space.id, space.name]) ?? [],
  ), [directory]);
  const roleNames = useMemo(() => new Map(
    directory?.roles.map((role) => [role.id, role.name]) ?? [],
  ), [directory]);

  const loadInbox = useCallback(async () => {
    const next = await api.getInboxPage({ kind, unreadOnly });
    setInboxPage(next);
  }, [api, kind, unreadOnly]);

  const loadAnnouncements = useCallback(async () => {
    setAnnouncementPage(await api.getAnnouncementPage());
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadInbox(), loadAnnouncements()]);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [loadAnnouncements, loadInbox, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateRead(notificationId: string, read: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.markInboxRead({ notificationId, read });
      await loadInbox();
      setSuccess(t("inbox.toastRead"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead(): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.markAllInboxRead();
      await loadInbox();
      setSuccess(t("inbox.toastAllRead"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreInbox(): Promise<void> {
    if (!inboxPage?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getInboxPage({
        cursor: inboxPage.nextCursor,
        kind,
        unreadOnly,
      });
      const known = new Set(inboxPage.items.map((item) => item.id));
      setInboxPage({
        ...next,
        items: [...inboxPage.items, ...next.items.filter((item) => !known.has(item.id))],
      });
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreAnnouncements(): Promise<void> {
    if (!announcementPage?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.getAnnouncementPage({ cursor: announcementPage.nextCursor });
      const known = new Set(announcementPage.items.map((item) => item.id));
      setAnnouncementPage({
        ...next,
        items: [...announcementPage.items, ...next.items.filter((item) => !known.has(item.id))],
      });
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function publish(announcement: UiAnnouncement): Promise<void> {
    if (!window.confirm(t("announcement.confirmPublish"))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.publishAnnouncement({
        announcementId: announcement.id,
        expectedVersion: announcement.version,
      });
      await Promise.all([loadAnnouncements(), loadInbox()]);
      setSuccess(`${t("announcement.toastPublished")} ${t("announcement.delivery")}: ${result.recipientCount}`);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  async function archive(announcement: UiAnnouncement): Promise<void> {
    if (!window.confirm(t("announcement.confirmArchive"))) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.archiveAnnouncement({
        announcementId: announcement.id,
        expectedVersion: announcement.version,
      });
      await loadAnnouncements();
      setSuccess(t("announcement.toastArchived"));
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setBusy(false);
    }
  }

  const canCreate = Boolean(
    directory && announcementPage &&
    (announcementPage.canCreateGuildWide || announcementPage.manageableSpaceIds.length > 0),
  );

  return (
    <>
      <PageHeader
        title={t("inbox.title")}
        subtitle={t("inbox.subtitle")}
        action={tab === "announcements" && canCreate ? (
          <button className="primary-button" type="button" onClick={() => setEditor("create")}>
            <Plus size={17} /><span>{t("announcement.create")}</span>
          </button>
        ) : undefined}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {success ? <Notice kind="success">{success}</Notice> : null}

      <div className="inbox-tabs segmented-control" role="tablist" aria-label={t("inbox.title")}>
        <button className={tab === "notifications" ? "segment-active" : ""} type="button" role="tab" aria-selected={tab === "notifications"} onClick={() => setTab("notifications")}>
          <Bell size={16} />{t("inbox.notifications")}
          {inboxPage?.unreadCount ? <span className="inbox-tab-count">{inboxPage.unreadCount}</span> : null}
        </button>
        <button className={tab === "announcements" ? "segment-active" : ""} type="button" role="tab" aria-selected={tab === "announcements"} onClick={() => setTab("announcements")}>
          <Megaphone size={16} />{t("inbox.announcements")}
        </button>
      </div>

      {loading ? (
        <div className="inline-loading"><LoaderCircle className="spin" size={20} />{t("common.loading")}</div>
      ) : tab === "notifications" ? (
        <section className="content-section inbox-section">
          <div className="inbox-toolbar">
            <div className="segmented-control inbox-read-filter" aria-label={t("inbox.unreadCount")}>
              <button className={!unreadOnly ? "segment-active" : ""} type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t("inbox.all")}</button>
              <button className={unreadOnly ? "segment-active" : ""} type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}><BellDot size={15} />{t("inbox.unread")}</button>
            </div>
            <label className="compact-select">
              <span>{t("inbox.allKinds")}</span>
              <select value={kind ?? ""} onChange={(event) => setKind(event.target.value ? event.target.value as InboxNotificationKind : null)}>
                <option value="">{t("inbox.allKinds")}</option>
                {INBOX_KINDS.map((value) => <option key={value} value={value}>{t(inboxKindTranslationKey(value))}</option>)}
              </select>
            </label>
            <div className="inbox-unread-summary">
              <span>{t("inbox.unreadCount")}</span>
              <strong>{inboxPage?.unreadCount ?? 0}</strong>
            </div>
            <button className="secondary-button" type="button" disabled={busy || !inboxPage?.unreadCount} onClick={() => void markAllRead()}>
              <CheckCheck size={16} />{t("inbox.markAllRead")}
            </button>
          </div>

          {!inboxPage?.items.length ? (
            <EmptyState icon={CheckCircle2} title={t("inbox.emptyTitle")} description={t("inbox.empty")} />
          ) : (
            <div className="inbox-list">
              {inboxPage.items.map((notification) => (
                <article className={notification.readAt ? "inbox-item" : "inbox-item inbox-item-unread"} key={notification.id}>
                  <span className="inbox-state" aria-hidden="true">{notification.readAt ? <Circle size={12} /> : <BellDot size={17} />}</span>
                  <div className="inbox-item-copy">
                    <div className="inbox-item-heading">
                      <span className="status-pill">{t(inboxKindTranslationKey(notification.kind))}</span>
                      <time dateTime={notification.createdAt}>{dateFormatter.format(new Date(notification.createdAt))}</time>
                    </div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    {notification.resourceType && notification.resourceId ? (
                      <small>{t("inbox.resource")}: <code>{notification.resourceType}/{notification.resourceId}</code></small>
                    ) : null}
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={busy}
                    title={t(notification.readAt ? "inbox.markUnread" : "inbox.markRead")}
                    aria-label={t(notification.readAt ? "inbox.markUnread" : "inbox.markRead")}
                    onClick={() => void updateRead(notification.id, notification.readAt === null)}
                  >
                    {notification.readAt ? <Circle size={18} /> : <CheckCircle2 size={18} />}
                  </button>
                </article>
              ))}
            </div>
          )}
          {inboxPage?.nextCursor ? (
            <div className="load-more-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => void loadMoreInbox()}>{t("common.loadMore")}</button></div>
          ) : null}
        </section>
      ) : (
        <section className="content-section announcement-section">
          {!announcementPage?.items.length ? <p className="empty-state">{t("announcement.noItems")}</p> : (
            <div className="announcement-list">
              {announcementPage.items.map((announcement) => {
                const expired = announcement.expiresAt !== null && Date.parse(announcement.expiresAt) < Date.now();
                return (
                  <article className="announcement-item" key={announcement.id}>
                    <header>
                      <div>
                        <span className={`status-pill announcement-status-${announcement.status}`}>{t(announcementStatusTranslationKey(announcement.status))}</span>
                        {expired ? <span className="status-pill status-expired">{t("announcement.expired")}</span> : null}
                      </div>
                      <div className="row-actions">
                        {announcement.capabilities.edit ? (
                          <button className="icon-button" type="button" disabled={busy} title={t("common.edit")} aria-label={t("common.edit")} onClick={() => setEditor(announcement)}><Pencil size={17} /></button>
                        ) : null}
                        {announcement.capabilities.publish ? (
                          <button className="primary-button" type="button" disabled={busy} onClick={() => void publish(announcement)}><Send size={16} />{t("announcement.publish")}</button>
                        ) : null}
                        {announcement.capabilities.archive ? (
                          <button className="icon-button danger-button" type="button" disabled={busy} title={t("common.archive")} aria-label={t("common.archive")} onClick={() => void archive(announcement)}><Archive size={17} /></button>
                        ) : null}
                      </div>
                    </header>
                    <h2>{announcement.title}</h2>
                    <p>{announcement.body}</p>
                    <dl className="announcement-meta">
                      <div><dt>{t("announcement.space")}</dt><dd>{spaceNames.get(announcement.spaceId ?? "") ?? t("announcement.guildWide")}</dd></div>
                      <div><dt>{t("announcement.targetRole")}</dt><dd>{roleNames.get(announcement.targetRoleId ?? "") ?? t("announcement.allRoles")}</dd></div>
                      <div><dt>{t("announcement.classification")}</dt><dd>{t(classificationTranslationKey(announcement.classification))}</dd></div>
                      <div><dt>{t("announcement.expiry")}</dt><dd>{announcement.expiresAt ? dateFormatter.format(new Date(announcement.expiresAt)) : t("announcement.noExpiry")}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
          {announcementPage?.nextCursor ? (
            <div className="load-more-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => void loadMoreAnnouncements()}>{t("common.loadMore")}</button></div>
          ) : null}
        </section>
      )}

      {editor && directory && announcementPage ? (
        <AnnouncementEditorDialog
          api={api}
          directory={directory}
          announcement={editor === "create" ? null : editor}
          manageableSpaceIds={announcementPage.manageableSpaceIds}
          canCreateGuildWide={announcementPage.canCreateGuildWide}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await loadAnnouncements();
            setSuccess(t(editor === "create" ? "announcement.toastCreated" : "announcement.toastSaved"));
          }}
        />
      ) : null}
    </>
  );
}
