/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ChannelSummary } from "../lib/channels-contract";
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
});
