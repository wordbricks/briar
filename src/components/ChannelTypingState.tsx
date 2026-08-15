import { LoadingState } from "@/components/ui/loading-state";
import { useI18n } from "../i18n";
import type { ChannelAgentActivityDescriptor } from "../lib/channel-agent-activity";

export function ChannelTypingState({
  agentNames,
  activityByAgentName,
  className,
}: {
  agentNames: readonly string[];
  activityByAgentName?: Readonly<Record<string, ChannelAgentActivityDescriptor>>;
  className?: string;
}) {
  const { t } = useI18n();
  if (agentNames.length === 0) return null;

  return agentNames.map((name) => (
    <div
      aria-live="polite"
      className={`channel-typing${className ? ` ${className}` : ""}`}
      key={name}
      role="status"
    >
      <LoadingState
        label={
          activityByAgentName?.[name]
            ? `${name} · ${activityByAgentName[name].headline}`
            : t("channel.namedAgentTyping", { name })
        }
      />
    </div>
  ));
}
