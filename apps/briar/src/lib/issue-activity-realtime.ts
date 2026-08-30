import * as Option from "effect/Option";
import {
  decodeIssueAgentActivityFrameBinaryOption,
  type IssueAgentActivityFrame,
} from "./channel-agent-activity";
import { AgentActivityRealtimeTransport } from "./agent-activity-realtime";

export class IssueActivityRealtimeTransport
  extends AgentActivityRealtimeTransport<IssueAgentActivityFrame> {
  constructor(
    input: {
      token: string;
      projectId: string;
      runId: string;
      fetch?: typeof fetch;
      createWebSocket?: (url: string) => WebSocket;
    },
  ) {
    super({
      token: input.token,
      adapter: {
        label: "Issue",
        ticketPath: `/projects/${input.projectId}/runs/${input.runId}/` +
          "agent-activity-events",
        decodeFrame: (value) =>
          Option.getOrNull(decodeIssueAgentActivityFrameBinaryOption(value)),
        matchesScope: (frame) =>
          frame.projectId === input.projectId && frame.runId === input.runId,
      },
      fetch: input.fetch,
      createWebSocket: input.createWebSocket,
    });
  }
}
