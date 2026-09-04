import {
  useAtom,
  useAtomMount,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { useEffect } from "react";

import { useI18n } from "../i18n";
import { useToast } from "../components/ui/toast";
import { resolveIssueHierarchyLocation } from "../lib/api";
import { projectNavigationLocation } from "../lib/app-navigation";
import { navigateToIssueLink } from "../lib/issue-link-navigation";
import { useChannelActions } from "../state/channels/actions";
import {
  appMenuSettingsListenerAtom,
  briarLinkListenerAtom,
  clickedIssueLinkListenerAtom,
  statusTrayOpenRunListenerAtom,
} from "../state/deep-links/atoms";
import { useInboxActions } from "../state/inbox/actions";
import {
  activeOrganizationChannelsAtom,
  channelCatalogCursorAtom,
  channelsLoadingAtom,
  requestedChannelIdAtom,
  requestedChannelMessageAtom,
} from "../state/channels/atoms";
import { activePlanningProjectIdAtom } from "../state/dialogs/atoms";
import { useNavigationActions } from "../state/navigation/actions";
import {
  activeRunIdAtom,
  companionPageAtom,
  companionStatusAtom,
  navigationTeamIdAtom,
  navigationUserBoundaryChangedAtom,
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
import { useOrganizationActions } from "../state/organization/actions";
import { companionMode, lockedTeamIdAtom } from "../state/platform";
import { loadingAtom, tokenAtom, userAtom } from "../state/session/atoms";
import { activeDashboardAtom } from "../state/sync/view";
import { useTeamActions } from "../state/team/actions";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";

/*
  Everything that opens something because the outside world asked.

  The listeners themselves are `state/deep-links` atoms: they register on first
  observation and unregister through a finalizer, so this hook only mounts them.
  What is left here is the resolver — it drains `pendingBriarLinkAtom` once the
  session, the organization and the channel catalog it needs have settled, and
  `pendingInboxNotificationTarget` the same way.

  The resolver's shape is what kept it in the app shell: it waits on state it
  does not own and then writes request atoms that a dozen views read. It reads
  the waiting conditions and where the user already is from atoms now, and moves
  through the navigation actions, the team and organization actions and the
  inbox's own read marker — nothing is handed in at all.
*/

/** What the resolver reaches outside the store, so a test can replace it. */
export interface DeepLinkResolvers {
  readonly resolveIssueHierarchyLocation: typeof resolveIssueHierarchyLocation;
  readonly navigateToIssueLink: typeof navigateToIssueLink;
}

const liveResolvers: DeepLinkResolvers = {
  resolveIssueHierarchyLocation,
  navigateToIssueLink,
};

export interface UseDeepLinksInput {
  readonly resolvers?: Partial<DeepLinkResolvers> | undefined;
}

export function useDeepLinks({
  resolvers: resolverOverrides,
}: UseDeepLinksInput = {}): void {
  const { t } = useI18n();
  const { toast } = useToast();
  const resolvers: DeepLinkResolvers = { ...liveResolvers, ...resolverOverrides };

  /*
    The four native listeners. Mounting is all this hook does with them: each
    atom registers its listener on first observation and unregisters it through
    a finalizer once nothing observes it any more.
  */
  useAtomMount(briarLinkListenerAtom);
  useAtomMount(clickedIssueLinkListenerAtom);
  useAtomMount(statusTrayOpenRunListenerAtom);
  useAtomMount(appMenuSettingsListenerAtom);

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
  const navigationTeamId = useAtomValue(navigationTeamIdAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const navigationUserBoundaryChanged = useAtomValue(
    navigationUserBoundaryChangedAtom,
  );
  const { markOrganizationChannelRead, selectChannel } = useChannelActions();
  const {
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    replaceNavigationLocation,
  } = useNavigationActions();
  const { ensureTeamSelected, selectTeam } = useTeamActions();
  const { selectOrganization } = useOrganizationActions();
  const { markRead: markInboxRead } = useInboxActions();

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
            const location = await resolvers.resolveIssueHierarchyLocation(
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
        return resolvers.navigateToIssueLink({
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
    // `resolvers` is rebuilt every render; the two calls it carries are read
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
