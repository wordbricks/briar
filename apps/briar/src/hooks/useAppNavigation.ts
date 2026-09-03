import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo } from "react";

import { hasOpenKeyboardShortcutOverlay } from "../lib/keyboard-shortcuts";
import {
  type ActivePage,
  type AppNavigationLocation,
  type ChannelNavigationPage,
} from "../lib/app-navigation";
import { setChannelNavigationBridge } from "../state/channels/actions";
import { useNavigationActions } from "../state/navigation/actions";
import {
  activePageAtom,
  activeRunIdAtom,
  activeTeamForTabsAtom,
  canGoBackAtom,
  canGoForwardAtom,
  desktopActiveChannelIdAtom,
  navigationHistoryEntriesAtom,
  navigationHistoryIndexAtom,
  navigationLocationAtom,
  navigationTeamIdAtom,
  navigationUserBoundaryChangedAtom,
} from "../state/navigation/atoms";
import { useNavigationReconciliation } from "../state/navigation/useNavigationReconciliation";
import { companionMode } from "../state/platform";
import { useRegistry } from "../state/registry";
import { useAppKeyboardCommandScope } from "./appKeyboardCommands";
import type { Project } from "../types";

/*
  The shell's view of the navigation, while the shells still take it as props.

  Everything below is now owned by `state/navigation`: the location and its
  derivations are atoms, the callbacks are registry bound actions, and the
  reconciliation is a hook of its own. What is left here is the bundle the
  shells destructure, which the next step removes by having them read the atoms
  they actually use.
*/

export interface AppNavigation {
  readonly activeNavigationLocation: AppNavigationLocation;
  readonly activePage: ActivePage;
  readonly selectedRunId: string | null;
  readonly navigationProjectId: string | null;
  readonly navigationHistoryEntries: readonly AppNavigationLocation[];
  readonly navigationHistoryIndex: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly goToNavigationHistory: (index: number) => void;
  readonly navigateToLocation: (location: AppNavigationLocation) => void;
  readonly replaceNavigationLocation: (location: AppNavigationLocation) => void;
  readonly navigateToPage: (page: ActivePage, teamId?: string | null) => void;
  readonly navigateToIssue: (runId: string, teamId?: string | null) => void;
  readonly navigateToChannel: (
    channelId: string,
    page: ChannelNavigationPage,
    organizationId?: string | null,
    teamId?: string | null,
  ) => void;
  readonly resetNavigation: (page: ActivePage) => void;
  readonly closeSettings: () => void;
  readonly handleDesktopChannelFallback: (
    channelId: string | null,
    page: ChannelNavigationPage,
  ) => void;
  readonly desktopActiveChannelId: string | null;
  readonly activeProjectForTabs: Project | undefined;
  /** True on the render a different account took over the history. */
  readonly navigationUserBoundaryChanged: boolean;
}

export interface AppNavigationInput {
  /** Selecting a team, still the session facade's. */
  readonly selectTeam: (teamId: string) => void;
}

export function useAppNavigation({
  selectTeam,
}: AppNavigationInput): AppNavigation {
  const registry = useRegistry();
  const actions = useNavigationActions();
  const activeNavigationLocation = useAtomValue(navigationLocationAtom);
  const activePage = useAtomValue(activePageAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const navigationProjectId = useAtomValue(navigationTeamIdAtom);
  const navigationHistoryEntries = useAtomValue(navigationHistoryEntriesAtom);
  const navigationHistoryIndex = useAtomValue(navigationHistoryIndexAtom);
  const canGoBack = useAtomValue(canGoBackAtom);
  const canGoForward = useAtomValue(canGoForwardAtom);
  const desktopActiveChannelId = useAtomValue(desktopActiveChannelIdAtom);
  const activeProjectForTabs = useAtomValue(activeTeamForTabsAtom);
  const navigationUserBoundaryChanged = useAtomValue(
    navigationUserBoundaryChangedAtom,
  );

  useNavigationReconciliation({ selectTeam });

  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      closeSettings: {
        isAvailable: () =>
          activePage === "settings" &&
          !companionMode &&
          !hasOpenKeyboardShortcutOverlay(document),
        run: () => {
          actions.closeSettings();
          return "handled";
        },
      },
    },
    id: "settings-page",
    priority: 100,
  });

  /*
    The channel actions navigate, and navigation is a peer domain rather than
    one they may import, so they ask for it through a bridge. Both sides are
    registry bound now, which is why installing it once is enough.
  */
  useEffect(() => {
    setChannelNavigationBridge(registry, {
      navigateToChannel: actions.navigateToChannel,
      navigateToPage: actions.navigateToPage,
    });
  }, [actions, registry]);

  return useMemo(
    () => ({
      activeNavigationLocation,
      activePage,
      activeProjectForTabs,
      canGoBack,
      canGoForward,
      closeSettings: actions.closeSettings,
      desktopActiveChannelId,
      goBack: actions.goBack,
      goForward: actions.goForward,
      goToNavigationHistory: actions.goToNavigationHistory,
      handleDesktopChannelFallback: actions.handleDesktopChannelFallback,
      navigateToChannel: actions.navigateToChannel,
      navigateToIssue: actions.navigateToIssue,
      navigateToLocation: actions.navigateToLocation,
      navigateToPage: actions.navigateToPage,
      navigationHistoryEntries,
      navigationHistoryIndex,
      navigationProjectId,
      navigationUserBoundaryChanged,
      replaceNavigationLocation: actions.replaceNavigationLocation,
      resetNavigation: actions.resetNavigation,
      selectedRunId,
    }),
    [
      actions,
      activeNavigationLocation,
      activePage,
      activeProjectForTabs,
      canGoBack,
      canGoForward,
      desktopActiveChannelId,
      navigationHistoryEntries,
      navigationHistoryIndex,
      navigationProjectId,
      navigationUserBoundaryChanged,
      selectedRunId,
    ],
  );
}
