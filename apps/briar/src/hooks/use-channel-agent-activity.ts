import { useMemo } from "react";
import { ChannelActivityRealtimeTransport } from "../lib/channel-activity-realtime";
import { useAgentActivity } from "./use-agent-activity";

export function useChannelAgentActivity(
  token: string,
  workspaceId: string,
  channelId: string | null,
) {
  const transport = useMemo(() => {
    if (!channelId) return null;
    return new ChannelActivityRealtimeTransport({
      token,
      workspaceId,
      channelId,
    });
  }, [channelId, workspaceId, token]);
  return useAgentActivity(transport);
}
