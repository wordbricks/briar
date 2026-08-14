import { useEffect, useState } from "react";
import type { ChannelAgentActivityFrame } from "../lib/channel-agent-activity";
import { ChannelActivityRealtimeTransport } from "../lib/channel-activity-realtime";

export function useChannelAgentActivity(
  token: string,
  organizationId: string,
  channelId: string | null,
) {
  const [activity, setActivity] = useState<
    ReadonlyMap<string, ChannelAgentActivityFrame>
  >(new Map());

  useEffect(() => {
    setActivity(new Map());
    if (!channelId) return;
    const transport = new ChannelActivityRealtimeTransport({
      token,
      organizationId,
      channelId,
    });
    const unsubscribe = transport.subscribe((frame) => {
      setActivity((current) => {
        const previous = current.get(frame.replyJobId);
        if (
          previous &&
          (previous.attempt > frame.attempt ||
            (previous.attempt === frame.attempt &&
              previous.sequence >= frame.sequence))
        ) {
          return current;
        }
        const next = new Map(current);
        if (Date.parse(frame.expiresAt) > Date.now()) {
          // Null activity is a short-lived high-water tombstone. Retaining it
          // prevents a delayed lower-sequence publish from restoring stale UI.
          next.set(frame.replyJobId, frame);
        } else {
          next.delete(frame.replyJobId);
        }
        return next;
      });
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else transport.start();
    };
    const reap = window.setInterval(() => {
      const now = Date.now();
      setActivity((current) => {
        if ([...current.values()].every((frame) => Date.parse(frame.expiresAt) > now)) {
          return current;
        }
        return new Map(
          [...current].filter(([, frame]) => Date.parse(frame.expiresAt) > now),
        );
      });
    }, 5_000);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      unsubscribe();
      transport.stop();
      window.clearInterval(reap);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [channelId, organizationId, token]);

  return activity;
}
