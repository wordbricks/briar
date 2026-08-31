/** @vitest-environment jsdom */

import * as React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import type {
  RealtimeNotification,
  RealtimeTransport,
} from "../lib/realtime-transport";
import {
  defaultChannelConversationDependencies,
  useChannelConversation,
} from "./use-channel-conversation";

const api = {
  acceptChannelProposal: vi.fn(),
  declineChannelProposal: vi.fn(),
  listChannelMessages: vi.fn(),
  loadChannel: vi.fn(),
  loadChannelDelta: vi.fn(),
  sendChannelMessage: vi.fn(),
};
class FakeRealtimeTransport implements RealtimeTransport {
  listener: ((notification: RealtimeNotification) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();

  subscribe(listener: (notification: RealtimeNotification) => void) {
    this.listener = listener;
    return vi.fn();
  }

  emit(notification: RealtimeNotification) {
    this.listener?.(notification);
  }
}
const realtimeTransport = new FakeRealtimeTransport();
const dependencies = {
  ...defaultChannelConversationDependencies,
  acceptChannelProposal: api.acceptChannelProposal,
  declineChannelProposal: api.declineChannelProposal,
  listChannelMessages: api.listChannelMessages,
  loadChannel: api.loadChannel,
  loadChannelDelta: api.loadChannelDelta,
  sendChannelMessage: api.sendChannelMessage,
  createChannelRealtimeTransport: () => realtimeTransport,
};

const channel = (id: string): ChannelSummary => ({
  id,
  organizationId: "org-1",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: "project-1",
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
});

const member: ChannelMember = {
  userId: "user-1",
  name: "Jay",
  email: "jay@example.com",
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const message = (
  id: string,
  input: Partial<ChannelMessage> = {},
): ChannelMessage => ({
  id,
  channelId: "channel-a",
  parentMessageId: null,
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
  ...input,
  blocks: input.blocks ?? [],
  replyAuthors: input.replyAuthors ?? [],
  subscribers: input.subscribers ?? [],
  skillExecutionProposal: input.skillExecutionProposal ?? null,
});

const agentReply = (
  id: string,
  input: Partial<ChannelAgentReply> = {},
): ChannelAgentReply => ({
  id,
  agentId: `agent-${id}`,
  channelId: "channel-a",
  triggerMessageId: "root",
  parentMessageId: "root",
  replyMessageId: `message-${id}`,
  status: "queued",
  attempts: 0,
  error: null,
  createdAt: "2026-08-01T01:00:00.000Z",
  updatedAt: "2026-08-01T01:00:00.000Z",
  ...input,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

type Conversation = ReturnType<typeof useChannelConversation> & {
  messages: ChannelMessage[];
  messageNextCursor: string | null;
  replies: ChannelAgentReply[];
  threadMessages: ChannelMessage[];
  threadParentId: string | null;
};

let latest: Conversation | null = null;

function Harness({
  activeChannel,
  initialMessages = [],
  initialReplies = [],
  initialNextCursor = null,
  initialThreadParentId = null,
  realtimeEnabled = false,
}: {
  activeChannel: ChannelSummary;
  initialMessages?: ChannelMessage[];
  initialReplies?: ChannelAgentReply[];
  initialNextCursor?: string | null;
  initialThreadParentId?: string | null;
  realtimeEnabled?: boolean;
}) {
  const [members, setMembers] = React.useState<ChannelMember[]>([member]);
  const [agents, setAgents] = React.useState<ChannelAgentSummary[]>([]);
  const [messages, setMessages] = React.useState(initialMessages);
  const [replies, setReplies] = React.useState<ChannelAgentReply[]>(
    initialReplies,
  );
  const [threadParentId, setThreadParentId] = React.useState<string | null>(
    initialThreadParentId,
  );
  const [threadMessages, setThreadMessages] = React.useState<ChannelMessage[]>([]);
  const [messageNextCursor, setMessageNextCursor] = React.useState<string | null>(
    initialNextCursor,
  );
  const catalogCursor = React.useRef(0);
  const updateRootMessages = React.useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setMessages(update);
    },
    [],
  );
  const updateThreadMessages = React.useCallback(
    (update: (current: ChannelMessage[]) => ChannelMessage[]) => {
      setThreadMessages(update);
    },
    [],
  );
  const conversation = useChannelConversation({
    token: "token",
    organizationId: "org-1",
    currentUserId: "user-1",
    channel: activeChannel,
    members,
    agents,
    messages,
    replies,
    threadParentId,
    threadMessages,
    messageNextCursor,
    pageSize: 20,
    updateRootMessages,
    updateThreadMessages,
    setMembers,
    setAgents,
    setReplies,
    setThreadParentId,
    setMessageNextCursor,
    dependencies,
    activityEnabled: false,
    realtime: realtimeEnabled
      ? {
          enabled: true,
          catalogCursor,
          catalogReady: true,
          onCatalogDelta: () => undefined,
          onSelectedChannelRemoved: () => undefined,
          warningLabel: "test delta failed",
        }
      : undefined,
  });
  latest = {
    ...conversation,
    messages,
    messageNextCursor,
    replies,
    threadMessages,
    threadParentId,
  };
  return null;
}

async function renderHarness(props: React.ComponentProps<typeof Harness>) {
  const { cleanup, container, root } = createReactTestRoot();
  await renderReactTestRoot(root, <Harness {...props} />);
  return { cleanup, root };
}

const current = () => {
  if (!latest) throw new Error("Harness has not rendered");
  return latest;
};

describe("useChannelConversation", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    latest = null;
    cleanup = null;
    realtimeTransport.listener = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
    root = null;
    vi.restoreAllMocks();
  });

  it("drops a channel detail response after the selected surface changes", async () => {
    const pending = deferred<Awaited<ReturnType<typeof import("../lib/api").loadChannel>>>();
    api.loadChannel.mockReturnValueOnce(pending.promise);
    ({ cleanup, root } = await renderHarness({ activeChannel: channel("channel-a") }));

    let request!: ReturnType<Conversation["loadChannelConversation"]>;
    await act(async () => {
      request = current().loadChannelConversation({
        channelId: "channel-a",
        messageLimit: 20,
        mergeWithCurrentMessages: false,
      });
    });
    await act(async () => root?.render(
      <Harness activeChannel={channel("channel-b")} />,
    ));
    await act(async () => pending.resolve({
      channel: channel("channel-a"),
      members: [member],
      agents: [],
      messages: [message("late-a")],
      agentReplies: [],
      nextCursor: null,
    }));

    expect(await request).toBeNull();
    expect(current().messages).not.toContainEqual(
      expect.objectContaining({ id: "late-a" }),
    );
    expect(current().error).toBeNull();
  });

  it("applies pagination and delta changes through the shared merge path", async () => {
    api.listChannelMessages.mockResolvedValueOnce({
      messages: [message("older", { createdAt: "2026-08-01T00:00:00.000Z" })],
      nextCursor: null,
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [message("current")],
      initialNextCursor: "cursor-1",
    }));

    await act(async () => {
      await current().loadEarlierChannelMessages();
    });
    expect(current().messages.map((item) => item.id)).toEqual([
      "older",
      "current",
    ]);
    expect(current().messageNextCursor).toBeNull();

    await act(async () => current().applyIncomingMessages(
      [message("new", { createdAt: "2026-08-01T02:00:00.000Z" })],
      ["current"],
    ));
    expect(current().messages.map((item) => item.id)).toEqual(["older", "new"]);
  });

  it("uses the latest cursor when a stale scroll callback runs after refresh", async () => {
    api.loadChannel.mockResolvedValueOnce({
      channel: channel("channel-a"),
      members: [member],
      agents: [],
      messages: [message("current")],
      agentReplies: [],
      nextCursor: "cursor-2",
    });
    api.listChannelMessages.mockResolvedValueOnce({
      messages: [message("older", { createdAt: "2026-08-01T00:00:00.000Z" })],
      nextCursor: null,
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [message("current")],
      initialNextCursor: "cursor-1",
    }));

    const staleScrollCallback = current().loadEarlierChannelMessages;
    await act(async () => {
      await current().loadChannelConversation({
        channelId: "channel-a",
        messageLimit: 20,
        mergeWithCurrentMessages: false,
      });
    });
    await act(async () => {
      await staleScrollCallback();
    });

    expect(api.listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-a",
      undefined,
      expect.objectContaining({ limit: 20, cursor: "cursor-2" }),
    );
  });

  it("loads root history while the desktop thread surface is open", async () => {
    api.listChannelMessages.mockResolvedValueOnce({
      messages: [message("older", { createdAt: "2026-08-01T00:00:00.000Z" })],
      nextCursor: null,
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [message("current")],
      initialNextCursor: "cursor-1",
      initialThreadParentId: "root",
    }));

    await act(async () => {
      await current().loadEarlierChannelMessages();
    });

    expect(api.listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-a",
      undefined,
      expect.objectContaining({ limit: 20, cursor: "cursor-1" }),
    );
    expect(current().messages.map((item) => item.id)).toEqual(["older", "current"]);
  });

  it("drains a realtime cursor notification through the shared delta loop", async () => {
    api.loadChannelDelta.mockResolvedValueOnce({
      cursor: 1,
      hasMore: false,
      reset: false,
      channels: [],
      removedChannelIds: [],
      messages: [message("realtime")],
      removedMessageIds: [],
      agentReplies: [],
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      realtimeEnabled: true,
    }));

    await act(async () => {
      realtimeTransport.emit({ topic: "channels", cursor: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.loadChannelDelta).toHaveBeenCalledWith(
      "token",
      "org-1",
      0,
      expect.any(AbortSignal),
    );
    expect(current().messages.map((item) => item.id)).toEqual(["realtime"]);
  });

  it("replaces stale messages and replies on a reset delta", async () => {
    const freshReply = agentReply("reply-fresh", { status: "running" });
    api.loadChannelDelta.mockResolvedValueOnce({
      cursor: 8,
      hasMore: false,
      reset: true,
      channels: [channel("channel-a")],
      removedChannelIds: [],
      messages: [message("fresh")],
      removedMessageIds: [],
      agentReplies: [freshReply],
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [message("stale")],
      initialReplies: [agentReply("reply-stale")],
      realtimeEnabled: true,
    }));

    await act(async () => {
      realtimeTransport.emit({ topic: "channels", cursor: 8 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current().messages.map((item) => item.id)).toEqual(["fresh"]);
    expect(current().replies).toEqual([freshReply]);
  });

  it("replaces active replies from an authoritative detail and tombstones absences", async () => {
    const stale = agentReply("reply-a", { status: "running" });
    api.loadChannel.mockResolvedValueOnce({
      channel: channel("channel-a"),
      members: [member],
      agents: [],
      messages: [message("root")],
      agentReplies: [],
      nextCursor: null,
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialReplies: [stale],
    }));

    await act(async () => {
      await current().loadChannelConversation({
        channelId: "channel-a",
        messageLimit: 20,
        mergeWithCurrentMessages: false,
      });
    });
    expect(current().replies).toEqual([]);

    act(() => current().applyAgentReplies([
      { ...stale, updatedAt: "2026-08-01T03:00:00.000Z" },
    ]));
    expect(current().replies).toEqual([]);
  });

  it("preserves a reply first observed while an older detail request is loading", async () => {
    const pending = deferred<Awaited<ReturnType<typeof import("../lib/api").loadChannel>>>();
    const concurrent = agentReply("reply-new", { status: "queued" });
    api.loadChannel.mockReturnValueOnce(pending.promise);
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
    }));

    let request!: ReturnType<Conversation["loadChannelConversation"]>;
    await act(async () => {
      request = current().loadChannelConversation({
        channelId: "channel-a",
        messageLimit: 20,
        mergeWithCurrentMessages: false,
      });
      await Promise.resolve();
    });
    act(() => current().applyAgentReplies([concurrent]));
    await act(async () => pending.resolve({
      channel: channel("channel-a"),
      members: [member],
      agents: [],
      messages: [message("root")],
      agentReplies: [],
      nextCursor: null,
    }));
    await act(async () => request);

    expect(current().replies).toEqual([concurrent]);
  });

  it("keeps a terminal delta when an older send response arrives later", async () => {
    const pending = deferred<Awaited<ReturnType<typeof import("../lib/api").sendChannelMessage>>>();
    const completed = agentReply("reply-a", {
      status: "completed",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    api.sendChannelMessage.mockReturnValueOnce(pending.promise);
    api.loadChannelDelta.mockResolvedValueOnce({
      cursor: 1,
      hasMore: false,
      reset: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [completed],
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      realtimeEnabled: true,
    }));

    let request!: ReturnType<Conversation["send"]>;
    await act(async () => {
      request = current().send("hello", [], null, [], []);
      await Promise.resolve();
    });
    await act(async () => {
      realtimeTransport.emit({ topic: "channels", cursor: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current().replies).toEqual([completed]);

    const optimisticId = current().messages[0]!.id;
    await act(async () => pending.resolve({
      message: message(optimisticId, { body: "hello" }),
      agentReplies: [agentReply("reply-a", {
        status: "queued",
        updatedAt: "2026-08-01T03:00:00.000Z",
      })],
    }));
    await act(async () => request);
    expect(current().replies).toEqual([completed]);
  });

  it("keeps only the other Agent active after one of concurrent replies completes", async () => {
    const first = agentReply("reply-a", {
      agentId: "agent-a",
      status: "running",
    });
    const second = agentReply("reply-b", {
      agentId: "agent-b",
      status: "running",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialReplies: [first, second],
    }));

    act(() => current().applyAgentReplies([
      { ...first, status: "completed", updatedAt: "2026-08-01T02:00:00.000Z" },
      { ...second, status: "queued", updatedAt: "2026-08-01T01:00:00.000Z" },
    ]));

    expect(current().replies.filter(
      (reply) => reply.status === "queued" || reply.status === "running",
    ).map((reply) => reply.id)).toEqual(["reply-b"]);
    expect(current().replies.find((reply) => reply.id === "reply-b")?.status)
      .toBe("running");
  });

  it("loads a thread snapshot and keeps its root/replies together", async () => {
    const rootMessage = message("root", {
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const reply = message("reply", {
      parentMessageId: "root",
      createdAt: "2026-08-01T01:00:00.000Z",
    });
    const pending = deferred<{
      messages: ChannelMessage[];
      nextCursor: null;
    }>();
    api.listChannelMessages.mockReturnValueOnce(pending.promise);
    const snapshot = {
      messages: [rootMessage, reply],
      nextCursor: null,
    };
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [rootMessage],
    }));

    let request!: ReturnType<Conversation["openThread"]>;
    await act(async () => {
      request = current().openThread("root");
      await Promise.resolve();
    });
    expect(current().threadParentId).toBe("root");
    await act(async () => pending.resolve(snapshot));
    await act(async () => expect(await request).toBe(true));
    expect(current().threadMessages.map((item) => item.id)).toEqual([
      "root",
      "reply",
    ]);
  });

  it("resolves a requested reply deep-link through its missing root", async () => {
    const requestedRoot = message("requested-root", {
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const requestedReply = message("requested-reply", {
      parentMessageId: requestedRoot.id,
    });
    api.loadChannel.mockResolvedValueOnce({
      channel: channel("channel-a"),
      members: [member],
      agents: [],
      messages: [message("recent")],
      agentReplies: [],
      nextCursor: "older",
    });
    api.listChannelMessages.mockResolvedValueOnce({
      messages: [requestedRoot, requestedReply],
      nextCursor: null,
    });
    ({ cleanup, root } = await renderHarness({ activeChannel: channel("channel-a") }));

    await act(async () => {
      await current().loadChannelConversation({
        channelId: "channel-a",
        messageLimit: 20,
        mergeWithCurrentMessages: false,
        requestedMessage: {
          channelId: "channel-a",
          messageId: requestedReply.id,
          rootMessageId: requestedRoot.id,
        },
      });
    });

    expect(current().messages.map((item) => item.id)).toContain(requestedRoot.id);
    expect(current().threadParentId).toBe(requestedRoot.id);
    expect(current().threadMessages.map((item) => item.id)).toEqual([
      requestedRoot.id,
      requestedReply.id,
    ]);
  });

  it("reconciles an optimistic root message with the server response", async () => {
    const pending = deferred<Awaited<ReturnType<typeof import("../lib/api").sendChannelMessage>>>();
    api.sendChannelMessage.mockReturnValueOnce(pending.promise);
    ({ cleanup, root } = await renderHarness({ activeChannel: channel("channel-a") }));

    let request!: ReturnType<Conversation["send"]>;
    await act(async () => {
      request = current().send("hello", [], null, [], []);
      await Promise.resolve();
    });
    expect(current().messages).toHaveLength(1);
    expect(current().messages[0]).toMatchObject({ body: "hello", optimistic: true });
    const optimisticId = current().messages[0]!.id;

    await act(async () => pending.resolve({
      message: message(optimisticId, { body: "hello" }),
      agentReplies: [],
    }));
    await act(async () => request);
    expect(current().messages).toHaveLength(1);
    expect(current().messages[0]?.id).toBe(optimisticId);
    expect(current().messages[0]?.optimistic).not.toBe(true);
  });

  it("applies a proposal approval only to the unchanged surface", async () => {
    const proposalMessage = message("proposal", {
      proposal: {
        id: "proposal-1",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Follow-up",
            description: null,
            priority: 2,
            status: "backlog",
          },
          executeAfterCreate: false,
        },
        resultRunId: null,
      },
    });
    api.acceptChannelProposal.mockResolvedValueOnce({
      projectId: "project-1",
      resultRunId: "run-1",
      resultItems: undefined,
      executionProposal: null,
    });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [proposalMessage],
    }));
    act(() => current().recordProposalMessages([proposalMessage]));

    await act(async () => {
      expect(await current().acceptProposal(proposalMessage)).toBeNull();
    });
    expect(current().messages[0]?.proposal).toMatchObject({
      status: "accepted",
      resultRunId: "run-1",
    });
  });

  it("marks a declined proposal terminal on the unchanged surface", async () => {
    const proposalMessage = message("proposal", {
      proposal: {
        id: "proposal-1",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Follow-up",
            description: null,
            priority: 2,
            status: "backlog",
          },
          executeAfterCreate: true,
        },
        resultRunId: null,
      },
    });
    api.declineChannelProposal.mockResolvedValueOnce({ outcome: "declined" });
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [proposalMessage],
    }));
    act(() => current().recordProposalMessages([proposalMessage]));

    await act(async () => current().declineProposal(proposalMessage));

    expect(api.declineChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-a",
      "proposal-1",
    );
    expect(current().messages[0]?.proposal?.status).toBe("declined");
    expect(current().decliningProposalId).toBeNull();
  });

  it("ignores a late proposal success after switching channels", async () => {
    const proposalMessage = message("proposal", {
      proposal: {
        id: "proposal-1",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Follow-up",
            description: null,
            priority: 2,
            status: "backlog",
          },
          executeAfterCreate: false,
        },
        resultRunId: null,
      },
    });
    const pending = deferred<{
      projectId: string;
      resultRunId: string;
      resultItems: undefined;
      executionProposal: null;
    }>();
    api.acceptChannelProposal.mockReturnValueOnce(pending.promise);
    ({ cleanup, root } = await renderHarness({
      activeChannel: channel("channel-a"),
      initialMessages: [proposalMessage],
    }));
    act(() => current().recordProposalMessages([proposalMessage]));
    let request!: ReturnType<Conversation["acceptProposal"]>;
    await act(async () => {
      request = current().acceptProposal(proposalMessage);
      await Promise.resolve();
    });
    await act(async () => root?.render(
      <Harness activeChannel={channel("channel-b")} />,
    ));
    await act(async () => pending.resolve({
      projectId: "project-1",
      resultRunId: "late-run",
      resultItems: undefined,
      executionProposal: null,
    }));
    await act(async () => request);

    expect(current().messages[0]?.proposal).toMatchObject({ status: "pending" });
    expect(current().busy).toBe(false);
    expect(current().error).toBeNull();
  });
});
