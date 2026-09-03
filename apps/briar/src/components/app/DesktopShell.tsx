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
import { isDesktopTauri } from "../../lib/platform";
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
import { useOrganizationActions } from "../../state/organization/actions";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { tokenAtom } from "../../state/session/atoms";
import { useTeamActions } from "../../state/team/actions";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";

/*
  The desktop shell: window chrome, the sidebar, the page slot and the status
  bar.

  It was the `else` branch of `App.tsx`'s gate chain, which is why the shell had
  to hold every value any page might want. The pages read the store themselves
  now, so what arrives here is what the app still owns: the inbox, the auto hunt
  sessions, the agent list, and the few session calls that have no store
  equivalent yet — and every one of them is passed straight through to the page
  slot.

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
  const { agents, autoHunt, inbox, repositorySetup, session } = pages;
  const runsOnDesktopTauri = isDesktopTauri();
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
  const { startTeamCreation } = useTeamActions();

  return (
    <div className="desktop-app-frame">
      <div className="app-shell">
        <WindowNavigationControlsWithHistory />
        <SidebarWithSession
          agents={agents.all}
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
            session.selectTeam(teamId);
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
            session.selectTeam(projectId);
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
            session.selectTeam(projectId);
            setSettingsTarget({
              scope: "project",
              projectId,
              section: "general",
            });
            navigateToPage("settings");
          }}
          onSettings={openAppSettings}
          onLogout={() => void session.logout()}
          sessions={autoHunt.sessions}
          unreadInboxCount={inbox.unreadCount}
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
          onRefresh={() => session.refresh("snapshot")}
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
