/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ChannelSummary } from "../lib/channels-contract";
import { CompanionChannels } from "./CompanionChannels";

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

const channelSummaryWire = (channel: ChannelSummary) => ({
  id: channel.id,
  organizationId: channel.organizationId,
  slug: channel.slug,
  name: channel.name,
  visibility: 1,
  memberCount: channel.memberCount,
  agentCount: channel.agentCount,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
  kind: 1,
  hasUnread: channel.hasUnread,
  directMessageParticipants: [],
});

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

describe("CompanionChannels", () => {
  beforeEach(() => {
    class FakeWebSocket extends EventTarget {
      close() {
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      WebSocket: FakeWebSocket,
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/briar.app.v1.ChannelService/ListChannels")) {
          return jsonResponse({
            channels: [channelSummaryWire(selectedChannel)],
            cursor: "1",
          });
        }
        if (url.endsWith("/briar.app.v1.ChannelService/GetChannel")) {
          return jsonResponse({
            channel: channelSummaryWire(selectedChannel),
            members: [],
            agents: [],
            messages: [],
            agentReplies: [],
          });
        }
        return jsonResponse({ url: "ws://realtime.test/socket" });
      }),
    });
    window.localStorage.setItem("briar.locale.v1", "en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the project lobby entry before the channel groups", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const onLobbyOpen = vi.fn();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <CompanionChannels
          activeProjectId={null}
          currentUserId="user-1"
          onLobbyOpen={onLobbyOpen}
          organizationId="org-1"
          projects={[]}
          token="token"
        />
      </I18nProvider>,
    );

    const firstButton = container.querySelector<HTMLButtonElement>(
      ".companion-channels > button",
    );
    expect(firstButton?.textContent).toContain("View project home");
    await act(async () => firstButton?.click());
    expect(onLobbyOpen).toHaveBeenCalledOnce();
    await cleanup();
  });

  it("preserves the mobile channel stack and accessible back navigation", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <CompanionChannels
          activeProjectId={null}
          currentUserId="user-1"
          organizationId="org-1"
          projects={[]}
          token="token"
        />
      </I18nProvider>,
    );
    await act(async () => Promise.resolve());

    const channelButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("General"),
    );
    expect(channelButton).not.toBeUndefined();
    await act(async () => channelButton?.click());
    await act(async () => Promise.resolve());

    const back = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Back"]',
    );
    expect(back).not.toBeNull();
    expect(
      container.querySelector(".companion-channel-detail")?.getAttribute(
        "aria-busy",
      ),
    ).toBe("false");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        ".companion-channel-composer textarea",
      ),
    ).not.toBeNull();

    await act(async () => back?.click());
    expect(container.textContent).toContain("General");
    await cleanup();
  });
});
