import { Bot, ChevronRight, OctagonX } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/layout";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type {
  AutoHuntSession,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import { collapseLinkedAutoHuntSessions } from "../hooks/useAutoHuntSessions";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { ProjectAgent } from "../types";

export function TeamAgentSessions({
  agent,
  onSessionOpen,
  onStopSession,
  projectId,
  sessions,
}: {
  agent: ProjectAgent;
  onSessionOpen: (sessionId: string) => void;
  onStopSession?: (sessionId: string) => Promise<boolean>;
  projectId: string;
  sessions: AutoHuntSession[];
}) {
  const { localeTag, t } = useI18n();
  const { toast } = useToast();
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(
    () => new Set(),
  );

  const agentSessions = useMemo(() => {
    const matchingSessions = sessions.filter(
      (session) =>
        session.projectId === projectId && session.agentId === agent.id,
    );
    return collapseLinkedAutoHuntSessions(matchingSessions);
  }, [agent.id, projectId, sessions]);

  const handleStop = async (sessionId: string) => {
    if (!onStopSession || stoppingSessionIds.has(sessionId)) return;
    setStoppingSessionIds((current) => new Set(current).add(sessionId));
    try {
      const stopped = await onStopSession(sessionId);
      if (!stopped) {
        toast(t("agents.stopSessionFailed"), { tone: "error" });
      }
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : t("agents.stopSessionFailed"),
        { tone: "error" },
      );
    } finally {
      setStoppingSessionIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
  };

  return (
    <section className="auto-hunt-session-panel m-0 min-h-0 w-full flex-1 rounded-none border-0 shadow-none">
      <header>
        <div>
          <Typography as="h2" variant="bodyLg">
            {t("agents.sessions")}
          </Typography>
          <Typography tone="muted" variant="caption">
            {t("agents.sessionsDescription")}
          </Typography>
        </div>
        <span>{agentSessions.length}</span>
      </header>

      {agentSessions.length === 0 ? (
        <EmptyState
          className="auto-hunt-empty"
          description={t("agents.emptySessionsDescription")}
          icon={<Bot size={22} />}
          title={t("agents.emptySessions")}
        />
      ) : (
        <div className="auto-hunt-session-list">
          {agentSessions.map((session) => {
            const isRunning = session.status === "running";
            const canStop =
              isRunning && session.localOwner !== false && Boolean(onStopSession);
            const isStopping = stoppingSessionIds.has(session.id);
            return (
              <div
                className="auto-hunt-session-row"
                key={session.id}
                onClick={() => onSessionOpen(session.id)}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onSessionOpen(session.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <SessionStatusIcon status={session.status} />
                <span className="auto-hunt-session-copy">
                  <strong>
                    {t("autoHunt.session")} ·{" "}
                    {formatDate(session.startedAt, localeTag)}
                  </strong>
                  <small>
                    {session.request ??
                      session.issues.map((issue) => issue.title).join(" · ")}
                  </small>
                </span>
                <span className={`auto-hunt-status ${session.status}`}>
                  {statusLabel(t, session.status)}
                </span>
                <span className="auto-hunt-session-count">
                  {session.sessionType === "task"
                    ? t(
                        session.trigger === "scheduled"
                          ? "agents.scheduledRun"
                          : "agents.runTask",
                      )
                    : t("autoHunt.issueCount", {
                        count: session.issues.length,
                      })}
                </span>
                <span className="auto-hunt-session-row-actions">
                  {canStop ? (
                    <Button
                      aria-label={t("agents.stopSession")}
                      className="auto-hunt-session-row-stop size-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={isStopping}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStop(session.id);
                      }}
                      size="icon"
                      title={t("agents.stopSession")}
                      type="button"
                      variant="ghost"
                    >
                      {isStopping ? (
                        <Spinner size={14} />
                      ) : (
                        <OctagonX size={15} />
                      )}
                    </Button>
                  ) : null}
                  <ChevronRight size={16} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SessionStatusIcon({ status }: { status: AutoHuntSessionStatus }) {
  return (
    <span className={`auto-hunt-session-icon ${status}`}>
      {status === "running" ? <Spinner size={17} /> : <Bot size={17} />}
    </span>
  );
}

function statusLabel(
  t: (key: MessageKey) => string,
  status: AutoHuntSessionStatus,
) {
  return t(`autoHunt.status.${status}` as MessageKey);
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
