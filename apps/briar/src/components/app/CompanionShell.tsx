import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useMemo, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { getMobilePlatform } from "../../lib/platform";
import { activeOrganizationTeams } from "../../lib/team-window-scope";
import { CompanionBottomNavigation } from "../CompanionBottomNavigation";
import { CompanionHeaderWithSession } from "./CompanionHeaderWithSession";
import { CompanionInbox } from "../InboxSelectionBoundary";
import { KeepAliveSlot } from "./KeepAliveSlot";
import { inboxNotificationTarget } from "../../lib/inbox-notifications";
import {
  createIssueTeamIdAtom,
  isIssueDialogOpenAtom,
  quickProcessErrorAtom,
} from "../../state/dialogs/atoms";
import {
  companionPageAtom,
  companionStatusAtom,
  issueListRequestKeyAtom,
  pendingBriarLinkAtom,
  pendingInboxNotificationTargetAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
} from "../../state/navigation/atoms";
import {
  activeKeptPageAtom,
  keptPageKey,
  keptPageKeysAtom,
  type KeptPage,
} from "../../state/navigation/keep-alive";
import { useChannelActions } from "../../state/channels/actions";
import {
  activeChannelIdAtom,
  unreadDirectMessageCountAtom,
  viewingIssueConversationRunIdAtom,
} from "../../state/channels/atoms";
import { useInboxActions } from "../../state/inbox/actions";
import {
  conversationInboxSyncSignalAtom,
  visibleInboxUnreadCountAtom,
} from "../../state/inbox/atoms";
import { useIssueActions } from "../../state/issues/actions";
import { useOrganizationActions } from "../../state/organization/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { teamWorkersAtom } from "../../state/entities/workers";
import { demoMode, lockedTeamIdAtom } from "../../state/platform";
import { useRunDetailActions } from "../../state/run-detail/actions";
import { appErrorAtom } from "../../state/app-error";
import { useSessionActions } from "../../state/session/actions";
import { loadingAtom, tokenAtom, userAtom } from "../../state/session/atoms";
import { useSyncActions } from "../../state/sync/actions";
import { useTeamActions } from "../../state/team/actions";
import {
  activeTeamAtom,
  activeTeamIdAtom,
  teamsAtom,
} from "../../state/team/atoms";
import {
  useMobileBackHandler,
  useMobileNavigationGestures,
} from "../../hooks/useMobileNavigation";
import { useWorkerDispatch } from "../../hooks/useWorkerDispatch";
import {
  CompanionChannelsWithCatalog,
  DirectMessagesWithCatalog,
} from "./ChannelViews";
import { HuntDashboardWithTeam } from "./HuntDashboardWithTeam";
import { useAgentSessionActions } from "../../state/agent-sessions/actions";
import { agentSessionAtom } from "../../state/agent-sessions/atoms";
import { TeamLobbyWithDashboard } from "./TeamViewsWithDashboard";
import type { createCachedTeamUsageSummaryLoader } from "../../lib/team-usage-summary";
import type { ProjectAgent } from "../../types";

/*
  The phone shell: a header, one page at a time, and a bottom bar.

  It used to be the early return of `App.tsx`, which is why the domain effects
  and the dispatch dialog each had a second mount inside it. Both are hoisted
  above the shell choice now, and what is left here is the page chain itself.

  Everything the pages render from — the session, the selected organization and
  team, the companion page and status, the requested run, the agent sessions,
  the inbox — is read from the store, and every call goes through a `state/`
  action. What the shell still takes as props is the agent list and the team's
  usage loader, whose cache belongs to the app.

  The chain is in two halves, as the desktop's is. The phone's three heavy
  pages — the task board, Home's channel list and the inbox, plus DMs — are
  rendered by key into `KeepAliveSlot`s and survive a tap on the bottom bar,
  which is the walk this shell is built around: the bar is four destinations one
  thumb away from each other, so an unmount per tap is the transition cost paid
  most often here. The settings screen, the team lobby and an open agent session
  are the chain's own branches and unmount on leave. Which of the two a page is
  belongs to `state/navigation/keep-alive.ts`, in the same order as this chain.
*/

const CompanionSettings = lazy(() =>
  import("../CompanionSettings").then((m) => ({
    default: m.CompanionSettings,
  })),
);
const TeamAgentSessionDetail = lazy(() =>
  import("../TeamAgentSessionDetail").then((m) => ({
    default: m.TeamAgentSessionDetail,
  })),
);

const lazyViewFallback = <div className="lazy-view-placeholder h-full w-full" />;

export interface CompanionShellProps {
  /** The selected team's agents, for the board's labels. */
  readonly agents: ProjectAgent[];
  readonly loadTeamHomeUsage: ReturnType<
    typeof createCachedTeamUsageSummaryLoader
  >;
}

export function CompanionShell({
  agents,
  loadTeamHomeUsage,
}: CompanionShellProps) {
  const { t } = useI18n();
  const mobilePlatform = getMobilePlatform() ?? "android";
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const loading = useAtomValue(loadingAtom);
  const teams = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeTeam = useAtomValue(activeTeamAtom) ?? undefined;
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const keptPage = useAtomValue(activeKeptPageAtom);
  const keptPageKeys = useAtomValue(keptPageKeysAtom);
  // The one projection this shell shows of the open team: the agent session
  // detail lists the workers a session ran on. A run edit leaves it alone.
  const workers = useAtomValue(teamWorkersAtom(activeTeamId ?? ""));
  const sessionError = useAtomValue(appErrorAtom);
  const conversationInboxSyncSignal = useAtomValue(
    conversationInboxSyncSignalAtom,
  );
  const inboxUnreadCount = useAtomValue(visibleInboxUnreadCountAtom);
  const [companionPage, setCompanionPage] = useAtom(companionPageAtom);
  const setCompanionStatus = useAtomSet(companionStatusAtom);
  const [requestedRunId, setRequestedRunId] = useAtom(requestedRunIdAtom);
  const requestedRunMessageId = useAtomValue(requestedRunMessageIdAtom);
  const setRequestedRunMessageId = useAtomSet(requestedRunMessageIdAtom);
  const requestedRunInitialTab = useAtomValue(requestedRunInitialTabAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const [requestedSessionId, setRequestedSessionId] = useAtom(
    requestedSessionIdAtom,
  );
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setPendingBriarLink = useAtomSet(pendingBriarLinkAtom);
  const setPendingInboxNotificationTarget = useAtomSet(
    pendingInboxNotificationTargetAtom,
  );
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useAtom(
    isIssueDialogOpenAtom,
  );
  const setCreateIssueTeamId = useAtomSet(createIssueTeamIdAtom);
  const quickProcessError = useAtomValue(quickProcessErrorAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const unreadDirectMessageCount = useAtomValue(unreadDirectMessageCountAtom);
  const setViewingIssueConversationRunId = useAtomSet(
    viewingIssueConversationRunIdAtom,
  );
  const { selectChannel } = useChannelActions();
  const inbox = useInboxActions();
  const { deleteAccount, logout, updateAccountProfile } = useSessionActions();
  const { selectOrganization } = useOrganizationActions();
  const { ensureTeamSelected, selectTeam } = useTeamActions();
  const { refreshActiveTeam } = useSyncActions();
  const { removeIssue, transferIssue } = useIssueActions();
  const { addIssueMessage } = useRunDetailActions();
  const { processIssueNow } = useWorkerDispatch();
  const organizationTeams = useMemo(
    () =>
      activeOrganizationTeams(
        teams,
        lockedTeamId,
        activeOrganizationId,
        activeTeamId,
      ),
    [activeOrganizationId, activeTeamId, lockedTeamId, teams],
  );
  const agentSessions = useAgentSessionActions();
  // Read under the empty id when nothing is open, so a session the phone is not
  // showing never re-renders the shell.
  const requestedCompanionSession = useAtomValue(
    agentSessionAtom(requestedSessionId ?? ""),
  );

  /*
    The phone's back gesture. It unwinds the shell's own stack — an open agent
    session first, then a secondary page back towards the issue list — and
    hands anything else to the platform.
  */
  useMobileNavigationGestures(true);
  useMobileBackHandler(
    () => {
      if (requestedSessionId) {
        setRequestedSessionId(null);
        return true;
      }
      if (companionPage === "issues") return false;
      setCompanionPage(companionPage === "lobby" ? "home" : "issues");
      setRequestedRunId(null);
      setRequestedSessionId(null);
      return true;
    },
    { enabled: true },
  );

  /*
    The kept page on screen. Only this one is built: a hidden slot draws the
    element it was last given while it was visible, so the page behind an open
    agent session never redraws under it.

    Each of the three lists brings its own bottom bar because each highlights a
    different destination, which is exactly how the chain drew them before.
  */
  const renderKeptPage = ({ kind }: KeptPage): ReactNode => {
    switch (kind) {
      case "channels":
        return (
          <>
            <CompanionChannelsWithCatalog
              onSkillSessionAccepted={agentSessions.adoptRemoteSession}
              onIssueOpen={async (projectId, runId) => {
                await ensureTeamSelected(projectId);
                setRequestedRunId(runId);
                setIssueListRequestKey((key) => key + 1);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
              onLobbyOpen={() => setCompanionPage("lobby")}
            />
            <CompanionBottomNavigation
              activeDestination="home"
              onDmsOpen={() => setCompanionPage("dms")}
              onInboxOpen={() => setCompanionPage("inbox")}
              onHomeOpen={() => {}}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inboxUnreadCount}
            />
          </>
        );
      case "inbox":
        return (
          <>
            <CompanionInbox
              companionMode
              isSidebarOpen
              onOpen={(message) =>
                setPendingInboxNotificationTarget(
                  inboxNotificationTarget(message),
                )}
              projects={organizationTeams}
            />
            <CompanionBottomNavigation
              activeDestination="inbox"
              onDmsOpen={() => setCompanionPage("dms")}
              onInboxOpen={() => {}}
              onHomeOpen={() => setCompanionPage("home")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inboxUnreadCount}
            />
          </>
        );
      case "dms":
        return (
          <>
            <DirectMessagesWithCatalog
              activeChannelId={activeChannelId}
              isSidebarOpen
              onChannelSelect={selectChannel}
              onIssueCreated={async (projectId, runId) => {
                await ensureTeamSelected(projectId);
                setRequestedRunId(runId);
                setCompanionStatus("all");
                setCompanionPage("issues");
              }}
              onSkillSessionAccepted={agentSessions.adoptRemoteSession}
            />
            <CompanionBottomNavigation
              activeDestination="dms"
              onDmsOpen={() => {}}
              onInboxOpen={() => setCompanionPage("inbox")}
              onHomeOpen={() => setCompanionPage("home")}
              onStatusChange={(status) => {
                setCompanionStatus(status);
                setCompanionPage("issues");
              }}
              unreadDmCount={unreadDirectMessageCount}
              unreadInboxCount={inboxUnreadCount}
            />
          </>
        );
      default:
        return (
          <HuntDashboardWithTeam
            agents={agents}
            conversationInboxSyncSignal={conversationInboxSyncSignal}
            companionMode
            companionUnreadDmCount={unreadDirectMessageCount}
            companionUnreadInboxCount={inboxUnreadCount}
            error={quickProcessError ?? sessionError}
            isIssueDialogOpen={isIssueDialogOpen}
            requestedRunId={requestedRunId}
            requestedRunMessageId={requestedRunMessageId}
            requestedRunInitialTab={requestedRunInitialTab}
            isSidebarOpen
            onCompanionDmsOpen={() => setCompanionPage("dms")}
            onCompanionInboxOpen={() => setCompanionPage("inbox")}
            onCompanionHomeOpen={() => setCompanionPage("home")}
            onCompanionStatusChange={(status) => {
              setCompanionStatus(status);
              setCompanionPage("issues");
            }}
            onIssueDialogOpenChange={(isOpen) => {
              if (!isOpen) setCreateIssueTeamId(null);
              setIsIssueDialogOpen(isOpen);
            }}
            onIssueViewed={inbox.markIssueRead}
            onViewingIssueConversationChange={setViewingIssueConversationRunId}
            onDeleteIssue={removeIssue}
            onTransferIssue={transferIssue}
            onRelatedMessageOpen={(relatedMessage) => {
              setPendingBriarLink({ kind: "channel", ...relatedMessage });
            }}
            onProcessIssueNow={processIssueNow}
            onRequestedRunOpen={() => {
              setRequestedRunId(null);
              setRequestedRunMessageId(null);
              setRequestedRunInitialTab(null);
            }}
            onSendIssueMessage={addIssueMessage}
            projects={organizationTeams}
          />
        );
    }
  };

  const activeKeptKey = keptPage === null ? null : keptPageKey(keptPage);
  /*
    The derivation already contains the key on screen; the union is a guard
    against a page that is somehow not in its own history, whose cost is a stale
    slot and whose alternative is a blank screen.
  */
  const slotKeys =
    activeKeptKey !== null && !keptPageKeys.includes(activeKeptKey)
      ? [...keptPageKeys, activeKeptKey]
      : keptPageKeys;

  if (!user) return null;

  return (
    <div
      className={`app-shell companion-shell platform-${mobilePlatform}`}
    >
      <CompanionHeaderWithSession
        hasOpenAgentSession={requestedCompanionSession !== null}
        onLogout={() => void logout()}
        onMarkAllRead={inbox.markAllRead}
        onOrganizationChange={(organizationId) => {
          selectOrganization(organizationId);
          setCompanionPage("issues");
          setCompanionStatus("all");
          setRequestedRunId(null);
          setRequestedSessionId(null);
        }}
        onRefresh={() => void refreshActiveTeam()}
        onSettings={() => setCompanionPage("settings")}
        onTeamChange={(teamId) => {
          selectTeam(teamId);
          setCompanionPage("issues");
          setCompanionStatus("all");
          setRequestedRunId(null);
          setRequestedSessionId(null);
        }}
        unreadInboxCount={inboxUnreadCount}
      />
      {slotKeys.map((slotKey) => (
        <KeepAliveSlot
          key={slotKey}
          pageKey={slotKey}
          visible={slotKey === activeKeptKey}
        >
          <Suspense fallback={lazyViewFallback}>
            {slotKey === activeKeptKey && keptPage !== null
              ? renderKeptPage(keptPage)
              : null}
          </Suspense>
        </KeepAliveSlot>
      ))}
      {activeKeptKey !== null ? null : (
      <Suspense fallback={lazyViewFallback}>
      {requestedCompanionSession ? (
        <TeamAgentSessionDetail
          isSidebarOpen
          issueKeyPrefix={
            teams.find(
              (project) => project.id === requestedCompanionSession.projectId,
            )?.issueKeyPrefix
          }
          onBack={() => setRequestedSessionId(null)}
          onIssueOpen={(runId) => {
            setRequestedSessionId(null);
            setRequestedRunId(runId);
            setCompanionStatus("all");
            setCompanionPage("issues");
          }}
          onStop={() => agentSessions.stopSession(requestedCompanionSession.id)}
          session={requestedCompanionSession}
          token={token}
          workers={workers ?? []}
        />
      ) : companionPage === "settings" ? (
        <CompanionSettings
          onBack={() => setCompanionPage("issues")}
          onAccountDelete={deleteAccount}
          onAccountSave={updateAccountProfile}
          user={user}
        />
      ) : companionPage === "lobby" && activeTeam ? (
        <>
          <TeamLobbyWithDashboard
            companionMode
            isSidebarOpen={false}
            onBack={() => setCompanionPage("home")}
            onLoadUsageSummary={loadTeamHomeUsage}
            onOpenAgents={() => setCompanionPage("issues")}
            onOpenIssue={(runId) => {
              setRequestedRunId(runId);
              setCompanionStatus("all");
              setCompanionPage("issues");
            }}
            onOpenIssues={() => {
              setRequestedRunId(null);
              setCompanionStatus("all");
              setCompanionPage("issues");
            }}
            onOpenRepository={() => undefined}
            onOpenSettings={() => setCompanionPage("settings")}
            project={activeTeam}
          />
          <CompanionBottomNavigation
            activeDestination="home"
            onDmsOpen={() => setCompanionPage("dms")}
            onInboxOpen={() => setCompanionPage("inbox")}
            onHomeOpen={() => setCompanionPage("home")}
            onStatusChange={(status) => {
              setCompanionStatus(status);
              setCompanionPage("issues");
            }}
            unreadDmCount={unreadDirectMessageCount}
            unreadInboxCount={inboxUnreadCount}
          />
        </>
      ) : null}
      </Suspense>
      )}
    </div>
  );
}
