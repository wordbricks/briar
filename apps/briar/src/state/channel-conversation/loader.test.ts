/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import type { ChannelMessage } from "../../lib/channels-contract";
import {
  testChannelAgentReply,
  testChannelMember,
  testChannelMessage,
  testChannelSummary,
} from "../../test/channel-conversation";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  channelAgentRepliesAtom,
  channelEarlierMessagesLoadingAtom,
  channelMembersAtom,
  channelMessageCursorAtom,
  channelOpenThreadIdAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
} from "./atoms";
import { channelConversationFailureAtom } from "./errors";
import { getChannelReplyLedger } from "./reply-ledger";
import {
  createChannelConversationLoader,
  type ChannelConversationApi,
} from "./loader";
import { writeChannelAgentReplies, writeChannelTimeline } from "./write";

const channelId = "channel-1";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

type ChannelDetail = Awaited<ReturnType<ChannelConversationApi["loadChannel"]>>;

const detail = (
  messages: ChannelMessage[],
  overrides: Partial<ChannelDetail> = {},
): ChannelDetail => ({
  channel: testChannelSummary(channelId),
  members: [testChannelMember("user-1")],
  agents: [],
  messages,
  agentReplies: [],
  nextCursor: null,
  ...overrides,
});

function signedInRegistry(): AtomRegistry {
  return createTestRegistry([
    [tokenAtom, "token"],
    [activeOrganizationIdAtom, "org-1"],
  ]);
}

/** The loader plus the reads it was given, which every case replaces. */
function harness(api: Partial<ChannelConversationApi>) {
  const registry = signedInRegistry();
  const loader = createChannelConversationLoader(registry, api);
  loader.syncSurface(channelId, null);
  return { loader, registry };
}

describe("channel conversation loader", () => {
  it("commits a detail response into the store", async () => {
    const { loader, registry } = harness({
      loadChannel: async () =>
        detail([testChannelMessage("a"), testChannelMessage("b")], {
          nextCursor: "cursor-1",
        }),
    });

    const result = await loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: false,
    });

    expect(result?.messages.map((message) => message.id)).toEqual(["a", "b"]);
    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["a", "b"]);
    expect(registry.get(channelMessageCursorAtom(channelId))).toBe("cursor-1");
    expect(
      registry.get(channelMembersAtom(channelId)).map((m) => m.userId),
    ).toEqual(["user-1"]);
  });

  it("drops a detail response after the surface changed", async () => {
    const pending = deferred<ChannelDetail>();
    const { loader, registry } = harness({
      loadChannel: () => pending.promise,
    });

    const load = loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: false,
    });
    loader.syncSurface("channel-2", null);
    pending.resolve(detail([testChannelMessage("a")]));

    expect(await load).toBeNull();
    expect(registry.get(channelRootMessagesAtom(channelId))).toEqual([]);
  });

  it("drops a detail response after the open thread changed", async () => {
    const pending = deferred<ChannelDetail>();
    const { loader, registry } = harness({
      loadChannel: () => pending.promise,
    });

    const load = loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: false,
    });
    loader.syncSurface(channelId, "root-1");
    pending.resolve(detail([testChannelMessage("a")]));

    expect(await load).toBeNull();
    expect(registry.get(channelRootMessagesAtom(channelId))).toEqual([]);
  });

  it("keeps what a revisited channel already holds and its deeper cursor", async () => {
    const { loader, registry } = harness({
      loadChannel: async () =>
        detail([testChannelMessage("b"), testChannelMessage("c")], {
          nextCursor: "newest-page",
        }),
    });
    writeChannelTimeline(registry, channelId, [
      testChannelMessage("a"),
      testChannelMessage("b"),
      testChannelMessage("c"),
    ]);
    registry.set(channelMessageCursorAtom(channelId), "older-page");

    await loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: true,
    });

    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["a", "b", "c"]);
    // The stored cursor resumes from further back than the response's does.
    expect(registry.get(channelMessageCursorAtom(channelId))).toBe("older-page");
  });

  it("merges an older page and advances the cursor", async () => {
    const { loader, registry } = harness({
      listChannelMessages: async () => ({
        messages: [
          testChannelMessage("old", { createdAt: "2026-08-01T00:00:00.000Z" }),
        ],
        nextCursor: "older-still",
      }),
    });
    writeChannelTimeline(registry, channelId, [testChannelMessage("new")]);
    registry.set(channelMessageCursorAtom(channelId), "cursor-1");

    const result = await loader.loadEarlier(channelId, 20);

    expect(result).toEqual({ applied: true, nextCursor: "older-still" });
    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["old", "new"]);
    expect(registry.get(channelEarlierMessagesLoadingAtom(channelId))).toBe(
      false,
    );
  });

  it("discards an older page whose surface has moved on", async () => {
    const pending = deferred<{
      messages: ChannelMessage[];
      nextCursor: string | null;
    }>();
    const { loader, registry } = harness({
      listChannelMessages: () => pending.promise,
    });
    writeChannelTimeline(registry, channelId, [testChannelMessage("new")]);
    registry.set(channelMessageCursorAtom(channelId), "cursor-1");

    const load = loader.loadEarlier(channelId, 20);
    loader.syncSurface("channel-2", null);
    pending.resolve({
      messages: [
        testChannelMessage("old", { createdAt: "2026-08-01T00:00:00.000Z" }),
      ],
      nextCursor: null,
    });

    expect(await load).toEqual({ applied: false, nextCursor: "cursor-1" });
    expect(
      registry
        .get(channelRootMessagesAtom(channelId))
        .map((message) => message.id),
    ).toEqual(["new"]);
  });

  it("refuses a second older page while one is in flight", async () => {
    const pending = deferred<{
      messages: ChannelMessage[];
      nextCursor: string | null;
    }>();
    let calls = 0;
    const { loader, registry } = harness({
      listChannelMessages: () => {
        calls += 1;
        return pending.promise;
      },
    });
    registry.set(channelMessageCursorAtom(channelId), "cursor-1");

    const first = loader.loadEarlier(channelId, 20);
    const second = await loader.loadEarlier(channelId, 20);
    pending.resolve({ messages: [], nextCursor: null });
    await first;

    expect(calls).toBe(1);
    expect(second).toEqual({ applied: false, nextCursor: "cursor-1" });
  });

  it("opens a thread from its cache and replaces it with the server snapshot", async () => {
    const root = testChannelMessage("root");
    const { loader, registry } = harness({
      listChannelMessages: async () => ({
        messages: [root, testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        })],
        nextCursor: null,
      }),
    });

    const opened = await loader.loadThread(channelId, "root", [root]);

    expect(opened).toBe(true);
    expect(registry.get(channelOpenThreadIdAtom(channelId))).toBe("root");
    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((message) => message.id),
    ).toEqual(["root", "reply"]);
  });

  it("settles the replies a detail omits and keeps one observed while it loaded", async () => {
    const pending = deferred<ChannelDetail>();
    const { loader, registry } = harness({
      loadChannel: () => pending.promise,
    });
    writeChannelAgentReplies(registry, channelId, [
      testChannelAgentReply("settled"),
    ]);

    const load = loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: false,
    });
    // Arrives after the request started, so the answer cannot speak for it.
    const ledgerReply = testChannelAgentReply("concurrent");
    getChannelReplyLedger(registry).note(channelId, [ledgerReply]);
    writeChannelAgentReplies(registry, channelId, [
      testChannelAgentReply("settled"),
      ledgerReply,
    ]);
    pending.resolve(detail([], { agentReplies: [] }));
    await load;

    expect(
      registry.get(channelAgentRepliesAtom(channelId)).map((reply) => reply.id),
    ).toEqual(["concurrent"]);
  });

  it("publishes a failed read instead of throwing", async () => {
    const { loader, registry } = harness({
      loadChannel: async () => {
        throw new Error("channel unavailable");
      },
    });

    expect(
      await loader.loadConversation(channelId, {
        messageLimit: 20,
        mergeWithCurrentMessages: false,
      }),
    ).toBeNull();
    expect(registry.get(channelConversationFailureAtom)?.message).toBe(
      "channel unavailable",
    );
  });

  it("stays quiet about a failure the surface has already left", async () => {
    const pending = deferred<ChannelDetail>();
    const { loader, registry } = harness({
      loadChannel: () => pending.promise,
    });

    const load = loader.loadConversation(channelId, {
      messageLimit: 20,
      mergeWithCurrentMessages: false,
    });
    loader.syncSurface("channel-2", null);
    pending.reject(new Error("channel unavailable"));
    await load;

    expect(registry.get(channelConversationFailureAtom)).toBeNull();
  });

  it("versions a proposal only when it actually changed", () => {
    const { loader } = harness({});
    const proposal: NonNullable<ChannelMessage["proposal"]> = {
      id: "proposal-1",
      status: "pending",
      projectId: "project-1",
      payload: {
        issue: { title: "Follow-up", description: null, priority: 2 },
        executeAfterCreate: false,
      },
      resultRunId: null,
      resultItems: [],
    };
    const message = testChannelMessage("a", { proposal });

    loader.recordProposalMessages([message]);
    const first = loader.proposalVersion("proposal-1");
    loader.recordProposalMessages([testChannelMessage("a", { proposal })]);
    expect(loader.proposalVersion("proposal-1")).toBe(first);

    loader.recordProposalMessages([
      testChannelMessage("a", { proposal: { ...proposal, status: "accepted" } }),
    ]);
    expect(loader.proposalVersion("proposal-1")).toBe(first + 1);
    expect(loader.latestProposal("proposal-1")?.status).toBe("accepted");
  });

  it("refetches the thread an approval raced", async () => {
    const { loader, registry } = harness({
      listChannelMessages: async () => ({
        messages: [
          testChannelMessage("root"),
          testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        }),
        ],
        nextCursor: null,
      }),
    });

    await loader.refresh(channelId, {
      item: testChannelMessage("reply", {
          parentMessageId: "root",
          createdAt: "2026-08-01T02:00:00.000Z",
        }),
      proposalId: "proposal-1",
      pageSize: 20,
    });

    expect(
      registry
        .get(channelThreadMessagesAtom(channelThreadKey(channelId, "root")))
        .map((message) => message.id),
    ).toEqual(["root", "reply"]);
  });
});
