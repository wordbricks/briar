/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import type { OrganizationMember } from "../types";

const listChannels = vi.fn();
const loadChannel = vi.fn();
const loadChannelDelta = vi.fn();
const sendChannelMessage = vi.fn();
const acceptChannelProposal = vi.fn();
const acceptChannelExecutionProposal = vi.fn();
const acceptChannelSkillExecutionProposal = vi.fn();
const loadDashboard = vi.fn();
const listChannelMessages = vi.fn();
const createChannel = vi.fn();
const loadChannelMessageAttachment = vi.fn();
const loadOrganizationMembers = vi.fn();
const listOrganizationAgents = vi.fn();
const setChannelMember = vi.fn();
const setChannelAgent = vi.fn();
const toggleChannelMessageReaction = vi.fn();
const channelRealtime = vi.hoisted(() => ({
  listeners: new Set<(notification: { topic: "channels"; cursor: number }) => void>(),
}));

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  loadChannelDelta: (...args: unknown[]) => loadChannelDelta(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
  acceptChannelProposal: (...args: unknown[]) => acceptChannelProposal(...args),
  acceptChannelExecutionProposal: (...args: unknown[]) =>
    acceptChannelExecutionProposal(...args),
  acceptChannelSkillExecutionProposal: (...args: unknown[]) =>
    acceptChannelSkillExecutionProposal(...args),
  loadDashboard: (...args: unknown[]) => loadDashboard(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  createChannel: (...args: unknown[]) => createChannel(...args),
  loadChannelMessageAttachment: (...args: unknown[]) =>
    loadChannelMessageAttachment(...args),
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembers(...args),
  listOrganizationAgents: (...args: unknown[]) => listOrganizationAgents(...args),
  setChannelMember: (...args: unknown[]) => setChannelMember(...args),
  setChannelAgent: (...args: unknown[]) => setChannelAgent(...args),
  toggleChannelMessageReaction: (...args: unknown[]) =>
    toggleChannelMessageReaction(...args),
}));

vi.mock("../lib/channel-realtime", () => ({
  CHANNEL_REALTIME_FALLBACK_MS: 60_000,
  MAX_CHANNEL_DELTA_PAGES_PER_SYNC: 20,
  createChannelRealtimeTransport: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: (
      listener: (notification: { topic: "channels"; cursor: number }) => void,
    ) => {
      channelRealtime.listeners.add(listener);
      return () => channelRealtime.listeners.delete(listener);
    },
  }),
}));

vi.mock("@emoji-mart/data", () => ({ default: {} }));
vi.mock("@emoji-mart/react", () => ({
  default: () => null,
}));

const { Channels } = await import("./Channels");

const emitChannelChange = (cursor: number) => {
  for (const listener of channelRealtime.listeners) {
    listener({ topic: "channels", cursor });
  }
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const channel: ChannelSummary = {
  id: "channel-1",
  organizationId: "org-1",
  slug: "welcome",
  name: "Welcome",
  topic: "Say hello",
  visibility: "public",
  defaultProjectId: "project-1",
  archivedAt: null,
  memberCount: 2,
  agentCount: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const agent: ChannelAgentSummary = {
  agentId: "agent-1",
  handle: "honey",
  name: "Honey",
  avatar: null,
  provider: "claude",
  model: null,
  effort: null,
  skills: [],
  projectId: null,
  projectName: null,
  responsibility: "Writing partner",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const member: ChannelMember = {
  userId: "user-2",
  name: "Sam",
  email: "sam@example.com",
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const organizationMember: OrganizationMember = {
  userId: "user-3",
  name: "Alex",
  email: "alex@example.com",
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const availableAgent: ChannelAgentSummary = {
  agentId: "agent-2",
  handle: "reviewer",
  name: "Reviewer",
  avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
  provider: "codex",
  model: null,
  effort: null,
  skills: [],
  projectId: "project-1",
  projectName: "Briar",
  responsibility: "Review changes",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const message = (overrides: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: "message-1",
  channelId: "channel-1",
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body: "Hello team",
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  document: null,
  proposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
  ...overrides,
  executionProposal: overrides.executionProposal ?? null,
});

/**
 * React tracks the textarea value through its own setter, so a plain
 * assignment is invisible to it. Write through the native setter and place the
 * caret where a person typing would leave it.
 */
const typeInto = async (textarea: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
  await act(async () => {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Channels", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const render = async (
    messages: ChannelMessage[],
    requestedMessage?: { channelId: string; messageId: string; rootMessageId: string },
    onRequestedMessageOpen?: () => void,
    onCreateAgent?: () => void,
  ) => {
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages,
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    loadOrganizationMembers.mockResolvedValue([member, organizationMember]);
    listOrganizationAgents.mockResolvedValue({
      agents: [agent, availableAgent],
      canManage: true,
    });
    setChannelMember.mockResolvedValue({ members: [member] });
    setChannelAgent.mockResolvedValue({ agents: [agent] });
    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onCreateAgent={onCreateAgent}
          organizationId="org-1"
          requestedMessage={requestedMessage}
          token="token"
          onRequestedMessageOpen={onRequestedMessageOpen}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    channelRealtime.listeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("lists channels and their messages", async () => {
    await render([message()]);
    expect(container.querySelector(".channel-rail")).toBeNull();
    expect(container.textContent).toContain("Welcome");
    expect(container.textContent).toContain("Hello team");
    expect(container.querySelector(".channel-welcome")).not.toBeNull();
    expect(container.textContent).toContain("에이전트 만들기");
    expect(container.textContent).toContain("사람 추가");
    expect(container.querySelector(".channel-composer-shell")).not.toBeNull();
  });

  it("places the named Agent typing state inside its triggering message", async () => {
    const trigger = message({ body: "@honey 안녕" });
    await render([trigger]);
    loadChannelDelta.mockResolvedValueOnce({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [{
        id: "reply-1",
        agentId: agent.agentId,
        channelId: channel.id,
        triggerMessageId: trigger.id,
        parentMessageId: trigger.id,
        replyMessageId: "agent-message-1",
        status: "running",
        attempts: 1,
        error: null,
        createdAt: "2026-08-01T01:00:01.000Z",
        updatedAt: "2026-08-01T01:00:02.000Z",
      }],
    });

    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });

    const typing = container.querySelector(".channel-typing");
    expect(typing?.textContent).toContain("Honey님이 답변을 작성하고 있습니다");
    expect(typing?.closest(".channel-message")?.textContent)
      .toContain("@honey 안녕");
  });

  it("hides the persistent reply link when a message has no thread", async () => {
    const rootMessage = message({ id: "message-without-replies" });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage] });
    await render([rootMessage]);

    expect(container.querySelector(".channel-thread-link")).toBeNull();
    expect(container.textContent).not.toContain("스레드에서 답글");

    const hoverReply = container.querySelector<HTMLButtonElement>(
      ".channel-quick-reaction.open-thread",
    );
    expect(hoverReply).not.toBeNull();
    expect(hoverReply?.getAttribute("aria-label")).toBe("스레드에서 답글");

    await act(async () => {
      hoverReply?.click();
      await Promise.resolve();
    });
    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      rootMessage.id,
    );
  });

  it("runs a matched saved Skill only after exact Worker approval", async () => {
    const pending = {
      id: "skill-proposal-1",
      type: "request_agent_skill_execute" as const,
      status: "pending" as const,
      projectId: "project-1",
      agentId: "project-agent-1",
      agentName: "Release Agent",
      skillId: "skill-1",
      skillName: "iOS 배포",
      request: "TestFlight에 배포해 주세요.",
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedWorkerId: null,
      requestedWorkerLabel: null,
      resultSessionId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    const accepted = {
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: "worker-skill",
      requestedWorkerLabel: "Build Mac",
      resultSessionId: "session-skill",
    };
    const item = message({
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      skillExecutionProposal: pending,
    });
    loadDashboard.mockResolvedValue({
      runs: [],
      workers: [{
        id: "worker-skill",
        deviceId: "device-skill",
        ownerUserId: "owner",
        label: "Build Mac",
        agentProvider: "codex",
        providers: ["codex"],
        versions: {},
        state: "online",
        readiness: "available",
        acceptingWork: true,
        readinessDetail: null,
        capabilities: {},
        maxConcurrentSessions: 1,
        activeSessions: 0,
        availableSessions: 1,
        lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
        createdAt: "2026-08-11T00:00:00.000Z",
      }],
      executionPolicy: { selectionMode: "any", defaultWorkerId: null, allowedWorkerIds: [], updatedAt: null },
    });
    acceptChannelSkillExecutionProposal.mockResolvedValue({
      outcome: "accepted",
      proposal: accepted,
      projectId: "project-1",
      session: { id: "session-skill" },
    });
    await render([item]);

    expect(container.textContent).toContain("프로젝트 Agent Skill 실행 제안");
    expect(acceptChannelSkillExecutionProposal).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    expect(acceptChannelSkillExecutionProposal).not.toHaveBeenCalled();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="실행할 정확한 Worker"]',
      )?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '[role="option"][data-value="worker-skill"]',
      )?.click();
    });
    const finalApprove = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    await act(async () => finalApprove?.click());

    expect(loadDashboard).toHaveBeenCalledTimes(2);
    expect(acceptChannelSkillExecutionProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      pending,
      { workerId: "worker-skill" },
    );
    expect(container.textContent).toContain("session-skill");
  });

  it("establishes the initial change cursor before loading channel detail", async () => {
    let resolveList!: (value: { channels: ChannelSummary[]; cursor: number }) => void;
    const pendingList = new Promise<{ channels: ChannelSummary[]; cursor: number }>(
      (resolve) => { resolveList = resolve; },
    );
    listChannels.mockReturnValue(pendingList);
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [message()],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />,
      );
      await Promise.resolve();
    });
    expect(loadChannel).not.toHaveBeenCalled();

    await act(async () => {
      resolveList({ channels: [channel], cursor: 7 });
      await pendingList;
      await Promise.resolve();
    });
    expect(loadChannel).toHaveBeenCalledWith("token", "org-1", "channel-1");
  });

  it("shows reply participants, count, and last reply time", async () => {
    const lastReplyAt = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString();
    const rootMessage = message({
      id: "message-with-replies",
      replyCount: 5,
      lastReplyAt,
      replyAuthors: [
        {
          type: "user",
          id: "user-2",
          name: "Mina",
          email: "mina@example.com",
          image: "https://example.com/mina.png",
        },
        {
          type: "agent",
          id: "agent-1",
          name: "Honey",
          provider: "codex",
        },
      ],
    });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage] });
    await render([rootMessage]);

    const summary = container.querySelector<HTMLButtonElement>(
      ".conversation-reply-summary",
    );
    expect(summary?.textContent).toContain("답글 5개");
    expect(summary?.textContent).toContain("마지막 답글 3시간 전");
    expect(summary?.querySelectorAll(".conversation-reply-avatar")).toHaveLength(3);
    expect(summary?.querySelector(".conversation-reply-avatar img")?.getAttribute("src"))
      .toBe("https://example.com/mina.png");
    expect(summary?.querySelector(".conversation-reply-avatar.agent")).not.toBeNull();

    await act(async () => summary?.click());
    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      rootMessage.id,
    );
  });

  it("shows hover quick reactions and toggles an existing reaction chip", async () => {
    const reacted = message({
      id: "message-reacted",
      reactions: [
        { emoji: "👍", count: 1, userIds: ["user-1"] },
      ],
      proposal: {
        id: "proposal-reacted",
        actionType: "request_issue_create",
        status: "accepted",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Reaction-safe issue",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: "run-reacted",
      },
      executionProposal: {
        id: "execution-reacted",
        type: "request_issue_execute",
        status: "accepted",
        projectId: "project-1",
        runId: "run-reacted",
        title: "Reaction-safe issue",
        createdAt: "2026-08-11T00:00:00.000Z",
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedProvider: "codex",
        requestedModel: "gpt-5.6-sol",
        requestedEffort: "high",
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
    });
    // The reaction endpoint may return a stale full-message snapshot. Only its
    // reaction aggregate is authoritative for this mutation.
    toggleChannelMessageReaction.mockResolvedValue({
      message: message({
        id: reacted.id,
        reactions: [],
      }),
    });
    await render([reacted]);

    expect(container.querySelector(".channel-message-actions")).not.toBeNull();
    expect(container.querySelector(".channel-reaction-chip")).not.toBeNull();
    expect(container.querySelector(".channel-proposal-card")).not.toBeNull();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
    expect(container.textContent).toContain("React");

    const chip = container.querySelector<HTMLButtonElement>(
      ".channel-reaction-chip",
    );
    await act(async () => {
      chip?.click();
      await Promise.resolve();
    });
    expect(toggleChannelMessageReaction).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      reacted.id,
      "👍",
    );
    expect(container.querySelector(".channel-proposal-card")).not.toBeNull();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
  });

  it("preserves accepted Skill history when a reaction response is stale", async () => {
    const reacted = message({
      id: "message-skill-reacted",
      reactions: [{ emoji: "👍", count: 1, userIds: ["user-1"] }],
      skillExecutionProposal: {
        id: "skill-reacted",
        type: "request_agent_skill_execute",
        status: "accepted",
        projectId: "project-1",
        agentId: "project-agent-1",
        agentName: "Release Agent",
        skillId: "skill-release",
        skillName: "Deploy",
        request: "Deploy the app",
        provider: "codex",
        model: null,
        effort: null,
        createdAt: "2026-08-11T00:00:00.000Z",
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedWorkerId: "worker-1",
        requestedWorkerLabel: "Build Mac",
        resultSessionId: "session-1",
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
    });
    toggleChannelMessageReaction.mockResolvedValue({
      message: message({ id: reacted.id, reactions: [] }),
    });
    await render([reacted]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-reaction-chip")
        ?.click();
      await Promise.resolve();
    });
    expect(container.querySelector(".skill-execution-proposal-card"))
      .not.toBeNull();
    expect(container.textContent).toContain("session-1");
  });

  it("shares one dashboard lookup across accepted execution history cards", async () => {
    const acceptedExecution = (id: string, runId: string) => ({
      id,
      type: "request_issue_execute" as const,
      status: "accepted" as const,
      projectId: "project-1",
      runId,
      title: `Approved ${runId}`,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedProvider: "codex" as const,
      requestedModel: "gpt-5.6-sol",
      requestedEffort: "high" as const,
      requestedWorkerId: "worker-history",
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    });
    loadDashboard.mockResolvedValue({
      runs: [],
      workers: [{ id: "worker-history", label: "History Mac" }],
    });

    await render([
      message({
        id: "message-history-1",
        executionProposal: acceptedExecution("execution-history-1", "run-history-1"),
      }),
      message({
        id: "message-history-2",
        executionProposal: acceptedExecution("execution-history-2", "run-history-2"),
      }),
    ]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadDashboard).toHaveBeenCalledOnce();
    expect(container.textContent?.match(/History Mac/gu)).toHaveLength(2);
  });

  it("renders the emoji picker in a viewport portal outside the message scroller", async () => {
    await render([message()]);

    const openPicker = container.querySelector<HTMLButtonElement>(
      ".channel-quick-reaction.open-picker",
    );
    await act(async () => openPicker?.click());

    const picker = document.body.querySelector<HTMLElement>(
      ".channel-emoji-picker",
    );
    expect(picker).not.toBeNull();
    expect(container.contains(picker)).toBe(false);
    expect(openPicker?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.querySelector(".channel-emoji-picker")).toBeNull();
  });

  it("requests organization agent creation from the channel welcome action", async () => {
    const onCreateAgent = vi.fn();
    await render([], undefined, undefined, onCreateAgent);

    const createAgent = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".channel-welcome-actions button",
      ),
    ).find((button) => button.textContent?.includes("에이전트 만들기"));
    expect(createAgent?.disabled).toBe(false);

    await act(async () => createAgent?.click());
    expect(onCreateAgent).toHaveBeenCalledOnce();
  });

  it("opens a requested reply in its channel thread", async () => {
    const rootMessage = message({ id: "message-root", replyCount: 1 });
    const reply = message({
      id: "message-reply",
      parentMessageId: "message-root",
      body: "Requested reply",
    });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage, reply] });
    const onOpened = vi.fn();

    await render(
      [rootMessage],
      {
        channelId: channel.id,
        messageId: reply.id,
        rootMessageId: rootMessage.id,
      },
      onOpened,
    );

    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      rootMessage.id,
    );
    expect(container.textContent).toContain("Requested reply");
  });

  it("sends the picked Agent as a structured mention rather than parsing the text", async () => {
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-2", body: "@honey draft it" }),
      agentReplies: [],
    });

    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@hon");
    const suggestion = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".channel-mention-menu button",
      ),
    ].find((button) => button.textContent?.includes("@honey"));
    expect(suggestion).toBeDefined();
    await act(async () => {
      suggestion!.click();
    });
    const composerMention = container.querySelector<HTMLButtonElement>(
      ".channel-composer-field .conversation-mention-button[data-mention-handle='honey']",
    );
    expect(composerMention?.textContent).toBe("@honey");
    await act(async () => composerMention?.click());
    expect(
      document.body.querySelector<HTMLElement>(".profile-dialog")?.textContent,
    ).toContain("Honey");
    await act(async () => {
      container
        .querySelector("form.channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      expect.objectContaining({
        mentionedAgentIds: ["agent-1"],
        mentionedUserIds: [],
      }),
    );
  });

  it("opens candidates for @ and picks the highlighted mention with the keyboard", async () => {
    await render([message()]);
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@");

    expect(textarea.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll(".channel-mention-menu button")).toHaveLength(2);

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(textarea.value).toBe("@sam ");
    expect(textarea.getAttribute("aria-expanded")).toBe("false");
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("does not attach a mention whose handle was typed but never picked", async () => {
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-3" }),
      agentReplies: [],
    });

    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@honey are you there");
    expect(
      container.querySelector(".channel-composer-field .conversation-mention-button"),
    ).toBeNull();
    await act(async () => {
      container
        .querySelector("form.channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      expect.objectContaining({ mentionedAgentIds: [] }),
    );
  });

  it("opens the channel invite modal from the existing button and adds people and Agents", async () => {
    await render([message()]);
    loadChannel.mockResolvedValueOnce({
      channel: { ...channel, memberCount: 3, agentCount: 2 },
      members: [member, { ...organizationMember, role: "member" }],
      agents: [agent, availableAgent],
      messages: [message()],
    });

    const addPeople = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("사람 추가"));
    expect(addPeople).toBeDefined();
    await act(async () => {
      addPeople!.click();
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLElement>(".channel-invite-dialog");
    expect(dialog?.textContent).toContain("#Welcome에 멤버 추가");
    expect(dialog?.textContent).toContain("Alex");
    expect(dialog?.textContent).toContain("Reviewer");
    expect(dialog?.textContent).toContain("프로젝트 에이전트 · Briar");
    expect(
      dialog?.querySelector<HTMLImageElement>(
        '.channel-invite-avatar.agent img[src="data:image/png;base64,cHJvamVjdC1hdmF0YXI="]',
      ),
    ).not.toBeNull();
    expect(dialog?.textContent).not.toContain("Sam");

    const candidates = dialog!.querySelectorAll<HTMLButtonElement>(
      ".channel-invite-candidate",
    );
    await act(async () => {
      candidates[0]!.click();
      candidates[1]!.click();
    });
    const add = [...dialog!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "추가");
    await act(async () => {
      add!.click();
      await Promise.resolve();
    });

    expect(setChannelMember).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      "user-3",
      true,
    );
    expect(setChannelAgent).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      "agent-2",
      true,
    );
    expect(container.querySelector(".channel-invite-dialog")).toBeNull();
  });

  it("waits for every invite request before refreshing after a partial failure", async () => {
    await render([message()]);
    const loadCallsBeforeInvite = loadChannel.mock.calls.length;
    let finishAgentInvite!: () => void;
    setChannelMember.mockRejectedValueOnce(new Error("Member invite failed"));
    setChannelAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAgentInvite = () => resolve({ agents: [agent, availableAgent] });
        }),
    );
    loadChannel.mockResolvedValueOnce({
      channel: { ...channel, agentCount: 2 },
      members: [member],
      agents: [agent, availableAgent],
      messages: [message()],
    });

    const addPeople = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("사람 추가"));
    await act(async () => {
      addPeople!.click();
      await Promise.resolve();
    });
    const candidates = container.querySelectorAll<HTMLButtonElement>(
      ".channel-invite-candidate",
    );
    await act(async () => {
      candidates[0]!.click();
      candidates[1]!.click();
    });
    const add = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "추가");
    await act(async () => {
      add!.click();
      await Promise.resolve();
    });

    expect(loadChannel).toHaveBeenCalledTimes(loadCallsBeforeInvite);

    await act(async () => {
      finishAgentInvite();
      await Promise.resolve();
    });

    expect(loadChannel).toHaveBeenCalledTimes(loadCallsBeforeInvite + 1);
    expect(container.querySelector(".channel-invite-dialog")).not.toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Member invite failed",
    );
  });

  it("opens the invite modal for /invite without sending a message", async () => {
    await render([message()]);
    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "/invite");
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.querySelector(".channel-invite-dialog")).not.toBeNull();
    expect(textarea.value).toBe("");
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });

  it("pastes an image, previews it, and sends it as multipart message data", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:channel-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-image", body: "Image" }),
      agentReplies: [],
    });
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const textarea = container.querySelector("textarea")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });

    await act(async () => textarea.dispatchEvent(paste));

    expect(paste.defaultPrevented).toBe(true);
    expect(container.querySelector(".channel-image-draft img")).not.toBeNull();
    await act(async () => {
      container
        .querySelector("form.channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      expect.objectContaining({
        attachments: [image],
        attachmentReferences: [expect.any(String)],
        body: expect.stringContaining("briar-attachment://"),
      }),
    );
  });

  it("accepts a dropped image in the composer", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:dropped-channel-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    await render([message()]);
    const image = new File(["image"], "dropped.png", { type: "image/png" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });

    await act(async () =>
      container.querySelector("form.channel-composer")!.dispatchEvent(drop),
    );

    expect(drop.defaultPrevented).toBe(true);
    expect(container.querySelector(".channel-image-draft img")).not.toBeNull();
  });

  it("accepts an issue proposal against the channel's default project", async () => {
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [
        message({
          id: "message-4",
          author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
          proposal: {
            id: "proposal-1",
            actionType: "request_issue_create",
            status: "pending",
            projectId: null,
            payload: {
              issue: {
                title: "Improve onboarding",
                description: "Make the first-run flow clearer.",
                priority: 2,
                status: "backlog",
              },
            },
            resultRunId: null,
          },
        }),
      ],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    let resolveAcceptance!: (value: {
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }) => void;
    const pendingAcceptance = new Promise<{
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }>((resolve) => { resolveAcceptance = resolve; });
    acceptChannelProposal.mockReturnValue(pendingAcceptance);

    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          projects={[
            {
              id: "project-1",
              name: "Briar",
              organizationId: "org-1",
            },
          ]}
          token="token"
          onIssueCreated={onIssueCreated}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const accept = container.querySelector<HTMLButtonElement>(
      ".channel-proposal-card button",
    );
    expect(accept).not.toBeNull();
    await act(async () => {
      accept!.click();
      await Promise.resolve();
    });

    expect(accept!.textContent).toContain("이슈 생성 중");
    expect(accept!.querySelector(".spin")).not.toBeNull();
    expect(accept!.getAttribute("aria-busy")).toBe("true");
    expect(onIssueCreated).not.toHaveBeenCalled();
    await act(async () => {
      resolveAcceptance({
        outcome: "accepted",
        projectId: "project-1",
        resultRunId: "run-9",
      });
      await pendingAcceptance;
    });

    expect(acceptChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      "proposal-1",
      "project-1",
    );
    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Improve onboarding");
    expect(container.textContent).toContain("우선순위 P2");
    expect(container.textContent).toContain("실행하지 않음");
    expect(container.textContent).toContain("대상 프로젝트: Briar");
    expect(container.querySelector(".channel-proposal-card select")).toBeNull();
    expect(container.textContent).toContain("이슈 보기");
  });

  it("keeps a server-returned execution follow-up for a legacy create proposal", async () => {
    const onIssueCreated = vi.fn();
    const createProposal = {
      id: "proposal-create-execute",
      actionType: "request_issue_create" as const,
      status: "pending" as const,
      projectId: "project-1",
      payload: {
        issue: {
          title: "Create before execution",
          description: "Keep both approval records.",
          priority: 2,
          status: "backlog" as const,
        },
      },
      resultRunId: null,
    };
    const executionProposal = {
      id: "55555555-5555-4555-8555-555555555555",
      type: "request_issue_execute" as const,
      status: "pending" as const,
      projectId: "project-1",
      runId: "66666666-6666-4666-8666-666666666666",
      title: "Create before execution",
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: "77777777-7777-4777-8777-777777777777",
      delegatedByAgentName: "Bumble",
    };
    const initial = message({
      id: "message-create-execute",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      proposal: createProposal,
      executionProposal: null,
    });
    const materialized: ChannelMessage = {
      ...initial,
      proposal: {
        ...createProposal,
        status: "accepted",
        resultRunId: executionProposal.runId,
      },
      executionProposal,
    };
    const worker = {
      id: "worker-execution",
      deviceId: "device-execution",
      ownerUserId: "owner",
      label: "Execution Mac",
      agentProvider: "codex" as const,
      providers: ["codex" as const],
      versions: {},
      state: "online" as const,
      readiness: "available" as const,
      acceptingWork: true,
      readinessDetail: null,
      capabilities: {},
      maxConcurrentSessions: 1,
      activeSessions: 0,
      availableSessions: 1,
      lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
      createdAt: "2026-08-11T00:00:00.000Z",
    };
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [initial],
      })
      .mockResolvedValue({
        channel,
        members: [member],
        agents: [agent],
        messages: [materialized],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-1",
      resultRunId: executionProposal.runId,
      executionProposal,
    });
    loadDashboard.mockResolvedValue({
      runs: [{
        id: executionProposal.runId,
        title: executionProposal.title,
        status: "backlog",
        executionReadiness: "ready",
        claimedBy: null,
        claimedAt: null,
        workerId: null,
        dispatchedAt: null,
        requestedByUserId: null,
        dispatchMode: null,
      }],
      workers: [worker],
    });
    acceptChannelExecutionProposal.mockResolvedValue({
      proposal: {
        ...executionProposal,
        status: "accepted",
        acceptedAt: "2026-08-11T00:05:00.000Z",
        requestedProvider: "codex",
      },
      outcome: "accepted",
      projectId: "project-1",
      runId: executionProposal.runId,
      dispatch: { outcome: "dispatched" },
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onIssueCreated={onIssueCreated}
          organizationId="org-1"
          projects={[{ id: "project-1", name: "Briar", organizationId: "org-1" }]}
          token="token"
        />,
      );
    });
    await act(async () => { await Promise.resolve(); });

    expect(acceptChannelExecutionProposal).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("승인되어 이슈가 생성");
    expect(container.textContent).toContain("이슈 실행 제안");
    expect(container.textContent).toContain("Organization Agent Bumble의 위임");
    expect(acceptChannelExecutionProposal).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    expect(acceptChannelExecutionProposal).not.toHaveBeenCalled();
    const finalApprove = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => finalApprove?.click());

    expect(acceptChannelExecutionProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      executionProposal.id,
      { provider: "codex", model: null, effort: null, workerId: null },
    );
    expect(onIssueCreated).not.toHaveBeenCalled();
  });

  it("keeps a newer transferred proposal over a delayed approval response", async () => {
    vi.useFakeTimers();
    const pendingProposal = message({
      id: "message-delayed-approval",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      proposal: {
        id: "proposal-delayed-approval",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Transfer-safe approval",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    const transferredProposal: ChannelMessage = {
      ...pendingProposal,
      proposal: {
        ...pendingProposal.proposal!,
        status: "accepted",
        projectId: "project-2",
        resultRunId: "run-new",
      },
    };
    let resolveAccept!: (value: {
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }) => void;
    const pendingAccept = new Promise<{
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }>((resolve) => { resolveAccept = resolve; });
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [pendingProposal],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [transferredProposal],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);

    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onIssueCreated={onIssueCreated}
          organizationId="org-1"
          projects={[
            { id: "project-1", name: "Briar", organizationId: "org-1" },
            { id: "project-2", name: "Sprout", organizationId: "org-1" },
          ]}
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });
    await act(async () => {
      resolveAccept({
        outcome: "accepted",
        projectId: "project-1",
        resultRunId: "run-stale",
      });
      await pendingAccept;
      await Promise.resolve();
    });

    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("대상 프로젝트: Sprout");
  });

  it("still shows the accepted issue when an unchanged delta arrives", async () => {
    vi.useFakeTimers();
    const pendingProposal = message({
      id: "message-unchanged-approval",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      proposal: {
        id: "proposal-unchanged-approval",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Unchanged proposal",
            description: null,
            priority: 3,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    let resolveAccept!: (value: {
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }) => void;
    const pendingAccept = new Promise<{
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }>((resolve) => { resolveAccept = resolve; });
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [pendingProposal],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [pendingProposal],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onIssueCreated={onIssueCreated}
          organizationId="org-1"
          projects={[
            { id: "project-1", name: "Briar", organizationId: "org-1" },
          ]}
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });
    await act(async () => {
      resolveAccept({
        outcome: "accepted",
        projectId: "project-1",
        resultRunId: "run-current",
      });
      await pendingAccept;
      await Promise.resolve();
    });

    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("이슈 보기");
  });

  it("refreshes an intermediate reservation delta before showing the issue", async () => {
    vi.useFakeTimers();
    const pendingProposal = message({
      id: "message-reservation-approval",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      proposal: {
        id: "proposal-reservation-approval",
        actionType: "request_issue_create",
        status: "pending",
        projectId: null,
        payload: {
          issue: {
            title: "Reserved approval",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    const reservedProposal: ChannelMessage = {
      ...pendingProposal,
      proposal: {
        ...pendingProposal.proposal!,
        projectId: "project-1",
      },
    };
    const acceptedProposal: ChannelMessage = {
      ...reservedProposal,
      proposal: {
        ...reservedProposal.proposal!,
        status: "accepted",
        resultRunId: "run-reserved",
      },
    };
    let resolveAccept!: (value: {
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }) => void;
    const pendingAccept = new Promise<{
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }>((resolve) => { resolveAccept = resolve; });
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [pendingProposal],
      })
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [acceptedProposal],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [reservedProposal],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onIssueCreated={onIssueCreated}
          organizationId="org-1"
          projects={[
            { id: "project-1", name: "Briar", organizationId: "org-1" },
          ]}
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });
    await act(async () => {
      resolveAccept({
        outcome: "accepted",
        projectId: "project-1",
        resultRunId: "run-reserved",
      });
      await pendingAccept;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadChannel).toHaveBeenCalledTimes(2);
    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("이슈 보기");
  });

  it("does not refresh or navigate an approval after the channel changes", async () => {
    vi.useFakeTimers();
    const otherChannel: ChannelSummary = {
      ...channel,
      id: "channel-2",
      slug: "other",
      name: "Other",
      defaultProjectId: "project-2",
    };
    const pendingProposal = message({
      id: "message-channel-switch",
      proposal: {
        id: "proposal-channel-switch",
        actionType: "request_issue_create",
        status: "pending",
        projectId: null,
        payload: {
          issue: {
            title: "Stay in the original channel",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    const reservation: ChannelMessage = {
      ...pendingProposal,
      proposal: { ...pendingProposal.proposal!, projectId: "project-1" },
    };
    const otherMessage = message({
      id: "message-other-channel",
      channelId: otherChannel.id,
      body: "Current channel remains visible",
    });
    let resolveAccept!: (value: {
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }) => void;
    const pendingAccept = new Promise<{
      outcome: "accepted";
      projectId: string;
      resultRunId: string;
    }>((resolve) => { resolveAccept = resolve; });
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({
      channels: [channel, otherChannel],
      cursor: 7,
    });
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [pendingProposal],
      })
      .mockResolvedValueOnce({
        channel: otherChannel,
        members: [member],
        agents: [agent],
        messages: [otherMessage],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [reservation],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    const channelsProps = {
      channels: [channel, otherChannel],
      currentUserId: "user-1",
      onChannelSelect: () => undefined,
      onChannelsChange: () => undefined,
      onIssueCreated,
      organizationId: "org-1",
      projects: [
        { id: "project-1", name: "Briar", organizationId: "org-1" },
        { id: "project-2", name: "Other", organizationId: "org-1" },
      ],
      token: "token",
    };
    await act(async () => {
      root.render(<Channels {...channelsProps} activeChannelId="channel-1" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Channels {...channelsProps} activeChannelId="channel-2" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveAccept({
        outcome: "accepted",
        projectId: "project-1",
        resultRunId: "run-old-channel",
      });
      await pendingAccept;
      await Promise.resolve();
    });

    expect(loadChannel).toHaveBeenCalledTimes(2);
    expect(onIssueCreated).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current channel remains visible");
  });

  it("drops a delayed approval failure after the channel changes", async () => {
    const otherChannel: ChannelSummary = {
      ...channel,
      id: "channel-2",
      slug: "other",
      name: "Other",
      defaultProjectId: "project-2",
    };
    const pendingProposal = message({
      id: "message-old-failure",
      proposal: {
        id: "proposal-old-failure",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Old channel proposal",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    const currentProposal = message({
      id: "message-current-proposal",
      channelId: otherChannel.id,
      proposal: {
        id: "proposal-current",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-2",
        payload: {
          issue: {
            title: "Current channel proposal",
            description: null,
            priority: 3,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    let rejectAccept!: (reason: Error) => void;
    const pendingAccept = new Promise<never>((_resolve, reject) => {
      rejectAccept = reject;
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    listChannels.mockResolvedValue({ channels: [channel, otherChannel], cursor: 7 });
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [pendingProposal],
      })
      .mockResolvedValueOnce({
        channel: otherChannel,
        members: [member],
        agents: [agent],
        messages: [currentProposal],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    const props = {
      channels: [channel, otherChannel],
      currentUserId: "user-1",
      onChannelSelect: () => undefined,
      onChannelsChange: () => undefined,
      organizationId: "org-1",
      projects: [
        { id: "project-1", name: "Briar", organizationId: "org-1" },
        { id: "project-2", name: "Other", organizationId: "org-1" },
      ],
      token: "token",
    };
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={channel.id} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={otherChannel.id} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.disabled,
    ).toBe(false);

    await act(async () => {
      rejectAccept(new Error("stale approval failed"));
      await pendingAccept.catch(() => undefined);
    });

    expect(container.textContent).toContain("Current channel proposal");
    expect(container.textContent).not.toContain("stale approval failed");
    expect(container.querySelector(".channel-error")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.disabled,
    ).toBe(false);
  });

  it("does not navigate after approval when the channel changes", async () => {
    const otherChannel: ChannelSummary = {
      ...channel,
      id: "channel-2",
      slug: "other",
      name: "Other",
      defaultProjectId: "project-2",
    };
    const proposal = message({
      id: "message-navigation-failure",
      proposal: {
        id: "proposal-navigation-failure",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Navigate after approval",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    const onIssueCreated = vi.fn();
    listChannels.mockResolvedValue({ channels: [channel, otherChannel], cursor: 7 });
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [proposal],
      })
      .mockResolvedValueOnce({
        channel: otherChannel,
        members: [member],
        agents: [agent],
        messages: [message({
          id: "message-current-after-navigation",
          channelId: otherChannel.id,
          body: "Current channel remains clean",
        })],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-1",
      resultRunId: "run-navigation",
    });
    const props = {
      channels: [channel, otherChannel],
      currentUserId: "user-1",
      onChannelSelect: () => undefined,
      onChannelsChange: () => undefined,
      onIssueCreated,
      organizationId: "org-1",
      projects: [
        { id: "project-1", name: "Briar", organizationId: "org-1" },
        { id: "project-2", name: "Other", organizationId: "org-1" },
      ],
      token: "token",
    };
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={channel.id} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    expect(onIssueCreated).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={otherChannel.id} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Current channel remains clean");
    expect(container.querySelector(".channel-error")).toBeNull();
  });

  it("upserts authoritative archived detail before enabling approval", async () => {
    const archivedChannel: ChannelSummary = {
      ...channel,
      archivedAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    };
    const proposal = message({
      id: "message-detail-archive",
      proposal: {
        id: "proposal-detail-archive",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Archive-aware proposal",
            description: null,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel: archivedChannel,
      members: [member],
      agents: [agent],
      messages: [proposal],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    const onChannelSelect = vi.fn();

    function StatefulChannels() {
      const [catalog, setCatalog] = useState<ChannelSummary[]>([channel]);
      return (
        <Channels
          activeChannelId={channel.id}
          channels={catalog}
          currentUserId="user-1"
          onChannelSelect={onChannelSelect}
          onChannelsChange={setCatalog}
          organizationId="org-1"
          projects={[
            { id: "project-1", name: "Briar", organizationId: "org-1" },
          ]}
          token="token"
        />
      );
    }

    await act(async () => {
      root.render(<StatefulChannels />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLButtonElement>(
          ".channel-proposal-approve-button",
        )?.disabled,
      ).toBe(true);
    });
    container.querySelector<HTMLButtonElement>(
      ".channel-proposal-approve-button",
    )!.click();
    expect(acceptChannelProposal).not.toHaveBeenCalled();
  });

  it("shows the complete proposal and disables approval in an archived channel", async () => {
    const archivedChannel = {
      ...channel,
      archivedAt: "2026-08-10T00:00:00.000Z",
    };
    const finalClause = "Final clause that must remain visible before approval.";
    const proposalMessage = message({
      id: "message-archived-proposal",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude" },
      proposal: {
        id: "proposal-archived",
        actionType: "request_issue_create",
        status: "pending",
        projectId: "project-1",
        payload: {
          issue: {
            title: "Review the complete issue",
            description: `First line\nSecond line\nThird line\nFourth line\n${finalClause}`,
            priority: 2,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    listChannels.mockResolvedValue({ channels: [archivedChannel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel: archivedChannel,
      members: [member],
      agents: [agent],
      messages: [proposalMessage],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId={archivedChannel.id}
          channels={[archivedChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          projects={[{ id: "project-1", name: "Briar", organizationId: "org-1" }]}
          token="token"
        />,
      );
    });
    await act(async () => Promise.resolve());

    expect(
      container.querySelector(".channel-proposal-description")?.textContent,
    ).toContain(finalClause);
    const showDescription = container.querySelector<HTMLButtonElement>(
      ".channel-proposal-description-toggle",
    )!;
    expect(showDescription.getAttribute("aria-expanded")).toBe("false");
    await act(async () => showDescription.click());
    expect(showDescription.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector(".channel-proposal-description")?.classList,
    ).toContain("is-expanded");
    const approve = container.querySelector<HTMLButtonElement>(
      ".channel-proposal-approve-button",
    )!;
    expect(approve.disabled).toBe(true);
    approve.click();
    expect(acceptChannelProposal).not.toHaveBeenCalled();
  });

  it("requires a project selection for an organization proposal", async () => {
    const commonChannel = { ...channel, defaultProjectId: null };
    const proposalMessage = message({
      id: "message-project-choice",
      author: {
        type: "agent",
        id: "agent-1",
        name: "Honey",
        provider: "claude",
      },
      proposal: {
        id: "proposal-project-choice",
        actionType: "request_issue_create",
        status: "pending",
        projectId: null,
        payload: {
          issue: {
            title: "Route this issue",
            description: null,
            priority: null,
            status: "backlog",
          },
        },
        resultRunId: null,
      },
    });
    listChannels.mockResolvedValue({ channels: [commonChannel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel: commonChannel,
      members: [member],
      agents: [agent],
      messages: [proposalMessage],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 7,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-2",
      resultRunId: "run-project-2",
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId="channel-1"
          channels={[commonChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          projects={[
            { id: "project-1", name: "Briar", organizationId: "org-1" },
            { id: "project-2", name: "Sprout", organizationId: "org-1" },
            { id: "project-x", name: "Other", organizationId: "org-2" },
          ]}
          token="token"
        />,
      );
    });
    await act(async () => Promise.resolve());

    const card = container.querySelector<HTMLElement>(".channel-proposal-card")!;
    const select = card.querySelector<HTMLSelectElement>("select")!;
    const approve = card.querySelector<HTMLButtonElement>("button")!;
    expect(approve.disabled).toBe(true);
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "프로젝트 선택",
      "Briar",
      "Sprout",
    ]);

    await act(async () => {
      select.value = "project-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(approve.disabled).toBe(false);
    expect(card.textContent).toContain("대상 프로젝트: Sprout");
    await act(async () => approve.click());

    expect(acceptChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      "proposal-project-choice",
      "project-2",
    );
  });

  it("shows a plan document card with its organization scope", async () => {
    await render([
      message({
        id: "message-5",
        document: {
          messageId: "message-5",
          title: "Onboarding plan",
          projectId: null,
        },
      }),
    ]);
    const card = container.querySelector(".channel-document-card");
    expect(card?.textContent).toContain("Onboarding plan");
    expect(card?.textContent).toContain("조직 문서");
  });

  it("scrolls the thread panel to the bottom when a thread reply is sent", async () => {
    const rootMessage = message({
      id: "message-root",
      replyCount: 1,
      parentMessageId: null,
    });
    const existingReply = message({
      id: "message-reply-1",
      parentMessageId: "message-root",
      body: "Earlier reply",
    });
    const sentReply = message({
      id: "message-reply-2",
      parentMessageId: "message-root",
      body: "Newest reply",
    });
    listChannelMessages.mockResolvedValue({
      messages: [rootMessage, existingReply],
    });
    sendChannelMessage.mockResolvedValue({
      message: sentReply,
      agentReplies: [],
    });
    await render([rootMessage]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".conversation-reply-summary",
      )?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const threadPanel = container.querySelector(".channel-thread");
    expect(threadPanel).not.toBeNull();
    const threadScroller = threadPanel?.querySelector(".channel-messages");
    expect(threadScroller).not.toBeNull();
    const endSentinel = threadScroller?.lastElementChild as HTMLElement | null;
    expect(endSentinel).not.toBeNull();
    const scrollIntoView = vi.fn();
    if (endSentinel) {
      endSentinel.scrollIntoView = scrollIntoView;
    }
    scrollIntoView.mockClear();

    const threadComposer = threadPanel?.querySelector<HTMLTextAreaElement>(
      "form.channel-composer textarea",
    );
    expect(threadComposer).not.toBeNull();
    await typeInto(threadComposer!, "Newest reply");
    await act(async () => {
      threadPanel
        ?.querySelector("form.channel-composer")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      expect.objectContaining({
        body: "Newest reply",
        parentMessageId: "message-root",
      }),
    );
    expect(threadPanel?.textContent).toContain("Newest reply");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end" });
  });

  it("resizes the thread panel with the separator", async () => {
    listChannelMessages.mockResolvedValue({ messages: [] });
    await render([
      message({
        id: "message-6",
        replyCount: 1,
        parentMessageId: null,
      }),
    ]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".conversation-reply-summary",
      )?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const resizer = container.querySelector<HTMLElement>(
      ".channel-thread-resizer",
    );
    expect(resizer).not.toBeNull();
    expect(resizer?.getAttribute("role")).toBe("separator");
    expect(resizer?.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizer?.getAttribute("aria-valuemin")).toBe("30");
    expect(resizer?.getAttribute("aria-valuemax")).toBe("65");
    expect(resizer?.getAttribute("aria-valuenow")).toBe("42");
    const channels = container.querySelector<HTMLElement>(".channels");
    expect(
      channels?.style.getPropertyValue("--channel-thread-width"),
    ).toBe("");
    expect(container.querySelector(".channel-thread")).not.toBeNull();

    await act(async () => {
      resizer?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      );
    });
    expect(resizer?.getAttribute("aria-valuenow")).toBe("47");
    expect(
      channels?.style.getPropertyValue("--channel-thread-width"),
    ).toBe("47%");
    expect(
      window.localStorage.getItem("briar.settings.channel-thread-width.v1"),
    ).toBe("47");

    await act(async () => {
      resizer?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      );
    });
    expect(resizer?.getAttribute("aria-valuenow")).toBe("30");

    await act(async () => {
      resizer?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
    });
    expect(resizer?.getAttribute("aria-valuenow")).toBe("65");

    await act(async () => {
      resizer?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
      );
    });
    expect(resizer?.getAttribute("aria-valuenow")).toBe("60");
    expect(
      channels?.style.getPropertyValue("--channel-thread-width"),
    ).toBe("60%");

    window.localStorage.removeItem("briar.settings.channel-thread-width.v1");
  });
});
