import { useAtomValue } from "@effect/atom-react";
import { Bot } from "lucide-react";

import { useI18n } from "../i18n";
import { displayChannelActivityHeadline } from "../lib/auto-hunt-agent";
import { agentProviderLabels } from "../lib/agent-provider";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";
import {
  channelAgentsAtom,
  channelMessageKey,
  channelMessagePendingRepliesAtom,
} from "../state/channel-conversation/atoms";
import { channelMessageActivityAtom } from "../state/channel-conversation/activity";
import {
  activityForReplies,
  typingAgentsForReplies,
  type TypingAgentDescriptor,
} from "../state/channel-conversation/model";
import { AgentProviderIcon } from "./AgentIcons";
import { LoadingState } from "./ui/loading-state";

/**
 * DM placeholder row(s) for agents writing a reply.
 *
 * Instead of a one-line typing indicator inside the user's message body, each
 * agent with concrete commentary gets its own message-like row with avatar,
 * provider badge, agent name, time, and a status bubble with the loading
 * animation. The row disappears when activity is cleared or the real agent
 * message arrives.
 */
export function ChannelMessageTypingPlaceholder({
  channelId,
  className,
  localeTag,
  messageId,
}: {
  readonly channelId: string;
  readonly className?: string;
  readonly localeTag: string;
  readonly messageId: string;
}) {
  const { t } = useI18n();
  const key = channelMessageKey(channelId, messageId);
  const own = useAtomValue(channelMessagePendingRepliesAtom(key));
  const agents = useAtomValue(channelAgentsAtom(channelId));
  const activity = useAtomValue(channelMessageActivityAtom(key));
  const fallbackAgentName = t("channel.projectAgent");
  const descriptors = typingAgentsForReplies(
    own,
    agents,
    activity,
    new Set([messageId]),
    fallbackAgentName,
  );
  const activityByName = activityForReplies(
    own,
    agents,
    activity,
    fallbackAgentName,
  );
  if (descriptors.length === 0) return null;
  return descriptors.map((agent) => {
    const activityDescriptor = activityByName[agent.name];
    return activityDescriptor ? (
      <TypingPlaceholderRow
        key={agent.name}
        agent={agent}
        activityDescriptor={activityDescriptor}
        className={className}
        localeTag={localeTag}
      />
    ) : null;
  });
}

function TypingPlaceholderRow({
  agent,
  activityDescriptor,
  className,
  localeTag,
}: {
  agent: TypingAgentDescriptor;
  activityDescriptor: ChannelAgentActivityDescriptor;
  className?: string;
  localeTag: string;
}) {
  const label = `${agent.name} · ${displayChannelActivityHeadline(activityDescriptor)}`;

  return (
    <article
      aria-live="polite"
      className={`channel-message agent channel-typing-placeholder${className ? ` ${className}` : ""}`}
      role="status"
    >
      <div className="channel-message-avatar" aria-hidden="true">
        {agent.avatar ? (
          <img alt="" src={agent.avatar} />
        ) : (
          <span className="channel-message-avatar-fallback agent">
            <Bot size={16} />
          </span>
        )}
        {agent.provider ? (
          <span
            aria-label={agentProviderLabels[agent.provider]}
            className={`channel-agent-badge ${agent.provider}`}
            role="img"
            title={agentProviderLabels[agent.provider]}
          >
            <AgentProviderIcon provider={agent.provider} size={11} />
          </span>
        ) : null}
      </div>
      <div className="channel-message-body">
        <header>
          <strong>{agent.name}</strong>
          <time dateTime={agent.createdAt}>
            {new Intl.DateTimeFormat(localeTag, {
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(agent.createdAt))}
          </time>
        </header>
        <LoadingState label={label} size="compact" />
      </div>
    </article>
  );
}
