import { ArrowLeft, Play } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useState } from "react";

import {
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useMobileBackHandler } from "../hooks/useMobileNavigation";
import { useI18n } from "../i18n";
import {
  executeProjectAgentTask,
  type ProjectAgentTaskSessionSettlement,
  type ProjectAgentTaskSessionStart,
} from "../lib/project-agent-execution";
import {
  agentWithSkillRuntime,
  agentWithSkillsRuntime,
} from "../lib/project-agent";
import { runProjectAgent } from "../lib/project-llm";
import type {
  DashboardPayload,
  HuntRun,
  ProjectAgent,
} from "../types";
import { ProjectAgentSessionDetail } from "./ProjectAgentSessionDetail";
import { ProjectAgentSessions } from "./ProjectAgentSessions";
import {
  ProjectAgentTaskDialog,
  type ProjectAgentTaskDialogSubmit,
} from "./ProjectAgentTaskDialog";

export type {
  ProjectAgentTaskSessionSettlement,
  ProjectAgentTaskSessionStart,
} from "../lib/project-agent-execution";

export function ProjectAgentDetail({
  agent,
  companionMode = false,
  dashboard,
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
  sessions,
  token = null,
}: {
  agent: ProjectAgent;
  companionMode?: boolean;
  dashboard: DashboardPayload | null;
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
    settlement: ProjectAgentTaskSessionSettlement,
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
  onStartTaskSession: (session: ProjectAgentTaskSessionStart) => void;
  requestedSessionId: string | null;
  isStarting?: boolean;
  sessions: AutoHuntSession[];
  token?: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    requestedSessionId,
  );
  const selectedSession =
    sessions.find(
      (session) =>
        session.id === selectedSessionId &&
        session.projectId === agent.projectId &&
        session.agentId === agent.id,
    ) ?? null;
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

  useEffect(() => {
    if (
      !requestedSessionId ||
      !sessions.some(
        (session) =>
          session.id === requestedSessionId &&
          session.projectId === agent.projectId &&
          session.agentId === agent.id,
      )
    ) {
      return;
    }
    setSelectedSessionId(requestedSessionId);
    onRequestedSessionOpen?.();
  }, [
    agent.id,
    agent.projectId,
    onRequestedSessionOpen,
    requestedSessionId,
    sessions,
  ]);

  useEffect(() => {
    if (selectedSession) setIsTaskDialogOpen(false);
  }, [selectedSession]);

  useEffect(() => {
    if (selectedSession?.sessionType !== "task") return;
    const dispatchSession = sessions.find(
      (session) =>
        session.parentSessionId === selectedSession.id &&
        session.projectId === agent.projectId &&
        session.agentId === agent.id,
    );
    if (dispatchSession) setSelectedSessionId(dispatchSession.id);
  }, [
    agent.id,
    agent.projectId,
    selectedSession,
    sessions,
  ]);

  const openTaskDialog = () => {
    setIsTaskDialogOpen(true);
  };

  const isTaskStarting = isExternalStartPending || isStarting;

  const submit = async (input: ProjectAgentTaskDialogSubmit) => {
    if (isTaskStarting || !dashboard) return;
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
      await executeProjectAgentTask(
        {
          runAgent: runProjectAgent,
          startSession: (session) => {
            onStartTaskSession(session);
            setIsStarting(false);
          },
          settleSession: onSettleTaskSession,
          startAutoHunt: onStartAutoHunt,
        },
        {
          agent: runtimeAgent,
          dashboard,
          message: input.request,
          sessionId,
          skillId: input.skill.id,
        },
      );
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : String(caught),
        { tone: "error" },
      );
    } finally {
      setIsStarting(false);
    }
  };

  const sendFollowUp = async (message: string) => {
    if (
      companionMode ||
      !dashboard ||
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
    await executeProjectAgentTask(
      {
        runAgent: runProjectAgent,
        startSession: onStartTaskSession,
        settleSession: onSettleTaskSession,
        startAutoHunt: onStartAutoHunt,
      },
      {
        agent: runtimeAgent,
        dashboard,
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
      <ProjectAgentSessionDetail
        isSidebarOpen={isSidebarOpen}
        issueKeyPrefix={dashboard?.project.issueKeyPrefix}
        onBack={() => setSelectedSessionId(null)}
        onIssueOpen={onIssueOpen}
        onFollowUp={companionMode ? undefined : sendFollowUp}
        onStop={() => onStopSession(selectedSession.id)}
        session={selectedSession}
        token={token}
        workers={dashboard?.workers ?? []}
      />
    );
  }

  return (
    <MainContent id="project-agent-detail">
      <PageHeader
        action={
          <Button
            className="project-agent-create project-agent-run-task"
            disabled={
              isTaskStarting ||
              !dashboard ||
              agent.skills.length === 0
            }
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
        }
        className={`app-page-header project-agents-heading project-agent-detail-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
        title={
          <span className="project-agent-detail-title">
            <Button
              aria-label={t("agents.back")}
              className="project-agent-detail-back"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </Button>
            <span>{agent.name}</span>
          </span>
        }
        titleId="project-agent-detail-title"
      />
      <div className="project-agent-run-scroll">
        <ProjectAgentSessions
          agent={agent}
          onSessionOpen={setSelectedSessionId}
          projectId={dashboard?.project.id ?? agent.projectId}
          sessions={sessions}
        />
      </div>

      <ProjectAgentTaskDialog
        agent={agent}
        dashboard={dashboard}
        isOpen={isTaskDialogOpen}
        isSubmitting={isStarting}
        onOpenChange={setIsTaskDialogOpen}
        onSubmit={submit}
        workerSelectionRequired={Boolean(onStartRemoteTask)}
      />
    </MainContent>
  );
}
