import {
  Bot,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Typography } from "@/components/ui/typography";
import type {
  AutoHuntSession,
  AutoHuntSessionStatus,
} from "../hooks/useAutoHuntSessions";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { ProjectAgent } from "../types";

export function ProjectAgentSessions({
  agent,
  onRequestedSessionOpen,
  projectId,
  requestedSessionId,
  sessions,
}: {
  agent: ProjectAgent;
  onRequestedSessionOpen?: () => void;
  projectId: string;
  requestedSessionId: string | null;
  sessions: AutoHuntSession[];
}) {
  const { localeTag, t } = useI18n();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const agentSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.projectId === projectId && session.agentId === agent.id,
      ),
    [agent.id, projectId, sessions],
  );
  const selectedSession =
    agentSessions.find((session) => session.id === selectedSessionId) ?? null;

  useEffect(() => {
    if (
      !requestedSessionId ||
      !agentSessions.some((session) => session.id === requestedSessionId)
    ) {
      return;
    }
    setSelectedSessionId(requestedSessionId);
    onRequestedSessionOpen?.();
  }, [agentSessions, onRequestedSessionOpen, requestedSessionId]);

  return (
    <>
      <section className="auto-hunt-session-panel project-agent-session-panel">
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
                onClick={() => setSelectedSessionId(session.id)}
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
                    ? t("agents.runTask")
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

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSelectedSessionId(null);
        }}
        open={selectedSession !== null}
      >
        <DialogContent className="project-agent-session-dialog">
          {selectedSession ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("autoHunt.session")} ·{" "}
                  {formatDate(selectedSession.startedAt, localeTag)}
                </DialogTitle>
                <DialogDescription>
                  {statusLabel(t, selectedSession.status)}
                </DialogDescription>
              </DialogHeader>

              <div className="project-agent-session-dialog-body">
                {selectedSession.sessionType === "task" ? (
                  <section>
                    <Typography as="h3" variant="body">
                      {t("agents.taskInput")}
                    </Typography>
                    <Typography>{selectedSession.request}</Typography>
                  </section>
                ) : (
                  <section>
                    <Typography as="h3" variant="body">
                      {t("autoHunt.targets")}
                    </Typography>
                    <div className="auto-hunt-target-list">
                      {selectedSession.issues.map((issue) => (
                        <article className="auto-hunt-target" key={issue.runId}>
                          <span>AH-{issue.runNumber}</span>
                          <div>
                            <strong>{issue.title}</strong>
                            {issue.summary ? (
                              <small>{issue.summary}</small>
                            ) : null}
                          </div>
                          <span className={`auto-hunt-outcome ${issue.outcome}`}>
                            {t(
                              `autoHunt.outcome.${issue.outcome}` as MessageKey,
                            )}
                          </span>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                {selectedSession.summary || selectedSession.error ? (
                  <section
                    className={`auto-hunt-summary${
                      selectedSession.error ? " error" : ""
                    }`}
                  >
                    <Typography as="h3" variant="body">
                      {t("autoHunt.summary")}
                    </Typography>
                    <p>
                      {selectedSession.error ?? selectedSession.summary}
                    </p>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
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

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
