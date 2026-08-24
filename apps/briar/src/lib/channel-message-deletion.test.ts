import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "./channels-contract";
import { applyChannelMessageDeletion } from "./channel-message-deletion";

const message = (
  id: string,
  parentMessageId: string | null,
  replyCount = 0,
): ChannelMessage => ({
  id,
  channelId: "channel",
  parentMessageId,
  author: {
    type: "user",
    id: "user",
    name: "User",
    email: "u@example.com",
    image: null,
  },
  body: id,
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount,
  lastReplyAt: null,
  document: null,
  proposal: null,
  executionProposal: null,
  createdAt: "2026-08-24T00:00:00.000Z",
});

describe("applyChannelMessageDeletion", () => {
  it("replaces a deleted thread root with its tombstone", () => {
    const root = message("root", null, 1);
    const tombstone = { ...root, body: "[deleted]", deletedAt: root.createdAt };
    expect(applyChannelMessageDeletion([root], root.id, {
      deleted: true,
      message: tombstone,
      parentMessage: null,
    })).toEqual([tombstone]);
  });

  it("removes a reply and refreshes the root summary", () => {
    const root = message("root", null, 1);
    const reply = message("reply", root.id);
    const refreshedRoot = { ...root, replyCount: 0 };
    expect(applyChannelMessageDeletion([root, reply], reply.id, {
      deleted: true,
      message: null,
      parentMessage: refreshedRoot,
    })).toEqual([refreshedRoot]);
  });

  it("does not append a deleted message to an unrelated open thread", () => {
    const unrelatedRoot = message("unrelated", null, 1);
    const tombstone = {
      ...message("root", null, 1),
      body: "[deleted]",
      deletedAt: "2026-08-24T00:01:00.000Z",
    };
    expect(applyChannelMessageDeletion([unrelatedRoot], tombstone.id, {
      deleted: true,
      message: tombstone,
      parentMessage: null,
    })).toEqual([unrelatedRoot]);
  });
});
