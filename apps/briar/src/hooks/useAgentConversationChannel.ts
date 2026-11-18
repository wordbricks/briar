import { useCallback, useEffect, useMemo, useState } from "react";

import { loadChannel } from "../lib/api";
import type {
  ChannelMessageRelay,
  ChannelSummary,
} from "../lib/channels-contract";
import { claimOpenAgentConversation } from "../state/channels/atoms";
import { useRegistry } from "../state/registry";

/*
  The one conversation the catalog deliberately does not hold.

  An Agent-to-Agent conversation is reachable from a relay row and from an
  Agent's detail page, never from the sidebar, so it is fetched when it is
  asked for and dropped when it is closed. Only a read-only channel is adopted
  this way: any other id that is missing from the catalog is still the catalog's
  business, and the view falls back the way it always has.
*/

export type AgentConversationChannelState = {
  /** The fetched conversation, once it is the one being asked for. */
  readonly channel: ChannelSummary | null;
  /** A fetch is in flight, so the view should wait rather than fall back. */
  readonly loading: boolean;
};

export function useAgentConversationChannel({
  channelId,
  channels,
  enabled,
  workspaceId,
  token,
}: {
  channelId: string | null;
  /** The catalog. An id it already holds is never fetched. */
  channels: readonly ChannelSummary[];
  /** False while the catalog is still loading, since it may yet hold the id. */
  enabled: boolean;
  workspaceId: string;
  token: string;
}): AgentConversationChannelState {
  const registry = useRegistry();
  const known = channelId !== null &&
    channels.some((channel) => channel.id === channelId);
  const wanted = enabled && channelId !== null && !known &&
    Boolean(token) && Boolean(workspaceId);
  /*
    The answer, with the id it answers for.

    Keeping them together is what lets "loading" be read out of the render
    itself rather than raised by the effect: an id nothing has answered for is
    one the view must wait on, and waiting a commit later is a commit in which
    the timeline sees an id its catalog does not hold and falls straight back
    out of it. A fetch that finds no conversation answers too — with `null` —
    so the view stops waiting and the catalog's own fallback takes over.
  */
  const [answer, setAnswer] = useState<
    { readonly channelId: string; readonly channel: ChannelSummary | null } | null
  >(null);
  const settled = answer !== null && answer.channelId === channelId;

  useEffect(() => {
    if (!wanted || !channelId) {
      claimOpenAgentConversation(registry, null);
      setAnswer(null);
      return;
    }
    let cancelled = false;
    /*
      Claimed before the answer arrives, because the navigation reconciles on
      the same commit this fetch starts on: an id nobody has claimed and that
      the catalog does not list is one the direct message page replaces with
      the latest conversation.
    */
    claimOpenAgentConversation(registry, channelId);
    void loadChannel(token, workspaceId, channelId, { messageLimit: 1 })
      .then((result) => {
        if (cancelled) return;
        const held = result.channel.readOnly ? result.channel : null;
        if (!held) claimOpenAgentConversation(registry, null);
        setAnswer({ channelId, channel: held });
      })
      .catch(() => {
        // Whatever the id was, this view cannot show it. Releasing the claim
        // hands the decision back to the catalog's own fallback.
        if (cancelled) return;
        claimOpenAgentConversation(registry, null);
        setAnswer({ channelId, channel: null });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, workspaceId, registry, token, wanted]);

  useEffect(() => () => {
    claimOpenAgentConversation(registry, null);
  }, [registry]);

  return {
    channel: settled ? answer.channel : null,
    loading: wanted && !settled,
  };
}

/*
  The same conversation, as a direct message view uses it.

  The desktop pane and the companion arrangement both fetch it by id, hand it to
  the timeline alongside the catalog's own conversations, scroll to the message a
  relay row pointed at, and go back to wherever the reader came from. Only the
  layout around it differs, so the whole behaviour lives here and each view
  spreads the result over its own `Channels`.
*/

/** Where a relay row was activated, and what it pointed at on the other side. */
type RelayTarget = {
  readonly channelId: string;
  readonly messageId: string | null;
  readonly originChannelId: string | null;
};

/** The message the timeline should scroll to, in the shape `Channels` takes. */
export type AgentConversationRequestedMessage = {
  readonly channelId: string;
  readonly messageId: string;
  readonly rootMessageId: string;
};

export type AgentConversationSurface = {
  /** The read-only conversation on screen, or `null` when none is. */
  readonly channel: ChannelSummary | null;
  /** A fetch is in flight, so the view should wait rather than fall back. */
  readonly loading: boolean;
  /** The catalog's conversations, plus the read-only one while it is open. */
  readonly channels: ChannelSummary[];
  /** Opens the Agent-to-Agent conversation a relay row points at. */
  readonly openRelay: (relay: ChannelMessageRelay) => void;
  /** Leaves it: for the conversation it was opened from, or the view's own back. */
  readonly leave: () => void;
  readonly requestedMessage: AgentConversationRequestedMessage | null;
  readonly clearRequestedMessage: () => void;
};

export function useAgentConversationSurface({
  activeChannelId,
  channels,
  enabled,
  onChannelSelect,
  onNavigateBack,
  workspaceId,
  token,
}: {
  activeChannelId: string | null;
  /** The catalog's direct messages. An id it holds is never fetched. */
  channels: ChannelSummary[];
  /** False while the catalog is still loading, since it may yet hold the id. */
  enabled: boolean;
  onChannelSelect: (channelId: string) => void;
  /** Where back goes when the reader did not arrive through a relay row. */
  onNavigateBack: () => void;
  workspaceId: string;
  token: string;
}): AgentConversationSurface {
  const registry = useRegistry();
  const conversation = useAgentConversationChannel({
    channelId: activeChannelId,
    channels,
    enabled,
    workspaceId,
    token,
  });
  const [relayTarget, setRelayTarget] = useState<RelayTarget | null>(null);
  // A target only speaks for the conversation it points at: selecting another
  // one leaves it behind rather than scrolling that conversation somewhere.
  const relayHere = relayTarget?.channelId === activeChannelId
    ? relayTarget
    : null;
  /*
    The timeline reloads its conversation whenever either of these two changes,
    so both are held: a fresh object every render would ask for the page again
    on every render, and a message the timeline never finds would never stop
    asking.
  */
  const requestedChannelId = relayHere?.channelId ?? null;
  const requestedMessageId = relayHere?.messageId ?? null;
  const requestedMessage = useMemo(
    () =>
      requestedChannelId && requestedMessageId
        ? {
            channelId: requestedChannelId,
            messageId: requestedMessageId,
            rootMessageId: requestedMessageId,
          }
        : null,
    [requestedChannelId, requestedMessageId],
  );
  const clearRequestedMessage = useCallback(
    () =>
      setRelayTarget((current) =>
        current ? { ...current, messageId: null } : current
      ),
    [],
  );
  // Held for the same reason: the timeline keys work off this list.
  const openConversation = conversation.channel;
  const surfaceChannels = useMemo(
    () => (openConversation ? [...channels, openConversation] : channels),
    [channels, openConversation],
  );

  return {
    channel: conversation.channel,
    loading: conversation.loading,
    channels: surfaceChannels,
    openRelay: (relay) => {
      setRelayTarget({
        channelId: relay.peerChannelId,
        messageId: relay.peerMessageId,
        originChannelId: activeChannelId,
      });
      // Before navigating, so the shell does not reconcile the page back to the
      // latest conversation on the way in.
      claimOpenAgentConversation(registry, relay.peerChannelId);
      onChannelSelect(relay.peerChannelId);
    },
    leave: () => {
      const origin = relayHere?.originChannelId;
      setRelayTarget(null);
      if (origin) onChannelSelect(origin);
      else onNavigateBack();
    },
    requestedMessage,
    clearRequestedMessage,
  };
}
