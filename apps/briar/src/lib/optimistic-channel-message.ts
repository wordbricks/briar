import type {
  ChannelMember,
  ChannelMessage,
} from "./channels-contract";
import type { MentionTarget } from "./channel-mentions";
import type { ImageDimensions } from "./image-dimensions";

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
  /*
    Measured from the local file before the message is echoed, so the reserved
    height of an attachment row matches what the server will report and the
    picture appearing never moves the conversation.
  */
  attachmentDimensions?: readonly (ImageDimensions | null)[];
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
      imageWidth: input.attachmentDimensions?.[index]?.width ?? null,
      imageHeight: input.attachmentDimensions?.[index]?.height ?? null,
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
    relay: null,
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
