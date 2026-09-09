import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps, ReactNode } from "react";

import { agentSessionsAtom } from "../../state/agent-sessions/atoms";
import {
  activePlanningProjectIdAtom,
  isSidebarOpenAtom,
} from "../../state/dialogs/atoms";
import {
  channelSidebarSectionsAtom,
  channelsLoadingAtom,
  directMessageComposeAtom,
  organizationDirectMessagesAtom,
  visibleWorkspaceChannelsAtom,
} from "../../state/channels/atoms";
import { activeWorkspaceIdAtom, workspacesAtom } from "../../state/workspace/atoms";
import {
  activePageAtom,
  desktopActiveChannelIdAtom,
} from "../../state/navigation/atoms";
import { planningProjectsAtom } from "../../state/planning/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { activeTeamIdAtom, visibleTeamsAtom } from "../../state/team/atoms";
import {
  connectedTeamIdsAtom,
  teamReadinessErrorRecordAtom,
  teamReadinessRecordAtom,
} from "../../state/local-workspace/atoms";
import type {
  Workspace,
  PlanningProject,
  SessionUser,
} from "../../types";
import { Sidebar } from "../Sidebar";

export interface SidebarSessionState {
  readonly activeWorkspaceId: string | null;
  readonly activeProjectId: string | null;
  readonly workspaces: Workspace[];
  readonly planningProjects: PlanningProject[];
  readonly token: string | null;
  readonly user: SessionUser | null;
}

/**
 * Subscribes to the session, workspace, team and planning atoms the sidebar
 * renders from. Only this component re-renders when one of them changes, so
 * adding a workspace or a planning project no longer re-renders the app
 * shell that owns the sidebar's callbacks.
 */
export function SidebarSessionBoundary({
  children,
}: {
  children: (session: SidebarSessionState) => ReactNode;
}) {
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const activeProjectId = useAtomValue(activeTeamIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const planningProjects = useAtomValue(planningProjectsAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  return children({
    activeWorkspaceId,
    activeProjectId,
    workspaces,
    planningProjects,
    token,
    user,
  });
}

/**
 * `Sidebar` wired to the store. Everything it lists — the teams this window may
 * show, the channels of the active workspace, where the user is, what this
 * device knows about each repository, the agent sessions running on each team —
 * comes from atoms; the shell keeps only the callbacks that navigate.
 *
 * The settings pages bring their own navigation column, so the sidebar takes
 * itself off screen there rather than making the shell branch on the page.
 */
export function SidebarWithSession(
  props: Omit<
    ComponentProps<typeof Sidebar>,
    | keyof SidebarSessionState
    | "activeChannelId"
    | "activePage"
    | "activePlanningProjectId"
    | "channels"
    | "channelsLoading"
    | "connectedTeamIds"
    | "directMessages"
    | "directMessageSections"
    | "isComposingDirectMessage"
    | "isOpen"
    | "projectReadiness"
    | "projectReadinessError"
    | "projectWindowProjectId"
    | "projects"
    | "sessions"
    | "unreadDmCount"
  >,
) {
  const activeChannelId = useAtomValue(desktopActiveChannelIdAtom);
  const activePage = useAtomValue(activePageAtom);
  const activePlanningProjectId = useAtomValue(activePlanningProjectIdAtom);
  const channels = useAtomValue(visibleWorkspaceChannelsAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const directMessages = useAtomValue(organizationDirectMessagesAtom);
  const directMessageSections = useAtomValue(channelSidebarSectionsAtom);
  const isComposingDirectMessage = useAtomValue(directMessageComposeAtom);
  const isOpen = useAtomValue(isSidebarOpenAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const projectReadiness = useAtomValue(teamReadinessRecordAtom);
  const projectReadinessError = useAtomValue(teamReadinessErrorRecordAtom);
  const projects = useAtomValue(visibleTeamsAtom);
  const sessions = useAtomValue(agentSessionsAtom);
  if (activePage === "settings") return null;
  return (
    <SidebarSessionBoundary>
      {({ user, ...session }) =>
        // The sidebar only exists for a signed-in account, which is also the
        // only branch App renders it from.
        user ? (
          <Sidebar
            {...props}
            {...session}
            activeChannelId={activeChannelId}
            activePage={activePage}
            activePlanningProjectId={activePlanningProjectId}
            channels={channels}
            channelsLoading={channelsLoading}
            connectedTeamIds={connectedTeamIds}
            directMessages={directMessages}
            directMessageSections={directMessageSections}
            isComposingDirectMessage={isComposingDirectMessage}
            isOpen={isOpen}
            projectReadiness={projectReadiness}
            projectReadinessError={projectReadinessError}
            sessions={sessions}
            projectWindowProjectId={lockedTeamId}
            projects={projects}
            unreadDmCount={
              directMessages.filter((channel) => channel.hasUnread).length
            }
            user={user}
          />
        ) : null}
    </SidebarSessionBoundary>
  );
}
