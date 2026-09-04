/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  testChannelAgent,
  testChannelAgentReply,
  testChannelMember,
  testChannelMessage,
} from "../../test/channel-conversation";
import { createTestRegistry } from "../registry";
import {
  channelAcceptingProposalIdAtom,
  channelAgentRepliesAtom,
  channelAgentsAtom,
  channelConversationBusyAtom,
  channelMembersAtom,
  channelMessageCursorAtom,
  channelOpenThreadIdAtom,
  channelProposalProjectsAtom,
  channelRootMessageIdsAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
  channelThreadRootIdsAtom,
} from "./atoms";
import {
  resetChannelConversationViewState,
  writeChannelAgentReplies,
  writeChannelDeltaToStoredThreads,
  writeChannelMessageCursor,
  writeChannelOpenThreadId,
  writeChannelParticipants,
  writeChannelThreadMessages,
  writeChannelThreadSnapshot,
  writeChannelTimeline,
} from "./write";

const channelId = "channel-1";

describe("conversation store writers", () => {
  it("replaces a timeline and keeps the object of every unchanged message", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("a"),
      testChannelMessage("b"),
    ]);
    const before = registry.get(channelRootMessagesAtom(channelId));

    writeChannelTimeline(registry, channelId, [
      testChannelMessage("a"),
      testChannelMessage("b", { body: "edited" }),
    ]);
    const after = registry.get(channelRootMessagesAtom(channelId));

    expect(after.map((message) => message.id)).toEqual(["a", "b"]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]?.body).toBe("edited");
  });

  it("keeps a timeline that did not move, so nobody is notified", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("a")]);
    const before = registry.get(channelRootMessagesAtom(channelId));

    let notifications = -1;
    const unsubscribe = registry.subscribe(
      channelRootMessagesAtom(channelId),
      () => {
        notifications += 1;
      },
      { immediate: true },
    );
    writeChannelTimeline(registry, channelId, [testChannelMessage("a")]);
    unsubscribe();

    expect(registry.get(channelRootMessagesAtom(channelId))).toBe(before);
    expect(notifications).toBe(0);
  });

  it("drops a message the timeline no longer lists", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("a"),
      testChannelMessage("b"),
    ]);

    writeChannelTimeline(registry, channelId, [testChannelMessage("a")]);

    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((m) => m.id),
    ).toEqual(["a"]);
  });

  it("writes one thread and lists its root", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("root")]);

    writeChannelThreadMessages(registry, channelId, "root", [
      testChannelMessage("root"),
      testChannelMessage("reply", { parentMessageId: "root" }),
    ]);

    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((m) => m.id),
    ).toEqual(["root", "reply"]);
    expect(registry.get(channelThreadRootIdsAtom(channelId))).toEqual(["root"]);
  });

  it("keeps a monotonic accept when a thread snapshot re-asserts pending", () => {
    const registry = createTestRegistry();
    const accepted = testChannelMessage("root", {
      executionProposal: {
        id: "proposal-1",
        status: "accepted",
      } as never,
    });
    writeChannelThreadMessages(registry, channelId, "root", [accepted]);

    writeChannelThreadSnapshot(registry, channelId, "root", [
      testChannelMessage("root", {
        executionProposal: { id: "proposal-1", status: "pending" } as never,
      }),
    ]);

    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))[0]
        ?.executionProposal?.status,
    ).toBe("accepted");
  });

  it("applies a delta to a thread that is not on screen", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("root")]);
    writeChannelThreadMessages(registry, channelId, "root", [
      testChannelMessage("root"),
    ]);

    writeChannelDeltaToStoredThreads(
      registry,
      channelId,
      [
        testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        }),
        testChannelMessage("elsewhere", { channelId: "channel-2" }),
      ],
      [],
      false,
    );

    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((m) => m.id),
    ).toEqual(["root", "reply"]);
  });

  it("replaces participants, keeping the entry of anyone unchanged", () => {
    const registry = createTestRegistry();
    writeChannelParticipants(registry, channelId, {
      members: [testChannelMember("user-1")],
      agents: [testChannelAgent("agent-1")],
    });
    const member = registry.get(channelMembersAtom(channelId))[0];

    writeChannelParticipants(registry, channelId, {
      members: [testChannelMember("user-1"), testChannelMember("user-2")],
    });

    expect(registry.get(channelMembersAtom(channelId))[0]).toBe(member);
    expect(
      registry.get(channelMembersAtom(channelId)).map((m) => m.userId),
    ).toEqual(["user-1", "user-2"]);
    // Agents were not part of the write, so they are left alone.
    expect(
      registry.get(channelAgentsAtom(channelId)).map((a) => a.agentId),
    ).toEqual(["agent-1"]);
  });

  it("replaces agent replies and the cursor", () => {
    const registry = createTestRegistry();

    writeChannelAgentReplies(registry, channelId, [
      testChannelAgentReply("reply-1"),
    ]);
    writeChannelMessageCursor(registry, channelId, "older");

    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((r) => r.id),
    ).toEqual(["reply-1"]);
    expect(registry.get(channelMessageCursorAtom(channelId))).toBe("older");

    writeChannelAgentReplies(registry, channelId, []);
    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([]);
  });

  it("resets the flags a newly opened channel starts clean with", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("a")]);
    writeChannelOpenThreadId(registry, channelId, "a");
    registry.set(channelConversationBusyAtom(channelId), true);
    registry.set(channelAcceptingProposalIdAtom(channelId), "proposal-1");
    registry.set(channelProposalProjectsAtom(channelId), { "p-1": "team-1" });

    resetChannelConversationViewState(registry, channelId);

    expect(registry.get(channelOpenThreadIdAtom(channelId))).toBeNull();
    expect(registry.get(channelConversationBusyAtom(channelId))).toBe(false);
    expect(registry.get(channelAcceptingProposalIdAtom(channelId))).toBeNull();
    expect(registry.get(channelProposalProjectsAtom(channelId))).toEqual({});
    // The messages are not view state: they are what makes the return instant.
    expect(registry.get(channelRootMessageIdsAtom(channelId))).toEqual(["a"]);
  });
});
