/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { RegistryContext } from "@effect/atom-react";
import { createTestRegistry } from "../state/registry";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { tokenAtom } from "../state/session/atoms";
import * as api from "../lib/api";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import {
  DirectMessageConversationPane,
  DirectMessages,
} from "./DirectMessages";

describe("DirectMessages", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    vi.spyOn(api, "listDirectMessageRecipients").mockResolvedValue({
      members: [{
        userId: "user-1",
        name: "Sam",
        email: "sam@example.com",
        image: null,
        role: "owner",
        createdAt: "2026-08-01T00:00:00.000Z",
        projectIds: [],
      }],
      agents: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the current user as a self-DM recipient", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <RegistryContext.Provider value={createTestRegistry()}>
      <I18nProvider>
        <DirectMessages
          activeChannelId={null}
        channelCatalogCursor={0}
          channels={[]}
          currentUserId="user-1"
          isSidebarOpen
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>
      </RegistryContext.Provider>,
    );
    let selfCandidate: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      selfCandidate = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.includes("Send to yourself"),
      );
      expect(selfCandidate).not.toBeUndefined();
    });
    expect(selfCandidate?.textContent).toContain("Personal notes conversation");

    await act(async () => selfCandidate?.click());
    expect(
      container.querySelector<HTMLButtonElement>(".dm-start-button")?.textContent,
    ).toContain("Send to yourself");
    expect(
      container.querySelector<HTMLButtonElement>(".dm-start-button")?.disabled,
    ).toBe(false);

    await cleanup();
  });

  it("keeps the DM toolbar clear of window navigation when the sidebar is closed", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <RegistryContext.Provider value={createTestRegistry()}>
      <I18nProvider>
        <DirectMessages
          activeChannelId={null}
        channelCatalogCursor={0}
          channels={[]}
          currentUserId="user-1"
          isSidebarOpen={false}
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>
      </RegistryContext.Provider>,
    );

    expect(
      container.querySelector(".dm-list-toolbar")?.className,
    ).toContain("pl-[var(--window-navigation-content-inset)]");

    await cleanup();
  });
});

/*
  Opening an Agent-to-Agent conversation.

  It is not in the catalog and never will be — nobody is a participant, so it
  has no sidebar row and no unread count. The pane holds the one that is open,
  fetched by id, and hands it to the timeline as if the sidebar had.
*/
describe("DirectMessageConversationPane", () => {
  const agentConversationWire = {
    id: "agent-dm-1",
    organizationId: "org-1",
    slug: "agent-dm-1",
    name: "Ava, Bay",
    visibility: 2,
    memberCount: 0,
    agentCount: 2,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    kind: 2,
    readOnly: true,
    hasUnread: false,
    directMessageParticipants: [
      { kind: 2, id: "agent-a", name: "Ava" },
      { kind: 2, id: "agent-b", name: "Bay" },
    ],
  };

  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });

  beforeEach(() => {
    class FakeWebSocket extends EventTarget {
      close() {
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.assign(globalThis, {
      ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      WebSocket: FakeWebSocket,
    });
  });

  it("opens a read-only Agent conversation the catalog does not hold", async () => {
    const getChannelBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const match = url.match(
          /\/briar\.app\.v1\.ChannelService\/([A-Za-z]+)$/u,
        );
        if (!match) return jsonResponse({ url: "ws://realtime.test/socket" });
        if (match[1] === "GetChannel") {
          getChannelBodies.push(
            input instanceof Request
              ? await input.clone().text()
              : typeof init?.body === "string"
              ? init.body
              : "",
          );
          return jsonResponse({
            channel: agentConversationWire,
            members: [],
            agents: [],
            messages: [],
            agentReplies: [],
          });
        }
        return jsonResponse({});
      }),
    );
    const catalogWrites: unknown[] = [];
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <RegistryContext.Provider
        value={createTestRegistry([
          [tokenAtom, "token"],
          [activeOrganizationIdAtom, "org-1"],
        ])}
      >
        <I18nProvider>
          <DirectMessageConversationPane
            activeChannelId="agent-dm-1"
            channelCatalogCursor={0}
            channels={[]}
            composing={false}
            currentUserId="user-1"
            isSidebarOpen
            onChannelSelect={() => undefined}
            onChannelsChange={(value) => catalogWrites.push(value)}
            organizationId="org-1"
            token="token"
          />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await vi.waitFor(() => {
      expect(container.querySelector(".channel-readonly-badge")).not.toBeNull();
    });
    await act(async () => Promise.resolve());

    // The picker does not take over just because the catalog holds no DM, and
    // the conversation never reaches the catalog the sidebar reads.
    expect(container.querySelector(".dm-compose-view")).toBeNull();
    expect(container.querySelector(".channel-composer")).toBeNull();
    // The header names the conversation the fetch returned, which is the only
    // place its identity could have come from.
    expect(container.querySelector(".channel-header")?.textContent)
      .toContain("Ava, Bay");
    expect(getChannelBodies.length).toBeGreaterThan(0);
    expect(catalogWrites).toEqual([]);

    await cleanup();
  });
});
