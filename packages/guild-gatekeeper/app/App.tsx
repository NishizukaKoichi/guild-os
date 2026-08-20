import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectiveTemplate, type AppLocale, type CollectiveTemplateKey } from "@guild-os/domain";
import type {
  AssignRoleRequest,
  CreateAgentRequest,
  CreateRoleRequest,
  CreateServiceRequest,
  CreateSpaceRequest,
  GuildUiApi,
  InitializeGuildRequest,
  IssueInvitationInput,
  ProposeRootOwnershipTransferRequest,
  RecoverRootOwnershipRequest,
  RevokeBreakGlassCodesRequest,
  ResolveRootOwnershipTransferRequest,
  RotateBreakGlassCodesRequest,
  UiBootstrapState,
  UiCollectiveContext,
  UiDirectory,
  UiMemberBootstrapState,
  UpdateConstitutionRequest,
  UpdateRoleRequest,
} from "../src/management-types";
import { AppShell, type AppPage } from "./components/AppShell";
import { AccessPage } from "./pages/AccessPage";
import { ActivityPage } from "./pages/ActivityPage";
import { AskGuildPage } from "./pages/AskGuildPage";
import { ChroniclePage } from "./pages/ChroniclePage";
import { DecisionsPage } from "./pages/DecisionsPage";
import { ContributionsPage } from "./pages/ContributionsPage";
import { ContextPage } from "./pages/ContextPage";
import { HomePage } from "./pages/HomePage";
import { InboxPage } from "./pages/InboxPage";
import { InitializationPage } from "./pages/InitializationPage";
import { InitializationCompletePage } from "./pages/InitializationCompletePage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LifecyclePage } from "./pages/LifecyclePage";
import { MemoryPage } from "./pages/MemoryPage";
import { MessagesPage } from "./pages/MessagesPage";
import { OperationsPage } from "./pages/OperationsPage";
import { PeoplePage } from "./pages/PeoplePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkPage } from "./pages/WorkPage";
import { useI18n } from "./i18n";
import { localizeCollectiveContext } from "./collective-language";
import {
  availablePages,
  pageFromLocation,
  writePageLocation,
  type QuickAction,
} from "./navigation";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function App({ api }: { api: GuildUiApi }) {
  const { locale, setLocale, t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;
  const [bootstrap, setBootstrap] = useState<UiBootstrapState | null>(null);
  const [directory, setDirectory] = useState<UiDirectory | null>(null);
  const [collectiveSource, setCollectiveSource] = useState<UiCollectiveContext | null>(null);
  const [initializationReceipt, setInitializationReceipt] = useState<{
    bootstrap: UiMemberBootstrapState;
    templateKey: CollectiveTemplateKey;
    blueprintName: string | null;
    hasSuggestedAgent: boolean;
  } | null>(null);
  const collective = useMemo(() => collectiveSource
    ? localizeCollectiveContext(collectiveSource, locale, {
      name: t("initialization.customProfileName"),
      description: t("initialization.customProfileDescription"),
    })
    : null, [collectiveSource, locale, t]);
  const [page, setPage] = useState<AppPage>(() => pageFromLocation());
  const [quickActionRequest, setQuickActionRequest] = useState<{
    id: number;
    action: QuickAction;
  } | null>(null);
  const quickActionSequence = useRef(0);
  const [knowledgeTarget, setKnowledgeTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMemberData = useCallback(async (state: UiBootstrapState) => {
    if (state.screen !== "member") {
      setDirectory(null);
      setCollectiveSource(null);
      return;
    }
    const [contextResult, directoryResult] = await Promise.allSettled([
      api.getCollectiveContext(),
      api.getDirectory(),
    ]);
    if (contextResult.status === "rejected") throw contextResult.reason;
    setCollectiveSource(contextResult.value);
    if (directoryResult.status === "fulfilled") setDirectory(directoryResult.value);
    else {
      setDirectory(null);
      if (state.rootOwner) throw directoryResult.reason;
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await api.getBootstrap();
      setBootstrap(state);
      setLocale(state.preferredLocale);
      document.title = `${state.guildName} - Guild OS`;
      await loadMemberData(state);
    } catch (cause) {
      setError(messageFrom(cause, translateRef.current("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [api, loadMemberData, setLocale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const synchronize = () => setPage(pageFromLocation());
    window.addEventListener("popstate", synchronize);
    window.addEventListener("hashchange", synchronize);
    return () => {
      window.removeEventListener("popstate", synchronize);
      window.removeEventListener("hashchange", synchronize);
    };
  }, []);

  useEffect(() => {
    if (bootstrap?.screen !== "member" || !collectiveSource) return;
    const permitted = availablePages({ bootstrap, directory, collective: collectiveSource });
    if (!permitted.has(page)) {
      setPage("home");
      writePageLocation("home", { replace: true });
      return;
    }
    if (!window.location.hash.startsWith("#/")) {
      writePageLocation(page, { replace: true });
    }
  }, [bootstrap, collectiveSource, directory, page]);

  if (loading) {
    return <main className="center-state"><LoaderCircle className="spin" size={26} /><strong>{t("common.loading")}</strong></main>;
  }

  if (error || !bootstrap) {
    return (
      <main className="center-state error-state">
        <AlertCircle size={28} />
        <h1>{t("error.title")}</h1>
        <p>{error ?? t("error.generic")}</p>
        <button className="primary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={17} /><span>{t("common.retry")}</span>
        </button>
      </main>
    );
  }

  if (bootstrap.screen === "initialize") {
    if (initializationReceipt) {
      return (
        <InitializationCompletePage
          bootstrap={initializationReceipt.bootstrap}
          templateKey={initializationReceipt.templateKey}
          blueprintName={initializationReceipt.blueprintName}
          hasSuggestedAgent={initializationReceipt.hasSuggestedAgent}
          onContinue={() => {
            setInitializationReceipt(null);
            setPage("home");
            writePageLocation("home", { replace: true });
            void load();
          }}
        />
      );
    }
    return (
      <InitializationPage
        bootstrap={bootstrap}
        onGenerateBlueprint={(input) => api.generateCollectiveBlueprint(input)}
        onInitialize={async (input: InitializeGuildRequest) => {
          const state = await api.initializeGuild(input);
          if (state.screen !== "member") {
            throw new Error(t("initialization.error"));
          }
          setInitializationReceipt({
            bootstrap: state,
            templateKey: input.templateKey,
            blueprintName: input.blueprint?.definition.name ?? null,
            hasSuggestedAgent: Boolean(
              input.blueprint?.definition.suggestedAgent ?? collectiveTemplate(input.templateKey).suggestedAgent,
            ),
          });
        }}
      />
    );
  }

  if (bootstrap.screen === "access") {
    return (
      <AccessPage
        bootstrap={bootstrap}
        onClaim={async (input) => {
          const state = await api.claimInvitation(input);
          setBootstrap(state);
          await loadMemberData(state);
          setPage("home");
          writePageLocation("home", { replace: true });
        }}
        onRecover={async (input: RecoverRootOwnershipRequest) => {
          const state = await api.recoverRootOwnership(input);
          setBootstrap(state);
          await loadMemberData(state);
          setPage("home");
          writePageLocation("home", { replace: true });
        }}
      />
    );
  }

  if (!collective) {
    return <main className="center-state"><LoaderCircle className="spin" size={26} /><strong>{t("common.loading")}</strong></main>;
  }

  const permittedPages = availablePages({ bootstrap, directory, collective });
  const visiblePage = permittedPages.has(page) ? page : "home";
  const activeBootstrap = bootstrap;

  async function refreshDirectory() {
    await loadMemberData(activeBootstrap);
  }

  function navigate(nextPage: AppPage, options: { replace?: boolean } = {}) {
    const destination = permittedPages.has(nextPage) ? nextPage : "home";
    if (nextPage === "knowledge") setKnowledgeTarget(null);
    if (destination !== page || !window.location.hash.startsWith("#/")) {
      writePageLocation(destination, options);
    }
    setPage(destination);
  }

  function runQuickAction(action: QuickAction): void {
    quickActionSequence.current += 1;
    setQuickActionRequest({ id: quickActionSequence.current, action });
    if (action === "ask") navigate("ask");
    else if (action === "remember") navigate("memory");
    else if (action === "start") navigate("activity");
    else if (action === "agent-runs") navigate("members");
    else navigate("inbox");
  }

  return (
    <AppShell
      bootstrap={bootstrap}
      collective={collective}
      page={visiblePage}
      availablePages={permittedPages}
      onPageChange={navigate}
      onQuickAction={runQuickAction}
      onLocaleChange={async (locale) => {
        await api.setPreferredLocale(locale);
        setBootstrap((current) => current ? { ...current, preferredLocale: locale } : current);
      }}
    >
      {visiblePage === "home" ? (
        <HomePage
          api={api}
          bootstrap={bootstrap}
          collective={collective}
          directory={directory}
          onNavigate={navigate}
          onQuickAction={runQuickAction}
        />
      ) : null}
      {visiblePage === "inbox" ? <InboxPage api={api} directory={directory} /> : null}
      {visiblePage === "messages" ? <MessagesPage api={api} directory={directory} /> : null}
      {visiblePage === "lifecycle" ? <LifecyclePage api={api} directory={directory} /> : null}
      {visiblePage === "contributions" ? <ContributionsPage api={api} directory={directory} /> : null}
      {visiblePage === "context" ? <ContextPage api={api} /> : null}
      {visiblePage === "ask" ? (
        <AskGuildPage
          api={api}
          onNavigate={navigate}
          focusRequestId={quickActionRequest?.action === "ask" ? quickActionRequest.id : undefined}
          onOpenCitation={(citation) => {
            if (citation.resourceType === "memory") {
              if (citation.governed) setKnowledgeTarget(citation.resourceId);
              navigate(citation.governed ? "knowledge" : "memory");
            } else {
              navigate(citation.resourceType === "actor" ? "members" : "decisions");
            }
          }}
        />
      ) : null}
      {visiblePage === "memory" ? (
        <MemoryPage
          api={api}
          collective={collective}
          directory={directory}
          createRequestId={quickActionRequest?.action === "remember" ? quickActionRequest.id : undefined}
          onOpenGoverned={(memoryId) => {
            setKnowledgeTarget(memoryId);
            navigate("knowledge");
          }}
        />
      ) : null}
      {visiblePage === "activity" ? (
        <ActivityPage
          api={api}
          collective={collective}
          directory={directory}
          createRequestId={quickActionRequest?.action === "start" ? quickActionRequest.id : undefined}
          onOpenStructured={() => navigate("work")}
        />
      ) : null}
      {visiblePage === "knowledge" ? (
        <KnowledgePage api={api} directory={directory} requestedKnowledgeId={knowledgeTarget} />
      ) : null}
      {visiblePage === "work" ? (
        <WorkPage
          api={api}
          directory={directory}
          onOpenKnowledge={(knowledgeId) => {
            setKnowledgeTarget(knowledgeId);
            navigate("knowledge");
          }}
        />
      ) : null}
      {visiblePage === "decisions" ? (
        <DecisionsPage
          api={api}
          collective={collective}
          directory={directory}
          onOpenKnowledge={(knowledgeId) => {
            setKnowledgeTarget(knowledgeId);
            navigate("knowledge");
          }}
        />
      ) : null}
      {visiblePage === "members" && directory ? (
        <PeoplePage
          api={api}
          bootstrap={bootstrap}
          collective={collective}
          directory={directory}
          focusAgentRunsRequestId={quickActionRequest?.action === "agent-runs" ? quickActionRequest.id : undefined}
          onIssue={async (input: IssueInvitationInput) => {
            const result = await api.issueInvitation(input);
            await loadMemberData(bootstrap);
            return result;
          }}
          onRevoke={async (invitationId) => {
            await api.revokeInvitation(invitationId);
            await loadMemberData(bootstrap);
          }}
          onMembershipChange={async (identityId, nextState) => {
            await api.changeMembership(identityId, nextState);
            await refreshDirectory();
          }}
          onMachineMembershipChange={async (identityId, nextState) => {
            await api.changeMachineMembership(identityId, nextState);
            await refreshDirectory();
          }}
          onOffboard={async (input) => {
            await api.offboardActor(input);
            await refreshDirectory();
          }}
          onAssignRole={async (input: AssignRoleRequest) => {
            await api.assignRole(input);
            await refreshDirectory();
          }}
          onRemoveRole={async (bindingId) => {
            await api.removeRoleBinding(bindingId);
            await refreshDirectory();
          }}
          onCreateService={async (input: CreateServiceRequest) => {
            await api.createService(input);
            await refreshDirectory();
          }}
          onCreateAgent={async (input: CreateAgentRequest) => {
            await api.createAgent(input);
            await refreshDirectory();
          }}
          onLoadMoreIdentities={directory.nextIdentityCursor ? async () => {
            const next = await api.getDirectory({
              identityCursor: directory.nextIdentityCursor,
              includeInvitations: false,
            });
            setDirectory((current) => current ? {
              ...current,
              identities: [...current.identities, ...next.identities],
              roleBindings: [...current.roleBindings, ...next.roleBindings],
              agentProfiles: [...current.agentProfiles, ...next.agentProfiles],
              nextIdentityCursor: next.nextIdentityCursor,
            } : next);
          } : null}
          onLoadMoreInvitations={directory.nextInvitationCursor ? async () => {
            const next = await api.getDirectory({
              invitationCursor: directory.nextInvitationCursor,
              includeIdentities: false,
            });
            setDirectory((current) => current ? {
              ...current,
              invitations: [...current.invitations, ...next.invitations],
              nextInvitationCursor: next.nextInvitationCursor,
            } : next);
          } : null}
        />
      ) : null}
      {visiblePage === "chronicle" ? <ChroniclePage api={api} directory={directory} /> : null}
      {visiblePage === "operations" ? <OperationsPage api={api} /> : null}
      {visiblePage === "settings" ? (
        <SettingsPage
          bootstrap={bootstrap}
          collective={collective}
          directory={directory}
          onLocaleChange={async (locale: AppLocale) => api.setPreferredLocale(locale)}
          onUpdateConstitution={async (input: UpdateConstitutionRequest) => {
            const constitution = await api.updateConstitution(input);
            setBootstrap((current) => current?.screen === "member" ? {
              ...current,
              constitution,
              agentDefaults: constitution.agentDefaults,
            } : current);
          }}
          onProposeRootOwnershipTransfer={async (input: ProposeRootOwnershipTransferRequest) => {
            const state = await api.proposeRootOwnershipTransfer(input);
            setBootstrap(state);
          }}
          onCancelRootOwnershipTransfer={async (input: ResolveRootOwnershipTransferRequest) => {
            const state = await api.cancelRootOwnershipTransfer(input);
            setBootstrap(state);
          }}
          onAcceptRootOwnershipTransfer={async (input: ResolveRootOwnershipTransferRequest) => {
            const state = await api.acceptRootOwnershipTransfer(input);
            setBootstrap(state);
            await loadMemberData(state);
          }}
          onSearchRootOwnershipCandidates={(search) => api.searchRootOwnershipCandidates(search)}
          onRotateBreakGlassCodes={async (input: RotateBreakGlassCodesRequest) => {
            const result = await api.rotateBreakGlassCodes(input);
            setBootstrap((current) => current?.screen === "member"
              ? { ...current, breakGlass: result.status }
              : current);
            return result;
          }}
          onRevokeBreakGlassCodes={async (input: RevokeBreakGlassCodesRequest) => {
            const status = await api.revokeBreakGlassCodes(input);
            setBootstrap((current) => current?.screen === "member"
              ? { ...current, breakGlass: status }
              : current);
          }}
          onRecoverRootOwnership={async (input: RecoverRootOwnershipRequest) => {
            const state = await api.recoverRootOwnership(input);
            setBootstrap(state);
            await loadMemberData(state);
          }}
          onCreateRole={async (input: CreateRoleRequest) => {
            await api.createRole(input);
            await refreshDirectory();
          }}
          onUpdateRole={async (input: UpdateRoleRequest) => {
            await api.updateRole(input);
            await refreshDirectory();
          }}
          onDeleteRole={async (roleId) => {
            await api.deleteRole(roleId);
            await refreshDirectory();
          }}
          onCreateSpace={async (input: CreateSpaceRequest) => {
            await api.createSpace(input);
            await refreshDirectory();
          }}
          onRenameSpace={async (spaceId, name) => {
            await api.renameSpace(spaceId, name);
            await refreshDirectory();
          }}
          onArchiveSpace={async (spaceId) => {
            await api.archiveSpace(spaceId);
            await refreshDirectory();
          }}
          onGenerateCollectiveBlueprint={(input) => api.generateCollectiveBlueprint(input)}
          onSaveCollectiveBlueprint={async (input) => {
            setCollectiveSource(await api.saveCollectiveBlueprint(input));
          }}
          onConfigureCollective={async (input) => {
            setCollectiveSource(await api.configureCollective(input));
          }}
          onSetSpaceVocabulary={async (input) => {
            setCollectiveSource(await api.setSpaceVocabulary(input));
          }}
        />
      ) : null}
    </AppShell>
  );
}
