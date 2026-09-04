import type { ChannelDelta } from "../../lib/channels-contract";
import type { AtomRegistry } from "../registry";

/*
  Who else wants the pages the catalog loop pulls.

  There were two `loadChannelDelta` loops against the same endpoint — three in
  the companion shell — each with its own cursor: the catalog's in
  `useChannelCatalogSync`, the conversation's inside
  `hooks/use-channel-conversation.ts`, and the companion view's own list. They
  raced: a page one loop consumed advanced only that loop's cursor, so the other
  asked for it again, and a page the conversation dropped because it was
  "blocked" was one the catalog had already moved past.

  One loop owns the cursor now and everything else subscribes. A listener runs
  after the catalog has been applied, so it sees the channel list the page
  produced, and it runs synchronously inside the loop, so a listener that throws
  cannot leave the cursor half-advanced — it is caught here and logged.

  It is a plain registry-scoped set rather than an atom because a delta is an
  event, not a value: nobody renders "the last page", and an atom would keep the
  most recent one alive for a subscriber that mounts later to re-handle.
*/

export type ChannelDeltaListener = (delta: ChannelDelta) => void;

const listeners = new WeakMap<AtomRegistry, Set<ChannelDeltaListener>>();

const setFor = (registry: AtomRegistry): Set<ChannelDeltaListener> => {
  let held = listeners.get(registry);
  if (!held) {
    held = new Set();
    listeners.set(registry, held);
  }
  return held;
};

/** Registers `listener` for every page the catalog loop pulls. */
export function subscribeToChannelDelta(
  registry: AtomRegistry,
  listener: ChannelDeltaListener,
): () => void {
  const held = setFor(registry);
  held.add(listener);
  return () => {
    held.delete(listener);
  };
}

/** Hands one page to every listener. Called only by the catalog loop. */
export function publishChannelDelta(
  registry: AtomRegistry,
  delta: ChannelDelta,
): void {
  for (const listener of [...setFor(registry)]) {
    try {
      listener(delta);
    } catch (cause) {
      console.warn("Channel delta listener failed", cause);
    }
  }
}
