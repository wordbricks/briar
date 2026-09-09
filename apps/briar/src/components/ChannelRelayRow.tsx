import { Bot, TriangleAlert } from "lucide-react";

import { useI18n } from "../i18n";
import type { ChannelMessageRelay } from "../lib/channels-contract";
import { cn } from "../lib/utils";
import { Spinner } from "./ui/spinner";

/*
  An Agent-to-Agent round trip, as it appears in the person's own conversation.

  The Agent that was asked to reach another one leaves a short notice behind
  ("메시지 보냄 → B") rather than a bubble, because the text it sent belongs to
  the Agent-to-Agent conversation and is only summarised here. B's answer never
  appears either: the Agent that asked reads it and writes its own reply, so
  the conversation stays in that Agent's voice. The notice links through to the
  read-only Agent-to-Agent conversation, where both sides are readable in full.
*/

const relayAvatarClass =
  "grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/12 text-primary [&>img]:size-full [&>img]:object-cover";

function RelayAgentAvatar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  return (
    <span
      className={cn(relayAvatarClass, "channel-relay-avatar")}
      role="img"
      aria-label={name}
      style={{ height: 18, width: 18 }}
    >
      {image ? <img alt="" src={image} /> : <Bot aria-hidden="true" size={11} />}
    </span>
  );
}

/**
 * The outbound notice: a compact system row rather than a message bubble. The
 * text the Agent sent hangs off the row's `title`, since the row itself is a
 * link into the conversation where that text actually lives.
 */
export function ChannelRelayOutboundNotice({
  body,
  onOpen,
  relay,
  time,
}: {
  /** The notice message's own body, offered on hover. */
  body: string;
  onOpen?: () => void;
  relay: ChannelMessageRelay;
  time: string;
}) {
  const { t } = useI18n();
  const name = relay.peerAgentName;
  return (
    <div
      className="channel-relay-notice flex flex-wrap items-center gap-x-2 gap-y-1 py-1 pl-1 text-xs text-muted-foreground"
      data-relay-direction="outbound"
      data-relay-status={relay.status}
    >
      <button
        className="channel-relay-open inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
        disabled={!onOpen}
        onClick={() => onOpen?.()}
        title={body || t("dm.relay.open", { name })}
        type="button"
      >
        <RelayAgentAvatar image={relay.peerAgentImage} name={name} />
        <span className="min-w-0 truncate">
          {t("dm.relay.sentTo", { name })}
        </span>
      </button>
      {relay.status === "pending" ? (
        <span className="channel-relay-status inline-flex items-center gap-1.5">
          <Spinner aria-hidden="true" className="size-[13px]" />
          {t("dm.relay.pending", { name })}
        </span>
      ) : null}
      {relay.status === "failed" ? (
        <span className="channel-relay-status inline-flex items-center gap-1.5 text-warning">
          <TriangleAlert aria-hidden="true" size={13} />
          {t("dm.relay.failed", { name })}
        </span>
      ) : null}
      <time className="ml-auto shrink-0 text-2xs" dateTime={time}>
        {time}
      </time>
    </div>
  );
}
