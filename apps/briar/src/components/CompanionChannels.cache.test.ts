/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import type {
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import {
  cacheCompanionChannelSnapshot,
  cacheCompanionThreadSnapshot,
  type CompanionChannelCache,
  mobileCachedMessageLimit,
  mobileChannelCacheLimit,
  mobileThreadCacheLimit,
} from "./CompanionChannels";

const channel = (id: string): ChannelSummary => ({
  id,
  organizationId: "org-1",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 0,
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
});

const message = (id: string, parentMessageId: string | null = null): ChannelMessage => ({
  id,
  channelId: "channel-1",
  parentMessageId,
  author: {
    type: "user",
    id: "user-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body: id,
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  document: null,
  proposal: null,
  executionProposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
});

describe("companion channel cache bounds", () => {
  it("retains only recent channels and messages while advancing the cursor", () => {
    const cache: CompanionChannelCache = new Map();

    for (let index = 0; index <= mobileChannelCacheLimit; index += 1) {
      const messages = Array.from(
        { length: mobileCachedMessageLimit + 5 },
        (_, messageIndex) => message(`m-${index}-${messageIndex}`),
      );
      cacheCompanionChannelSnapshot(cache, {
        channel: channel(`c-${index}`),
        members: [],
        agents: [],
        messages,
        nextCursor: "older-cursor",
        threads: new Map(),
      });
    }

    const newest = cache.get(`c-${mobileChannelCacheLimit}`);
    expect(cache.size).toBe(mobileChannelCacheLimit);
    expect(cache.has("c-0")).toBe(false);
    expect(newest?.messages).toHaveLength(mobileCachedMessageLimit);
    expect(newest?.messages[0]?.id).toBe(`m-${mobileChannelCacheLimit}-5`);
    expect(newest?.nextCursor).toBe(`m-${mobileChannelCacheLimit}-5`);
  });

  it("retains recent threads without evicting their root messages", () => {
    const threads = new Map<string, ChannelMessage[]>();

    for (let index = 0; index <= mobileThreadCacheLimit; index += 1) {
      const parentId = `parent-${index}`;
      const replies = Array.from(
        { length: mobileCachedMessageLimit + 5 },
        (_, replyIndex) => message(`reply-${index}-${replyIndex}`, parentId),
      );
      cacheCompanionThreadSnapshot(
        threads,
        parentId,
        [message(parentId), ...replies],
      );
    }

    const newest = threads.get(`parent-${mobileThreadCacheLimit}`);
    expect(threads.size).toBe(mobileThreadCacheLimit);
    expect(threads.has("parent-0")).toBe(false);
    expect(newest).toHaveLength(mobileCachedMessageLimit);
    expect(newest?.[0]?.id).toBe(`parent-${mobileThreadCacheLimit}`);
    expect(newest?.at(-1)?.id).toBe(
      `reply-${mobileThreadCacheLimit}-${mobileCachedMessageLimit + 4}`,
    );
  });
});
