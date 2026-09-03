import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps, ReactNode } from "react";

import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { planningProjectsAtom } from "../../state/planning/atoms";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { activeTeamIdAtom } from "../../state/team/atoms";
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
 * `Sidebar` wired to the root atoms. `projects` stays a prop: a project window
 * renders a filtered list the sidebar must not widen back to every team.
 */
export function SidebarWithSession(
  props: Omit<ComponentProps<typeof Sidebar>, keyof SidebarSessionState>,
) {
  return (
    <SidebarSessionBoundary>
      {({ user, ...session }) =>
        // The sidebar only exists for a signed-in account, which is also the
        // only branch App renders it from.
        user ? <Sidebar {...props} {...session} user={user} /> : null}
    </SidebarSessionBoundary>
  );
}
