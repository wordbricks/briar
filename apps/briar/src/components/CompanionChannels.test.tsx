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
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

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
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return new Response(JSON.stringify({
            url: "ws://realtime.test/socket",
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        if (/\/organizations\/org-1\/channels$/u.test(url)) {
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
            messages: [],
            agentReplies: [],
            nextCursor: null,
          }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    });
    window.localStorage.setItem("briar.locale.v1", "en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    await act(async () => back?.click());
    expect(container.textContent).toContain("General");
    await cleanup();
  });
});
