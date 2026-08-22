import { useEffect, useState } from "react";
import type { IssueAgentActivityFrame } from "../lib/channel-agent-activity";
import { IssueActivityRealtimeTransport } from "../lib/issue-activity-realtime";

export function useIssueAgentActivity(
  token: string | null,
  projectId: string,
  runId: string,
) {
  const [activity, setActivity] = useState<
    ReadonlyMap<string, IssueAgentActivityFrame>
  >(new Map());

  useEffect(() => {
    setActivity(new Map());
    if (!token) return;
    const transport = new IssueActivityRealtimeTransport({
      token,
      projectId,
      runId,
    });
    const unsubscribe = transport.subscribe((frame) => {
      setActivity((current) => {
        const previous = current.get(frame.replyJobId);
        if (
          previous &&
          (previous.attempt > frame.attempt ||
            (previous.attempt === frame.attempt &&
              previous.sequence >= frame.sequence))
        ) return current;
        const next = new Map(current);
        if (Date.parse(frame.expiresAt) > Date.now()) {
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
  }, [projectId, runId, token]);

  return activity;
}
