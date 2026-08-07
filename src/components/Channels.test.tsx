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

const listChannels = vi.fn();
const loadChannel = vi.fn();
const loadChannelDelta = vi.fn();
const sendChannelMessage = vi.fn();
const acceptChannelProposal = vi.fn();
const listChannelMessages = vi.fn();
const createChannel = vi.fn();

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  loadChannelDelta: (...args: unknown[]) => loadChannelDelta(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
  acceptChannelProposal: (...args: unknown[]) => acceptChannelProposal(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  createChannel: (...args: unknown[]) => createChannel(...args),
}));

const { Channels } = await import("./Channels");

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

  const render = async (messages: ChannelMessage[]) => {
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
            resultIdeaId: null,
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
          ideaId: "idea-1",
          title: "Onboarding plan",
          status: "ready",
          version: 1,
          projectId: null,
        },
      }),
    ]);
    const card = container.querySelector(".channel-document-card");
    expect(card?.textContent).toContain("Onboarding plan");
    expect(card?.textContent).toContain("조직 문서");
  });
});
