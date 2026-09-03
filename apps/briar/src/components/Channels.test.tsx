/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ChannelMessage, ChannelSummary } from "../lib/channels-contract";
import { Channels } from "./Channels";

const selectedChannel: ChannelSummary = {
  id: "channel-1",
  organizationId: "org-1",
  slug: "general",
  name: "General",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 0,
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
};

const secondChannel: ChannelSummary = {
  ...selectedChannel,
  id: "channel-2",
  name: "Second",
  slug: "second",
};

const virtualMessage = (channelId: string, index: number): ChannelMessage => ({
  id: `${channelId}-message-${index}`,
  channelId,
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-1",
    name: "Sam",
    email: "sam@example.com",
    image: null,
  },
  body: `메시지 ${index}`,
  blocks: [],
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  replyAuthors: [],
  subscribers: [],
  document: null,
  proposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  createdAt: `2026-08-01T00:${String(index).padStart(2, "0")}:00.000Z`,
});

const channelSummaryWire = (channel: ChannelSummary) => ({
  id: channel.id,
  organizationId: channel.organizationId,
  slug: channel.slug,
  name: channel.name,
  topic: channel.topic ?? undefined,
  visibility: 1,
  defaultProjectId: channel.defaultProjectId ?? undefined,
  memberCount: channel.memberCount,
  agentCount: channel.agentCount,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
  kind: 1,
  hasUnread: channel.hasUnread,
  directMessageParticipants: channel.dmParticipants.map((participant) => ({
    kind: participant.type === "user" ? 1 : 2,
    id: participant.id,
    name: participant.name,
    image: participant.image ?? undefined,
  })),
});

const channelMessageAuthorWire = (author: ChannelMessage["author"]) => {
  switch (author.type) {
    case "user":
      return {
        user: {
          id: author.id,
          name: author.name,
          email: author.email,
          image: author.image ?? undefined,
        },
      };
    case "agent":
      return {
        agent: {
          id: author.id ?? undefined,
          name: author.name,
          image: author.image ?? undefined,
        },
      };
    case "webhook":
      return {
        webhook: {
          id: author.id ?? undefined,
          name: author.name,
        },
      };
  }
};

const channelMessageWire = (message: ChannelMessage) => ({
  id: message.id,
  channelId: message.channelId,
  parentMessageId: message.parentMessageId ?? undefined,
  body: message.body,
  blocks: [],
  author: channelMessageAuthorWire(message.author),
  mentionedUserIds: message.mentionedUserIds,
  mentionedAgentIds: message.mentionedAgentIds,
  attachments: [],
  reactions: [],
  replyCount: message.replyCount,
  lastReplyAt: message.lastReplyAt ?? undefined,
  replyAuthors: [],
  subscribers: [],
  createdAt: message.createdAt,
});

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

const requestUrl = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : String(input);

const requestBodyText = async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => input instanceof Request
  ? input.clone().text()
  : typeof init?.body === "string"
  ? init.body
  : init?.body
  ? new Response(init.body).text()
  : "";

const createChannelFetch = (
  resolve: (method: string, body: string) => unknown,
) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const match = requestUrl(input).match(
    /\/briar\.app\.v1\.ChannelService\/([A-Za-z]+)$/u,
  );
  if (!match) return jsonResponse({ url: "ws://realtime.test/socket" });
  return jsonResponse(await resolve(match[1], await requestBodyText(input, init)));
});

describe("Channels", () => {
  beforeEach(() => {
    class FakeWebSocket extends EventTarget {
      close() {
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      WebSocket: FakeWebSocket,
      fetch: createChannelFetch((method) => method === "GetChannel"
        ? {
            channel: channelSummaryWire(selectedChannel),
            members: [],
            agents: [],
            messages: [],
            agentReplies: [],
          }
        : {}),
    });
    window.localStorage.setItem("briar.locale.v1", "en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the desktop header drag region and accessible channel actions", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <Channels
          activeChannelId={selectedChannel.id}
          channelCatalogCursor={0}
          channels={[selectedChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>,
    );
    await act(async () => Promise.resolve());

    expect(container.querySelector("h2")?.textContent).toBe("General");
    expect(
      container.querySelector(".channel-header")?.getAttribute(
        "data-tauri-drag-region",
      ),
    ).toBe("deep");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="More"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".channel-main")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(
      container.querySelector<HTMLTextAreaElement>(".channel-composer textarea"),
    ).not.toBeNull();

    await cleanup();
  });

  it("loads earlier messages when the desktop timeline reaches the top", async () => {
    const initialMessages = Array.from({ length: 20 }, (_, index) =>
      virtualMessage(selectedChannel.id, index + 20));
    const earlierMessages = Array.from({ length: 20 }, (_, index) =>
      virtualMessage(selectedChannel.id, index));
    const listMessageBodies: string[] = [];
    vi.stubGlobal("fetch", createChannelFetch((method, body) => {
      if (method === "ListChannelMessages") {
        listMessageBodies.push(body);
        return { messages: earlierMessages.map(channelMessageWire) };
      }
      if (method === "GetChannel") {
        return {
          channel: channelSummaryWire(selectedChannel),
          members: [],
          agents: [],
          messages: initialMessages.map(channelMessageWire),
          agentReplies: [],
          nextCursor: "older-cursor",
        };
      }
      return {};
    }));
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <Channels
          activeChannelId={selectedChannel.id}
          channelCatalogCursor={0}
          channels={[selectedChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>,
    );
    await act(async () => Promise.resolve());

    const scroller = container.querySelector<HTMLElement>(".channel-messages");
    expect(scroller).not.toBeNull();
    let scrollTop = 0;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 3000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    scrollTop = 2500;
    scroller?.dispatchEvent(new Event("scroll"));
    scrollTop = 0;
    await act(async () => {
      scroller?.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(listMessageBodies.some((body) =>
      body.includes('"cursor":"older-cursor"'))).toBe(true);
    expect(container.textContent).toContain("메시지 0");
    expect(container.textContent).toContain("메시지 39");

    requestAnimationFrame.mockRestore();
    await cleanup();
  });

  it("highlights and focuses a requested Inbox channel message", async () => {
    const message: ChannelMessage = {
      id: "channel-message-1",
      channelId: selectedChannel.id,
      parentMessageId: null,
      author: {
        type: "user",
        id: "user-1",
        name: "Sam",
        email: "sam@example.com",
        image: null,
      },
      body: "Inbox에서 연 채널 메시지",
      blocks: [],
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [],
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      replyAuthors: [],
      subscribers: [],
      document: null,
      proposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", createChannelFetch((method) =>
      method === "GetChannel"
        ? {
            channel: channelSummaryWire(selectedChannel),
            members: [],
            agents: [],
            messages: [channelMessageWire(message)],
            agentReplies: [],
          }
        : {}));
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <Channels
          activeChannelId={selectedChannel.id}
          channelCatalogCursor={0}
          channels={[selectedChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          requestedMessage={{
            channelId: selectedChannel.id,
            messageId: message.id,
            rootMessageId: message.id,
          }}
          token="token"
        />
      </I18nProvider>,
    );
    await act(async () => Promise.resolve());

    const highlighted = container.querySelector<HTMLElement>(
      '[data-inbox-highlighted="true"]',
    );
    expect(highlighted?.dataset.channelMessageId).toBe(message.id);
    expect(highlighted?.tabIndex).toBe(-1);
    expect(
      container.querySelector(".channel-message header strong")?.textContent,
    ).toBe("Sam");
    expect(document.activeElement).toBe(highlighted);

    requestAnimationFrame.mockRestore();
    await cleanup();
  });

  it("keeps an Inbox thread reply centered and links its channel", async () => {
    const openChannel = vi.fn();
    const onRequestedMessageOpen = vi.fn();
    const rootMessage: ChannelMessage = {
      id: "channel-root-1",
      channelId: selectedChannel.id,
      parentMessageId: null,
      author: {
        type: "user",
        id: "user-1",
        name: "Sam",
        email: "sam@example.com",
        image: null,
      },
      body: "스레드 원본",
      blocks: [],
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [],
      reactions: [],
      replyCount: 1,
      lastReplyAt: "2026-08-15T00:01:00.000Z",
      replyAuthors: [],
      subscribers: [],
      document: null,
      proposal: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    const replyMessage: ChannelMessage = {
      ...rootMessage,
      id: "channel-reply-1",
      parentMessageId: rootMessage.id,
      body: "Inbox에서 연 스레드 답글",
      replyCount: 0,
      lastReplyAt: null,
      createdAt: "2026-08-15T00:01:00.000Z",
    };
    vi.stubGlobal("fetch", createChannelFetch((method, body) => {
      if (method === "ListChannelMessages") {
        return {
          messages: body.includes(rootMessage.id)
            ? [rootMessage, replyMessage].map(channelMessageWire)
            : [],
        };
      }
      if (method === "GetChannel") {
        return {
          channel: channelSummaryWire(selectedChannel),
          members: [],
          agents: [],
          messages: [],
          agentReplies: [],
        };
      }
      return {};
    }));
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <Channels
          activeChannelId={selectedChannel.id}
          channelCatalogCursor={0}
          channels={[selectedChannel]}
          currentUserId="user-1"
          inboxDetail
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          onInboxChannelOpen={openChannel}
          onInboxDetailClose={() => undefined}
          onRequestedMessageOpen={onRequestedMessageOpen}
          organizationId="org-1"
          requestedMessage={{
            channelId: selectedChannel.id,
            messageId: replyMessage.id,
            rootMessageId: rootMessage.id,
          }}
          token="token"
        />
      </I18nProvider>,
    );
    await act(async () => Promise.resolve());

    const highlighted = container.querySelector<HTMLElement>(
      '[data-inbox-highlighted="true"]',
    );
    expect(highlighted?.dataset.channelMessageId).toBe(replyMessage.id);
    expect(container.querySelector(".channel-thread")).not.toBeNull();
    expect(document.activeElement).toBe(highlighted);
    expect(onRequestedMessageOpen).toHaveBeenCalledTimes(1);
    const channelLink = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open #General"]',
    );
    expect(channelLink?.textContent).toContain("General");
    await act(async () => channelLink?.click());
    expect(openChannel).toHaveBeenCalledWith(selectedChannel.id);

    requestAnimationFrame.mockRestore();
    await cleanup();
  });

  it("resets virtualized row measurements when switching channels", async () => {
    const observers: Array<{
      disconnected: boolean;
      targets: Set<Element>;
    }> = [];
    class TrackingResizeObserver {
      readonly targets = new Set<Element>();
      disconnected = false;

      constructor(_callback: ResizeObserverCallback) {
        observers.push(this);
      }

      observe(target: Element) {
        this.targets.add(target);
      }

      disconnect() {
        this.disconnected = true;
      }
    }
    Object.assign(globalThis, { ResizeObserver: TrackingResizeObserver });
    vi.stubGlobal("fetch", createChannelFetch((method, body) => {
      if (method !== "GetChannel") return {};
      const channel = body.includes(secondChannel.id)
        ? secondChannel
        : selectedChannel;
      return {
        channel: channelSummaryWire(channel),
        members: [],
        agents: [],
        messages: Array.from({ length: 45 }, (_, index) =>
          channelMessageWire(virtualMessage(channel.id, index))),
        agentReplies: [],
      };
    }));
    const view = createReactTestRoot({ attachToDocument: true });
    const render = (activeChannelId: string) => (
      <I18nProvider>
        <Channels
          activeChannelId={activeChannelId}
          channelCatalogCursor={0}
          channels={[selectedChannel, secondChannel]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>
    );

    await view.render(render(selectedChannel.id));
    await act(async () => Promise.resolve());
    expect(
      view.container.querySelector('[data-virtualized="true"]'),
    ).not.toBeNull();
    const firstRowObserver = observers.find((observer) =>
      [...observer.targets].some((target) =>
        (target as HTMLElement).dataset.channelVirtualMessageId?.startsWith(
          `${selectedChannel.id}-`,
        ),
      ),
    );
    expect(firstRowObserver).not.toBeUndefined();

    await view.render(render(secondChannel.id));
    await act(async () => Promise.resolve());
    const secondRowObserver = observers.find((observer) =>
      [...observer.targets].some((target) =>
        (target as HTMLElement).dataset.channelVirtualMessageId?.startsWith(
          `${secondChannel.id}-`,
        ),
      ),
    );
    expect(firstRowObserver?.disconnected).toBe(true);
    expect(secondRowObserver).not.toBeUndefined();
    expect(
      [...(secondRowObserver?.targets ?? [])].every((target) =>
        (target as HTMLElement).dataset.channelVirtualMessageId?.startsWith(
          `${secondChannel.id}-`,
        ),
      ),
    ).toBe(true);

    await view.cleanup();
  });
});
