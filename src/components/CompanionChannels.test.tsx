/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import { requestMobileNavigationBack } from "../lib/mobile-navigation";

const listChannels = vi.fn();
const loadChannel = vi.fn();
const loadChannelDelta = vi.fn();
const listChannelMessages = vi.fn();
const sendChannelMessage = vi.fn();
const acceptChannelProposal = vi.fn();
const acceptChannelExecutionProposal = vi.fn();
const acceptChannelSkillExecutionProposal = vi.fn();
const loadDashboard = vi.fn();
const toggleChannelMessageReaction = vi.fn();
const channelRealtime = vi.hoisted(() => ({
  listeners: new Set<(notification: { topic: "channels"; cursor: number }) => void>(),
}));

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  loadChannelDelta: (...args: unknown[]) => loadChannelDelta(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
  acceptChannelProposal: (...args: unknown[]) => acceptChannelProposal(...args),
  acceptChannelExecutionProposal: (...args: unknown[]) =>
    acceptChannelExecutionProposal(...args),
  acceptChannelSkillExecutionProposal: (...args: unknown[]) =>
    acceptChannelSkillExecutionProposal(...args),
  loadDashboard: (...args: unknown[]) => loadDashboard(...args),
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

const { CompanionChannels } = await import("./CompanionChannels");

const emitChannelChange = (cursor: number) => {
  for (const listener of channelRealtime.listeners) {
    listener({ topic: "channels", cursor });
  }
};

const channel = (
  id: string,
  name: string,
  defaultProjectId: string | null,
): ChannelSummary => ({
  id,
  organizationId: "org-1",
  slug: name.toLowerCase().replace(/\s+/gu, "-"),
  name,
  topic: null,
  visibility: "public",
  defaultProjectId,
  archivedAt: null,
  memberCount: 2,
  agentCount: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const message = (id: string, body: string, replyCount = 0): ChannelMessage => ({
  id,
  channelId: "c-common",
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body,
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount,
  lastReplyAt: null,
  document: null,
  proposal: null,
  executionProposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
});

const agentReply = (
  status: ChannelAgentReply["status"],
  channelId = "c-common",
  error: string | null = null,
): ChannelAgentReply => ({
  id: `reply-${channelId}`,
  agentId: "agent-1",
  channelId,
  triggerMessageId: "m-1",
  parentMessageId: "m-1",
  replyMessageId: "m-agent",
  status,
  attempts: status === "queued" ? 0 : 1,
  error,
  createdAt: "2026-08-01T01:00:01.000Z",
  updatedAt: "2026-08-01T01:00:02.000Z",
});

const emptyDelta = (cursor: number) => ({
  cursor,
  hasMore: false,
  channels: [],
  removedChannelIds: [],
  messages: [],
  removedMessageIds: [],
  agentReplies: [],
});

const member: ChannelMember = {
  userId: "user-2",
  name: "Sam",
  email: "sam@example.com",
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
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

describe("CompanionChannels", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const render = async (
    onIssueOpen?: (projectId: string, runId: string) => void | Promise<void>,
    requestedMessage?: { channelId: string; messageId: string; rootMessageId: string },
    onRequestedMessageOpen?: () => void,
    onSkillSessionAccepted?: (session: AutoHuntSession) => void,
  ) => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <CompanionChannels
            activeProjectId="project-1"
            currentUserId="user-1"
            organizationId="org-1"
            projects={[
              { id: "project-1", name: "Briar" },
              { id: "project-2", name: "Sprout" },
            ]}
            token="token"
            onIssueOpen={onIssueOpen}
            requestedMessage={requestedMessage}
            onRequestedMessageOpen={onRequestedMessageOpen}
            onSkillSessionAccepted={onSkillSessionAccepted}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    channelRealtime.listeners.clear();
    listChannels.mockResolvedValue({
      channels: [
        channel("c-other", "Sprout talk", "project-2"),
        channel("c-current", "Briar dev", "project-1"),
        channel("c-common", "Welcome", null),
      ],
      cursor: 1,
    });
    loadChannelDelta.mockResolvedValue(emptyDelta(1));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("groups channels as common, current project, then other projects", async () => {
    await render();

    const dividers = [
      ...container.querySelectorAll(".companion-channel-divider"),
    ].map((node) => node.textContent);
    // jsdom reports an English navigator locale, so the provider renders English.
    expect(dividers).toEqual(["Common channels", "Briar", "Sprout"]);

    const names = [
      ...container.querySelectorAll(".companion-channel-group button span"),
    ].map((node) => node.textContent);
    expect(names).toEqual(["Welcome", "Briar dev", "Sprout talk"]);
  });

  it("opens a channel thread and unwinds each level through mobile back", async () => {
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [message("m-1", "Hello team", 2)],
    });
    listChannelMessages.mockResolvedValue({
      messages: [message("m-1", "Hello team", 2), message("m-2", "On it")],
    });
    await render();

    const channelButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      ),
    ].find((button) => button.textContent?.includes("Welcome"));
    await act(async () => {
      channelButton!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(loadChannel).toHaveBeenCalledWith("token", "org-1", "c-common");
    expect(container.textContent).toContain("Hello team");
    expect(
      container.querySelector(".companion-channel-bar-identity")?.textContent,
    ).toBe("WelcomeMembers 2 • Agents 1");
    expect(
      container.querySelector(".companion-channel-bar-status"),
    ).toBeNull();

    const messageButton = container.querySelector<HTMLButtonElement>(
      ".companion-channel-message-button",
    );
    await act(async () => {
      messageButton!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-common",
      "m-1",
    );
    expect(container.textContent).toContain("On it");
    expect(container.textContent).toContain("Thread");

    let handled = false;
    await act(async () => {
      handled = requestMobileNavigationBack();
      await Promise.resolve();
    });
    expect(handled).toBe(true);
    expect(
      container.querySelector(".companion-channel-bar-identity")?.textContent,
    ).toBe("WelcomeMembers 2 • Agents 1");

    await act(async () => {
      handled = requestMobileNavigationBack();
      await Promise.resolve();
    });
    expect(handled).toBe(true);
    expect(container.querySelector(".companion-channel-bar")).toBeNull();
    expect(container.textContent).toContain("Common channels");
  });

  it("preserves materialized approvals when a reaction returns a stale message", async () => {
    const item = message("m-reaction-safe", "승인 기록이 있는 메시지");
    item.reactions = [{ emoji: "👍", count: 1, userIds: ["user-1"] }];
    item.proposal = {
      id: "proposal-reaction-safe",
      actionType: "request_issue_create",
      status: "accepted",
      projectId: "project-1",
      payload: {
        issue: {
          title: "Companion reaction-safe issue",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
      resultRunId: "run-reaction-safe",
    };
    item.executionProposal = {
      id: "execution-reaction-safe",
      type: "request_issue_execute",
      status: "accepted",
      projectId: "project-1",
      runId: "run-reaction-safe",
      title: "Companion reaction-safe issue",
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedProvider: "codex",
      requestedModel: "gpt-5.6-sol",
      requestedEffort: "high",
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [agent],
      messages: [item],
    });
    toggleChannelMessageReaction.mockResolvedValue({
      message: message(item.id, item.body),
    });
    await render();
    const channelButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      ),
    ].find((button) => button.textContent?.includes("Welcome"));
    await act(async () => {
      channelButton!.click();
      await Promise.resolve();
    });

    expect(container.querySelector(".companion-channel-proposal")).not.toBeNull();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-reaction-chip")?.click();
      await Promise.resolve();
    });

    expect(toggleChannelMessageReaction).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-common",
      item.id,
      "👍",
    );
    expect(container.querySelector(".companion-channel-proposal")).not.toBeNull();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
  });

  it("preserves accepted Skill history when a mobile reaction response is stale", async () => {
    const item = message("m-skill-reaction-safe", "Skill approval history");
    item.reactions = [{ emoji: "👍", count: 1, userIds: ["user-1"] }];
    item.skillExecutionProposal = {
      id: "skill-reaction-safe",
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
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [agent],
      messages: [item],
    });
    toggleChannelMessageReaction.mockResolvedValue({
      message: message(item.id, item.body),
    });
    await render();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      )].find((button) => button.textContent?.includes("Welcome"))?.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-reaction-chip")
        ?.click();
      await Promise.resolve();
    });
    expect(container.querySelector(".skill-execution-proposal-card"))
      .not.toBeNull();
    expect(container.textContent).toContain("session-1");
  });

  it("applies pending and completed Agent replies after realtime notifications", async () => {
    vi.useFakeTimers();
    const initial = message("m-1", "Please investigate");
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [agent],
      messages: [initial],
    });
    listChannelMessages.mockResolvedValue({ messages: [initial] });
    let resolveFirst!: (value: unknown) => void;
    loadChannelDelta
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...emptyDelta(3),
        messages: [
          {
            ...initial,
            replyCount: 1,
            lastReplyAt: "2026-08-01T01:00:03.000Z",
          },
          {
            ...message("m-agent", "Investigation complete"),
            parentMessageId: "m-1",
            author: {
              type: "agent",
              id: "agent-1",
              name: "Honey",
              provider: "claude",
            },
          },
          {
            ...message("m-other", "Other channel result"),
            channelId: "c-other",
          },
        ],
        agentReplies: [
          agentReply("completed"),
          agentReply("running", "c-other"),
        ],
      });
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
      await Promise.resolve();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".companion-channel-message-button")!
        .click();
      await Promise.resolve();
    });

    await act(async () => {
      emitChannelChange(2);
      await Promise.resolve();
    });
    expect(loadChannelDelta).toHaveBeenCalledWith(
      "token",
      "org-1",
      1,
      expect.any(AbortSignal),
    );
    resolveFirst({
      ...emptyDelta(2),
      agentReplies: [agentReply("running")],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(".companion-channel-typing")?.textContent)
      .toContain("An agent is writing a reply");

    await act(async () => {
      emitChannelChange(3);
      await Promise.resolve();
    });
    expect(loadChannelDelta).toHaveBeenLastCalledWith(
      "token",
      "org-1",
      2,
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("Investigation complete");
    expect(container.textContent).not.toContain("Other channel result");
    expect(container.querySelector(".companion-channel-typing")).toBeNull();
  });

  it("does not advance the delta cursor behind a pending full channel load", async () => {
    vi.useFakeTimers();
    const initial = message("m-1", "Snapshot question");
    let resolveChannel!: (value: unknown) => void;
    loadChannel.mockReturnValue(
      new Promise((resolve) => {
        resolveChannel = resolve;
      }),
    );
    loadChannelDelta.mockResolvedValue({
      ...emptyDelta(2),
      messages: [
        { ...initial, replyCount: 1 },
        {
          ...message("m-agent", "Newer delegated reply"),
          parentMessageId: "m-1",
          author: {
            type: "agent",
            id: "agent-1",
            name: "Honey",
            provider: "claude",
          },
        },
      ],
    });
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
      emitChannelChange(2);
      await Promise.resolve();
    });
    expect(loadChannelDelta).not.toHaveBeenCalled();

    await act(async () => {
      resolveChannel({
        channel: channel("c-common", "Welcome", null),
        members: [],
        agents: [agent],
        messages: [initial],
      });
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(2);
      await Promise.resolve();
    });
    expect(loadChannelDelta).toHaveBeenCalledWith(
      "token",
      "org-1",
      1,
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("1 replies");
  });

  it("retains channel-list upserts and removals consumed after realtime notification", async () => {
    vi.useFakeTimers();
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [message("m-1", "Initial")],
    });
    loadChannelDelta.mockResolvedValue({
      ...emptyDelta(2),
      channels: [channel("c-new", "New channel", null)],
      removedChannelIds: ["c-common"],
    });
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(2);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("New channel");
    expect(container.textContent).not.toContain("Welcome");
    expect(container.querySelector(".companion-channel-detail")).toBeNull();
  });

  it("does not overlap realtime syncs and stops applying them after leaving the channel", async () => {
    vi.useFakeTimers();
    loadChannel.mockImplementation(
      (_token: string, _organizationId: string, channelId: string) =>
        Promise.resolve({
          channel: channel(
            channelId,
            channelId === "c-common" ? "Welcome" : "Briar dev",
            channelId === "c-common" ? null : "project-1",
          ),
          members: [],
          agents: [],
          messages: channelId === "c-common"
            ? [message("m-1", "Initial")]
            : [],
        }),
    );
    let resolvePoll!: (value: unknown) => void;
    loadChannelDelta.mockReturnValue(
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    );
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
      await Promise.resolve();
    });

    await act(async () => {
      emitChannelChange(2);
      emitChannelChange(3);
      emitChannelChange(4);
      await Promise.resolve();
    });
    expect(loadChannelDelta).toHaveBeenCalledTimes(1);
    const pollSignal = loadChannelDelta.mock.calls[0]?.[3] as AbortSignal;
    expect(pollSignal.aborted).toBe(false);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".companion-channel-bar-back")!
        .click();
    });
    expect(pollSignal.aborted).toBe(true);
    await act(async () => {
      resolvePoll({
        ...emptyDelta(2),
        messages: [message("m-late", "Late reply")],
      });
      await Promise.resolve();
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Briar dev"))!
        .click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(2);
      await Promise.resolve();
    });

    expect(loadChannelDelta).toHaveBeenCalledTimes(2);
    expect(loadChannelDelta.mock.calls[1]?.[2]).toBe(1);
    expect(container.textContent).not.toContain("Late reply");
  });

  it("surfaces a failed asynchronous Agent reply in the existing error banner", async () => {
    vi.useFakeTimers();
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [message("m-1", "Please investigate")],
    });
    loadChannelDelta.mockResolvedValue({
      ...emptyDelta(2),
      agentReplies: [agentReply("failed", "c-common", "worker unavailable")],
    });
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
      await Promise.resolve();
    });
    await act(async () => {
      emitChannelChange(2);
      await Promise.resolve();
    });

    expect(container.querySelector(".companion-channel-error")?.textContent)
      .toContain("worker unavailable");
  });

  it("opens a requested Inbox reply directly in its thread", async () => {
    const rootMessage = message("m-root", "Thread root", 1);
    const reply = {
      ...message("m-reply", "Requested reply"),
      parentMessageId: rootMessage.id,
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [rootMessage],
    });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage, reply] });

    await render(
      undefined,
      {
        channelId: "c-common",
        messageId: reply.id,
        rootMessageId: rootMessage.id,
      },
      vi.fn(),
    );
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Requested reply");
    });
    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-common",
      rootMessage.id,
    );
    expect(container.textContent).toContain("Thread");
  });

  it("requires a project for common-channel proposals, accepts it, and opens the result", async () => {
    const proposal = message("m-proposal", "새 이슈를 제안합니다");
    proposal.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "claude",
    };
    proposal.proposal = {
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
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [proposal],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "already_accepted",
      projectId: "project-2",
      resultRunId: "run-2",
    });
    const onIssueOpen = vi.fn();
    await render(onIssueOpen);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
    });
    await act(async () => Promise.resolve());

    const card = container.querySelector<HTMLElement>(
      ".companion-channel-proposal",
    );
    const select = card!.querySelector<HTMLSelectElement>("select")!;
    const accept = card!.querySelector<HTMLButtonElement>("button")!;
    expect(accept.disabled).toBe(true);
    expect(card!.textContent).toContain("Improve onboarding");
    expect(card!.textContent).toContain("Priority P2");
    expect(card!.textContent).toContain("do not execute");

    await act(async () => {
      select.value = "project-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(accept.disabled).toBe(false);
    expect(card!.textContent).toContain("Target project: Sprout");
    await act(async () => {
      accept.click();
    });
    await act(async () => Promise.resolve());

    expect(acceptChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-common",
      "proposal-1",
      "project-2",
    );
    expect(onIssueOpen).toHaveBeenCalledWith("project-2", "run-2");
  });

  it("stays in the channel for a server-returned legacy execution follow-up", async () => {
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const initial = message("m-create-execute", "생성과 실행을 제안합니다");
    initial.channelId = selectedChannel.id;
    initial.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "codex",
    };
    initial.proposal = {
      id: "proposal-create-execute",
      actionType: "request_issue_create",
      status: "pending",
      projectId: "project-1",
      payload: {
        issue: {
          title: "Mobile two-step approval",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
      resultRunId: null,
    };
    const materialized: ChannelMessage = {
      ...initial,
      proposal: {
        ...initial.proposal,
        status: "accepted",
        resultRunId: "run-create-execute",
      },
      executionProposal: {
        id: "execution-create-execute",
        type: "request_issue_execute",
        status: "pending",
        projectId: "project-1",
        runId: "run-create-execute",
        title: "Mobile two-step approval",
        createdAt: "2026-08-11T00:00:00.000Z",
        acceptedAt: null,
        requestedProvider: null,
        requestedModel: null,
        requestedEffort: null,
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
    };
    listChannels.mockResolvedValue({ channels: [selectedChannel], cursor: 1 });
    loadChannel
      .mockResolvedValueOnce({
        channel: selectedChannel,
        members: [],
        agents: [agent],
        messages: [initial],
      })
      .mockResolvedValue({
        channel: selectedChannel,
        members: [],
        agents: [agent],
        messages: [materialized],
      });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-1",
      resultRunId: "run-create-execute",
      executionProposal: materialized.executionProposal,
    });
    const onIssueOpen = vi.fn();
    await render(onIssueOpen);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onIssueOpen).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Issue execution proposal");
    expect(container.textContent).toContain("Accepted — the issue was created");
  });

  it("keeps a newer transferred proposal over a delayed approval response", async () => {
    vi.useFakeTimers();
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const proposal = message("m-delayed-proposal", "이슈를 제안합니다");
    proposal.channelId = selectedChannel.id;
    proposal.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "claude",
    };
    proposal.proposal = {
      id: "proposal-delayed",
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
    };
    const transferred: ChannelMessage = {
      ...proposal,
      proposal: {
        ...proposal.proposal!,
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
    listChannels.mockResolvedValue({ channels: [selectedChannel], cursor: 1 });
    loadChannel.mockResolvedValue({
      channel: selectedChannel,
      members: [],
      agents: [],
      messages: [proposal],
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 2,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [transferred],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    const onIssueOpen = vi.fn();
    await render(onIssueOpen);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
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
      emitChannelChange(2);
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

    expect(onIssueOpen).toHaveBeenCalledTimes(1);
    expect(onIssueOpen).toHaveBeenCalledWith("project-2", "run-new");
    expect(container.textContent).toContain("Target project: Sprout");
  });

  it("refreshes an intermediate reservation delta before opening the issue", async () => {
    vi.useFakeTimers();
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const proposal = message("m-reserved-proposal", "이슈를 제안합니다");
    proposal.channelId = selectedChannel.id;
    proposal.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "claude",
    };
    proposal.proposal = {
      id: "proposal-reserved",
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
    };
    const reserved: ChannelMessage = {
      ...proposal,
      proposal: {
        ...proposal.proposal!,
        projectId: "project-1",
      },
    };
    const accepted: ChannelMessage = {
      ...reserved,
      proposal: {
        ...reserved.proposal!,
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
    listChannels.mockResolvedValue({ channels: [selectedChannel], cursor: 1 });
    loadChannel
      .mockResolvedValueOnce({
        channel: selectedChannel,
        members: [],
        agents: [],
        messages: [proposal],
      })
      .mockResolvedValueOnce({
        channel: selectedChannel,
        members: [],
        agents: [],
        messages: [accepted],
      });
    loadChannelDelta.mockResolvedValue({
      cursor: 2,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [reserved],
      removedMessageIds: [],
      agentReplies: [],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    const onIssueOpen = vi.fn();
    await render(onIssueOpen);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
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
      emitChannelChange(2);
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
    expect(onIssueOpen).toHaveBeenCalledWith("project-1", "run-reserved");
    expect(container.textContent).toContain("View issue");
  });

  it("drops a delayed approval failure after backing out of a channel", async () => {
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const proposal = message("m-back-failure", "이슈를 제안합니다");
    proposal.channelId = selectedChannel.id;
    proposal.proposal = {
      id: "proposal-back-failure",
      actionType: "request_issue_create",
      status: "pending",
      projectId: "project-1",
      payload: {
        issue: {
          title: "Back-safe approval",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
      resultRunId: null,
    };
    let rejectAccept!: (reason: Error) => void;
    const pendingAccept = new Promise<never>((_resolve, reject) => {
      rejectAccept = reject;
    });
    loadChannel.mockResolvedValue({
      channel: selectedChannel,
      members: [],
      agents: [],
      messages: [proposal],
    });
    acceptChannelProposal.mockReturnValue(pendingAccept);
    await render();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      )].find((button) => button.textContent?.includes("Briar dev"))!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-bar-back",
      )!.click();
    });

    await act(async () => {
      rejectAccept(new Error("stale mobile approval failed"));
      await pendingAccept.catch(() => undefined);
    });

    expect(container.querySelector(".companion-channel-error")).toBeNull();
    expect(container.textContent).not.toContain("stale mobile approval failed");
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      )].find((button) => button.textContent?.includes("Briar dev"))!.click();
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.disabled,
    ).toBe(false);
  });

  it("drops a delayed issue-navigation failure after backing out", async () => {
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const proposal = message("m-navigation-back", "이슈를 제안합니다");
    proposal.channelId = selectedChannel.id;
    proposal.proposal = {
      id: "proposal-navigation-back",
      actionType: "request_issue_create",
      status: "pending",
      projectId: "project-1",
      payload: {
        issue: {
          title: "Navigation-safe approval",
          description: null,
          priority: 2,
          status: "backlog",
        },
      },
      resultRunId: null,
    };
    let rejectNavigation!: (reason: Error) => void;
    const pendingNavigation = new Promise<void>((_resolve, reject) => {
      rejectNavigation = reject;
    });
    const onIssueOpen = vi.fn(() => pendingNavigation);
    loadChannel.mockResolvedValue({
      channel: selectedChannel,
      members: [],
      agents: [],
      messages: [proposal],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-1",
      resultRunId: "run-navigation-back",
    });
    await render(onIssueOpen);
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      )].find((button) => button.textContent?.includes("Briar dev"))!.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )!.click();
      await Promise.resolve();
    });
    expect(onIssueOpen).toHaveBeenCalledWith(
      "project-1",
      "run-navigation-back",
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-bar-back",
      )!.click();
    });
    await act(async () => {
      rejectNavigation(new Error("stale mobile navigation failed"));
      await pendingNavigation.catch(() => undefined);
    });

    expect(container.querySelector(".companion-channel-error")).toBeNull();
    expect(container.textContent).not.toContain("stale mobile navigation failed");
  });

  it("shows the complete proposal and disables approval in an archived channel", async () => {
    const archivedChannel = {
      ...channel("c-common", "Archived", "project-1"),
      archivedAt: "2026-08-10T00:00:00.000Z",
    };
    const finalClause = "Final clause that must remain visible before approval.";
    const proposal = message("m-archived-proposal", "새 이슈를 제안합니다");
    proposal.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "claude",
    };
    proposal.proposal = {
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
    };
    proposal.executionProposal = {
      id: "execution-archived",
      type: "request_issue_execute",
      status: "pending",
      projectId: "project-1",
      runId: "run-archived",
      title: "Review the complete issue",
      createdAt: "2026-08-10T00:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    listChannels.mockResolvedValue({
      channels: [channel("c-common", "Archived", "project-1")],
      cursor: 1,
    });
    loadChannel.mockResolvedValue({
      channel: archivedChannel,
      members: [],
      agents: [],
      messages: [proposal],
    });
    await render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
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
    const approve = container.querySelector<HTMLButtonElement>(
      ".channel-proposal-approve-button",
    )!;
    expect(approve.disabled).toBe(true);
    approve.click();
    expect(acceptChannelProposal).not.toHaveBeenCalled();
    const execute = container.querySelector<HTMLButtonElement>(
      ".execution-proposal-approve",
    )!;
    expect(execute.disabled).toBe(true);
    execute.click();
    expect(acceptChannelExecutionProposal).not.toHaveBeenCalled();
  });

  it("uses the same explicit execution approval on the Companion surface", async () => {
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const item = message("m-execution", "실행을 제안합니다");
    item.channelId = selectedChannel.id;
    item.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "codex",
    };
    item.executionProposal = {
      id: "execution-companion",
      type: "request_issue_execute",
      status: "pending",
      projectId: "project-1",
      runId: "run-companion",
      title: "Companion approval",
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    const worker = {
      id: "worker-companion",
      label: "Companion Mac",
      agentProvider: "codex",
      providers: ["codex"],
      readiness: "available",
      acceptingWork: true,
    };
    listChannels.mockResolvedValue({ channels: [selectedChannel], cursor: 1 });
    loadChannel.mockResolvedValue({
      channel: selectedChannel,
      members: [],
      agents: [agent],
      messages: [item],
    });
    loadDashboard.mockResolvedValue({
      runs: [{
        id: "run-companion",
        title: "Companion approval",
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
        ...item.executionProposal,
        status: "accepted",
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedProvider: "codex",
      },
      outcome: "accepted",
      projectId: "project-1",
      runId: "run-companion",
      dispatch: { outcome: "dispatched" },
    });
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
      await Promise.resolve();
    });

    expect(acceptChannelExecutionProposal).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    expect(document.body.textContent).toContain("Approve issue execution");
    const finalApprove = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Approve and run"));
    await act(async () => finalApprove?.click());

    expect(acceptChannelExecutionProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      selectedChannel.id,
      "execution-companion",
      { provider: "codex", model: null, effort: null, workerId: null },
    );
  });

  it("uses exact Worker approval for a saved Skill and adopts its session", async () => {
    const selectedChannel = channel("c-current", "Briar dev", "project-1");
    const item = message("m-skill", "Run the deploy Skill");
    item.channelId = selectedChannel.id;
    item.author = {
      type: "agent",
      id: "agent-1",
      name: "Honey",
      provider: "codex",
    };
    const pending = {
      id: "skill-companion",
      type: "request_agent_skill_execute" as const,
      status: "pending" as const,
      projectId: "project-1",
      agentId: "project-agent-1",
      agentName: "Release Agent",
      skillId: "skill-1",
      skillName: "Deploy",
      request: "Deploy the mobile app",
      provider: "codex" as const,
      model: null,
      effort: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedWorkerId: null,
      requestedWorkerLabel: null,
      resultSessionId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    item.skillExecutionProposal = pending;
    const remoteSession = { id: "session-companion" } as AutoHuntSession;
    listChannels.mockResolvedValue({ channels: [selectedChannel], cursor: 1 });
    loadChannel.mockResolvedValue({
      channel: selectedChannel,
      members: [],
      agents: [agent],
      messages: [item],
    });
    loadDashboard.mockResolvedValue({
      runs: [],
      workers: [{
        id: "worker-companion-skill",
        label: "Companion Build Mac",
        agentProvider: "codex",
        providers: ["codex"],
        readiness: "available",
        acceptingWork: true,
      }],
      executionPolicy: {
        selectionMode: "any",
        defaultWorkerId: null,
        allowedWorkerIds: [],
        updatedAt: null,
      },
    });
    acceptChannelSkillExecutionProposal.mockResolvedValue({
      outcome: "accepted",
      proposal: {
        ...pending,
        status: "accepted",
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedWorkerId: "worker-companion-skill",
        requestedWorkerLabel: "Companion Build Mac",
        resultSessionId: remoteSession.id,
      },
      projectId: "project-1",
      session: remoteSession,
    });
    const adopt = vi.fn();
    await render(undefined, undefined, undefined, adopt);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )?.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    expect(acceptChannelSkillExecutionProposal).not.toHaveBeenCalled();
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Exact Worker to execute"]',
      )?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '[role="option"][data-value="worker-companion-skill"]',
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Approve and run Skill"));
    await act(async () => approve?.click());

    expect(acceptChannelSkillExecutionProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      selectedChannel.id,
      pending,
      { workerId: "worker-companion-skill" },
    );
    expect(adopt).toHaveBeenCalledWith(remoteSession);
  });

  it("opens the result from an already accepted proposal", async () => {
    const proposal = message("m-accepted", "이슈를 만들었습니다");
    proposal.proposal = {
      id: "proposal-2",
      actionType: "request_issue_create",
      status: "accepted",
      projectId: "project-1",
      payload: {
        issue: {
          title: "Accepted issue",
          description: null,
          priority: null,
          status: "backlog",
        },
      },
      resultRunId: "run-1",
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [proposal],
    });
    const onIssueOpen = vi.fn();
    await render(onIssueOpen);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-group button",
      )!.click();
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".companion-channel-proposal button",
      )!.click();
    });

    expect(onIssueOpen).toHaveBeenCalledWith("project-1", "run-1");
  });

  it("uses the channel default project without showing a picker", async () => {
    const proposal = message("m-default", "이슈를 제안합니다");
    proposal.proposal = {
      id: "proposal-default",
      actionType: "request_issue_create",
      status: "pending",
      projectId: null,
      payload: {
        issue: {
          title: "Default project issue",
          description: null,
          priority: 3,
          status: "backlog",
        },
      },
      resultRunId: null,
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-current", "Briar dev", "project-1"),
      members: [],
      agents: [],
      messages: [proposal],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      projectId: "project-1",
      resultRunId: "run-default",
    });
    await render();

    const channelButton = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-group button",
      ),
    ].find((button) => button.textContent?.includes("Briar dev"));
    await act(async () => {
      channelButton!.click();
    });
    await act(async () => Promise.resolve());

    const card = container.querySelector<HTMLElement>(
      ".companion-channel-proposal",
    );
    expect(card!.querySelector("select")).toBeNull();
    await act(async () => {
      card!.querySelector<HTMLButtonElement>("button")!.click();
    });
    await act(async () => Promise.resolve());

    expect(acceptChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-current",
      "proposal-default",
      "project-1",
    );
  });

  it("presents channel messages with avatars, reply context, and a channel composer", async () => {
    const item = message("m-1", "Hello team", 2);
    item.author = {
      type: "user",
      id: "user-1",
      name: "Jay",
      email: "jay@example.com",
      image: "https://example.com/jay.png",
    };
    item.lastReplyAt = "2026-08-01T08:00:00.000Z";
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [item],
    });
    await render();

    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector(".companion-channel-detail")).not.toBeNull();
    expect(
      container.querySelector<HTMLImageElement>("img.companion-channel-avatar")
        ?.src,
    ).toBe("https://example.com/jay.png");
    expect(container.querySelector(".companion-channel-thread-summary")?.textContent)
      .toContain("2 replies");
    expect(container.querySelector(".companion-channel-thread-summary")?.textContent)
      .toContain("last reply");
    expect(
      container.querySelector<HTMLInputElement>(".companion-channel-composer input")
        ?.placeholder,
    ).toBe("Message channel");
  });

  it("posts a thread reply against the opened message", async () => {
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [message("m-1", "Hello team")],
    });
    listChannelMessages.mockResolvedValue({
      messages: [message("m-1", "Hello team")],
    });
    sendChannelMessage.mockResolvedValue({
      message: message("m-3", "답글"),
      agentReplies: [],
    });
    await render();

    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".companion-channel-message-button")!
        .click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>(
      ".companion-channel-composer input",
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "답글");
    await act(async () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form.companion-channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith("token", "org-1", "c-common", {
      body: "답글",
      parentMessageId: "m-1",
      mentionedAgentIds: [],
      mentionedUserIds: [],
      attachments: [],
      attachmentReferences: [],
    });
  });

  it("opens @ candidates and sends a picked Agent as a structured mention", async () => {
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [member],
      agents: [agent],
      messages: [],
    });
    sendChannelMessage.mockResolvedValue({
      message: message("m-2", "@honey 확인해 줘"),
      agentReplies: [],
    });
    await render();

    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
    });
    await act(async () => Promise.resolve());

    const input = container.querySelector<HTMLInputElement>(
      ".companion-channel-composer input",
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "@");
    input.selectionStart = 1;
    input.selectionEnd = 1;
    await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));

    expect(input.getAttribute("aria-expanded")).toBe("true");
    const honey = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".companion-channel-mention-menu button",
      ),
    ].find((button) => button.textContent?.includes("Honey"));
    expect(honey?.textContent).toContain("Organization agent");
    expect(honey?.textContent).not.toContain("조직 에이전트");
    await act(async () => honey!.click());
    const composerMention = container.querySelector<HTMLButtonElement>(
      ".companion-channel-composer-field .conversation-mention-button[data-mention-handle='honey']",
    );
    expect(composerMention?.textContent).toBe("@honey");
    await act(async () => composerMention?.click());
    expect(
      document.body.querySelector<HTMLElement>(".profile-dialog")?.textContent,
    ).toContain("Honey");

    setter.call(input, "@honey 확인해 줘");
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
    await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => {
      container
        .querySelector("form.companion-channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith("token", "org-1", "c-common", {
      body: "@honey 확인해 줘",
      parentMessageId: null,
      mentionedAgentIds: ["agent-1"],
      mentionedUserIds: [],
      attachments: [],
      attachmentReferences: [],
    });
  });

  it("attaches a pasted image and sends an image-only message", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:companion-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [],
    });
    sendChannelMessage.mockResolvedValue({
      message: message("m-image", "Image"),
      agentReplies: [],
    });
    await render();
    await act(async () => {
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          ".companion-channel-group button",
        ),
      ]
        .find((button) => button.textContent?.includes("Welcome"))!
        .click();
    });
    await act(async () => Promise.resolve());
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const input = container.querySelector<HTMLInputElement>(
      ".companion-channel-composer input[role='combobox']",
    )!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });

    await act(async () => input.dispatchEvent(paste));
    await act(async () => {
      container
        .querySelector("form.companion-channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(sendChannelMessage).toHaveBeenCalledWith(
      "token",
      "org-1",
      "c-common",
      expect.objectContaining({
        attachments: [image],
        attachmentReferences: [expect.any(String)],
        body: expect.stringContaining("briar-attachment://"),
      }),
    );
  });
});
