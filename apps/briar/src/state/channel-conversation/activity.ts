import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import type { ChannelAgentActivityFrame } from "../../lib/channel-agent-activity";
import { useChannelAgentActivity } from "../../hooks/use-channel-agent-activity";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  channelMessagePendingRepliesAtom,
  splitChannelKey,
} from "./atoms";

/*
  The live activity frames of one channel's agents.

  A frame is the headline a typing strip shows under an agent's name, and it
  arrives on the channel's own activity socket. The socket has to be opened
  once per channel — `useChannelAgentActivity` builds a transport — but the
  strips that render the frames are one per message, so the hook cannot live
  where the value is read.

  So the value is an atom: `ChannelActivityPublisher` mounts the hook as a leaf
  and writes what it holds here, and every strip subscribes. The publisher
  re-renders on every frame; nothing above it does.
*/

const noActivity: ReadonlyMap<string, ChannelAgentActivityFrame> = new Map();

export const channelAgentActivityAtom = Atom.family((channelId: string) =>
  Atom.make<ReadonlyMap<string, ChannelAgentActivityFrame>>(noActivity).pipe(
    Atom.keepAlive,
    Atom.withLabel(`channelConversation/${channelId}/activity`),
  ),
);

/**
 * Opens the channel's activity socket and publishes its frames. Mount it as a
 * leaf: it re-renders on every frame, which is exactly what must not reach the
 * conversation around it.
 */
export function ChannelActivityPublisher({
  channelId,
  enabled = true,
}: {
  readonly channelId: string | null;
  readonly enabled?: boolean;
}) {
  const registry = useRegistry();
  const token = useAtomValue(tokenAtom);
  const organizationId = useAtomValue(activeOrganizationIdAtom);
  const activity = useChannelAgentActivity(
    token ?? "",
    organizationId ?? "",
    enabled && channelId ? channelId : null,
  );
  useEffect(() => {
    if (!channelId) return;
    registry.set(channelAgentActivityAtom(channelId), activity);
    return () => {
      registry.set(channelAgentActivityAtom(channelId), noActivity);
    };
  }, [activity, channelId, registry]);
  return null;
}

/**
 * The frames belonging to the replies under one root message, keyed by
 * `channelMessageKey`. Deriving it per message is what keeps a frame for one
 * agent from waking every other message's strip: the map below is compared
 * entry by entry, so a strip whose replies have no frame sees the same empty
 * map it saw before.
 */
export const channelMessageActivityAtom = Atom.family((key: string) => {
  const { channelId } = splitChannelKey(key);
  return Atom.make(
    (get): ReadonlyMap<string, ChannelAgentActivityFrame> => {
      const replies = get(channelMessagePendingRepliesAtom(key));
      if (replies.length === 0) return noActivity;
      const published = get(channelAgentActivityAtom(channelId));
      const frames = new Map<string, ChannelAgentActivityFrame>();
      for (const reply of replies) {
        const frame = published.get(reply.id);
        if (frame) frames.set(reply.id, frame);
      }
      return frames.size === 0 ? noActivity : frames;
    },
  ).pipe(
    Atom.withEquality<ReadonlyMap<string, ChannelAgentActivityFrame>>(
      sameFrames,
    ),
    Atom.withLabel(`channelConversation/${key}/messageActivity`),
  );
});

const sameFrames = (
  left: ReadonlyMap<string, ChannelAgentActivityFrame>,
  right: ReadonlyMap<string, ChannelAgentActivityFrame>,
) => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [id, frame] of left) {
    if (right.get(id) !== frame) return false;
  }
  return true;
};
