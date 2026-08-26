import * as Option from "effect/Option";
import {
  decodeChannelAgentActivityFrameOption,
  type ChannelAgentActivityFrame,
} from "./channel-agent-activity";
import { AgentActivityRealtimeTransport } from "./agent-activity-realtime";

export class ChannelActivityRealtimeTransport
  extends AgentActivityRealtimeTransport<ChannelAgentActivityFrame> {
  constructor(
    input: {
      token: string;
      organizationId: string;
      channelId: string;
      fetch?: typeof fetch;
      createWebSocket?: (url: string) => WebSocket;
    },
  ) {
    super({
      token: input.token,
      adapter: {
        label: "Channel",
        ticketPath: `/organizations/${input.organizationId}/channels/` +
          `${input.channelId}/agent-activity-events`,
        decodeFrame: (value) =>
          Option.getOrNull(decodeChannelAgentActivityFrameOption(value)),
        matchesScope: (frame) => frame.channelId === input.channelId,
      },
      fetch: input.fetch,
      createWebSocket: input.createWebSocket,
    });
  }
}
