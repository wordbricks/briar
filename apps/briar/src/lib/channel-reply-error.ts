import {
  channelReplyNoAvailableWorkerError,
  type ChannelAgentReply,
} from "./channels-contract";

export function channelReplyErrorText(
  error: string | null,
  messages: { fallback: string; noAvailableWorker: string },
) {
  if (error === channelReplyNoAvailableWorkerError) {
    return messages.noAvailableWorker;
  }
  return error ?? messages.fallback;
}

export function failedChannelReplyErrors(
  replies: readonly ChannelAgentReply[],
  channelId: string | null,
  messages: { fallback: string; noAvailableWorker: string },
): Map<string, string> {
  const byMessageId = new Map<string, string>();
  if (!channelId) return byMessageId;
  for (const reply of replies) {
    if (reply.channelId !== channelId || reply.status !== "failed") continue;
    const text = channelReplyErrorText(reply.error, messages);
    byMessageId.set(reply.parentMessageId, text);
    byMessageId.set(reply.triggerMessageId, text);
  }
  return byMessageId;
}
