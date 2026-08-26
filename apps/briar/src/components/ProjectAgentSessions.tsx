import { Bot, ChevronRight } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useMemo } from "react";

import { EmptyState } from "@/components/layout";
import { Typography } from "@/components/ui/typography";
import type {
  AutoHuntSession,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import { collapseLinkedAutoHuntSessions } from "../hooks/useAutoHuntSessions";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { ProjectAgent } from "../types";

export function ProjectAgentSessions({
  agent,
  onSessionOpen,
  projectId,
  sessions,
}: {
  agent: ProjectAgent;
  onSessionOpen: (sessionId: string) => void;
  projectId: string;
  sessions: AutoHuntSession[];
}) {
  const { localeTag, t } = useI18n();
  const agentSessions = useMemo(() => {
    const matchingSessions = sessions.filter(
      (session) =>
        session.projectId === projectId && session.agentId === agent.id,
    );
    return collapseLinkedAutoHuntSessions(matchingSessions);
  }, [agent.id, projectId, sessions]);

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
          {agentSessions.map((session) => (
            <button
              className="auto-hunt-session-row"
              key={session.id}
              onClick={() => onSessionOpen(session.id)}
              type="button"
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
              <ChevronRight size={16} />
            </button>
          ))}
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
