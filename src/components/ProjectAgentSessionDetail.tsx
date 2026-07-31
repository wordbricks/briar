import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  OctagonX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MainContent, PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import type {
  AutoHuntSession,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  agentMessagesFromAppServerEvents,
  naturalLanguageFromAgentMessage,
} from "../lib/auto-hunt-agent";

export function ProjectAgentSessionDetail({
  isSidebarOpen,
  onBack,
  onIssueOpen,
  onStop,
  session,
}: {
  isSidebarOpen: boolean;
  onBack: () => void;
  onIssueOpen: (runId: string) => void;
  onStop: () => Promise<boolean>;
  session: AutoHuntSession;
}) {
  const { localeTag, t } = useI18n();
  const appServerEvents = useAutoHuntAppServerEvents(
    session.sessionType === "task" ? session.id : null,
  );
  const agentMessages = useMemo(
    () => agentMessagesFromAppServerEvents(appServerEvents.events),
    [appServerEvents.events],
  );
  const agentMessagesRef = useRef<HTMLDivElement>(null);
  const workerProgressRef = useRef<HTMLDivElement>(null);
  const latestAgentMessage = agentMessages[agentMessages.length - 1];
  const latestDispatchEvent =
    session.dispatchEvents[session.dispatchEvents.length - 1];
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    const workerProgress = workerProgressRef.current;
    if (!workerProgress || session.dispatchEvents.length === 0) return;
    workerProgress.scrollTop = workerProgress.scrollHeight;
  }, [
    session.dispatchEvents.length,
    latestDispatchEvent?.message.length,
  ]);

  useEffect(() => {
    const messageList = agentMessagesRef.current;
    if (!messageList || agentMessages.length === 0) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [agentMessages.length, latestAgentMessage?.text.length]);

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

  return (
    <MainContent id="project-agent-session">
      <PageHeader
        action={
          <div className="auto-hunt-session-page-actions">
            {session.status === "running" ? (
              <Button
                aria-label={t("agents.stopSession")}
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
            <span className={`auto-hunt-status ${session.status}`}>
              {statusLabel(t, session.status)}
            </span>
          </div>
        }
        className={`app-page-header auto-hunt-session-page-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
        title={
          <span className="project-agent-detail-title">
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
            <SessionStatusIcon status={session.status} />
            <span>{formatDate(session.startedAt, localeTag)}</span>
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
            {session.sessionType === "task" ? (
              <section className="auto-hunt-dialog-section">
                <h3>{t("agents.taskInput")}</h3>
                <p className="project-agent-session-request">
                  {session.request}
                </p>
              </section>
            ) : (
              <section className="auto-hunt-dialog-section">
                <h3>{t("autoHunt.targets")}</h3>
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
              </section>
            )}

            {session.dispatchEvents.length > 0 ? (
              <section
                aria-labelledby="auto-hunt-worker-progress-title"
                className="auto-hunt-dialog-section"
              >
                <h3 id="auto-hunt-worker-progress-title">
                  {t("autoHunt.workerTimeline")}
                </h3>
                <div
                  aria-labelledby="auto-hunt-worker-progress-title"
                  className="auto-hunt-timeline auto-hunt-worker-progress"
                  ref={workerProgressRef}
                  role="region"
                  tabIndex={0}
                >
                  {session.dispatchEvents.map((dispatchEvent) => (
                    <div
                      className={`auto-hunt-session-event ${dispatchEvent.status}`}
                      key={`${dispatchEvent.dispatchGroupId}:${dispatchEvent.cursor}`}
                    >
                      <i />
                      <span>
                        <strong>
                          {naturalLanguageFromAgentMessage(
                            dispatchEvent.message,
                          )}
                        </strong>
                        <small>
                          <Clock3 size={12} />
                          {formatDate(dispatchEvent.occurredAt, localeTag)}
                          {dispatchEvent.workerSessionId
                            ? ` · ${dispatchEvent.workerSessionId}`
                            : ""}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {session.summary || session.error ? (
              <section
                className={`auto-hunt-summary${session.error ? " error" : ""}`}
              >
                <h3>{t("autoHunt.summary")}</h3>
                <p>{session.error ?? session.summary}</p>
              </section>
            ) : null}

            {session.sessionType === "task" ? (
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
                      count: agentMessages.length,
                    })}
                  </span>
                </header>
                {appServerEvents.error ? (
                  <div className="auto-hunt-event-state error">
                    <CircleAlert size={14} />
                    {appServerEvents.error}
                  </div>
                ) : appServerEvents.isLoading ? (
                  <div className="auto-hunt-event-state">
                    <LoaderCircle className="spin" size={14} />
                    {t("autoHunt.eventsLoading")}
                  </div>
                ) : agentMessages.length === 0 ? (
                  <div className="auto-hunt-event-state">
                    {t("autoHunt.eventsEmpty")}
                  </div>
                ) : (
                  <div
                    aria-live="polite"
                    className="auto-hunt-agent-messages"
                    ref={agentMessagesRef}
                    role="log"
                  >
                    {agentMessages.map((message) => (
                      <article
                        className="auto-hunt-agent-message"
                        key={message.id}
                      >
                        <header>
                          <span>
                            <Bot size={13} />
                          </span>
                          <strong>
                            {agentMessagePhase(t, message.phase)}
                          </strong>
                          {!message.isComplete ? (
                            <small className="auto-hunt-message-streaming">
                              <LoaderCircle className="spin" size={11} />
                              {t("autoHunt.agentMessage.streaming")}
                            </small>
                          ) : null}
                          <time
                            dateTime={new Date(
                              message.updatedAtMs,
                            ).toISOString()}
                          >
                            {formatEventTime(
                              message.updatedAtMs,
                              localeTag,
                            )}
                          </time>
                        </header>
                        <p>
                          {message.text
                            ? naturalLanguageFromAgentMessage(message.text)
                            : t("autoHunt.agentMessage.writing")}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            <section className="auto-hunt-dialog-section">
              <h3>{t("autoHunt.timeline")}</h3>
              <div className="auto-hunt-timeline">
                {session.events.map((sessionEvent) => (
                  <div
                    className={`auto-hunt-session-event ${sessionEvent.type}`}
                    key={sessionEvent.id}
                  >
                    <i />
                    <span>
                      <strong>
                        {t(
                          `autoHunt.event.${sessionEvent.type}` as MessageKey,
                        )}
                      </strong>
                      <small>
                        <Clock3 size={12} />
                        {formatDate(sessionEvent.occurredAt, localeTag)}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </MainContent>
  );
}

function SessionStatusIcon({ status }: { status: AutoHuntSessionStatus }) {
  return (
    <span className={`auto-hunt-session-icon ${status}`}>
      {status === "running" ? (
        <LoaderCircle className="spin" size={17} />
      ) : (
        <Bot size={17} />
      )}
    </span>
  );
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
