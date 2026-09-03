import { useAtomValue } from "@effect/atom-react";

import {
  companionMode,
  demoMode,
  remoteMode,
  webMode,
} from "../state/platform";
import { useOrganizationActions } from "../state/organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { useSessionActions } from "../state/session/actions";
import {
  loadingAtom,
  restoringSessionAtom,
  tokenAtom,
  userAtom,
} from "../state/session/atoms";
import { useSyncActions } from "../state/sync/actions";
import { useTeamActions } from "../state/team/actions";
import {
  activeTeamIdAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../state/team/atoms";
import { useWorkspaceActions } from "../state/workspace/actions";

/*
  What is left of the facade.

  Everything it used to own — the session bootstrap, the login flows, team
  selection, the refetch, the planning project load and the action bridges —
  lives in `state/` now, and every view but `App.tsx` reads those modules
  directly. This is the last adapter: it re-reads the atoms and re-exports the
  actions under the names `App.tsx` still uses, and goes away with them.
*/
export function useBriar() {
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const loading = useAtomValue(loadingAtom);
  const restoringSession = useAtomValue(restoringSessionAtom);
  const projects = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeProjectId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const isCreatingProject = useAtomValue(isCreatingTeamAtom);
  const projectConnection = useAtomValue(teamConnectionAtom);

  const {
    acceptInvitation,
    cancelLogin,
    deleteAccount,
    login,
    logout,
    sendLoginEmailCode,
    updateAccountProfile,
    verifyLoginEmailCode,
  } = useSessionActions();
  const { selectOrganization } = useOrganizationActions();
  const {
    cancelTeamCreation,
    ensureTeamSelected,
    finishTeamCreation,
    selectTeam,
    startTeamCreation,
  } = useTeamActions();
  const { refreshActiveTeam } = useSyncActions();
  const { reconnectProject } = useWorkspaceActions();

  return {
    acceptInvitation,
    activeOrganizationId,
    activeProjectId,
    cancelLogin,
    cancelProjectCreation: cancelTeamCreation,
    companionMode,
    deleteAccount,
    demoMode,
    ensureProjectSelected: ensureTeamSelected,
    finishProjectCreation: finishTeamCreation,
    isCreatingProject,
    loading,
    login,
    logout,
    organizations,
    projectConnection,
    projects,
    reconnectProject,
    refresh: refreshActiveTeam,
    remoteMode,
    restoringSession,
    sendLoginEmailCode,
    setActiveOrganizationId: selectOrganization,
    setActiveProjectId: selectTeam,
    startProjectCreation: startTeamCreation,
    token,
    updateAccountProfile,
    user,
    verifyLoginEmailCode,
    webMode,
  };
}
