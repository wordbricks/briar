import { type ConversationReplyParticipant } from "@/components/ConversationReplySummary";
import type { IssueMessage } from "@/types";
export const issueConversationTabBreakpoint = 960;
export const issueReplyParticipant = (author: IssueMessage["author"]): ConversationReplyParticipant => ({
  id: author.provider ? `agent:${author.agentId ?? `${author.provider}:${author.name}`}` : `user:${author.id ?? author.name}`,
  name: author.name,
  image: author.image,
  isAgent: author.provider !== null
});
