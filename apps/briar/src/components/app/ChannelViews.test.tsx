/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { ChannelSummary } from "../../lib/channels-contract";
import { activeOrganizationIdAtom, organizationsAtom } from "../../state/organization/atoms";
import { lockedTeamIdAtom } from "../../state/platform";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeChannelIdAtom } from "../../state/channels/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { Organization, SessionUser } from "../../types";
import { ChannelsWithCatalog } from "./ChannelViews";

/*
  What Phase 4 promises the conversation views.

  The catalog was a `useState` on the app shell, so an unread flag arriving on
  a delta re-rendered the shell and every view it drew. The shell renders zero
  times now and the channel view alone reflects the change.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: "org-1",
  name: "Org One",
  handle: "org-one",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const general: ChannelSummary = {
  id: "channel-1",
  organizationId: organization.id,
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
  topic: channel.topic ?? undefined,
  visibility: 1,
  defaultProjectId: channel.defaultProjectId ?? undefined,
  memberCount: channel.memberCount,
  agentCount: channel.agentCount,
  createdAt: channel.createdAt,
  updatedAt: channel.updatedAt,
  kind: 1,
  hasUnread: channel.hasUnread,
  directMessageParticipants: [],
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [lockedTeamIdAtom, null],
  ]);
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels: [general],
  });
  registry.set(activeChannelIdAtom, general.id);
  return registry;
};

const flush = async (attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

beforeEach(() => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    WebSocket: class extends EventTarget {
      close() {
        this.dispatchEvent(new Event("close"));
      }
    },
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.endsWith("/GetChannel")
        ? jsonResponse({
            channel: channelSummaryWire(general),
            members: [],
            agents: [],
            messages: [],
            agentReplies: [],
          })
        : jsonResponse({});
    }),
  });
  window.localStorage.setItem("briar.locale.v1", "en");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChannelsWithCatalog", () => {
  it("renders a catalog delta without re-rendering the shell", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function AppShell() {
      // Stands in for App.tsx: it owns the navigation callbacks and subscribes
      // to nothing the channel view renders from.
      renders.useRenderCount("shell");
      return (
        <ChannelsWithCatalog
          activeChannelId={general.id}
          onChannelSelect={() => undefined}
        />
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <AppShell />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await flush();
    expect(view.container.querySelector("h2")?.textContent).toBe("General");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-catalog-delta",
        organizationId: organization.id,
        channels: [{ ...general, name: "Announcements" }],
        removedChannelIds: [],
        reset: false,
      });
    });
    await flush();

    // The shell that used to own the catalog never hears about it…
    renders.expectRenderCounts({});
    // …and the view that displays it did update.
    expect(view.container.querySelector("h2")?.textContent).toBe(
      "Announcements",
    );

    await view.cleanup();
  });

  it("renders nothing before an organization is selected", async () => {
    const registry = harness();
    registry.set(activeOrganizationIdAtom, null);
    const view = createReactTestRoot();

    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <ChannelsWithCatalog
            activeChannelId={null}
            onChannelSelect={() => undefined}
          />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await flush(1);

    expect(view.container.textContent).toBe("");

    await view.cleanup();
  });
});
