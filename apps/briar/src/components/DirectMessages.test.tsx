/** @vitest-environment jsdom */

import { act, useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { RegistryContext } from "@effect/atom-react";
import { createTestRegistry } from "../state/registry";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { tokenAtom } from "../state/session/atoms";
import * as api from "../lib/api";
import type { ChannelSummary } from "../lib/channels-contract";
import {
  createReactTestRoot,
  renderReactTestRoot,
  settle,
} from "../test/react";
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
  has no sidebar row and no unread count. The view that opens one holds it,
  fetched by id, and hands it to the timeline as if the sidebar had. Both
  arrangements do this, so the fixtures below are shared.
*/

/** The conversation the catalog does not hold, as the wire sends it. */
const agentConversationWire = {
  id: "agent-dm-1",
  workspaceId: "org-1",
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

/** The realtime handshake and the conversation service, as one stub. */
const stubChannelFetch = (
  channel: (body: string) => unknown,
) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const match = url.match(/\/briar\.app\.v1\.ChannelService\/([A-Za-z]+)$/u);
      if (!match) return jsonResponse({ url: "ws://realtime.test/socket" });
      if (match[1] !== "GetChannel") return jsonResponse({});
      const body = input instanceof Request
        ? await input.clone().text()
        : typeof init?.body === "string"
        ? init.body
        : init?.body
        ? await new Response(init.body).text()
        : "";
      return jsonResponse(channel(body));
    }),
  );

const stubBrowserApis = () => {
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
  });
  window.localStorage.setItem("briar.locale.v1", "en");
};

describe("DirectMessageConversationPane", () => {
  beforeEach(stubBrowserApis);

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

/*
  The same thing on the phone, where the list and the conversation share one
  view. The relay row is the entry point a reader actually has there: the
  conversation it opens has no row in the list beside it, so leaving it has to
  put the reader back where they came from.
*/
describe("DirectMessages, opening an Agent conversation", () => {
  const originDirectMessage: ChannelSummary = {
    id: "channel-1",
    organizationId: "org-1",
    slug: "channel-1",
    name: "Ava",
    topic: null,
    visibility: "private",
    defaultProjectId: null,
    archivedAt: null,
    memberCount: 1,
    agentCount: 1,
    kind: "dm",
    createdByUserId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastMessageAt: "2026-09-02T09:00:00.000Z",
    lastMessagePreview: "Check the ticker now",
    lastReadAt: null,
    hasUnread: false,
    dmParticipants: [{ type: "agent", id: "agent-a", name: "Ava", image: null }],
    pinnedAt: null,
    sidebarSectionId: null,
    hiddenAt: null,
    readOnly: false,
  };

  const originDirectMessageWire = {
    id: originDirectMessage.id,
    workspaceId: "org-1",
    slug: originDirectMessage.slug,
    name: originDirectMessage.name,
    visibility: 2,
    memberCount: 1,
    agentCount: 1,
    createdAt: originDirectMessage.createdAt,
    updatedAt: originDirectMessage.updatedAt,
    kind: 2,
    readOnly: false,
    hasUnread: false,
    directMessageParticipants: [{ kind: 2, id: "agent-a", name: "Ava" }],
  };

  /** Ava's notice that she wrote to Bay, and the link into that conversation. */
  const relayNoticeWire = {
    id: "message-1",
    channelId: originDirectMessage.id,
    body: "Check the ticker now",
    blocks: [],
    author: { agent: { id: "agent-a", name: "Ava" } },
    mentionedUserIds: [],
    mentionedAgentIds: [],
    attachments: [],
    reactions: [],
    replyCount: 0,
    replyAuthors: [],
    subscribers: [],
    createdAt: "2026-09-02T09:00:00.000Z",
    relay: {
      direction: 1,
      peerChannelId: "agent-dm-1",
      peerMessageId: "peer-message-1",
      peerAgentId: "agent-b",
      peerAgentName: "Bay",
      status: 2,
    },
  };

  beforeEach(stubBrowserApis);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the conversation a relay row points at and comes back to it", async () => {
    stubChannelFetch((body) =>
      body.includes("agent-dm-1")
        ? {
            channel: agentConversationWire,
            members: [],
            agents: [],
            messages: [],
            agentReplies: [],
          }
        : {
            channel: originDirectMessageWire,
            members: [],
            agents: [],
            messages: [relayNoticeWire],
            agentReplies: [],
          }
    );
    const selections: (string | null)[] = [];
    /** Every catalog the view wrote, so the conversation can be looked for. */
    const catalogs: string[][] = [];

    /*
      The shell's half of the companion page: what is open, and the catalog.
      Both writers are held, as the store's own actions are — an unstable one
      would restart the conversation load it feeds on every render.
    */
    function CompanionDirectMessages() {
      const [activeChannelId, setActiveChannelId] = useState<string | null>(
        originDirectMessage.id,
      );
      const [catalog, setCatalog] = useState<ChannelSummary[]>([
        originDirectMessage,
      ]);
      const selectChannel = useCallback((channelId: string | null) => {
        selections.push(channelId);
        setActiveChannelId(channelId);
      }, []);
      const replaceCatalog = useCallback(
        (update: Parameters<typeof setCatalog>[0]) =>
          setCatalog((current) => {
            const next = typeof update === "function"
              ? update(current)
              : update;
            catalogs.push(next.map((channel) => channel.id));
            return next;
          }),
        [],
      );
      return (
        <DirectMessages
          activeChannelId={activeChannelId}
          channelCatalogCursor={0}
          channels={catalog}
          currentUserId="user-1"
          isSidebarOpen
          onChannelSelect={selectChannel}
          onChannelsChange={replaceCatalog}
          organizationId="org-1"
          token="token"
        />
      );
    }

    const view = createReactTestRoot();
    await view.render(
      <RegistryContext.Provider
        value={createTestRegistry([
          [tokenAtom, "token"],
          [activeOrganizationIdAtom, "org-1"],
        ])}
      >
        <I18nProvider>
          <CompanionDirectMessages />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    const { container } = view;
    await settle(
      () => container.querySelector(".channel-relay-open") !== null,
      { description: "the relay row" },
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-relay-open")?.click();
    });
    await settle(
      () => container.querySelector(".channel-readonly-badge") !== null,
      { description: "the read-only conversation" },
    );

    expect(selections).toEqual(["agent-dm-1"]);
    expect(container.querySelector(".channel-header")?.textContent)
      .toContain("Ava, Bay");
    expect(container.querySelector(".channel-composer")).toBeNull();
    // The list beside it still holds one conversation — the reader's own — and
    // the phone shows the conversation rather than that list.
    const rows = [
      ...container.querySelectorAll(".dm-conversation-list button"),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).not.toContain("Bay");
    expect(container.querySelector(".dm-list-pane")?.className)
      .toContain("max-[760px]:hidden");
    // Never in the catalog, so never in the list, the search or the unread
    // count the bottom bar draws.
    expect(catalogs.every((ids) => !ids.includes("agent-dm-1"))).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-header-back")
        ?.click();
    });
    await settle(
      () => container.querySelector(".channel-relay-open") !== null,
      { description: "the conversation the reader came from" },
    );

    // Back goes to the conversation the relay row was in, not to the list.
    expect(selections).toEqual(["agent-dm-1", originDirectMessage.id]);
    expect(container.querySelector(".channel-readonly-badge")).toBeNull();

    await view.cleanup();
  });

  it("returns to the list when the conversation was opened from elsewhere", async () => {
    stubChannelFetch(() => ({
      channel: agentConversationWire,
      members: [],
      agents: [],
      messages: [],
      agentReplies: [],
    }));
    const selections: (string | null)[] = [];
    const view = createReactTestRoot();
    await view.render(
      <RegistryContext.Provider
        value={createTestRegistry([
          [tokenAtom, "token"],
          [activeOrganizationIdAtom, "org-1"],
        ])}
      >
        <I18nProvider>
          <DirectMessages
            activeChannelId="agent-dm-1"
            channelCatalogCursor={0}
            channels={[originDirectMessage]}
            currentUserId="user-1"
            isSidebarOpen
            onChannelSelect={(channelId) => selections.push(channelId)}
            onChannelsChange={() => undefined}
            organizationId="org-1"
            token="token"
          />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    const { container } = view;
    await settle(
      () => container.querySelector(".channel-readonly-badge") !== null,
      { description: "the read-only conversation" },
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".channel-header-back")
        ?.click();
    });

    // An Agent's own page sent the reader here, so there is no conversation to
    // go back to: the phone shows its list again.
    expect(selections).toEqual([null]);

    await view.cleanup();
  });
});
