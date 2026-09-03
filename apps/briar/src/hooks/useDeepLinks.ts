import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { useI18n } from "../i18n";
import { useToast } from "../components/ui/toast";
import { resolveIssueHierarchyLocation } from "../lib/api";
import type {
  ActivePage,
  AppNavigationLocation,
  ChannelNavigationPage,
} from "../lib/app-navigation";
import { projectNavigationLocation } from "../lib/app-navigation";
import { listenForClickedIssueLinks } from "../lib/external-links";
import { navigateToIssueLink } from "../lib/issue-link-navigation";
import { listenForBriarLinks } from "../lib/issue-links";
import { isMacDesktopTauri } from "../lib/platform";
import { listenForStatusTrayOpenRun } from "../lib/status-tray";
import { useChannelActions } from "../state/channels/actions";
import {
  activeOrganizationChannelsAtom,
  channelCatalogCursorAtom,
  channelsLoadingAtom,
  requestedChannelIdAtom,
  requestedChannelMessageAtom,
} from "../state/channels/atoms";
import { activePlanningProjectIdAtom } from "../state/dialogs/atoms";
import {
  companionPageAtom,
  companionStatusAtom,
  pendingBriarLinkAtom,
  pendingInboxNotificationTargetAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
} from "../state/navigation/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { companionMode, lockedTeamIdAtom } from "../state/platform";
import { loadingAtom, tokenAtom, userAtom } from "../state/session/atoms";
import { activeDashboardAtom } from "../state/sync/view";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";

/*
  Everything that opens something because the outside world asked.

  Three listeners — a `briar://` link, a clicked issue link, the macOS tray —
  put a target into `pendingBriarLinkAtom`, and one resolver drains it once the
  session, the organization and the channel catalog it needs have settled.
  Notifications take the same shape through `pendingInboxNotificationTarget`.

  The resolver's shape is what kept this in the app shell: it waits on state it
  does not own and then writes request atoms that a dozen views read. It reads
  the waiting conditions from atoms now; navigation and the two session calls
  that can switch teams are still the shell's and come in as parameters.
*/

/** Where a resolved deep link sends the user. */
export interface DeepLinkNavigation {
  readonly navigateToChannel: (
    channelId: string,
    page: ChannelNavigationPage,
    organizationId?: string | null,
    projectId?: string | null,
  ) => void;
  readonly navigateToIssue: (runId: string, projectId?: string | null) => void;
  readonly navigateToPage: (page: ActivePage, projectId?: string | null) => void;
  readonly replaceNavigationLocation: (location: AppNavigationLocation) => void;
}

/** The session and inbox calls the resolver makes on the way. */
export interface DeepLinkSession {
  readonly ensureTeamSelected: (teamId: string) => Promise<unknown>;
  readonly selectOrganization: (organizationId: string) => void;
  readonly selectTeam: (teamId: string) => void;
  readonly markInboxRead: (messageId: string) => void;
}

/** The outside world, so a test can hand the hook its own. */
export interface DeepLinkListeners {
  readonly listenForBriarLinks: typeof listenForBriarLinks;
  readonly listenForClickedIssueLinks: typeof listenForClickedIssueLinks;
  readonly listenForStatusTrayOpenRun: typeof listenForStatusTrayOpenRun;
  readonly resolveIssueHierarchyLocation: typeof resolveIssueHierarchyLocation;
  readonly navigateToIssueLink: typeof navigateToIssueLink;
  /** The tray listener only exists in the packaged macOS app. */
  readonly macDesktop: boolean;
}

const liveListeners: DeepLinkListeners = {
  listenForBriarLinks,
  listenForClickedIssueLinks,
  listenForStatusTrayOpenRun,
  resolveIssueHierarchyLocation,
  navigateToIssueLink,
  macDesktop: isMacDesktopTauri(),
};

export interface UseDeepLinksInput {
  readonly navigation: DeepLinkNavigation;
  readonly session: DeepLinkSession;
  /** The team the navigation location points at, for the orphan run fallback. */
  readonly navigationTeamId: string | null;
  /** The run the navigation location points at. */
  readonly selectedRunId: string | null;
  /** Set while the account just changed, when nothing may be reconciled. */
  readonly navigationUserBoundaryChanged: boolean;
  readonly listeners?: Partial<DeepLinkListeners> | undefined;
}

export function useDeepLinks({
  navigation,
  session,
  navigationTeamId,
  selectedRunId,
  navigationUserBoundaryChanged,
  listeners: listenerOverrides,
}: UseDeepLinksInput): void {
  const { t } = useI18n();
  const { toast } = useToast();
  const listeners: DeepLinkListeners = { ...liveListeners, ...listenerOverrides };
  const {
    listenForBriarLinks: listenForLinks,
    listenForClickedIssueLinks: listenForClickedLinks,
    listenForStatusTrayOpenRun: listenForTrayOpenRun,
    macDesktop,
  } = listeners;

  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const user = useAtomValue(userAtom);
  const loading = useAtomValue(loadingAtom);
  const token = useAtomValue(tokenAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const teams = useAtomValue(teamsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
  const organizationChannels = useAtomValue(activeOrganizationChannelsAtom);
  const channelsLoading = useAtomValue(channelsLoadingAtom);
  const channelCatalogCursor = useAtomValue(channelCatalogCursorAtom);
  const [pendingBriarLink, setPendingBriarLink] = useAtom(pendingBriarLinkAtom);
  const [pendingInboxNotificationTarget, setPendingInboxNotificationTarget] =
    useAtom(pendingInboxNotificationTargetAtom);
  const [requestedRunId, setRequestedRunId] = useAtom(requestedRunIdAtom);
  const setRequestedRunMessageId = useAtomSet(requestedRunMessageIdAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setRequestedChannelMessage = useAtomSet(requestedChannelMessageAtom);
  const setRequestedChannelId = useAtomSet(requestedChannelIdAtom);
  const setActivePlanningProjectId = useAtomSet(activePlanningProjectIdAtom);
  const setCompanionPage = useAtomSet(companionPageAtom);
  const setCompanionStatus = useAtomSet(companionStatusAtom);
  const { markOrganizationChannelRead, selectChannel } = useChannelActions();
  const { navigateToChannel, navigateToIssue, navigateToPage } = navigation;
  const { replaceNavigationLocation } = navigation;
  const { ensureTeamSelected, markInboxRead, selectOrganization, selectTeam } =
    session;

  useEffect(
    () => (lockedTeamId ? undefined : listenForLinks(setPendingBriarLink)),
    [listenForLinks, lockedTeamId, setPendingBriarLink],
  );
  useEffect(
    () =>
      listenForClickedLinks((target) =>
        setPendingBriarLink({ kind: "issue", ...target }),
      ),
    [listenForClickedLinks, setPendingBriarLink],
  );
  useEffect(() => {
    if (!macDesktop || lockedTeamId) return;
    return listenForTrayOpenRun((payload) => {
      setPendingBriarLink({
        kind: "issue",
        projectId: payload.projectId,
        runId: payload.runId,
      });
    });
  }, [
    listenForTrayOpenRun,
    lockedTeamId,
    macDesktop,
    setPendingBriarLink,
  ]);

  useEffect(() => {
    if (!pendingBriarLink || !user || loading) return;
    if (pendingBriarLink.kind === "channel") {
      setRequestedRunMessageId(null);
      if (
        !organizations.some(
          (organization) => organization.id === pendingBriarLink.organizationId,
        )
      ) {
        return;
      }
      if (pendingBriarLink.organizationId !== activeOrganizationId) {
        selectOrganization(pendingBriarLink.organizationId);
        return;
      }
      if (channelsLoading || channelCatalogCursor === null) {
        return;
      }
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setRequestedChannelMessage(
        pendingBriarLink.messageId && pendingBriarLink.rootMessageId
          ? {
              channelId: pendingBriarLink.channelId,
              messageId: pendingBriarLink.messageId,
              rootMessageId: pendingBriarLink.rootMessageId,
            }
          : null,
      );
      setRequestedChannelId(
        companionMode &&
          !(pendingBriarLink.messageId && pendingBriarLink.rootMessageId)
          ? pendingBriarLink.channelId
          : null,
      );
      selectChannel(pendingBriarLink.channelId);
      markOrganizationChannelRead(pendingBriarLink.channelId);
      if (companionMode) {
        setCompanionPage(
          organizationChannels.find(
              (channel) => channel.id === pendingBriarLink.channelId,
            )?.kind === "dm"
            ? "dms"
            : "home",
        );
      } else {
        navigateToChannel(
          pendingBriarLink.channelId,
          organizationChannels.find(
            (channel) => channel.id === pendingBriarLink.channelId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          pendingBriarLink.organizationId,
        );
      }
      setPendingBriarLink(null);
      return;
    }
    if (pendingBriarLink.kind === "issue") {
      const target = pendingBriarLink;
      setPendingBriarLink(null);
      void (async () => {
        let resolvedTarget = target;
        if (token) {
          try {
            const location = await listeners.resolveIssueHierarchyLocation(
              token,
              target.projectId,
              target.runId,
            );
            resolvedTarget = {
              ...target,
              projectId: location.teamId,
              runId: location.runId,
            };
            setActivePlanningProjectId(location.projectId);
          } catch {
            // Compatibility with servers that predate hierarchy resolution.
          }
        }
        return listeners.navigateToIssueLink({
          target: resolvedTarget,
          activeProjectId: activeTeamId,
          availableProjectIds: teams.map((team) => team.id),
          lockedProjectId: lockedTeamId,
          ensureProjectSelected: ensureTeamSelected,
          openIssue: ({ projectId, runId }) => {
            setRequestedSessionId(null);
            setRequestedRunMessageId(null);
            setRequestedRunInitialTab(null);
            setRequestedRunId(runId);
            setCompanionPage("issues");
            setCompanionStatus("all");
            navigateToIssue(runId, projectId);
          },
        });
      })().then((outcome) => {
        if (outcome.status !== "rejected") return;
        toast(
          t(
            outcome.reason === "project-window-locked"
              ? "navigation.issueLinkProjectWindow"
              : "navigation.issueLinkProjectUnavailable",
          ),
          { tone: "error" },
        );
      });
      return;
    }
    if (!teams.some((team) => team.id === pendingBriarLink.projectId)) {
      return;
    }

    if (pendingBriarLink.projectId !== activeTeamId) {
      selectTeam(pendingBriarLink.projectId);
    }
    setRequestedRunMessageId(null);
    setRequestedRunInitialTab(null);
    setRequestedRunId(null);
    setRequestedSessionId(pendingBriarLink.sessionId);
    if (companionMode) setCompanionPage("dms");
    else navigateToPage("agents", pendingBriarLink.projectId);
    setPendingBriarLink(null);
    // `listeners` is rebuilt every render; the two calls it carries are read
    // when the effect runs, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeOrganizationId,
    activeTeamId,
    channelCatalogCursor,
    channelsLoading,
    ensureTeamSelected,
    loading,
    markOrganizationChannelRead,
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    organizationChannels,
    organizations,
    lockedTeamId,
    pendingBriarLink,
    selectChannel,
    selectOrganization,
    selectTeam,
    setActivePlanningProjectId,
    setCompanionPage,
    setCompanionStatus,
    setPendingBriarLink,
    setRequestedChannelId,
    setRequestedChannelMessage,
    setRequestedRunId,
    setRequestedRunInitialTab,
    setRequestedRunMessageId,
    setRequestedSessionId,
    t,
    teams,
    toast,
    token,
    user,
  ]);

  /*
    The run a link opened is gone.

    The location still points at it, so the issue page would render an empty
    detail; replacing the location with the team's list is the fallback, and the
    toast only fires for a run this session actually asked for.
  */
  useEffect(() => {
    if (
      navigationUserBoundaryChanged ||
      !selectedRunId ||
      !navigationTeamId ||
      dashboard?.team.id !== navigationTeamId ||
      dashboard.runs.some((run) => run.id === selectedRunId)
    ) {
      return;
    }
    if (requestedRunId === selectedRunId) {
      setRequestedRunId(null);
      setRequestedRunMessageId(null);
      setRequestedRunInitialTab(null);
      toast(t("navigation.issueLinkIssueUnavailable"), { tone: "error" });
    }
    replaceNavigationLocation(
      projectNavigationLocation("issues", navigationTeamId),
    );
  }, [
    dashboard,
    navigationTeamId,
    navigationUserBoundaryChanged,
    replaceNavigationLocation,
    requestedRunId,
    selectedRunId,
    setRequestedRunId,
    setRequestedRunInitialTab,
    setRequestedRunMessageId,
    t,
    toast,
  ]);

  useEffect(() => {
    if (!pendingInboxNotificationTarget || !user || loading) return;
    const targetProject = teams.find(
      (team) => team.id === pendingInboxNotificationTarget.projectId,
    );
    if (!targetProject) return;

    markInboxRead(pendingInboxNotificationTarget.messageId);
    if (pendingInboxNotificationTarget.projectId !== activeTeamId) {
      selectTeam(pendingInboxNotificationTarget.projectId);
      return;
    }
    if (
      pendingInboxNotificationTarget.kind === "channel" &&
      (channelsLoading ||
        channelCatalogCursor === null ||
        activeOrganizationId !== targetProject.organizationId)
    ) {
      return;
    }
    if (
      pendingInboxNotificationTarget.kind === "issue" ||
      pendingInboxNotificationTarget.kind === "conversation"
    ) {
      setRequestedSessionId(null);
      setRequestedRunMessageId(
        pendingInboxNotificationTarget.kind === "conversation"
          ? pendingInboxNotificationTarget.conversationMessageId ?? null
          : null,
      );
      setRequestedRunInitialTab(
        pendingInboxNotificationTarget.kind === "conversation"
          ? "conversation"
          : null,
      );
      setRequestedRunId(pendingInboxNotificationTarget.targetId);
      if (companionMode) {
        setCompanionStatus("all");
        setCompanionPage("issues");
      } else {
        navigateToIssue(
          pendingInboxNotificationTarget.targetId,
          pendingInboxNotificationTarget.projectId,
        );
      }
    } else if (pendingInboxNotificationTarget.kind === "channel") {
      const { channelMessageId, rootMessageId } = pendingInboxNotificationTarget;
      if (!channelMessageId || !rootMessageId) return;
      setRequestedRunMessageId(null);
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(null);
      setRequestedChannelMessage({
        channelId: pendingInboxNotificationTarget.targetId,
        messageId: channelMessageId,
        rootMessageId,
      });
      selectChannel(pendingInboxNotificationTarget.targetId);
      markOrganizationChannelRead(pendingInboxNotificationTarget.targetId);
      if (companionMode) {
        setCompanionPage(
          organizationChannels.find(
              (channel) => channel.id === pendingInboxNotificationTarget.targetId,
            )?.kind === "dm"
            ? "dms"
            : "home",
        );
      } else {
        navigateToChannel(
          pendingInboxNotificationTarget.targetId,
          organizationChannels.find(
            (channel) => channel.id === pendingInboxNotificationTarget.targetId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          targetProject.organizationId,
          targetProject.id,
        );
      }
    } else {
      setRequestedRunMessageId(null);
      setRequestedRunInitialTab(null);
      setRequestedRunId(null);
      setRequestedSessionId(pendingInboxNotificationTarget.targetId);
      if (companionMode) setCompanionPage("dms");
      else navigateToPage("agents", pendingInboxNotificationTarget.projectId);
    }
    setPendingInboxNotificationTarget(null);
  }, [
    activeOrganizationId,
    activeTeamId,
    channelCatalogCursor,
    channelsLoading,
    loading,
    markInboxRead,
    markOrganizationChannelRead,
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    organizationChannels,
    pendingInboxNotificationTarget,
    selectChannel,
    selectTeam,
    setCompanionPage,
    setCompanionStatus,
    setPendingInboxNotificationTarget,
    setRequestedChannelMessage,
    setRequestedRunId,
    setRequestedRunInitialTab,
    setRequestedRunMessageId,
    setRequestedSessionId,
    teams,
    user,
  ]);
}
