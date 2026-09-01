import * as Option from "effect/Option";
import {
  agentReplyActivityDomainFrameOption,
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
        matchesScope: (frame) =>
          frame.scope.case === "issue" &&
          frame.scope.value.projectId === input.projectId &&
          frame.scope.value.runId === input.runId,
        projectFrame: (message) => {
          const frame = Option.getOrNull(
            agentReplyActivityDomainFrameOption(message),
          );
          return frame && "projectId" in frame ? frame : null;
        },
      },
      createWebSocket: input.createWebSocket,
    });
  }
}
