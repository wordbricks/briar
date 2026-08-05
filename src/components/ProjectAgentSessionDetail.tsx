import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  LoaderCircle,
  Link2,
  OctagonX,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type {
  AutoHuntSession,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useProjectAgentWorkerEvents } from "../hooks/useProjectAgentWorkerEvents";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  agentMessagesFromAppServerEvents,
  naturalLanguageFromAgentMessage,
} from "../lib/auto-hunt-agent";
import { copySessionShareLink } from "../lib/issue-links";

export function ProjectAgentSessionDetail({
  isSidebarOpen,
  onBack,
  onIssueOpen,
  onStop,
  session,
  token = null,
}: {
  isSidebarOpen: boolean;
  onBack: () => void;
  onIssueOpen: (runId: string) => void;
  onStop: () => Promise<boolean>;
  session: AutoHuntSession;
  token?: string | null;
}) {
  const { localeTag, t } = useI18n();
  const appServerEvents = useAutoHuntAppServerEvents(
    session.sessionType === "task" ? session.id : null,
  );
  const workerEvents = useProjectAgentWorkerEvents(
    token,
    session.projectId,
    session.sessionType === "dispatch"
      ? session.issues.map((issue) => issue.runId)
      : [],
    session.status === "running",
  );
  const executionEvents = session.sessionType === "task"
    ? appServerEvents
    : workerEvents;
  const agentMessages = useMemo(
    () => agentMessagesFromAppServerEvents(executionEvents.events),
    [executionEvents.events],
  );
  const executionLogEntries = useMemo(
    () => [
      ...session.dispatchEvents.map((dispatchEvent) => ({
        id: `dispatch:${dispatchEvent.dispatchGroupId}:${dispatchEvent.cursor}`,
        isComplete: dispatchEvent.status !== "running",
        occurredAtMs: Date.parse(dispatchEvent.occurredAt),
        phase: t("autoHunt.workerTimeline"),
        status: dispatchEvent.status,
        text: naturalLanguageFromAgentMessage(dispatchEvent.message),
      })),
      ...agentMessages.map((message) => ({
        id: `message:${message.id}`,
        isComplete: message.isComplete,
        occurredAtMs: message.updatedAtMs,
        phase: agentMessagePhase(t, message.phase),
        status: message.isComplete ? "completed" : "running",
        text: message.text
          ? naturalLanguageFromAgentMessage(message.text)
          : t("autoHunt.agentMessage.writing"),
      })),
    ].sort((left, right) => left.occurredAtMs - right.occurredAtMs),
    [agentMessages, session.dispatchEvents, t],
  );
  const agentMessagesRef = useRef<HTMLDivElement>(null);
  const latestExecutionEntry =
    executionLogEntries[executionLogEntries.length - 1];
  const { toast } = useToast();
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const messageList = agentMessagesRef.current;
    if (!messageList || executionLogEntries.length === 0) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [executionLogEntries.length, latestExecutionEntry?.text.length]);

  useEffect(() => {
    if (session.status !== "running") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session.status]);

  const stop = async () => {
    if (isStopping || session.status !== "running") return;
    setIsStopping(true);
    setStopError(null);
    try {
      if (!await onStop()) {
        setStopError(t("agents.stopSessionFailed"));
      }
    } catch (caught) {
      setStopError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setIsStopping(false);
    }
  };

  const copySessionLink = async () => {
    try {
      await copySessionShareLink({
        projectId: session.projectId,
        sessionId: session.id,
      });
      toast(t("agents.sessionLinkCopied"), { tone: "success" });
    } catch {
      toast(t("agents.copySessionLinkFailed"), { tone: "error" });
    }
  };

  const exportSessionLog = () => {
    const lines = [
      sessionTitle(session, t),
      `${t("agents.sessionId")}: ${session.id}`,
      `${t("run.started")}: ${formatDate(session.startedAt, localeTag)}`,
      "",
      `${t("agents.sessionRequest")}:`,
      session.request?.trim() || t("agents.sessionRequestEmpty"),
      "",
      `${t("agents.executionLog")}:`,
      ...executionLogEntries.flatMap((entry) => [
        `[${formatEventTime(entry.occurredAtMs, localeTag)}] ${entry.phase}`,
        entry.text,
        "",
      ]),
      session.summary || session.error
        ? `${t("autoHunt.summary")}:\n${session.error ?? session.summary}`
        : "",
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `briar-session-${session.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const elapsedUntil = session.completedAt
    ? Date.parse(session.completedAt)
    : nowMs;
  const completedStageCount = session.status === "completed" ? 3 : 1;
  const executionStageState = session.status === "running"
    ? "running"
    : session.status === "completed"
    ? "completed"
    : "failed";
  const resultStageState = session.status === "running"
    ? "pending"
    : session.status === "completed"
    ? "completed"
    : "failed";
  const executionStageStatus = session.status === "running"
    ? t("agents.stage.running")
    : statusLabel(t, session.status);
  const resultStageStatus = session.status === "running"
    ? t("agents.stage.waiting")
    : statusLabel(t, session.status);

  return (
    <MainContent id="project-agent-session">
      <PageHeader
        action={
          <div className="auto-hunt-session-page-actions">
            <button
              aria-label={t("agents.copySessionLink")}
              className="run-page-link-copy auto-hunt-session-link-copy"
              onClick={() => void copySessionLink()}
              title={t("agents.copySessionLink")}
              type="button"
            >
              <Link2 aria-hidden="true" size={16} />
            </button>
            <Button
              className="auto-hunt-session-export"
              onClick={exportSessionLog}
              size="sm"
              type="button"
              variant="outline"
            >
              <Download aria-hidden="true" />
              {t("agents.exportSessionLog")}
            </Button>
            {session.status === "running" ? (
              <Button
                aria-label={t("agents.stopSession")}
                className="auto-hunt-session-stop"
                disabled={isStopping}
                onClick={() => void stop()}
                size="sm"
                type="button"
                variant="destructive"
              >
                {isStopping ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <OctagonX />
                )}
                {isStopping
                  ? t("agents.stoppingSession")
                  : t("agents.stopSession")}
              </Button>
            ) : null}
          </div>
        }
        className={`app-page-header auto-hunt-session-page-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
        title={
          <span className="auto-hunt-session-heading-copy">
            <Button
              aria-label={t("run.back")}
              className="project-agent-detail-back auto-hunt-session-back"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </Button>
            <span className="auto-hunt-session-heading-text">
              <span className="auto-hunt-session-title-row">
                <span>{sessionTitle(session, t)}</span>
                <span className={`auto-hunt-status ${session.status}`}>
                  {statusLabel(t, session.status)}
                </span>
              </span>
              <small>
                {formatDate(session.startedAt, localeTag)} {t("run.started")}
                <i>·</i>
                {t("agents.elapsed", {
                  duration: formatElapsed(
                    Math.max(0, elapsedUntil - Date.parse(session.startedAt)),
                  ),
                })}
                {session.workspaceRoot ? (
                  <>
                    <i>·</i>
                    {workspaceLabel(session.workspaceRoot)}
                  </>
                ) : null}
              </small>
            </span>
          </span>
        }
        titleId="project-agent-session-title"
      />

      <div className="auto-hunt-scroll auto-hunt-session-detail-scroll">
        <section
          aria-labelledby="project-agent-session-title"
          className="auto-hunt-session-page"
        >
          <div className="auto-hunt-session-detail-body auto-hunt-session-layout">
            {stopError ? (
              <div className="auto-hunt-stop-error" role="alert">
                <CircleAlert size={14} />
                {stopError}
              </div>
            ) : null}
            <section className="auto-hunt-session-request-card">
              <span>{t("agents.sessionRequest")}</span>
              <p>{session.request?.trim() || t("agents.sessionRequestEmpty")}</p>
            </section>

            <div className="auto-hunt-session-main-column">
              <section className="auto-hunt-dialog-section auto-hunt-app-server-section">
                <header>
                  <div>
                    <h3>{t("agents.executionLog")}</h3>
                    <p>{t("agents.executionLogDescription")}</p>
                  </div>
                  <span className="auto-hunt-event-count">
                    {session.status === "running" ? (
                      <i>
                        <span />
                        {t("autoHunt.live")}
                      </i>
                    ) : null}
                    {t("autoHunt.eventCount", {
                      count: executionLogEntries.length,
                    })}
                  </span>
                </header>
                {executionEvents.error ? (
                  <div className="auto-hunt-event-state error">
                    <CircleAlert size={14} />
                    {executionEvents.error}
                  </div>
                ) : executionEvents.isLoading ? (
                  <div className="auto-hunt-event-state">
                    <LoaderCircle className="spin" size={14} />
                    {t("autoHunt.eventsLoading")}
                  </div>
                ) : executionLogEntries.length === 0 ? (
                  <div className="auto-hunt-event-state">
                    {t("autoHunt.eventsEmpty")}
                  </div>
                ) : (
                  <div
                    aria-live="polite"
                    className="auto-hunt-agent-messages auto-hunt-session-execution-timeline"
                    ref={agentMessagesRef}
                    role="log"
                  >
                    {executionLogEntries.map((entry, index) => (
                      <article
                        className={`auto-hunt-agent-message ${entry.status}`}
                        key={entry.id}
                      >
                        <span
                          aria-hidden="true"
                          className="auto-hunt-message-index"
                        >
                          {index + 1}
                        </span>
                        <header>
                          <strong>{entry.phase}</strong>
                          {!entry.isComplete ? (
                            <small className="auto-hunt-message-streaming">
                              <LoaderCircle className="spin" size={11} />
                              {t("autoHunt.agentMessage.streaming")}
                            </small>
                          ) : null}
                          <time
                            dateTime={new Date(entry.occurredAtMs).toISOString()}
                          >
                            {formatEventTime(entry.occurredAtMs, localeTag)}
                          </time>
                        </header>
                        <p>{entry.text}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="auto-hunt-session-sidebar">
              <section className="auto-hunt-session-side-card auto-hunt-session-progress-card">
                <header>
                  <h3>{t("agents.stageProgress")}</h3>
                  <span>{t("agents.stageProgressCount", {
                    completed: completedStageCount,
                    total: 3,
                  })}</span>
                </header>
                <ol>
                  <SessionStage
                    label={t("agents.stage.requestReceived")}
                    state="completed"
                    status={t("agents.stage.completed")}
                  />
                  <SessionStage
                    label={t("agents.stage.agentExecution")}
                    state={executionStageState}
                    status={executionStageStatus}
                  />
                  <SessionStage
                    label={t("agents.stage.resultReady")}
                    state={resultStageState}
                    status={resultStageStatus}
                  />
                </ol>
              </section>

              <section className="auto-hunt-session-side-card">
                <header>
                  <h3>{t("agents.sessionInfo")}</h3>
                </header>
                <dl className="auto-hunt-session-info">
                  <div>
                    <dt>{t("agents.sessionId")}</dt>
                    <dd title={session.id}>{session.id}</dd>
                  </div>
                  <div>
                    <dt>{t("agents.workspace")}</dt>
                    <dd title={session.workspaceRoot ?? undefined}>
                      {session.workspaceRoot
                        ? workspaceLabel(session.workspaceRoot)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("agents.sessionType")}</dt>
                    <dd>
                      {t(
                        session.sessionType === "dispatch"
                          ? "agents.autoHunt"
                          : "agents.singleSession",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("agents.messageCount")}</dt>
                    <dd>
                      {t("autoHunt.eventCount", {
                        count: executionLogEntries.length,
                      })}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="auto-hunt-session-side-card auto-hunt-session-output-card">
                <header>
                  <h3>{t("agents.outputs")}</h3>
                </header>
                <div>
                  {session.issues.length > 0 ? (
                    <div className="auto-hunt-target-list">
                      {session.issues.map((issue) => (
                        <button
                          aria-label={t("run.details", { title: issue.title })}
                          className="auto-hunt-target"
                          key={issue.runId}
                          onClick={() => onIssueOpen(issue.runId)}
                          type="button"
                        >
                          <span>AH-{issue.runNumber}</span>
                          <div>
                            <strong>{issue.title}</strong>
                            {issue.summary ? <small>{issue.summary}</small> : null}
                          </div>
                          <span className="auto-hunt-target-trailing">
                            <span className={`auto-hunt-outcome ${issue.outcome}`}>
                              {outcomeLabel(t, issue.outcome)}
                            </span>
                            <ChevronRight aria-hidden="true" size={15} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {session.summary || session.error ? (
                    <p className={session.error ? "error" : undefined}>
                      {session.error ?? session.summary}
                    </p>
                  ) : session.issues.length === 0 ? (
                    <p>{t("agents.outputsEmpty")}</p>
                  ) : null}
                </div>
              </section>
            </aside>
          </div>
        </section>
      </div>
    </MainContent>
  );
}

function SessionStage({
  label,
  state,
  status,
}: {
  label: string;
  state: "completed" | "running" | "pending" | "failed";
  status: string;
}) {
  return (
    <li className={state}>
      <span aria-hidden="true">
        {state === "completed"
          ? <Check size={12} />
          : state === "running"
          ? <Play size={10} />
          : null}
      </span>
      <div>
        <strong>{label}</strong>
        <small>{status}</small>
      </div>
    </li>
  );
}

function sessionTitle(
  session: AutoHuntSession,
  t: (key: MessageKey) => string,
) {
  return session.request?.trim()
    || session.issues[0]?.title
    || t("agents.sessionFallbackTitle");
}

function workspaceLabel(workspaceRoot: string) {
  return workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
    || workspaceRoot;
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : "",
    minutes || hours ? `${minutes}m` : "",
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(" ");
}

function statusLabel(
  t: (key: MessageKey) => string,
  status: AutoHuntSessionStatus,
) {
  return t(`autoHunt.status.${status}` as MessageKey);
}

function outcomeLabel(
  t: (key: MessageKey) => string,
  outcome: AutoHuntSessionIssueOutcome,
) {
  return t(`autoHunt.outcome.${outcome}` as MessageKey);
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEventTime(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function agentMessagePhase(
  t: (key: MessageKey) => string,
  phase: string | null,
) {
  return phase === "final_answer"
    ? t("autoHunt.agentMessage.final")
    : t("autoHunt.agentMessage.commentary");
}
