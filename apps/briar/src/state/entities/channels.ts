import * as Atom from "effect/unstable/reactivity/Atom";

import type { ChannelSummary } from "../../lib/channels-contract";
import { shallowArrayEqual } from "./upsert";

/*
  Channel summaries normalized by channel id.

  Nothing writes this store yet: the channel catalog and its realtime deltas
  still live in `App.tsx` and move here in Phase 4. The atoms exist now so the
  catalog has somewhere to land without another entity-shaped decision later.
  Unlike runs, a channel carries its own `organizationId`, so the index is
  derived rather than stored.
*/

/** Every known channel summary, keyed by channel id. */
export const channelsByIdAtom = Atom.make<ReadonlyMap<string, ChannelSummary>>(
  new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("entities/channels"));

/** One channel summary, or `null` when it is not in the store. */
export const channelAtom = Atom.family((channelId: string) =>
  Atom.map(channelsByIdAtom, (channels) => channels.get(channelId) ?? null).pipe(
    Atom.withLabel(`entities/channels/${channelId}`),
  ),
);

/**
 * The ids of an organization's channels, in store order. List views subscribe
 * to this so a single channel's unread flag does not re-render the list.
 */
export const organizationChannelIdsAtom = Atom.family((organizationId: string) =>
  Atom.make((get): string[] => {
    const ids: string[] = [];
    for (const channel of get(channelsByIdAtom).values()) {
      if (channel.organizationId === organizationId) ids.push(channel.id);
    }
    return ids;
  }).pipe(
    Atom.withEquality<string[]>(shallowArrayEqual),
    Atom.withLabel(`entities/channels/organization/${organizationId}`),
  ),
);
