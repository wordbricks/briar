import { createClient } from "@connectrpc/connect";
import { RealtimeService } from "@briar/contracts/gen/briar/app/v1/realtime_control_pb";
import { appCallOptions, appTransport } from "./core";

const realtimeClient = appTransport
  ? createClient(RealtimeService, appTransport)
  : undefined;

const requireRealtimeClient = () => {
  if (!realtimeClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return realtimeClient;
};

export const createWorkspaceRealtimeTicket = async (
  token: string,
  workspaceId: string,
  signal?: AbortSignal,
) => {
  const response = await requireRealtimeClient().createRealtimeTicket({
    scope: {
      case: "workspaceNotifications",
      value: { workspaceId: workspaceId },
    },
  }, appCallOptions(token, signal));
  return response.url;
};

export const createIssueActivityTicket = async (
  token: string,
  projectId: string,
  runId: string,
  signal?: AbortSignal,
) => {
  const response = await requireRealtimeClient().createRealtimeTicket({
    scope: {
      case: "issueActivity",
      value: { projectId, runId },
    },
  }, appCallOptions(token, signal));
  return response.url;
};

export const createChannelActivityTicket = async (
  token: string,
  workspaceId: string,
  channelId: string,
  signal?: AbortSignal,
) => {
  const response = await requireRealtimeClient().createRealtimeTicket({
    scope: {
      case: "channelActivity",
      value: { workspaceId: workspaceId, channelId },
    },
  }, appCallOptions(token, signal));
  return response.url;
};
