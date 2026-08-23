import { briarApiUrl } from "./api-config";
import {
  WebSocketRealtimeTransport,
  type RealtimeTransport,
} from "./realtime-transport";

export const CHANNEL_REALTIME_FALLBACK_MS = 60_000;
export const INBOX_REALTIME_FALLBACK_MS = 60_000;
export const INBOX_REALTIME_DEBOUNCE_MS = 300;
export const MAX_CHANNEL_DELTA_PAGES_PER_SYNC = 20;
export const MAX_PROJECT_DELTA_PAGES_PER_SYNC = 20;

type SharedOrganizationRealtime = {
  consumers: number;
  transport: WebSocketRealtimeTransport;
};

const organizationRealtimeTransports = new Map<
  string,
  SharedOrganizationRealtime
>();

function createOrganizationRealtimeTransport(
  token: string,
  organizationId: string,
): RealtimeTransport {
  const key = `${organizationId}\0${token}`;
  let shared = organizationRealtimeTransports.get(key);
  if (!shared) {
    shared = {
      consumers: 0,
      transport: new WebSocketRealtimeTransport({
        url: `${briarApiUrl}/organizations/${organizationId}/channel-events`,
        token,
      }),
    };
    organizationRealtimeTransports.set(key, shared);
  }
  const realtime = shared;
  let started = false;
  return {
    subscribe: (listener) => realtime.transport.subscribe(listener),
    start() {
      if (started) return;
      started = true;
      realtime.consumers += 1;
      if (realtime.consumers === 1) realtime.transport.start();
    },
    stop() {
      if (!started) return;
      started = false;
      realtime.consumers = Math.max(0, realtime.consumers - 1);
      if (realtime.consumers > 0) return;
      realtime.transport.stop();
      if (organizationRealtimeTransports.get(key) === realtime) {
        organizationRealtimeTransports.delete(key);
      }
    },
  };
}

export function createChannelRealtimeTransport(
  token: string,
  organizationId: string,
) {
  return createOrganizationRealtimeTransport(token, organizationId);
}

export function createProjectRealtimeTransport(
  token: string,
  organizationId: string,
) {
  return createChannelRealtimeTransport(token, organizationId);
}

export function createInboxRealtimeTransport(
  token: string,
  organizationId: string,
) {
  return createChannelRealtimeTransport(token, organizationId);
}
