import {
  useAtom,
  useAtomMount,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { useI18n } from "../i18n";
import { useToast } from "../components/ui/toast";
import { resolveIssueHierarchyLocation } from "../lib/api";
import type { ChannelSummary } from "../lib/channels-contract";
import { projectNavigationLocation } from "../lib/app-navigation";
import { navigateToIssueLink } from "../lib/issue-link-navigation";
import { listDashboardRunsRpc } from "../lib/app-rpc/dashboard";
import { normalizeIssueKeyPrefix } from "../lib/issue-key";
import { useRegistry } from "../state/registry";
import { useChannelActions } from "../state/channels/actions";
import {
  appMenuSettingsListenerAtom,
  briarLinkListenerAtom,
  clickedIssueLinkListenerAtom,
  statusTrayOpenRunListenerAtom,
} from "../state/deep-links/atoms";
import { useInboxActions } from "../state/inbox/actions";
import {
  activeWorkspaceChannelsAtom,
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
import { activeWorkspaceIdAtom, workspacesAtom } from "../state/workspace/atoms";
import { useWorkspaceActions } from "../state/workspace/actions";
import { useLocalWorkspaceActions } from "../state/local-workspace/actions";
import { companionMode, lockedTeamIdAtom } from "../state/platform";
import { loadingAtom, tokenAtom, userAtom } from "../state/session/atoms";
import { useTeamActions } from "../state/team/actions";
import { runsByIdAtom, teamRunIdsAtom } from "../state/entities/runs";
import {
  activeTeamIdAtom,
  loadedTeamIdAtom,
  teamsAtom,
} from "../state/team/atoms";

/*
  Everything that opens something because the outside world asked.

  The listeners themselves are `state/deep-links` atoms: they register on first
  observation and unregister through a finalizer, so this hook only mounts them.
  What is left here is the resolver — it drains `pendingBriarLinkAtom` once the
  session, the workspace and the channel catalog it needs have settled, and
  `pendingInboxNotificationTarget` the same way.

  The resolver's shape is what kept it in the app shell: it waits on state it
  does not own and then writes request atoms that a dozen views read. It reads
  the waiting conditions and where the user already is from atoms now, and moves
  through the navigation actions, the team and workspace actions and the
  inbox's own read marker — nothing is handed in at all.
*/

/*
  Which page of the phone a channel belongs to.

  The catalog answers for every channel it holds. The one it does not hold is an
  Agent-to-Agent conversation — deliberately outside the catalog, because nobody
  is a participant — and the direct message page is the surface that fetches one
  by id, so an unknown id goes there rather than to a channel list with no row
  for it.
*/
export const companionChannelPage = (
  channels: readonly ChannelSummary[],
  channelId: string,
): "dms" | "home" => {
  const known = channels.find((channel) => channel.id === channelId);
  return !known || known.kind === "dm" ? "dms" : "home";
};

/** What the resolver reaches outside the store, so a test can replace it. */
export interface DeepLinkResolvers {
  readonly resolveIssueHierarchyLocation: typeof resolveIssueHierarchyLocation;
  readonly navigateToIssueLink: typeof navigateToIssueLink;
  readonly listDashboardRunsRpc: typeof listDashboardRunsRpc;
}

const liveResolvers: DeepLinkResolvers = {
  resolveIssueHierarchyLocation,
  navigateToIssueLink,
  listDashboardRunsRpc,
};

export interface UseDeepLinksInput {
  readonly resolvers?: Partial<DeepLinkResolvers> | undefined;
}

export function useDeepLinks({
  resolvers: resolverOverrides,
}: UseDeepLinksInput = {}): void {
  const { t } = useI18n();
  const { toast } = useToast();
  const registry = useRegistry();
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
  const workspaces = useAtomValue(workspacesAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const teams = useAtomValue(teamsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const loadedTeamId = useAtomValue(loadedTeamIdAtom);
  // Only the id list: a run's own edits never move the fallback below.
  const loadedRunIds = useAtomValue(teamRunIdsAtom(loadedTeamId ?? ""));
  const organizationChannels = useAtomValue(activeWorkspaceChannelsAtom);
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
  const { markWorkspaceChannelRead, selectChannel } = useChannelActions();
  const {
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    replaceNavigationLocation,
  } = useNavigationActions();
  const { ensureTeamSelected, selectTeam } = useTeamActions();
  const { selectWorkspace } = useWorkspaceActions();
  const { markRead: markInboxRead } = useInboxActions();
  /*
    The notification whose read receipt this window has already sent.

    Routing a notification for another team takes two passes — the first selects
    the team and returns, the second routes — and the receipt goes before the
    team check so the pass that routes already finds it read. That made the
    transition call `markRead` twice for one notification. It stays before the
    check; this remembers the message the receipt landed for, so the second pass
    asks nothing. It is not cleared on failure: a notification whose message the
    inbox does not hold yet returns `false` and is retried on the next pass.
  */
  const sentInboxReceiptFor = useRef<string | null>(null);

  /*
    The issue-key fetch in flight, keyed so the effect rerunning on unrelated
    state does not fetch the same key twice.
  */
  const fetchingIssueKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingBriarLink || !user || loading) return;
    if (pendingBriarLink.kind === "channel") {
      setRequestedRunMessageId(null);
      if (
        !workspaces.some(
          (workspace) => workspace.id === pendingBriarLink.workspaceId,
        )
      ) {
        return;
      }
      if (pendingBriarLink.workspaceId !== activeWorkspaceId) {
        selectWorkspace(pendingBriarLink.workspaceId);
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
      markWorkspaceChannelRead(pendingBriarLink.channelId);
      if (companionMode) {
        setCompanionPage(
          companionChannelPage(organizationChannels, pendingBriarLink.channelId),
        );
      } else {
        navigateToChannel(
          pendingBriarLink.channelId,
          organizationChannels.find(
            (channel) => channel.id === pendingBriarLink.channelId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          pendingBriarLink.workspaceId,
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
    if (pendingBriarLink.kind === "issueKey") {
      const target = pendingBriarLink;
      const keyMatch = target.issueKey.match(/^([A-Za-z0-9]{1,3})-(\d{1,9})$/u);
      if (!keyMatch) {
        setPendingBriarLink(null);
        return;
      }
      const prefix = keyMatch[1].toUpperCase();
      const runNumber = Number(keyMatch[2]);
      const hasPrefix = (candidate: (typeof teams)[number]) =>
        normalizeIssueKeyPrefix(candidate.issueKeyPrefix ?? "") === prefix;
      const team =
        teams.find(
          (candidate) => candidate.id === activeTeamId && hasPrefix(candidate),
        ) ?? teams.find(hasPrefix);
      // Teams may still be loading; the effect reruns when they arrive.
      if (!team) return;

      const openResolvedRun = (runId: string) => {
        setRequestedSessionId(null);
        setRequestedRunMessageId(null);
        setRequestedRunInitialTab(null);
        setRequestedRunId(runId);
        setCompanionPage("issues");
        setCompanionStatus("all");
        navigateToIssue(runId, team.id);
        setPendingBriarLink(null);
      };

      const storedRunId = ((): string | null => {
        const runs = registry.get(runsByIdAtom);
        const ids = registry.get(teamRunIdsAtom(team.id));
        if (ids) {
          for (const id of ids) {
            const run = runs.get(id);
            if (run && run.runNumber === runNumber) return id;
          }
          return null;
        }
        for (const run of runs.values()) {
          if (
            run.runNumber === runNumber &&
            (run.teamId === team.id || run.teamId == null)
          ) {
            return run.id;
          }
        }
        return null;
      })();
      if (storedRunId) {
        openResolvedRun(storedRunId);
        return;
      }

      /*
        The card is outside the loaded page, so resolve the key through the
        list query: the worker matches an issue key or bare number against
        run_number. Fetch once per key.
      */
      if (!token) return;
      if (fetchingIssueKeyRef.current === target.issueKey) return;
      fetchingIssueKeyRef.current = target.issueKey;
      void (async () => {
        try {
          let cursor: string | null = null;
          let result: Awaited<
            ReturnType<typeof resolvers.listDashboardRunsRpc>
          >;
          let match: (typeof result.runs)[number] | undefined;
          do {
            result = await resolvers.listDashboardRunsRpc(token, team.id, {
              query: target.issueKey,
              pageSize: 50,
              cursor,
            });
            match = result.runs.find((run) => run.runNumber === runNumber);
            cursor = result.nextCursor;
          } while (!match && cursor);
          if (!match) throw new Error("issue key not found");
          const currentRuns = registry.get(runsByIdAtom);
          const nextRuns = new Map(currentRuns);
          for (const run of result.runs) nextRuns.set(run.id, run);
          registry.set(runsByIdAtom, nextRuns);
          const currentIds = registry.get(teamRunIdsAtom(team.id));
          if (currentIds) {
            const known = new Set(currentIds);
            const prepended = result.runs
              .map((run) => run.id)
              .filter((id) => !known.has(id));
            if (prepended.length > 0) {
              registry.set(teamRunIdsAtom(team.id), [
                ...prepended,
                ...currentIds,
              ]);
            }
          }
          openResolvedRun(match.id);
        } catch {
          setPendingBriarLink(null);
          toast(t("navigation.issueLinkIssueUnavailable"), { tone: "error" });
          navigateToPage("issues", team.id);
        } finally {
          fetchingIssueKeyRef.current = null;
        }
      })();
      return;
    }
    if (pendingBriarLink.kind === "page") {
      const page = pendingBriarLink.page;
      setPendingBriarLink(null);
      navigateToPage(page);
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
    activeWorkspaceId,
    activeTeamId,
    channelCatalogCursor,
    channelsLoading,
    ensureTeamSelected,
    loading,
    markWorkspaceChannelRead,
    navigateToChannel,
    navigateToIssue,
    navigateToPage,
    organizationChannels,
    workspaces,
    lockedTeamId,
    pendingBriarLink,
    selectChannel,
    selectWorkspace,
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
    registry,
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
      loadedTeamId !== navigationTeamId ||
      (loadedRunIds ?? []).includes(selectedRunId)
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
    loadedRunIds,
    loadedTeamId,
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

    if (
      sentInboxReceiptFor.current !== pendingInboxNotificationTarget.messageId &&
      markInboxRead(pendingInboxNotificationTarget.messageId)
    ) {
      sentInboxReceiptFor.current = pendingInboxNotificationTarget.messageId;
    }
    if (pendingInboxNotificationTarget.projectId !== activeTeamId) {
      selectTeam(pendingInboxNotificationTarget.projectId);
      return;
    }
    if (
      pendingInboxNotificationTarget.kind === "channel" &&
      (channelsLoading ||
        channelCatalogCursor === null ||
        activeWorkspaceId !== targetProject.workspaceId)
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
      markWorkspaceChannelRead(pendingInboxNotificationTarget.targetId);
      if (companionMode) {
        setCompanionPage(
          companionChannelPage(
            organizationChannels,
            pendingInboxNotificationTarget.targetId,
          ),
        );
      } else {
        navigateToChannel(
          pendingInboxNotificationTarget.targetId,
          organizationChannels.find(
            (channel) => channel.id === pendingInboxNotificationTarget.targetId,
          )?.kind === "dm"
            ? "dms"
            : "channels",
          targetProject.workspaceId,
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
    activeWorkspaceId,
    activeTeamId,
    channelCatalogCursor,
    channelsLoading,
    loading,
    markInboxRead,
    markWorkspaceChannelRead,
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
