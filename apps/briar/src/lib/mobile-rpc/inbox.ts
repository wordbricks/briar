import { createClient } from "@connectrpc/connect";
import {
  InboxService,
  InboxSessionMessage_Status,
  type InboxFeedMessage,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/inbox_pb";
import type { InboxMessage } from "../../hooks/useInbox";
import {
  mobileCallOptions,
  mobileRpc,
  mobileTransport,
} from "./core";
import {
  notificationReasonFromProto,
  requiredTimestamp,
  runStatusFromProto,
  structuredResultFromProto,
} from "./mappers";

const inboxClient = mobileTransport
  ? createClient(InboxService, mobileTransport)
  : undefined;

const requireInboxClient = () => {
  if (!inboxClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return inboxClient;
};

const sessionStatus = (
  value: InboxSessionMessage_Status,
): "completed" | "failed" => {
  switch (value) {
    case InboxSessionMessage_Status.COMPLETED:
      return "completed";
    case InboxSessionMessage_Status.FAILED:
      return "failed";
    default:
      throw new Error(`Unknown inbox session status: ${value}`);
  }
};

const inboxMessageFromProto = (message: InboxFeedMessage): InboxMessage => {
  const identity = message.identity;
  if (identity === undefined) throw new Error("Inbox message identity is missing");
  const base = {
    id: identity.id,
    projectId: identity.projectId,
    projectName: identity.projectName,
    targetId: identity.targetId,
    title: identity.title,
    occurredAt: requiredTimestamp(identity.occurredAt, "inbox.occurredAt"),
    version: identity.version,
  };

  switch (message.content.case) {
    case "issue":
      return {
        ...base,
        kind: "issue",
        runNumber: message.content.value.runNumber,
        status: runStatusFromProto(message.content.value.status),
        workflowStage: message.content.value.workflowStage ?? null,
        workflowStageLabel: message.content.value.workflowStageLabel ?? null,
        priority: message.content.value.priority ?? null,
        structuredResult: structuredResultFromProto(
          message.content.value.structuredResult,
        ),
      };
    case "conversation":
      return {
        ...base,
        kind: "conversation",
        messageId: message.content.value.messageId,
        rootMessageId: message.content.value.rootMessageId,
        body: message.content.value.body,
        authorName: message.content.value.authorName,
        authorImage: message.content.value.authorImage ?? null,
        issueKey: message.content.value.issueKey,
        reason: notificationReasonFromProto(message.content.value.reason),
      };
    case "channel":
      return {
        ...base,
        kind: "channel",
        channelId: message.content.value.channelId,
        channelName: message.content.value.channelName,
        messageId: message.content.value.messageId,
        rootMessageId: message.content.value.rootMessageId,
        body: message.content.value.body,
        authorName: message.content.value.authorName,
        authorImage: message.content.value.authorImage ?? null,
        reason: notificationReasonFromProto(message.content.value.reason),
      };
    case "session":
      return {
        ...base,
        kind: "session",
        status: sessionStatus(message.content.value.status),
        agentName: message.content.value.agentName ?? null,
        issueCount: message.content.value.issueCount,
        error: message.content.value.error ?? null,
        summary: message.content.value.summary ?? null,
        requiresAttention: message.content.value.requiresAttention,
      };
    case undefined:
      throw new Error("Inbox message content is missing");
  }
};

export async function getInboxFeed(
  token: string,
  organizationId: string,
  knownVersion: string | undefined,
  signal?: AbortSignal,
) {
  const client = requireInboxClient();
  return mobileRpc(async () => {
    const response = await client.getInboxFeed(
      { organizationId, knownVersion },
      mobileCallOptions(token, signal),
    );
    return {
      version: response.version,
      unchanged: response.unchanged,
      messages: response.messages.map(inboxMessageFromProto),
      subscribedIssueIds: response.subscribedIssueIds,
    };
  });
}

export async function getInboxReadStates(token: string) {
  const client = requireInboxClient();
  return mobileRpc(async () =>
    (await client.getInboxReadStates({}, mobileCallOptions(token))).readVersions
  );
}

export async function putInboxReadStates(
  token: string,
  readVersions: Record<string, string>,
) {
  const client = requireInboxClient();
  return mobileRpc(async () =>
    (await client.putInboxReadStates(
      { readVersions },
      mobileCallOptions(token),
    )).readVersions
  );
}

export async function deleteInboxReadStateRpc(
  token: string,
  messageId: string,
) {
  const client = requireInboxClient();
  return mobileRpc(async () =>
    (await client.deleteInboxReadState(
      { messageId },
      mobileCallOptions(token),
    )).readVersions
  );
}
