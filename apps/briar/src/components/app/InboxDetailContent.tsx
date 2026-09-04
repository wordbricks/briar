import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { lazy, Suspense } from "react";

import { useI18n } from "../../i18n";
import { isInboxRunDetailTarget } from "../../lib/inbox-notifications";
import {
  agentSessionAtom,
  runIsProcessingAtom,
} from "../../state/agent-sessions/atoms";
import { inboxDetailTargetAtom } from "../../state/inbox-selection";
import { isSidebarOpenAtom } from "../../state/dialogs/atoms";
import {
  pendingBriarLinkAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "../../state/navigation/atoms";
import { useChannelActions } from "../../state/channels/actions";
import {
  requestedChannelMessageAtom,
  viewingIssueConversationRunIdAtom,
} from "../../state/channels/atoms";
import { useIssueActions } from "../../state/issues/actions";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { useRunDetailActions } from "../../state/run-detail/actions";
import { tokenAtom } from "../../state/session/atoms";
import { runAtom } from "../../state/entities/runs";
import { teamWorkersAtom } from "../../state/entities/workers";
import { loadedTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { useWorkerDispatch } from "../../hooks/useWorkerDispatch";
import { Button } from "../ui/button";
import { LoadingState } from "../ui/loading-state";
import { ChannelsWithCatalog } from "./ChannelViews";
import { RunPageWithRun } from "./RunPageWithRun";
import type { ActivePage } from "../../lib/app-navigation";
import type { InboxNotificationTarget } from "../../generated/tauri";
import type { AutoHuntSession, ProjectAgent } from "../../types";

/*
  The pane the desktop inbox opens next to its list.

  It picks one of four surfaces from the notification's shape — an issue, an
  agent session, a channel message, or the "not on this device yet" states — and
  every one of them needs a different slice of the store. Reading that slice
  here rather than in the shell is what keeps a run edit from re-rendering the
  inbox list beside it.

  The `lazy()` boundary for the session detail moves here with the branch that
  renders it; `RunPageWithRun` and `ChannelsWithCatalog` hold their own.
*/

const TeamAgentSessionDetail = lazy(() =>
  import("../TeamAgentSessionDetail").then((m) => ({
    default: m.TeamAgentSessionDetail,
  })),
);

const lazyViewFallback = <div className="lazy-view-placeholder h-full w-full" />;

export interface InboxDetailContentProps {
  /** The notification the pane was opened for. */
  readonly target: InboxNotificationTarget;
  /** Agents loaded so far, for the mention list and the "who ran this" label. */
  readonly agents: ProjectAgent[];
  /** Runs a dispatch or an auto hunt session is currently working on. */
  readonly channelInboxSyncSignal: string;
  readonly conversationInboxSyncSignal: string;
  /** Leaving the pane for the full issue page, still the shell's history. */
  readonly onNavigateToIssue: (runId: string, teamId?: string | null) => void;
  readonly onNavigateToPage: (page: ActivePage, teamId?: string | null) => void;
  /** Selecting a team, still the session facade's. */
  readonly onEnsureTeamSelected: (teamId: string) => Promise<unknown>;
  readonly onStopSession: (sessionId: string) => Promise<boolean>;
  readonly onSkillSessionAccepted: (session: AutoHuntSession) => void;
}

export function InboxDetailContent({
  agents,
  channelInboxSyncSignal,
  conversationInboxSyncSignal,
  onEnsureTeamSelected,
  onNavigateToIssue,
  onNavigateToPage,
  onSkillSessionAccepted,
  onStopSession,
  target,
}: InboxDetailContentProps) {
  const { t } = useI18n();
  /*
    The pane opens on one notification, so it reads the one run that
    notification points at rather than the board it belongs to. Everything else
    on the board — including the run beside this one — leaves the pane alone.
  */
  const loadedTeamId = useAtomValue(loadedTeamIdAtom);
  // The run is looked up on the board this window has open; a target for a
  // team that is not on screen keeps the loading state it had.
  const isTargetTeamLoaded = loadedTeamId === target.projectId;
  const run = useAtomValue(
    runAtom(
      isInboxRunDetailTarget(target) && isTargetTeamLoaded
        ? target.targetId
        : "",
    ),
  );
  const workers = useAtomValue(teamWorkersAtom(loadedTeamId ?? ""));
  const teams = useAtomValue(teamsAtom);
  const token = useAtomValue(tokenAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const setTarget = useAtomSet(inboxDetailTargetAtom);
  const setPendingBriarLink = useAtomSet(pendingBriarLinkAtom);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedRunMessageId = useAtomSet(requestedRunMessageIdAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setRequestedChannelMessage = useAtomSet(requestedChannelMessageAtom);
  const setViewingIssueConversationRunId = useAtomSet(
    viewingIssueConversationRunIdAtom,
  );
  const setSettingsTarget = useAtomSet(settingsTargetAtom);
  const setIsSidebarOpen = useAtomSet(isSidebarOpenAtom);
  const { openOrganizationChannel, selectChannel } = useChannelActions();
  const { removeIssue } = useIssueActions();
  const { addIssueMessage } = useRunDetailActions();
  const { processIssueNow } = useWorkerDispatch();

  const channelId = target.kind === "channel" ? target.targetId : null;
  // The empty id resolves to `null`, so a notification that is not a session
  // subscribes to none.
  const session = useAtomValue(
    agentSessionAtom(target.kind === "session" ? target.targetId : ""),
  );
  const isProcessing = useAtomValue(runIsProcessingAtom(run?.id ?? ""));
  const isLoading = Boolean(
    isInboxRunDetailTarget(target) && !isTargetTeamLoaded,
  );

  return (
    <Suspense fallback={lazyViewFallback}>
      {run ? (
        <RunPageWithRun
          conversationInboxSyncSignal={conversationInboxSyncSignal}
          highlightedMessageId={
            target.kind === "conversation"
              ? target.conversationMessageId ?? null
              : null
          }
          initialDetailTab={
            target.kind === "conversation" ? "conversation" : undefined
          }
          isProcessing={isProcessing}
          isSidebarOpen
          mentionAgents={agents.filter(
            (agent) => agent.teamId === target.projectId,
          )}
          onBack={() => setTarget(null)}
          onDelete={async () => {
            await removeIssue(run.id);
            setTarget(null);
          }}
          onDependencyOpen={(runId) =>
            setTarget((current) =>
              current
                ? {
                    ...current,
                    kind: "issue",
                    targetId: runId,
                    conversationMessageId: undefined,
                  }
                : current,
            )}
          onRelatedMessageOpen={(relatedMessage) => {
            setTarget(null);
            setPendingBriarLink({ kind: "channel", ...relatedMessage });
          }}
          onOpenFullPage={() => {
            setTarget(null);
            setRequestedSessionId(null);
            setRequestedRunId(run.id);
            setRequestedRunMessageId(
              target.kind === "conversation"
                ? target.conversationMessageId ?? null
                : null,
            );
            setRequestedRunInitialTab(
              target.kind === "conversation" ? "conversation" : null,
            );
            onNavigateToIssue(run.id, target.projectId);
          }}
          onProcessNow={() => {
            setTarget(null);
            processIssueNow(run);
          }}
          onSendIssueMessage={(input) => addIssueMessage(run.id, input)}
          onViewingIssueConversationChange={setViewingIssueConversationRunId}
          performedAgentName={
            agents.find((agent) => agent.id === run.agentId)?.name ?? null
          }
          projectId={target.projectId}
          runId={run.id}
        />
      ) : session ? (
        <TeamAgentSessionDetail
          isSidebarOpen
          issueKeyPrefix={
            teams.find((team) => team.id === session.projectId)?.issueKeyPrefix
          }
          onBack={() => setTarget(null)}
          onIssueOpen={(runId) =>
            setTarget((current) =>
              current ? { ...current, kind: "issue", targetId: runId } : current,
            )}
          onStop={() => onStopSession(session.id)}
          session={session}
          token={token}
          workers={workers ?? []}
        />
      ) : channelId && activeOrganizationId && token ? (
        <ChannelsWithCatalog
          activeChannelId={channelId}
          channelInboxSyncSignal={channelInboxSyncSignal}
          inboxDetail
          onChannelSelect={selectChannel}
          onInboxDetailClose={() => {
            setRequestedChannelMessage(null);
            setTarget(null);
          }}
          onInboxChannelOpen={(nextChannelId) => {
            setTarget(null);
            openOrganizationChannel(nextChannelId);
          }}
          onCreateAgent={() => {
            setSettingsTarget({
              scope: "organization",
              organizationId: activeOrganizationId,
              section: "agents",
            });
            setIsSidebarOpen(true);
            onNavigateToPage("settings");
          }}
          onIssueCreated={async (teamId, runId) => {
            await onEnsureTeamSelected(teamId);
            setRequestedRunId(runId);
            setRequestedChannelMessage(null);
            setTarget(null);
            onNavigateToIssue(runId, teamId);
          }}
          onSkillSessionAccepted={onSkillSessionAccepted}
        />
      ) : isLoading ? (
        <div
          className="inbox-detail-loading grid h-full w-full place-items-center bg-card text-xs text-muted-foreground"
          role="status"
        >
          <LoadingState label={t("inbox.detailLoading")} />
        </div>
      ) : (
        <div
          className="inbox-detail-unavailable flex h-full w-full flex-col items-center justify-center gap-3.5 bg-card px-8 py-8 text-center text-muted-foreground"
          role="alert"
        >
          <strong className="text-sm font-semibold text-foreground">
            {t("run.loadFailed")}
          </strong>
          <Button
            className="min-h-[34px] rounded-[9px] px-3 text-xs font-semibold"
            onClick={() => setTarget(null)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("common.close")}
          </Button>
        </div>
      )}
    </Suspense>
  );
}
