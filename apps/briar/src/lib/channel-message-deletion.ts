import type {
  ChannelMessage,
  DeleteChannelMessageResponse,
} from "./channels-contract";

/** Apply the authoritative delete response to either a root timeline or thread. */
export function applyChannelMessageDeletion(
  messages: ChannelMessage[],
  messageId: string,
  response: DeleteChannelMessageResponse,
) {
  const replacements = new Map(
    [response.message, response.parentMessage]
      .filter((message): message is ChannelMessage => message !== null)
      .map((message) => [message.id, message]),
  );
  const next = messages
    .filter((message) =>
      !response.deleted || response.message?.id === message.id || message.id !== messageId
    )
    .map((message) => replacements.get(message.id) ?? message);
  return next;
}
