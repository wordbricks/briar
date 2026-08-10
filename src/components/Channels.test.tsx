/** @vitest-environment jsdom */

import { act } from "react";
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
const listChannelMessages = vi.fn();
const createChannel = vi.fn();
const loadOrganizationMembers = vi.fn();
const listOrganizationAgents = vi.fn();
const setChannelMember = vi.fn();
const setChannelAgent = vi.fn();
const toggleChannelMessageReaction = vi.fn();

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  loadChannelDelta: (...args: unknown[]) => loadChannelDelta(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
  acceptChannelProposal: (...args: unknown[]) => acceptChannelProposal(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  createChannel: (...args: unknown[]) => createChannel(...args),
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembers(...args),
  listOrganizationAgents: (...args: unknown[]) => listOrganizationAgents(...args),
  setChannelMember: (...args: unknown[]) => setChannelMember(...args),
  setChannelAgent: (...args: unknown[]) => setChannelAgent(...args),
  toggleChannelMessageReaction: (...args: unknown[]) =>
    toggleChannelMessageReaction(...args),
}));

vi.mock("@emoji-mart/data", () => ({ default: {} }));
vi.mock("@emoji-mart/react", () => ({
  default: () => null,
}));

const { Channels } = await import("./Channels");

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
  provider: "claude",
  model: null,
  effort: null,
  skills: [],
  projectId: null,
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
  provider: "codex",
  model: null,
  effort: null,
  skills: [],
  projectId: "project-1",
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

  it("shows hover quick reactions and toggles an existing reaction chip", async () => {
    const reacted = message({
      id: "message-reacted",
      reactions: [
        { emoji: "👍", count: 1, userIds: ["user-1"] },
      ],
    });
    toggleChannelMessageReaction.mockResolvedValue({
      message: message({
        id: reacted.id,
        reactions: [],
      }),
    });
    await render([reacted]);

    expect(container.querySelector(".channel-message-actions")).not.toBeNull();
    expect(container.querySelector(".channel-reaction-chip")).not.toBeNull();
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
            payload: {},
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
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
      resultRunId: "run-9",
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
    });

    expect(acceptChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      "channel-1",
      "proposal-1",
      "project-1",
    );
    expect(onIssueCreated).toHaveBeenCalledWith("run-9");
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
      container.querySelector<HTMLButtonElement>(".channel-thread-link")?.click();
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
