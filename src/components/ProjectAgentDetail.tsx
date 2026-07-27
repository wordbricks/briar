import {
  ArrowLeft,
  Bot,
  LoaderCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  ErrorBanner,
  MainContent,
  PageHero,
  StatusPill,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { useI18n } from "../i18n";
import { runProjectAgent } from "../lib/project-llm";
import type {
  DashboardPayload,
  HuntRun,
  ProjectAgent,
} from "../types";
import { AutoHuntSessions } from "./AutoHuntSessions";

type ProjectAgentMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  dispatched: boolean;
};

export function ProjectAgentDetail({
  agent,
  dashboard,
  error: appError,
  isSidebarOpen,
  onBack,
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
  const [mode, setMode] = useState<"task" | "auto_hunt">(
    requestedSessionId ? "auto_hunt" : "task",
  );
  const [request, setRequest] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ProjectAgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(
    requestedSessionId,
  );

  useEffect(() => {
    if (!requestedSessionId) return;
    setOpenedSessionId(requestedSessionId);
    setMode("auto_hunt");
  }, [requestedSessionId]);

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
    setIsRunning(true);
    try {
      const response = await runProjectAgent({
        projectId: dashboard.project.id,
        agent,
        message,
        conversationId,
      });
      setConversationId(response.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: response.message,
          dispatched: response.action === "dispatch_auto_hunt",
        },
      ]);
      if (response.action === "dispatch_auto_hunt") {
        const sessionId = onStartAutoHunt(dashboard.runs, {
          coordinatorConversationId: response.conversationId,
          maxIssues: response.maxIssues ?? undefined,
        });
        setOpenedSessionId(sessionId);
        setMode("auto_hunt");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRunning(false);
    }
  };

  if (mode === "auto_hunt") {
    return (
      <AutoHuntSessions
        agent={agent}
        dashboard={dashboard}
        error={appError}
        isSidebarOpen={isSidebarOpen}
        onAgentBack={() => setMode("task")}
        onRequestedSessionOpen={onRequestedSessionOpen}
        onStart={(runs) => onStartAutoHunt(runs)}
        requestedSessionId={openedSessionId}
        sessions={sessions}
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
              onClick={() => setMode("auto_hunt")}
              type="button"
              variant="outline"
            >
              <Sparkles size={16} />
              {t("agents.autoHunt")}
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
          meta={
            <StatusPill tone="primary">
              {t("agents.singleSession")}
            </StatusPill>
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

        <section className="project-agent-run-panel">
          <header>
            <div>
              <Typography as="h2" variant="bodyLg">
                {t("agents.taskTitle")}
              </Typography>
              <Typography className="mt-1" tone="muted" variant="caption">
                {t("agents.taskDescription")}
              </Typography>
            </div>
          </header>

          {messages.length > 0 ? (
            <div className="project-agent-run-messages">
              {messages.map((message) => (
                <article
                  className={`project-agent-run-message ${message.role}`}
                  key={message.id}
                >
                  <small>
                    {message.role === "user"
                      ? t("agents.you")
                      : agent.name}
                  </small>
                  <p>{message.text}</p>
                  {message.dispatched ? (
                    <StatusPill tone="primary">
                      {t("agents.autoHuntRequested")}
                    </StatusPill>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}

          {(error || appError) ? (
            <ErrorBanner>{error ?? appError}</ErrorBanner>
          ) : null}

          <form
            className="project-agent-run-composer"
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
            <div>
              <Typography tone="muted" variant="caption">
                {t("agents.autoHuntHint")}
              </Typography>
              <Button
                disabled={isRunning || request.trim().length === 0 || !dashboard}
                type="submit"
              >
                {isRunning
                  ? <LoaderCircle className="spin" size={16} />
                  : <Play size={16} />}
                {isRunning ? t("agents.running") : t("agents.runTask")}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </MainContent>
  );
}
