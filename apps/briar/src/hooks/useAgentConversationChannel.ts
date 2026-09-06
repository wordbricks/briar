import { useEffect, useState } from "react";

import { loadChannel } from "../lib/api";
import type { ChannelSummary } from "../lib/channels-contract";
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
  organizationId,
  token,
}: {
  channelId: string | null;
  /** The catalog. An id it already holds is never fetched. */
  channels: readonly ChannelSummary[];
  /** False while the catalog is still loading, since it may yet hold the id. */
  enabled: boolean;
  organizationId: string;
  token: string;
}): AgentConversationChannelState {
  const registry = useRegistry();
  const known = channelId !== null &&
    channels.some((channel) => channel.id === channelId);
  const [channel, setChannel] = useState<ChannelSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !channelId || known || !token || !organizationId) {
      claimOpenAgentConversation(registry, null);
      setChannel(null);
      setLoading(false);
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
    setLoading(true);
    void loadChannel(token, organizationId, channelId, { messageLimit: 1 })
      .then((result) => {
        if (cancelled) return;
        const held = result.channel.readOnly ? result.channel : null;
        if (!held) claimOpenAgentConversation(registry, null);
        setChannel(held);
      })
      .catch(() => {
        // Whatever the id was, this view cannot show it. Releasing the claim
        // hands the decision back to the catalog's own fallback.
        if (cancelled) return;
        claimOpenAgentConversation(registry, null);
        setChannel(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, enabled, known, organizationId, registry, token]);

  useEffect(() => () => {
    claimOpenAgentConversation(registry, null);
  }, [registry]);

  return {
    channel: channel && channel.id === channelId ? channel : null,
    loading,
  };
}
