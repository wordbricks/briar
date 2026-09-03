import * as Atom from "effect/unstable/reactivity/Atom";

import type { ChannelSummary } from "../../lib/channels-contract";
import { shallowArrayEqual } from "./upsert";

/*
  Channel summaries normalized by channel id, plus one ordered id index per
  organization.

  The index is stored rather than derived from `channel.organizationId` because
  the order is user visible and the two catalog paths produce it differently: a
  snapshot renders the server's order verbatim, while a delta re-sorts the whole
  list by name. A derived index could only ever offer insertion order, which is
  neither. `state/sync/apply.ts` owns both writes.
*/

/**
 * The list every organization without a catalog renders. One shared instance so
 * "not loaded yet" and "loaded and empty" both keep a stable array identity.
 */
const emptyChannels: ChannelSummary[] = [];

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
 * An organization's channel ids in render order, or `null` when its catalog has
 * never been loaded. List views subscribe to this instead of the summaries, so
 * one channel's unread flag does not re-render the list.
 */
export const organizationChannelIdsAtom = Atom.family((organizationId: string) =>
  Atom.make<string[] | null>(null).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/channels/organization/${organizationId}/ids`),
  ),
);

/**
 * The organizations whose catalog is stored. `Atom.family` cannot be
 * enumerated, so clearing every catalog on sign-out needs this list to know
 * which entries exist.
 */
export const channelCatalogOrganizationIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("entities/channels/organizations"),
);

/**
 * An organization's channels resolved against the store. The array keeps its
 * reference while every summary in it keeps theirs, so a delta that changed
 * nothing produces no new list.
 */
export const organizationChannelsAtom = Atom.family((organizationId: string) =>
  Atom.make((get): ChannelSummary[] => {
    const ids = get(organizationChannelIdsAtom(organizationId));
    if (!ids) return emptyChannels;
    const channels = get(channelsByIdAtom);
    const resolved: ChannelSummary[] = [];
    for (const id of ids) {
      const channel = channels.get(id);
      if (channel) resolved.push(channel);
    }
    return resolved;
  }).pipe(
    Atom.withEquality<ChannelSummary[]>(shallowArrayEqual),
    Atom.withLabel(`entities/channels/organization/${organizationId}`),
  ),
);
