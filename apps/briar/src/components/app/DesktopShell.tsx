import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { AgentUsageStatusBar } from "../AgentUsageStatusBar";
import { AppVersionStatus } from "../AppVersionStatus";
import { DesktopPages, type DesktopPagesProps } from "./DesktopPages";
import { SidebarWithSession } from "./SidebarWithSession";
import { WindowNavigationControlsWithHistory } from "./WindowNavigationControlsWithHistory";
import {
  ConnectionHealthWithWorkspace,
  WorkerStatusBarWithTeam,
} from "./WorkspaceViews";
import { useHorizontalPaneResize } from "../../hooks/useHorizontalPaneResize";
import { isDesktopTauri } from "../../lib/platform";
import {
  clampSidebarWidth,
  loadSidebarWidth,
  saveSidebarWidth,
  sidebarWidthDefault,
  sidebarWidthMax,
  sidebarWidthMin,
} from "../../lib/sidebar-width";
import { useChannelActions } from "../../state/channels/actions";
import {
  activeChannelIdAtom,
  organizationDirectMessagesAtom,
} from "../../state/channels/atoms";
import {
  activePlanningProjectIdAtom,
  createIssueTeamIdAtom,
  isIssueDialogOpenAtom,
  isSidebarOpenAtom,
  planningProjectEditIdAtom,
  planningProjectTeamIdAtom,
} from "../../state/dialogs/atoms";
import { useNavigationActions } from "../../state/navigation/actions";
import {
  agentListRequestKeyAtom,
  issueListRequestKeyAtom,
  requestedRunIdAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "../../state/navigation/atoms";
import { visibleInboxUnreadCountAtom } from "../../state/inbox/atoms";
import { useOrganizationActions } from "../../state/organization/actions";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { useSessionActions } from "../../state/session/actions";
import { tokenAtom } from "../../state/session/atoms";
import { useSyncActions } from "../../state/sync/actions";
import { useTeamActions } from "../../state/team/actions";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";

/*
  The desktop shell: window chrome, the sidebar, the page slot and the status
  bar.

  It was the `else` branch of `App.tsx`'s gate chain, which is why the shell had
  to hold every value any page might want. The pages read the store themselves
  now, so what arrives here is what the app still owns: the agent list and the
  repository setup flow — and both are passed straight through to the page slot.

  Nothing this component reads moves when the user navigates. That is the point:
  a visit commits `DesktopPages` and `SidebarWithSession`, which subscribe to the
  location, and leaves the chrome and the status bar alone.
*/

export interface DesktopShellProps extends DesktopPagesProps {
  readonly openProjectInNewWindow: (teamId: string) => Promise<void>;
}

export function DesktopShell({
  openProjectInNewWindow,
  ...pages
}: DesktopShellProps) {
  const { agents, repositorySetup } = pages;
  const runsOnDesktopTauri = isDesktopTauri();
  const unreadInboxCount = useAtomValue(visibleInboxUnreadCountAtom);
  const token = useAtomValue(tokenAtom);
  const projects = useAtomValue(teamsAtom);
  const activeProjectId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const organizationDirectMessages = useAtomValue(
    organizationDirectMessagesAtom,
  );
  const setIsSidebarOpen = useAtomSet(isSidebarOpenAtom);
  const setSettingsTarget = useAtomSet(settingsTargetAtom);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setAgentListRequestKey = useAtomSet(agentListRequestKeyAtom);
  const setActivePlanningProjectId = useAtomSet(activePlanningProjectIdAtom);
  const setCreateIssueProjectId = useAtomSet(createIssueTeamIdAtom);
  const setIsIssueDialogOpen = useAtomSet(isIssueDialogOpenAtom);
  const setPlanningProjectTeamId = useAtomSet(planningProjectTeamIdAtom);
  const setPlanningProjectEditId = useAtomSet(planningProjectEditIdAtom);
  const { navigateToPage, openAppSettings } = useNavigationActions();
  const {
    createOrganizationChannel,
    deleteOrganizationChannel,
    openOrganizationChannel,
    openOrganizationChannelSettings,
  } = useChannelActions();
  const { selectOrganization } = useOrganizationActions();
  const { selectTeam, startTeamCreation } = useTeamActions();
  const { logout } = useSessionActions();
  const { refreshActiveTeam } = useSyncActions();
  const {
    containerRef: appShellRef,
    effectiveWidth: effectiveSidebarWidth,
    isResizing: isResizingSidebar,
    separatorProps: sidebarResizeProps,
  } = useHorizontalPaneResize({
    clamp: clampSidebarWidth,
    cssVariable: "--sidebar-width",
    defaultWidth: sidebarWidthDefault,
    load: loadSidebarWidth,
    max: sidebarWidthMax,
    min: sidebarWidthMin,
    save: saveSidebarWidth,
    side: "left",
    unit: "px",
  });

  return (
    <div className="desktop-app-frame">
      <div
        className={`app-shell${isResizingSidebar ? " is-resizing-sidebar" : ""}`}
        ref={appShellRef}
      >
        <WindowNavigationControlsWithHistory />
        <SidebarWithSession
          agents={agents.all}
          sidebarResizeProps={sidebarResizeProps}
          sidebarWidth={effectiveSidebarWidth}
          onAddProject={startTeamCreation}
          onAddPlanningProject={(teamId) => {
            setPlanningProjectEditId(null);
            setPlanningProjectTeamId(teamId);
          }}
          onPlanningProjectEdit={(projectId) => {
            setPlanningProjectTeamId(null);
            setPlanningProjectEditId(projectId);
          }}
          onPlanningProjectOpen={(planningProjectId, teamId) => {
            setActivePlanningProjectId(planningProjectId);
            selectTeam(teamId);
            setRequestedRunId(null);
            setIssueListRequestKey((key) => key + 1);
            navigateToPage("issues");
          }}
          onAgentSessionOpen={(sessionId) => {
            setRequestedRunId(null);
            setRequestedSessionId(sessionId);
            navigateToPage("agents");
          }}
          onAgentsOpen={() => {
            setRequestedSessionId(null);
            setAgentListRequestKey((key) => key + 1);
            navigateToPage("agents");
          }}
          onLobbyOpen={() => navigateToPage("lobby")}
          onScheduleOpen={() => navigateToPage("schedule")}
          onInboxOpen={() => navigateToPage("inbox")}
          onMyIssuesOpen={
            activeOrganizationId
              ? () => navigateToPage("my-issues")
              : undefined
          }
          onDmsOpen={() => {
            const directMessage = organizationDirectMessages.find(
              (channel) => channel.id === activeChannelId,
            ) ?? organizationDirectMessages[0];
            if (directMessage) openOrganizationChannel(directMessage.id);
            else navigateToPage("dms");
          }}
          onChannelCreate={
            activeOrganizationId && token
              ? createOrganizationChannel
              : undefined
          }
          onChannelDelete={
            activeOrganizationId && token
              ? deleteOrganizationChannel
              : undefined
          }
          onChannelOpen={activeOrganizationId ? openOrganizationChannel : undefined}
          onChannelSettings={
            activeOrganizationId
              ? openOrganizationChannelSettings
              : undefined
          }
          onIssuesOpen={() => {
            setActivePlanningProjectId(null);
            setRequestedRunId(null);
            setIssueListRequestKey((key) => key + 1);
            navigateToPage("issues");
          }}
          onCreateIssue={(projectId) => {
            setCreateIssueProjectId(projectId);
            navigateToPage("issues");
            setIsIssueDialogOpen(true);
          }}
          onAddOrganization={() => navigateToPage("organization-create")}
          onOrganizationChange={(organizationId) => {
            const project = projects.find(
              (candidate) => candidate.organizationId === organizationId,
            );
            selectOrganization(organizationId);
            setRequestedRunId(null);
            setRequestedSessionId(null);
            navigateToPage("lobby", project?.id ?? null);
          }}
          onProjectChange={(projectId) => {
            setActivePlanningProjectId(null);
            selectTeam(projectId);
            setRequestedRunId(null);
            setRequestedSessionId(null);
          }}
          onProjectOpenInNewWindow={
            runsOnDesktopTauri && !lockedTeamId
              ? openProjectInNewWindow
              : undefined
          }
          onProjectRepositoryOpen={repositorySetup.openTeamRepository}
          onProjectSettings={(projectId) => {
            selectTeam(projectId);
            setSettingsTarget({
              scope: "project",
              projectId,
              section: "general",
            });
            navigateToPage("settings");
          }}
          onSettings={openAppSettings}
          onLogout={() => void logout()}
          unreadInboxCount={unreadInboxCount}
        />
        <DesktopPages {...pages} />
      </div>
      <div className="app-status-bar">
        <AgentUsageStatusBar
          onManageAccounts={() => {
            setSettingsTarget({
              scope: "application",
              section: "providers",
            });
            navigateToPage("settings");
          }}
          onOpenUsageDetails={() => {
            setSettingsTarget({
              scope: "application",
              section: "usage",
            });
            navigateToPage("settings");
          }}
        />
        <WorkerStatusBarWithTeam
          onOpenSettings={() => {
            if (!activeOrganizationId) return;
            setSettingsTarget({
              scope: "organization",
              organizationId: activeOrganizationId,
              section: "workers",
            });
            setIsSidebarOpen(true);
            navigateToPage("settings");
          }}
          onRefresh={() => refreshActiveTeam("snapshot")}
        />
        <AppVersionStatus />
        <ConnectionHealthWithWorkspace
          onReconnect={() => {
            if (activeProjectId) {
              repositorySetup.beginTeamReconnect(activeProjectId);
            }
          }}
        />
      </div>
    </div>
  );
}
