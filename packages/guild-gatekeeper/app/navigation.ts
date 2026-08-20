import type {
  UiCollectiveContext,
  UiDirectory,
  UiMemberBootstrapState,
} from "../src/management-types";

export const APP_PAGES = [
  "home",
  "ask",
  "members",
  "memory",
  "activity",
  "inbox",
  "messages",
  "lifecycle",
  "contributions",
  "context",
  "decisions",
  "knowledge",
  "work",
  "chronicle",
  "operations",
  "settings",
] as const;

export type AppPage = (typeof APP_PAGES)[number];
export type QuickAction = "ask" | "remember" | "start" | "review" | "agent-runs";

const APP_PAGE_SET: ReadonlySet<string> = new Set(APP_PAGES);
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isAppPage(value: string | null | undefined): value is AppPage {
  return typeof value === "string" && APP_PAGE_SET.has(value);
}

export function pageFromLocation(locationLike: Pick<Location, "hash"> = window.location): AppPage {
  const match = /^#\/([^?/#]+)/.exec(locationLike.hash);
  return isAppPage(match?.[1]) ? match[1] : "home";
}

export function pageHash(page: AppPage): string {
  return `#/${page}`;
}

export function writePageLocation(page: AppPage, options: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href);
  url.hash = pageHash(page);
  const state = { ...(history.state && typeof history.state === "object" ? history.state : {}), guildOsPage: page };
  if (options.replace) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
}

export function availablePages({
  bootstrap,
  directory,
  collective,
}: {
  bootstrap: UiMemberBootstrapState;
  directory: UiDirectory | null;
  collective: UiCollectiveContext;
}): ReadonlySet<AppPage> {
  const pages = new Set<AppPage>([
    "home",
    "ask",
    "memory",
    "activity",
    "inbox",
    "messages",
    "lifecycle",
    "contributions",
    "context",
    "decisions",
    "knowledge",
    "work",
    "settings",
  ]);
  if (directory) pages.add("members");
  if (bootstrap.membershipState === "active") pages.add("chronicle");

  const canManage = bootstrap.rootOwner || collective.canConfigure || Boolean(directory &&
    Object.values(directory.capabilities).some(Boolean));
  if (canManage) {
    pages.add("operations");
    pages.add("settings");
  }
  return pages;
}

export function invitationTokenFromLocation(
  locationLike: Pick<Location, "hash"> = window.location,
): string | null {
  const raw = locationLike.hash.startsWith("#") ? locationLike.hash.slice(1) : locationLike.hash;
  if (!raw || raw.startsWith("/")) return null;
  const token = new URLSearchParams(raw).get("invite");
  return token && INVITATION_TOKEN_PATTERN.test(token) ? token : null;
}

export function invitationLinkForToken(
  token: string,
  locationLike: Pick<Location, "href"> = window.location,
): string {
  if (!INVITATION_TOKEN_PATTERN.test(token)) throw new Error("Invitation token must be base64url and 43 characters.");
  const url = new URL(locationLike.href);
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.toString();
}

export function scrubLocationHash(): void {
  if (!window.location.hash) return;
  const url = new URL(window.location.href);
  url.hash = "";
  history.replaceState(history.state, "", url);
}
