import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";

/*
  Channel fixtures. A `ChannelMessage` has twenty-odd fields and a case is
  usually about two of them, so these fill the rest in and apply overrides last.
*/

/** A minimal root message of `channel-1`, created at a stable time. */
export function testChannelMessage(
  id: string,
  overrides: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id,
    channelId: "channel-1",
    parentMessageId: null,
    author: {
      type: "user",
      id: "user-1",
      name: "Jay",
      email: "jay@example.com",
      image: null,
    },
    body: id,
    blocks: [],
    mentionedUserIds: [],
    mentionedAgentIds: [],
    attachments: [],
    reactions: [],
    replyCount: 0,
    lastReplyAt: null,
    replyAuthors: [],
    subscribers: [],
    document: null,
    proposal: null,
    executionProposal: null,
    skillExecutionProposal: null,
    createdAt: "2026-08-01T01:00:00.000Z",
    ...overrides,
  };
}

/** A minimal agent reply of `channel-1`, queued under `parentMessageId`. */
export function testChannelAgentReply(
  id: string,
  overrides: Partial<ChannelAgentReply> = {},
): ChannelAgentReply {
  return {
    id,
    agentId: "agent-1",
    channelId: "channel-1",
    triggerMessageId: "message-1",
    parentMessageId: "message-1",
    replyMessageId: `${id}-reply`,
    status: "queued",
    attempts: 1,
    error: null,
    createdAt: "2026-08-01T01:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
    ...overrides,
  };
}

/** A minimal channel member. */
export function testChannelMember(
  userId: string,
  overrides: Partial<ChannelMember> = {},
): ChannelMember {
  return {
    userId,
    name: userId,
    email: `${userId}@example.com`,
    image: null,
    role: "member",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A minimal channel agent summary. */
export function testChannelAgent(
  agentId: string,
  overrides: Partial<ChannelAgentSummary> = {},
): ChannelAgentSummary {
  return {
    agentId,
    name: agentId,
    avatar: null,
    provider: "claude",
    model: null,
    effort: null,
    projectId: null,
    projectName: null,
    responsibility: "",
    skills: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A minimal public channel of `org-1`. */
export function testChannelSummary(
  id: string,
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary {
  return {
    id,
    organizationId: "org-1",
    slug: id,
    name: id,
    topic: null,
    visibility: "public",
    defaultProjectId: null,
    archivedAt: null,
    memberCount: 1,
    agentCount: 0,
    kind: "channel",
    createdByUserId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastMessageAt: null,
    lastMessagePreview: null,
    lastReadAt: null,
    hasUnread: false,
    dmParticipants: [],
    ...overrides,
  };
}
