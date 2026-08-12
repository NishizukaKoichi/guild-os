import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppLocale } from "@guild-os/domain";
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
  UiDirectory,
  UpdateConstitutionRequest,
  UpdateRoleRequest,
} from "../src/management-types";
import { AppShell, type AppPage } from "./components/AppShell";
import { AccessPage } from "./pages/AccessPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AskGuildPage } from "./pages/AskGuildPage";
import { ChroniclePage } from "./pages/ChroniclePage";
import { DecisionsPage } from "./pages/DecisionsPage";
import { HomePage } from "./pages/HomePage";
import { InboxPage } from "./pages/InboxPage";
import { InitializationPage } from "./pages/InitializationPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { PeoplePage } from "./pages/PeoplePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkPage } from "./pages/WorkPage";
import { useI18n } from "./i18n";

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function App({ api }: { api: GuildUiApi }) {
  const { t } = useI18n();
  const [bootstrap, setBootstrap] = useState<UiBootstrapState | null>(null);
  const [directory, setDirectory] = useState<UiDirectory | null>(null);
  const [page, setPage] = useState<AppPage>("home");
  const [knowledgeTarget, setKnowledgeTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(async (state: UiBootstrapState) => {
    if (state.screen !== "member") {
      setDirectory(null);
      return;
    }
    try {
      setDirectory(await api.getDirectory());
    } catch (cause) {
      setDirectory(null);
      if (state.rootOwner) throw cause;
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await api.getBootstrap();
      setBootstrap(state);
      document.title = `${state.guildName} - Guild OS`;
      await loadDirectory(state);
    } catch (cause) {
      setError(messageFrom(cause, t("error.generic")));
    } finally {
      setLoading(false);
    }
  }, [api, loadDirectory, t]);

  useEffect(() => {
    void load();
  }, [load]);

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
    return (
      <InitializationPage
        bootstrap={bootstrap}
        onInitialize={async (input: InitializeGuildRequest) => {
          const state = await api.initializeGuild(input);
          setBootstrap(state);
          await loadDirectory(state);
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
          await loadDirectory(state);
        }}
        onRecover={async (input: RecoverRootOwnershipRequest) => {
          const state = await api.recoverRootOwnership(input);
          setBootstrap(state);
          await loadDirectory(state);
        }}
      />
    );
  }

  const visiblePage = (
    ((page === "people" || page === "agents") && !directory) ||
    (page === "chronicle" && bootstrap.membershipState !== "active")
  ) ? "home" : page;
  const activeBootstrap = bootstrap;

  async function refreshDirectory() {
    await loadDirectory(activeBootstrap);
  }

  return (
    <AppShell
      bootstrap={bootstrap}
      page={visiblePage}
      peopleAvailable={directory !== null}
      agentsAvailable={directory !== null}
      onPageChange={(nextPage) => {
        if (nextPage === "knowledge") setKnowledgeTarget(null);
        setPage(nextPage);
      }}
    >
      {visiblePage === "home" ? <HomePage bootstrap={bootstrap} directory={directory} /> : null}
      {visiblePage === "inbox" ? <InboxPage api={api} directory={directory} /> : null}
      {visiblePage === "ask" ? (
        <AskGuildPage
          api={api}
          onOpenKnowledge={(knowledgeId) => {
            setKnowledgeTarget(knowledgeId);
            setPage("knowledge");
          }}
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
            setPage("knowledge");
          }}
        />
      ) : null}
      {visiblePage === "decisions" ? (
        <DecisionsPage
          api={api}
          directory={directory}
          onOpenKnowledge={(knowledgeId) => {
            setKnowledgeTarget(knowledgeId);
            setPage("knowledge");
          }}
        />
      ) : null}
      {visiblePage === "people" && directory ? (
        <PeoplePage
          bootstrap={bootstrap}
          directory={directory}
          onIssue={async (input: IssueInvitationInput) => {
            const result = await api.issueInvitation(input);
            await loadDirectory(bootstrap);
            return result;
          }}
          onRevoke={async (invitationId) => {
            await api.revokeInvitation(invitationId);
            await loadDirectory(bootstrap);
          }}
          onMembershipChange={async (identityId, nextState) => {
            await api.changeMembership(identityId, nextState);
            await refreshDirectory();
          }}
          onMachineMembershipChange={async (identityId, nextState) => {
            await api.changeMachineMembership(identityId, nextState);
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
      {visiblePage === "agents" && directory ? (
        <AgentsPage
          api={api}
          bootstrap={bootstrap}
          directory={directory}
          onCreate={async (input: CreateAgentRequest) => {
            await api.createAgent(input);
            await refreshDirectory();
          }}
          onMembershipChange={async (identityId, nextState) => {
            await api.changeMachineMembership(identityId, nextState);
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
        />
      ) : null}
      {visiblePage === "chronicle" ? <ChroniclePage api={api} directory={directory} /> : null}
      {visiblePage === "settings" ? (
        <SettingsPage
          bootstrap={bootstrap}
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
            await loadDirectory(state);
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
            await loadDirectory(state);
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
        />
      ) : null}
    </AppShell>
  );
}
