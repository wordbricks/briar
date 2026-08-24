/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import { channelReplyNoAvailableWorkerError } from "../lib/channels-contract";
import type { OrganizationMember, Project } from "../types";
import { ToastProvider } from "./ui/toast";

const listChannels = vi.fn();
const loadChannel = vi.fn();
const markChannelRead = vi.fn().mockResolvedValue({ channel: {} });
const loadChannelDelta = vi.fn();
const sendChannelMessage = vi.fn();
const acceptChannelProposal = vi.fn();
const acceptChannelExecutionProposal = vi.fn();
const acceptChannelSkillExecutionProposal = vi.fn();
const loadDashboard = vi.fn();
const listChannelMessages = vi.fn();
const createChannel = vi.fn();
const loadChannelMessageAttachment = vi.fn();
const loadChannelMessageDocument = vi.fn();
const loadOrganizationMembers = vi.fn();
const listOrganizationAgents = vi.fn();
const setChannelMember = vi.fn();
const setChannelAgent = vi.fn();
const toggleChannelMessageReaction = vi.fn();
const updateChannelThreadSubscription = vi.fn();
const listChannelWebhooks = vi.fn();
const createChannelWebhook = vi.fn();
const updateChannelWebhook = vi.fn();
const rotateChannelWebhook = vi.fn();
const revokeChannelWebhook = vi.fn();
const updateChannel = vi.fn();
const currentExecutionWorkerDeviceId = vi.fn();
const channelRealtime = vi.hoisted(() => ({
  listeners: new Set<(notification: { topic: "channels"; cursor: number }) => void>(),
}));

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  markChannelRead: (...args: unknown[]) => markChannelRead(...args),
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
  loadChannelMessageDocument: (...args: unknown[]) =>
    loadChannelMessageDocument(...args),
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembers(...args),
  listOrganizationAgents: (...args: unknown[]) => listOrganizationAgents(...args),
  setChannelMember: (...args: unknown[]) => setChannelMember(...args),
  setChannelAgent: (...args: unknown[]) => setChannelAgent(...args),
  toggleChannelMessageReaction: (...args: unknown[]) =>
    toggleChannelMessageReaction(...args),
  updateChannelThreadSubscription: (...args: unknown[]) =>
    updateChannelThreadSubscription(...args),
  listChannelWebhooks: (...args: unknown[]) => listChannelWebhooks(...args),
  createChannelWebhook: (...args: unknown[]) => createChannelWebhook(...args),
  updateChannelWebhook: (...args: unknown[]) => updateChannelWebhook(...args),
  rotateChannelWebhook: (...args: unknown[]) => rotateChannelWebhook(...args),
  revokeChannelWebhook: (...args: unknown[]) => revokeChannelWebhook(...args),
  updateChannel: (...args: unknown[]) => updateChannel(...args),
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

vi.mock("../lib/execution-worker-device", () => ({
  currentExecutionWorkerDeviceId: (...args: unknown[]) =>
    currentExecutionWorkerDeviceId(...args),
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
  name: "Honey",
  avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
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

const agentReply = (
  overrides: Partial<ChannelAgentReply> = {},
): ChannelAgentReply => ({
  id: "reply-1",
  agentId: "agent-1",
  channelId: "channel-1",
  triggerMessageId: "message-1",
  parentMessageId: "message-1",
  replyMessageId: "reply-message-1",
  status: "running",
  attempts: 1,
  error: null,
  createdAt: "2026-08-01T01:00:01.000Z",
  updatedAt: "2026-08-01T01:00:02.000Z",
  ...overrides,
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

/** Same native-setter trick as typeInto, but for text inputs and selects. */
const changeInputValue = async (
  field: HTMLInputElement | HTMLSelectElement,
  value: string,
) => {
  const prototype = field instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  setter.call(field, value);
  await act(async () => {
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
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
    inboxDetail = false,
    onInboxDetailClose?: () => void,
    consumeRequestedMessage = false,
    projects: Pick<Project, "id" | "name" | "organizationId">[] = [],
    initialInviteChannelId: string | null = null,
    onInitialInviteHandled?: (channelId: string) => void,
    initialSettingsChannelId: string | null = null,
    onInitialSettingsHandled?: () => void,
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
    const RequestedMessageConsumer = () => {
      const [pendingRequest, setPendingRequest] = useState(requestedMessage);
      return (
        <Channels
          activeChannelId="channel-1"
          channels={[channel]}
          currentUserId="user-1"
          inboxDetail={inboxDetail}
          initialInviteChannelId={initialInviteChannelId}
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onCreateAgent={onCreateAgent}
          onInitialInviteHandled={onInitialInviteHandled}
          initialSettingsChannelId={initialSettingsChannelId}
          onInitialSettingsHandled={onInitialSettingsHandled}
          onInboxDetailClose={onInboxDetailClose}
          organizationId="org-1"
          organizationName="wordbricks"
          requestedMessage={pendingRequest}
          token="token"
          onRequestedMessageOpen={() => {
            onRequestedMessageOpen?.();
            if (consumeRequestedMessage) setPendingRequest(undefined);
          }}
          projects={projects}
        />
      );
    };
    await act(async () => {
      root.render(
        <ToastProvider>
          <RequestedMessageConsumer />
        </ToastProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentExecutionWorkerDeviceId.mockResolvedValue(null);
    listChannelWebhooks.mockResolvedValue({ webhooks: [] });
    channelRealtime.listeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body
      .querySelectorAll("[data-testid='toast-viewport']")
      .forEach((node) => node.remove());
  });



  it("uses Inbox channel changes as a delta recovery signal", async () => {
    vi.useFakeTimers();
    const channelList = [channel];
    const recovered = message({
      id: "message-recovered",
      body: "Recovered before the notification is shown",
    });
    listChannels.mockResolvedValue({ channels: channelList, cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [],
    });
    loadChannelDelta
      .mockResolvedValueOnce({
        cursor: 7,
        hasMore: false,
        channels: [],
        removedChannelIds: [],
        messages: [],
        removedMessageIds: [],
        agentReplies: [],
      })
      .mockResolvedValueOnce({
        cursor: 8,
        hasMore: false,
        channels: [],
        removedChannelIds: [],
        messages: [recovered],
        removedMessageIds: [],
        agentReplies: [],
      });
    const props = {
      activeChannelId: channel.id,
      channels: channelList,
      currentUserId: "user-1",
      onChannelSelect: vi.fn(),
      onChannelsChange: vi.fn(),
      organizationId: "org-1",
      token: "token",
    };

    await act(async () => {
      root.render(
        <Channels {...props} channelInboxSyncSignal="baseline" />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(loadChannelDelta).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <Channels {...props} channelInboxSyncSignal="channel:message-recovered" />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadChannelDelta).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "Recovered before the notification is shown",
    );
  });

  it("keeps legacy DM replies in the main timeline", async () => {
    const directMessage: ChannelSummary = {
      ...channel,
      kind: "dm",
      visibility: "private",
      dmParticipants: [
        { type: "user", id: "user-1", name: "Jay", image: null },
        { type: "agent", id: "agent-1", name: "Honey", image: null },
      ],
    };
    const rootMessage = message({
      body: "Please review this",
      replyCount: 1,
    });
    const legacyReply = message({
      id: "message-legacy-reply",
      parentMessageId: rootMessage.id,
      body: "Reviewed in the DM timeline",
      author: {
        type: "agent",
        id: "agent-1",
        name: "Honey",
        provider: "claude",
        image: null,
      },
      createdAt: "2026-08-01T01:01:00.000Z",
    });
    loadChannel.mockResolvedValue({
      channel: directMessage,
      members: [member],
      agents: [agent],
      messages: [rootMessage],
      nextCursor: null,
    });
    loadChannelDelta.mockResolvedValue({
      cursor: 8,
      hasMore: false,
      channels: [],
      removedChannelIds: [],
      messages: [legacyReply],
      removedMessageIds: [],
      agentReplies: [],
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId={directMessage.id}
          channelCatalogCursor={7}
          channels={[directMessage]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          surface="dm"
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Please review this");
    });
    expect(container.querySelector(".conversation-reply-summary")).toBeNull();

    await act(async () => {
      emitChannelChange(8);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Reviewed in the DM timeline");
    });
    expect(listChannelMessages).not.toHaveBeenCalled();
  });

  it("opens the agent profile from a one-to-one DM header", async () => {
    const directMessage: ChannelSummary = {
      ...channel,
      kind: "dm",
      visibility: "private",
      dmParticipants: [
        { type: "user", id: "user-1", name: "Jay", image: null },
        { type: "agent", id: "agent-1", name: "Honey", image: agent.avatar },
      ],
    };
    loadChannel.mockResolvedValue({
      channel: directMessage,
      members: [member],
      agents: [agent],
      messages: [message()],
      nextCursor: null,
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId={directMessage.id}
          channels={[directMessage]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          surface="dm"
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(".channel-header-identity-button")?.textContent,
      ).toContain("Honey");
    });
    const dmHeader = container.querySelector(".channel-header");
    expect(dmHeader?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(
      dmHeader?.querySelector("button")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".channel-header-identity-button")!
        .click();
    });
    const dialog = document.body.querySelector<HTMLElement>(".profile-dialog");
    expect(dialog?.textContent).toContain("Honey");
    expect(dialog?.textContent).toContain("Writing partner");
  });

  it("opens a participant menu from a group DM header then the selected profile", async () => {
    const group: ChannelSummary = {
      ...channel,
      kind: "dm",
      visibility: "private",
      dmParticipants: [
        { type: "user", id: "user-1", name: "Jay", image: null },
        { type: "agent", id: "agent-1", name: "Honey", image: agent.avatar },
        { type: "user", id: "user-2", name: "Sam", image: null },
      ],
    };
    loadChannel.mockResolvedValue({
      channel: group,
      members: [member],
      agents: [agent],
      messages: [message()],
      nextCursor: null,
    });

    await act(async () => {
      root.render(
        <Channels
          activeChannelId={group.id}
          channels={[group]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          surface="dm"
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector(".channel-header-identity-button")?.textContent,
      ).toContain("Honey, Sam");
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".channel-header-identity-button")!
        .click();
    });
    const sam = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".channel-header-participant-menu button",
      ),
    ].find((button) => button.textContent?.includes("Sam"));
    expect(sam).toBeDefined();
    await act(async () => {
      sam!.click();
    });
    expect(
      document.body.querySelector<HTMLElement>(".profile-dialog")?.textContent,
    ).toContain("sam@example.com");
  });

  it("renames the channel and changes the linked project from settings", async () => {
    updateChannel.mockResolvedValue({ channel: { ...channel, name: "Design" } });
    await render(
      [message()],
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      [
        { id: "project-1", name: "Briar", organizationId: "org-1" },
        { id: "project-2", name: "Console", organizationId: "org-1" },
        { id: "project-other", name: "Other org", organizationId: "org-2" },
      ],
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '.channel-header-icon[aria-label="더 보기"]',
      )!.click();
      await Promise.resolve();
    });
    const dialog = container.querySelector<HTMLElement>(
      ".channel-settings-dialog",
    );
    expect(dialog).not.toBeNull();

    const nameInput = dialog!.querySelector<HTMLInputElement>(
      "#channel-settings-name",
    );
    expect(nameInput?.value).toBe("Welcome");
    await changeInputValue(nameInput!, "Design");
    const saveButton = [...dialog!.querySelectorAll("button")].find((button) =>
      button.textContent === "저장"
    );
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      saveButton!.click();
      await Promise.resolve();
    });
    expect(updateChannel).toHaveBeenCalledWith("token", "org-1", "channel-1", {
      name: "Design",
    });

    updateChannel.mockResolvedValue({
      channel: { ...channel, defaultProjectId: null },
    });
    const projectSelect = dialog!.querySelector<HTMLSelectElement>(
      "#channel-settings-project",
    );
    expect(projectSelect?.value).toBe("project-1");
    expect(
      [...projectSelect!.querySelectorAll("option")].map((option) => option.value),
    ).toEqual(["", "project-1", "project-2"]);
    await changeInputValue(projectSelect!, "");
    expect(updateChannel).toHaveBeenCalledWith("token", "org-1", "channel-1", {
      defaultProjectId: null,
    });
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
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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
    expect(loadChannel).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      expect.objectContaining({ messageLimit: 20, signal: expect.any(AbortSignal) }),
    );
  });


  it("loads the previous 20 messages at the top and preserves the current channel", async () => {
    const recent = Array.from({ length: 20 }, (_, index) => message({
      id: `recent-${index}`,
      body: `Recent ${index}`,
      createdAt: `2026-08-01T01:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const earlier = message({
      id: "earlier-1",
      body: "Earlier history",
      createdAt: "2026-08-01T00:59:00.000Z",
    });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: recent,
      nextCursor: "recent-0",
    });
    listChannelMessages.mockResolvedValue({ messages: [earlier], nextCursor: null });
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
          activeChannelId={channel.id}
          channelCatalogCursor={7}
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const scroller = container.querySelector<HTMLElement>(".channel-messages")!;
    await act(async () => {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
      scroller.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(listChannelMessages).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      undefined,
      expect.objectContaining({
        cursor: "recent-0",
        limit: 20,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(container.textContent).toContain("Earlier history");
    expect(container.querySelector(".channel-header")?.textContent).toContain("Welcome");
  });

  it("aborts an obsolete channel request and keeps its late result off screen", async () => {
    const otherChannel: ChannelSummary = {
      ...channel,
      id: "channel-2",
      slug: "other",
      name: "Other",
    };
    const first = deferred<{
      channel: ChannelSummary;
      members: ChannelMember[];
      agents: ChannelAgentSummary[];
      messages: ChannelMessage[];
      nextCursor: null;
    }>();
    const second = deferred<{
      channel: ChannelSummary;
      members: ChannelMember[];
      agents: ChannelAgentSummary[];
      messages: ChannelMessage[];
      nextCursor: null;
    }>();
    loadChannel.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
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
      channelCatalogCursor: 7,
      channels: [channel, otherChannel],
      currentUserId: "user-1",
      onChannelSelect: () => undefined,
      onChannelsChange: () => undefined,
      organizationId: "org-1",
      token: "token",
    };

    await act(async () => {
      root.render(<Channels {...props} activeChannelId={channel.id} />);
      await Promise.resolve();
    });
    const firstSignal = loadChannel.mock.calls[0]?.[3]?.signal as AbortSignal;
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={otherChannel.id} />);
      await Promise.resolve();
    });
    expect(firstSignal.aborted).toBe(true);
    expect(container.querySelector(".channel-header")?.textContent).toContain("Other");

    await act(async () => {
      first.resolve({
        channel,
        members: [member],
        agents: [agent],
        messages: [message({ body: "Obsolete result" })],
        nextCursor: null,
      });
      second.resolve({
        channel: otherChannel,
        members: [member],
        agents: [agent],
        messages: [message({
          channelId: otherChannel.id,
          id: "other-message",
          body: "Current result",
        })],
        nextCursor: null,
      });
      await Promise.all([first.promise, second.promise]);
    });
    expect(container.textContent).toContain("Current result");
    expect(container.textContent).not.toContain("Obsolete result");
  });

  it("reuses a channel's cached first page while refreshing it in the background", async () => {
    const otherChannel: ChannelSummary = {
      ...channel,
      id: "channel-2",
      slug: "other",
      name: "Other",
    };
    const cachedMessage = message({ id: "cached-message", body: "Cached immediately" });
    const refresh = deferred<{
      channel: ChannelSummary;
      members: ChannelMember[];
      agents: ChannelAgentSummary[];
      messages: ChannelMessage[];
      nextCursor: null;
    }>();
    loadChannel
      .mockResolvedValueOnce({
        channel,
        members: [member],
        agents: [agent],
        messages: [cachedMessage],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        channel: otherChannel,
        members: [member],
        agents: [agent],
        messages: [message({ channelId: otherChannel.id, id: "other", body: "Other" })],
        nextCursor: null,
      })
      .mockReturnValueOnce(refresh.promise);
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
      channelCatalogCursor: 7,
      channels: [channel, otherChannel],
      currentUserId: "user-1",
      onChannelSelect: () => undefined,
      onChannelsChange: () => undefined,
      organizationId: "org-1",
      token: "token",
    };
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={channel.id} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={otherChannel.id} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Channels {...props} activeChannelId={channel.id} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Cached immediately");
    expect(container.querySelector(".channel-message-skeleton")).toBeNull();
    expect(loadChannel).toHaveBeenCalledTimes(3);
    refresh.resolve({
      channel,
      members: [member],
      agents: [agent],
      messages: [cachedMessage],
      nextCursor: null,
    });
    await act(async () => {
      await refresh.promise;
    });
  });

  it("windows large message histories instead of mounting every message row", async () => {
    const history = Array.from({ length: 60 }, (_, index) => message({
      id: `history-${index}`,
      body: `History ${index}`,
      createdAt: `2026-08-01T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: history,
      nextCursor: null,
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
          activeChannelId={channel.id}
          channelCatalogCursor={7}
          channels={[channel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector(".channel-message-virtual-list")?.getAttribute(
        "data-virtualized",
      ),
    ).toBe("true");
    expect(container.querySelectorAll("[data-channel-message-id]").length).toBeLessThan(
      history.length,
    );
  });





  it("displays emoji reaction optimistically before the server responds", async () => {
    const target = message({
      id: "message-optimistic-reaction",
      reactions: [],
    });
    const pendingRequest = deferred<{ message: ChannelMessage }>();
    toggleChannelMessageReaction.mockReturnValue(pendingRequest.promise);

    await render([target]);

    const quickReactionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".channel-message-actions .channel-quick-reaction",
      ),
    ).find((button) => button.getAttribute("title") === "👍");
    expect(quickReactionButton).not.toBeNull();

    // Click quick reaction button
    await act(async () => {
      quickReactionButton?.click();
    });

    // Reaction should appear optimistically immediately before network response resolves
    const optimisticChip = container.querySelector<HTMLButtonElement>(
      ".channel-reaction-chip",
    );
    expect(optimisticChip).not.toBeNull();
    expect(optimisticChip?.textContent).toContain("👍");
    expect(optimisticChip?.textContent).toContain("1");
    expect(optimisticChip?.className).toContain("is-mine");

    // Resolve network request
    await act(async () => {
      pendingRequest.resolve({
        message: message({
          id: target.id,
          reactions: [{ emoji: "👍", count: 1, userIds: ["user-1"] }],
        }),
      });
      await Promise.resolve();
    });

    const settledChip = container.querySelector<HTMLButtonElement>(
      ".channel-reaction-chip",
    );
    expect(settledChip).not.toBeNull();
    expect(settledChip?.textContent).toContain("👍");
    expect(settledChip?.textContent).toContain("1");
  });

  it("reverts optimistic emoji reaction and shows an error toast when server request fails", async () => {
    const target = message({
      id: "message-failed-reaction",
      reactions: [],
    });
    const pendingRequest = deferred<{ message: ChannelMessage }>();
    toggleChannelMessageReaction.mockReturnValue(pendingRequest.promise);

    await render([target]);

    const quickReactionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".channel-message-actions .channel-quick-reaction",
      ),
    ).find((button) => button.getAttribute("title") === "❤️");
    expect(quickReactionButton).not.toBeNull();

    // Click reaction button
    await act(async () => {
      quickReactionButton?.click();
    });

    // Optimistically visible
    expect(container.querySelector(".channel-reaction-chip")).not.toBeNull();
    expect(container.querySelector(".channel-reaction-chip")?.textContent).toContain("❤️");

    // Fail the network request
    await act(async () => {
      pendingRequest.reject(new Error("리액션을 저장하지 못했습니다"));
      await Promise.resolve();
    });

    // Optimistic emoji should be removed
    expect(container.querySelector(".channel-reaction-chip")).toBeNull();

    // Error toast should be visible
    const toast = document.body.querySelector('[data-testid="app-toast"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("리액션을 저장하지 못했습니다");
    expect(toast?.className).toContain("error");
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain("Requested reply");
  });

  it("places the typing state below the visible reply summary", async () => {
    const target = message({ id: "message-1", replyCount: 2 });
    listChannels.mockResolvedValue({ channels: [channel], cursor: 7 });
    loadChannel.mockResolvedValue({
      channel,
      members: [member],
      agents: [agent],
      messages: [target],
      agentReplies: [agentReply({ parentMessageId: target.id, triggerMessageId: target.id })],
      nextCursor: null,
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
        <ToastProvider>
          <Channels
            activeChannelId={channel.id}
            channels={[channel]}
            currentUserId="user-1"
            onChannelSelect={() => undefined}
            onChannelsChange={() => undefined}
            organizationId="org-1"
            token="token"
          />
        </ToastProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = container.querySelector<HTMLElement>(
      `[data-channel-message-id="${target.id}"]`,
    );
    const summary = row?.querySelector<HTMLElement>(
      ".conversation-reply-summary",
    );
    const typing = row?.querySelector<HTMLElement>(".channel-typing");
    expect(summary?.textContent).toContain("답글 2개");
    expect(typing?.textContent).toContain("Honey님이 답변을 작성하고 있습니다");
    expect(
      Boolean(summary && typing &&
        (summary.compareDocumentPosition(typing) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
  });

  it("subscribes and unsubscribes from the open channel thread", async () => {
    const rootMessage = message({
      id: "message-root",
      replyCount: 1,
      subscribers: [{ userId: "user-1", subscribedAt: "2026-08-01T01:00:00.000Z" }],
    });
    const reply = message({
      id: "message-reply",
      parentMessageId: "message-root",
      body: "Requested reply",
    });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage, reply] });
    updateChannelThreadSubscription.mockResolvedValue({
      rootMessageId: rootMessage.id,
      subscribers: [],
    });

    await render(
      [rootMessage],
      {
        channelId: channel.id,
        messageId: reply.id,
        rootMessageId: rootMessage.id,
      },
    );

    const subscribeButton = container.querySelector<HTMLButtonElement>(
      ".channel-thread .issue-subscribe-button",
    );
    expect(subscribeButton?.textContent).toContain("구독 중");
    await act(async () => subscribeButton?.click());
    expect(updateChannelThreadSubscription).toHaveBeenCalledWith(
      "token",
      "org-1",
      channel.id,
      rootMessage.id,
      false,
    );
  });

  it("marks channel and thread headers as deep window drag regions", async () => {
    const rootMessage = message({ id: "message-root", replyCount: 1 });
    const reply = message({
      id: "message-reply",
      parentMessageId: "message-root",
      body: "Requested reply",
    });
    listChannelMessages.mockResolvedValue({ messages: [rootMessage, reply] });

    await render(
      [rootMessage],
      {
        channelId: channel.id,
        messageId: reply.id,
        rootMessageId: rootMessage.id,
      },
    );

    const channelHeader = container.querySelector(".channel-header");
    expect(channelHeader?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(
      channelHeader?.querySelector("button")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);

    const threadHeader = container.querySelector(".channel-thread > header");
    expect(threadHeader?.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(
      threadHeader?.querySelector("button")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });




  it("shows a sent message immediately without a sending label and reconciles the same row", async () => {
    const pending = deferred<{
      message: ChannelMessage;
      agentReplies: [];
    }>();
    sendChannelMessage.mockReturnValue(pending.promise);
    await render([message()]);

    const textarea = container.querySelector<HTMLTextAreaElement>(
      "form.channel-composer textarea",
    )!;
    await typeInto(textarea, "바로 보이는 메시지");
    await act(async () => {
      container
        .querySelector("form.channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const optimistic = container.querySelector<HTMLElement>(
      ".channel-message.is-optimistic",
    );
    expect(optimistic?.textContent).toContain("바로 보이는 메시지");
    expect(optimistic?.querySelector(".conversation-message-sending"))
      .toBeNull();
    const input = sendChannelMessage.mock.calls[0]?.[3] as {
      clientMessageId: string;
    };
    expect(input.clientMessageId).toEqual(expect.any(String));

    await act(async () => {
      pending.resolve({
        message: message({
          id: input.clientMessageId,
          body: "바로 보이는 메시지",
        }),
        agentReplies: [],
      });
      await pending.promise;
    });

    expect(container.querySelector(".channel-message.is-optimistic")).toBeNull();
    expect(
      container.querySelectorAll(
        `[data-channel-message-id="${input.clientMessageId}"]`,
      ),
    ).toHaveLength(1);
  });

  it("sends the picked Agent as a structured mention rather than parsing the text", async () => {
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-2", body: "@Honey draft it" }),
      agentReplies: [],
    });

    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@hon");
    const suggestion = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".channel-mention-menu button",
      ),
    ].find((button) => button.textContent?.includes("@Honey"));
    expect(suggestion).toBeDefined();
    expect(suggestion?.querySelector("img")?.getAttribute("src")).toBe(
      agent.avatar,
    );
    await act(async () => {
      suggestion!.click();
    });
    const composerMention = container.querySelector<HTMLButtonElement>(
      ".channel-composer-field .conversation-mention-button[data-mention-handle='Honey']",
    );
    expect(composerMention?.textContent).toBe("@Honey");
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
    expect(sendChannelMessage.mock.calls[0]?.[3]).not.toHaveProperty(
      "preferredDeviceId",
    );
  });


  it("explains immediately when an Agent mention has no available Worker", async () => {
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-no-worker", body: "@Honey help" }),
      agentReplies: [{
        id: "reply-no-worker",
        agentId: agent.agentId,
        channelId: channel.id,
        triggerMessageId: "message-no-worker",
        parentMessageId: "message-no-worker",
        replyMessageId: "agent-message-no-worker",
        status: "failed",
        attempts: 0,
        error: channelReplyNoAvailableWorkerError,
        createdAt: "2026-08-01T01:00:01.000Z",
        updatedAt: "2026-08-01T01:00:01.000Z",
      }],
    });

    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@hon");
    const suggestion = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".channel-mention-menu button",
      ),
    ].find((button) => button.textContent?.includes("@Honey"));
    await act(async () => suggestion!.click());
    await typeInto(textarea, `${textarea.value}help`);
    await act(async () => {
      container
        .querySelector("form.channel-composer")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.querySelector(".channel-error")?.textContent).toContain(
      "이 Agent를 실행할 수 있는 사용 가능한 Worker가 없습니다.",
    );
  });


  it("does not attach a mention whose handle was typed but never picked", async () => {
    await render([message()]);
    sendChannelMessage.mockResolvedValue({
      message: message({ id: "message-3" }),
      agentReplies: [],
    });

    const textarea = container.querySelector("textarea")!;
    await typeInto(textarea, "@Honey are you there");
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
          author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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


  it("keeps a newer transferred proposal over a delayed approval response", async () => {
    vi.useFakeTimers();
    const pendingProposal = message({
      id: "message-delayed-approval",
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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
      author: { type: "agent", id: "agent-1", name: "Honey", provider: "claude", image: null },
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
        image: null,
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


  it("offers a retry when a channel document cannot be loaded", async () => {
    loadChannelMessageDocument
      .mockRejectedValueOnce(new Error("document unavailable"))
      .mockResolvedValueOnce({
        document: {
          messageId: "message-document-retry",
          title: "Recovery plan",
          projectId: "project-1",
          markdown: "# Recovered",
        },
      });
    await render([
      message({
        id: "message-document-retry",
        document: {
          messageId: "message-document-retry",
          title: "Recovery plan",
          projectId: "project-1",
        },
      }),
    ]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-document-card")?.click();
    });
    await act(async () => Promise.resolve());
    const alert = document.querySelector<HTMLElement>(
      '[role="dialog"] .channel-document-state[role="alert"]',
    );
    expect(alert?.textContent).toContain("문서를 불러오지 못했습니다.");

    await act(async () => alert?.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => Promise.resolve());
    expect(document.querySelector("[role=dialog] h1")?.textContent).toBe("Recovered");
    expect(loadChannelMessageDocument).toHaveBeenCalledTimes(2);
  });


});
