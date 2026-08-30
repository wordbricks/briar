import * as Option from "effect/Option";
import {
  agentReplyActivityDomainFrameOption,
  type ChannelAgentActivityFrame,
} from "./channel-agent-activity";
import { AgentActivityRealtimeTransport } from "./agent-activity-realtime";
import { createChannelActivityTicket } from "./app-rpc/realtime";

export class ChannelActivityRealtimeTransport
  extends AgentActivityRealtimeTransport<ChannelAgentActivityFrame> {
  constructor(
    input: {
      token: string;
      organizationId: string;
      channelId: string;
      createTicket?: (signal: AbortSignal) => Promise<string>;
      createWebSocket?: (url: string) => WebSocket;
    },
  ) {
    super({
      createTicket: input.createTicket ?? ((signal) =>
        createChannelActivityTicket(
          input.token,
          input.organizationId,
          input.channelId,
          signal,
        )),
      adapter: {
        label: "Channel",
        matchesScope: (frame) =>
          frame.scope.case === "channel" &&
          frame.scope.value.channelId === input.channelId,
        projectFrame: (message) => {
          const frame = Option.getOrNull(
            agentReplyActivityDomainFrameOption(message),
          );
          return frame && "channelId" in frame ? frame : null;
        },
      },
      createWebSocket: input.createWebSocket,
    });
  }
}
