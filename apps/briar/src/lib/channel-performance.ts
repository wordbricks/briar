export const desktopChannelCachedTargetMs = 150;
export const desktopChannelInitialTargetMs = 500;

export type DesktopChannelDisplaySource = "cache" | "network" | "empty";

export type DesktopChannelTransitionMetric = {
  channelId: string;
  headerMs: number | null;
  firstMessageMs: number;
  source: DesktopChannelDisplaySource;
  targetMs: number;
};

type PendingTransition = {
  startedAt: number;
  headerMs: number | null;
};

const pendingTransitions = new Map<string, PendingTransition>();

const now = () => globalThis.performance?.now?.() ?? Date.now();

const mark = (name: string, detail: Record<string, unknown>) => {
  try {
    globalThis.performance?.mark?.(name, { detail });
  } catch {
    // Older embedded WebViews support timing but not mark detail objects.
    globalThis.performance?.mark?.(name);
  }
};

export function startDesktopChannelTransition(channelId: string) {
  const startedAt = now();
  pendingTransitions.clear();
  pendingTransitions.set(channelId, { startedAt, headerMs: null });
  mark("briar:channel-transition:start", { channelId });
}

export function recordDesktopChannelHeader(channelId: string) {
  const pending = pendingTransitions.get(channelId);
  if (!pending || pending.headerMs !== null) return;
  pending.headerMs = Math.max(0, now() - pending.startedAt);
  mark("briar:channel-transition:header", {
    channelId,
    durationMs: pending.headerMs,
  });
}

export function recordDesktopChannelFirstMessage(
  channelId: string,
  source: DesktopChannelDisplaySource,
) {
  const pending = pendingTransitions.get(channelId);
  if (!pending) return null;
  const metric: DesktopChannelTransitionMetric = {
    channelId,
    headerMs: pending.headerMs,
    firstMessageMs: Math.max(0, now() - pending.startedAt),
    source,
    targetMs: source === "cache"
      ? desktopChannelCachedTargetMs
      : desktopChannelInitialTargetMs,
  };
  pendingTransitions.delete(channelId);
  mark("briar:channel-transition:first-message", metric);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DesktopChannelTransitionMetric>(
        "briar:channel-transition",
        { detail: metric },
      ),
    );
  }
  return metric;
}

export function resetDesktopChannelPerformanceForTests() {
  pendingTransitions.clear();
}
