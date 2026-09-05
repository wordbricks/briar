import * as Atom from "effect/unstable/reactivity/Atom";

import {
  createChannel,
  createChannelSidebarSection,
  deleteChannel,
  deleteChannelSidebarSection,
  listChannels,
  loadChannelDelta,
  markChannelRead,
  markChannelUnread,
  renameChannelSidebarSection,
  updateChannelSidebarPreference,
} from "../../lib/api";
import { createChannelRealtimeTransport } from "../../lib/channel-realtime";
import type { AtomRegistry } from "../registry";

/*
  The single seam for everything the channel catalog reaches outside the store.

  It follows the shape `state/workspace` established: the sync hook and the
  actions share it, and a hook cannot be handed a partial API through a
  parameter, so the overrides live in an atom the registry owns. Tests seed it
  with in-memory implementations, which is what lets the catalog, its retry and
  its delta loop be exercised without mocking the modules that define them.
*/
export interface ChannelApi {
  readonly createChannel: typeof createChannel;
  readonly createChannelRealtimeTransport: typeof createChannelRealtimeTransport;
  readonly createChannelSidebarSection: typeof createChannelSidebarSection;
  readonly deleteChannel: typeof deleteChannel;
  readonly deleteChannelSidebarSection: typeof deleteChannelSidebarSection;
  readonly listChannels: typeof listChannels;
  readonly loadChannelDelta: typeof loadChannelDelta;
  readonly markChannelRead: typeof markChannelRead;
  readonly markChannelUnread: typeof markChannelUnread;
  readonly renameChannelSidebarSection: typeof renameChannelSidebarSection;
  readonly updateChannelSidebarPreference:
    typeof updateChannelSidebarPreference;
}

export const liveChannelApi: ChannelApi = {
  createChannel,
  createChannelRealtimeTransport,
  createChannelSidebarSection,
  deleteChannel,
  deleteChannelSidebarSection,
  listChannels,
  loadChannelDelta,
  markChannelRead,
  markChannelUnread,
  renameChannelSidebarSection,
  updateChannelSidebarPreference,
};

/** Overrides layered over {@link liveChannelApi}, so a caller replaces only what it needs. */
export const channelApiAtom = Atom.make<Partial<ChannelApi>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("channels/api"),
);

/** The API in force for this registry, resolved at call time. */
export function resolveChannelApi(registry: AtomRegistry): ChannelApi {
  return { ...liveChannelApi, ...registry.get(channelApiAtom) };
}
