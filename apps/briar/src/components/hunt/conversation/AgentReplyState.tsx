import { CircleAlert } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { displayChannelActivityHeadline } from "@/lib/auto-hunt-agent";
import type { ChannelAgentActivityDescriptor } from "@/lib/channel-agent-activity";
import { useI18n } from "@/i18n";
/*
  Two inputs, one line each, and neither one stands in for the other.

  `indicators` is durable reply state: an agent that was asked and has not
  answered yet earns a line from the moment its job exists.
  `activityByIndicatorKey` is the live socket: what that agent says it is doing
  right now, on the attempt that is actually running.

  The issue conversation needs both, because a runner is free to publish no
  activity at all — a Codex-backed agent answered a mention after two minutes
  without a single frame — and this one-line strip staying empty is
  indistinguishable from the mention having been dropped. They are separate
  props rather than one list of optional activity so that "no line to show" and
  "a line with no headline yet" cannot collapse into each other.

  A DM's progress row is a message-shaped placeholder and stays commentary-only;
  it does not use this component.
*/
export function AgentReplyState({
  activityByIndicatorKey = {},
  indicators = [],
  state
}: {
  /**
   * The live headline of each indicator that has one, keyed the same way
   * `indicators` is. An indicator absent from here is still working.
   */
  activityByIndicatorKey?: Readonly<Record<string, ChannelAgentActivityDescriptor | undefined>>;
  /** The queued or running replies that each earn a line, frame or no frame. */
  indicators?: ReadonlyArray<{
    key: string;
    agentName: string | null;
  }>;
  state?: {
    pending: number;
    error: string | null;
  };
}) {
  const {
    t
  } = useI18n();
  if (!state) return null;
  if (state.pending > 0) {
    // A pending reply nobody named — the composer's inline reply promise has no
    // job to look up — still gets the unnamed line rather than nothing.
    const lines = indicators.length > 0 ? indicators : [{
      key: "generic",
      agentName: null
    }];
    return <>
        {lines.map(indicator => {
        const activity = activityByIndicatorKey[indicator.key];
        return <div className="issue-agent-reply-state" key={indicator.key}>
              <LoadingState label={activity ? indicator.agentName ? `${indicator.agentName} · ${displayChannelActivityHeadline(activity)}` : displayChannelActivityHeadline(activity) : indicator.agentName ? t("channel.namedAgentTyping", {
            name: indicator.agentName
          }) : t("channel.agentTyping")} size="compact" />
            </div>;
      })}
      </>;
  }
  if (!state.error) return null;
  return <div className="issue-agent-reply-state error">
      <CircleAlert size={14} />
      {t("run.briarReplyFailed", {
      error: state.error
    })}
    </div>;
}
