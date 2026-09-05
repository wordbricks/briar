/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { RegistryContext } from "@effect/atom-react";
import { createTestRegistry } from "../state/registry";
import { channelCatalogCursorAtom } from "../state/channels/atoms";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { applySyncEvent } from "../state/sync/apply";
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
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
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
      <RegistryContext.Provider value={createTestRegistry()}>
      <I18nProvider>
        <CompanionChannels
          activeProjectId={null}
          currentUserId="user-1"
          onLobbyOpen={onLobbyOpen}
          organizationId="org-1"
          projects={[]}
          token="token"
        />
      </I18nProvider>
      </RegistryContext.Provider>,
    );

    const firstButton = container.querySelector<HTMLButtonElement>(
      ".companion-channels > button",
    );
    expect(firstButton?.textContent).toContain("View team home");
    await act(async () => firstButton?.click());
    expect(onLobbyOpen).toHaveBeenCalledOnce();
    await cleanup();
  });

  it("preserves the mobile channel stack and accessible back navigation", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    // The list is the shared catalog's, not a fetch this screen makes, so the
    // case seeds the catalog the way `useChannelCatalogSync` would have.
    const registry = createTestRegistry([
      [activeOrganizationIdAtom, "org-1"],
      [channelCatalogCursorAtom, 1],
    ]);
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-1",
      channels: [selectedChannel],
    });
    await renderReactTestRoot(
      root,
      <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <CompanionChannels
          activeProjectId={null}
          currentUserId="user-1"
          organizationId="org-1"
          projects={[]}
          token="token"
        />
      </I18nProvider>
      </RegistryContext.Provider>,
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

  it("groups the shared catalog without asking for it again", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const registry = createTestRegistry([
      [activeOrganizationIdAtom, "org-1"],
      [channelCatalogCursorAtom, 1],
    ]);
    applySyncEvent(registry, {
      kind: "channel-catalog-snapshot",
      organizationId: "org-1",
      channels: [
        selectedChannel,
        { ...selectedChannel, id: "channel-2", name: "Web", defaultProjectId: "project-1" },
        { ...selectedChannel, id: "channel-dm", name: "Direct", kind: "dm" },
      ],
    });
    await renderReactTestRoot(
      root,
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <CompanionChannels
            activeProjectId="project-1"
            currentUserId="user-1"
            organizationId="org-1"
            projects={[{ id: "project-1", name: "Briar web" }]}
            token="token"
          />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await act(async () => Promise.resolve());

    // Common channels first, then the active project's, and direct messages
    // stay on their own page.
    const dividers = [
      ...container.querySelectorAll(".companion-channel-divider"),
    ].map((node) => node.textContent);
    expect(dividers).toEqual(["Common channels", "Briar web"]);
    expect(container.textContent).toContain("Web");
    expect(container.textContent).toContain("General");
    expect(container.textContent).not.toContain("Direct");

    const requested = (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([input]) =>
      String(input instanceof Request ? input.url : input),
    );
    expect(
      requested.filter((url) =>
        url.endsWith("/briar.app.v1.ChannelService/ListChannels"),
      ),
    ).toEqual([]);

    await cleanup();
  });
});
