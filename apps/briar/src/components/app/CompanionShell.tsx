import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense, useMemo } from "react";

import { useI18n } from "../../i18n";
import { getMobilePlatform } from "../../lib/platform";
import { activeOrganizationTeams } from "../../lib/team-window-scope";
import { CompanionBottomNavigation } from "../CompanionBottomNavigation";
import { CompanionHeaderWithSession } from "./CompanionHeaderWithSession";
import { Inbox } from "../Inbox";
import { inboxNotificationTarget } from "../../lib/inbox-notifications";
import {
  activePlanningProjectIdAtom,
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
import { useChannelActions } from "../../state/channels/actions";
import {
  activeChannelIdAtom,
  unreadDirectMessageCountAtom,
  viewingIssueConversationRunIdAtom,
} from "../../state/channels/atoms";
import { useIssueActions } from "../../state/issues/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { demoMode, lockedTeamIdAtom } from "../../state/platform";
import { useRunDetailActions } from "../../state/run-detail/actions";
import type { AccountProfileInput } from "../../state/session/actions";
import {
  loadingAtom,
  sessionErrorAtom,
  tokenAtom,
  userAtom,
} from "../../state/session/atoms";
import { activeDashboardAtom } from "../../state/sync/view";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { localInventoryErrorAtom } from "../../state/workspace/atoms";
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
import { TeamLobbyWithDashboard } from "./TeamViewsWithDashboard";
import type { createCachedTeamUsageSummaryLoader } from "../../lib/team-usage-summary";
import type { InboxMessageWithReadState } from "../../hooks/useInbox";
import type {
  AutoHuntSession,
  Project,
  ProjectAgent,
  SessionUser,
} from "../../types";

/*
  The phone shell: a header, one page at a time, and a bottom bar.

  It used to be the early return of `App.tsx`, which is why the domain effects
  and the dispatch dialog each had a second mount inside it. Both are hoisted
  above the shell choice now, and what is left here is the page chain itself.

  Everything the pages render from — the session, the selected organization and
  team, the companion page and status, the requested run — is read from the
  store. What the shell takes as props is the three things that are still the
  app's: the inbox, the auto hunt sessions, and the session facade's calls.
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

/** The inbox, which is still `useInbox`'s and shared with the desktop shell. */
export interface CompanionInbox {
  readonly messages: InboxMessageWithReadState[];
  readonly unreadCount: number;
  readonly markAllRead: () => void;
  readonly markRead: (messageId: string) => void;
  readonly markUnread: (messageId: string) => void;
  readonly markIssueRead: (runId: string) => void;
}

/** Auto hunt sessions, still `useAutoHuntSessions`'s. */
export interface CompanionSessions {
  readonly list: AutoHuntSession[];
  readonly adoptRemoteSession: (session: AutoHuntSession) => string;
  readonly stopSession: (sessionId: string) => Promise<boolean>;
}

/** The session facade calls the shell has no store equivalent for yet. */
export interface CompanionSession {
  readonly deleteAccount: (confirmation: string) => Promise<void>;
  readonly ensureTeamSelected: (teamId: string) => Promise<unknown>;
  readonly logout: () => Promise<unknown>;
  readonly refresh: () => Promise<unknown> | unknown;
  readonly selectOrganization: (organizationId: string) => void;
  readonly selectTeam: (teamId: string) => void;
  readonly updateAccountProfile: (
    input: AccountProfileInput,
  ) => Promise<SessionUser>;
}

export interface CompanionShellProps {
  /** The selected team, as the shell resolved it for its hooks. */
  readonly activeTeam: Project | undefined;
  /** The selected team's agents, for the board's labels. */
  readonly agents: ProjectAgent[];
  /** Runs a dispatch or an auto hunt session is currently working on. */
  readonly processingIssueIds: ReadonlySet<string>;
  readonly channelInboxSyncSignal: string;
  readonly conversationInboxSyncSignal: string;
  readonly inbox: CompanionInbox;
  readonly sessions: CompanionSessions;
  readonly session: CompanionSession;
  readonly loadProjectHomeUsage: ReturnType<
    typeof createCachedTeamUsageSummaryLoader
  >;
}

export function CompanionShell({
  activeTeam,
  agents,
  channelInboxSyncSignal,
  conversationInboxSyncSignal,
  inbox,
  loadProjectHomeUsage,
  processingIssueIds,
  session,
  sessions,
}: CompanionShellProps) {
  const { t } = useI18n();
  const mobilePlatform = getMobilePlatform() ?? "android";
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const loading = useAtomValue(loadingAtom);
  const teams = useAtomValue(teamsAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
  const rawSessionError = useAtomValue(sessionErrorAtom);
  const inventoryError = useAtomValue(localInventoryErrorAtom);
  const sessionError = rawSessionError ?? inventoryError;
  const [companionPage, setCompanionPage] = useAtom(companionPageAtom);
  const [companionStatus, setCompanionStatus] = useAtom(companionStatusAtom);
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
  const activePlanningProjectId = useAtomValue(activePlanningProjectIdAtom);
  const quickProcessError = useAtomValue(quickProcessErrorAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const unreadDirectMessageCount = useAtomValue(unreadDirectMessageCountAtom);
  const setViewingIssueConversationRunId = useAtomSet(
    viewingIssueConversationRunIdAtom,
  );
  const { selectChannel } = useChannelActions();
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
  const requestedCompanionSession =
    sessions.list.find((candidate) => candidate.id === requestedSessionId) ??
    null;

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

  if (!user) return null;

  return (
    <div
      className={`app-shell companion-shell platform-${mobilePlatform}`}
    >
      <CompanionHeaderWithSession
        hasOpenAgentSession={requestedCompanionSession !== null}
        onLogout={() => void session.logout()}
        onMarkAllRead={inbox.markAllRead}
        onOrganizationChange={(organizationId) => {
          session.selectOrganization(organizationId);
          setCompanionPage("issues");
          setCompanionStatus("all");
          setRequestedRunId(null);
          setRequestedSessionId(null);
        }}
        onRefresh={() => void session.refresh()}
        onSettings={() => setCompanionPage("settings")}
        onTeamChange={(teamId) => {
          session.selectTeam(teamId);
          setCompanionPage("issues");
          setCompanionStatus("all");
          setRequestedRunId(null);
          setRequestedSessionId(null);
        }}
        unreadInboxCount={inbox.unreadCount}
      />
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
          onStop={() => sessions.stopSession(requestedCompanionSession.id)}
          session={requestedCompanionSession}
          token={token}
          workers={dashboard?.workers ?? []}
        />
      ) : companionPage === "settings" ? (
        <CompanionSettings
          onBack={() => setCompanionPage("issues")}
          onAccountDelete={session.deleteAccount}
          onAccountSave={session.updateAccountProfile}
          user={user}
        />
      ) : companionPage === "home" &&
        activeOrganizationId &&
        (token || demoMode) ? (
        <>
          <CompanionChannelsWithCatalog
            channelInboxSyncSignal={channelInboxSyncSignal}
            onSkillSessionAccepted={sessions.adoptRemoteSession}
            onIssueOpen={async (projectId, runId) => {
              await session.ensureTeamSelected(projectId);
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
            unreadInboxCount={inbox.unreadCount}
          />
        </>
      ) : companionPage === "lobby" && activeTeam ? (
        <>
          <TeamLobbyWithDashboard
            companionMode
            isSidebarOpen={false}
            onBack={() => setCompanionPage("home")}
            onLoadUsageSummary={loadProjectHomeUsage}
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
            unreadInboxCount={inbox.unreadCount}
          />
        </>
      ) : companionPage === "inbox" ? (
        <>
          <Inbox
            companionMode
            isSidebarOpen
            messages={inbox.messages}
            onMarkAllRead={inbox.markAllRead}
            onMarkRead={inbox.markRead}
            onMarkUnread={inbox.markUnread}
            onOpen={(message) =>
              setPendingInboxNotificationTarget(
                inboxNotificationTarget(message),
              )}
            projects={organizationTeams}
            unreadCount={inbox.unreadCount}
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
            unreadInboxCount={inbox.unreadCount}
          />
        </>
      ) : companionPage === "dms" && activeOrganizationId && token ? (
        <>
          <DirectMessagesWithCatalog
            activeChannelId={activeChannelId}
            channelInboxSyncSignal={channelInboxSyncSignal}
            isSidebarOpen
            onChannelSelect={selectChannel}
            onIssueCreated={async (projectId, runId) => {
              await session.ensureTeamSelected(projectId);
              setRequestedRunId(runId);
              setCompanionStatus("all");
              setCompanionPage("issues");
            }}
            onSkillSessionAccepted={sessions.adoptRemoteSession}
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
            unreadInboxCount={inbox.unreadCount}
          />
        </>
      ) : (
        <HuntDashboardWithTeam
          agents={agents}
          conversationInboxSyncSignal={conversationInboxSyncSignal}
          companionMode
          companionStatus={companionStatus}
          companionUnreadDmCount={unreadDirectMessageCount}
          companionUnreadInboxCount={inbox.unreadCount}
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
          processingIssueIds={processingIssueIds}
          projects={organizationTeams}
          activeIssueProjectId={activePlanningProjectId}
          sessions={sessions.list}
        />
      )}
      </Suspense>
    </div>
  );
}
