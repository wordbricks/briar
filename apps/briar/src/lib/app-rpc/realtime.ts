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

export const createOrganizationRealtimeTicket = async (
  token: string,
  organizationId: string,
  signal?: AbortSignal,
) => {
  const response = await requireRealtimeClient().createRealtimeTicket({
    scope: {
      case: "organizationNotifications",
      value: { organizationId },
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
  organizationId: string,
  channelId: string,
  signal?: AbortSignal,
) => {
  const response = await requireRealtimeClient().createRealtimeTicket({
    scope: {
      case: "channelActivity",
      value: { organizationId, channelId },
    },
  }, appCallOptions(token, signal));
  return response.url;
};
