import { mentionsBriar } from "./briar-mention";

export type IssueReplyContextMessage = {
  id: string;
  parentMessageId: string | null;
  body: string;
  author: { provider: string | null };
};

export function agentReplyParentMessageId(
  message: Pick<IssueReplyContextMessage, "id" | "parentMessageId">,
) {
  return message.parentMessageId ?? message.id;
}

export function shouldBriarReply(
  messages: readonly IssueReplyContextMessage[],
  input: { body: string; parentMessageId: string | null },
) {
  if (mentionsBriar(input.body)) return true;
  if (!input.parentMessageId) return false;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const isAgentActive = (message: IssueReplyContextMessage | undefined) =>
    message !== undefined &&
    (message.author.provider !== null || mentionsBriar(message.body));
  const siblingActive = messages.some(
    (message) =>
      message.parentMessageId === input.parentMessageId &&
      isAgentActive(message),
  );
  if (siblingActive) return true;
  const parent = byId.get(input.parentMessageId);
  if (!parent) return false;
  let ancestor: IssueReplyContextMessage | undefined = parent;
  while (ancestor) {
    if (isAgentActive(ancestor)) return true;
    ancestor = ancestor.parentMessageId
      ? byId.get(ancestor.parentMessageId)
      : undefined;
  }
  return false;
}
