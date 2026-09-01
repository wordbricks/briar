import type {
  ChannelMember,
  ChannelMessage,
} from "./channels-contract";
import type { MentionTarget } from "./channel-mentions";

export function createOptimisticChannelMessage(input: {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  body: string;
  currentUserId: string | null;
  fallbackAuthorName: string;
  members: readonly ChannelMember[];
  mentions: readonly MentionTarget[];
  attachments: readonly File[];
  attachmentReferences: readonly string[];
  attachmentUrls: readonly string[];
  createdAt?: string;
}): ChannelMessage {
  const member = input.members.find(
    (candidate) => candidate.userId === input.currentUserId,
  );
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    channelId: input.channelId,
    parentMessageId: input.parentMessageId,
    author: {
      type: "user",
      id: input.currentUserId ?? "",
      name: member?.name ?? input.fallbackAuthorName,
      email: member?.email ?? "",
      image: member?.image ?? null,
    },
    body: input.body,
    blocks: [],
    mentionedUserIds: input.mentions.flatMap((mention) =>
      mention.type === "user" ? [mention.id] : []
    ),
    mentionedAgentIds: input.mentions.flatMap((mention) =>
      mention.type === "agent" ? [mention.id] : []
    ),
    attachments: input.attachments.map((attachment, index) => ({
      id: input.attachmentReferences[index] ?? crypto.randomUUID(),
      filename: attachment.name,
      contentType: attachment.type,
      byteSize: attachment.size,
      url: input.attachmentUrls[index] ?? "",
    })),
    reactions: [],
    replyCount: 0,
    lastReplyAt: null,
    replyAuthors: [],
    subscribers: [],
    document: null,
    proposal: null,
    executionProposal: null,
    skillExecutionProposal: null,
    optimistic: true,
    createdAt,
  };
}

export function removeOptimisticChannelMessage(
  messages: ChannelMessage[],
  messageId: string,
) {
  const pending = messages.find(
    (message) => message.id === messageId && message.optimistic,
  );
  return pending
    ? messages.filter((message) => message.id !== messageId)
    : messages;
}
