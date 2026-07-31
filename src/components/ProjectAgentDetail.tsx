import {
  ArrowLeft,
  LoaderCircle,
  Play,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  ErrorBanner,
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useI18n } from "../i18n";
import {
  executeProjectAgentTask,
  type ProjectAgentTaskSessionSettlement,
  type ProjectAgentTaskSessionStart,
} from "../lib/project-agent-execution";
import { runProjectAgent } from "../lib/project-llm";
import type {
  DashboardPayload,
  HuntRun,
  ProjectAgent,
} from "../types";
import { ProjectAgentSessionDetail } from "./ProjectAgentSessionDetail";
import { ProjectAgentSessions } from "./ProjectAgentSessions";

export type {
  ProjectAgentTaskSessionSettlement,
  ProjectAgentTaskSessionStart,
} from "../lib/project-agent-execution";

export function ProjectAgentDetail({
  agent,
  dashboard,
  error: appError,
  isSidebarOpen,
  onBack,
  onIssueOpen,
  onRequestedSessionOpen,
  onSettleTaskSession,
  onStopSession,
  onStartAutoHunt,
  onStartTaskSession,
  requestedSessionId,
  sessions,
}: {
  agent: ProjectAgent;
  dashboard: DashboardPayload | null;
  error: string | null;
  isSidebarOpen: boolean;
  onBack: () => void;
  onIssueOpen: (runId: string) => void;
  onRequestedSessionOpen?: () => void;
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
  sessions: AutoHuntSession[];
}) {
  const { t } = useI18n();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [request, setRequest] = useState(agent.responsibility);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setRequest(agent.responsibility);
    setError(null);
    setIsTaskDialogOpen(true);
  };

  const submit = async () => {
    const message = request.trim();
    if (!message || isRunning || !dashboard) return;
    setError(null);
    setIsRunning(true);
    try {
      const sessionId = crypto.randomUUID();
      setSelectedSessionId(sessionId);
      await executeProjectAgentTask(
        {
          runAgent: runProjectAgent,
          startSession: onStartTaskSession,
          settleSession: onSettleTaskSession,
          startAutoHunt: onStartAutoHunt,
        },
        {
          agent,
          dashboard,
          message,
          sessionId,
        },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRunning(false);
    }
  };

  if (selectedSession) {
    return (
      <ProjectAgentSessionDetail
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSelectedSessionId(null)}
        onIssueOpen={onIssueOpen}
        onStop={() => onStopSession(selectedSession.id)}
        session={selectedSession}
      />
    );
  }

  return (
    <MainContent id="project-agent-detail">
      <PageHeader
        action={
          <Button
            className="project-agent-create project-agent-run-task"
            onClick={openTaskDialog}
            type="button"
          >
            <Play fill="currentColor" size={17} />
            {t("agents.runTask")}
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
        {appError ? (
          <ErrorBanner className="m-4">{appError}</ErrorBanner>
        ) : null}

        <ProjectAgentSessions
          agent={agent}
          onSessionOpen={setSelectedSessionId}
          projectId={dashboard?.project.id ?? agent.projectId}
          sessions={sessions}
        />
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!isRunning) setIsTaskDialogOpen(open);
        }}
        open={isTaskDialogOpen}
      >
        <DialogContent className="project-agent-task-dialog">
          <DialogHeader>
            <DialogTitle>{t("agents.taskTitle")}</DialogTitle>
            <DialogDescription>
              {t("agents.taskDescription")}
            </DialogDescription>
          </DialogHeader>

          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          <form
            className="project-agent-run-composer"
            id="project-agent-task-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Textarea
              aria-label={t("agents.taskInput")}
              disabled={isRunning}
              onChange={(event) => setRequest(event.target.value)}
              placeholder={t("agents.taskPlaceholder")}
              value={request}
            />
          </form>

          <DialogFooter>
            <Button
              disabled={isRunning || request.trim().length === 0 || !dashboard}
              form="project-agent-task-form"
              type="submit"
            >
              {isRunning ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              {isRunning ? t("agents.running") : t("agents.runTask")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
