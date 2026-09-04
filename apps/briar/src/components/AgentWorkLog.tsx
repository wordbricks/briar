import {
  Bot,
  FileDiff,
  Globe,
  Terminal,
  Wrench,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useLayoutEffect, useRef } from "react";

import { AgentProviderIcon } from "./AgentIcons";
import { useI18n } from "../i18n";
import {
  naturalLanguageFromAgentMessage,
  type AutoHuntAgentActivity,
  type AutoHuntAgentMessage,
} from "../lib/auto-hunt-agent";
import {
  agentProviderLabels,
  type AgentProvider,
} from "../lib/team-llm";

export function AgentWorkLog({
  activity,
  autoScroll = false,
  provider,
  terminal = false,
}: {
  activity: AutoHuntAgentMessage[];
  autoScroll?: boolean;
  provider: AgentProvider | null;
  terminal?: boolean;
}) {
  const { t } = useI18n();
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const latestMessage = activity[activity.length - 1];

  useLayoutEffect(() => {
    const log = logRef.current;
    if (autoScroll && stickToBottomRef.current && log && activity.length > 0) {
      log.scrollTop = log.scrollHeight;
    }
  }, [activity.length, autoScroll, latestMessage?.text.length]);

  const handleScroll = () => {
    const log = logRef.current;
    if (!log) return;
    stickToBottomRef.current =
      log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  };

  return (
    <div
      aria-live="polite"
      className="auto-hunt-agent-messages"
      onScroll={autoScroll ? handleScroll : undefined}
      ref={logRef}
      role="log"
    >
      {activity.map((message) => {
        const isComplete = message.isComplete || terminal;
        const entryActivity = message.activity;
        const status = entryActivity && isComplete
          ? entryActivity.status === "running"
            ? "completed"
            : entryActivity.status
          : entryActivity?.status ?? null;
        return (
          <article
            className={[
              "auto-hunt-agent-message",
              isComplete ? "" : "running",
              entryActivity ? "activity" : "",
              status === "failed" ? "failed" : "",
            ].filter(Boolean).join(" ")}
            key={message.id}
          >
            <header>
              <span aria-hidden="true">
                {entryActivity
                  ? <ActivityIcon kind={entryActivity.kind} />
                  : provider
                    ? <AgentProviderIcon provider={provider} size={14} />
                    : <Bot size={14} />}
              </span>
              <strong>
                {entryActivity
                  ? entryActivity.title || t(activityKindKey(entryActivity.kind))
                  : provider
                    ? agentProviderLabels[provider]
                    : message.phase === "final_answer" ||
                        message.phase === "final"
                      ? t("autoHunt.agentMessage.final")
                      : t("autoHunt.agentMessage.commentary")}
              </strong>
              {!isComplete ? (
                <small className="auto-hunt-message-streaming">
                  <Spinner size={11} />
                  {entryActivity
                    ? t("autoHunt.agentActivity.running")
                    : t("autoHunt.agentMessage.streaming")}
                </small>
              ) : status === "failed" || status === "cancelled" ? (
                <small className="auto-hunt-activity-status">
                  {t(
                    status === "failed"
                      ? "autoHunt.agentActivity.failed"
                      : "autoHunt.agentActivity.cancelled",
                  )}
                </small>
              ) : null}
              <time dateTime={new Date(message.updatedAtMs).toISOString()}>
                {relativeTime(message.updatedAtMs, t)}
              </time>
            </header>
            {entryActivity
              ? message.text
                ? <pre>{message.text}</pre>
                : null
              : (
                <p>
                  {message.text
                    ? naturalLanguageFromAgentMessage(message.text)
                    : t("autoHunt.agentMessage.writing")}
                </p>
              )}
          </article>
        );
      })}
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

const activityKindKey = (kind: AutoHuntAgentActivity["kind"]) => {
  switch (kind) {
    case "command":
      return "autoHunt.agentActivity.command" as const;
    case "fileChange":
      return "autoHunt.agentActivity.fileChange" as const;
    case "webSearch":
      return "autoHunt.agentActivity.webSearch" as const;
    case "tool":
      return "autoHunt.agentActivity.tool" as const;
  }
};

function ActivityIcon({ kind }: { kind: AutoHuntAgentActivity["kind"] }) {
  switch (kind) {
    case "command":
      return <Terminal size={14} />;
    case "fileChange":
      return <FileDiff size={14} />;
    case "webSearch":
      return <Globe size={14} />;
    case "tool":
      return <Wrench size={14} />;
  }
}

function relativeTime(value: number, t: Translate) {
  const minutes = Math.max(1, Math.round((Date.now() - value) / 60_000));
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  if (minutes < 1_440) {
    return t("time.hoursAgo", { count: Math.floor(minutes / 60) });
  }
  return t("time.daysAgo", { count: Math.floor(minutes / 1_440) });
}
