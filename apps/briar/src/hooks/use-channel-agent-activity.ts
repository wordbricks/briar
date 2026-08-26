import { useMemo } from "react";
import { ChannelActivityRealtimeTransport } from "../lib/channel-activity-realtime";
import { useAgentActivity } from "./use-agent-activity";

export function useChannelAgentActivity(
  token: string,
  organizationId: string,
  channelId: string | null,
) {
  const transport = useMemo(() => {
    if (!channelId) return null;
    return new ChannelActivityRealtimeTransport({
      token,
      organizationId,
      channelId,
    });
  }, [channelId, organizationId, token]);
  return useAgentActivity(transport);
}
