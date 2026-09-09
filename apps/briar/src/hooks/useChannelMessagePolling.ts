import { useEffect } from "react";

import { listChannelMessages } from "../lib/api";
import { applyIncomingChannelMessages } from "../state/channel-conversation/incoming";
import { useRegistry } from "../state/registry";

/*
  A timer that keeps one conversation current without the catalog.

  Every conversation the sidebar knows about rides the workspace's channel
  delta loop, which only carries the channels the catalog holds. An
  Agent-to-Agent conversation is read on demand and deliberately absent from
  that catalog, so while one is open this asks for its page directly. It stops
  with the view and while the window is hidden, so a conversation left open in
  a background window costs nothing.
*/

export const readOnlyChannelPollIntervalMs = 3_000;

export function useChannelMessagePolling({
  channelId,
  enabled,
  intervalMs = readOnlyChannelPollIntervalMs,
  limit = 50,
  workspaceId,
  token,
}: {
  channelId: string | null;
  enabled: boolean;
  intervalMs?: number;
  limit?: number;
  workspaceId: string;
  token: string;
}): void {
  const registry = useRegistry();
  useEffect(() => {
    if (!enabled || !channelId || !token || !workspaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const { messages } = await listChannelMessages(
          token,
          workspaceId,
          channelId,
          undefined,
          { limit },
        );
        if (cancelled) return;
        // Replies belong in the single timeline here, the way every direct
        // message renders them.
        applyIncomingChannelMessages(registry, channelId, messages, [], true, false);
      } catch {
        // A failed tick is not worth reporting: the next one retries, and the
        // conversation on screen is still the last good page.
      }
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null || cancelled) return;
      timer = setInterval(() => void poll(), intervalMs);
    };
    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [channelId, enabled, intervalMs, limit, workspaceId, registry, token]);
}
