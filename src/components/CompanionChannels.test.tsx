/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type {
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";

const listChannels = vi.fn();
const loadChannel = vi.fn();
const listChannelMessages = vi.fn();
const sendChannelMessage = vi.fn();
const acceptChannelProposal = vi.fn();
const toggleChannelMessageReaction = vi.fn();

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
  acceptChannelProposal: (...args: unknown[]) => acceptChannelProposal(...args),
  toggleChannelMessageReaction: (...args: unknown[]) =>
    toggleChannelMessageReaction(...args),
}));

vi.mock("@emoji-mart/data", () => ({ default: {} }));
vi.mock("@emoji-mart/react", () => ({
  default: () => null,
}));

const { CompanionChannels } = await import("./CompanionChannels");

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
  createdAt: "2026-08-01T01:00:00.000Z",
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
  provider: "claude",
  model: null,
  effort: null,
  skills: [],
  projectId: null,
  responsibility: "Writing partner",
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("CompanionChannels", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const render = async (
    onIssueOpen?: (projectId: string, runId: string) => void,
    requestedMessage?: { channelId: string; messageId: string; rootMessageId: string },
    onRequestedMessageOpen?: () => void,
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
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listChannels.mockResolvedValue({
      channels: [
        channel("c-other", "Sprout talk", "project-2"),
        channel("c-current", "Briar dev", "project-1"),
        channel("c-common", "Welcome", null),
      ],
      cursor: 1,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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

  it("opens a channel's messages and then one message's thread", async () => {
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
    ).not.toBeNull();

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
      payload: {},
      resultRunId: null,
    };
    loadChannel.mockResolvedValue({
      channel: channel("c-common", "Welcome", null),
      members: [],
      agents: [],
      messages: [proposal],
    });
    acceptChannelProposal.mockResolvedValue({
      outcome: "accepted",
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

    await act(async () => {
      select.value = "project-2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(accept.disabled).toBe(false);
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

  it("opens the result from an already accepted proposal", async () => {
    const proposal = message("m-accepted", "이슈를 만들었습니다");
    proposal.proposal = {
      id: "proposal-2",
      actionType: "request_issue_create",
      status: "accepted",
      projectId: "project-1",
      payload: {},
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
      payload: {},
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
