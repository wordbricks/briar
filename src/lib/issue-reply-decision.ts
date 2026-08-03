import { mentionsBriar } from "./briar-mention";

export type IssueReplyContextMessage = {
  id: string;
  parentMessageId: string | null;
  body: string;
  author: { provider: string | null };
};

export function shouldBriarReply(
  messages: readonly IssueReplyContextMessage[],
  input: { body: string; parentMessageId: string | null },
) {
  if (mentionsBriar(input.body)) return true;
  if (!input.parentMessageId) return false;
  return messages.some(
    (message) =>
      (message.id === input.parentMessageId ||
        message.parentMessageId === input.parentMessageId) &&
      (message.author.provider !== null || mentionsBriar(message.body)),
  );
}
