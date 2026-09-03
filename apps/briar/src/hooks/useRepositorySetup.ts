import { useAtom, useAtomSet } from "@effect/atom-react";
import { useCallback, useRef } from "react";

import {
  localTeamConnectionState,
  teamRepositoryDestination,
} from "../lib/local-team-connection";
import { repositorySetupTeamIdAtom } from "../state/dialogs/atoms";
import { settingsTargetAtom } from "../state/navigation/atoms";
import { remoteMode } from "../state/platform";
import { useRegistry } from "../state/registry";
import { teamsAtom } from "../state/team/atoms";
import { useWorkspaceActions } from "../state/workspace/actions";
import {
  connectedTeamIdsAtom,
  teamReadinessAtom,
} from "../state/workspace/atoms";
import type { ActivePage } from "../lib/app-navigation";
import type { ReconnectOutcome } from "../state/workspace/actions";

/*
  Opening a team's repository, and putting the keyboard back where it was.

  Both entry points — the sidebar's "open repository" and the status bar's
  reconnect — may end in a dialog, in a native folder picker, or in the team's
  settings page. Whichever it is, focus has to return to the control that
  started it, so the element is captured before the trip and restored after it.
  The request counter drops a restore whose trip was superseded.
*/

export interface RepositorySetupInput {
  /** Navigating to the settings page, still the shell's. */
  readonly navigateToPage: (page: ActivePage, teamId?: string | null) => void;
  /** Selecting a team, still the session facade's. */
  readonly selectTeam: (teamId: string) => void;
  /** Reconnecting a team's checkout, from the workspace store. */
  readonly reconnectTeam: (teamId: string) => Promise<ReconnectOutcome>;
}

export interface RepositorySetup {
  /** The team whose repository setup dialog is open, or `null`. */
  readonly repositorySetupTeamId: string | null;
  /** Closes the dialog and returns focus to whatever opened it. */
  readonly closeRepositorySetup: () => void;
  /** Reconnects a team's checkout, remembering focus unless told otherwise. */
  readonly beginTeamReconnect: (
    teamId: string,
    rememberTrigger?: boolean,
  ) => void;
  /** Routes to the repository dialog or to the team's settings. */
  readonly openTeamRepository: (teamId: string) => void;
  /** Forgets the captured element, for a flow that ends somewhere else. */
  readonly clearTrigger: () => void;
  /** Returns focus to the captured element on the next frame. */
  readonly restoreTrigger: () => void;
}

export function useRepositorySetup({
  navigateToPage,
  reconnectTeam,
  selectTeam,
}: RepositorySetupInput): RepositorySetup {
  const registry = useRegistry();
  const [repositorySetupTeamId, setRepositorySetupTeamId] = useAtom(
    repositorySetupTeamIdAtom,
  );
  const setSettingsTarget = useAtomSet(settingsTargetAtom);
  const { refreshProjectReadiness } = useWorkspaceActions();
  const triggerRef = useRef<HTMLElement | null>(null);
  const reconnectRequestRef = useRef(0);

  const rememberTrigger = useCallback(() => {
    const activeElement = document.activeElement;
    triggerRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
  }, []);

  const restoreTrigger = useCallback(() => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }, []);

  const clearTrigger = useCallback(() => {
    triggerRef.current = null;
  }, []);

  const beginTeamReconnect = useCallback(
    (teamId: string, shouldRememberTrigger = true) => {
      const request = ++reconnectRequestRef.current;
      if (shouldRememberTrigger) rememberTrigger();
      const trigger = triggerRef.current;
      void reconnectTeam(teamId).then((outcome) => {
        if (
          request !== reconnectRequestRef.current ||
          triggerRef.current !== trigger
        ) {
          return;
        }
        if (outcome === "opened") return;
        triggerRef.current = null;
        if (outcome !== "failed") return;
        const activeElement = document.activeElement;
        if (
          trigger?.isConnected &&
          (activeElement === trigger || activeElement === document.body)
        ) {
          trigger.focus();
        }
      });
    },
    [reconnectTeam, rememberTrigger],
  );

  const openTeamRepository = useCallback((teamId: string) => {
    if (!registry.get(teamsAtom).some((team) => team.id === teamId)) return;

    // Read at call time: the inventory and the probe are the workspace store's,
    // and depending on them here rebuilt this callback on every probe.
    const connectionState = localTeamConnectionState(
      registry.get(connectedTeamIdsAtom),
      teamId,
    );
    const readiness = registry.get(teamReadinessAtom(teamId)).readiness;
    const destination = teamRepositoryDestination({
      connectionState,
      readiness,
      requiresLocalReadiness: !remoteMode,
    });

    setRepositorySetupTeamId(null);
    selectTeam(teamId);
    if (destination === "settings") {
      triggerRef.current = null;
      setSettingsTarget({
        scope: "project",
        projectId: teamId,
        section: "general",
      });
      navigateToPage("settings", teamId);
      return;
    }

    rememberTrigger();
    setRepositorySetupTeamId(teamId);
    void refreshProjectReadiness(teamId);
  }, [
    refreshProjectReadiness,
    registry,
    rememberTrigger,
    navigateToPage,
    selectTeam,
  ]);

  const closeRepositorySetup = useCallback(() => {
    setRepositorySetupTeamId(null);
    restoreTrigger();
  }, [restoreTrigger]);

  return {
    beginTeamReconnect,
    clearTrigger,
    closeRepositorySetup,
    openTeamRepository,
    repositorySetupTeamId,
    restoreTrigger,
  };
}
