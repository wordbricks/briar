import { describe, expect, it } from "vitest";

import {
  testChannelAgent,
  testChannelAgentReply,
  testChannelMessage,
} from "../../test/channel-conversation";
import {
  activityForReplies,
  appendReplySummary,
  channelAuthorId,
  channelConversationError,
  channelReplyIsPending,
  channelReplyShouldReplace,
  mergeChannelReplies,
  removeReplySummary,
  summarizeChannelMessages,
  threadMessageIdSet,
  typingAgentNamesForReplies,
} from "./model";

const agentAuthor = {
  type: "agent",
  id: "agent-1",
  name: "Builder",
  provider: null,
  image: null,
} as const;

describe("channelConversationError", () => {
  it("uses an Error message and stringifies anything else", () => {
    expect(channelConversationError(new Error("offline"))).toBe("offline");
    expect(channelConversationError("offline")).toBe("offline");
  });
});

describe("channelAuthorId", () => {
  it("falls back to the address and then the name for a partial user", () => {
    expect(
      channelAuthorId({
        type: "user",
        id: "user-1",
        name: "Jay",
        email: "jay@example.com",
        image: null,
      }),
    ).toBe("user:user-1");
    expect(
      channelAuthorId({
        type: "user",
        id: "",
        name: "Jay",
        email: "jay@example.com",
        image: null,
      }),
    ).toBe("user:jay@example.com");
  });

  it("keeps agents and users in separate namespaces", () => {
    expect(channelAuthorId(agentAuthor)).toBe("agent:agent-1");
  });
});

describe("mergeChannelReplies", () => {
  it("keeps a terminal reply when an older running copy arrives later", () => {
    const completed = testChannelAgentReply("reply-1", {
      status: "completed",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    const stale = testChannelAgentReply("reply-1", {
      status: "running",
      updatedAt: "2026-08-01T03:00:00.000Z",
    });

    expect(mergeChannelReplies([completed], [stale])[0]?.status).toBe(
      "completed",
    );
  });

  it("does not resurrect a settled reply that a stale page re-asserts", () => {
    const running = testChannelAgentReply("reply-1", { status: "running" });

    expect(
      mergeChannelReplies([], [running], new Set(["reply-1"])),
    ).toEqual([]);
  });

  it("lets a settled reply through once it is itself terminal", () => {
    const done = testChannelAgentReply("reply-1", { status: "completed" });

    expect(
      mergeChannelReplies([], [done], new Set(["reply-1"])),
    ).toHaveLength(1);
  });

  it("prefers the further-along status when the timestamps tie", () => {
    const queued = testChannelAgentReply("reply-1", { status: "queued" });
    const running = testChannelAgentReply("reply-1", { status: "running" });

    expect(channelReplyShouldReplace(queued, running)).toBe(true);
    expect(channelReplyShouldReplace(running, queued)).toBe(false);
  });
});

describe("appendReplySummary", () => {
  it("counts the reply, moves its author to the front and keeps three", () => {
    const parent = testChannelMessage("root", {
      replyCount: 2,
      lastReplyAt: "2026-08-01T01:00:00.000Z",
      replyAuthors: [
        { type: "user", id: "a", name: "A", email: "a@x", image: null },
        { type: "user", id: "b", name: "B", email: "b@x", image: null },
        { type: "user", id: "c", name: "C", email: "c@x", image: null },
      ],
    });
    const reply = testChannelMessage("reply", {
      parentMessageId: "root",
      author: agentAuthor,
      createdAt: "2026-08-01T02:00:00.000Z",
    });

    const next = appendReplySummary(parent, reply);

    expect(next.replyCount).toBe(3);
    expect(next.lastReplyAt).toBe("2026-08-01T02:00:00.000Z");
    expect(next.replyAuthors.map((author) => author.name)).toEqual([
      "Builder",
      "A",
      "B",
    ]);
  });

  it("does not list the same author twice", () => {
    const parent = testChannelMessage("root", {
      replyAuthors: [agentAuthor],
    });
    const reply = testChannelMessage("reply", {
      parentMessageId: "root",
      author: agentAuthor,
    });

    expect(appendReplySummary(parent, reply).replyAuthors).toHaveLength(1);
  });
});

describe("removeReplySummary", () => {
  it("restores the previous last reply when the rolled back one was it", () => {
    const reply = testChannelMessage("reply", {
      createdAt: "2026-08-01T02:00:00.000Z",
    });
    const parent = testChannelMessage("root", {
      replyCount: 1,
      lastReplyAt: "2026-08-01T02:00:00.000Z",
      replyAuthors: [agentAuthor],
    });

    expect(
      removeReplySummary(parent, reply, {
        lastReplyAt: "2026-08-01T01:00:00.000Z",
        replyAuthors: [],
      }),
    ).toMatchObject({
      replyCount: 0,
      lastReplyAt: "2026-08-01T01:00:00.000Z",
      replyAuthors: [],
    });
  });

  it("leaves a newer last reply alone and never goes below zero", () => {
    const reply = testChannelMessage("reply", {
      createdAt: "2026-08-01T01:00:00.000Z",
    });
    const parent = testChannelMessage("root", {
      replyCount: 0,
      lastReplyAt: "2026-08-01T03:00:00.000Z",
    });

    expect(removeReplySummary(parent, reply, null)).toMatchObject({
      replyCount: 0,
      lastReplyAt: "2026-08-01T03:00:00.000Z",
    });
  });
});

describe("typing state", () => {
  const agents = [testChannelAgent("agent-1", { name: "Builder" })];

  it("names the replying agents once each and falls back for unknown ids", () => {
    const replies = [
      testChannelAgentReply("reply-1", { parentMessageId: "root" }),
      testChannelAgentReply("reply-2", { parentMessageId: "root" }),
      testChannelAgentReply("reply-3", {
        parentMessageId: "root",
        agentId: "agent-missing",
      }),
      testChannelAgentReply("reply-4", { parentMessageId: "elsewhere" }),
    ];

    expect(
      typingAgentNamesForReplies(replies, agents, new Set(["root"]), "Agent"),
    ).toEqual(["Builder", "Agent"]);
  });

  const descriptor = {
    id: "activity-1",
    kind: "command",
    headline: "Running tests",
  } as const;

  it("drops an activity frame that describes an earlier attempt", () => {
    const reply = testChannelAgentReply("reply-1", { attempts: 2 });
    const activity = new Map([
      ["reply-1", { attempt: 1, activity: descriptor }],
    ]);

    expect(activityForReplies([reply], agents, activity, "Agent")).toEqual({});
  });

  it("keys the current frame by the agent name the strip shows", () => {
    const reply = testChannelAgentReply("reply-1", { attempts: 2 });
    const activity = new Map([
      ["reply-1", { attempt: 2, activity: descriptor }],
    ]);

    expect(activityForReplies([reply], agents, activity, "Agent")).toEqual({
      Builder: descriptor,
    });
  });

  it("counts queued and running replies as pending", () => {
    expect(
      [
        testChannelAgentReply("a", { status: "queued" }),
        testChannelAgentReply("b", { status: "running" }),
        testChannelAgentReply("c", { status: "completed" }),
      ].filter(channelReplyIsPending),
    ).toHaveLength(2);
  });

  it("watches the thread root together with its replies", () => {
    expect([
      ...threadMessageIdSet("root", [testChannelMessage("reply")]),
    ]).toEqual(["root", "reply"]);
    expect(threadMessageIdSet(null, [testChannelMessage("reply")]).size).toBe(0);
  });
});

describe("summarizeChannelMessages", () => {
  it("keeps the entry of a message whose grouping did not change", () => {
    const message = testChannelMessage("message-1");
    const previous = summarizeChannelMessages([], [message]);

    const next = summarizeChannelMessages(previous, [
      { ...message, body: "edited" },
    ]);

    expect(next[0]).toBe(previous[0]);
  });

  it("replaces the entry when the author or the time moves", () => {
    const message = testChannelMessage("message-1");
    const previous = summarizeChannelMessages([], [message]);

    const next = summarizeChannelMessages(previous, [
      { ...message, createdAt: "2026-08-02T01:00:00.000Z" },
    ]);

    expect(next[0]).not.toBe(previous[0]);
    expect(next[0]?.createdAt).toBe("2026-08-02T01:00:00.000Z");
  });
});
