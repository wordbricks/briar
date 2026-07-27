import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  agentMessagesFromAppServerEvents,
  naturalLanguageFromAgentMessage,
} from "../lib/auto-hunt-agent";
import {
  defaultAutoHuntMaxIssues,
  selectAutoHuntCandidates,
} from "../lib/auto-hunt-automation";
import type {
  AutoHuntSession,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import type { DashboardPayload, HuntRun, ProjectAgent } from "../types";

function agentCopy(value: string) {
  return value
    .replaceAll("Codex App Server", "Agent backend")
    .replaceAll("Codex Agent", "Agent")
    .replaceAll("Codex", "Agent");
}

export function AutoHuntSessions({
  agent,
  companionMode = false,
  dashboard,
  error,
  isSidebarOpen,
  onAgentBack,
  onBack,
  onRequestedSessionOpen,
  onStart,
  requestedSessionId = null,
  sessions,
}: {
  agent?: ProjectAgent;
  companionMode?: boolean;
  dashboard: DashboardPayload | null;
  error: string | null;
  isSidebarOpen: boolean;
  onAgentBack?: () => void;
  onBack?: () => void;
  onRequestedSessionOpen?: () => void;
  onStart: (runs: HuntRun[]) => string;
  requestedSessionId?: string | null;
  sessions: AutoHuntSession[];
}) {
  const { localeTag, t } = useI18n();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const projectId = dashboard?.project.id ?? null;
  const projectSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.projectId === projectId &&
          (!agent ||
            session.agentId === agent.id ||
            (agent.kind === "auto_hunt" && !session.agentId)),
      ),
    [agent, projectId, sessions],
  );
  const maxIssues =
    dashboard?.settings?.automation?.maxIssuesPerSession ??
    defaultAutoHuntMaxIssues;
  const queued = selectAutoHuntCandidates(dashboard?.runs ?? [], maxIssues);
  const runningSession = projectSessions.find((session) => session.status === "running");
  const canStart = !agent || agent.kind === "auto_hunt";
  const selectedSession = projectSessions.find(
    (session) => session.id === selectedSessionId,
  ) ?? null;
  const appServerEvents = useAutoHuntAppServerEvents(selectedSession?.id ?? null);
  const agentMessages = useMemo(
    () => agentMessagesFromAppServerEvents(appServerEvents.events),
    [appServerEvents.events],
  );
  const eventListRef = useRef<HTMLDivElement>(null);
  const latestAgentMessage = agentMessages[agentMessages.length - 1];

  useEffect(() => {
    const eventList = eventListRef.current;
    if (!eventList || agentMessages.length === 0) return;
    eventList.scrollTop = eventList.scrollHeight;
  }, [agentMessages.length, latestAgentMessage?.text.length]);

  useEffect(() => {
    if (!requestedSessionId) return;
    if (!projectSessions.some((session) => session.id === requestedSessionId)) {
      return;
    }
    setSelectedSessionId(requestedSessionId);
    onRequestedSessionOpen?.();
  }, [onRequestedSessionOpen, projectSessions, requestedSessionId]);

  const start = () => {
    setStartError(null);
    try {
      const sessionId = onStart(queued);
      setSelectedSessionId(sessionId);
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (selectedSession) {
    return (
      <main className="main-content" id="auto-hunt-session">
        {!companionMode && <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region />}

        <div className="auto-hunt-scroll auto-hunt-session-detail-scroll">
          <section
            aria-labelledby="auto-hunt-session-title"
            className="auto-hunt-session-page"
          >
            <header>
              <div className="auto-hunt-session-page-heading">
                <button
                  className="auto-hunt-session-back"
                  onClick={() => {
                    if (onBack) onBack();
                    else setSelectedSessionId(null);
                  }}
                  type="button"
                >
                  <ArrowLeft size={16} />
                  {t("run.back")}
                </button>
                <div>
                  <SessionStatusIcon status={selectedSession.status} />
                  <span>
                    <small>{t("autoHunt.session")}</small>
                    <h1 id="auto-hunt-session-title">
                      {formatDate(selectedSession.startedAt, localeTag)}
                    </h1>
                  </span>
                </div>
              </div>
              <span className={`auto-hunt-status ${selectedSession.status}`}>
                {statusLabel(t, selectedSession.status)}
              </span>
            </header>

            <div className="auto-hunt-session-detail-body">
              <section className="auto-hunt-dialog-section">
                <h3>{t("autoHunt.targets")}</h3>
                <div className="auto-hunt-target-list">
                  {selectedSession.issues.map((issue) => (
                    <article className="auto-hunt-target" key={issue.runId}>
                      <span>AH-{issue.runNumber}</span>
                      <div><strong>{issue.title}</strong>{issue.summary && <small>{issue.summary}</small>}</div>
                      <span className={`auto-hunt-outcome ${issue.outcome}`}>
                        {outcomeLabel(t, issue.outcome)}
                      </span>
                    </article>
                  ))}
                </div>
              </section>

              {(selectedSession.summary || selectedSession.error) && (
                <section className={`auto-hunt-summary${selectedSession.error ? " error" : ""}`}>
                  <h3>{agentCopy(t("autoHunt.summary"))}</h3>
                  <p>{selectedSession.error ?? selectedSession.summary}</p>
                </section>
              )}

              <section className="auto-hunt-dialog-section auto-hunt-app-server-section">
                <header>
                  <div>
                    <h3>{agentCopy(t("autoHunt.appServerEvents"))}</h3>
                    <p>{agentCopy(t("autoHunt.appServerEventsDescription"))}</p>
                  </div>
                  <span className="auto-hunt-event-count">
                    {selectedSession.status === "running" && (
                      <i><span />{t("autoHunt.live")}</i>
                    )}
                    {t("autoHunt.eventCount", { count: agentMessages.length })}
                  </span>
                </header>
                {appServerEvents.error ? (
                  <div className="auto-hunt-event-state error">
                    <CircleAlert size={14} />{appServerEvents.error}
                  </div>
                ) : appServerEvents.isLoading ? (
                  <div className="auto-hunt-event-state">
                    <LoaderCircle className="spin" size={14} />{t("autoHunt.eventsLoading")}
                  </div>
                ) : agentMessages.length === 0 ? (
                  <div className="auto-hunt-event-state">{t("autoHunt.eventsEmpty")}</div>
                ) : (
                  <div className="auto-hunt-agent-messages" ref={eventListRef}>
                    {agentMessages.map((message) => (
                      <article className="auto-hunt-agent-message" key={message.id}>
                        <header>
                          <span><Bot size={13} /></span>
                          <strong>{agentMessagePhase(t, message.phase)}</strong>
                          {!message.isComplete && (
                            <small className="auto-hunt-message-streaming">
                              <LoaderCircle className="spin" size={11} />
                              {t("autoHunt.agentMessage.streaming")}
                            </small>
                          )}
                          <time dateTime={new Date(message.updatedAtMs).toISOString()}>
                            {formatEventTime(message.updatedAtMs, localeTag)}
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

              <section className="auto-hunt-dialog-section">
                <h3>{t("autoHunt.timeline")}</h3>
                <div className="auto-hunt-timeline">
                  {selectedSession.events.map((sessionEvent) => (
                    <div className={`auto-hunt-session-event ${sessionEvent.type}`} key={sessionEvent.id}>
                      <i />
                      <span>
                        <strong>{t(`autoHunt.event.${sessionEvent.type}` as MessageKey)}</strong>
                        <small><Clock3 size={12} />{formatDate(sessionEvent.occurredAt, localeTag)}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="main-content" id={agent ? "project-agent-detail" : "auto-hunt"}>
      {!companionMode && <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region />}

      <div className="auto-hunt-scroll">
        <section className="auto-hunt-hero">
          <div className="auto-hunt-hero-copy">
            {agent && onAgentBack ? (
              <button
                className="auto-hunt-session-back project-agent-detail-back"
                onClick={onAgentBack}
                type="button"
              >
                <ArrowLeft size={16} />
                {t("agents.back")}
              </button>
            ) : null}
            <p className="eyebrow">
              {agent ? <Bot size={13} /> : <Sparkles size={13} />}
              {agent ? t("agents.detailEyebrow") : agentCopy(t("autoHunt.eyebrow"))}
            </p>
            <h1>{agent?.name ?? t("autoHunt.title")}</h1>
            <p>{agent?.responsibility ?? agentCopy(t("autoHunt.description"))}</p>
            {canStart ? (
              <div className="auto-hunt-capacity">
                <span>{t("autoHunt.available", { count: queued.length })}</span>
                <span>{t("autoHunt.limit", { count: maxIssues })}</span>
              </div>
            ) : null}
          </div>
          {canStart ? (
            <button
              className="auto-hunt-start-button"
              disabled={!dashboard || queued.length === 0 || Boolean(runningSession)}
              onClick={start}
              type="button"
            >
              {runningSession
                ? <LoaderCircle className="spin" size={18} />
                : <Play fill="currentColor" size={17} />}
              {runningSession
                ? t("autoHunt.running")
                : agent
                  ? t("agents.runNow")
                  : t("autoHunt.start")}
            </button>
          ) : null}
        </section>

        {(error || startError) && (
          <div className="error-banner"><CircleAlert size={16} />{startError ?? error}</div>
        )}

        <section className="auto-hunt-session-panel">
          <header>
            <div>
              <h2>{agent ? t("agents.sessions") : t("autoHunt.sessions")}</h2>
              <p>
                {agent
                  ? t("agents.sessionsDescription")
                  : t("autoHunt.sessionsDescription")}
              </p>
            </div>
            <span>{projectSessions.length}</span>
          </header>

          {projectSessions.length === 0 ? (
            <div className="auto-hunt-empty">
              <span><Bot size={22} /></span>
              <strong>
                {agent ? t("agents.emptySessions") : t("autoHunt.emptyTitle")}
              </strong>
              <p>
                {agent && !canStart
                  ? t("agents.emptySessionsDescription")
                  : queued.length === 0
                    ? t("autoHunt.noQueued")
                    : t("autoHunt.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="auto-hunt-session-list">
              {projectSessions.map((session) => (
                <button
                  className="auto-hunt-session-row"
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  type="button"
                >
                  <SessionStatusIcon status={session.status} />
                  <span className="auto-hunt-session-copy">
                    <strong>{t("autoHunt.session")} · {formatDate(session.startedAt, localeTag)}</strong>
                    <small>{session.issues.map((issue) => issue.title).join(" · ")}</small>
                  </span>
                  <span className={`auto-hunt-status ${session.status}`}>
                    {statusLabel(t, session.status)}
                  </span>
                  <span className="auto-hunt-session-count">
                    {t("autoHunt.issueCount", { count: session.issues.length })}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

    </main>
  );
}

function SessionStatusIcon({ status }: { status: AutoHuntSessionStatus }) {
  return (
    <span className={`auto-hunt-session-icon ${status}`}>
      {status === "running" ? <LoaderCircle className="spin" size={17} /> : <Bot size={17} />}
    </span>
  );
}

function statusLabel(t: (key: MessageKey) => string, status: AutoHuntSessionStatus) {
  return t(`autoHunt.status.${status}` as MessageKey);
}

function outcomeLabel(t: (key: MessageKey) => string, outcome: AutoHuntSessionIssueOutcome) {
  return t(`autoHunt.outcome.${outcome}` as MessageKey);
}

function formatDate(value: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatEventTime(value: number, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, {
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
