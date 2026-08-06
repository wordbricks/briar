/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ChannelMessage, ChannelSummary } from "../lib/channels-contract";

const listChannels = vi.fn();
const loadChannel = vi.fn();
const listChannelMessages = vi.fn();
const sendChannelMessage = vi.fn();

vi.mock("../lib/api", () => ({
  listChannels: (...args: unknown[]) => listChannels(...args),
  loadChannel: (...args: unknown[]) => loadChannel(...args),
  listChannelMessages: (...args: unknown[]) => listChannelMessages(...args),
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
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
  replyCount,
  lastReplyAt: null,
  document: null,
  proposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
});

describe("CompanionChannels", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  const render = async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <CompanionChannels
            activeProjectId="project-1"
            organizationId="org-1"
            projects={[
              { id: "project-1", name: "Briar" },
              { id: "project-2", name: "Sprout" },
            ]}
            token="token"
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
    });
  });
});
