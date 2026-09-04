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
  channelOpenThreadIdAtom,
  channelProposalProjectsAtom,
  channelRootMessageIdsAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
  channelThreadRootIdsAtom,
} from "./atoms";
import {
  applyChannelMessageDeletionToChannel,
  mergeIntoChannelSurface,
  patchChannelMessages,
  patchChannelRootMessage,
  removeOptimisticChannelMessages,
  resetChannelConversationViewState,
  writeChannelAgentReplies,
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

  it("replaces agent replies", () => {
    const registry = createTestRegistry();

    writeChannelAgentReplies(registry, channelId, [
      testChannelAgentReply("reply-1"),
    ]);

    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((r) => r.id),
    ).toEqual(["reply-1"]);

    writeChannelAgentReplies(registry, channelId, []);
    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([]);
  });

  /*
    The optimistic writers. What they encode is "both surfaces at once": a
    message is drawn as a root row and, while its thread is open, as a thread
    row, and a patch that reached one of them showed two versions of the same
    message on one screen. The actions used to do this by calling a pair of
    `useState`-shaped updaters and remembering to call both.
  */
  it("patches a message wherever the channel is drawing it", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("root"),
      testChannelMessage("other"),
    ]);
    writeChannelThreadMessages(registry, channelId, "root", [
      testChannelMessage("root"),
      testChannelMessage("reply", { parentMessageId: "root" }),
    ]);
    writeChannelOpenThreadId(registry, channelId, "root");

    patchChannelMessages(registry, channelId, (message) =>
      message.id === "root" ? { ...message, body: "edited" } : message,
    );

    expect(
      registry.get(channelRootMessagesAtom(channelId))[0]?.body,
    ).toBe("edited");
    expect(
      registry.get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))[0]
        ?.body,
    ).toBe("edited");
    // A message the patch returned unchanged keeps its object.
    expect(registry.get(channelRootMessagesAtom(channelId))[1]?.body).not.toBe(
      "edited",
    );
  });

  it("patches one root message and leaves the rest of the timeline alone", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("root"),
      testChannelMessage("other"),
    ]);
    const before = registry.get(channelRootMessagesAtom(channelId));

    patchChannelRootMessage(registry, channelId, "root", (message) => ({
      ...message,
      replyCount: 1,
    }));

    const after = registry.get(channelRootMessagesAtom(channelId));
    expect(after.find((message) => message.id === "root")?.replyCount).toBe(1);
    expect(after.find((message) => message.id === "other")).toBe(
      before.find((message) => message.id === "other"),
    );
  });

  it("merges into the surface it is told, and rolls an optimistic send back", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [testChannelMessage("root")]);
    writeChannelThreadMessages(registry, channelId, "root", [
      testChannelMessage("root"),
    ]);
    writeChannelOpenThreadId(registry, channelId, "root");

    mergeIntoChannelSurface(registry, channelId, "thread", [
      testChannelMessage("pending", {
        parentMessageId: "root",
        optimistic: true,
      }),
    ]);
    const threadIds = () =>
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((message) => message.id);
    expect(threadIds()).toContain("pending");
    // The thread was the surface named, so the root timeline did not move.
    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((m) => m.id),
    ).toEqual(["root"]);

    removeOptimisticChannelMessages(registry, channelId, "pending");
    expect(threadIds()).toEqual(["root"]);
  });

  it("applies a delete response to both surfaces", () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("root"),
      testChannelMessage("gone"),
    ]);
    writeChannelThreadMessages(registry, channelId, "root", [
      testChannelMessage("root"),
      testChannelMessage("gone", { parentMessageId: "root" }),
    ]);
    writeChannelOpenThreadId(registry, channelId, "root");

    applyChannelMessageDeletionToChannel(registry, channelId, "gone", {
      deleted: true,
      message: null,
      parentMessage: null,
    });

    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((m) => m.id),
    ).toEqual(["root"]);
    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((message) => message.id),
    ).toEqual(["root"]);
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
