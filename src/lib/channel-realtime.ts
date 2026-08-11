import { briarApiUrl } from "./api-config";
import { SseRealtimeTransport } from "./realtime-transport";

export const CHANNEL_REALTIME_FALLBACK_MS = 60_000;
export const MAX_CHANNEL_DELTA_PAGES_PER_SYNC = 20;

export function createChannelRealtimeTransport(
  token: string,
  organizationId: string,
) {
  return new SseRealtimeTransport({
    url: `${briarApiUrl}/organizations/${organizationId}/channel-events`,
    token,
  });
}
