import { useAtomValue, useAtomSet } from "@effect/atom-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { markInitialOnboardingComplete } from "../lib/initial-onboarding";
import {
  beginOrganizationInvitation,
  clearOrganizationInvitationProgress,
  leaveOrganizationInvitationRoute,
  loadOrganizationInvitationProgress,
  loadOrganizationInvitationToken,
  organizationInvitationProgressFrom,
  storeOrganizationInvitationProgress,
  type OrganizationInvitationProgress,
} from "../lib/organization-invitation";
import {
  createIssueTeamIdAtom,
  isIssueDialogOpenAtom,
} from "../state/dialogs/atoms";
import { useNavigationActions } from "../state/navigation/actions";
import {
  requestedRunIdAtom,
  requestedSessionIdAtom,
} from "../state/navigation/atoms";
import { remoteMode } from "../state/platform";
import { useSessionActions } from "../state/session/actions";
import { userAtom } from "../state/session/atoms";
import {
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../state/team/atoms";
import { useWorkspaceActions } from "../state/workspace/actions";

/*
  Joining an organization from an invitation link, and the setup step that
  follows it.

  The token comes off the URL, the progress marker survives the reload the
  accept triggers, and both are stored per user: a different account signing in
  on the same device must not inherit the previous one's half-finished join.
*/

export interface InvitationFlowInput {
  /** Records that the initial onboarding gate is satisfied. */
  readonly onInitialOnboardingComplete: () => void;
}

export interface InvitationFlow {
  /** The invitation token on the URL, or `null`. */
  readonly invitationToken: string | null;
  /** Starts the join screen for a token pasted into the first-run setup. */
  readonly beginInvitation: (token: string) => void;
  /** Leaves the invitation route without accepting. */
  readonly clearInvitationToken: () => void;
  readonly invitationProgress: OrganizationInvitationProgress | null;
  /** The progress marker belongs to the signed-in user. */
  readonly hasCurrentUserInvitationProgress: boolean;
  /** The collaborator tutorial replaces the first-run one after a join. */
  readonly showsCollaboratorTutorial: boolean;
  /** An accept request is in flight. */
  readonly acceptingInvitation: boolean;
  readonly acceptCurrentInvitation: () => Promise<void>;
  /** Drops the stored progress marker, e.g. when its step was completed. */
  readonly clearInvitationProgress: () => void;
  /** The team creation flow should include the developer tools step. */
  readonly developerToolsSetupRequested: boolean;
  readonly setDeveloperToolsSetupRequested: (requested: boolean) => void;
  /** Forgets which team the developer step was already requested for. */
  readonly clearDeveloperSetupRequest: () => void;
}

export function useInvitationFlow({
  onInitialOnboardingComplete,
}: InvitationFlowInput): InvitationFlow {
  const { acceptInvitation } = useSessionActions();
  const { reconnectProject: reconnectTeam } = useWorkspaceActions();
  const { resetNavigation } = useNavigationActions();
  const user = useAtomValue(userAtom);
  const teams = useAtomValue(teamsAtom);
  const isCreatingTeam = useAtomValue(isCreatingTeamAtom);
  const teamConnection = useAtomValue(teamConnectionAtom);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setCreateIssueTeamId = useAtomSet(createIssueTeamIdAtom);
  const setIsIssueDialogOpen = useAtomSet(isIssueDialogOpenAtom);
  const [invitationToken, setInvitationToken] = useState(
    loadOrganizationInvitationToken,
  );
  const [invitationProgress, setInvitationProgress] = useState(
    loadOrganizationInvitationProgress,
  );
  const [acceptingInvitation, setAcceptingInvitation] = useState(false);
  const [developerToolsSetupRequested, setDeveloperToolsSetupRequested] =
    useState(false);
  const developerSetupRequestRef = useRef<string | null>(null);

  const hasCurrentUserInvitationProgress = Boolean(
    user && invitationProgress?.userId === user.id,
  );
  const showsCollaboratorTutorial = Boolean(
    !remoteMode &&
      hasCurrentUserInvitationProgress &&
      invitationProgress?.nextStep === "collaborator",
  );

  const acceptCurrentInvitation = useCallback(async () => {
    if (!invitationToken || !user) return;
    setAcceptingInvitation(true);
    try {
      const result = await acceptInvitation(invitationToken);
      const progress = organizationInvitationProgressFrom(
        result.invitation,
        user.id,
      );
      storeOrganizationInvitationProgress(progress);
      setInvitationProgress(progress);
      markInitialOnboardingComplete();
      onInitialOnboardingComplete();
      leaveOrganizationInvitationRoute({ preserveProgress: true });
      setInvitationToken(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setCreateIssueTeamId(null);
      setIsIssueDialogOpen(false);
      resetNavigation("lobby");
    } finally {
      setAcceptingInvitation(false);
    }
  }, [
    acceptInvitation,
    onInitialOnboardingComplete,
    user,
    invitationToken,
    resetNavigation,
  ]);

  useEffect(() => {
    if (!user || !invitationProgress || invitationProgress.userId === user.id) {
      return;
    }
    clearOrganizationInvitationProgress();
    developerSetupRequestRef.current = null;
    setInvitationProgress(null);
  }, [user, invitationProgress]);

  useEffect(() => {
    if (
      remoteMode ||
      !user ||
      invitationProgress?.userId !== user.id ||
      invitationProgress?.nextStep !== "developer" ||
      isCreatingTeam ||
      teamConnection ||
      !teams.some((team) => team.id === invitationProgress.initialProjectId)
    ) {
      return;
    }
    const requestKey = `${user.id}:${invitationProgress.initialProjectId}`;
    if (developerSetupRequestRef.current === requestKey) return;
    developerSetupRequestRef.current = requestKey;
    setDeveloperToolsSetupRequested(true);
    void reconnectTeam(invitationProgress.initialProjectId);
  }, [
    isCreatingTeam,
    teamConnection,
    teams,
    reconnectTeam,
    user,
    invitationProgress,
  ]);

  const beginInvitation = useCallback((token: string) => {
    beginOrganizationInvitation(token);
    setInvitationToken(token);
  }, []);

  const clearInvitationToken = useCallback(() => {
    setInvitationToken(null);
  }, []);

  const clearInvitationProgress = useCallback(() => {
    clearOrganizationInvitationProgress();
    setInvitationProgress(null);
  }, []);

  const clearDeveloperSetupRequest = useCallback(() => {
    developerSetupRequestRef.current = null;
  }, []);

  return {
    acceptCurrentInvitation,
    acceptingInvitation,
    beginInvitation,
    clearDeveloperSetupRequest,
    clearInvitationProgress,
    clearInvitationToken,
    developerToolsSetupRequested,
    hasCurrentUserInvitationProgress,
    invitationProgress,
    invitationToken,
    setDeveloperToolsSetupRequested,
    showsCollaboratorTutorial,
  };
}
