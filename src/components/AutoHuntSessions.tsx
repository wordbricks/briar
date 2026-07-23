import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  PanelLeftOpen,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutoHuntAppServerEvents } from "../hooks/useAutoHuntAppServerEvents";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  maxAutoHuntSessionIssues,
  type AutoHuntAppServerEvent,
} from "../lib/auto-hunt-agent";
import type {
  AutoHuntSession,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import type { DashboardPayload, HuntRun } from "../types";

export function AutoHuntSessions({
  dashboard,
  error,
  isSidebarOpen,
  onSidebarOpen,
  onStart,
  sessions,
}: {
  dashboard: DashboardPayload | null;
  error: string | null;
  isSidebarOpen: boolean;
  onSidebarOpen: () => void;
  onStart: (runs: HuntRun[]) => string;
  sessions: AutoHuntSession[];
}) {
  const { localeTag, t } = useI18n();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const projectId = dashboard?.project.id ?? null;
  const projectSessions = useMemo(
    () => sessions.filter((session) => session.projectId === projectId),
    [projectId, sessions],
  );
  const queued = (dashboard?.runs ?? [])
    .filter((run) => run.status === "queued")
    .slice(0, maxAutoHuntSessionIssues);
  const runningSession = projectSessions.find((session) => session.status === "running");
  const selectedSession = projectSessions.find(
    (session) => session.id === selectedSessionId,
  ) ?? null;
  const appServerEvents = useAutoHuntAppServerEvents(selectedSession?.id ?? null);
  const eventListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedSession) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedSessionId(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedSession]);

  useEffect(() => {
    const eventList = eventListRef.current;
    if (!eventList || appServerEvents.events.length === 0) return;
    eventList.scrollTop = eventList.scrollHeight;
  }, [appServerEvents.events.length]);

  const start = () => {
    setStartError(null);
    try {
      const sessionId = onStart(queued);
      setSelectedSessionId(sessionId);
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="main-content" id="auto-hunt">
      <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region>
        {!isSidebarOpen && (
          <button
            aria-controls="app-sidebar"
            aria-expanded="false"
            aria-label={t("sidebar.open")}
            className="sidebar-toggle"
            onClick={onSidebarOpen}
            title={t("sidebar.open")}
            type="button"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
      </header>

      <div className="auto-hunt-scroll">
        <section className="auto-hunt-hero">
          <div className="auto-hunt-hero-copy">
            <p className="eyebrow"><Sparkles size={13} />{t("autoHunt.eyebrow")}</p>
            <h1>{t("autoHunt.title")}</h1>
            <p>{t("autoHunt.description")}</p>
            <div className="auto-hunt-capacity">
              <span>{t("autoHunt.available", { count: queued.length })}</span>
              <span>{t("autoHunt.limit")}</span>
            </div>
          </div>
          <button
            className="auto-hunt-start-button"
            disabled={!dashboard || queued.length === 0 || Boolean(runningSession)}
            onClick={start}
            type="button"
          >
            {runningSession
              ? <LoaderCircle className="spin" size={18} />
              : <Play fill="currentColor" size={17} />}
            {runningSession ? t("autoHunt.running") : t("autoHunt.start")}
          </button>
        </section>

        {(error || startError) && (
          <div className="error-banner"><CircleAlert size={16} />{startError ?? error}</div>
        )}

        <section className="auto-hunt-session-panel">
          <header>
            <div>
              <h2>{t("autoHunt.sessions")}</h2>
              <p>{t("autoHunt.sessionsDescription")}</p>
            </div>
            <span>{projectSessions.length}</span>
          </header>

          {projectSessions.length === 0 ? (
            <div className="auto-hunt-empty">
              <span><Bot size={22} /></span>
              <strong>{t("autoHunt.emptyTitle")}</strong>
              <p>{queued.length === 0 ? t("autoHunt.noQueued") : t("autoHunt.emptyDescription")}</p>
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

      {selectedSession && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedSessionId(null);
          }}
        >
          <section
            aria-label={`${t("autoHunt.session")} ${formatDate(selectedSession.startedAt, localeTag)}`}
            aria-modal="true"
            className="auto-hunt-session-dialog"
            role="dialog"
          >
            <header>
              <div>
                <SessionStatusIcon status={selectedSession.status} />
                <span>
                  <small>{t("autoHunt.session")}</small>
                  <strong>{formatDate(selectedSession.startedAt, localeTag)}</strong>
                </span>
              </div>
              <div>
                <span className={`auto-hunt-status ${selectedSession.status}`}>
                  {statusLabel(t, selectedSession.status)}
                </span>
                <button aria-label={t("common.close")} onClick={() => setSelectedSessionId(null)} type="button">
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="auto-hunt-dialog-body">
              {selectedSession.status === "running" && (
                <div className="auto-hunt-running-callout">
                  <LoaderCircle className="spin" size={18} />
                  <span><strong>{t("autoHunt.running")}</strong><small>{t("autoHunt.inProgressDescription")}</small></span>
                </div>
              )}

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
                  <h3>{t("autoHunt.summary")}</h3>
                  <p>{selectedSession.error ?? selectedSession.summary}</p>
                </section>
              )}

              <section className="auto-hunt-dialog-section auto-hunt-app-server-section">
                <header>
                  <div>
                    <h3>{t("autoHunt.appServerEvents")}</h3>
                    <p>{t("autoHunt.appServerEventsDescription")}</p>
                  </div>
                  <span className="auto-hunt-event-count">
                    {selectedSession.status === "running" && (
                      <i><span />{t("autoHunt.live")}</i>
                    )}
                    {t("autoHunt.eventCount", { count: appServerEvents.events.length })}
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
                ) : appServerEvents.events.length === 0 ? (
                  <div className="auto-hunt-event-state">{t("autoHunt.eventsEmpty")}</div>
                ) : (
                  <div className="auto-hunt-app-server-events" ref={eventListRef}>
                    {appServerEvents.events.map((event) => (
                      <details className={`auto-hunt-app-server-event ${event.direction}`} key={event.sequence}>
                        <summary>
                          <span className="auto-hunt-event-direction" title={t(`autoHunt.direction.${event.direction}` as MessageKey)}>
                            {event.direction === "client"
                              ? <ArrowUpRight size={13} />
                              : <ArrowDownLeft size={13} />}
                          </span>
                          <strong>{appServerEventLabel(t, event)}</strong>
                          <small>#{event.sequence}</small>
                          <time dateTime={new Date(event.occurredAtMs).toISOString()}>
                            {formatEventTime(event.occurredAtMs, localeTag)}
                          </time>
                        </summary>
                        <pre>{JSON.stringify(event.message, null, 2)}</pre>
                      </details>
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
      )}
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

function appServerEventLabel(
  t: (key: MessageKey) => string,
  event: AutoHuntAppServerEvent,
) {
  if (typeof event.message.method === "string") return event.message.method;
  const id = typeof event.message.id === "string" || typeof event.message.id === "number"
    ? ` #${event.message.id}`
    : "";
  return `${t(event.direction === "client" ? "autoHunt.request" : "autoHunt.response")}${id}`;
}
