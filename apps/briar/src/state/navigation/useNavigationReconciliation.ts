import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { startDesktopChannelTransition } from "../../lib/channel-performance";
import { sortDirectMessages } from "../../lib/direct-messages";
import { isTeamScheduleTabEnabled } from "../../lib/team-tabs";
import {
  channelNavigationLocation,
  channelPageNavigationLocation,
  isProjectNavigationPage,
  organizationNavigationLocation,
  projectNavigationLocation,
  settingsNavigationLocation,
} from "../../lib/app-navigation";
import {
  setChannelNavigationBridge,
  useChannelActions,
} from "../channels/actions";
import {
  activeChannelIdAtom,
  activeOrganizationChannelsAtom,
  channelCatalogCursorAtom,
  directMessageComposeAtom,
  organizationDirectMessagesAtom,
} from "../channels/atoms";
import { useOrganizationActions } from "../organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { companionMode, lockedTeamIdAtom } from "../platform";
import { useRegistry } from "../registry";
import { loadingAtom, userAtom } from "../session/atoms";
import { useTeamActions } from "../team/actions";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { useNavigationActions } from "./actions";
import {
  activePageAtom,
  activeTeamForTabsAtom,
  desktopActiveChannelIdAtom,
  homeNavigationPage,
  navigationChannelIdAtom,
  navigationHistoryUserIdAtom,
  navigationLocationAtom,
  navigationOrganizationIdAtom,
  navigationSettingsTargetAtom,
  navigationTeamIdAtom,
  navigationUserBoundaryChangedAtom,
  settingsTargetAtom,
} from "./atoms";

/*
  What the location and the store owe each other.

  Seven effects, and the order they appear in is the contract. They run in one
  hook, in this order, on purpose:

    1. user boundary — a different account signed in, so the visit stack from
       the previous one is dropped and every effect below holds still for that
       render;
    2. settings target — a settings location names the screen it shows, and a
       bare `settings` page adopts the stored one;
    3. team backfill — a project page with no team in its location gets the
       selected one written into it;
    4. team existence — a location naming a team the account no longer has
       falls back, per page kind;
    5. organization existence — the same for the organization, and otherwise
       the location's channel becomes the selected one;
    6. schedule tab — the schedule page leaves when its team turned the tab off;
    7. latest DM — the DM page with no conversation open shows the latest one,
       unless the user is composing a new conversation.

  Each one reads what the ones before it wrote: 3 gives 4 a team to check, 4
  gives 5 a settled team for its channel fallback, 6 reads the team 3 and 4
  agreed on, and 7 runs against the organization 5 settled. Splitting them
  across hooks or mount points would leave that ordering to React, which is why
  they stay together.

  Only the desktop reconciles. The companion shell navigates with its own page
  atom and never carries a location, which is what every `companionMode` guard
  below is saying.
*/

export function useNavigationReconciliation(): void {
  const registry = useRegistry();
  const actions = useNavigationActions();
  const { selectTeam } = useTeamActions();
  const user = useAtomValue(userAtom);
  const loading = useAtomValue(loadingAtom);
  const teams = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const organizationChannels = useAtomValue(activeOrganizationChannelsAtom);
  const directMessages = useAtomValue(organizationDirectMessagesAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const composingDirectMessage = useAtomValue(directMessageComposeAtom);
  const desktopActiveChannelId = useAtomValue(desktopActiveChannelIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const settingsTarget = useAtomValue(settingsTargetAtom);
  const activeNavigationLocation = useAtomValue(navigationLocationAtom);
  const activePage = useAtomValue(activePageAtom);
  const navigationTeamId = useAtomValue(navigationTeamIdAtom);
  const navigationOrganizationId = useAtomValue(navigationOrganizationIdAtom);
  const navigationChannelId = useAtomValue(navigationChannelIdAtom);
  const navigationSettingsTarget = useAtomValue(navigationSettingsTargetAtom);
  const activeTeamForTabs = useAtomValue(activeTeamForTabsAtom);
  const navigationUserBoundaryChanged = useAtomValue(
    navigationUserBoundaryChangedAtom,
  );
  const { markOrganizationChannelRead, selectChannel } = useChannelActions();
  const { selectOrganization } = useOrganizationActions();
  const { replaceChannelDestination, replaceNavigationLocation, resetNavigation } =
    actions;
  const navigationUserId = user?.id ?? null;

  /*
    The channel actions navigate, and navigation is a peer domain rather than
    one they may import, so they ask for it through a bridge. Both sides are
    registry bound, which is why installing it once is enough.
  */
  useEffect(() => {
    setChannelNavigationBridge(registry, {
      navigateToChannel: actions.navigateToChannel,
      navigateToPage: actions.navigateToPage,
    });
  }, [actions, registry]);

  // 1. A different account took over: the visit stack the previous one built
  //    is dropped, and nothing below reconciles on that render.
  useEffect(() => {
    const owner = registry.get(navigationHistoryUserIdAtom);
    if (owner === undefined) {
      registry.set(navigationHistoryUserIdAtom, navigationUserId);
      return;
    }
    if (owner === navigationUserId) return;
    registry.set(navigationHistoryUserIdAtom, navigationUserId);
    resetNavigation(homeNavigationPage);
  }, [navigationUserId, registry, resetNavigation]);

  // 2. The settings location and the settings target say the same thing.
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      activePage !== "settings"
    ) {
      return;
    }
    if (navigationSettingsTarget) {
      registry.update(settingsTargetAtom, (current) =>
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
    navigationSettingsTarget,
    navigationUserBoundaryChanged,
    registry,
    replaceNavigationLocation,
    settingsTarget,
  ]);

  // 3. A project page with no team in its location adopts the selected one.
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      !user ||
      navigationTeamId ||
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
    user,
    navigationTeamId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);

  // 4. The team a location names either becomes the selected one, or is gone
  //    and the location falls back to what the page kind allows.
  useEffect(() => {
    if (navigationUserBoundaryChanged || companionMode || !navigationTeamId) {
      return;
    }
    const navigationTeamExists = teams.some(
      (team) => team.id === navigationTeamId,
    );
    if (navigationTeamExists) {
      if (navigationTeamId !== activeTeamId) selectTeam(navigationTeamId);
      return;
    }
    if (loading || !user) return;

    if (
      (activePage === "channels" || activePage === "dms") &&
      navigationOrganizationId
    ) {
      const fallbackTeam =
        teams.find(
          (team) =>
            team.organizationId === navigationOrganizationId &&
            team.id === activeTeamId,
        ) ??
        teams.find((team) => team.organizationId === navigationOrganizationId);
      replaceNavigationLocation(
        navigationChannelId
          ? channelNavigationLocation(
              activePage,
              navigationOrganizationId,
              navigationChannelId,
              fallbackTeam?.id,
            )
          : channelPageNavigationLocation(
              activePage,
              navigationOrganizationId,
              fallbackTeam?.id,
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
    const fallbackTeam =
      teams.find((team) => team.id === activeTeamId) ?? teams[0];
    replaceNavigationLocation(
      fallbackTeam && isProjectNavigationPage(activePage)
        ? projectNavigationLocation(activePage, fallbackTeam.id)
        : "lobby",
    );
  }, [
    activePage,
    activeTeamId,
    loading,
    teams,
    selectTeam,
    user,
    navigationChannelId,
    navigationOrganizationId,
    navigationTeamId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);

  // 5. The same for the organization, and — once it agrees — the location's
  //    channel becomes the open one.
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      !navigationOrganizationId
    ) {
      return;
    }
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
        const fallbackTeam =
          teams.find(
            (team) =>
              team.organizationId === fallbackOrganization.id &&
              team.id === activeTeamId,
          ) ??
          teams.find((team) => team.organizationId === fallbackOrganization.id);
        replaceNavigationLocation(
          channelPageNavigationLocation(
            activePage,
            fallbackOrganization.id,
            fallbackTeam?.id,
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
      if (
        (activePage === "channels" || activePage === "dms") &&
        activeChannelId !== null
      ) {
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
    loading,
    organizations,
    teams,
    selectOrganization,
    user,
    activePage,
    markOrganizationChannelRead,
    navigationChannelId,
    navigationOrganizationId,
    navigationUserBoundaryChanged,
    // The catalog kept this effect re-running while the read marker was a
    // callback rebuilt from it, which is what re-marks the open channel when a
    // message lands in it. The action is stable now, so the list is the
    // dependency.
    organizationChannels,
    replaceNavigationLocation,
    selectChannel,
  ]);

  // 6. The schedule page is only reachable while its team offers the tab.
  useEffect(() => {
    if (
      !navigationUserBoundaryChanged &&
      activePage === "schedule" &&
      !isTeamScheduleTabEnabled(activeTeamForTabs)
    ) {
      replaceNavigationLocation(
        activeTeamForTabs
          ? projectNavigationLocation("issues", activeTeamForTabs.id)
          : "issues",
      );
    }
  }, [
    activePage,
    activeTeamForTabs,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
  ]);

  // 7. The DM page never sits on nothing while there is a conversation to show:
  //    with none open, it swaps in the latest one — without recording a visit,
  //    so Back does not stop on the empty page. Composing a new conversation is
  //    the one time the page is meant to show no timeline, and a catalog that
  //    has not loaded yet has no "latest" to offer.
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      companionMode ||
      lockedTeamId ||
      activePage !== "dms" ||
      composingDirectMessage ||
      !activeOrganizationId ||
      channelCatalogCursor === null ||
      (navigationOrganizationId !== null &&
        navigationOrganizationId !== activeOrganizationId) ||
      directMessages.some((channel) => channel.id === desktopActiveChannelId)
    ) {
      return;
    }
    const latest = sortDirectMessages(directMessages)[0];
    if (!latest) return;
    replaceChannelDestination(
      latest.id,
      "dms",
      activeOrganizationId,
      navigationTeamId ?? activeTeamId,
    );
  }, [
    activeOrganizationId,
    activePage,
    activeTeamId,
    channelCatalogCursor,
    composingDirectMessage,
    desktopActiveChannelId,
    directMessages,
    lockedTeamId,
    navigationOrganizationId,
    navigationTeamId,
    navigationUserBoundaryChanged,
    replaceChannelDestination,
  ]);
}
