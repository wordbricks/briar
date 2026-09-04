import { useAtomValue } from "@effect/atom-react";
import { ArrowLeft, MonitorUp, Play } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useState } from "react";

import { MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import {
  agentDispatchSessionIdAtom,
  agentSessionAtom,
} from "../state/agent-sessions/atoms";
import { useI18n } from "../i18n";
import {
  executeTeamAgentTask,
  type TeamAgentTaskSessionSettlement,
  type TeamAgentTaskSessionStart,
} from "../lib/team-agent-execution";
import {
  agentWithSkillRuntime,
  agentWithSkillsRuntime,
} from "../lib/team-agent";
import { runTeamAgent } from "../lib/team-llm";
import { loadManagedComputers } from "../lib/api";
import { supportsManagedComputerRemoteDesktop } from "../lib/platform";
import type {
  HuntRun,
  ManagedComputer,
  ProjectAgent,
  TeamAgentBoard,
} from "../types";
import { ManagedComputerRemoteDesktop } from
  "./ManagedComputerRemoteDesktop";
import { TeamAgentSessionDetail } from "./TeamAgentSessionDetail";
import { TeamAgentSessions } from "./TeamAgentSessions";
import {
  TeamAgentTaskDialog,
  type TeamAgentTaskDialogSubmit,
} from "./TeamAgentTaskDialog";
import { cn } from "../lib/utils";

export type {
  TeamAgentTaskSessionSettlement,
  TeamAgentTaskSessionStart,
} from "../lib/team-agent-execution";

export function TeamAgentDetail({
  agent,
  board,
  companionMode = false,
  isSidebarOpen,
  onBack,
  onIssueOpen,
  onRequestedSessionOpen,
  onStartRemoteTask,
  onSettleTaskSession,
  onStopSession,
  onStartAutoHunt,
  onStartTaskSession,
  requestedSessionId,
  isStarting: isExternalStartPending = false,
  token = null,
}: {
  agent: ProjectAgent;
  /** The team's board, or `null` while none is on screen. */
  board: TeamAgentBoard | null;
  companionMode?: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onIssueOpen: (runId: string) => void;
  onRequestedSessionOpen?: () => void;
  onStartRemoteTask?: (input: {
    request: string;
    workerId: string;
    skillId: string;
  }) => string | Promise<string>;
  onSettleTaskSession: (
    sessionId: string,
    settlement: TeamAgentTaskSessionSettlement,
  ) => void;
  onStopSession: (sessionId: string) => Promise<boolean>;
  onStartAutoHunt: (
    runs: HuntRun[],
    options?: {
      coordinatorConversationId?: string | null;
      parentSessionId?: string;
      maxIssues?: number;
      targetRunIds?: string[];
      retryReason?: string | null;
    },
  ) => string | Promise<string>;
  onStartTaskSession: (session: TeamAgentTaskSessionStart) => void;
  requestedSessionId: string | null;
  isStarting?: boolean;
  token?: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [remoteComputer, setRemoteComputer] = useState<ManagedComputer | null>(
    null,
  );
  const [remoteComputerTarget, setRemoteComputerTarget] =
    useState<ManagedComputer | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    requestedSessionId,
  );
  /*
    The open session and the requested one are read under the empty id when
    there is none, which is how "not subscribed right now" is spelled without a
    conditional hook: a session this page is not showing never wakes it.
  */
  const openSession = useAtomValue(agentSessionAtom(selectedSessionId ?? ""));
  const requestedSession = useAtomValue(
    agentSessionAtom(requestedSessionId ?? ""),
  );
  const belongsHere = (session: typeof openSession) =>
    session?.projectId === agent.teamId && session.agentId === agent.id
      ? session
      : null;
  const selectedSession = belongsHere(openSession);
  useMobileBackHandler(
    () => {
      if (!companionMode) return false;
      if (isTaskDialogOpen) {
        setIsTaskDialogOpen(false);
        return true;
      }
      if (selectedSessionId) {
        setSelectedSessionId(null);
        return true;
      }
      onBack();
      return true;
    },
    { enabled: companionMode, priority: 200 },
  );

  const hasRequestedSession = Boolean(belongsHere(requestedSession));
  useEffect(() => {
    if (!requestedSessionId || !hasRequestedSession) return;
    setSelectedSessionId(requestedSessionId);
    onRequestedSessionOpen?.();
  }, [hasRequestedSession, onRequestedSessionOpen, requestedSessionId]);

  useEffect(() => {
    if (selectedSession) setIsTaskDialogOpen(false);
  }, [selectedSession]);

  useEffect(() => {
    setRemoteComputerTarget(null);
    if (
      !token ||
      !board?.team.organizationId ||
      !agent.designatedWorkerId ||
      agent.computerUsePolicy !== "unattended" ||
      !supportsManagedComputerRemoteDesktop()
    ) {
      return;
    }
    let cancelled = false;
    void loadManagedComputers(token, board.team.organizationId)
      .then((response) => {
        if (cancelled) return;
        setRemoteComputerTarget(response.computers.find((computer) =>
          computer.deviceId === agent.designatedWorkerId &&
          (computer.state === "needs_setup" || computer.state === "ready")
        ) ?? null);
      })
      .catch(() => {
        if (!cancelled) setRemoteComputerTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    agent.computerUsePolicy,
    agent.designatedWorkerId,
    board?.team.organizationId,
    token,
  ]);

  // A task that spawned a worker dispatch shows the dispatch: that is where the
  // work is. The family answers `null` for the empty id, so a page with nothing
  // open subscribes to nothing.
  const dispatchSessionId = useAtomValue(
    agentDispatchSessionIdAtom(
      selectedSession?.sessionType === "task" ? selectedSession.id : "",
    ),
  );
  useEffect(() => {
    if (dispatchSessionId) setSelectedSessionId(dispatchSessionId);
  }, [dispatchSessionId]);

  const openTaskDialog = () => {
    setIsTaskDialogOpen(true);
  };

  const isTaskStarting = isExternalStartPending || isStarting;

  const submit = async (input: TeamAgentTaskDialogSubmit) => {
    if (isTaskStarting || !board) return;
    setIsStarting(true);
    try {
      if (input.workerId) {
        if (!onStartRemoteTask) {
          throw new Error(t("agents.selectRunnableWorker"));
        }
        const sessionId = await onStartRemoteTask({
          request: input.request,
          workerId: input.workerId,
          skillId: input.skill.id,
        });
        setSelectedSessionId(sessionId);
        return;
      }
      const sessionId = crypto.randomUUID();
      setSelectedSessionId(sessionId);
      const runtimeAgent = agentWithSkillRuntime(agent, input.skill);
      await executeTeamAgentTask(
        {
          runAgent: runTeamAgent,
          startSession: (session) => {
            onStartTaskSession(session);
            setIsStarting(false);
          },
          settleSession: onSettleTaskSession,
          startAutoHunt: onStartAutoHunt,
        },
        {
          agent: runtimeAgent,
          board,
          message: input.request,
          sessionId,
          skillId: input.skill.id,
        },
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : String(caught), {
        tone: "error",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const sendFollowUp = async (message: string) => {
    if (
      companionMode ||
      !board ||
      !selectedSession ||
      selectedSession.sessionType !== "task" ||
      selectedSession.status === "running" ||
      !selectedSession.conversationId
    ) {
      throw new Error(t("agents.followUpUnavailable"));
    }
    const selectedSkill = selectedSession.skillId
      ? agent.skills.find((skill) => skill.id === selectedSession.skillId)
      : null;
    if (selectedSession.skillId && !selectedSkill) {
      throw new Error(t("agents.followUpUnavailable"));
    }
    const runtimeAgent = selectedSkill
      ? agentWithSkillRuntime(agent, selectedSkill)
      : selectedSession.trigger === "scheduled"
        ? agentWithSkillsRuntime(agent)
        : agent;
    await executeTeamAgentTask(
      {
        runAgent: runTeamAgent,
        startSession: onStartTaskSession,
        settleSession: onSettleTaskSession,
        startAutoHunt: onStartAutoHunt,
      },
      {
        agent: runtimeAgent,
        board,
        message,
        skillId: selectedSession.skillId,
        sessionId: selectedSession.id,
        conversationId: selectedSession.conversationId,
        workspaceRoot: selectedSession.workspaceRoot,
        isFollowUp: true,
      },
    );
  };

  if (selectedSession) {
    return (
      <TeamAgentSessionDetail
        isSidebarOpen={isSidebarOpen}
        issueKeyPrefix={board?.team.issueKeyPrefix}
        onBack={() => setSelectedSessionId(null)}
        onIssueOpen={onIssueOpen}
        onFollowUp={companionMode ? undefined : sendFollowUp}
        onStop={() => onStopSession(selectedSession.id)}
        session={selectedSession}
        token={token}
        workers={board?.workers ?? []}
      />
    );
  }

  return (
    <MainContent id="project-agent-detail">
      <PageHeader
        action={
          <div className="flex items-center gap-2">
            {remoteComputerTarget ? (
              <Button
                aria-label={t("managedComputer.remote.open")}
                className="h-[34px] px-3 text-xs active:scale-[.97]"
                onClick={() => setRemoteComputer(remoteComputerTarget)}
                title={t("managedComputer.remote.open")}
                type="button"
                variant="outline"
              >
                <MonitorUp size={16} />
                {t("managedComputer.remote.open")}
              </Button>
            ) : null}
            <Button
            className="h-[34px] px-3 text-xs active:scale-[.97]"
            disabled={isTaskStarting || !board || agent.skills.length === 0}
            onClick={openTaskDialog}
            type="button"
          >
            {isTaskStarting ? (
              <Spinner size={17} />
            ) : (
              <Play fill="currentColor" size={17} />
            )}
            {t(
              isTaskStarting
                ? "agents.running"
                : companionMode
                  ? "agents.runNow"
                  : "agents.runTask",
            )}
            </Button>
          </div>
        }
        className={cn(
          "app-page-header h-12 shrink-0 px-5 [&_.page-header-description]:hidden",
          !isSidebarOpen && "sidebar-closed",
        )}
        data-tauri-drag-region
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <Button
              aria-label={t("agents.back")}
              className="size-7 shrink-0 rounded-md p-0 text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </Button>
            <span className="truncate">{agent.name}</span>
          </span>
        }
        titleId="project-agent-detail-title"
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <TeamAgentSessions
          agent={agent}
          onSessionOpen={setSelectedSessionId}
          onStopSession={onStopSession}
          projectId={board?.team.id ?? agent.teamId}
        />
      </div>

      <TeamAgentTaskDialog
        agent={agent}
        board={board}
        isOpen={isTaskDialogOpen}
        isSubmitting={isStarting}
        onOpenChange={setIsTaskDialogOpen}
        onSubmit={submit}
        workerSelectionRequired={Boolean(onStartRemoteTask)}
      />

      {remoteComputer && token && board?.team.organizationId ? (
        <ManagedComputerRemoteDesktop
          agentId={agent.id}
          computer={remoteComputer}
          onClose={() => setRemoteComputer(null)}
          organizationId={board.team.organizationId}
          token={token}
        />
      ) : null}
    </MainContent>
  );
}
