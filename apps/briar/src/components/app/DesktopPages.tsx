import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import { Inbox as InboxIcon, MessageCircle } from "lucide-react";

import { useI18n } from "../../i18n";
import { InboxDetailPanel } from "../InboxDetailPanel";
import {
  InboxDetailTargetBoundary,
  InboxWithSelection,
} from "../InboxSelectionBoundary";
import { EmptyState, MainContent, PageHeader } from "../layout";
import { AppSettingsSidebar } from "./AppSettingsSidebar";
import {
  ChannelsWithCatalog,
  DirectMessagesWithCatalog,
} from "./ChannelViews";
import { HuntDashboardWithTeam } from "./HuntDashboardWithTeam";
import { InboxDetailContent } from "./InboxDetailContent";
import {
  TeamAgentsWithDashboard,
  TeamLobbyWithDashboard,
  TeamSettingsWithDashboard,
} from "./TeamViewsWithDashboard";
import {
  AppSettingsWithWorkspace,
  TeamRepositorySetupDialogWithWorkspace,
} from "./WorkspaceViews";
import { useHorizontalPaneResize } from "../../hooks/useHorizontalPaneResize";
import { useWorkerDispatch } from "../../hooks/useWorkerDispatch";
import { inboxDetailLabel } from "../../lib/inbox-detail-label";
import {
  clampInboxPaneWidth,
  inboxPaneWidthDefault,
  inboxPaneWidthMax,
  inboxPaneWidthMin,
  loadInboxPaneWidth,
  saveInboxPaneWidth,
} from "../../lib/inbox-pane-width";
import {
  inboxNotificationTarget,
  isInboxChannelTarget,
  isInboxRunDetailTarget,
} from "../../lib/inbox-notifications";
import { activeOrganizationTeams } from "../../lib/team-window-scope";
import { cn } from "../../lib/utils";
import {
  projectNavigationLocation,
  settingsNavigationLocation,
} from "../../lib/app-navigation";
import { useAgentSessionActions } from "../../state/agent-sessions/actions";
import { useChannelActions } from "../../state/channels/actions";
import {
  requestedChannelMessageAtom,
  viewingIssueConversationRunIdAtom,
} from "../../state/channels/atoms";
import {
  activePlanningProjectIdAtom,
  createIssueTeamIdAtom,
  isIssueDialogOpenAtom,
  isSidebarOpenAtom,
  planningProjectEditIdAtom,
  planningProjectTeamIdAtom,
  quickProcessErrorAtom,
} from "../../state/dialogs/atoms";
import { inboxDetailTargetAtom } from "../../state/inbox-selection";
import { useInboxActions } from "../../state/inbox/actions";
import {
  channelInboxSyncSignalAtom,
  conversationInboxSyncSignalAtom,
  inboxMessagesAtom,
  visibleInboxMessagesAtom,
  visibleInboxUnreadCountAtom,
} from "../../state/inbox/atoms";
import { runAtom } from "../../state/entities/runs";
import { useIssueActions } from "../../state/issues/actions";
import { useNavigationActions } from "../../state/navigation/actions";
import {
  activePageAtom,
  activeRunIdAtom,
  activeTeamForTabsAtom,
  agentListRequestKeyAtom,
  canGoBackAtom,
  desktopActiveChannelIdAtom,
  issueListRequestKeyAtom,
  navigationTeamIdAtom,
  pendingBriarLinkAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "../../state/navigation/atoms";
import { useOrganizationActions } from "../../state/organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { demoMode, lockedTeamIdAtom } from "../../state/platform";
import { useRunDetailActions } from "../../state/run-detail/actions";
import { appErrorAtom } from "../../state/app-error";
import { useSessionActions } from "../../state/session/actions";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { useSyncActions } from "../../state/sync/actions";
import { useTeamActions } from "../../state/team/actions";
import {
  activeTeamIdAtom,
  deletingTeamIdAtom,
  loadedTeamIdAtom,
  teamsAtom,
} from "../../state/team/atoms";
import { useWorkspaceActions } from "../../state/workspace/actions";
import type {
  DesktopShellAgents,
  DesktopShellRepositorySetup,
} from "./desktop-shell-props";
import type { createCachedTeamUsageSummaryLoader } from "../../lib/team-usage-summary";
import type { AgentAutoHuntOptions } from "../../hooks/useAgentDispatch";
import type { TeamMergeActivityLoader } from "../../lib/team-merge-activity";
import type { InboxNotificationTarget } from "../../generated/tauri";
import type { MyIssuesTeamBoard } from "../MyIssues";
import type {
  AgentUsageReport,
  DashboardPayload,
  HuntRun,
  Project,
  ProjectAgent,
} from "../../types";

/*
  The page the navigation location points at.

  This is the shell's content slot, and it is its own component because the
  location is the only thing that moves it. The shell around it — the window
  chrome, the sidebar's callbacks, the status bar — subscribes to no navigation
  atom, so walking from one page to another commits this subtree and the sidebar
  and nothing else.

  The lazy boundaries of the five pages only the desktop renders live here with
  them.
*/

const MyIssues = lazy(() =>
  import("../MyIssues").then((m) => ({ default: m.MyIssues })),
);
const OrganizationCreate = lazy(() =>
  import("../OrganizationCreate").then((m) => ({
    default: m.OrganizationCreate,
  })),
);
const OrganizationSettings = lazy(() =>
  import("./OrganizationSettingsWithSession").then((m) => ({
    default: m.OrganizationSettingsWithSession,
  })),
);
const TeamSchedule = lazy(() =>
  import("../TeamSchedule").then((m) => ({ default: m.TeamSchedule })),
);
const Teams = lazy(() =>
  import("./TeamsWithPlanningProjects").then((m) => ({
    default: m.TeamsWithPlanningProjects,
  })),
);

/** Neutral placeholder that fills the slot a lazy view is about to occupy. */
const lazyViewFallback = <div className="lazy-view-placeholder h-full w-full" />;

/**
 * The inbox's detail pane, named after whatever it opened on.
 *
 * The name is the one thing about the pane that depends on the store, and an
 * issue notification wants the run's own title — the one that keeps up with an
 * edit. Reading that run here rather than in the page is what keeps a board
 * edit out of the page: the pane subscribes to the one run it names, and the
 * page around it subscribes to no run at all.
 */
function InboxDetailPane({
  children,
  target,
}: {
  readonly children: ReactNode;
  readonly target: InboxNotificationTarget | null;
}) {
  const { t } = useI18n();
  const messages = useAtomValue(inboxMessagesAtom);
  const loadedTeamId = useAtomValue(loadedTeamIdAtom);
  const run = useAtomValue(
    runAtom(
      target && isInboxRunDetailTarget(target) &&
        loadedTeamId === target.projectId
        ? target.targetId
        : "",
    ),
  );
  return (
    <InboxDetailPanel
      label={
        target
          ? inboxDetailLabel({
              fallback: t("inbox.messages"),
              messages,
              runTitle: run?.title ?? null,
              target,
            })
          : t("inbox.noNotificationSelected")
      }
    >
      {children}
    </InboxDetailPanel>
  );
}

export interface DesktopPagesProps {
  /** The selected team, as the app resolved it for its hooks. */
  readonly activeProject: Project | undefined;
  readonly agents: DesktopShellAgents;
  readonly repositorySetup: DesktopShellRepositorySetup;
  readonly loadUsageReport: () => Promise<AgentUsageReport>;
  readonly loadProjectHomeUsage: ReturnType<
    typeof createCachedTeamUsageSummaryLoader
  >;
  readonly loadProjectHomeMerges: TeamMergeActivityLoader;
  readonly loadOrganizationProjectDashboard: (
    teamId: string,
    signal: AbortSignal,
  ) => Promise<MyIssuesTeamBoard | null>;
  readonly openOrganizationIssue: (teamId: string, runId: string) => void;
  readonly startAgentAutoHunt: (
    agent: ProjectAgent,
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => Promise<string>;
  readonly startProjectAgentTask: (
    agent: ProjectAgent,
    input: { request: string; workerId: string; skillId: string },
  ) => Promise<string>;
}

export function DesktopPages({
  activeProject,
  agents,
  loadOrganizationProjectDashboard,
  loadProjectHomeMerges,
  loadProjectHomeUsage,
  loadUsageReport,
  openOrganizationIssue,
  repositorySetup,
  startAgentAutoHunt,
  startProjectAgentTask,
}: DesktopPagesProps) {
  const { t } = useI18n();
  const channelInboxSyncSignal = useAtomValue(channelInboxSyncSignalAtom);
  const conversationInboxSyncSignal = useAtomValue(
    conversationInboxSyncSignalAtom,
  );
  const visibleInboxMessages = useAtomValue(visibleInboxMessagesAtom);
  const inbox = useInboxActions();
  const activePage = useAtomValue(activePageAtom);
  const activeProjectForTabs = useAtomValue(activeTeamForTabsAtom);
  const canGoBack = useAtomValue(canGoBackAtom);
  const desktopActiveChannelId = useAtomValue(desktopActiveChannelIdAtom);
  const navigationProjectId = useAtomValue(navigationTeamIdAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const {
    closeSettings,
    goBack,
    handleDesktopChannelFallback,
    navigateToChannel,
    navigateToIssue,
    navigateToLocation,
    navigateToPage,
    replaceNavigationLocation,
    resetNavigation,
  } = useNavigationActions();
  const {
    activeTeamAgents: activeProjectAgents,
    all: issueAgents,
    rememberAgent: rememberIssueAgent,
  } = agents;
  const agentSessions = useAgentSessionActions();
  const {
    closeRepositorySetup,
    openTeamRepository: openProjectRepository,
    repositorySetupTeamId,
  } = repositorySetup;
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const projects = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeProjectId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const deletingProjectId = useAtomValue(deletingTeamIdAtom);
  const error = useAtomValue(appErrorAtom);
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [settingsTarget, setSettingsTarget] = useAtom(settingsTargetAtom);
  const [requestedRunId, setRequestedRunId] = useAtom(requestedRunIdAtom);
  const [requestedRunMessageId, setRequestedRunMessageId] = useAtom(
    requestedRunMessageIdAtom,
  );
  const [requestedRunInitialTab, setRequestedRunInitialTab] = useAtom(
    requestedRunInitialTabAtom,
  );
  const [requestedSessionId, setRequestedSessionId] = useAtom(
    requestedSessionIdAtom,
  );
  const [issueListRequestKey, setIssueListRequestKey] = useAtom(
    issueListRequestKeyAtom,
  );
  const [agentListRequestKey, setAgentListRequestKey] = useAtom(
    agentListRequestKeyAtom,
  );
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useAtom(
    isIssueDialogOpenAtom,
  );
  const [createIssueProjectId, setCreateIssueProjectId] = useAtom(
    createIssueTeamIdAtom,
  );
  const [activePlanningProjectId, setActivePlanningProjectId] = useAtom(
    activePlanningProjectIdAtom,
  );
  const setPlanningProjectTeamId = useAtomSet(planningProjectTeamIdAtom);
  const setPlanningProjectEditId = useAtomSet(planningProjectEditIdAtom);
  const setInboxDetailTarget = useAtomSet(inboxDetailTargetAtom);
  const setPendingBriarLink = useAtomSet(pendingBriarLinkAtom);
  const setRequestedChannelMessage = useAtomSet(requestedChannelMessageAtom);
  const setViewingIssueConversationRunId = useAtomSet(
    viewingIssueConversationRunIdAtom,
  );
  const quickProcessError = useAtomValue(quickProcessErrorAtom);
  const { markOrganizationChannelRead, selectChannel } = useChannelActions();
  const { addOrganization, checkOrganizationHandle, selectOrganization } =
    useOrganizationActions();
  const {
    changeTeamIcon,
    changeTeamIssueKeyPrefix,
    changeTeamScheduleTab,
    startTeamCreation,
  } = useTeamActions();
  const visibleInboxUnreadCount = useAtomValue(visibleInboxUnreadCountAtom);
  const { removeProject } = useWorkspaceActions();
  const { deleteAccount, logout, updateAccountProfile } = useSessionActions();
  const { ensureTeamSelected, selectTeam } = useTeamActions();
  const { refreshActiveTeam } = useSyncActions();
  const { removeIssue, transferIssue } = useIssueActions();
  const { addIssueMessage } = useRunDetailActions();
  const { processIssueNow } = useWorkerDispatch();
  const {
    containerRef: inboxLayoutRef,
    effectiveWidth: inboxDetailPaneWidth,
    isResizing: isResizingInbox,
    separatorProps: inboxResizeProps,
  } = useHorizontalPaneResize({
    clamp: clampInboxPaneWidth,
    cssVariable: "--inbox-detail-pane-width",
    defaultWidth: inboxPaneWidthDefault,
    load: loadInboxPaneWidth,
    max: inboxPaneWidthMax,
    min: inboxPaneWidthMin,
    save: saveInboxPaneWidth,
  });

  const activeOrganization = organizations.find(
    (organization) => organization.id === activeOrganizationId,
  );
  const settingsOrganization =
    settingsTarget.scope === "organization"
      ? organizations.find(
          (organization) => organization.id === settingsTarget.organizationId,
        )
      : null;
  const activeOrganizationProjects = useMemo(
    () =>
      activeOrganizationTeams(
        projects,
        lockedTeamId,
        activeOrganizationId,
        activeProjectId,
      ),
    [activeOrganizationId, activeProjectId, lockedTeamId, projects],
  );

  const settingsSidebar = (
    <AppSettingsSidebar
      onBack={closeSettings}
      onNavigate={navigateToLocation}
      onSelectOrganization={selectOrganization}
      onSelectTeam={selectTeam}
    />
  );

  const renderInboxDetailContent = (
    inboxDetailTarget: InboxNotificationTarget,
  ) => (
    <InboxDetailContent
      agents={issueAgents}
      channelInboxSyncSignal={channelInboxSyncSignal}
      conversationInboxSyncSignal={conversationInboxSyncSignal}
      onEnsureTeamSelected={ensureTeamSelected}
      onNavigateToIssue={navigateToIssue}
      onNavigateToPage={navigateToPage}
      onSkillSessionAccepted={agentSessions.adoptRemoteSession}
      onStopSession={agentSessions.stopSession}
      target={inboxDetailTarget}
    />
  );

  return (
    <div className="app-content-surface">
    <Suspense fallback={null}>
    <TeamRepositorySetupDialogWithWorkspace
      onClose={closeRepositorySetup}
      teamId={repositorySetupTeamId}
    />
    </Suspense>
    <Suspense fallback={lazyViewFallback}>
    {activePage === "organization-create" ? (
      <OrganizationCreate
        onBack={() =>
          canGoBack ? goBack() : navigateToPage("issues")
        }
        onCheckHandle={checkOrganizationHandle}
        onCreate={async (input) => {
          await addOrganization(input);
          resetNavigation("issues");
        }}
      />
    ) : activePage === "settings" &&
      settingsTarget.scope === "application" &&
      user ? (
      <AppSettingsWithWorkspace
        initialSection={settingsTarget.section}
        navigationSidebar={settingsSidebar}
        onBack={closeSettings}
        onAccountDelete={demoMode ? undefined : deleteAccount}
        onAccountSave={updateAccountProfile}
        onLoadUsageReport={loadUsageReport}
        onSectionChange={(section) => {
          const target = { scope: "application" as const, section };
          setSettingsTarget(target);
          navigateToLocation(settingsNavigationLocation(target));
        }}
      />
    ) : activePage === "settings" &&
    settingsTarget.scope === "organization" &&
    settingsOrganization ? (
      <OrganizationSettings
        initialSection={settingsTarget.section}
        key={settingsOrganization.id}
        navigationSidebar={settingsSidebar}
        onBack={closeSettings}
        organization={settingsOrganization}
      />
    ) : activePage === "dms" &&
      !lockedTeamId &&
      activeOrganizationId &&
      token ? (
      <DirectMessagesWithCatalog
        activeChannelId={desktopActiveChannelId}
        channelInboxSyncSignal={channelInboxSyncSignal}
        isSidebarOpen={isSidebarOpen}
        key={`desktop-dms:${activeOrganizationId}`}
        onChannelFallback={(channelId) =>
          handleDesktopChannelFallback(channelId, "dms")
        }
        onChannelSelect={(channelId) => {
          if (channelId) navigateToChannel(channelId, "dms");
          else {
            selectChannel(null);
            navigateToPage("dms");
          }
        }}
        onCreateAgent={() => {
          setSettingsTarget({
            scope: "organization",
            organizationId: activeOrganizationId!,
            section: "agents",
          });
          setIsSidebarOpen(true);
          navigateToPage("settings");
        }}
        onIssueCreated={async (projectId, runId) => {
          await ensureTeamSelected(projectId);
          setRequestedRunId(runId);
          navigateToIssue(runId, projectId);
        }}
        onSkillSessionAccepted={agentSessions.adoptRemoteSession}
      />
    ) : activePage === "dms" &&
      !lockedTeamId &&
      activeOrganizationId ? (
      <MainContent id="dms">
        <PageHeader title={t("sidebar.dms")} />
        <EmptyState
          description={t("dm.composeDescription")}
          icon={<MessageCircle aria-hidden="true" size={20} />}
          title={t("dm.empty")}
        />
      </MainContent>
    ) : activePage === "projects" && activeProjectForTabs ? (
      <Teams
        isSidebarOpen={isSidebarOpen}
        onCreate={() => {
          setPlanningProjectEditId(null);
          setPlanningProjectTeamId(activeProjectForTabs.id);
        }}
        onOpen={(planningProjectId, teamId) => {
          setActivePlanningProjectId(planningProjectId);
          selectTeam(teamId);
          setRequestedRunId(null);
          setIssueListRequestKey((key) => key + 1);
          navigateToPage("issues", teamId);
        }}
        onSettings={(planningProjectId) => {
          setPlanningProjectTeamId(null);
          setPlanningProjectEditId(planningProjectId);
        }}
        teamId={activeProjectForTabs.id}
        teamName={activeProjectForTabs.name}
      />
    ) : activePage === "my-issues" && activeOrganizationId ? (
      <MyIssues
        currentUserId={user?.id ?? null}
        isSidebarOpen={isSidebarOpen}
        loadProjectDashboard={loadOrganizationProjectDashboard}
        onOpenIssue={openOrganizationIssue}
        organizationId={activeOrganizationId}
        organizationName={activeOrganization?.name}
        projects={activeOrganizationProjects}
      />
    ) : activePage === "inbox" ? (
      <main
        aria-label={`${t("inbox.title")} · ${t("inbox.messages")}`}
        className={cn(
          "inbox-layout grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(280px,1fr)_var(--inbox-resizer-width,6px)_minmax(320px,var(--inbox-detail-pane-width,50%))] grid-rows-[minmax(0,1fr)] bg-card",
          isResizingInbox && "is-resizing-inbox cursor-col-resize select-none",
        )}
        ref={inboxLayoutRef}
      >
        <InboxWithSelection
          desktopEmbedded
          isSidebarOpen={isSidebarOpen}
          messages={visibleInboxMessages}
          onMarkAllRead={
            lockedTeamId
              ? () => {
                  for (const message of visibleInboxMessages) {
                    if (message.isUnread) inbox.markRead(message.id);
                  }
                }
              : inbox.markAllRead
          }
          onMarkRead={inbox.markRead}
          onMarkUnread={inbox.markUnread}
          onOpen={(message) => {
            const target = inboxNotificationTarget(message);
            inbox.markRead(message.id);
            if (target.projectId !== activeProjectId) {
              selectTeam(target.projectId);
            }
            if (isInboxChannelTarget(target)) {
              setRequestedRunId(null);
              setRequestedSessionId(null);
              setRequestedChannelMessage({
                channelId: target.targetId,
                messageId: target.channelMessageId,
                rootMessageId: target.rootMessageId,
              });
              selectChannel(target.targetId);
              markOrganizationChannelRead(target.targetId);
            } else {
              setRequestedChannelMessage(null);
            }
            setInboxDetailTarget(target);
          }}
          projects={activeOrganizationProjects}
          unreadCount={visibleInboxUnreadCount}
        />
        <div
          aria-label={t("inbox.resizeDetailPane")}
          aria-orientation="vertical"
          aria-valuemax={inboxPaneWidthMax}
          aria-valuemin={inboxPaneWidthMin}
          aria-valuenow={inboxDetailPaneWidth}
          className={cn(
            "inbox-pane-resizer relative z-[1] h-full min-h-0 min-w-0 cursor-col-resize touch-none bg-transparent outline-none before:absolute before:bottom-0 before:left-1/2 before:top-0 before:w-px before:-translate-x-1/2 before:bg-border before:opacity-0 before:shadow-none before:transition-[opacity,background-color,box-shadow] before:duration-150 after:absolute after:left-1/2 after:top-1/2 after:h-[34px] after:w-[5px] after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:border after:border-border after:bg-card after:opacity-0 after:transition-[opacity,border-color,background-color] after:duration-150 motion-reduce:before:transition-none motion-reduce:after:transition-none hover:before:bg-primary/60 hover:before:opacity-100 hover:before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] hover:after:border-primary/60 hover:after:bg-accent hover:after:opacity-100 focus-visible:before:bg-primary/60 focus-visible:before:opacity-100 focus-visible:before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] focus-visible:after:border-primary/60 focus-visible:after:bg-accent focus-visible:after:opacity-100",
            isResizingInbox &&
              "before:bg-primary/60 before:opacity-100 before:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] after:border-primary/60 after:bg-accent after:opacity-100",
          )}
          role="separator"
          tabIndex={0}
          {...inboxResizeProps}
        />
        <InboxDetailTargetBoundary>
          {(target) => (
            <InboxDetailPane target={target}>
              {target ? renderInboxDetailContent(target) : (
                <div
                  className="inbox-detail-empty flex h-full w-full flex-col items-center justify-center gap-[18px] bg-card text-center text-muted-foreground [&>svg]:text-muted-foreground/60 [&>p]:m-0 [&>p]:text-sm"
                  role="status"
                >
                  <InboxIcon aria-hidden="true" size={56} strokeWidth={1.2} />
                  <p>{t("inbox.noNotificationSelected")}</p>
                </div>
              )}
            </InboxDetailPane>
          )}
        </InboxDetailTargetBoundary>
      </main>
    ) : activePage === "settings" &&
      settingsTarget.scope === "project" &&
      activeProject ? (
      <TeamSettingsWithDashboard
        isDeleting={deletingProjectId === activeProjectId}
        isSidebarOpen={isSidebarOpen}
        initialSection={settingsTarget.section}
        key={activeProject.id}
        navigationSidebar={settingsSidebar}
        onBack={closeSettings}
        onDelete={async () => {
          const fallbackProject = projects.find(
            (project) => project.id !== activeProject.id,
          );
          await removeProject(activeProject.id);
          agentSessions.removeTeamSessions(activeProject.id);
          replaceNavigationLocation(
            fallbackProject
              ? projectNavigationLocation("issues", fallbackProject.id)
              : "lobby",
          );
        }}
        onIconChange={changeTeamIcon}
        onIssueKeyPrefixChange={changeTeamIssueKeyPrefix}
        onScheduleTabChange={changeTeamScheduleTab}
        project={activeProject}
        sessionToken={token}
      />
    ) : activePage === "lobby" && activeProject ? (
      <TeamLobbyWithDashboard
        isSidebarOpen={isSidebarOpen}
        onLoadUsageSummary={loadProjectHomeUsage}
        onLoadMergeActivity={loadProjectHomeMerges}
        onOpenAgents={() => {
          setRequestedSessionId(null);
          setAgentListRequestKey((key) => key + 1);
          navigateToPage("agents");
        }}
        onOpenIssue={(runId) => {
          setRequestedSessionId(null);
          setRequestedRunId(runId);
          navigateToIssue(runId);
        }}
        onOpenIssues={() => {
          setRequestedRunId(null);
          navigateToPage("issues");
        }}
        onOpenRepository={() => openProjectRepository(activeProject.id)}
        onOpenSettings={() => {
          setSettingsTarget({
            scope: "project",
            projectId: activeProject.id,
            section: "general",
          });
          navigateToPage("settings");
        }}
        project={activeProject}
      />
    ) : activePage === "agents" && activeProject ? (
      <TeamAgentsWithDashboard
        agentListRequestKey={agentListRequestKey}
        error={error}
        isSidebarOpen={isSidebarOpen}
        onIssueOpen={(runId) => {
          setRequestedSessionId(null);
          setRequestedRunId(runId);
          navigateToIssue(runId);
        }}
        onRequestedSessionOpen={() => setRequestedSessionId(null)}
        onSettleTaskSession={agentSessions.settleTaskSession}
        onStopSession={agentSessions.stopSession}
        onStart={startAgentAutoHunt}
        onStartRemoteTask={token ? startProjectAgentTask : undefined}
        onStartTaskSession={(agent, session) => {
          rememberIssueAgent(agent);
          agentSessions.startTaskSession(activeProject.id, agent.id, {
            ...session,
            agentName: agent.name,
          });
        }}
        project={activeProject}
        requestedSessionId={requestedSessionId}
        token={token}
      />
    ) : activePage === "schedule" && activeProject ? (
      <TeamSchedule
        isSidebarOpen={isSidebarOpen}
        project={activeProject}
        token={token}
      />
    ) : activePage === "channels" &&
      activeOrganizationId &&
      token ? (
      <ChannelsWithCatalog
        activeChannelId={desktopActiveChannelId}
        channelInboxSyncSignal={channelInboxSyncSignal}
        key={`desktop-channels:${activeOrganizationId}`}
        onChannelFallback={(channelId) =>
          handleDesktopChannelFallback(channelId, "channels")
        }
        onChannelSelect={(channelId) => {
          if (channelId) navigateToChannel(channelId, "channels");
          else {
            selectChannel(null);
            navigateToPage("channels");
          }
        }}
        onSkillSessionAccepted={agentSessions.adoptRemoteSession}
        onCreateAgent={() => {
          setSettingsTarget({
            scope: "organization",
            organizationId: activeOrganizationId!,
            section: "agents",
          });
          setIsSidebarOpen(true);
          navigateToPage("settings");
        }}
        onIssueCreated={async (projectId, runId) => {
          await ensureTeamSelected(projectId);
          setRequestedRunId(runId);
          navigateToIssue(runId, projectId);
        }}
      />

    ) : (
      <HuntDashboardWithTeam
        agents={activeProjectAgents}
        conversationInboxSyncSignal={conversationInboxSyncSignal}
        error={quickProcessError ?? error}
        isIssueDialogOpen={isIssueDialogOpen}
        createIssueDefaultProjectId={createIssueProjectId}
        noProject={!activeProject}
        requestedRunId={requestedRunId}
        requestedRunMessageId={requestedRunMessageId}
        requestedRunInitialTab={requestedRunInitialTab}
        selectedRunId={selectedRunId}
        issueListRequestKey={issueListRequestKey}
        isSidebarOpen={isSidebarOpen}
        onAddProject={startTeamCreation}
        onIssueDialogOpenChange={(isOpen) => {
          if (!isOpen) setCreateIssueProjectId(null);
          setIsIssueDialogOpen(isOpen);
        }}
        onIssueViewed={inbox.markIssueRead}
        onViewingIssueConversationChange={setViewingIssueConversationRunId}
        onSelectedRunChange={(runId) => {
          if (runId) navigateToIssue(runId);
          else navigateToPage("issues");
        }}
        onDeleteIssue={async (runId) => {
          await removeIssue(runId);
          if (runId === selectedRunId && navigationProjectId) {
            replaceNavigationLocation(
              projectNavigationLocation("issues", navigationProjectId),
            );
          }
        }}
        onTransferIssue={async (runId, targetProjectId) => {
          await transferIssue(runId, targetProjectId);
          if (runId === selectedRunId && navigationProjectId) {
            replaceNavigationLocation(
              projectNavigationLocation("issues", navigationProjectId),
            );
          }
        }}
        onRelatedMessageOpen={(relatedMessage) => {
          setPendingBriarLink({ kind: "channel", ...relatedMessage });
        }}
        onProcessIssueNow={processIssueNow}
        onRequestedRunOpen={() => {
          setRequestedRunId(null);
          setRequestedRunMessageId(null);
          setRequestedRunInitialTab(null);
        }}
        onSendIssueMessage={addIssueMessage}
        projects={activeOrganizationProjects}
      />
      )}
    </Suspense>
    </div>
  );
}
