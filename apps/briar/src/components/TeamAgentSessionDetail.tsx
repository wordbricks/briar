import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Link2,
  OctagonX,
  Play,
  Send,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useMemo, useState } from "react";

import { MainContent, PageHeader } from "@/components/layout";
import { AgentWorkLog } from "@/components/AgentWorkLog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type {
  AutoHuntSession,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../types";
import { canStopAutoHuntSession } from "../state/agent-sessions/model";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useProjectAgentWorkerEvents } from "../hooks/useProjectAgentWorkerEvents";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  agentMessagesFromAppServerEvents,
  naturalLanguageFromAgentMessage,
} from "../lib/auto-hunt-agent";
import { copySessionShareLink } from "../lib/issue-links";
import { formatIssueKey } from "../lib/issue-key";
import { loadProjectAgentSession } from "../lib/api";

export function sessionWorkerLabel(
  session: Pick<AutoHuntSession, "workerId" | "requestedWorkerId">,
  workers: ReadonlyArray<{ id: string; label: string }>,
) {
  const workerId = session.workerId ?? session.requestedWorkerId;
  if (!workerId) return null;
  return workers.find((worker) => worker.id === workerId)?.label ?? workerId;
}

export function TeamAgentSessionDetail({
  isSidebarOpen,
  issueKeyPrefix,
  onBack,
  onIssueOpen,
  onFollowUp,
  onStop,
  session: sessionSummary,
  token = null,
  workers = [],
}: {
  isSidebarOpen: boolean;
  issueKeyPrefix?: string;
  onBack: () => void;
  onIssueOpen: (runId: string) => void;
  onFollowUp?: (message: string) => Promise<void>;
  onStop: () => Promise<boolean>;
  session: AutoHuntSession;
  token?: string | null;
  workers?: ReadonlyArray<{ id: string; label: string }>;
}) {
  const { localeTag, t } = useI18n();
  const [loadedSession, setLoadedSession] = useState<AutoHuntSession | null>(null);
  useEffect(() => {
    if (
      !token ||
      sessionSummary.localOwner !== false ||
      sessionSummary.detailLoaded !== false
    ) {
      setLoadedSession(null);
      return;
    }
    let active = true;
    void loadProjectAgentSession(
      token,
      sessionSummary.projectId,
      sessionSummary.id,
    ).then((detail) => {
      if (active) setLoadedSession(detail);
    }).catch(() => {
      // The lightweight summary remains usable for navigation when a detail
      // request is temporarily unavailable.
    });
    return () => {
      active = false;
    };
  }, [
    sessionSummary.detailLoaded,
    sessionSummary.id,
    sessionSummary.localOwner,
    sessionSummary.projectId,
    sessionSummary.updatedAt,
    token,
  ]);
  const session =
    loadedSession?.id === sessionSummary.id &&
      loadedSession.updatedAt === sessionSummary.updatedAt
      ? loadedSession
      : sessionSummary;
  const workerLabel = sessionWorkerLabel(session, workers);
  const isRemoteSession = session.localOwner === false;
  const appServerEvents = useAutoHuntAppServerEvents(
    !isRemoteSession && session.sessionType === "task" ? session.id : null,
  );
  const workerEvents = useProjectAgentWorkerEvents(
    token,
    session.projectId,
    session.sessionType === "dispatch"
      ? session.issues.map((issue) => issue.runId)
      : [],
    session.status === "running",
    isRemoteSession && session.sessionType === "task" ? [session.id] : [],
  );
  const executionEvents = !isRemoteSession && session.sessionType === "task"
      ? appServerEvents
      : workerEvents;
  const agentMessages = useMemo(
    () => agentMessagesFromAppServerEvents(executionEvents.events),
    [executionEvents.events],
  );
  const activityProvider = executionEvents.events.find((event) => event.provider)
    ?.provider ?? null;
  const executionLogEntries = useMemo(
    () => [
      ...session.dispatchEvents.map((dispatchEvent) => ({
        id: `dispatch:${dispatchEvent.dispatchGroupId}:${dispatchEvent.cursor}`,
        isComplete: dispatchEvent.status !== "running",
        phase: "commentary",
        startedAtMs: Date.parse(dispatchEvent.occurredAt),
        text: naturalLanguageFromAgentMessage(dispatchEvent.message),
        updatedAtMs: Date.parse(dispatchEvent.occurredAt),
      })),
      ...agentMessages,
      ...(agentMessages.length === 0 &&
          session.dispatchEvents.length === 0 &&
          (session.summary || session.error)
        ? [{
            id: "message:session-result",
            isComplete: true,
            phase: "final_answer",
            startedAtMs: Date.parse(session.completedAt ?? session.startedAt),
            text: session.error ?? session.summary ?? "",
            updatedAtMs: Date.parse(session.completedAt ?? session.startedAt),
          }]
        : []),
    ].sort((left, right) => left.updatedAtMs - right.updatedAtMs),
    [
      agentMessages,
      session.dispatchEvents,
      session.completedAt,
      session.error,
      session.summary,
      session.startedAt,
    ],
  );
  const { toast } = useToast();
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [followUp, setFollowUp] = useState("");
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);

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

  const sendFollowUp = async () => {
    const message = followUp.trim();
    if (!message || !onFollowUp || isSendingFollowUp) return;
    setFollowUpError(null);
    setIsSendingFollowUp(true);
    setFollowUp("");
    try {
      await onFollowUp(message);
    } catch (caught) {
      setFollowUp(message);
      setFollowUpError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSendingFollowUp(false);
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
      ...(session.followUps ?? []).flatMap((followUp) => [
        "",
        `${t("agents.followUpInput")}:`,
        followUp.message,
      ]),
      "",
      `${t("agents.executionLog")}:`,
      ...executionLogEntries.flatMap((entry) => [
        `[${formatEventTime(entry.updatedAtMs, localeTag)}] ${agentMessagePhase(t, entry.phase)}`,
        naturalLanguageFromAgentMessage(entry.text),
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
            {session.status === "running" && canStopAutoHuntSession(session) ? (
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
                  <Spinner className="size-[24px]" />
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
          <div className="auto-hunt-session-detail-body">
            {stopError ? (
              <div className="auto-hunt-stop-error" role="alert">
                <CircleAlert size={14} />
                {stopError}
              </div>
            ) : null}
            <div className="auto-hunt-session-request-list">
              <article className="auto-hunt-session-request-card">
                <span>{t("agents.sessionRequest")}</span>
                <p>{session.request?.trim() || t("agents.sessionRequestEmpty")}</p>
              </article>
              {(session.followUps ?? []).map((followUp) => (
                <article
                  className="auto-hunt-session-request-card follow-up"
                  key={followUp.id}
                >
                  <span>{t("agents.followUpInput")}</span>
                  <p>{followUp.message}</p>
                </article>
              ))}
            </div>
            <div className="auto-hunt-session-layout">
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
                  {executionLogEntries.length > 0 ? (
                    <AgentWorkLog
                      activity={executionLogEntries}
                      autoScroll
                      provider={activityProvider}
                      terminal={session.status !== "running"}
                    />
                  ) : executionEvents.error ? (
                    <div className="auto-hunt-event-state error">
                      <CircleAlert size={14} />
                      {executionEvents.error}
                    </div>
                  ) : executionEvents.isLoading ? (
                    <div className="auto-hunt-event-state">
                      <Spinner className="size-[14px]" />
                      {t("autoHunt.eventsLoading")}
                    </div>
                  ) : (
                    <div className="auto-hunt-event-state">
                      {t("autoHunt.eventsEmpty")}
                    </div>
                  )}
                  {onFollowUp &&
                      session.sessionType === "task" &&
                      session.localOwner !== false &&
                      session.status !== "running" &&
                      session.conversationId ? (
                    <form
                      className="auto-hunt-session-follow-up"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendFollowUp();
                      }}
                    >
                      <Textarea
                        aria-label={t("agents.followUpInput")}
                        disabled={isSendingFollowUp}
                        onChange={(event) => setFollowUp(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.shiftKey) return;
                          event.preventDefault();
                          void sendFollowUp();
                        }}
                        placeholder={t("agents.followUpPlaceholder")}
                        value={followUp}
                      />
                      <Button
                        aria-label={t("agents.sendFollowUp")}
                        disabled={isSendingFollowUp || !followUp.trim()}
                        size="icon"
                        type="submit"
                      >
                        {isSendingFollowUp
                          ? <Spinner className="size-[24px]" />
                          : <Send />}
                      </Button>
                      {followUpError ? (
                        <p role="alert">{followUpError}</p>
                      ) : null}
                    </form>
                  ) : null}
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
                  {workerLabel ? (
                    <div>
                      <dt>실행 Worker</dt>
                      <dd
                        title={session.workerId ?? session.requestedWorkerId ?? undefined}
                      >
                        {workerLabel}
                      </dd>
                    </div>
                  ) : null}
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
                          <span>{formatIssueKey(issueKeyPrefix, issue.runNumber)}</span>
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
