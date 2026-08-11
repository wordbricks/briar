import { briarApiUrl } from "./api-config";
import { WebSocketRealtimeTransport } from "./realtime-transport";

export const CHANNEL_REALTIME_FALLBACK_MS = 60_000;
export const MAX_CHANNEL_DELTA_PAGES_PER_SYNC = 20;

export function createChannelRealtimeTransport(
  token: string,
  organizationId: string,
) {
  return new WebSocketRealtimeTransport({
    url: `${briarApiUrl}/organizations/${organizationId}/channel-events`,
    token,
  });
}
