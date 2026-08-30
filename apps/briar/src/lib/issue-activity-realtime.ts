import * as Option from "effect/Option";
import {
  decodeIssueAgentActivityFrameBinaryOption,
  type IssueAgentActivityFrame,
} from "./channel-agent-activity";
import { AgentActivityRealtimeTransport } from "./agent-activity-realtime";
import { createIssueActivityTicket } from "./app-rpc/realtime";

export class IssueActivityRealtimeTransport
  extends AgentActivityRealtimeTransport<IssueAgentActivityFrame> {
  constructor(
    input: {
      token: string;
      projectId: string;
      runId: string;
      createTicket?: (signal: AbortSignal) => Promise<string>;
      createWebSocket?: (url: string) => WebSocket;
    },
  ) {
    super({
      createTicket: input.createTicket ?? ((signal) =>
        createIssueActivityTicket(
          input.token,
          input.projectId,
          input.runId,
          signal,
        )),
      adapter: {
        label: "Issue",
        decodeFrame: (value) =>
          Option.getOrNull(decodeIssueAgentActivityFrameBinaryOption(value)),
        matchesScope: (frame) =>
          frame.projectId === input.projectId && frame.runId === input.runId,
      },
      createWebSocket: input.createWebSocket,
    });
  }
}
