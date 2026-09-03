import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { startDesktopChannelTransition } from "../../lib/channel-performance";
import {
  channelNavigationLocation,
  channelPageNavigationLocation,
  isProjectNavigationPage,
  issueNavigationLocation,
  organizationNavigationLocation,
  pageFromNavigationLocation,
  projectNavigationLocation,
  type ActivePage,
  type AppNavigationLocation,
  type ChannelNavigationPage,
} from "../../lib/app-navigation";
import { createChannelActions } from "../channels/actions";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import { activeTeamIdAtom } from "../team/atoms";
import {
  navigationChannelIdAtom,
  navigationHistoryAtom,
  navigationOrganizationIdAtom,
  navigationTeamIdAtom,
  settingsTargetAtom,
} from "./atoms";
import { reduceNavigationHistory, type NavigationAction } from "./history";

/*
  Every way the app can move.

  These were `useCallback`s in the app shell, which is why every view that
  navigates took a prop for each one and re-rendered whenever the shell did.
  Bound to the registry instead, they read the ids they default to at call time
  and `useNavigationActions()` returns the same object for the registry's whole
  lifetime.

  The team a page defaults to is the selected team, read when the call happens.
  The shell used to keep that in a ref it re-assigned during every render and
  the callers overwrote just before selecting a team; reading the selection
  directly is the same answer, because every one of those callers selected the
  same team in the same synchronous step.
*/

export interface NavigationActions {
  /** Pushes a location onto the visit stack. */
  readonly navigateToLocation: (location: AppNavigationLocation) => void;
  /** Swaps the location on screen without recording a visit. */
  readonly replaceNavigationLocation: (location: AppNavigationLocation) => void;
  /** Navigates to a page, carrying the team or organization it belongs to. */
  readonly navigateToPage: (page: ActivePage, teamId?: string | null) => void;
  /** Opens an issue, on the team that owns it. */
  readonly navigateToIssue: (runId: string, teamId?: string | null) => void;
  /** Opens a channel, marks it read, and records the visit. */
  readonly navigateToChannel: (
    channelId: string,
    page: ChannelNavigationPage,
    organizationId?: string | null,
    teamId?: string | null,
  ) => void;
  /** Swaps which channel the page shows, without recording a visit. */
  readonly replaceChannelDestination: (
    channelId: string | null,
    page: ChannelNavigationPage,
    organizationId?: string | null,
    teamId?: string | null,
  ) => void;
  /** The channel list's "this one is gone, take that one instead". */
  readonly handleDesktopChannelFallback: (
    channelId: string | null,
    page: ChannelNavigationPage,
  ) => void;
  /** Drops the visit stack and starts a new one at `page`. */
  readonly resetNavigation: (page: ActivePage) => void;
  /** Opens the application settings on the account screen. */
  readonly openAppSettings: () => void;
  /** Returns past every settings entry the stack holds. */
  readonly closeSettings: () => void;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly goToNavigationHistory: (index: number) => void;
}

export function createNavigationActions(
  registry: AtomRegistry,
): NavigationActions {
  const channels = createChannelActions(registry);
  const dispatch = (action: NavigationAction<AppNavigationLocation>) => {
    registry.update(navigationHistoryAtom, (history) =>
      reduceNavigationHistory(history, action),
    );
  };
  const navigateToLocation: NavigationActions["navigateToLocation"] = (value) =>
    dispatch({ type: "navigate", value });
  const replaceNavigationLocation: NavigationActions["replaceNavigationLocation"] =
    (value) => dispatch({ type: "replace", value });
  const defaultTeamId = () => registry.get(activeTeamIdAtom);

  const navigateToPage: NavigationActions["navigateToPage"] = (
    page,
    teamId = defaultTeamId(),
  ) => {
    const organizationId = registry.get(activeOrganizationIdAtom);
    navigateToLocation(
      (page === "inbox" || page === "my-issues") && organizationId
        ? organizationNavigationLocation(organizationId, page)
        : (page === "channels" || page === "dms") && organizationId
          ? channelPageNavigationLocation(page, organizationId, teamId)
          : teamId && isProjectNavigationPage(page)
            ? projectNavigationLocation(page, teamId)
            : page,
    );
  };

  const replaceChannelDestination: NavigationActions["replaceChannelDestination"] =
    (
      channelId,
      page,
      organizationId = registry.get(activeOrganizationIdAtom),
      teamId = defaultTeamId(),
    ) => {
      Atom.batch(() => {
        channels.selectChannel(channelId);
        if (!channelId || !organizationId) {
          replaceNavigationLocation(
            organizationId
              ? channelPageNavigationLocation(page, organizationId, teamId)
              : page,
          );
          return;
        }
        startDesktopChannelTransition(channelId);
        channels.markOrganizationChannelRead(channelId);
        replaceNavigationLocation(
          channelNavigationLocation(page, organizationId, channelId, teamId),
        );
      });
    };

  return {
    navigateToLocation,
    replaceNavigationLocation,
    navigateToPage,
    replaceChannelDestination,

    navigateToIssue(runId, teamId = defaultTeamId()) {
      if (!teamId) return;
      navigateToLocation(issueNavigationLocation(teamId, runId));
    },

    navigateToChannel(
      channelId,
      page,
      organizationId = registry.get(activeOrganizationIdAtom),
      teamId = defaultTeamId(),
    ) {
      if (!organizationId) return;
      startDesktopChannelTransition(channelId);
      Atom.batch(() => {
        channels.selectChannel(channelId);
        channels.markOrganizationChannelRead(channelId);
        navigateToLocation(
          channelNavigationLocation(page, organizationId, channelId, teamId),
        );
      });
    },

    handleDesktopChannelFallback(channelId, page) {
      const activeOrganizationId = registry.get(activeOrganizationIdAtom);
      const locationOrganizationId = registry.get(navigationOrganizationIdAtom);
      // A channel view that is on its way out still reports its fallback. If
      // the location already moved to another organization, that report is
      // about the previous one and must not move anything.
      if (
        registry.get(navigationChannelIdAtom) &&
        locationOrganizationId !== activeOrganizationId
      ) {
        return;
      }
      replaceChannelDestination(
        channelId,
        page,
        locationOrganizationId ?? activeOrganizationId,
        registry.get(navigationTeamIdAtom) ?? defaultTeamId(),
      );
    },

    resetNavigation(page) {
      dispatch({ type: "reset", value: page });
    },

    openAppSettings() {
      Atom.batch(() => {
        registry.set(settingsTargetAtom, {
          scope: "application",
          section: "account",
        });
        navigateToPage("settings");
      });
    },

    closeSettings() {
      const teamId = defaultTeamId();
      dispatch({
        type: "backTo",
        fallback: teamId
          ? projectNavigationLocation("issues", teamId)
          : "issues",
        predicate: (location) =>
          pageFromNavigationLocation(location) !== "settings",
      });
    },

    goBack() {
      dispatch({ type: "back" });
    },

    goForward() {
      dispatch({ type: "forward" });
    },

    goToNavigationHistory(index) {
      dispatch({ type: "goTo", index });
    },
  };
}

/** The navigation actions bound to the surrounding registry. */
export function useNavigationActions(): NavigationActions {
  const registry = useRegistry();
  return useMemo(() => createNavigationActions(registry), [registry]);
}
