/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  testChannelAgent,
  testChannelAgentReply,
  testChannelMember,
  testChannelMessage,
} from "../../test/channel-conversation";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  CHANNEL_CONVERSATION_RETENTION_LIMIT,
  CHANNEL_THREAD_RETENTION_LIMIT,
  channelAgentRepliesAtom,
  channelAgentsAtom,
  channelConversationLoadedAtom,
  channelMembersAtom,
  channelMessageAtom,
  channelMessageCursorAtom,
  channelMessageKey,
  channelMessagesByIdAtom,
  channelPendingAgentRepliesAtom,
  channelRootMessageIdsAtom,
  channelRootMessageSummariesAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
  channelThreadRootIdsAtom,
  retainedConversationChannelIdsAtom,
  splitChannelKey,
  touchRetained,
} from "./atoms";

const channelId = "channel-1";

/** Seeds one channel's timeline the way a detail response would. */
function seedConversation(
  registry: AtomRegistry,
  messages = [testChannelMessage("message-1"), testChannelMessage("message-2", {
    createdAt: "2026-08-01T02:00:00.000Z",
  })],
  overrides: { channelId?: string; nextCursor?: string | null } = {},
) {
  const id = overrides.channelId ?? channelId;
  applySyncEvent(registry, {
    kind: "channel-conversation-snapshot",
    channelId: id,
    members: [testChannelMember("user-1")],
    agents: [testChannelAgent("agent-1")],
    messages: messages.map((message) => ({ ...message, channelId: id })),
    nextCursor: overrides.nextCursor ?? "older-cursor",
    merge: false,
  });
}

/**
 * Counts the notifications of `atom`. Derived atoms only build their dependency
 * graph once something reads them, so every probe subscribes with
 * `immediate: true` and discounts that first call.
 */
function probe<A>(
  registry: AtomRegistry,
  atom: Parameters<typeof registry.subscribe<A>>[0],
) {
  let count = -1;
  const unsubscribe = registry.subscribe(atom, () => {
    count += 1;
  }, { immediate: true });
  return { count: () => count, unsubscribe };
}

describe("channel conversation keys", () => {
  it("round-trips a channel and a message through one family key", () => {
    expect(splitChannelKey(channelMessageKey("c", "m"))).toEqual({
      channelId: "c",
      messageId: "m",
    });
    expect(splitChannelKey(channelThreadKey("c", "root"))).toEqual({
      channelId: "c",
      messageId: "root",
    });
  });
});

describe("channel conversation store", () => {
  it("is empty and unloaded before anything arrives", () => {
    const registry = createTestRegistry();

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toBeNull();
    expect(registry.get(channelConversationLoadedAtom(channelId))).toBe(false);
    expect(registry.get(channelRootMessagesAtom(channelId))).toEqual([]);
  });

  it("stores a detail response as messages, order, participants and cursor", () => {
    const registry = createTestRegistry();

    seedConversation(registry);

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(registry.get(channelConversationLoadedAtom(channelId))).toBe(true);
    expect(registry.get(channelMessageCursorAtom(channelId))).toBe(
      "older-cursor",
    );
    expect(
      registry.get(channelMembersAtom(channelId)).map((m) => m.userId),
    ).toEqual(["user-1"]);
    expect(
      registry.get(channelAgentsAtom(channelId)).map((a) => a.agentId),
    ).toEqual(["agent-1"]);
  });

  it("keeps what the store had when a refresh merges", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("older")]);

    applySyncEvent(registry, {
      kind: "channel-conversation-snapshot",
      channelId,
      members: [],
      agents: [],
      messages: [
        testChannelMessage("newer", { createdAt: "2026-08-01T05:00:00.000Z" }),
      ],
      nextCursor: null,
      merge: true,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "older",
      "newer",
    ]);
  });

  it("orders a page by creation time and drops removed messages", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [
      testChannelMessage("b", { createdAt: "2026-08-01T02:00:00.000Z" }),
    ]);

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [
        testChannelMessage("a", { createdAt: "2026-08-01T01:00:00.000Z" }),
        testChannelMessage("c", { createdAt: "2026-08-01T03:00:00.000Z" }),
      ],
      removedMessageIds: ["b"],
      reset: false,
      includeRepliesInRoot: false,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "a",
      "c",
    ]);
    expect(registry.get(channelMessagesByIdAtom(channelId)).has("b")).toBe(
      false,
    );
  });

  it("ignores a page belonging to another channel", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("message-1")]);

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [
        testChannelMessage("elsewhere", { channelId: "channel-2" }),
      ],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "message-1",
    ]);
  });

  it("keeps replies out of the timeline unless the surface folds them in", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("root")]);
    const reply = testChannelMessage("reply", {
      parentMessageId: "root",
      createdAt: "2026-08-01T09:00:00.000Z",
    });

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [reply],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });
    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual(["root"]);

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [reply],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: true,
    });
    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "root",
      "reply",
    ]);
  });

  it("does not build a timeline out of a page for a channel it never loaded", () => {
    const registry = createTestRegistry();

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [testChannelMessage("message-1")],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toBeNull();
  });

  it("replaces the timeline on a reset page", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("stale")]);

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [testChannelMessage("fresh")],
      removedMessageIds: [],
      reset: true,
      includeRepliesInRoot: false,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual([
      "fresh",
    ]);
  });
});

describe("channel conversation identity", () => {
  it("keeps the object of a message a page re-sent unchanged", () => {
    const registry = createTestRegistry();
    seedConversation(registry);
    const before = registry.get(channelRootMessagesAtom(channelId));

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [
        { ...testChannelMessage("message-1"), channelId },
        {
          ...testChannelMessage("message-2", {
            createdAt: "2026-08-01T02:00:00.000Z",
            body: "edited",
          }),
          channelId,
        },
      ],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });
    const after = registry.get(channelRootMessagesAtom(channelId));

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.body).toBe("edited");
  });

  it("notifies one message atom and leaves the list order alone", () => {
    const registry = createTestRegistry();
    seedConversation(registry);
    const changed = probe(
      registry,
      channelMessageAtom(channelMessageKey(channelId, "message-2")),
    );
    const untouched = probe(
      registry,
      channelMessageAtom(channelMessageKey(channelId, "message-1")),
    );
    const ids = probe(registry, channelRootMessageIdsAtom(channelId));
    const summaries = probe(
      registry,
      channelRootMessageSummariesAtom(channelId),
    );

    applySyncEvent(registry, {
      kind: "channel-message-changed",
      channelId,
      message: {
        ...testChannelMessage("message-2", {
          createdAt: "2026-08-01T02:00:00.000Z",
          body: "edited",
        }),
        channelId,
      },
      includeRepliesInRoot: false,
    });
    for (const p of [changed, untouched, ids, summaries]) p.unsubscribe();

    expect(changed.count()).toBe(1);
    expect(untouched.count()).toBe(0);
    expect(ids.count()).toBe(0);
    expect(summaries.count()).toBe(0);
  });

  it("notifies nothing for a page that carried nothing", () => {
    const registry = createTestRegistry();
    seedConversation(registry);

    const messages = probe(registry, channelRootMessagesAtom(channelId));
    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });
    messages.unsubscribe();

    expect(messages.count()).toBe(0);
  });
});

describe("channel threads", () => {
  const threadKey = channelThreadKey(channelId, "root");

  it("stores a thread snapshot root first and lists its root", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("root")]);

    applySyncEvent(registry, {
      kind: "channel-thread-snapshot",
      channelId,
      rootMessageId: "root",
      messages: [
        testChannelMessage("root"),
        testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        }),
      ],
    });

    expect(
      registry.get(channelThreadMessagesAtom(threadKey)).map((m) => m.id),
    ).toEqual(["root", "reply"]);
    expect(registry.get(channelThreadRootIdsAtom(channelId))).toEqual(["root"]);
  });

  it("applies a later page to a stored thread that is not on screen", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("root")]);
    applySyncEvent(registry, {
      kind: "channel-thread-snapshot",
      channelId,
      rootMessageId: "root",
      messages: [testChannelMessage("root")],
    });

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [
        testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        }),
      ],
      removedMessageIds: [],
      reset: false,
      includeRepliesInRoot: false,
    });

    expect(
      registry.get(channelThreadMessagesAtom(threadKey)).map((m) => m.id),
    ).toEqual(["root", "reply"]);
  });

  it("drops a thread whose root a page removed", () => {
    const registry = createTestRegistry();
    seedConversation(registry, [testChannelMessage("root")]);
    applySyncEvent(registry, {
      kind: "channel-thread-snapshot",
      channelId,
      rootMessageId: "root",
      messages: [testChannelMessage("root")],
    });

    applySyncEvent(registry, {
      kind: "channel-messages-page",
      channelId,
      messages: [],
      removedMessageIds: ["root"],
      reset: false,
      includeRepliesInRoot: false,
    });

    expect(registry.get(channelThreadRootIdsAtom(channelId))).toEqual([]);
    expect(registry.get(channelThreadMessagesAtom(threadKey))).toEqual([]);
  });

  it("keeps only the most recently opened threads", () => {
    const registry = createTestRegistry();
    const roots = Array.from(
      { length: CHANNEL_THREAD_RETENTION_LIMIT + 1 },
      (_, index) => `root-${index}`,
    );
    seedConversation(
      registry,
      roots.map((id) => testChannelMessage(id)),
    );

    for (const root of roots) {
      applySyncEvent(registry, {
        kind: "channel-thread-snapshot",
        channelId,
        rootMessageId: root,
        messages: [
          testChannelMessage(root),
          testChannelMessage(`${root}-reply`, { parentMessageId: root }),
        ],
      });
    }

    expect(registry.get(channelThreadRootIdsAtom(channelId))).toEqual(
      roots.slice(1),
    );
    expect(
      registry.get(channelThreadMessagesAtom(channelThreadKey(channelId, roots[0]!))),
    ).toEqual([]);
    // The evicted thread's replies leave the map; its root stays, because the
    // timeline still lists it.
    const stored = registry.get(channelMessagesByIdAtom(channelId));
    expect(stored.has(roots[0]!)).toBe(true);
    expect(stored.has(`${roots[0]}-reply`)).toBe(false);
  });
});

describe("channel conversation retention", () => {
  it("moves a channel to the most recent end without churning the list", () => {
    expect(touchRetained(["a", "b"], "b", 5)).toEqual({
      retained: ["a", "b"],
      evicted: [],
    });
    expect(touchRetained(["a", "b"], "a", 5)).toEqual({
      retained: ["b", "a"],
      evicted: [],
    });
    expect(touchRetained(["a", "b"], "c", 2)).toEqual({
      retained: ["b", "c"],
      evicted: ["a"],
    });
  });

  it("forgets the least recently opened channel past the limit", () => {
    const registry = createTestRegistry();
    const ids = Array.from(
      { length: CHANNEL_CONVERSATION_RETENTION_LIMIT + 1 },
      (_, index) => `channel-${index}`,
    );

    for (const id of ids) {
      seedConversation(registry, [testChannelMessage("message-1")], {
        channelId: id,
      });
    }

    expect(registry.get(retainedConversationChannelIdsAtom)).toEqual(
      ids.slice(1),
    );
    expect(registry.get(channelRootMessageIdsAtom(ids[0]!))).toBeNull();
    expect(registry.get(channelMessagesByIdAtom(ids[0]!)).size).toBe(0);
    expect(registry.get(channelRootMessageIdsAtom(ids[1]!))).toEqual([
      "message-1",
    ]);
  });

  it("forgets one conversation on request", () => {
    const registry = createTestRegistry();
    seedConversation(registry);

    applySyncEvent(registry, {
      kind: "channel-conversation-cleared",
      channelId,
    });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toBeNull();
    expect(registry.get(channelMessageCursorAtom(channelId))).toBeNull();
    expect(registry.get(retainedConversationChannelIdsAtom)).toEqual([]);
  });

  it("forgets every conversation when the session ends", () => {
    const registry = createTestRegistry();
    seedConversation(registry);

    applySyncEvent(registry, { kind: "session-cleared" });

    expect(registry.get(channelRootMessageIdsAtom(channelId))).toBeNull();
    expect(registry.get(retainedConversationChannelIdsAtom)).toEqual([]);
  });
});

describe("channel agent replies", () => {
  it("merges replies and exposes the pending ones", () => {
    const registry = createTestRegistry();

    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [
        testChannelAgentReply("reply-1", { status: "running" }),
        testChannelAgentReply("reply-2", { status: "completed" }),
      ],
      reset: false,
    });

    expect(
      registry.get(channelPendingAgentRepliesAtom(channelId)).map((r) => r.id),
    ).toEqual(["reply-1"]);
  });

  it("does not walk a settled reply back to running", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [testChannelAgentReply("reply-1", { status: "completed" })],
      reset: false,
    });

    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [
        testChannelAgentReply("reply-1", {
          status: "running",
          updatedAt: "2026-08-01T09:00:00.000Z",
        }),
      ],
      reset: false,
    });

    expect(registry.get(channelAgentRepliesAtom(channelId))[0]?.status).toBe(
      "completed",
    );
  });

  it("settles what an authoritative list omits and keeps what outran it", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [
        testChannelAgentReply("reply-old", { status: "running" }),
        testChannelAgentReply("reply-new", { status: "running" }),
      ],
      reset: false,
    });

    applySyncEvent(registry, {
      kind: "channel-agent-replies-authoritative",
      channelId,
      replies: [],
      retainedReplyIds: ["reply-new"],
    });

    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((r) => r.id),
    ).toEqual(["reply-new"]);

    // The settled one may not come back from a page that started earlier.
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [testChannelAgentReply("reply-old", { status: "running" })],
      reset: false,
    });
    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((r) => r.id),
    ).toEqual(["reply-new"]);
  });

  it("replaces the replies on a reset page", () => {
    const registry = createTestRegistry();
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [testChannelAgentReply("reply-1", { status: "running" })],
      reset: false,
    });

    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [],
      reset: true,
    });

    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([]);
  });
});
