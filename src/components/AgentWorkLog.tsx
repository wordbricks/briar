import { Bot, LoaderCircle } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { AgentProviderIcon } from "./AgentIcons";
import { useI18n } from "../i18n";
import {
  naturalLanguageFromAgentMessage,
  type AutoHuntAgentMessage,
} from "../lib/auto-hunt-agent";
import {
  agentProviderLabels,
  type AgentProvider,
} from "../lib/project-llm";

export function AgentWorkLog({
  activity,
  autoScroll = false,
  provider,
}: {
  activity: AutoHuntAgentMessage[];
  autoScroll?: boolean;
  provider: AgentProvider | null;
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
      {activity.map((message) => (
        <article
          className={`auto-hunt-agent-message${message.isComplete ? "" : " running"}`}
          key={message.id}
        >
          <header>
            <span aria-hidden="true">
              {provider
                ? <AgentProviderIcon provider={provider} size={14} />
                : <Bot size={14} />}
            </span>
            <strong>
              {provider
                ? agentProviderLabels[provider]
                : message.phase === "final_answer" || message.phase === "final"
                  ? t("autoHunt.agentMessage.final")
                  : t("autoHunt.agentMessage.commentary")}
            </strong>
            {!message.isComplete ? (
              <small className="auto-hunt-message-streaming">
                <LoaderCircle className="spin" size={11} />
                {t("autoHunt.agentMessage.streaming")}
              </small>
            ) : null}
            <time dateTime={new Date(message.updatedAtMs).toISOString()}>
              {relativeTime(message.updatedAtMs, t)}
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
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function relativeTime(value: number, t: Translate) {
  const minutes = Math.max(1, Math.round((Date.now() - value) / 60_000));
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  if (minutes < 1_440) {
    return t("time.hoursAgo", { count: Math.floor(minutes / 60) });
  }
  return t("time.daysAgo", { count: Math.floor(minutes / 1_440) });
}
