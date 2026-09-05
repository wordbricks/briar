import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps, ReactNode } from "react";

import { agentSessionsAtom } from "../../state/agent-sessions/atoms";
import {
  activePlanningProjectIdAtom,
  isSidebarOpenAtom,
} from "../../state/dialogs/atoms";
import {
  channelsLoadingAtom,
  directMessageComposeAtom,
  organizationDirectMessagesAtom,
  visibleOrganizationChannelsAtom,
} from "../../state/channels/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
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
} from "../../state/workspace/atoms";
import type {
  Organization,
  PlanningProject,
  SessionUser,
} from "../../types";
import { Sidebar } from "../Sidebar";

export interface SidebarSessionState {
  readonly activeOrganizationId: string | null;
  readonly activeProjectId: string | null;
  readonly organizations: Organization[];
  readonly planningProjects: PlanningProject[];
  readonly token: string | null;
  readonly user: SessionUser | null;
}

/**
 * Subscribes to the session, organization, team and planning atoms the sidebar
 * renders from. Only this component re-renders when one of them changes, so
 * adding an organization or a planning project no longer re-renders the app
 * shell that owns the sidebar's callbacks.
 */
export function SidebarSessionBoundary({
  children,
}: {
  children: (session: SidebarSessionState) => ReactNode;
}) {
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeProjectId = useAtomValue(activeTeamIdAtom);
  const organizations = useAtomValue(organizationsAtom);
  const planningProjects = useAtomValue(planningProjectsAtom);
  const token = useAtomValue(tokenAtom);
  const user = useAtomValue(userAtom);
  return children({
    activeOrganizationId,
    activeProjectId,
    organizations,
    planningProjects,
    token,
    user,
  });
}

/**
 * `Sidebar` wired to the store. Everything it lists — the teams this window may
 * show, the channels of the active organization, where the user is, what this
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
  const channels = useAtomValue(visibleOrganizationChannelsAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const connectedTeamIds = useAtomValue(connectedTeamIdsAtom);
  const directMessages = useAtomValue(organizationDirectMessagesAtom);
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
