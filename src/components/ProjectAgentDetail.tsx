import {
  ArrowLeft,
  Bot,
  LoaderCircle,
  Play,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  ErrorBanner,
  MainContent,
  PageHero,
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
import { Typography } from "@/components/ui/typography";
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

type ProjectAgentMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  dispatched: boolean;
};

export type ProjectAgentTaskSessionRecord = {
  sessionId: string;
  request: string;
  startedAt: string;
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
  onRecordTaskSession,
  onRequestedSessionOpen,
  onStartAutoHunt,
  requestedSessionId,
  sessions,
}: {
  agent: ProjectAgent;
  dashboard: DashboardPayload | null;
  error: string | null;
  isSidebarOpen: boolean;
  onBack: () => void;
  onRecordTaskSession?: (record: ProjectAgentTaskSessionRecord) => void;
  onRequestedSessionOpen?: () => void;
  onStartAutoHunt: (
    runs: HuntRun[],
    options?: {
      coordinatorConversationId?: string | null;
      maxIssues?: number;
    },
  ) => string;
  requestedSessionId: string | null;
  sessions: AutoHuntSession[];
}) {
  const { t } = useI18n();
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [request, setRequest] = useState(agent.responsibility);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ProjectAgentMessage[]>([]);
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

  const openTaskDialog = () => {
    setRequest(agent.responsibility);
    setConversationId(null);
    setMessages([]);
    setError(null);
    setIsTaskDialogOpen(true);
  };

  const submit = async () => {
    const message = request.trim();
    if (!message || isRunning || !dashboard) return;
    setError(null);
    setRequest("");
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: message,
        dispatched: false,
      },
    ]);
    const startedAt = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    setIsRunning(true);
    try {
      const { response } = await executeProjectAgentTurn(
        {
          runAgent: runProjectAgent,
          dispatchAutoHunt: (decision) =>
            onStartAutoHunt(dashboard.runs, {
              coordinatorConversationId: decision.conversationId,
              maxIssues: decision.maxIssues ?? undefined,
            }),
        },
        {
          projectId: dashboard.project.id,
          agent,
          message,
          conversationId,
          sessionId,
        },
      );
      setConversationId(response.conversationId);
      if (response.action === "respond") {
        onRecordTaskSession?.({
          sessionId,
          request: message,
          startedAt,
          status: "completed",
          conversationId: response.conversationId,
          workspaceRoot: response.workspaceRoot,
          summary: response.message,
          error: null,
        });
      }
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: response.message,
          dispatched: response.action === "dispatch_auto_hunt",
        },
      ]);
    } catch (caught) {
      const messageText =
        caught instanceof Error ? caught.message : String(caught);
      setError(messageText);
      onRecordTaskSession?.({
        sessionId,
        request: message,
        startedAt,
        status: "failed",
        conversationId,
        workspaceRoot: null,
        summary: null,
        error: messageText,
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (selectedSession) {
    return (
      <ProjectAgentSessionDetail
        isSidebarOpen={isSidebarOpen}
        onBack={() => setSelectedSessionId(null)}
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
        <PageHero
          action={
            <Button
              className="h-12 min-w-[150px] rounded-xl"
              onClick={openTaskDialog}
              type="button"
            >
              <Play fill="currentColor" size={17} />
              {t("agents.runTask")}
            </Button>
          }
          className="project-agent-run-hero"
          description={agent.responsibility}
          eyebrow={
            <>
              <Bot size={13} />
              {t("agents.detailEyebrow")}
            </>
          }
          title={
            <span className="grid gap-3">
              <Button
                className="project-agent-detail-back w-max"
                onClick={onBack}
                type="button"
                variant="ghost"
              >
                <ArrowLeft size={16} />
                {t("agents.back")}
              </Button>
              <span>{agent.name}</span>
            </span>
          }
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

          {messages.length > 0 ? (
            <div className="project-agent-run-messages">
              {messages.map((message) => (
                <article
                  className={`project-agent-run-message ${message.role}`}
                  key={message.id}
                >
                  <small>
                    {message.role === "user" ? t("agents.you") : agent.name}
                  </small>
                  <p>{message.text}</p>
                  {message.dispatched ? (
                    <Typography tone="muted" variant="caption">
                      {t("agents.autoHuntRequested")}
                    </Typography>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

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
