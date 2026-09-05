import { describe, expect, it } from "vitest";

import type { ActivePage, ChannelNavigationPage } from "../../lib/app-navigation";
import type { ChannelSummary } from "../../lib/channels-contract";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { channelApiAtom, type ChannelApi } from "./api";
import {
  createChannelActions,
  setChannelNavigationBridge,
} from "./actions";
import {
  activeChannelIdAtom,
  activeOrganizationChannelsAtom,
  directMessageComposeAtom,
  initialChannelInviteIdAtom,
  requestedChannelMessageAtom,
  requestedChannelSettingsIdAtom,
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
} from "./atoms";

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

class ChannelServer {
  readonly reads: { channelId: string; lastReadAt?: string }[] = [];
  readonly deleted: string[] = [];

  readonly api: Partial<ChannelApi> = {
    markChannelRead: async (
      _token: string,
      _organizationId: string,
      channelId: string,
      input: { lastReadAt?: string } = {},
    ) => {
      this.reads.push({ channelId, lastReadAt: input.lastReadAt });
      return {
        channel: channel(channelId, {
          hasUnread: false,
          lastReadAt: input.lastReadAt ?? null,
        }),
      };
    },
    createChannel: async (
      _token: string,
      _organizationId: string,
      input: { name: string },
    ) => ({ channel: channel(input.name, { name: input.name }) }),
    deleteChannel: async (
      _token: string,
      _organizationId: string,
      channelId: string,
    ) => {
      this.deleted.push(channelId);
      return { deleted: true };
    },
  };
}

interface Navigations {
  readonly channels: {
    channelId: string;
    page: ChannelNavigationPage;
    organizationId?: string | null;
  }[];
  readonly pages: ActivePage[];
}

const harness = (
  channels: ChannelSummary[],
  { lockedTeamId = null }: { lockedTeamId?: string | null } = {},
) => {
  const server = new ChannelServer();
  const registry: AtomRegistry = createTestRegistry([
    [activeOrganizationIdAtom, "org-a"],
    [tokenAtom, "token-1"],
    [lockedTeamIdAtom, lockedTeamId],
    [channelApiAtom, server.api],
  ]);
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: "org-a",
    channels,
  });
  const navigations: Navigations = { channels: [], pages: [] };
  setChannelNavigationBridge(registry, {
    navigateToChannel: (channelId, page, organizationId) =>
      navigations.channels.push({ channelId, page, organizationId }),
    navigateToPage: (page) => navigations.pages.push(page),
  });
  return {
    actions: createChannelActions(registry),
    navigations,
    registry,
    server,
  };
};

describe("channel actions", () => {
  it("marks a channel read locally and confirms it", () => {
    const { actions, registry, server } = harness([
      channel("general", { hasUnread: true, lastMessageAt: "2026-02-01T00:00:00.000Z" }),
    ]);

    actions.markOrganizationChannelRead("general");

    const [read] = registry.get(activeOrganizationChannelsAtom);
    expect(read?.hasUnread).toBe(false);
    expect(read?.lastReadAt).not.toBeNull();
    expect(server.reads).toHaveLength(1);
  });

  it("does nothing for a channel that carries no unread", () => {
    const { actions, server } = harness([channel("general")]);
    actions.markOrganizationChannelRead("general");
    expect(server.reads).toEqual([]);
  });

  it("creates a channel, sorts it into the list and opens it", async () => {
    const { actions, navigations, registry } = harness([channel("zeta")]);

    await actions.createOrganizationChannel("alpha", "public", null);

    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["alpha", "zeta"]);
    expect(registry.get(initialChannelInviteIdAtom)).toBe("alpha");
    expect(navigations.channels).toEqual([
      { channelId: "alpha", page: "channels", organizationId: "org-a" },
    ]);
  });

  it("opens a direct message on the direct message page", () => {
    const { actions, navigations } = harness([
      channel("general"),
      channel("dm-1", { kind: "dm" }),
    ]);

    actions.openOrganizationChannel("general");
    actions.openOrganizationChannel("dm-1");

    expect(navigations.channels.map((item) => item.page)).toEqual([
      "channels",
      "dms",
    ]);
  });

  it("composes a new direct message on the DM page until one is selected", () => {
    const { actions, navigations, registry } = harness([
      channel("dm-1", { kind: "dm" }),
    ]);
    actions.selectChannel("dm-1");

    actions.startDirectMessageCompose();

    expect(registry.get(directMessageComposeAtom)).toBe(true);
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    expect(navigations.pages).toEqual(["dms"]);

    // Selecting any conversation ends the compose; clearing does not.
    actions.selectChannel(null);
    expect(registry.get(directMessageComposeAtom)).toBe(true);
    actions.selectChannel("dm-1");
    expect(registry.get(directMessageComposeAtom)).toBe(false);
    expect(registry.get(activeChannelIdAtom)).toBe("dm-1");
  });

  it("does not compose a direct message in a project window", () => {
    const { actions, navigations, registry } = harness([], {
      lockedTeamId: "team-1",
    });

    actions.startDirectMessageCompose();

    expect(registry.get(directMessageComposeAtom)).toBe(false);
    expect(navigations.pages).toEqual([]);
  });

  it("refuses to open a channel outside a project window's team", () => {
    const { actions, navigations } = harness(
      [
        channel("pinned", { defaultProjectId: "team-a" }),
        channel("other", { defaultProjectId: "team-b" }),
      ],
      { lockedTeamId: "team-a" },
    );

    actions.openOrganizationChannel("other");
    expect(navigations.channels).toEqual([]);

    actions.openOrganizationChannel("pinned");
    expect(navigations.channels).toHaveLength(1);
  });

  it("arms the settings dialog before opening a channel", () => {
    const { actions, registry } = harness([channel("general")]);
    actions.openOrganizationChannelSettings("general");
    expect(registry.get(requestedChannelSettingsIdAtom)).toBe("general");
  });

  it("deletes a channel and leaves it when it was the one on screen", async () => {
    const { actions, navigations, registry, server } = harness([
      channel("general"),
      channel("other"),
    ]);
    registry.set(activeChannelIdAtom, "general");
    registry.set(requestedChannelSettingsIdAtom, "general");
    registry.set(requestedChannelMessageAtom, {
      channelId: "general",
      messageId: "message-1",
      rootMessageId: "message-1",
    });

    await actions.deleteOrganizationChannel("general");

    expect(server.deleted).toEqual(["general"]);
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["other"]);
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    expect(registry.get(requestedChannelSettingsIdAtom)).toBeNull();
    expect(registry.get(requestedChannelMessageAtom)).toBeNull();
    expect(navigations.pages).toEqual(["lobby"]);
  });

  it("stays put when deleting a channel that is not on screen", async () => {
    const { actions, navigations, registry } = harness([
      channel("general"),
      channel("other"),
    ]);
    registry.set(activeChannelIdAtom, "other");

    await actions.deleteOrganizationChannel("general");

    expect(registry.get(activeChannelIdAtom)).toBe("other");
    expect(navigations.pages).toEqual([]);
  });

  it("clears the thread root whenever the viewed channel is cleared", () => {
    const { actions, registry } = harness([channel("general")]);

    actions.setViewingChannel("general", "message-1");
    expect(registry.get(viewingChannelIdAtom)).toBe("general");
    expect(registry.get(viewingChannelThreadRootMessageIdAtom)).toBe("message-1");

    actions.setViewingChannel(null, "message-1");
    expect(registry.get(viewingChannelIdAtom)).toBeNull();
    expect(registry.get(viewingChannelThreadRootMessageIdAtom)).toBeNull();
  });

  it("replaces the catalog from a view's own updater", () => {
    const { actions, registry } = harness([
      channel("general", { hasUnread: true }),
    ]);

    actions.replaceOrganizationChannels((current) =>
      current.map((item) => ({ ...item, hasUnread: false })),
    );

    expect(registry.get(activeOrganizationChannelsAtom)[0]?.hasUnread).toBe(
      false,
    );
  });
});
