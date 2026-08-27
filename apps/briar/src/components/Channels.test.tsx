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
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

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
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.method === "POST"
          ? { url: "ws://realtime.test/socket" }
          : {
              channel: selectedChannel,
              members: [],
              agents: [],
              messages: [],
              agentReplies: [],
              nextCursor: null,
            };
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      }),
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
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [],
      reactions: [],
      replyCount: 0,
      lastReplyAt: null,
      document: null,
      proposal: null,
      executionProposal: null,
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return new Response(JSON.stringify({
            url: "ws://realtime.test/socket",
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/organizations/org-1/channels")) {
          return new Response(JSON.stringify({
            channels: [selectedChannel],
            cursor: 1,
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          channel: selectedChannel,
          members: [],
          agents: [],
          messages: [message],
          agentReplies: [],
          nextCursor: null,
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
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
    expect(document.activeElement).toBe(highlighted);

    requestAnimationFrame.mockRestore();
    await cleanup();
  });

  it("keeps an Inbox thread reply centered instead of jumping to the thread end", async () => {
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
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [],
      reactions: [],
      replyCount: 1,
      lastReplyAt: "2026-08-15T00:01:00.000Z",
      document: null,
      proposal: null,
      executionProposal: null,
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return new Response(JSON.stringify({
            url: "ws://realtime.test/socket",
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/organizations/org-1/channels")) {
          return new Response(JSON.stringify({
            channels: [selectedChannel],
            cursor: 1,
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        const isThreadRequest = url.includes("/messages?parentMessageId=");
        return new Response(JSON.stringify({
          channel: selectedChannel,
          members: [],
          agents: [],
          messages: isThreadRequest ? [rootMessage, replyMessage] : [],
          agentReplies: [],
          nextCursor: null,
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
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
          onInboxDetailClose={() => undefined}
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

    requestAnimationFrame.mockRestore();
    await cleanup();
  });
});
