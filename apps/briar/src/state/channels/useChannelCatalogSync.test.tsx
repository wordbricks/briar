/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelDelta, ChannelSummary } from "../../lib/channels-contract";
import { createReactTestRoot } from "../../test/react";
import { organizationChannelIdsAtom } from "../entities/channels";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { channelApiAtom, type ChannelApi } from "./api";
import {
  activeChannelIdAtom,
  activeOrganizationChannelsAtom,
  channelCatalogCursorAtom,
  channelsLoadingAtom,
} from "./atoms";
import {
  CHANNEL_CATALOG_RETRY_MS,
  useChannelCatalogSync,
} from "./useChannelCatalogSync";

const channel = (
  id: string,
  overrides: Partial<ChannelSummary> = {},
): ChannelSummary => ({
  id,
  organizationId: "org-a",
  kind: "channel",
  slug: id,
  name: id,
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  ...overrides,
});

const emptyDelta = (cursor: number): ChannelDelta => ({
  cursor,
  hasMore: false,
  reset: false,
  channels: [],
  removedChannelIds: [],
  messages: [],
  removedMessageIds: [],
  agentReplies: [],
});

/** An in-memory catalog: no network, no realtime socket, no timers of its own. */
class CatalogServer {
  catalogs = new Map<string, { channels: ChannelSummary[]; cursor: number }>();
  deltas: ChannelDelta[] = [];
  listFailures = 0;
  readonly listRequests: string[] = [];
  readonly deltaRequests: { organizationId: string; since: number }[] = [];
  notify: ((notification: { topic: string; cursor: number }) => void) | null =
    null;

  readonly api: Partial<ChannelApi> = {
    listChannels: async (_token, organizationId) => {
      this.listRequests.push(organizationId);
      if (this.listFailures > 0) {
        this.listFailures -= 1;
        throw new Error("catalog unavailable");
      }
      return (
        this.catalogs.get(organizationId) ?? { channels: [], cursor: 0 }
      );
    },
    loadChannelDelta: async (_token, organizationId, since) => {
      this.deltaRequests.push({ organizationId, since });
      return this.deltas.shift() ?? emptyDelta(since);
    },
    createChannelRealtimeTransport: (() => ({
      start: () => {},
      stop: () => {},
      subscribe: (listener: (notification: never) => void) => {
        this.notify = listener as never;
        return () => {
          this.notify = null;
        };
      },
    })) as unknown as ChannelApi["createChannelRealtimeTransport"],
  };
}

function Effects() {
  useChannelCatalogSync();
  return null;
}

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Effects />
    </RegistryContext.Provider>,
  );
  return view;
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const harness = (server: CatalogServer, organizationId: string | null) =>
  createTestRegistry([
    [activeOrganizationIdAtom, organizationId],
    [tokenAtom, "token-1"],
    [lockedTeamIdAtom, null],
    [channelApiAtom, server.api],
  ]);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useChannelCatalogSync", () => {
  it("loads the catalog for the active organization", async () => {
    const server = new CatalogServer();
    server.catalogs.set("org-a", { channels: [channel("general")], cursor: 4 });
    const registry = harness(server, "org-a");

    const view = await mount(registry);
    await settle();

    expect(server.listRequests).toEqual(["org-a"]);
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["general"]);
    expect(registry.get(channelCatalogCursorAtom)).toBe(4);
    expect(registry.get(channelsLoadingAtom)).toBe(false);

    await view.cleanup();
  });

  it("drops the previous organization's catalog and selection on a switch", async () => {
    const server = new CatalogServer();
    server.catalogs.set("org-a", { channels: [channel("general")], cursor: 4 });
    server.catalogs.set("org-b", {
      channels: [channel("other", { organizationId: "org-b" })],
      cursor: 9,
    });
    const registry = harness(server, "org-a");
    const view = await mount(registry);
    await settle();
    registry.set(activeChannelIdAtom, "general");

    await act(async () => registry.set(activeOrganizationIdAtom, "org-b"));
    await settle();

    expect(registry.get(organizationChannelIdsAtom("org-a"))).toBeNull();
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["other"]);
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    expect(registry.get(channelCatalogCursorAtom)).toBe(9);

    // Returning does not resurrect what was open in the first organization.
    await act(async () => registry.set(activeOrganizationIdAtom, "org-a"));
    await settle();
    expect(registry.get(activeChannelIdAtom)).toBeNull();

    await view.cleanup();
  });

  it("retries a failed catalog load", async () => {
    const server = new CatalogServer();
    server.listFailures = 1;
    server.catalogs.set("org-a", { channels: [channel("general")], cursor: 2 });
    const registry = harness(server, "org-a");

    const view = await mount(registry);
    await settle();
    expect(server.listRequests).toEqual(["org-a"]);
    expect(registry.get(channelCatalogCursorAtom)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(CHANNEL_CATALOG_RETRY_MS);
    });
    await settle();

    expect(server.listRequests).toEqual(["org-a", "org-a"]);
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["general"]);

    await view.cleanup();
  });

  it("applies a realtime delta through the sync entry point", async () => {
    const server = new CatalogServer();
    server.catalogs.set("org-a", { channels: [channel("general")], cursor: 4 });
    const registry = harness(server, "org-a");
    const view = await mount(registry);
    await settle();

    server.deltas.push({
      ...emptyDelta(5),
      channels: [channel("announcements", { hasUnread: true })],
      removedChannelIds: ["general"],
    });
    await act(async () => server.notify?.({ topic: "channels", cursor: 5 }));
    await settle();

    expect(server.deltaRequests[0]).toEqual({
      organizationId: "org-a",
      since: 4,
    });
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["announcements"]);

    await view.cleanup();
  });

  it("loads nothing without a token", async () => {
    const server = new CatalogServer();
    const registry = createTestRegistry([
      [activeOrganizationIdAtom, "org-a"],
      [tokenAtom, null],
      [lockedTeamIdAtom, null],
      [channelApiAtom, server.api],
    ]);

    const view = await mount(registry);
    await settle();

    expect(server.listRequests).toEqual([]);
    expect(registry.get(channelsLoadingAtom)).toBe(false);

    await view.cleanup();
  });
});
