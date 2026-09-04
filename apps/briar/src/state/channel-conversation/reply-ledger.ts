import type { ChannelAgentReply } from "../../lib/channels-contract";
import type { AtomRegistry } from "../registry";

/*
  When each agent reply was last observed.

  A channel detail response is the whole truth for that channel *as of when the
  request was made*, so committing it has to know which of the replies on screen
  the answer predates. `use-channel-conversation.ts` did that with a counter and
  a `Map<replyId, version>` beside its `useState`, and handed the observed
  version to the merge; the store's entry point takes the answer instead — the
  ids that must survive the replacement — so the counting lives here.

  Ids alone are not enough. A reply that existed when the request started but
  reached its terminal state while it was in flight also has to survive, or the
  older answer would walk it backwards; that is why this counts observations
  rather than remembering a set of ids.

  It is deliberately not an atom: no view renders a version, and a bump per
  realtime tick would wake every subscriber of an atom that only the loader and
  the actions read.
*/

/** One channel's observation counter and the version of each of its replies. */
interface ChannelReplyVersions {
  counter: number;
  readonly versions: Map<string, number>;
}

export interface ChannelReplyLedger {
  /**
   * Records that `replies` were just observed in `channelId`, and returns the
   * version they were given. Called by every path that writes replies.
   */
  readonly note: (
    channelId: string,
    replies: readonly ChannelAgentReply[],
  ) => number;
  /** The counter as it stands, to be handed back to {@link retainedSince}. */
  readonly capture: (channelId: string) => number;
  /**
   * The ids of `current` that were observed after `version` — the replies an
   * answer taken at `version` cannot speak for.
   */
  readonly retainedSince: (
    channelId: string,
    version: number,
    current: readonly ChannelAgentReply[],
  ) => string[];
  /** Forgets one channel's versions, which a cleared conversation does. */
  readonly forget: (channelId: string) => void;
}

export function createChannelReplyLedger(): ChannelReplyLedger {
  const byChannel = new Map<string, ChannelReplyVersions>();
  const entry = (channelId: string): ChannelReplyVersions => {
    let stored = byChannel.get(channelId);
    if (!stored) {
      stored = { counter: 0, versions: new Map() };
      byChannel.set(channelId, stored);
    }
    return stored;
  };
  return {
    note: (channelId, replies) => {
      const stored = entry(channelId);
      for (const reply of replies) {
        stored.counter += 1;
        stored.versions.set(reply.id, stored.counter);
      }
      return stored.counter;
    },
    capture: (channelId) => entry(channelId).counter,
    retainedSince: (channelId, version, current) => {
      const stored = entry(channelId);
      return current
        .filter((reply) => (stored.versions.get(reply.id) ?? 0) > version)
        .map((reply) => reply.id);
    },
    forget: (channelId) => {
      byChannel.delete(channelId);
    },
  };
}

/*
  One ledger per registry, for the same reason `state/sync/loader.ts` keeps one
  loader: the conversation loader and the conversation actions live in different
  components and have to agree on what "already observed" means.
*/
const ledgers = new WeakMap<AtomRegistry, ChannelReplyLedger>();

export function getChannelReplyLedger(
  registry: AtomRegistry,
): ChannelReplyLedger {
  let ledger = ledgers.get(registry);
  if (!ledger) {
    ledger = createChannelReplyLedger();
    ledgers.set(registry, ledger);
  }
  return ledger;
}
