import { channelReplyNoAvailableWorkerError } from "./channels-contract";

export function channelReplyErrorText(
  error: string | null,
  messages: { fallback: string; noAvailableWorker: string },
) {
  if (error === channelReplyNoAvailableWorkerError) {
    return messages.noAvailableWorker;
  }
  return error ?? messages.fallback;
}
