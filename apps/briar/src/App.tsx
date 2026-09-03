import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { keyboardShortcutsModifierLabel } from "./components/app/AppDialogViews";
import { AppDialogs } from "./components/app/AppDialogs";
import { AppEffects } from "./components/app/AppEffects";
import { AuthGate } from "./components/app/AuthGate";
import { CompanionShell } from "./components/app/CompanionShell";
import { DesktopShell } from "./components/app/DesktopShell";
import { InboxBridge } from "./components/app/InboxBridge";
import { loadProjectMergeActivity } from "./lib/app-rpc/github";
import { useOrganizationViewData } from "./hooks/useOrganizationViewData";
import { useAutoHuntSessions } from "./hooks/useAutoHuntSessions";
import { useAgentDispatch } from "./hooks/useAgentDispatch";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { useInvitationFlow } from "./hooks/useInvitationFlow";
import { useIssueAgents } from "./hooks/useIssueAgents";
import { useLaunchIntro } from "./hooks/useLaunchIntro";
import { useRepositorySetup } from "./hooks/useRepositorySetup";
import {
  hasCompletedInitialOnboarding,
  markInitialOnboardingComplete,
} from "./lib/initial-onboarding";
import { loadKeybindings } from "./lib/keybindings";
import {
  commandPaletteInitialQueryAtom,
  isCommandPaletteOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isNavigationHistoryOpenAtom,
} from "./state/dialogs/atoms";
import { useNavigationActions } from "./state/navigation/actions";
import {
  requestedRunIdAtom,
  requestedSessionIdAtom,
} from "./state/navigation/atoms";
import { useActionBridges } from "./state/action-bridges";
import { companionMode, lockedTeamId, remoteMode } from "./state/platform";
import { useOrganizationActions } from "./state/organization/actions";
import { organizationsAtom } from "./state/organization/atoms";
import { useTeamActions } from "./state/team/actions";
import {
  activeTeamAtom,
  isCreatingTeamAtom,
  teamConnectionAtom,
  teamsAtom,
} from "./state/team/atoms";
import { tokenAtom, userAtom } from "./state/session/atoms";
import {
  clearFirstRunTutorialPending,
  hasPendingFirstRunTutorial,
  markFirstRunTutorialPending,
  shouldShowFirstOrganizationSetup as resolveShouldShowFirstOrganizationSetup,
} from "./lib/team-onboarding";
import { openTeamWindow } from "./lib/team-window";
import type { AppZoomCommands } from "./lib/app-zoom";

/*
  What is left of the app shell.

  Every screen reads the store, every write goes through a `state/` action, and
  every domain effect is mounted by `AppEffects`. `App` decides three things and
  nothing else: which gates stand between a cold start and the shell, which
  shell that is, and what the dialogs above both of them are showing.

  It deliberately subscribes to no run and no channel. The inbox, which does
  need the open board, lives in `InboxBridge` below — so a polling tick that
  changes one run commits that run's subscribers and this component is not one
  of them.
*/

export function App({
  appZoomCommands = null,
}: {
  readonly appZoomCommands?: AppZoomCommands | null;
}) {
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const teams = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  // The store says `null` for "no team selected"; the views that take it as a
  // prop have always spelled that `undefined`.
  const activeTeam = useAtomValue(activeTeamAtom) ?? undefined;
  const isCreatingTeam = useAtomValue(isCreatingTeamAtom);
  const teamConnection = useAtomValue(teamConnectionAtom);

  const autoHunt = useAutoHuntSessions();
  /*
    The callbacks the registry-bound actions reach back into
    `useAutoHuntSessions` for: adopting a session an agent proposed, and the
    three a claimed scheduled run goes through.
  */
  useActionBridges({
    adoptRemoteAgentSession: autoHunt.adoptRemoteSession,
    startScheduledAgentSession: (run) =>
      autoHunt.startTaskSession(run.teamId, run.agent.id, {
        agentName: run.agent.name,
        request: run.scheduleName,
        startedAt: run.startedAt,
        trigger: "scheduled",
        scheduleId: run.scheduleId,
        scheduleRunId: run.id,
      }),
    settleScheduledAgentSession: autoHunt.settleTaskSession,
    startScheduledAgentWorkerDispatch: (
      parentSessionId,
      run,
      runs,
      dispatch,
    ) => autoHunt.startWorkerDispatchSession(
      run.teamId,
      run.agent,
      runs,
      {
        ...dispatch,
        parentSessionId,
        startedAt: run.startedAt,
      },
    ),
  });

  const { cancelTeamCreation, finishTeamCreation, startTeamCreation } =
    useTeamActions();
  const { selectOrganization } = useOrganizationActions();
  const { openAppSettings, resetNavigation } = useNavigationActions();
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);

  const {
    loadOrganizationTeamDashboard,
    loadTeamHomeUsage,
    loadUsageReport,
    openOrganizationIssue,
  } = useOrganizationViewData();
  const loadTeamHomeMerges = useCallback(
    (teamId: string, signal: AbortSignal) => {
      if (!token) {
        return Promise.reject(new Error("Sign in to load merge activity"));
      }
      return loadProjectMergeActivity(token, teamId, signal);
    },
    [token],
  );

  useEffect(() => {
    autoHunt.configureSync(
      token,
      teams.map((team) => ({
        id: team.id,
        organizationId: team.organizationId,
      })),
    );
  }, [autoHunt.configureSync, teams, token]);

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    hasCompletedInitialOnboarding,
  );
  const [pendingFirstRunTutorialUserId, setPendingFirstRunTutorialUserId] =
    useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useAtom(
    isCommandPaletteOpenAtom,
  );
  const setIsNavigationHistoryOpen = useAtomSet(isNavigationHistoryOpenAtom);
  const setCommandPaletteInitialQuery = useAtomSet(
    commandPaletteInitialQueryAtom,
  );
  const isKeyboardShortcutsOpen = useAtomValue(isKeyboardShortcutsOpenAtom);

  useDeepLinks();
  const {
    beginTeamReconnect,
    clearTrigger: clearRepositorySetupTrigger,
    closeRepositorySetup,
    openTeamRepository,
    repositorySetupTeamId,
    restoreTrigger: restoreRepositorySetupTrigger,
  } = useRepositorySetup();
  const invitation = useInvitationFlow({
    onInitialOnboardingComplete: () => setHasCompletedOnboarding(true),
  });
  const openTeamInNewWindow = useCallback(
    async (teamId: string) => {
      const team = teams.find((candidate) => candidate.id === teamId);
      if (!team) throw new Error("Project is no longer available.");
      await openTeamWindow(team);
    },
    [teams],
  );
  const {
    activeTeamAgents,
    agents: issueAgents,
    processingIssueIds,
    rememberAgent: rememberIssueAgent,
  } = useIssueAgents({ activeTeam, sessions: autoHunt.sessions });
  const shouldShowInitialOnboarding =
    !remoteMode &&
    !hasCompletedOnboarding &&
    !invitation.hasCurrentUserInvitationProgress;
  const shouldShowFirstOrganizationSetup =
    resolveShouldShowFirstOrganizationSetup({
      hasUser: user !== null,
      organizationCount: organizations.length,
      projectCount: teams.length,
      remoteMode,
    });
  const shouldShowFirstRunTutorial = Boolean(
    !remoteMode &&
      user &&
      organizations.length > 0 &&
      !isCreatingTeam &&
      !teamConnection &&
      !invitation.invitationToken &&
      !invitation.hasCurrentUserInvitationProgress &&
      (pendingFirstRunTutorialUserId === user.id ||
        hasPendingFirstRunTutorial(user.id)),
  );
  const { startAgentAutoHunt, startTeamAgentTask } = useAgentDispatch({
    activeTeam,
    rememberAgent: rememberIssueAgent,
    sessions: autoHunt,
    teamWindowTeamId: lockedTeamId,
  });

  const {
    completeLaunchIntro,
    isLaunchIntroVisible,
    previewsLaunchIntro,
  } = useLaunchIntro({
    companionMode,
    showsInitialOnboarding: shouldShowInitialOnboarding,
    teamWindowTeamId: lockedTeamId,
  });

  const commandPaletteAvailable = Boolean(
    user &&
      !companionMode &&
      !isCreatingTeam &&
      !teamConnection &&
      !invitation.invitationToken &&
      !shouldShowInitialOnboarding &&
      !shouldShowFirstOrganizationSetup &&
      !shouldShowFirstRunTutorial &&
      !isLaunchIntroVisible
  );

  useEffect(() => {
    if (!commandPaletteAvailable || isCommandPaletteOpen || isKeyboardShortcutsOpen) {
      setIsNavigationHistoryOpen(false);
    }
  }, [
    commandPaletteAvailable,
    isCommandPaletteOpen,
    isKeyboardShortcutsOpen,
  ]);

  const configuredKeybindings = loadKeybindings();
  const openCommandPalette = useCallback((initialQuery = "") => {
    setCommandPaletteInitialQuery(initialQuery);
    setIsCommandPaletteOpen(true);
  }, []);
  const handleCommandPaletteOpenChange = useCallback((open: boolean) => {
    setIsCommandPaletteOpen(open);
    if (!open) setCommandPaletteInitialQuery("");
  }, []);
  const closeCommandPalette = useCallback(
    () => handleCommandPaletteOpenChange(false),
    [handleCommandPaletteOpenChange],
  );

  useAppShortcuts({
    appZoomCommands,
    closeCommandPalette,
    commandPaletteAvailable,
    openCommandPalette,
  });

  const commandPaletteItems = useCommandPaletteItems({
    commandPaletteAvailable,
    keybindings: configuredKeybindings,
    keyboardShortcutsShortcut: keyboardShortcutsModifierLabel(),
    sessions: autoHunt.sessions,
  });

  const shell = companionMode ? (
    <CompanionShell
      activeTeam={activeTeam}
      agents={activeTeamAgents}
      loadTeamHomeUsage={loadTeamHomeUsage}
      processingIssueIds={processingIssueIds}
      sessions={{
        adoptRemoteSession: autoHunt.adoptRemoteSession,
        list: autoHunt.sessions,
        stopSession: autoHunt.stopSession,
      }}
    />
  ) : (
    <DesktopShell
      activeProject={activeTeam}
      agents={{
        activeTeamAgents,
        all: issueAgents,
        processingIssueIds,
        rememberAgent: rememberIssueAgent,
      }}
      autoHunt={{
        adoptRemoteSession: autoHunt.adoptRemoteSession,
        removeProjectSessions: autoHunt.removeProjectSessions,
        sessions: autoHunt.sessions,
        settleTaskSession: autoHunt.settleTaskSession,
        startTaskSession: autoHunt.startTaskSession,
        stopSession: autoHunt.stopSession,
      }}
      loadOrganizationProjectDashboard={loadOrganizationTeamDashboard}
      loadProjectHomeMerges={loadTeamHomeMerges}
      loadProjectHomeUsage={loadTeamHomeUsage}
      loadUsageReport={loadUsageReport}
      openOrganizationIssue={openOrganizationIssue}
      openProjectInNewWindow={openTeamInNewWindow}
      repositorySetup={{
        beginTeamReconnect,
        closeRepositorySetup,
        openTeamRepository,
        repositorySetupTeamId,
      }}
      startAgentAutoHunt={startAgentAutoHunt}
      startProjectAgentTask={startTeamAgentTask}
    />
  );

  return (
    <>
      <AppEffects />
      <InboxBridge
        reconcileWorkerDispatches={autoHunt.reconcileWorkerDispatches}
        sessions={autoHunt.sessions}
      />
      <AuthGate
        acceptingInvitation={invitation.acceptingInvitation}
        invitationToken={invitation.invitationToken}
        onAcceptInvitation={invitation.acceptCurrentInvitation}
        onInitialOnboardingComplete={() => {
          markInitialOnboardingComplete();
          setHasCompletedOnboarding(true);
        }}
        onJoinOrganization={invitation.beginInvitation}
        onOrganizationCreated={(userId) => {
          markFirstRunTutorialPending(userId);
          setPendingFirstRunTutorialUserId(userId);
          resetNavigation("lobby");
        }}
        showsFirstOrganizationSetup={shouldShowFirstOrganizationSetup}
        showsInitialOnboarding={shouldShowInitialOnboarding}
      >
        {shell}
      </AuthGate>
      <AppDialogs
        commandPaletteAvailable={commandPaletteAvailable}
        commandPaletteItems={commandPaletteItems}
        firstRunTutorial={{
          collaborator: invitation.showsCollaboratorTutorial,
          onCollaboratorComplete: () => {
            if (invitation.showsCollaboratorTutorial) {
              invitation.clearInvitationProgress();
              resetNavigation("lobby");
              return;
            }
            if (!user) return;
            clearFirstRunTutorialPending(user.id);
            setPendingFirstRunTutorialUserId(null);
            resetNavigation("lobby");
          },
          onDeveloperSelect: () => {
            if (!user) return;
            clearFirstRunTutorialPending(user.id);
            setPendingFirstRunTutorialUserId(null);
            invitation.setDeveloperToolsSetupRequested(true);
            startTeamCreation();
          },
          open:
            shouldShowFirstRunTutorial || invitation.showsCollaboratorTutorial,
        }}
        launchIntro={{
          onComplete: completeLaunchIntro,
          preview: previewsLaunchIntro,
          visible: isLaunchIntroVisible,
        }}
        teamOnboarding={{
          includeDeveloperTools: invitation.developerToolsSetupRequested,
          onCancel: () => {
            if (invitation.invitationProgress?.nextStep === "developer") {
              invitation.clearInvitationProgress();
              invitation.clearDeveloperSetupRequest();
            }
            invitation.setDeveloperToolsSetupRequested(false);
            cancelTeamCreation();
            restoreRepositorySetupTrigger();
          },
          onFinish: () => {
            if (invitation.invitationProgress?.nextStep === "developer") {
              invitation.clearInvitationProgress();
              invitation.clearDeveloperSetupRequest();
            }
            clearRepositorySetupTrigger();
            invitation.setDeveloperToolsSetupRequested(false);
            finishTeamCreation();
            setRequestedRunId(null);
            setRequestedSessionId(null);
            resetNavigation("lobby");
          },
          requireDeveloperAgent:
            invitation.invitationProgress?.nextStep === "developer",
          startWithDeveloperTools: Boolean(
            invitation.invitationProgress?.nextStep === "developer" &&
              invitation.invitationProgress.initialProjectId ===
                teamConnection?.project.id,
          ),
        }}
      />
    </>
  );
}
