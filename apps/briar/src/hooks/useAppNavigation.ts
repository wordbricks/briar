import { useAtom, useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { startDesktopChannelTransition } from "../lib/channel-performance";
import { hasOpenKeyboardShortcutOverlay } from "../lib/keyboard-shortcuts";
import { isTeamScheduleTabEnabled } from "../lib/team-tabs";
import {
  channelIdFromNavigationLocation,
  channelNavigationLocation,
  channelPageNavigationLocation,
  isProjectNavigationPage,
  issueNavigationLocation,
  organizationNavigationLocation,
  organizationIdFromNavigationLocation,
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  projectNavigationLocation,
  runIdFromNavigationLocation,
  settingsNavigationLocation,
  settingsTargetFromNavigationLocation,
  type ActivePage,
  type AppNavigationLocation,
  type ChannelNavigationPage,
} from "../lib/app-navigation";
import {
  setChannelNavigationBridge,
  useChannelActions,
} from "../state/channels/actions";
import {
  activeChannelIdAtom,
  activeOrganizationChannelsAtom,
} from "../state/channels/atoms";
import { settingsTargetAtom } from "../state/navigation/atoms";
import { useOrganizationActions } from "../state/organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { companionMode } from "../state/platform";
import { useRegistry } from "../state/registry";
import { loadingAtom, userAtom } from "../state/session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import { useAppKeyboardCommandScope } from "./appKeyboardCommands";
import { useNavigationHistory } from "./useNavigationHistory";
import type { Project } from "../types";

/*
  Where the app is, and every way it can move.

  This is the block Phase 5 moved out of `App.tsx` unchanged so the shells could
  leave; Phase 6 is what rewrites it. The six effects below reconcile the
  location with the store in a fixed order — settings target, team, team
  existence, organization existence, schedule tab availability — and that order
  is the contract, which is why they moved together and untouched.
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
  readonly setDefaultTeam: (teamId: string | null) => void;
}

export interface AppNavigationInput {
  /** Selecting a team, still the session facade's. */
  readonly selectTeam: (teamId: string) => void;
}

export function useAppNavigation({
  selectTeam,
}: AppNavigationInput): AppNavigation {
  const registry = useRegistry();
  const user = useAtomValue(userAtom);
  const loading = useAtomValue(loadingAtom);
  const teams = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const organizationChannels = useAtomValue(activeOrganizationChannelsAtom);
  const [settingsTarget, setSettingsTarget] = useAtom(settingsTargetAtom);
  const { markOrganizationChannelRead, selectChannel } = useChannelActions();
  const { selectOrganization } = useOrganizationActions();

  const {
    current: activeNavigationLocation,
    entries: navigationHistoryEntries,
    index: navigationHistoryIndex,
    canGoBack,
    canGoForward,
    goBack,
    goBackTo,
    goForward,
    goTo: goToNavigationHistory,
    navigate: navigateToLocation,
    replace: replaceNavigationLocation,
    reset: resetNavigationLocation,
  } = useNavigationHistory<AppNavigationLocation>("lobby");
  const activePage = pageFromNavigationLocation(activeNavigationLocation);
  const selectedRunId = runIdFromNavigationLocation(activeNavigationLocation);
  const navigationProjectId = projectIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationOrganizationId = organizationIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationChannelId = channelIdFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationSettingsTarget = settingsTargetFromNavigationLocation(
    activeNavigationLocation,
  );
  const navigationHasChannelPageContext =
    (activePage === "channels" || activePage === "dms") &&
    navigationOrganizationId !== null;
  const desktopActiveChannelId = navigationHasChannelPageContext
    ? navigationChannelId
    : activeChannelId;
  const navigationActiveProjectIdRef = useRef(activeTeamId);
  navigationActiveProjectIdRef.current = activeTeamId;
  /**
   * Records where the helpers below default their team id from. The shells call
   * it whenever they select a team, so a later `navigateToPage()` with no
   * explicit team lands on the one the user just picked.
   */
  const setDefaultTeam = useCallback((teamId: string | null) => {
    navigationActiveProjectIdRef.current = teamId;
  }, []);
  const navigateToPage = useCallback(
    (
      page: ActivePage,
      projectId = navigationActiveProjectIdRef.current,
    ) =>
      navigateToLocation(
        (page === "inbox" || page === "my-issues") &&
        activeOrganizationId
          ? organizationNavigationLocation(activeOrganizationId, page)
          : (page === "channels" || page === "dms") &&
          activeOrganizationId
          ? channelPageNavigationLocation(
              page,
              activeOrganizationId,
              projectId,
            )
          : projectId && isProjectNavigationPage(page)
            ? projectNavigationLocation(page, projectId)
            : page,
      ),
    [activeOrganizationId, navigateToLocation],
  );
  const closeSettings = useCallback(() => {
    const projectId = navigationActiveProjectIdRef.current;
    goBackTo(
      (location) => pageFromNavigationLocation(location) !== "settings",
      projectId ? projectNavigationLocation("issues", projectId) : "issues",
    );
  }, [goBackTo]);
  useAppKeyboardCommandScope({
    fallthrough: true,
    handlers: {
      closeSettings: {
        isAvailable: () =>
          activePage === "settings" &&
          !companionMode &&
          !hasOpenKeyboardShortcutOverlay(document),
        run: () => {
          closeSettings();
          return "handled";
        },
      },
    },
    id: "settings-page",
    priority: 100,
  });
  const navigateToIssue = useCallback(
    (runId: string, projectId = navigationActiveProjectIdRef.current) => {
      if (!projectId) return;
      navigateToLocation(issueNavigationLocation(projectId, runId));
    },
    [navigateToLocation],
  );
  const navigateToChannel = useCallback(
    (
      channelId: string,
      page: ChannelNavigationPage,
      organizationId = activeOrganizationId,
      projectId = navigationActiveProjectIdRef.current,
    ) => {
      if (!organizationId) return;
      startDesktopChannelTransition(channelId);
      selectChannel(channelId);
      markOrganizationChannelRead(channelId);
      navigateToLocation(
        channelNavigationLocation(
          page,
          organizationId,
          channelId,
          projectId,
        ),
      );
    },
    [
      activeOrganizationId,
      markOrganizationChannelRead,
      navigateToLocation,
      selectChannel,
    ],
  );
  const replaceChannelDestination = useCallback(
    (
      channelId: string | null,
      page: ChannelNavigationPage,
      organizationId = activeOrganizationId,
      projectId = navigationActiveProjectIdRef.current,
    ) => {
      selectChannel(channelId);
      if (!channelId || !organizationId) {
        replaceNavigationLocation(
          organizationId
            ? channelPageNavigationLocation(page, organizationId, projectId)
            : page,
        );
        return;
      }
      startDesktopChannelTransition(channelId);
      markOrganizationChannelRead(channelId);
      replaceNavigationLocation(
        channelNavigationLocation(
          page,
          organizationId,
          channelId,
          projectId,
        ),
      );
    },
    [
      activeOrganizationId,
      markOrganizationChannelRead,
      replaceNavigationLocation,
      selectChannel,
    ],
  );
  const handleDesktopChannelFallback = useCallback(
    (channelId: string | null, page: ChannelNavigationPage) => {
      if (
        navigationChannelId &&
        navigationOrganizationId !== activeOrganizationId
      ) {
        return;
      }
      replaceChannelDestination(
        channelId,
        page,
        navigationOrganizationId ?? activeOrganizationId,
        navigationProjectId ?? navigationActiveProjectIdRef.current,
      );
    },
    [
      activeOrganizationId,
      navigationChannelId,
      navigationOrganizationId,
      navigationProjectId,
      replaceChannelDestination,
    ],
  );
  const resetNavigation = useCallback(
    (page: ActivePage) => resetNavigationLocation(page),
    [resetNavigationLocation],
  );
  const navigationUserIdRef = useRef<string | null | undefined>(undefined);
  const navigationUserId = user?.id ?? null;
  const navigationUserBoundaryChanged =
    navigationUserIdRef.current !== undefined &&
    navigationUserIdRef.current !== navigationUserId;
  useEffect(() => {
    if (navigationUserIdRef.current === undefined) {
      navigationUserIdRef.current = navigationUserId;
      return;
    }
    if (navigationUserIdRef.current === navigationUserId) return;
    navigationUserIdRef.current = navigationUserId;
    resetNavigation("lobby");
  }, [navigationUserId, resetNavigation]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      activePage !== "settings"
    ) {
      return;
    }
    if (navigationSettingsTarget) {
      setSettingsTarget((current) =>
        settingsNavigationLocation(current) === activeNavigationLocation
          ? current
          : navigationSettingsTarget,
      );
      return;
    }
    replaceNavigationLocation(settingsNavigationLocation(settingsTarget));
  }, [
    activeNavigationLocation,
    activePage,
    companionMode,
    navigationSettingsTarget,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
    settingsTarget,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      !user ||
      navigationProjectId ||
      !activeTeamId ||
      !isProjectNavigationPage(activePage)
    ) {
      return;
    }
    replaceNavigationLocation(
      projectNavigationLocation(activePage, activeTeamId),
    );
  }, [
    activePage,
    activeTeamId,
    companionMode,
    user,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      !navigationProjectId
    ) {
      return;
    }
    const navigationProjectExists = teams.some(
      (project) => project.id === navigationProjectId,
    );
    if (navigationProjectExists) {
      if (navigationProjectId !== activeTeamId) {
        selectTeam(navigationProjectId);
      }
      return;
    }
    if (loading || !user) return;

    if (
      (activePage === "channels" || activePage === "dms") &&
      navigationOrganizationId
    ) {
      const fallbackProject = teams.find(
        (project) =>
          project.organizationId === navigationOrganizationId &&
          project.id === activeTeamId,
      ) ?? teams.find(
        (project) => project.organizationId === navigationOrganizationId,
      );
      replaceNavigationLocation(
        navigationChannelId
          ? channelNavigationLocation(
              activePage,
              navigationOrganizationId,
              navigationChannelId,
              fallbackProject?.id,
            )
          : channelPageNavigationLocation(
              activePage,
              navigationOrganizationId,
              fallbackProject?.id,
            ),
      );
      return;
    }
    if (activePage === "settings") {
      replaceNavigationLocation(
        settingsNavigationLocation({
          scope: "application",
          section: "account",
        }),
      );
      return;
    }
    const fallbackProject =
      teams.find(
        (project) => project.id === activeTeamId,
      ) ?? teams[0];
    replaceNavigationLocation(
      fallbackProject && isProjectNavigationPage(activePage)
        ? projectNavigationLocation(activePage, fallbackProject.id)
        : "lobby",
    );
  }, [
    activePage,
    activeTeamId,
    companionMode,
    loading,
    teams,
    selectTeam,
    user,
    navigationChannelId,
    navigationOrganizationId,
    navigationProjectId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      !navigationOrganizationId
    ) return;
    const navigationOrganizationExists = organizations.some(
      (organization) => organization.id === navigationOrganizationId,
    );
    if (!navigationOrganizationExists) {
      if (loading || !user) return;
      const fallbackOrganization =
        organizations.find(
          (organization) => organization.id === activeOrganizationId,
        ) ?? organizations[0];
      if (!fallbackOrganization) {
        replaceNavigationLocation("lobby");
        return;
      }
      if (activePage === "channels" || activePage === "dms") {
        const fallbackProject = teams.find(
          (project) =>
            project.organizationId === fallbackOrganization.id &&
            project.id === activeTeamId,
        ) ?? teams.find(
          (project) => project.organizationId === fallbackOrganization.id,
        );
        replaceNavigationLocation(
          channelPageNavigationLocation(
            activePage,
            fallbackOrganization.id,
            fallbackProject?.id,
          ),
        );
      } else if (activePage === "inbox" || activePage === "my-issues") {
        replaceNavigationLocation(
          organizationNavigationLocation(fallbackOrganization.id, activePage),
        );
      } else {
        replaceNavigationLocation(
          settingsNavigationLocation({
            scope: "application",
            section: "account",
          }),
        );
      }
      return;
    }
    if (navigationOrganizationId !== activeOrganizationId) {
      selectOrganization(navigationOrganizationId);
      return;
    }
    if (!navigationChannelId) {
      if (navigationHasChannelPageContext && activeChannelId !== null) {
        selectChannel(null);
      }
      return;
    }
    if (activeChannelId !== navigationChannelId) {
      startDesktopChannelTransition(navigationChannelId);
      selectChannel(navigationChannelId);
    }
    markOrganizationChannelRead(navigationChannelId);
  }, [
    activeChannelId,
    activeOrganizationId,
    activeTeamId,
    companionMode,
    loading,
    organizations,
    teams,
    selectOrganization,
    user,
    activePage,
    markOrganizationChannelRead,
    navigationChannelId,
    navigationHasChannelPageContext,
    navigationOrganizationId,
    navigationUserBoundaryChanged,
    // The catalog kept this effect re-running while the read marker was a
    // callback rebuilt from it, which is what re-marks the open channel when a
    // message lands in it. The action is stable now, so the list is the
    // dependency.
    organizationChannels,
    replaceNavigationLocation,
  ]);
  const activeProjectForTabs = teams.find(
    (project) =>
      project.id === (navigationProjectId ?? activeTeamId),
  );
  useEffect(() => {
    if (
      !navigationUserBoundaryChanged &&
      activePage === "schedule" &&
      !isTeamScheduleTabEnabled(activeProjectForTabs)
    ) {
      replaceNavigationLocation(
        activeProjectForTabs
          ? projectNavigationLocation("issues", activeProjectForTabs.id)
          : "issues",
      );
    }
  }, [
    activePage,
    activeProjectForTabs,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);
  /*
    The channel actions navigate, and navigation is still the shell's. They ask
    for it through the registry rather than through hook dependencies, so
    `useChannelActions()` keeps returning the same object to every view that
    took it while these closures keep tracking the latest render.
  */
  useEffect(() => {
    setChannelNavigationBridge(registry, { navigateToChannel, navigateToPage });
  }, [navigateToChannel, navigateToPage, registry]);

  return useMemo(
    () => ({
      activeNavigationLocation,
      activePage,
      activeProjectForTabs,
      canGoBack,
      canGoForward,
      closeSettings,
      desktopActiveChannelId,
      goBack,
      goForward,
      goToNavigationHistory,
      handleDesktopChannelFallback,
      navigateToChannel,
      navigateToIssue,
      navigateToLocation,
      navigateToPage,
      navigationHistoryEntries,
      navigationHistoryIndex,
      navigationProjectId,
      navigationUserBoundaryChanged,
      replaceNavigationLocation,
      resetNavigation,
      selectedRunId,
      setDefaultTeam,
    }),
    [
      activeNavigationLocation,
      activePage,
      activeProjectForTabs,
      canGoBack,
      canGoForward,
      closeSettings,
      desktopActiveChannelId,
      goBack,
      goForward,
      goToNavigationHistory,
      handleDesktopChannelFallback,
      navigateToChannel,
      navigateToIssue,
      navigateToLocation,
      navigateToPage,
      navigationHistoryEntries,
      navigationHistoryIndex,
      navigationProjectId,
      navigationUserBoundaryChanged,
      replaceNavigationLocation,
      resetNavigation,
      selectedRunId,
      setDefaultTeam,
    ],
  );
}
