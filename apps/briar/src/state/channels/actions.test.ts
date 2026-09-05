import { describe, expect, it } from "vitest";

import type { ActivePage, ChannelNavigationPage } from "../../lib/app-navigation";
import type {
  ChannelSidebarSection,
  ChannelSummary,
} from "../../lib/channels-contract";
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
  channelSidebarSectionsAtom,
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
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  ...overrides,
});

const section = (
  id: string,
  overrides: Partial<ChannelSidebarSection> = {},
): ChannelSidebarSection => ({
  id,
  organizationId: "org-a",
  name: id,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

class ChannelServer {
  readonly reads: { channelId: string; lastReadAt?: string }[] = [];
  readonly deleted: string[] = [];
  readonly unread: string[] = [];
  readonly preferences: {
    channelId: string;
    pinned?: boolean;
    hidden?: boolean;
    section?: string | null;
  }[] = [];
  readonly sectionWrites: string[] = [];
  sections: ChannelSidebarSection[] = [];
  /** What the server hands back for a preference write, keyed by channel. */
  readonly preferenceResults = new Map<string, ChannelSummary>();

  readonly api: Partial<ChannelApi> = {
    markChannelUnread: async (
      _token: string,
      _organizationId: string,
      channelId: string,
    ) => {
      this.unread.push(channelId);
      return { channel: channel(channelId, { hasUnread: true }) };
    },
    updateChannelSidebarPreference: async (
      _token: string,
      _organizationId: string,
      channelId: string,
      input: { pinned?: boolean; hidden?: boolean; section?: string | null },
    ) => {
      this.preferences.push({ channelId, ...input });
      return {
        channel: this.preferenceResults.get(channelId) ??
          channel(channelId, {
            pinnedAt: input.pinned ? "2026-03-01T00:00:00.000Z" : null,
            hiddenAt: input.hidden ? "2026-03-01T00:00:00.000Z" : null,
            sidebarSectionId: input.section ?? null,
          }),
      };
    },
    createChannelSidebarSection: async (
      _token: string,
      _organizationId: string,
      name: string,
    ) => {
      this.sectionWrites.push(`create:${name}`);
      const created = section(name);
      this.sections = [...this.sections, created];
      return { section: created, sections: this.sections };
    },
    renameChannelSidebarSection: async (
      _token: string,
      _organizationId: string,
      sectionId: string,
      name: string,
    ) => {
      this.sectionWrites.push(`rename:${sectionId}:${name}`);
      this.sections = this.sections.map((entry) =>
        entry.id === sectionId ? { ...entry, name } : entry,
      );
      return {
        section: section(sectionId, { name }),
        sections: this.sections,
      };
    },
    deleteChannelSidebarSection: async (
      _token: string,
      _organizationId: string,
      sectionId: string,
    ) => {
      this.sectionWrites.push(`delete:${sectionId}`);
      this.sections = this.sections.filter((entry) => entry.id !== sectionId);
      return { sections: this.sections };
    },
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

describe("direct message sidebar actions", () => {
  const conversation = (id: string, overrides: Partial<ChannelSummary> = {}) =>
    channel(id, { kind: "dm", visibility: "private", ...overrides });

  it("pins, hides and files a conversation from the server's answer", async () => {
    const { actions, registry, server } = harness([conversation("dm-1")]);

    await actions.setDirectMessagePinned("dm-1", true);
    expect(server.preferences).toEqual([{ channelId: "dm-1", pinned: true }]);
    expect(registry.get(activeOrganizationChannelsAtom)[0]?.pinnedAt).not
      .toBeNull();

    await actions.setDirectMessageHidden("dm-1", true);
    expect(server.preferences.at(-1)).toEqual({
      channelId: "dm-1",
      hidden: true,
    });
    expect(registry.get(activeOrganizationChannelsAtom)[0]?.hiddenAt).not
      .toBeNull();

    await actions.moveDirectMessageToSection("dm-1", "section-1");
    expect(server.preferences.at(-1)).toEqual({
      channelId: "dm-1",
      section: "section-1",
    });
    expect(
      registry.get(activeOrganizationChannelsAtom)[0]?.sidebarSectionId,
    ).toBe("section-1");

    // Unassigned is an explicit null rather than an omitted field, so the
    // server can tell "move to no section" from "leave the section alone".
    await actions.moveDirectMessageToSection("dm-1", null);
    expect(server.preferences.at(-1)).toEqual({
      channelId: "dm-1",
      section: null,
    });
  });

  it("creates a section, renames it and unfiles its conversations on delete", async () => {
    const { actions, registry, server } = harness([
      conversation("dm-1", { sidebarSectionId: "Team" }),
      conversation("dm-2"),
    ]);

    const created = await actions.createDirectMessageSection("Team");
    expect(created.id).toBe("Team");
    expect(registry.get(channelSidebarSectionsAtom).map((item) => item.id))
      .toEqual(["Team"]);

    await actions.renameDirectMessageSection("Team", "Squad");
    expect(registry.get(channelSidebarSectionsAtom)[0]?.name).toBe("Squad");

    await actions.deleteDirectMessageSection("Team");
    expect(server.sectionWrites).toEqual([
      "create:Team",
      "rename:Team:Squad",
      "delete:Team",
    ]);
    expect(registry.get(channelSidebarSectionsAtom)).toEqual([]);
    // The conversation that was filed there is Unassigned now.
    expect(
      registry
        .get(activeOrganizationChannelsAtom)
        .map((item) => item.sidebarSectionId),
    ).toEqual([null, null]);
  });

  it("marks a conversation unread from the server's answer", async () => {
    const { actions, registry, server } = harness([conversation("dm-1")]);

    await actions.markDirectMessageUnread("dm-1");

    expect(server.unread).toEqual(["dm-1"]);
    expect(registry.get(activeOrganizationChannelsAtom)[0]?.hasUnread).toBe(
      true,
    );
  });

  it("returns to the DM page after deleting the conversation on screen", async () => {
    const { actions, navigations, registry, server } = harness([
      conversation("dm-1"),
      conversation("dm-2"),
    ]);
    registry.set(activeChannelIdAtom, "dm-1");

    await actions.deleteDirectMessage("dm-1");

    expect(server.deleted).toEqual(["dm-1"]);
    expect(
      registry.get(activeOrganizationChannelsAtom).map((item) => item.id),
    ).toEqual(["dm-2"]);
    expect(registry.get(activeChannelIdAtom)).toBeNull();
    // The DM page opens the next conversation by itself, so the lobby is the
    // wrong place to land.
    expect(navigations.pages).toEqual(["dms"]);
  });

  it("stays put when deleting a conversation that is not on screen", async () => {
    const { actions, navigations, registry } = harness([
      conversation("dm-1"),
      conversation("dm-2"),
    ]);
    registry.set(activeChannelIdAtom, "dm-2");

    await actions.deleteDirectMessage("dm-1");

    expect(registry.get(activeChannelIdAtom)).toBe("dm-2");
    expect(navigations.pages).toEqual([]);
  });
});
