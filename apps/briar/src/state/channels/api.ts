import * as Atom from "effect/unstable/reactivity/Atom";

import {
  createChannel,
  deleteChannel,
  listChannels,
  loadChannelDelta,
  markChannelRead,
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
  readonly deleteChannel: typeof deleteChannel;
  readonly listChannels: typeof listChannels;
  readonly loadChannelDelta: typeof loadChannelDelta;
  readonly markChannelRead: typeof markChannelRead;
}

export const liveChannelApi: ChannelApi = {
  createChannel,
  createChannelRealtimeTransport,
  deleteChannel,
  listChannels,
  loadChannelDelta,
  markChannelRead,
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
