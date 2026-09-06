import { CircleAlert } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { displayChannelActivityHeadline } from "@/lib/auto-hunt-agent";
import type { ChannelAgentActivityDescriptor } from "@/lib/channel-agent-activity";
import { useI18n } from "@/i18n";
export function AgentReplyState({
  indicators = [],
  state
}: {
  indicators?: Array<{
    key: string;
    agentName: string | null;
    activity: ChannelAgentActivityDescriptor;
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
    if (indicators.length === 0) return null;
    return <>
        {indicators.map(indicator => <div className="issue-agent-reply-state" key={indicator.key}>
            <LoadingState label={indicator.agentName ? `${indicator.agentName} · ${displayChannelActivityHeadline(indicator.activity)}` : displayChannelActivityHeadline(indicator.activity)} size="compact" />
          </div>)}
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
