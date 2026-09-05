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
  ChannelSummary,
  ChannelVisibility,
} from "../../lib/channels-contract";
import { organizationChannelsAtom } from "../entities/channels";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { resolveChannelApi } from "./api";
import {
  activeChannelIdAtom,
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
    organizationId?: string | null,
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
  readonly markOrganizationChannelRead: (channelId: string) => void;
  /** Creates a channel, opens it, and arms its invite dialog. */
  readonly createOrganizationChannel: (
    name: string,
    visibility: ChannelVisibility,
    defaultProjectId?: string | null,
  ) => Promise<void>;
  /** Navigates to a channel, on whichever page its kind belongs to. */
  readonly openOrganizationChannel: (channelId: string) => void;
  /** Opens a channel with its settings dialog armed. */
  readonly openOrganizationChannelSettings: (channelId: string) => void;
  /** Deletes a channel and leaves it if it was the one on screen. */
  readonly deleteOrganizationChannel: (channelId: string) => Promise<void>;
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
  /** Replaces the active organization's catalog, `useState` setter style. */
  readonly replaceOrganizationChannels: (
    update:
      | readonly ChannelSummary[]
      | ((current: ChannelSummary[]) => readonly ChannelSummary[]),
  ) => void;
  /** Clears a requested message once the view has scrolled to it. */
  readonly clearRequestedChannelMessage: () => void;
}

export function createChannelActions(registry: AtomRegistry): ChannelActions {
  const catalog = (organizationId: string) =>
    registry.get(organizationChannelsAtom(organizationId));
  const channelIn = (organizationId: string, channelId: string) =>
    catalog(organizationId).find((channel) => channel.id === channelId) ?? null;

  const replaceOrganizationChannels: ChannelActions["replaceOrganizationChannels"] =
    (update) => {
      const organizationId = registry.get(activeOrganizationIdAtom);
      if (!organizationId) return;
      const current = catalog(organizationId);
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return;
      applySyncEvent(registry, {
        kind: "channel-catalog-snapshot",
        organizationId,
        channels: next,
      });
    };

  const openOrganizationChannel: ChannelActions["openOrganizationChannel"] = (
    channelId,
  ) => {
    const organizationId = registry.get(activeOrganizationIdAtom);
    if (!organizationId) return;
    const channel = channelIn(organizationId, channelId);
    // A project window only ever shows the channels pinned to its own team.
    const lockedTeamId = registry.get(lockedTeamIdAtom);
    if (lockedTeamId && channel?.defaultProjectId !== lockedTeamId) return;
    channelNavigation(registry).navigateToChannel?.(
      channelId,
      channel?.kind === "dm" ? "dms" : "channels",
    );
  };

  return {
    markOrganizationChannelRead(channelId) {
      const token = registry.get(tokenAtom);
      const organizationId = registry.get(activeOrganizationIdAtom);
      if (!token || !organizationId) return;
      const channel = channelIn(organizationId, channelId);
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
        .markChannelRead(token, organizationId, channelId, { lastReadAt })
        .catch(() => {
          // The next catalog snapshot restores unread if the write failed.
        });
    },

    async createOrganizationChannel(name, visibility, defaultProjectId) {
      const organizationId = registry.get(activeOrganizationIdAtom);
      const token = registry.get(tokenAtom);
      if (!organizationId || !token) {
        throw new Error("Organization is not available");
      }
      const result = await resolveChannelApi(registry).createChannel(
        token,
        organizationId,
        { name, visibility, defaultProjectId },
      );
      Atom.batch(() => {
        replaceOrganizationChannels((current) =>
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
        organizationId,
      );
    },

    openOrganizationChannel,

    openOrganizationChannelSettings(channelId) {
      registry.set(requestedChannelSettingsIdAtom, channelId);
      openOrganizationChannel(channelId);
    },

    async deleteOrganizationChannel(channelId) {
      const organizationId = registry.get(activeOrganizationIdAtom);
      const token = registry.get(tokenAtom);
      if (!organizationId || !token) {
        throw new Error("Organization is not available");
      }
      await resolveChannelApi(registry).deleteChannel(
        token,
        organizationId,
        channelId,
      );
      const wasOpen = registry.get(activeChannelIdAtom) === channelId;
      Atom.batch(() => {
        applySyncEvent(registry, {
          kind: "channel-removed",
          organizationId,
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
      if (wasOpen) channelNavigation(registry).navigateToPage?.("lobby");
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

    replaceOrganizationChannels,

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
