import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import type {
  ActivePage,
  ChannelNavigationPage,
} from "../../lib/app-navigation";
import {
  laterTimestamp,
  markChannelSummaryRead,
} from "../../lib/channel-unread";
import type {
  ChannelSidebarSection,
  ChannelSummary,
  ChannelVisibility,
} from "../../lib/channels-contract";
import { organizationChannelsAtom } from "../entities/channels";
import { activeWorkspaceIdAtom } from "../workspace/atoms";
import { lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { resolveChannelApi } from "./api";
import {
  activeChannelIdAtom,
  channelSidebarSectionsAtom,
  directMessageComposeAtom,
  initialChannelInviteIdAtom,
  requestedChannelMessageAtom,
  requestedChannelSettingsIdAtom,
  viewingChannelIdAtom,
  viewingChannelThreadRootMessageIdAtom,
} from "./atoms";

/*
  The channel writes the app shell performed inline.

  Only the store half lives here. Where a channel ends up on screen is a
  navigation decision — history entries, the project window's project id — and
  navigation is still the shell's, so these actions ask for it through a bridge
  the shell installs per registry. That indirection is what keeps
  `useChannelActions()` returning the same object for the registry's lifetime,
  which is what lets the connected views take the actions without re-rendering
  whenever the shell does.
*/

/** Where the shell sends the user after a channel action. */
export interface ChannelNavigationBridge {
  readonly navigateToChannel?: (
    channelId: string,
    page: ChannelNavigationPage,
    workspaceId?: string | null,
    projectId?: string | null,
  ) => void;
  readonly navigateToPage?: (page: ActivePage) => void;
}

const navigationBridges = new WeakMap<AtomRegistry, ChannelNavigationBridge>();

/** Installs the shell's channel navigation for this registry. */
export function setChannelNavigationBridge(
  registry: AtomRegistry,
  bridge: ChannelNavigationBridge,
): void {
  navigationBridges.set(registry, bridge);
}

const channelNavigation = (registry: AtomRegistry): ChannelNavigationBridge =>
  navigationBridges.get(registry) ?? {};

export interface ChannelActions {
  /** Marks a channel read locally and confirms it with the server. */
  readonly markWorkspaceChannelRead: (channelId: string) => void;
  /** Creates a channel, opens it, and arms its invite dialog. */
  readonly createWorkspaceChannel: (
    name: string,
    visibility: ChannelVisibility,
    defaultProjectId?: string | null,
  ) => Promise<void>;
  /** Navigates to a channel, on whichever page its kind belongs to. */
  readonly openWorkspaceChannel: (channelId: string) => void;
  /** Opens a channel with its settings dialog armed. */
  readonly openWorkspaceChannelSettings: (channelId: string) => void;
  /** Deletes a channel and leaves it if it was the one on screen. */
  readonly deleteWorkspaceChannel: (channelId: string) => Promise<void>;
  /** Records the channel the app considers open. Selecting one ends a compose. */
  readonly selectChannel: (channelId: string | null) => void;
  /**
   * Opens the desktop DM composer: no conversation is selected and the DM page
   * shows the recipient picker until one is started or another is opened.
   */
  readonly startDirectMessageCompose: () => void;
  /** Records what the user is looking at, for notification suppression. */
  readonly setViewingChannel: (
    channelId: string | null,
    threadRootMessageId?: string | null,
  ) => void;
  /** Replaces the active workspace's catalog, `useState` setter style. */
  readonly replaceWorkspaceChannels: (
    update:
      | readonly ChannelSummary[]
      | ((current: ChannelSummary[]) => readonly ChannelSummary[]),
  ) => void;
  /** Clears a requested message once the view has scrolled to it. */
  readonly clearRequestedChannelMessage: () => void;
  /*
    The sidebar arrangement of one conversation, and the sections it can sit in.

    Each of these is a server write against the caller's own preference row, and
    the response is the conversation as the server now sees it — so the local
    catalog takes it through `channel-changed` and the member's other devices
    pick the same change up through the channel delta.
  */
  /** Pins a conversation to the top of the list, or unpins it. */
  readonly setDirectMessagePinned: (
    channelId: string,
    pinned: boolean,
  ) => Promise<void>;
  /** Files a conversation under one section, or under none. */
  readonly moveDirectMessageToSection: (
    channelId: string,
    sectionId: string | null,
  ) => Promise<void>;
  /** Creates a section and returns it, so a caller can move into it at once. */
  readonly createDirectMessageSection: (
    name: string,
  ) => Promise<ChannelSidebarSection>;
  readonly renameDirectMessageSection: (
    sectionId: string,
    name: string,
  ) => Promise<void>;
  /** Deletes a section; the conversations in it fall back to Unassigned. */
  readonly deleteDirectMessageSection: (sectionId: string) => Promise<void>;
  /** Puts the unread mark back on a conversation. */
  readonly markDirectMessageUnread: (channelId: string) => Promise<void>;
  /** Takes a conversation out of the sidebar list, or puts it back. */
  readonly setDirectMessageHidden: (
    channelId: string,
    hidden: boolean,
  ) => Promise<void>;
  /**
   * Deletes a conversation for every participant. When it was the one on
   * screen the app returns to the DM page rather than the lobby, and the page
   * opens the next conversation by itself.
   */
  readonly deleteDirectMessage: (channelId: string) => Promise<void>;
}

export function createChannelActions(registry: AtomRegistry): ChannelActions {
  const catalog = (workspaceId: string) =>
    registry.get(organizationChannelsAtom(workspaceId));
  const channelIn = (workspaceId: string, channelId: string) =>
    catalog(workspaceId).find((channel) => channel.id === channelId) ?? null;

  const replaceWorkspaceChannels: ChannelActions["replaceWorkspaceChannels"] =
    (update) => {
      const workspaceId = registry.get(activeWorkspaceIdAtom);
      if (!workspaceId) return;
      const current = catalog(workspaceId);
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return;
      applySyncEvent(registry, {
        kind: "channel-catalog-snapshot",
        workspaceId,
        channels: next,
      });
    };

  /** The workspace and token every server write needs, or a clear failure. */
  const requireSession = () => {
    const workspaceId = registry.get(activeWorkspaceIdAtom);
    const token = registry.get(tokenAtom);
    if (!workspaceId || !token) {
      throw new Error("Workspace is not available");
    }
    return { workspaceId, token };
  };

  /*
    One conversation's own sidebar row. The response is the summary the server
    now holds for this member, so the store takes it verbatim rather than
    guessing what the write did.
  */
  const writeSidebarPreference = async (
    channelId: string,
    update: { pinned?: boolean; hidden?: boolean; section?: string | null },
  ) => {
    const { workspaceId, token } = requireSession();
    const result = await resolveChannelApi(registry)
      .updateChannelSidebarPreference(token, workspaceId, channelId, update);
    applySyncEvent(registry, {
      kind: "channel-changed",
      channel: result.channel,
    });
  };

  /**
   * Deletes a channel and, when it was the one on screen, leaves for `fallback`.
   * A deleted DM goes back to the DM page rather than the lobby: that page opens
   * the next conversation by itself.
   */
  const deleteChannel = async (channelId: string, fallback: ActivePage) => {
    const { workspaceId, token } = requireSession();
    await resolveChannelApi(registry).deleteChannel(
      token,
      workspaceId,
      channelId,
    );
    const wasOpen = registry.get(activeChannelIdAtom) === channelId;
    Atom.batch(() => {
      applySyncEvent(registry, {
        kind: "channel-removed",
        workspaceId,
        channelId,
      });
      registry.update(requestedChannelMessageAtom, (current) =>
        current?.channelId === channelId ? null : current,
      );
      registry.update(requestedChannelSettingsIdAtom, (current) =>
        current === channelId ? null : current,
      );
      if (wasOpen) registry.set(activeChannelIdAtom, null);
    });
    if (wasOpen) channelNavigation(registry).navigateToPage?.(fallback);
  };

  const openWorkspaceChannel: ChannelActions["openWorkspaceChannel"] = (
    channelId,
  ) => {
    const workspaceId = registry.get(activeWorkspaceIdAtom);
    if (!workspaceId) return;
    const channel = channelIn(workspaceId, channelId);
    // A project window only ever shows the channels pinned to its own team.
    const lockedTeamId = registry.get(lockedTeamIdAtom);
    if (lockedTeamId && channel?.defaultProjectId !== lockedTeamId) return;
    channelNavigation(registry).navigateToChannel?.(
      channelId,
      channel?.kind === "dm" ? "dms" : "channels",
    );
  };

  return {
    markWorkspaceChannelRead(channelId) {
      const token = registry.get(tokenAtom);
      const workspaceId = registry.get(activeWorkspaceIdAtom);
      if (!token || !workspaceId) return;
      const channel = channelIn(workspaceId, channelId);
      if (!channel?.hasUnread) return;
      const lastReadAt = laterTimestamp(
        channel.lastMessageAt,
        new Date().toISOString(),
      );
      applySyncEvent(registry, {
        kind: "channel-changed",
        channel: markChannelSummaryRead(channel, lastReadAt),
      });
      void resolveChannelApi(registry)
        .markChannelRead(token, workspaceId, channelId, { lastReadAt })
        .catch(() => {
          // The next catalog snapshot restores unread if the write failed.
        });
    },

    async createWorkspaceChannel(name, visibility, defaultProjectId) {
      const workspaceId = registry.get(activeWorkspaceIdAtom);
      const token = registry.get(tokenAtom);
      if (!workspaceId || !token) {
        throw new Error("Workspace is not available");
      }
      const result = await resolveChannelApi(registry).createChannel(
        token,
        workspaceId,
        { name, visibility, defaultProjectId },
      );
      Atom.batch(() => {
        replaceWorkspaceChannels((current) =>
          [
            ...current.filter((channel) => channel.id !== result.channel.id),
            result.channel,
          ].sort((left, right) => left.name.localeCompare(right.name)),
        );
        registry.set(initialChannelInviteIdAtom, result.channel.id);
      });
      channelNavigation(registry).navigateToChannel?.(
        result.channel.id,
        "channels",
        workspaceId,
      );
    },

    openWorkspaceChannel,

    openWorkspaceChannelSettings(channelId) {
      registry.set(requestedChannelSettingsIdAtom, channelId);
      openWorkspaceChannel(channelId);
    },

    deleteWorkspaceChannel: (channelId) => deleteChannel(channelId, "lobby"),

    deleteDirectMessage: (channelId) => deleteChannel(channelId, "dms"),

    setDirectMessagePinned: (channelId, pinned) =>
      writeSidebarPreference(channelId, { pinned }),

    moveDirectMessageToSection: (channelId, sectionId) =>
      writeSidebarPreference(channelId, { section: sectionId }),

    setDirectMessageHidden: (channelId, hidden) =>
      writeSidebarPreference(channelId, { hidden }),

    async markDirectMessageUnread(channelId) {
      const { workspaceId, token } = requireSession();
      const result = await resolveChannelApi(registry).markChannelUnread(
        token,
        workspaceId,
        channelId,
      );
      applySyncEvent(registry, {
        kind: "channel-changed",
        channel: result.channel,
      });
    },

    async createDirectMessageSection(name) {
      const { workspaceId, token } = requireSession();
      const result = await resolveChannelApi(registry)
        .createChannelSidebarSection(token, workspaceId, name);
      registry.set(channelSidebarSectionsAtom, [...result.sections]);
      return result.section;
    },

    async renameDirectMessageSection(sectionId, name) {
      const { workspaceId, token } = requireSession();
      const result = await resolveChannelApi(registry)
        .renameChannelSidebarSection(token, workspaceId, sectionId, name);
      registry.set(channelSidebarSectionsAtom, [...result.sections]);
    },

    async deleteDirectMessageSection(sectionId) {
      const { workspaceId, token } = requireSession();
      const result = await resolveChannelApi(registry)
        .deleteChannelSidebarSection(token, workspaceId, sectionId);
      Atom.batch(() => {
        registry.set(channelSidebarSectionsAtom, [...result.sections]);
        /*
          The server moved every conversation that was filed here to Unassigned.
          Doing the same locally keeps the list right without a refetch; the
          next delta confirms it.
        */
        for (const channel of catalog(workspaceId)) {
          if (channel.sidebarSectionId !== sectionId) continue;
          applySyncEvent(registry, {
            kind: "channel-changed",
            channel: { ...channel, sidebarSectionId: null },
          });
        }
      });
    },

    selectChannel(channelId) {
      Atom.batch(() => {
        registry.set(activeChannelIdAtom, channelId);
        if (channelId) registry.set(directMessageComposeAtom, false);
      });
    },

    startDirectMessageCompose() {
      if (registry.get(lockedTeamIdAtom)) return;
      Atom.batch(() => {
        registry.set(activeChannelIdAtom, null);
        registry.set(directMessageComposeAtom, true);
      });
      channelNavigation(registry).navigateToPage?.("dms");
    },

    setViewingChannel(channelId, threadRootMessageId = null) {
      Atom.batch(() => {
        registry.set(viewingChannelIdAtom, channelId);
        registry.set(
          viewingChannelThreadRootMessageIdAtom,
          channelId ? threadRootMessageId : null,
        );
      });
    },

    replaceWorkspaceChannels,

    clearRequestedChannelMessage() {
      registry.set(requestedChannelMessageAtom, null);
    },
  };
}

/** The channel actions bound to the surrounding registry. */
export function useChannelActions(): ChannelActions {
  const registry = useRegistry();
  return useMemo(() => createChannelActions(registry), [registry]);
}
