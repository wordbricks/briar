import {
  channelReplyNoAvailableWorkerError,
  channelReplyProviderUsageExhaustedError,
} from "./channels-contract";

export function channelReplyErrorText(
  error: string | null,
  messages: {
    fallback: string;
    noAvailableWorker: string;
    usageExhausted: string;
  },
) {
  if (error === channelReplyNoAvailableWorkerError) {
    return messages.noAvailableWorker;
  }
  if (error === channelReplyProviderUsageExhaustedError) {
    return messages.usageExhausted;
  }
  return error ?? messages.fallback;
}
