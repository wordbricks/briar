import { LoadingState } from "@/components/ui/loading-state";
import { displayChannelActivityHeadline } from "../lib/auto-hunt-agent";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";

export function ChannelTypingState({
  activityByAgentName,
  className,
}: {
  activityByAgentName: Readonly<Record<string, ChannelAgentActivityDescriptor>>;
  className?: string;
}) {
  const activities = Object.entries(activityByAgentName);
  if (activities.length === 0) return null;

  return activities.map(([name, activity]) => (
    <div
      aria-live="polite"
      className={`channel-typing${className ? ` ${className}` : ""}`}
      key={name}
      role="status"
    >
      <LoadingState
        label={`${name} · ${displayChannelActivityHeadline(activity)}`}
      />
    </div>
  ));
}
