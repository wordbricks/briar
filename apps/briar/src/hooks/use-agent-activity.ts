import { useEffect, useState } from "react";

export type AgentActivityFrameState = {
  replyJobId: string;
  attempt: number;
  sequence: number;
  expiresAt: string;
};

export type AgentActivityTransport<Frame> = {
  subscribe: (listener: (frame: Frame) => void) => () => void;
  start: () => void;
  stop: () => void;
};

export function updateAgentActivity<Frame extends AgentActivityFrameState>(
  current: ReadonlyMap<string, Frame>,
  frame: Frame,
  now = Date.now(),
): ReadonlyMap<string, Frame> {
  const previous = current.get(frame.replyJobId);
  if (
    previous &&
    (previous.attempt > frame.attempt ||
      (previous.attempt === frame.attempt &&
        previous.sequence >= frame.sequence))
  ) return current;
  const next = new Map(current);
  if (Date.parse(frame.expiresAt) > now) {
    // Null activity is a short-lived high-water tombstone. Retaining it
    // prevents a delayed lower-sequence publish from restoring stale UI.
    next.set(frame.replyJobId, frame);
  } else {
    next.delete(frame.replyJobId);
  }
  return next;
}

export function reapExpiredAgentActivity<Frame extends AgentActivityFrameState>(
  current: ReadonlyMap<string, Frame>,
  now = Date.now(),
): ReadonlyMap<string, Frame> {
  if ([...current.values()].every((frame) => Date.parse(frame.expiresAt) > now)) {
    return current;
  }
  return new Map(
    [...current].filter(([, frame]) => Date.parse(frame.expiresAt) > now),
  );
}

export function useAgentActivity<Frame extends AgentActivityFrameState>(
  transport: AgentActivityTransport<Frame> | null,
) {
  const [activity, setActivity] = useState<ReadonlyMap<string, Frame>>(new Map());

  useEffect(() => {
    setActivity(new Map());
    if (!transport) return;
    const unsubscribe = transport.subscribe((frame) => {
      setActivity((current) => updateAgentActivity(current, frame));
    });
    const updateVisibility = () => {
      if (document.hidden) transport.stop();
      else transport.start();
    };
    const reap = window.setInterval(() => {
      setActivity((current) => reapExpiredAgentActivity(current));
    }, 5_000);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      unsubscribe();
      transport.stop();
      window.clearInterval(reap);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [transport]);

  return activity;
}
