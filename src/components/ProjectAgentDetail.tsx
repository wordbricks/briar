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
import { executeProjectAgentTurn } from "../lib/project-agent-execution";
import { runProjectAgent } from "../lib/project-llm";
import type {
  DashboardPayload,
  HuntRun,
  ProjectAgent,
} from "../types";
import { ProjectAgentSessionDetail } from "./ProjectAgentSessionDetail";
import { ProjectAgentSessions } from "./ProjectAgentSessions";

export type ProjectAgentTaskSessionStart = {
  sessionId: string;
  request: string;
  startedAt: string;
};

export type ProjectAgentTaskSessionSettlement = {
  status: "completed" | "failed";
  conversationId: string | null;
  workspaceRoot: string | null;
  summary: string | null;
  error: string | null;
};

export function ProjectAgentDetail({
  agent,
  dashboard,
  error: appError,
  isSidebarOpen,
  onBack,
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
    },
  ) => string;
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
    const startedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    let sessionStarted = false;
    setIsRunning(true);
    try {
      onStartTaskSession({
        sessionId,
        request: message,
        startedAt,
      });
      sessionStarted = true;
      setSelectedSessionId(sessionId);
      const { response } = await executeProjectAgentTurn(
        {
          runAgent: runProjectAgent,
          dispatchAutoHunt: (decision) =>
            onStartAutoHunt(dashboard.runs, {
              coordinatorConversationId: decision.conversationId,
              parentSessionId: sessionId,
              maxIssues: decision.maxIssues ?? undefined,
            }),
        },
        {
          projectId: dashboard.project.id,
          agent,
          message,
          conversationId: null,
          sessionId,
        },
      );
      onSettleTaskSession(sessionId, {
        status: "completed",
        conversationId: response.conversationId,
        workspaceRoot: response.workspaceRoot,
        summary: response.message,
        error: null,
      });
    } catch (caught) {
      const messageText =
        caught instanceof Error ? caught.message : String(caught);
      if (sessionStarted) {
        onSettleTaskSession(sessionId, {
          status: "failed",
          conversationId: null,
          workspaceRoot: null,
          summary: null,
          error: messageText,
        });
      } else {
        setError(messageText);
      }
    } finally {
      setIsRunning(false);
    }
  };

  if (selectedSession) {
    return (
      <ProjectAgentSessionDetail
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSelectedSessionId(null)}
        onStop={() => onStopSession(selectedSession.id)}
        session={selectedSession}
      />
    );
  }

  return (
    <MainContent id="project-agent-detail">
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
      <div className="project-agent-run-scroll">
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
          className="app-page-header project-agents-heading project-agent-detail-heading"
          description={agent.responsibility}
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
