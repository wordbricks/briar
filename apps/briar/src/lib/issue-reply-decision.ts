export type IssueReplyContextMessage = {
  id: string;
  parentMessageId: string | null;
  body: string;
  author: { agentId: string | null; provider: string | null };
};

export function agentReplyParentMessageId(
  message: Pick<IssueReplyContextMessage, "id" | "parentMessageId">,
) {
  return message.parentMessageId ?? message.id;
}

export type AgentReplyConversationKind = "dm" | "channel" | "issue";

type ReplyTargetMessage = Pick<
  IssueReplyContextMessage,
  "id" | "parentMessageId"
>;

/**
 * Keep the message that triggered an Agent as its execution context while
 * choosing independently where the completed reply is displayed.
 */
export function agentReplyDisplayParentMessageId(
  conversationKind: "dm",
  message: ReplyTargetMessage,
): null;
export function agentReplyDisplayParentMessageId(
  conversationKind: "channel" | "issue",
  message: ReplyTargetMessage,
): string;
export function agentReplyDisplayParentMessageId(
  conversationKind: AgentReplyConversationKind,
  message: ReplyTargetMessage,
): string | null;
export function agentReplyDisplayParentMessageId(
  conversationKind: AgentReplyConversationKind,
  message: ReplyTargetMessage,
) {
  return conversationKind === "dm"
    ? null
    : agentReplyParentMessageId(message);
}

/**
 * Resolve the Project Agents that should answer an issue message.
 *
 * Agent IDs are deliberately the only routing authority. The rendered
 * `@handle` is presentation text and must never be used to decide who gets a
 * reply. A follow-up without explicit mentions continues with the agents that
 * already participated in the same thread.
 */
export function issueReplyAgentIds(
  messages: readonly IssueReplyContextMessage[],
  input: {
    mentionedAgentIds?: readonly string[];
    parentMessageId: string | null;
  },
) {
  const explicit = [...new Set(
    (input.mentionedAgentIds ?? [])
      .map((agentId) => agentId.trim())
      .filter(Boolean),
  )];
  if (explicit.length > 0) return explicit;
  if (!input.parentMessageId) return [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const participatingAgents = new Set<string>();
  const addAgent = (message: IssueReplyContextMessage | undefined) => {
    if (message?.author.agentId) participatingAgents.add(message.author.agentId);
  };

  for (const message of messages) {
    if (message.parentMessageId === input.parentMessageId) addAgent(message);
  }
  let ancestor = byId.get(input.parentMessageId);
  while (ancestor) {
    addAgent(ancestor);
    ancestor = ancestor.parentMessageId
      ? byId.get(ancestor.parentMessageId)
      : undefined;
  }
  return [...participatingAgents];
}
